"""Drive isolated benchmark agents inside the running local development service."""
import argparse
import json
import hashlib
import uuid
import subprocess
import time
from pathlib import Path
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = Path(__file__).resolve().parent
REMOTE = '/tmp/pal-browser-benchmark-' + uuid.uuid4().hex[:10]
VARIANTS = ['control', 'sol-low', 'sol-medium', 'sol-high', 'luna-low', 'luna-high', 'luna-xhigh', 'astra-low', 'astra-medium', 'luna-coordinator', 'luna-services', 'luna-execution', 'luna-coordinator-both']
CASES = ['billing', 'stays', 'support', 'desktop', 'live-mdn', 'live-wikipedia', 'support-file']

def selected(value, choices):
    values = value.split(',')
    if not values or len(set(values)) != len(values) or any(v not in choices for v in values):
        raise argparse.ArgumentTypeError('Choose comma-separated values from: ' + ','.join(choices))
    return values

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--variants', type=lambda v: selected(v, VARIANTS), default=VARIANTS[:9])
parser.add_argument('--cases', type=lambda v: selected(v, CASES), default=CASES[:6])
parser.add_argument('--contexts', type=lambda v: selected(v, ['fresh', 'established']), default=['fresh', 'established'])
parser.add_argument('--repetitions', type=int, default=3)
parser.add_argument('--round-offset', type=int, default=0, help='First repetition index for partitioned runs')
parser.add_argument('--timeout', type=int, default=600, help='Whole sample timeout, seconds')
parser.add_argument('--container', default='pal-dev-split-agent-service-1')
parser.add_argument('--output', type=Path)
parser.add_argument('--resume', type=Path, help='Resume missing samples from this directory; configuration is restored')
parser.add_argument('--check', action='store_true', help='Validate and display matrix without Docker/model calls')
parser.add_argument('--preflight-only', action='store_true')
args = parser.parse_args()
if args.repetitions < 1 or args.timeout < 30 or args.round_offset < 0:
    parser.error('repetitions must be positive, timeout must be >= 30, and round-offset must be nonnegative')
config = {k: getattr(args, k) for k in ['variants', 'cases', 'contexts', 'repetitions', 'timeout', 'round_offset']}
source_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(SCRIPTS.iterdir()) if p.is_file()}
if args.resume:
    output = args.resume.resolve()
    config = json.loads((output / 'config.json').read_text())
    previous_hashes = json.loads((output / 'environment.json').read_text()).get('sourceHashes')
    if previous_hashes != source_hashes:
        parser.error('Harness changed since this run. Start a new output directory to avoid mixing experiments.')
else:
    output = (args.output or ROOT / '.local/browser-benchmark' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')).resolve()
print(json.dumps({'config': config, 'samples': len(config['variants']) * len(config['cases']) * len(config['contexts']) * config['repetitions'], 'output': str(output)}, indent=2), flush=True)
if args.check:
    raise SystemExit(0)

def run(*command, check=True, capture=False):
    return subprocess.run(command, cwd=ROOT, check=check, text=True, capture_output=capture)

def docker(*command, **kwargs):
    return run('docker', 'exec', args.container, *command, **kwargs)

requested_container = args.container
container = json.loads(run('docker', 'inspect', args.container, capture=True).stdout)[0]
# Pin every command and ownership lock to the resolved identity, including aliases.
args.container = container['Id']
output.mkdir(parents=True, exist_ok=bool(args.resume))
locks = [ROOT / '.local' / ('browser-benchmark-' + args.container + '.lock')]
if container['Name'].lstrip('/') == 'pal-dev-split-agent-service-1':
    locks.insert(0, ROOT / '.local/browser-benchmark.lock')
owned_locks = []
try:
    for lock in locks:
        lock.parent.mkdir(exist_ok=True)
        with lock.open('x') as handle:
            handle.write(str(output))
        owned_locks.append(lock)
except FileExistsError:
    for owned in owned_locks:
        owned.unlink()
    raise SystemExit('Another benchmark owns ' + str(lock) + '. Verify cleanup before removing the lock.')
stop_request = output / 'stop.request'
if args.resume and stop_request.exists():
    # Preserve the earlier interruption without immediately stopping a resumed run.
    stop_request.rename(output / ('stop.request.' + str(time.time_ns())))
attached = False
stop_attempted = False
stopped = True
interrupted = False
progress = {}

def write_json(name, data):
    temporary = output / (name + '.tmp')
    temporary.write_text(json.dumps(data, indent=2))
    temporary.replace(output / name)

runtime = {'container': requested_container, 'containerId': args.container,
           'remoteDirectory': REMOTE, 'lockPaths': [str(p) for p in locks],
           'stopRequestPath': str(stop_request), 'startedAt': datetime.now(timezone.utc).isoformat()}
write_json('runtime.json', runtime)

progress_code = r'''const fs=require('node:fs');
const rows=fs.readFileSync(process.argv[1]+'/results.jsonl','utf8').split('\n').flatMap(x=>{try{return [JSON.parse(x)]}catch{return []}});
const path=process.argv[1]+'/trace.jsonl',size=fs.statSync(path).size,fd=fs.openSync(path,'r'),buf=Buffer.alloc(Math.min(size,131072));
fs.readSync(fd,buf,0,buf.length,size-buf.length);
const cursorPath=process.argv[1]+'/progress-cursor.json';
let cursor={offset:0,counts:{}};
if(fs.existsSync(cursorPath))cursor=JSON.parse(fs.readFileSync(cursorPath,'utf8'));
if(cursor.offset>size)cursor={offset:0,counts:{}};
const fresh=Buffer.alloc(size-cursor.offset);fs.readSync(fd,fresh,0,fresh.length,cursor.offset);fs.closeSync(fd);
const complete=fresh.lastIndexOf(10);
if(complete>=0){
for(const line of fresh.subarray(0,complete).toString().split('\n')){try{const row=JSON.parse(line);if(row.event==='model.headers'&&row.status>=400)cursor.counts[row.status]=(cursor.counts[row.status]||0)+1;}catch{}}
cursor.offset+=complete+1;fs.writeFileSync(cursorPath,JSON.stringify(cursor),{mode:0o600});
}
const providerErrors=Object.entries(cursor.counts).map(([status,count])=>({status:Number(status),count}));
const events=buf.toString().split('\n').flatMap(x=>{try{return [JSON.parse(x)]}catch{return []}});
console.log(JSON.stringify({providerErrors,completed:rows.length,passed:rows.filter(x=>x.success===true).length,failed:rows.filter(x=>x.success===false).length,pendingReview:rows.filter(x=>x.success===null).length,
failures:rows.filter(x=>x.success===false).map(x=>({key:x.key,status:x.status,errorType:x.errorType})),
latestSample:events.filter(x=>['sample.start','sample.end'].includes(x.event)).at(-1),
latestEvent:events.filter(x=>['sample.start','sample.end','sample.error','delegation.start','model.finish'].includes(x.event)).at(-1),
errors:events.filter(x=>['cleanup.error','sample.error'].includes(x.event)).slice(-5),lastActivity:events.at(-1)?.at}));'''

def update_progress(**fields):
    global progress
    result = docker('node', '-e', progress_code, REMOTE, capture=True, check=False)
    if result.returncode == 0:
        progress = json.loads(result.stdout)
    else:
        progress['monitorError'] = 'Remote progress read failed'
    progress.update(checkedAt=datetime.now(timezone.utc).isoformat(), **fields)
    write_json('progress.json', progress)


def stop():
    global stop_attempted, stopped, attached
    stop_attempted = True
    stopped = docker('node', REMOTE + '/inspect.mjs', 'stop', check=False).returncode == 0
    attached = not stopped
    return stopped
try:
    (output / 'config.json').write_text(json.dumps(config, indent=2))
    environment = {
        'revision': run('git', 'rev-parse', 'HEAD', capture=True).stdout.strip(),
        'dirty': bool(run('git', 'status', '--porcelain', capture=True).stdout.strip()),
        'container': requested_container,
        'containerId': args.container,
        'sourceHashes': source_hashes,
        'containerImage': container['Image'],
        'startedAt': datetime.now(timezone.utc).isoformat(),
        'measurementBoundary': 'Task stream invocation through final response; excludes Main routing, UI transport and fixture setup',
        'contextPolicy': 'Versioned synthetic raw conversation; observational memory disabled for controlled context comparison',
    }
    if args.resume:
        previous = json.loads((output / 'environment.json').read_text())
        if previous.get('containerImage') != environment['containerImage']:
            raise RuntimeError('Dev container image changed; start a new benchmark dataset')
        previous.setdefault('resumes', []).append(environment)
        environment = previous
    (output / 'environment.json').write_text(json.dumps(environment, indent=2))
    docker('mkdir', '-p', REMOTE)
    for source in SCRIPTS.glob('*.mjs'):
        run('docker', 'cp', str(source), args.container + ':' + REMOTE + '/' + source.name)
    run('docker', 'cp', str(SCRIPTS / 'bootstrap.cjs'), args.container + ':' + REMOTE + '/bootstrap.cjs')
    run('docker', 'cp', str(output / 'config.json'), args.container + ':' + REMOTE + '/config.json')
    for name in ['trace.jsonl', 'results.jsonl']:
        if args.resume and (output / name).exists():
            run('docker', 'cp', str(output / name), args.container + ':' + REMOTE + '/' + name)
        else:
            docker('node', '-e', "require('node:fs').writeFileSync(process.argv[1],'',{mode:0o600})", REMOTE + '/' + name)
    code = """const fs=require('node:fs');let found=false;for(const p of fs.readdirSync('/proc')){if(!/^\\d+$/.test(p)||Number(p)===process.pid)continue;try{const c=fs.readFileSync('/proc/'+p+'/cmdline','utf8').split('\\0');if(c.some(x=>x==='dist/main.js'||x==='/opt/pal/dist/main.js')){process.kill(Number(p),'SIGUSR1');found=true;break;}}catch{}}if(!found)throw Error('Dev service process not found');"""
    docker('node', '-e', code)
    time.sleep(0.5)
    # Mark attempted attachment too, so partial imports are restored on failure.
    attached = True
    docker('node', REMOTE + '/inspect.mjs', 'attach')
    docker('node', REMOTE + '/inspect.mjs', 'preflight')
    if stop_request.exists():
        interrupted = True
    if not args.preflight_only and not interrupted:
        process = subprocess.Popen(['docker', 'exec', args.container, 'node', REMOTE + '/inspect.mjs', 'run'], cwd=ROOT)
        try:
            previous = None
            while process.poll() is None:
                time.sleep(5)
                update_progress(finished=False)
                latest = progress.get('latestEvent')
                if latest and latest != previous:
                    print(json.dumps(latest), flush=True)
                    previous = latest
                if stop_request.exists():
                    interrupted = True
                    if not stop():
                        raise RuntimeError('Requested stop could not settle benchmark; ownership lock retained')
                    process.wait(timeout=40)
                    break
            if process.returncode and not interrupted:
                raise RuntimeError('Benchmark execution failed; see trace and resume missing samples')
        except BaseException:
            if not stop_attempted:
                stop()
            process.wait(timeout=40)
            raise
finally:
    if attached and not stop_attempted:
        stop()
    update_progress(finished=True, interrupted=interrupted, cleanupVerified=stopped)
    runtime.update(finishedAt=datetime.now(timezone.utc).isoformat(), interrupted=interrupted,
                   cleanupVerified=stopped)
    write_json('runtime.json', runtime)
    copied = True
    for name in ['trace.jsonl', 'results.jsonl', 'availability.json']:
        copied = run('docker', 'cp', args.container + ':' + REMOTE + '/' + name, str(output / name), check=False).returncode == 0 and copied
    runtime['artifactsCopied'] = copied
    write_json('runtime.json', runtime)
    if stopped:
        if copied:
            docker('rm', '-rf', REMOTE, check=False)
        for lock in owned_locks:
            lock.unlink(missing_ok=True)
    else:
        print('Cleanup still settling. Keep the lock; retry: docker exec ' + args.container + ' node ' + REMOTE + '/inspect.mjs stop', flush=True)
    if (output / 'results.jsonl').exists():
        run('node', str(SCRIPTS / 'report.mjs'), str(output), check=False)
if not stopped:
    raise RuntimeError('Cleanup unverified; ownership lock retained')
if not copied:
    raise RuntimeError('Artifact copy failed; original evidence retained at ' + REMOTE)
print('Report: ' + str(output / 'report.html'))
