"""API-equivalent Standard short-context estimates from measured OAuth usage."""
import json, sys, statistics
from pathlib import Path
RATES={'gpt-6.1-sol':(2,.1,10),'gpt-6-luna':(.1,.01,.5),'gpt-6-astra':(10,1,50)}
SOURCE='https://developers.openai.com/api/docs/pricing?latest-pricing-expanded=true'
def cost(row):
    low=high=0
    for role,u in row['roleUsage'].items():
        if not u['requests']: continue
        model=row['taskModel'] if role=='task' else row['generalModel'] if role=='general' else row['workerModel']
        i,c,o=RATES[model]
        ordinary=u['inputTokens']-u['cachedTokens']
        low+=(ordinary*i+u['cachedTokens']*c+u['outputTokens']*o)/1e6
        high+=(ordinary*i*1.25+u['cachedTokens']*c+u['outputTokens']*o)/1e6
    return low,high
allrows=[]
for arg in sys.argv[1:]:
    p=Path(arg)
    rows=json.loads((p/'summary.json').read_text())['samples']
    events=[json.loads(line) for line in (p/'trace.jsonl').open() if line.strip()]
    assert max((e.get('inputTokens') or 0 for e in events),default=0)<=272000, 'Long-context requests require per-request pricing'
    assert len(rows)==len({r['key'] for r in rows})
    allrows.extend(dict(r,dataset=str(p)) for r in rows)
result={'pricingSource':SOURCE,'ratesVerifiedAt':'2026-10-24','ratesPerMillionInputCachedOutput':RATES,'basis':'API-equivalent Standard short-context model inference, not actual ChatGPT subscription charges. Task plus interaction worker plus general worker. Setup/probes and infrastructure excluded. Output already includes reasoning.','uncertainty':'Trace does not retain cache-write counts. Range assumes none versus all noncached input charged at default 30-minute write rate (1.25x); 12-hour caching would cost more. Incomplete-usage samples excluded from cost means, retained in accuracy and latency.','groups':[]}
for v in dict.fromkeys(r['variant'] for r in allrows):
    for kind in ['synthetic','live']:
        rows=[r for r in allrows if r['variant']==v and (r['kind']=='synthetic')==(kind=='synthetic')]
        if not rows: continue
        measured=[r for r in rows if r['usageComplete']]
        amounts=[cost(r) for r in measured]
        result['groups'].append({'variant':v,'kind':kind,'n':len(rows),'passed':sum(r['success'] is True for r in rows),'failed':sum(r['success'] is False for r in rows),'pendingReview':sum(r['success'] is None for r in rows),'meanSeconds':statistics.mean(r['elapsedMs'] for r in rows)/1000,'measuredCostSamples':len(measured),'incompleteUsageSamples':len(rows)-len(measured),'meanUsdRange':[statistics.mean(x[i] for x in amounts) for i in [0,1]] if amounts else None,'datasets':sorted({r['dataset'] for r in rows})})
print(json.dumps(result,indent=2))
