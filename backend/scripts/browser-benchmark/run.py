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
VARIANTS = ['control', 'sol-low', 'sol-medium', 'sol-high', 'luna-low', 'luna-high', 'luna-xhigh', 'astra-low', 'astra-medium']
CASES = ['billing', 'stays', 'support', 'desktop', 'live-mdn', 'live-wikipedia']

def selected(value, choices):
    values = value.split(',')
    if not values or len(set(values)) != len(values) or any(v not in choices for v in values):
        raise argparse.ArgumentTypeError('Choose comma-separated values from: ' + ','.join(choices))
    return values

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--variants', type=lambda v: selected(v, VARIANTS), default=VARIANTS)
parser.add_argument('--cases', type=lambda v: selected(v, CASES), default=CASES)
parser.add_argument('--contexts', type=lambda v: selected(v, ['fresh', 'established']), default=['fresh', 'established'])
parser.add_argument('--repetitions', type=int, default=3)
parser.add_argument('--timeout', type=int, default=600, help='Whole sample timeout, seconds')
parser.add_argument('--container', default='pal-dev-split-agent-service-1')
parser.add_argument('--output', type=Path)
parser.add_argument('--resume', type=Path, help='Resume missing samples from this directory; configuration is restored')
parser.add_argument('--check', action='store_true', help='Validate and display matrix without Docker/model calls')
parser.add_argument('--preflight-only', action='store_true')
args = parser.parse_args()
if args.repetitions < 1 or args.timeout < 30:
    parser.error('repetitions must be positive and timeout must be >= 30')
config = {k: getattr(args, k) for k in ['variants', 'cases', 'contexts', 'repetitions', 'timeout']}
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

output.mkdir(parents=True, exist_ok=bool(args.resume))
lock = ROOT / '.local/browser-benchmark.lock'
lock.parent.mkdir(exist_ok=True)
try:
    handle = lock.open('x')
except FileExistsError:
    raise SystemExit('Another benchmark owns .local/browser-benchmark.lock. Verify it has stopped before removing the lock.')
handle.write(str(output)); handle.close()
attached = False
try:
    (output / 'config.json').write_text(json.dumps(config, indent=2))
    environment = {
        'revision': run('git', 'rev-parse', 'HEAD', capture=True).stdout.strip(),
        'dirty': bool(run('git', 'status', '--porcelain', capture=True).stdout.strip()),
        'container': args.container,
        'sourceHashes': source_hashes,
        'containerImage': run('docker', 'inspect', '--format', '{{.Image}}', args.container, capture=True).stdout.strip(),
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
    if not args.preflight_only:
        process = subprocess.Popen(['docker', 'exec', args.container, 'node', REMOTE + '/inspect.mjs', 'run'], cwd=ROOT)
        try:
            previous = None
            while process.poll() is None:
                time.sleep(5)
                progress = docker('node', '-e', "const fs=require('node:fs');const rows=fs.readFileSync(process.argv[1],'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);const last=rows.filter(x=>['sample.start','sample.end','sample.error','delegation.start','model.finish'].includes(x.event)).at(-1);if(last)console.log(JSON.stringify(last))", REMOTE + '/trace.jsonl', capture=True, check=False).stdout.strip()
                if progress and progress != previous:
                    print(progress, flush=True); previous = progress
            if process.returncode:
                raise RuntimeError('Benchmark execution failed; see trace and resume missing samples')
        except BaseException:
            stop_result = docker('node', REMOTE + '/inspect.mjs', 'stop', check=False)
            process.wait(timeout=40)
            attached = stop_result.returncode != 0
            raise
finally:
    stopped = True
    if attached:
        stopped = docker('node', REMOTE + '/inspect.mjs', 'stop', check=False).returncode == 0
    for name in ['trace.jsonl', 'results.jsonl', 'availability.json']:
        run('docker', 'cp', args.container + ':' + REMOTE + '/' + name, str(output / name), check=False)
    if stopped:
        docker('rm', '-rf', REMOTE, check=False)
        lock.unlink(missing_ok=True)
    else:
        print('Cleanup still settling. Keep the lock; retry: docker exec ' + args.container + ' node ' + REMOTE + '/inspect.mjs stop', flush=True)
    if (output / 'results.jsonl').exists():
        run('node', str(SCRIPTS / 'report.mjs'), str(output), check=False)
print('Report: ' + str(output / 'report.html'))
