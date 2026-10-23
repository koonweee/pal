"""Install the temporary injector into the default running dev agent."""
import subprocess
from pathlib import Path

name = 'pal-dev-split-agent-service-1'
root = Path(__file__).resolve().parent
out = Path('.local/login-latency-detailed')
out.mkdir(parents=True, exist_ok=True)
source = (root / 'capture.mjs').read_text()
# Inspector evaluations lack a dynamic-import callback. A CJS async module has
# its own loader and imports the same cached application modules normally.
for module, binding in [('node:fs', 'appendFileSync, readFileSync'), ('node:crypto', 'randomUUID')]:
    source = source.replace(f"import {{ {binding} }} from '{module}';", f"const {{ {binding} }} = require('{module}');")
(out / 'capture.cjs').write_text('module.exports = (async()=>{\n' + source + '\nreturn {ready:true};})();\n')
subprocess.run(['docker', 'cp', str(out / 'capture.cjs'), name + ':/tmp/pal-login-latency-capture.cjs'], check=True)
subprocess.run(['docker', 'cp', str(root / 'inspector.mjs'), name + ':/tmp/pal-login-latency-inspector.mjs'], check=True)
# Enable Node's loopback-only diagnostic endpoint in the existing process.
code = """import{readdirSync,readFileSync}from'node:fs';
for(const p of readdirSync('/proc')){
 if(!/^\\d+$/.test(p)||Number(p)===process.pid)continue;
 try{const c=readFileSync('/proc/'+p+'/cmdline','utf8').split('\\0');
 if(c.some(x=>x==='dist/main.js'||x==='/opt/pal/dist/main.js')){
 process.kill(Number(p),'SIGUSR1');console.log(JSON.stringify({attachedPid:Number(p)}));break;}
 }catch{}
}"""
subprocess.run(['docker', 'exec', name, 'node', '--input-type=module', '-e', code], check=True)
expression = "const require=process.getBuiltinModule('module').createRequire('/opt/pal/package.json');const path='/tmp/pal-login-latency-capture.cjs';delete require.cache[require.resolve(path)];return await require(path);"
subprocess.run(['docker', 'exec', name, 'node', '/tmp/pal-login-latency-inspector.mjs', expression], check=True)
