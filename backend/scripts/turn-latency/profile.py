"""Read-only model-request benchmark against the current default dev agent."""
import json
import subprocess
from datetime import datetime
from pathlib import Path

scripts = Path(__file__).resolve().parent
repo = scripts.parents[2]
output = repo / '.local/turn-latency'
container = 'pal-dev-split-agent-service-1'
task = 'c2951b04-9c4a-4b6c-9960-fefe6179447d'

def run(*args, check=True, capture=False):
    return subprocess.run(args, cwd=repo, check=check, text=True,
                          capture_output=capture)

def snapshot():
    # Only equality fingerprints and counts leave PostgreSQL.
    sql = f"""select json_build_object(
      'messages', (select json_build_object('count',count(*),'hash',md5(coalesce(string_agg(row_to_json(m)::text,'' order by id),''))) from mastra.mastra_messages m where thread_id='pal-task:{task}'),
      'thread', (select md5(row_to_json(t)::text) from mastra.mastra_threads t where id='pal-task:{task}'),
      'observations', (select md5(coalesce(string_agg(row_to_json(o)::text,'' order by id),'')) from mastra.mastra_observational_memory o where "threadId"='pal-task:{task}'),
      'threadState', (select md5(coalesce(string_agg(row_to_json(t)::text,'' order by type),'')) from mastra.mastra_thread_state t where "threadId"='pal-task:{task}'),
      'task', (select md5(row_to_json(t)::text) from public.tasks t where id='{task}'))"""
    data = run('docker', 'exec', 'pal-dev-split-postgres-1', 'sh', '-c',
               'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"',
               'sh', sql, capture=True)
    return json.loads(data.stdout)

if output.exists() and any(output.iterdir()):
    output.rename(output.with_name(output.name + '-' + datetime.now().strftime('%Y%m%d-%H%M%S')))
output.mkdir(parents=True, exist_ok=True)
before = snapshot()
(output/'before.json').write_text(json.dumps(before, indent=2))
try:
    for source, name in [('probe.cjs','probe.cjs'),('inspect.mjs','inspect.mjs')]:
        run('docker','cp',str(scripts/source),container+':/tmp/pal-turn-latency-'+name)
    code = """const fs=require('node:fs');for(const p of fs.readdirSync('/proc')){if(!/^\\d+$/.test(p)||Number(p)===process.pid)continue;try{const c=fs.readFileSync('/proc/'+p+'/cmdline','utf8').split('\\0');if(c.some(x=>x==='dist/main.js'||x==='/opt/pal/dist/main.js')){process.kill(Number(p),'SIGUSR1');console.log(JSON.stringify({attachedPid:Number(p)}));break;}}catch{}}"""
    run('docker','exec',container,'node','-e',code)
    run('docker','exec',container,'node','/tmp/pal-turn-latency-inspect.mjs','attach')
    run('docker','exec',container,'node','/tmp/pal-turn-latency-inspect.mjs','run')
finally:
    run('docker','exec',container,'node','/tmp/pal-turn-latency-inspect.mjs','stop',check=False)
    run('docker','cp',container+':/tmp/pal-turn-latency.jsonl',str(output/'samples.jsonl'),check=False)
    run('docker','exec','--user','0',container,'rm','-f',
        '/tmp/pal-turn-latency-probe.cjs','/tmp/pal-turn-latency-inspect.mjs','/tmp/pal-turn-latency.jsonl')
    after=snapshot()
    (output/'after.json').write_text(json.dumps(after,indent=2))
    print(json.dumps({'reusedTaskUnchanged':before==after}))
    if before!=after:
        raise RuntimeError('Reused Task state changed during read-only benchmark')
