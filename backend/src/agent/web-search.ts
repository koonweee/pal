import type { ToolsInput } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';

export function webSearchTool(): ToolsInput[string] {
  const tool = openai.tools.webSearch({ externalWebAccess: true });
  // AI SDK types include local tools; Mastra requires a provider tool's ID.
  if (!('id' in tool) || typeof tool.id !== 'string')
    throw new Error('OpenAI web search must be a provider tool');
  return tool;
}
