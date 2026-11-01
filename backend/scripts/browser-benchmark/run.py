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
VARIANTS = ['control', 'sol-low', 'sol-medium', 'sol-high', 'luna-low', 'luna-high', 'luna-xhigh', 'astra-low', 'astra-medium', 'terra-medium', 'terra-high', 'luna-coordinator', 'luna-services', 'luna-execution', 'luna-coordinator-both', 'luna-interaction-mcp']
CASES = ['billing', 'stays', 'support', 'desktop', 'live-mdn', 'live-wikipedia', 'support-file']
CASES += ['driver-form', 'driver-auth', 'driver-payment', 'driver-handoff', 'driver-recovery', 'driver-concurrent', 'driver-resume']
VARIANTS += ['driver-current', 'driver-cua']
COMPARISON_CASES = ['staged-login', 'amazon-order', 'amazon-products', 'facebook-event', 'apple-store']
CASES += COMPARISON_CASES

def selected(value, choices):
    values = value.split(',')
    if not values or len(set(values)) != len(values) or any(v not in choices for v in values):
        raise argparse.ArgumentTypeError('Choose comma-separated values from: ' + ','.join(choices))
    return values

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--suite', choices=['browser-worker', 'interaction'], default='browser-worker')
parser.add_argument('--phase', choices=['smoke', 'main', 'assisted', 'diagnostic'], default='main')
parser.add_argument('--validated-smoke', type=Path, help='Passing three-arm smoke on identical harness/images; required for main collection')
parser.add_argument('--human-wait', type=int, default=900, help='Maximum wait for private input in the separate assisted phase, seconds')
parser.add_argument('--arms', type=lambda v: selected(v, ['browser','computer','android']), help='Methods for diagnostic runs only')
parser.add_argument('--parent', type=Path, help='Completed main comparison; required for separate assisted run')
parser.add_argument('--variants', type=lambda v: selected(v, VARIANTS), default=VARIANTS[:9])
parser.add_argument('--cases', type=lambda v: selected(v, CASES), default=None)
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
if args.repetitions < 1 or args.timeout < 30 or args.round_offset < 0 or args.human_wait < 1:
    parser.error('repetitions must be positive, timeout must be >= 30, and round-offset must be nonnegative')
args.cases = args.cases or (COMPARISON_CASES[1:] if args.phase == 'assisted' else COMPARISON_CASES[:1] if args.phase == 'smoke' else COMPARISON_CASES[:4]) if args.suite == 'interaction' else args.cases or CASES[:6]
if args.suite != 'interaction' and any(c in COMPARISON_CASES for c in args.cases):
    parser.error('Comparison cases require --suite interaction')
if args.suite == 'interaction':
    if any(c not in COMPARISON_CASES or c == 'apple-store' and args.phase != 'assisted' or c == 'staged-login' and args.phase == 'assisted' for c in args.cases):
        parser.error('Apple Store belongs only to the separate assisted phase')
    if args.phase == 'smoke' and args.cases != ['staged-login']:
        parser.error('Smoke uses only the matched fixture')
    if args.phase == 'assisted' and not args.parent:
        parser.error('Assisted run requires --parent completed-main-run')
config = {k: getattr(args, k) for k in ['variants', 'cases', 'contexts', 'repetitions', 'timeout', 'round_offset']}
if args.suite == 'interaction':
    config.update(suite='interaction', phase=args.phase, variants=['browser','computer'] if args.phase == 'assisted' else ['browser','computer','android'], contexts=['fresh'], parent=str(args.parent.resolve()) if args.parent else None, signOutAuthorized=True, humanWaitSeconds=args.human_wait, validatedSmoke=str(args.validated_smoke.resolve()) if args.validated_smoke else None)
if args.arms and args.phase != 'diagnostic':
    parser.error('--arms is only for diagnostic runs')
if args.phase == 'diagnostic':
    if args.suite != 'interaction' or any(c not in ['amazon-products','amazon-order'] for c in args.cases):
        parser.error('Diagnostic phase supports Amazon retrieval using existing sessions')
    config['variants'] = args.arms or ['android']
    config['signOutAuthorized'] = False
source_hashes = {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(SCRIPTS.iterdir()) if p.is_file()}
if args.resume:
    output = args.resume.resolve()
    config = json.loads((output / 'config.json').read_text())
    previous_hashes = json.loads((output / 'environment.json').read_text()).get('sourceHashes')
    if previous_hashes != source_hashes:
        parser.error('Harness changed since this run. Start a new output directory to avoid mixing experiments.')
else:
    output = (args.output or ROOT / ('.local/android-browser-comparison' if config.get('suite') == 'interaction' else '.local/browser-benchmark') / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')).resolve()
if config.get('suite') == 'interaction' and config['phase'] == 'assisted':
    parent = Path(config['parent'])
    parent_config = json.loads((parent / 'config.json').read_text())
    rows = [json.loads(line) for line in (parent / 'results.jsonl').read_text().splitlines() if line]
    expected = len(parent_config['cases']) * 3 * parent_config['repetitions']
    if parent_config.get('suite') != 'interaction' or parent_config.get('phase') != 'main' or len({r['key'] for r in rows}) != expected or not json.loads((parent / 'runtime.json').read_text()).get('cleanupVerified'):
        parser.error('Assisted run must follow a completed, cleaned-up main comparison')
    if not args.resume:
        config['assistedJobs'] = [{'key':'assisted:' + row['key'], 'case':row['case'], 'arm':row['variant'], 'round':row['round'], 'sourceSample':row['sample']} for row in rows if row.get('needsHuman') and row['case'] in config['cases']]
        if 'apple-store' in config['cases']:
            config['assistedJobs'] += [{'key':f'assisted:{round}:apple-store:{arm}', 'case':'apple-store','arm':arm,'round':round} for round in range(config['repetitions']) for arm in (['browser','computer'] if round % 2 == 0 else ['computer','browser'])]
        config['variants'] = list(dict.fromkeys(job['arm'] for job in config['assistedJobs']))
print(json.dumps({'config':config,'samples':len(config['assistedJobs']) if 'assistedJobs' in config else len(config['variants'])*len(config['cases'])*len(config['contexts'])*config['repetitions'],'output':str(output)},indent=2),flush=True)
if args.check:
    raise SystemExit(0)
if config.get('suite') == 'interaction' and config['phase'] == 'main' and not args.preflight_only and not config.get('validatedSmoke'):
    parser.error('Main collection requires --validated-smoke passing-three-arm-run')
if args.resume and not json.loads((output / 'runtime.json').read_text()).get('cleanupVerified'):
    parser.error('Reconcile prior owned resources before resuming an unverified cleanup')

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

def checkpoint():
    # Export while running: a lost container cannot erase completed samples.
    for name in ['trace.jsonl', 'results.jsonl', 'availability.json', 'protocol.json']:
        target = output / (name + '.checkpoint')
        copied = run('docker', 'cp', args.container + ':' + REMOTE + '/' + name, str(target), check=False, capture=True).returncode == 0
        if copied:
            data = target.read_bytes()
            if name.endswith('.jsonl') and data and not data.endswith(b'\n'):
                data = data[:data.rfind(b'\n') + 1]
            target.write_bytes(data)
            target.replace(output / name)
        else:
            target.unlink(missing_ok=True)

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
    if config.get('suite') == 'interaction':
        config['database'] = 'pal_ui_' + uuid.uuid4().hex[:12] + '_test'
        run('docker', 'exec', 'pal-dev-split-postgres-1', 'createdb', '-U', 'pal', config['database'])
        runtime['database'] = config['database']
        android_container = 'pal-dev-split-android-mcp-1'
        power = run('docker','exec',android_container,'adb','shell','settings','get','global','stay_on_while_plugged_in',capture=True).stdout.strip()
        runtime['phonePower'] = power
        write_json('runtime.json', runtime)
        run('docker','exec',android_container,'adb','install','-r','/opt/android/fixture.apk')
        run('docker','exec',android_container,'adb','shell','am','force-stop','dev.pal.securefixture')
        run('docker','exec',android_container,'adb','shell','svc','power','stayon','usb')
        run('docker','exec',android_container,'adb','shell','input','keyevent','KEYCODE_WAKEUP')
        write_json('runtime.json', runtime)
    (output / 'config.json').write_text(json.dumps(config, indent=2))
    environment = {
        'revision': run('git', 'rev-parse', 'HEAD', capture=True).stdout.strip(),
        'dirty': bool(run('git', 'status', '--porcelain', capture=True).stdout.strip()),
        'container': requested_container,
        'containerId': args.container,
        'sourceHashes': source_hashes,
        'containerImage': container['Image'],
        'relatedImages': {name: json.loads(run('docker','inspect',name,capture=True).stdout)[0]['Image'] for name in ['pal-dev-split-execution-1','pal-dev-split-android-mcp-1']} if config.get('suite') == 'interaction' else {},
        'startedAt': datetime.now(timezone.utc).isoformat(),
        'measurementBoundary': 'Task stream invocation through final response; excludes Main routing, UI transport and fixture setup',
        'suite': config.get('suite', 'browser-worker'),
        'phase': config.get('phase'),
        'contextPolicy': 'Versioned synthetic raw conversation; observational memory disabled for controlled context comparison',
    }
    if config.get('suite') == 'interaction':
        environment['platform'] = {
            'phoneModel': run('docker','exec','pal-dev-split-android-mcp-1','adb','shell','getprop','ro.product.model',capture=True).stdout.strip(),
            'androidVersion': run('docker','exec','pal-dev-split-android-mcp-1','adb','shell','getprop','ro.build.version.release',capture=True).stdout.strip(),
            'chromium': run('docker','exec','pal-dev-split-execution-1','chromium','--version',capture=True).stdout.strip(),
            'apks': run('docker','exec','pal-dev-split-android-mcp-1','sha256sum','/opt/android/helper.apk','/opt/android/fixture.apk',capture=True).stdout.strip().splitlines(),
        }
    if config.get('suite') == 'interaction' and config['phase'] == 'main' and not args.preflight_only:
        smoke = Path(config['validatedSmoke'])
        smoke_environment = json.loads((smoke / 'environment.json').read_text())
        smoke_rows = [json.loads(line) for line in (smoke / 'results.jsonl').read_text().splitlines() if line]
        if {r.get('variant') for r in smoke_rows if r.get('success') is True and r.get('boundaryValid') is True and r.get('privacyValid') is True} != {'browser','computer','android'} or any(smoke_environment.get(k) != environment.get(k) for k in ['sourceHashes','containerImage','relatedImages']) or not json.loads((smoke / 'runtime.json').read_text()).get('cleanupVerified'):
            raise RuntimeError('Smoke must pass all three arms with identical harness/images and verified cleanup')
    if args.resume:
        previous = json.loads((output / 'environment.json').read_text())
        if previous.get('containerImage') != environment['containerImage'] or previous.get('relatedImages', {}) != environment.get('relatedImages', {}):
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
    if args.resume and (output / 'protocol.json').exists():
        run('docker','cp',str(output / 'protocol.json'),args.container + ':' + REMOTE + '/protocol.json')
    run('docker','exec','--user','root',args.container,'chown','-R','node:node',REMOTE)
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
                checkpoint()
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
    checkpoint()
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
        if config.get('suite') == 'interaction' and runtime.get('phonePower') is not None:
            run('docker','exec','pal-dev-split-android-mcp-1','adb','uninstall','dev.pal.securefixture',check=False,capture=True)
            power = runtime['phonePower']
            run('docker','exec','pal-dev-split-android-mcp-1','adb','shell','settings', *(['delete','global','stay_on_while_plugged_in'] if power == 'null' else ['put','global','stay_on_while_plugged_in',power]),check=False,capture=True)
        if config.get('suite') == 'interaction' and runtime.get('database'):
            run('docker', 'exec', 'pal-dev-split-postgres-1', 'dropdb', '--if-exists', '-U', 'pal', runtime['database'], check=False)
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
