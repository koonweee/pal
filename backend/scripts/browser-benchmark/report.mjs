import { cases, score } from './cases.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const finiteRange = (values, pick) => {
  const finite = values.filter(Number.isFinite);
  return finite.length ? pick(...finite) : null;
};
const median = (values) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length
    ? (sorted[Math.floor((sorted.length - 1) / 2)] +
        sorted[Math.floor(sorted.length / 2)]) /
        2
    : null;
};
export function summarize(results, traces) {
  const samples = results.map((row) => {
    const events = traces.filter((e) => e.sample === row.sample);
    const roleUsage = {};
    for (const role of ['task', 'worker', ...(row.generalModel ? ['general'] : [])]) {
      const starts = events.filter(
        (e) => e.event === 'model.start' && e.role === role,
      );
      const finishes = events.filter(
        (e) => e.event === 'model.finish' && e.role === role,
      );
      roleUsage[role] = {
        requests: starts.length,
        measuredRequests: finishes.filter((e) => Number.isFinite(e.inputTokens))
          .length,
        modelMs: finishes.reduce((n, e) => n + e.ms, 0),
      };
      for (const key of [
        'inputTokens',
        'cachedTokens',
        'outputTokens',
        'reasoningTokens',
      ])
        roleUsage[role][key] = finishes.some((e) => Number.isFinite(e[key]))
          ? finishes.reduce((n, e) => n + (e[key] ?? 0), 0)
          : starts.length
            ? null
            : 0;
      roleUsage[role].observedUsage = Object.fromEntries(
        ['inputTokens', 'cachedTokens', 'outputTokens', 'reasoningTokens'].map(
          (key) => [key, roleUsage[role][key]],
        ),
      );
      if (roleUsage[role].requests !== roleUsage[role].measuredRequests)
        for (const key of [
          'inputTokens',
          'cachedTokens',
          'outputTokens',
          'reasoningTokens',
        ])
          roleUsage[role][key] = null;
      roleUsage[role].initialInputCharacters =
        starts[0]?.inputCharacters ?? null;
      roleUsage[role].toolErrors = events.filter(
        (e) => e.role === role && (e.event === 'tool.error' || e.resultError),
      ).length;
      roleUsage[role].toolCalls = events.filter(
        (e) => e.event === 'tool.start' && e.role === role,
      ).length;
      roleUsage[role].toolMs = events
        .filter((e) => e.event === 'tool.end' && e.role === role)
        .reduce((n, e) => n + e.ms, 0);
    }
    const usageComplete = Object.values(roleUsage).every(
      (r) => r.requests === r.measuredRequests,
    );
    const total = (key) =>
      Object.values(roleUsage).some((r) => r[key] === null)
        ? null
        : Object.values(roleUsage).reduce((n, r) => n + r[key], 0);
    return {
      ...row,
      roleUsage,
      evidenceCaptureMs: events
        .filter((e) => e.event === 'evidence.capture')
        .reduce((sum, e) => sum + e.ms, 0),
      usageComplete,
      inputTokens: total('inputTokens'),
      cachedTokens: total('cachedTokens'),
      outputTokens: total('outputTokens'),
      reasoningTokens: total('reasoningTokens'),
      modelRequests: total('requests'),
    };
  });
  const groups = [];
  for (const key of new Set(
    samples.map((r) => [r.case, r.context, r.variant].join('/')),
  )) {
    const group = samples.filter(
      (r) => [r.case, r.context, r.variant].join('/') === key,
    );
    const measured = group.filter((r) => r.status !== 'unsupported');
    groups.push({
      key,
      samples: group.length,
      unsupported: group.length - measured.length,
      passed: measured.filter((r) => r.success === true).length,
      failed: measured.filter((r) => r.success === false).length,
      pendingReview: measured.filter((r) => r.success === null).length,
      medianMs: median(measured.map((r) => r.elapsedMs)),
      minMs: finiteRange(
        measured.map((r) => r.elapsedMs),
        Math.min,
      ),
      maxMs: finiteRange(
        measured.map((r) => r.elapsedMs),
        Math.max,
      ),
      successfulMedianMs: median(
        measured.filter((r) => r.success === true).map((r) => r.elapsedMs),
      ),
      medianInputTokens: median(measured.map((r) => r.inputTokens)),
      medianOutputTokens: median(measured.map((r) => r.outputTokens)),
      medianCachedTokens: median(measured.map((r) => r.cachedTokens)),
      medianReasoningTokens: median(measured.map((r) => r.reasoningTokens)),
      incompleteUsage: measured.filter((r) => !r.usageComplete).length,
    });
  }
  return { samples, groups };
}
const escape = (value) =>
  String(value ?? '—')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;');
export function render(summary) {
  const seconds = (ms) => (ms == null ? '—' : (ms / 1000).toFixed(1));
  return `<!doctype html><meta charset="utf-8"><title>Pal browser worker benchmark</title><style>body{font:15px system-ui;margin:32px;color:#17283b}table{border-collapse:collapse;width:100%}td,th{padding:10px;text-align:left;border-bottom:1px solid #ddd}th{background:#eef2f6}pre{white-space:pre-wrap}details{margin:14px 0}p{max-width:1000px}</style><h1>Pal browser worker benchmark</h1><p>Task remains Sol medium. Worker history contains only its handoff. Results include parent planning and synthesis. Raw synthetic history is fixed; observational memory is disabled. Live answers require review. Token totals include failed attempts when provider usage is available; missing usage is flagged. Reasoning and cached tokens are subsets, not additional totals. Model/tool durations can overlap and must not be added to elapsed time.</p><table><thead><tr><th>Case / context / variant</th><th>Pass / fail / review / unsupported</th><th>Median seconds (all)</th><th>Range seconds</th><th>Median seconds (passed)</th><th>Input tokens</th><th>Output tokens</th><th>Cached input</th><th>Reasoning output</th><th>Missing usage runs</th></tr></thead><tbody>${summary.groups.map((g) => `<tr><td>${escape(g.key)}</td><td>${g.passed} / ${g.failed} / ${g.pendingReview} / ${g.unsupported}</td><td>${seconds(g.medianMs)}</td><td>${seconds(g.minMs)}–${seconds(g.maxMs)}</td><td>${seconds(g.successfulMedianMs)}</td><td>${escape(g.medianInputTokens)}</td><td>${escape(g.medianOutputTokens)}</td><td>${escape(g.medianCachedTokens)}</td><td>${escape(g.medianReasoningTokens)}</td><td>${g.incompleteUsage}</td></tr>`).join('')}</tbody></table><h2>Evidence and role breakdown</h2>${summary.samples.map((s) => `<details><summary>${escape(s.key)} — ${escape(s.status)} — ${s.success === null ? 'review required' : s.success ? 'pass' : 'fail'}</summary><pre>${escape(JSON.stringify(s, null, 2))}</pre></details>`).join('')}`;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const dir = process.argv[2];
  const read = (name) =>
    readFileSync(dir + '/' + name, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
  let reviews = {};
  try {
    reviews = JSON.parse(readFileSync(dir + '/reviews.json', 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const traces = read('trace.jsonl');
  const results = read('results.jsonl').map((record) => {
    let row = record;
    if (process.argv.includes('--rescore') && row.websiteState) {
      const scenario = cases.find((c) => c.id === row.case);
      const tools = traces
        .filter((e) => e.sample === row.sample && e.event === 'tool.start')
        .map((e) => e.tool);
      const grading = score(scenario, row.websiteState, row.answer, tools);
      row = {
        ...row,
        originalChecks: row.checks,
        originalSuccess: row.success,
        ...grading,
        success:
          row.status === 'completed' && row.boundaryValid
            ? grading.success
            : false,
      };
    }
    const review = reviews[row.sample];
    if (!review) return row;
    if (
      row.kind !== 'live' ||
      typeof review.passed !== 'boolean' ||
      typeof review.note !== 'string' ||
      !review.note.trim()
    )
      throw Error(
        'Reviews require a live sample ID, passed boolean and evidence note',
      );
    return {
      ...row,
      humanReview: review,
      success: row.status === 'completed' && row.boundaryValid && review.passed,
    };
  });
  const summary = summarize(results, traces);
  if (process.argv.includes('--rescore'))
    summary.scoringSourceHash = createHash('sha256')
      .update(readFileSync(new URL('./cases.mjs', import.meta.url)))
      .digest('hex');
  writeFileSync(dir + '/summary.json', JSON.stringify(summary, null, 2));
  writeFileSync(dir + '/report.html', render(summary));
  console.log(
    JSON.stringify({
      samples: summary.samples.length,
      groups: summary.groups.length,
      report: dir + '/report.html',
    }),
  );
}
