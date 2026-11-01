import type { Processor } from '@mastra/core/processors';

// Model-output filtering alone leaves nested worker payloads in Task history.
export const compactWorkerResultProcessor = {
  id: 'pal-compact-worker-result',
  processToolResult({ toolName, toolCallId, args, result, messageList }) {
    if (
      toolName !== 'agent-worker' ||
      !result ||
      typeof result !== 'object' ||
      !('subAgentToolResults' in result)
    )
      return;
    const compact = { ...result };
    delete compact.subAgentToolResults;
    messageList.updateToolInvocation({
      type: 'tool-invocation',
      toolInvocation: {
        state: 'result',
        toolName,
        toolCallId,
        args,
        result: compact,
      },
    });
    return messageList;
  },
} satisfies Processor;
