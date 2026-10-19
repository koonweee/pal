// Fallback from the Codex model catalog inspected 2026-10-07. Keep this keyed
// to the exact model; an explicit limit overrides it for other deployments.
export const modelContextWindows: Record<string, number> = {
  'gpt-6.1-sol': 272000,
};

export function catalogDiagnostics(
  instructions: string,
  model: string,
  toolCount: number,
  contextWindowTokens: number | undefined,
  warnPercent: number,
) {
  const configuredLimit = contextWindowTokens;
  contextWindowTokens ??= modelContextWindows[model];
  const estimatedTokens = Math.ceil(instructions.length / 4);
  const percent = contextWindowTokens
    ? (estimatedTokens / contextWindowTokens) * 100
    : null;
  return {
    model,
    toolCount,
    estimatedTokens,
    estimation: 'characters / 4',
    contextWindowTokens: contextWindowTokens ?? null,
    contextWindowSource: configuredLimit
      ? 'configured'
      : contextWindowTokens
        ? 'Codex catalog fallback (2026-10-07)'
        : 'unknown',
    percent,
    warnPercent,
    warning: percent !== null && percent > warnPercent,
  };
}
