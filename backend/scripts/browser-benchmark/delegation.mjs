// Benchmark-only Task boundaries. Workers always receive explicit assignments.
export const delegationVariants = ['coordinator', 'services', 'execution'].map(
  (boundary) => ({
    id: `luna-${boundary}`,
    model: 'gpt-6-luna',
    effort: 'high',
    delegated: true,
    boundary,
  }),
);
delegationVariants.push({
  ...delegationVariants[0],
  id: 'luna-coordinator-both',
  generalModel: 'gpt-6-luna',
  generalEffort: 'high',
});
export function taskToolAllowed(boundary, name) {
  if (/^(browser|login_|secure_|skill)|mastra_workspace_computer_/.test(name))
    return false;
  if (boundary === 'coordinator')
    return !/^(web_search|search_tools|execute_typescript|mastra_workspace_)/.test(
      name,
    );
  if (boundary === 'services' && name.startsWith('mastra_workspace_'))
    return name === 'mastra_workspace_read_file';
  return true;
}
export function delegationGuidance({
  boundary,
  generalModel = 'gpt-6.1-sol',
  generalEffort = 'medium',
}) {
  return `
## Worker assignments
Delegate all browser, computer, website authentication and page verification to agent-worker (Luna high). Use agent-general (${generalModel === 'gpt-6-luna' ? 'Luna' : 'Sol'} ${generalEffort}) for non-interaction research, file processing or other substantial independent work. Both workers receive only your explicit assignment. Include relevant facts, constraints, URLs, file references, requested interaction method and required evidence. Own planning, user communication, synthesis, task metadata and schedules. Keep each complete browser workflow in the interaction worker. General workers have no browser, computer or login tools. Do not operate websites through shell or service tools.
${boundary === 'coordinator' ? 'You have no execution, file-reading, search or service tools. Delegate execution to the appropriate worker.' : boundary === 'services' ? 'You can read files, search the public web and discover service/MCP tools. Delegate shell and file transformations to agent-general.' : 'You retain shell, file processing, web search and service/MCP tools for non-interaction work.'}`;
}

export function validBoundaries(variant, boundaries) {
  if (!variant.delegated) return true;
  const interactionName = (name) =>
    /^(browser|login_|secure_|mastra_workspace_|execute_typescript|skill)/.test(
      name,
    );
  return (
    boundaries
      .filter((e) => e.role === 'task')
      .every((e) =>
        variant.boundary
          ? e.tools.every((name) => taskToolAllowed(variant.boundary, name))
          : !e.tools.some(interactionName),
      ) &&
    boundaries.some((e) => e.role === 'worker') &&
    boundaries
      .filter((e) => e.role === 'general')
      .every(
        (e) =>
          !e.tools.some((name) =>
            /^(browser|login_|secure_|skill)|mastra_workspace_computer_/.test(
              name,
            ),
          ),
      )
  );
}
