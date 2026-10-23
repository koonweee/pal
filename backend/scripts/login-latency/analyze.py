"""Attribute metadata-only synthetic timing; never read prompts or tool arguments."""
import json
import html
import statistics
import sys
from pathlib import Path

root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('.local/login-latency-detailed')
rows = [json.loads(line) for line in (root / 'trace.jsonl').read_text().splitlines()]
driver = [json.loads(line) for line in (root / 'driver.jsonl').read_text().splitlines()]
fixtures = [json.loads(line) for line in (root / 'fixtures.jsonl').read_text().splitlines()]
tag = json.loads((root / 'run-config.json').read_text())['tag']
starts = [x for x in driver if x['event'] == 'scenario.start' and tag in x.get('prompt', '')]
models = {x['id']: x for x in rows if x['event'] == 'model.start'}
executions = {x['executionId']: x.copy() for x in rows if x['event'] == 'tool.execute.start'}
for x in rows:
    if x['event'] in ('tool.execute.end', 'tool.execute.error') and x['executionId'] in executions:
        executions[x['executionId']].update(end=x['at'], durationMs=x['ms'])

# Some dependency paths omit the call ID from execute context. Only correlate a
# top-level execution if exactly one same-tool/thread call has become ready.
ready = [x for x in rows if x['event'] == 'model.arguments.done']
claimed = set()
for x in sorted(executions.values(), key=lambda x: x['at']):
    if x.get('parentExecutionId'):
        continue
    candidates = [p for p in ready if p.get('callId') not in claimed and p.get('name') == x['tool'] and p.get('threadId') == x.get('threadId') and p['at'] <= x['at']]
    if x.get('callId'):
        candidates = [p for p in candidates if p['callId'] == x['callId']]
    if len(candidates) == 1:
        p = candidates[0]
        x.update(callId=p['callId'], modelId=p['id'], readyAt=p['at'], argumentCharacters=p.get('characters'), correlation='native_id' if x.get('callId') else 'sole_pending_tool_and_thread')
        claimed.add(p['callId'])

by_model = {}
for x in rows:
    if x['event'].startswith('model.') and 'id' in x:
        by_model.setdefault(x['id'], {}).setdefault(x['event'], []).append(x)

def metrics(values):
    if not values:
        return None
    return {'count': len(values), 'medianMs': round(statistics.median(values), 1), 'minMs': round(min(values), 1), 'maxMs': round(max(values), 1)}

summary = {'tag': tag, 'scenarios': [], 'calls': [], 'transitions': []}
for case in starts:
    end = next((x for x in driver if x['event'] == 'scenario.end' and x['name'] == case['name'] and x['at'] > case['at']), None)
    if not end:
        continue
    stop = next((x['at'] for x in fixtures if x['event'] == 'fixture.signed_in' and x.get('name') == case['name'] and case['at'] < x['at'] <= end['at']), end['at'])
    inspect = next((x for x in rows if x.get('operation') == 'LoginService.inspect' and case['at'] < x['at'] < stop), None)
    if not inspect:
        continue
    thread = 'pal-task:' + inspect['taskId']
    current = [x for x in executions.values() if not x.get('parentExecutionId') and x.get('threadId') == thread and case['at'] <= x['at'] <= stop]
    total_models = [x for x in rows if x['event'] == 'model.completed' and x['id'] in models and x.get('threadId') == thread and case['at'] <= x['at'] <= stop]
    summary['scenarios'].append({'name': case['name'], 'ok': end['ok'], 'seconds': round((stop-case['at'])/1000, 3), 'modelCalls': len(total_models), 'executions': len(current), 'start': case['at'], 'stop': stop})
    for x in current:
        if 'modelId' not in x:
            summary['calls'].append({'scenario': case['name'], **x, 'uncorrelated': True})
            continue
        m = by_model[x['modelId']]
        complete = m.get('model.completed', [{}])[0].get('at')
        headers = m.get('model.headers', [{}])[0].get('at')
        first_arg = next((a['at'] for a in m.get('model.arguments.first', []) if a.get('callId') == x['callId']), None)
        future = [a['at'] for a in rows if a['event'] == 'model.start' and a.get('threadId') == thread and a['at'] >= x.get('end', float('inf')) and a['at'] < stop]
        next_model = min(future, default=None)
        processors = [a['ms'] for a in rows if a['event'] == 'processor.end' and a.get('threadId') == thread and x.get('end', 0) <= a['at'] <= (next_model or x.get('end', 0))]
        inspection = next((a for a in rows if a.get('event') == 'operation.start' and a.get('operation') == 'LoginService.inspect' and a.get('executionId') == x['executionId']), None)
        call = {'hasInspectionAction': bool(inspection and inspection.get('hasAction')), 'scenario': case['name'], **x, 'modelStartAt': models[x['modelId']]['at'], 'requestToHeadersMs': headers-models[x['modelId']]['at'] if headers else None,
                'headersToFirstArgumentMs': first_arg-headers if first_arg and headers else None,
                'argumentStreamingMs': x['readyAt']-first_arg if first_arg else None,
                'argumentsToCompleteMs': complete-x['readyAt'] if complete else None,
                'readyToExecuteMs': x['at']-x['readyAt'],
                'completeToExecuteMs': x['at']-complete if complete else None,
                'modelRequestMs': complete-models[x['modelId']]['at'] if complete else None,
                'endToNextRequestMs': next_model-x['end'] if next_model and 'end' in x else None,
                'discoveryProcessorMs': sum(processors)}
        summary['calls'].append(call)
    for f in fixtures:
        if f.get('event') != 'fixture.browser' or f.get('name') != case['name'] or f.get('milestone') != 'dom_content_loaded' or f.get('stage') not in ('password', 'verify') or not case['at'] < f['at'] < stop:
            continue
        later = next((x for x in rows if x.get('event') == 'operation.start' and x.get('operation') == 'LoginBrowser.inspect' and x.get('threadId') == thread and f['at'] <= x['at'] <= stop), None)
        earlier = next((x for x in reversed(fixtures) if x.get('event') == 'fixture.browser' and x.get('name') == case['name'] and x.get('milestone') == 'submit_handler' and x['at'] < f['at']), None)
        inspect_end = next((x for x in rows if later and x.get('event') == 'operation.end' and x.get('id') == later['id']), None)
        chosen = next((x for x in summary['calls'] if later and x['scenario'] == case['name'] and x['tool'] in ('login_inspect', 'secure_fill') and x['at'] <= later['at'] <= x.get('end', later['at'])), None)
        summary['transitions'].append({'scenario': case['name'], 'stage': f['stage'], 'readyAt': f['at'], 'submitToDomReadyMs': f['at']-earlier['at'] if earlier else None, 'domReadyToInspectionStartMs': later['at']-f['at'] if later else None, 'inspectionDurationMs': inspect_end['ms'] if inspect_end else None, 'inspectionModelRequestMs': chosen.get('modelRequestMs') if chosen else None, 'combinedAction': chosen.get('hasInspectionAction', False) if chosen else False})

valid = [x for x in summary['calls'] if not x.get('uncorrelated')]
summary['metrics'] = {key: metrics([x[key] for x in valid if x.get(key) is not None]) for key in ['requestToHeadersMs', 'headersToFirstArgumentMs', 'argumentStreamingMs', 'argumentsToCompleteMs', 'readyToExecuteMs', 'completeToExecuteMs', 'modelRequestMs', 'durationMs', 'endToNextRequestMs', 'discoveryProcessorMs']}
summary['uncorrelatedExecutions'] = sum(x.get('uncorrelated', False) for x in summary['calls'])
(root / 'detailed-summary.json').write_text(json.dumps(summary, indent=2))
print(json.dumps({k:v for k,v in summary.items() if k != 'calls'}, indent=2))

# Export an inspectable trace and a standalone interactive report.
trace = []
for call in valid:
    a = call['modelStartAt']
    header = a + call['requestToHeadersMs']
    first = call['readyAt'] - call['argumentStreamingMs']
    phases = [('Request to headers', a, header), ('Headers to arguments', header, first),
              ('Argument streaming', first, call['readyAt']), ('Dispatch', call['readyAt'], call['at']),
              ('Tool execution', call['at'], call.get('end', call['at']))]
    for name, begin, end in phases:
        trace.append({'name': call['tool'] + ': ' + name, 'cat': name, 'ph': 'X', 'ts': begin*1000,
                      'dur': (end-begin)*1000, 'pid': 1, 'tid': call['scenario'],
                      'args': {'callId': call['callId'], 'correlation': call['correlation']}})
for event in fixtures:
    if event['event'] == 'fixture.browser':
        trace.append({'name': event['stage'] + ': ' + event['milestone'], 'cat': 'Browser', 'ph': 'i',
                      's': 't', 'ts': event['at']*1000, 'pid': 2, 'tid': event['name']})
(root / 'detailed-chrome-trace.json').write_text(json.dumps({'traceEvents': trace}))

def table(headers, values):
    return '<table><thead><tr>' + ''.join('<th>'+html.escape(str(x))+'</th>' for x in headers) + '</tr></thead><tbody>' + ''.join('<tr>'+''.join('<td>'+html.escape(str(x))+'</td>' for x in row)+'</tr>' for row in values)+'</tbody></table>'

body = '<h1>Pal detailed login traces</h1><p>Actual dev agent · synthetic sites · metadata only. Durations are milliseconds unless marked seconds.</p>'
body += table(['Boundary', 'Median', 'Maximum'], [[k, v['medianMs'], v['maxMs']] for k,v in summary['metrics'].items() if v])
body += '<p>Each bar shows phase fractions of one call: request → response headers → arguments → dispatch → tool execution. Hover for phase timing. Medians across different calls are not additive.</p><label>Scenario <select id="filter"><option value="all">All</option>' + ''.join('<option>'+x['name']+'</option>' for x in summary['scenarios']) + '</select></label>'
colors = ['#7388c4', '#5c72b7', '#364f99', '#d69a40', '#26836c']
for case in summary['scenarios']:
    body += '<section data-case="'+case['name']+'"><h2>'+case['name'].title()+' · '+str(case['seconds'])+' seconds</h2>'
    for call in valid:
        if call['scenario'] != case['name']:
            continue
        a = call['modelStartAt']; head = a+call['requestToHeadersMs']; first = call['readyAt']-call['argumentStreamingMs']
        parts = [('Headers', a, head), ('Before arguments', head, first), ('Arguments', first, call['readyAt']), ('Dispatch', call['readyAt'], call['at']), ('Execution', call['at'], call.get('end',call['at']))]
        duration = max(1, call.get('end',call['at'])-a)
        body += '<div class="row"><span>'+html.escape(call['tool'])+'</span><div class="track">'
        for (label,begin,end),color in zip(parts,colors):
            body += '<span class="bar" style="background:'+color+';left:'+str((begin-a)/duration*100)+'%;width:'+str((end-begin)/duration*100)+'%" title="'+label+': '+str(end-begin)+'ms"></span>'
        body += '</div><span>'+str(round(duration/1000,2))+'s</span></div>'
    transitions = [x for x in summary['transitions'] if x['scenario'] == case['name']]
    if transitions:
        body += '<h3>Page readiness</h3>' + table(['New page', 'Submit → DOM ready', 'Ready → field scan starts', 'Field scan', 'Inspection model request'], [[x['stage'],x['submitToDomReadyMs'],x['domReadyToInspectionStartMs'],x['inspectionDurationMs'],x['inspectionModelRequestMs']] for x in transitions])
    body += '</section>'
body += '<p>One sample per scenario. Fixture pages have no intentional network delay. Dispatch measures complete provider arguments to actual Tool.execute invocation. Matching uses native call IDs where available; the fallback requires a single pending call with the same thread/tool. Uncorrelated executions: '+str(summary['uncorrelatedExecutions'])+'. End-to-next-request intervals can include user waiting; they are not all harness processing.</p><p><a href="detailed-summary.json">Full numeric report</a> · <a href="detailed-chrome-trace.json">Chrome/Perfetto trace</a></p>'
(root / 'detailed.html').write_text('<!doctype html><html><meta charset="utf-8"><title>Pal detailed traces</title><style>body{font:15px system-ui;color:#18212b;background:#fafafa;max-width:1050px;margin:30px auto;padding:0 20px}p{line-height:1.5}table{border-collapse:collapse;width:100%;font-size:13px}td,th{text-align:left;padding:8px;border-bottom:1px solid #ddd}section{background:white;border:1px solid #ddd;border-radius:10px;margin:24px 0;padding:18px}.row{display:grid;grid-template-columns:175px 1fr 60px;gap:10px;margin:8px 0;font-size:12px}.track{position:relative;background:#eee;min-height:18px}.bar{position:absolute;top:0;height:18px;min-width:1px}select{font:inherit;padding:6px}@media(max-width:650px){section{overflow:auto}.row{min-width:650px}table{min-width:650px}}</style>'+body+'<script>document.getElementById("filter").onchange=e=>document.querySelectorAll("section").forEach(s=>s.hidden=e.target.value!=="all"&&s.dataset.case!==e.target.value)</script></html>')

if summary['uncorrelatedExecutions'] or len(summary['scenarios']) != 3 or not all(x['ok'] for x in summary['scenarios']):
    raise SystemExit('Detailed trace is incomplete; inspect the report before using its estimates')
