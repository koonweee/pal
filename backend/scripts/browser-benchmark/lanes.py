"""Provision nine isolated Compose lanes and record host contention before model runs."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[3]
BASE = ROOT / '.local/browser-benchmark/nine-lanes'
VARIANTS = ['control', 'sol-low', 'sol-medium', 'sol-high', 'luna-low', 'luna-high', 'luna-xhigh', 'astra-low', 'astra-medium']
SOURCE = 'pal-dev-split-agent-service-1'
ENV_FILE = ROOT / 'backend/.env.development'

def run(command, capture=False, check=True):
    return subprocess.run(command, cwd=ROOT, text=True, capture_output=capture, check=check)

def compose(index, *args, capture=False, check=True):
    variant = VARIANTS[index]
    env = dict(os.environ, PAL_ENV_FILE=str(ENV_FILE), PAL_EXECUTION_ID=f'pal-bench-{variant}-execution', PAL_EXECUTION_NETWORK_PREFIX=f'172.30.{180 + index}')
    return subprocess.run(['docker', 'compose', '--env-file', str(ENV_FILE), '--project-name', f'pal-bench-{variant}', '-f', str(ROOT / 'backend/compose.yaml'), '-f', str(BASE / 'override.yaml'), *args], cwd=ROOT, env=env, text=True, capture_output=capture, check=check)

def capacity():
    raw = run(['docker', 'exec', SOURCE, 'cat', '/proc/meminfo'], capture=True).stdout
    mem = {line.split(':')[0]: int(line.split()[1]) for line in raw.splitlines() if len(line.split()) >= 2}
    stats = run(['docker', 'stats', '--no-stream', '--format', '{{json .}}'], capture=True).stdout
    return {'at': datetime.now(timezone.utc).isoformat(), 'memoryKiB': {k: mem.get(k) for k in ['MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree']}, 'containers': [json.loads(line) for line in stats.splitlines() if line]}

def record(event):
    with (BASE / 'capacity.jsonl').open('a') as handle:
        handle.write(json.dumps(event) + '\n')

def prepare():
    BASE.mkdir(parents=True, exist_ok=True)
    os.chmod(BASE, 0o700)
    if (BASE / 'manifest.json').exists():
        raise RuntimeError('Lane manifest exists; inspect existing lanes before provisioning again')
    existing = run(['docker', 'network', 'ls', '--format', '{{.Name}}'], capture=True).stdout.splitlines()
    if any(name.startswith('pal-bench-') for name in existing):
        raise RuntimeError('Existing benchmark networks need inspection before provisioning')
    networks = run(['docker', 'network', 'inspect', *existing], capture=True).stdout
    import ipaddress
    occupied = [ipaddress.ip_network(c['Subnet']) for n in json.loads(networks) for c in (n.get('IPAM', {}).get('Config') or []) if c.get('Subnet')]
    for i in range(9):
        candidate = ipaddress.ip_network(f'172.30.{180+i}.0/24')
        if any(candidate.version == n.version and candidate.overlaps(n) for n in occupied):
            raise RuntimeError('A lane network overlaps an existing Docker network')
    # Pin available local image IDs. Running containers may reference pruned images.
    images = {service: run(['docker', 'image', 'inspect', '--format', '{{.Id}}', f'pal-{service}-local'], capture=True).stdout.strip() for service in ['agent-service', 'execution', 'egress', 'web']}
    # Compose reset tag is required to suppress inherited host ports.
    override = 'services:\n'
    for service, image in images.items():
        override += f'  {service}:\n    image: {image}\n    restart: "no"\n'
        if service == 'web':
            override += '    ports: !reset []\n'
    override += '  postgres:\n    restart: "no"\n'
    (BASE / 'override.yaml').write_text(override)
    auth = BASE / 'auth.json'
    auth.touch(mode=0o600)
    run(['docker', 'cp', SOURCE + ':/data/private/agent/auth.json', str(auth)])
    os.chmod(auth, 0o600)
    baseline = capacity()
    record({'stage': 'baseline', **baseline})
    manifest = {'startedAt': datetime.now(timezone.utc).isoformat(), 'images': images, 'lanes': [], 'status': 'provisioning', 'minimumAvailableKiB': 1048576, 'maximumAdditionalSwapKiB': 262144}
    def save():
        (BASE / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    save()
    try:
        for i, variant in enumerate(VARIANTS):
            before = capacity(); record({'stage': 'before', 'variant': variant, **before})
            if before['memoryKiB']['MemAvailable'] < 1048576:
                raise RuntimeError('Docker VM has less than 1 GiB available; refusing additional lanes')
            manifest['lanes'].append({'variant': variant, 'index': i, 'project': f'pal-bench-{variant}', 'container': f'pal-bench-{variant}-agent-service-1'})
            save()
            compose(i, 'up', '-d', '--no-build', '--wait', 'postgres')
            compose(i, 'run', '--rm', '--no-deps', '-v', str(auth)+':/tmp/benchmark-auth.json:ro', 'agent-service', 'node', '-e', "const fs=require('fs');fs.mkdirSync('/data/private/agent',{recursive:true});fs.copyFileSync('/tmp/benchmark-auth.json','/data/private/agent/auth.json');fs.chmodSync('/data/private/agent/auth.json',0o600)")
            compose(i, 'run', '--rm', '--no-deps', 'agent-service', 'node', 'dist/database/migrate.js')
            compose(i, 'up', '-d', '--no-build', '--wait', 'execution', 'egress', 'agent-service', 'web')
            after = capacity(); record({'stage': 'ready', 'variant': variant, **after})
            print(json.dumps({'ready': variant, 'availableGiB': round(after['memoryKiB']['MemAvailable']/1048576, 2)}), flush=True)
            if baseline['memoryKiB']['SwapFree'] - after['memoryKiB']['SwapFree'] > 262144:
                raise RuntimeError('Docker VM used over 256 MiB additional swap during lane startup')
            if after['memoryKiB']['MemAvailable'] < 1048576:
                raise RuntimeError('Docker VM memory headroom fell below 1 GiB during lane startup')
        manifest['status'] = 'ready'
        save()
    except BaseException as error:
        manifest['status'] = 'capacity-blocked' if isinstance(error, RuntimeError) and ('GiB' in str(error) or 'swap' in str(error)) else 'setup-failed'
        manifest['error'] = str(error) if isinstance(error, RuntimeError) else type(error).__name__
        save()
        # Only this invocation's isolated containers; preserve evidence and private volumes.
        for lane in manifest['lanes']:
            compose(lane['index'], 'stop', '-t', '10', check=False)
        record({'stage': 'after-stop', **capacity()})
        raise
    finally:
        auth.unlink(missing_ok=True)

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('command', choices=['prepare', 'status', 'stop'])
args = parser.parse_args()
if args.command == 'prepare':
    prepare()
elif args.command == 'status':
    print(json.dumps({'manifest': json.loads((BASE/'manifest.json').read_text()), 'capacity': capacity()}, indent=2))
else:
    manifest = json.loads((BASE/'manifest.json').read_text())
    for lane in manifest['lanes']:
        compose(lane['index'], 'stop', '-t', '10')
