"""Run the browser matrix on an isolated lane pool with contention telemetry."""
import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
from queue import Queue, Empty
import re
import statistics
import signal
import subprocess
import sys
from threading import Lock, Event
import time
from lanes import BASE, ROOT, capacity

SCRIPTS = Path(__file__).resolve().parent
DEFAULT_CASES = ['billing', 'stays', 'support', 'desktop', 'live-mdn', 'live-wikipedia']
VARIANTS = ['control', 'sol-low', 'sol-medium', 'sol-high', 'luna-low', 'luna-high', 'luna-xhigh', 'astra-low', 'astra-medium', 'luna-coordinator', 'luna-services', 'luna-execution', 'luna-coordinator-both']

def write(path, value):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(value, indent=2)); tmp.replace(path)

def read(path):
    return json.loads(path.read_text()) if path.exists() else {}

def host_swap(snapshot):
    match = re.search(r'used = ([\d.]+)([MG])', snapshot.get('hostSwap', ''))
    return float(match[1]) * (1024 if match[2] == 'G' else 1) if match else 0

def contention(snapshot, baseline):
    problems = []
    if snapshot['memoryKiB']['MemAvailable'] < 1048576:
        problems.append('VM available memory below 1 GiB')
    if baseline['memoryKiB']['SwapFree'] - snapshot['memoryKiB']['SwapFree'] > 262144:
        problems.append('VM additional swap exceeded 256 MiB')
    if host_swap(snapshot) - host_swap(baseline) > 512:
        problems.append('Host additional swap exceeded 512 MiB')
    return problems

def execute(output, lanes, jobs, expected, cases=None):
    output.mkdir(parents=True, exist_ok=False)
    baseline = capacity()
    state = {'startedAt': datetime.now(timezone.utc).isoformat(), 'status': 'running', 'expectedSamples': expected, 'jobs': [], 'maxConcurrency': len(lanes), 'laneManifest': str(BASE/'manifest.json'), 'contentionIssues': [], 'baselineCapacity': baseline}
    queue = Queue()
    for i, job in enumerate(jobs): queue.put((i, job))
    mutex, stop = Lock(), Event()
    def run_worker(lane):
        while not stop.is_set():
            try: index, job = queue.get_nowait()
            except Empty: break
            path = output / f'job-{index:02}-{job["variant"]}-r{job["round"]}'
            entry = {'index': index, 'lane': lane['lane'], 'container': lane['container'], 'variant': job['variant'], 'round': job['round'], 'output': str(path), 'status': 'running', 'startedAt': datetime.now(timezone.utc).isoformat()}
            with mutex: state['jobs'].append(entry)
            command = [sys.executable, '-u', str(SCRIPTS/'run.py'), '--container', lane['container'], '--variants', job['variant'], '--repetitions', '1', '--round-offset', str(job['round']), '--output', str(path)]
            if job.get('smoke'): command += ['--cases', 'billing,desktop', '--contexts', 'fresh']
            elif cases: command += ['--cases', ','.join(cases)]
            with path.with_suffix('.log').open('w') as log:
                process = subprocess.Popen(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
                try:
                    while process.poll() is None:
                        if stop.is_set() and path.exists():
                            (path/'stop.request').touch()
                        time.sleep(1)
                finally:
                    if process.poll() is None:
                        stop.set()
                        try:
                            (path/'stop.request').touch()
                        except OSError:
                            process.send_signal(signal.SIGINT)
                        # Preserve ownership locks if the runner cannot settle.
                        process.wait(timeout=90)
            runtime = read(path/'runtime.json')
            progress = read(path/'progress.json')
            expected_job = 2 if job.get('smoke') else 2 * len(cases or DEFAULT_CASES)
            with mutex:
                entry.update(exitCode=process.returncode, endedAt=datetime.now(timezone.utc).isoformat(), status='completed' if process.returncode == 0 and runtime.get('cleanupVerified') and not runtime.get('interrupted') and progress.get('completed') == expected_job else 'error')
                if entry['status'] == 'error': stop.set()
            queue.task_done()
    def worker(lane):
        try:
            run_worker(lane)
        except BaseException as error:
            stop.set()
            with mutex:
                state.setdefault('fatalErrors', []).append({'lane': lane['lane'], 'error': type(error).__name__})
                for entry in state['jobs']:
                    if entry['lane'] == lane['lane'] and entry['status'] == 'running':
                        entry.update(status='error', endedAt=datetime.now(timezone.utc).isoformat())
    with ThreadPoolExecutor(max_workers=len(lanes)) as pool:
        futures = [pool.submit(worker, lane) for lane in lanes]
        try:
            while True:
                snapshot = capacity()
                with (output/'capacity.jsonl').open('a') as handle: handle.write(json.dumps(snapshot)+'\n')
                issues = contention(snapshot, baseline)
                if issues or (output/'stop.request').exists(): stop.set()
                with mutex:
                    state['contentionIssues'] = sorted(set(state['contentionIssues'] + issues))
                    entries = list(state['jobs'])
                    progress = [read(Path(x['output'])/'progress.json') for x in entries]
                    health = {k: state[k] for k in ['status', 'expectedSamples', 'contentionIssues', 'maxConcurrency']}
                    health.update(checkedAt=datetime.now(timezone.utc).isoformat(), output=str(output), activeJobs=[x for x in entries if x['status']=='running'], completed=sum(p.get('completed',0) for p in progress), passed=sum(p.get('passed',0) for p in progress), failed=sum(p.get('failed',0) for p in progress), pendingReview=sum(p.get('pendingReview',0) for p in progress), errors=[e for p in progress for e in p.get('errors',[])], failures=[e for p in progress for e in p.get('failures',[])], providerErrors=[e for p in progress for e in p.get('providerErrors',[])], memoryKiB=snapshot['memoryKiB'], hostSwap=snapshot.get('hostSwap'))
                    health['stalledJobs'] = [e['index'] for e, p in zip(entries, progress) if e['status'] == 'running' and (
                        datetime.now(timezone.utc).timestamp() - datetime.fromisoformat(p.get('checkedAt', e['startedAt'])).timestamp() > 120 or
                        p.get('lastActivity') and time.time() - p['lastActivity'] / 1000 > 720)]
                    health['monitorErrors'] = [{'jobIndex': e['index'], 'error': p['monitorError']} for e, p in zip(entries, progress) if p.get('monitorError')]
                    health['needsAttention'] = bool(stop.is_set() or health['errors'] or health['failed'] or health['providerErrors'] or health['stalledJobs'] or health['monitorErrors'])
                    write(output/'manifest.json', state); write(output/'health.json', health)
                if all(f.done() for f in futures): break
                time.sleep(10)
        except BaseException as error:
            stop.set()
            state['status'] = 'stopping'
            state.setdefault('fatalErrors', []).append({'error': type(error).__name__})
            write(output/'manifest.json', state)
            write(output/'stop.request.json', {'reason': type(error).__name__})
            raise
        for future in futures: future.result()
    # Derived combined artifacts retain originals and identify the execution lane.
    rows, events = [], []
    for entry in state['jobs']:
        path=Path(entry['output'])
        for filename, target in [('results.jsonl', rows), ('trace.jsonl', events)]:
            if (path/filename).exists():
                target.extend(dict(json.loads(line), lane=entry['lane'], jobIndex=entry['index']) for line in (path/filename).read_text().splitlines() if line)
    for name, data in [('results.jsonl',rows),('trace.jsonl',events)]:
        (output/name).write_text(''.join(json.dumps(x)+'\n' for x in data))
    state['status'] = 'complete' if len(rows)==expected and not stop.is_set() and all(x['status']=='completed' for x in state['jobs']) else 'stopped'
    state['endedAt'] = datetime.now(timezone.utc).isoformat()
    write(output/'manifest.json',state)
    health.update(status=state['status'], finished=True, completed=len(rows), passed=sum(x.get('success') is True for x in rows), failed=sum(x.get('success') is False for x in rows), pendingReview=sum(x.get('success') is None for x in rows), activeJobs=[], needsAttention=state['status']!='complete' or bool(health['providerErrors']) or any(x.get('success') is False for x in rows))
    write(output/'health.json',health)
    subprocess.run(['node',str(SCRIPTS/'report.mjs'),str(output)],cwd=ROOT,check=True)
    return state, rows, events

def model_median(events):
    values=[x['ms'] for x in events if x.get('event')=='model.finish' and isinstance(x.get('ms'),(float,int))]
    return statistics.median(values) if values else None

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('command',choices=['smoke','run'])
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--validated-smoke',type=Path)
parser.add_argument('--lanes',type=int,default=6,choices=range(1,7))
parser.add_argument('--variants',default=','.join(VARIANTS[:9]))
parser.add_argument('--cases',default=','.join(DEFAULT_CASES))
args=parser.parse_args()
manifest=read(BASE/'manifest.json')
if manifest.get('status')!='ready' or len(manifest.get('lanes',[]))<args.lanes: parser.error('Requested lanes must be provisioned')
selected=args.variants.split(',')
selected_cases=args.cases.split(',')
if len(set(selected_cases))!=len(selected_cases) or any(c not in DEFAULT_CASES+['support-file'] for c in selected_cases): parser.error('Choose unique supported case IDs')
if not selected or len(set(selected))!=len(selected) or any(v not in VARIANTS for v in selected): parser.error('Choose unique supported variant IDs')
lanes=manifest['lanes'][:args.lanes]; output=args.output.resolve()
if args.command=='smoke':
    output.mkdir(parents=True,exist_ok=False)
    one={'variant':'control','round':0,'smoke':True}
    baseline, br, be = execute(output/'baseline',lanes[:1],[one],2)
    if baseline['status']!='complete' or not all(x.get('success') for x in br):
        write(output/'contention.json',{'status':'failed','reason':'Sequential smoke failed'});raise SystemExit(1)
    parallel, pr, pe = execute(output/'concurrent',lanes,[one.copy() for _ in lanes],2*len(lanes))
    throttles=[x for x in pe if x.get('event')=='model.headers' and x.get('status',0)>=400]
    ratio=model_median(pe)/model_median(be) if model_median(be) and model_median(pe) else None
    issues=parallel['contentionIssues']
    if throttles: issues+=['Provider HTTP errors during concurrent smoke']
    if ratio and ratio>3: issues+=['Median provider request time exceeded 3x sequential smoke']
    success=parallel['status']=='complete' and all(x.get('success') for x in pr) and not issues
    write(output/'contention.json',{'status':'passed' if success else 'failed','lanes':len(lanes),'sequentialSamples':len(br),'concurrentSamples':len(pr),'baselineModelMedianMs':model_median(be),'concurrentModelMedianMs':model_median(pe),'modelMedianRatio':ratio,'providerHttpErrors':len(throttles),'issues':issues,'images':manifest['images'],'limitation':'Small same-model browser/desktop smoke; different output lengths and caching also affect request times.'})
    raise SystemExit(0 if success else 1)
else:
    check=read(args.validated_smoke/'contention.json') if args.validated_smoke else {}
    if check.get('status')!='passed' or check.get('images')!=manifest['images'] or check.get('lanes')!=len(lanes): parser.error('A passing contention smoke on these lane images is required')
    jobs=[]
    for round_index in range(3):
        shift=round_index % len(selected)
        order=selected[shift:]+selected[:shift]
        jobs += [{'variant':v,'round':round_index} for v in order]
    state, rows, events=execute(output,lanes,jobs,len(selected)*len(selected_cases)*6,selected_cases)
    if len({x.get('key') for x in rows})!=len(rows): raise RuntimeError('Duplicate matrix keys')
    raise SystemExit(0 if state['status']=='complete' else 1)
