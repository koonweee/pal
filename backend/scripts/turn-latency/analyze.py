"""Summarize metadata-only samples; raw requests/responses never leave memory."""
import html
import json
import statistics
import sys
from pathlib import Path

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.local/turn-latency')
rows = [json.loads(line) for line in (root/'samples.jsonl').read_text().splitlines()]
contexts = [r for r in rows if r['event'] == 'context.prepared']
samples = [r for r in rows if r['event'] == 'sample' and not r['warmup']]
summary = []
keys = sorted({(r['model'],r['effort'],r['context']) for r in samples})
for model, effort, context in keys:
    group = [r for r in samples if (r['model'],r['effort'],r['context']) == (model,effort,context)]
    successful = [r for r in group if r.get('completed')]
    result = {'model':model,'effort':effort,'context':context,'samples':len(group),
              'completed':len(successful),'validActions':sum(r.get('validAction',False) for r in group)}
    for field in ['headersMs','firstArgumentsMs','argumentsDoneMs','completedMs','totalMs',
                  'inputTokens','cachedTokens','outputTokens','reasoningTokens','argumentCharacters']:
        values = [r[field] for r in successful if isinstance(r.get(field),(int,float))]
        if values:
            result[field]={'median':statistics.median(values),'min':min(values),'max':max(values)}
    valid = [r['completedMs'] for r in successful if r.get('validAction')]
    if valid:
        result['validActionCompletedMs'] = {'median': statistics.median(valid), 'min': min(valid), 'max': max(valid)}
    summary.append(result)
report = {'contexts':contexts,'groups':summary,
          'unsupported':[r for r in rows if r['event']=='sample' and r['warmup'] and not r.get('completed')],
          'stateUnchanged':json.loads((root/'before.json').read_text()) == json.loads((root/'after.json').read_text())}
(root/'summary.json').write_text(json.dumps(report,indent=2)+'\n')
columns = ['Model','Effort','Context','Valid actions','Headers','First arguments','Arguments complete','Response complete','Input tokens','Cached tokens','Reasoning tokens']
body = []
for group in summary:
    values = [group['model'],group['effort'],group['context'],f"{group['validActions']}/{group['samples']}"]
    for field in ['headersMs','firstArgumentsMs','argumentsDoneMs','completedMs']:
        values.append(f"{group[field]['median']/1000:.2f}s ({group[field]['min']/1000:.2f}–{group[field]['max']/1000:.2f})" if field in group else '—')
    values += [str(group[field]['median']) if field in group else '—' for field in ['inputTokens','cachedTokens','reasoningTokens']]
    body.append('<tr>'+''.join('<td>'+html.escape(v)+'</td>' for v in values)+'</tr>')
page = '''<!doctype html><meta charset="utf-8"><title>Pal Task turn latency</title>
<style>body{font:15px system-ui;margin:32px;color:#222}table{border-collapse:collapse}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}th{background:#f4f4f4}p{max-width:900px}</style>
<h1>Task turn latency</h1><p>Same natural browser-opening prompt, genuine read-only fresh/reused Task contexts, identical tool set. Five interleaved requests per setting; availability warmups excluded. Median (range). No generated tools executed. This measures one model decision, not full login quality or Main routing.</p>'''
page += '<table><thead><tr>'+''.join('<th>'+c+'</th>' for c in columns)+'</tr></thead><tbody>'+''.join(body)+'</tbody></table>'
page += '<p>Existing Task state unchanged: '+str(report['stateUnchanged'])+'. Prompt caching and provider variation remain part of the measurement. Requests, model text, arguments and credentials were never written to the report.</p>'
(root/'comparison.html').write_text(page)
print(json.dumps(report,indent=2))
