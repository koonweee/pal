import { ToolCallFilter } from '@mastra/core/processors';
import { WORKSPACE_TOOLS } from '@mastra/core/workspace';

const visualToolNames = [
  ...Object.values(WORKSPACE_TOOLS.COMPUTER),
  'android_inspect',
  'android_screenshot',
  'inspect_private_fields',
];

/** Keep recent visual state actionable without replaying every prior image. */
export function interactionHistoryProcessor(
  additionalVisualTools: string[] = [],
) {
  return new ToolCallFilter({
    exclude: [...visualToolNames, ...additionalVisualTools],
    filterAfterToolSteps: 2,
  });
}
