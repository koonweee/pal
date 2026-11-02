export function validComparisonInventory(arm, role, names) {
  if (role === 'task') return names.every((name) => name === 'agent-worker');
  return names.every(
    (name) =>
      /^(inspect_private_fields|enter_private_fields|confirm_authentication)/.test(
        name,
      ) ||
      ['skill', 'skill_read', 'skill_search'].includes(name) ||
      (arm === 'browser' && /^browser(?:_|$)/.test(name)) ||
      (arm === 'android' && /^android_/.test(name)) ||
      (arm === 'computer' && /^mastra_workspace_computer_/.test(name)),
  );
}
export function assistedQueue(rows) {
  return rows
    .filter((row) => row.needsHuman || row.reviewRequired)
    .map((row) => ({
      key: row.key,
      case: row.case,
      arm: row.variant,
      round: row.round,
      sample: row.sample,
      action: row.reviewRequired ? 'review-captured-live-evidence' : row.reason,
      timing: 'after-main-run',
    }));
}
