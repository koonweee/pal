"""Run the default dev-stack synthetics with temporary metadata-only tracing."""
import json
import subprocess
from datetime import datetime
from pathlib import Path

scripts = Path(__file__).resolve().parent
repo = scripts.parents[2]
output = repo / '.local/login-latency-detailed'
container = 'pal-dev-split-agent-service-1'

def run(*args, check=True):
    return subprocess.run(args, cwd=repo, check=check)

if output.exists():
    output.rename(output.with_name(output.name + '-' + datetime.now().strftime('%Y%m%d-%H%M%S')))
output.mkdir(parents=True)
try:
    run('python3', str(scripts / 'attach.py'))
    run('docker', 'cp', str(scripts / 'fixtures.mjs'), container + ':/tmp/pal-login-latency-fixtures.mjs')
    run('node', str(scripts / 'run.mjs'))
finally:
    # Restore original methods/fetch before removing the temporary injector.
    expression = "const s=globalThis.__palLoginLatency;if(s){s.stop();delete globalThis.__palLoginLatency;}setTimeout(()=>process.getBuiltinModule('inspector').close(),100);return {instrumentationRestored:true};"
    run('docker', 'exec', container, 'node', '/tmp/pal-login-latency-inspector.mjs', expression, check=False)
    run('docker', 'cp', container + ':/tmp/pal-login-latency.jsonl', str(output / 'trace.jsonl'), check=False)
    config = output / 'run-config.json'
    if config.exists():
        # The helper normally removes entries/routes. Also cover partial runs and
        # close only exact-host synthetic tabs, preserving the user's desktop.
        hosts = json.dumps(list(json.loads(config.read_text())['hosts'].values()))
        cleanup = """(async()=>{
const hosts=new Set(JSON.parse(process.argv[1]));
const base='http://127.0.0.1:8087';
const r=await(await fetch(base+'/list/object/items')).json();let removed=0;
for(const item of r.data.data){if(!item.login?.uris?.some(u=>{try{return hosts.has(new URL(u.uri).hostname)}catch{return false}}))continue;
const d=await(await fetch(base+'/object/item/'+encodeURIComponent(item.id),{method:'DELETE'})).json();if(!d.success)throw Error('Synthetic cleanup failed');removed++;}
const check=await(await fetch(base+'/list/object/items')).json();
const remaining=check.data.data.filter(item=>item.login?.uris?.some(u=>{try{return hosts.has(new URL(u.uri).hostname)}catch{return false}})).length;
const {chromium}=await import('/opt/pal/node_modules/playwright-core/index.mjs');const ep=process.env.PAL_BROWSER_ENDPOINT;
const v=await(await fetch(ep+'/json/version')).json();const b=await chromium.connectOverCDP(ep.replace(/^http/,'ws')+new URL(v.webSocketDebuggerUrl).pathname,{noDefaults:true});
let closed=0;for(const c of b.contexts())for(const p of c.pages()){try{if(hosts.has(new URL(p.url()).hostname)){await p.close();closed++;}}catch{}}
await b.close();console.log(JSON.stringify({removedRemainingFixtures:removed,remainingFixtureEntries:remaining,closedFixtureTabs:closed}));if(remaining)process.exitCode=1;
})().catch(()=>{console.error('Synthetic cleanup failed');process.exitCode=1});"""
        run('docker', 'exec', container, 'node', '-e', cleanup, hosts)
    run('docker', 'exec', '--user', '0', container, 'rm', '-f',
        '/tmp/pal-login-latency-capture.cjs', '/tmp/pal-login-latency-inspector.mjs',
        '/tmp/pal-login-latency-fixtures.mjs', '/tmp/pal-login-latency.jsonl')
run('python3', str(scripts / 'analyze.py'))
