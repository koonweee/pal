import { citationMiddleware } from './citations.js';
import { createOpenAI } from '@ai-sdk/openai';
import { wrapLanguageModel } from 'ai';
import { AuthStorage } from '@mastra/code-sdk/auth/storage';
import { buildOpenAICodexOAuthFetch } from '@mastra/code-sdk/providers/openai-codex';

export function chatgptModel(
  modelId: string,
  authPath: string,
  thinkingEffort = 'medium',
): ReturnType<typeof wrapLanguageModel> {
  const auth = new AuthStorage(authPath);
  const provider = createOpenAI({
    apiKey: 'chatgpt-oauth',
    fetch: buildOpenAICodexOAuthFetch({ authStorage: auth }),
  });
  return wrapLanguageModel({
    model: provider.responses(modelId),
    middleware: [
      citationMiddleware,
      {
        specificationVersion: 'v3',
        async transformParams({ params }) {
          // The subscription endpoint requires instructions and store:false.
          // Preserve each caller's instructions, including the observer/reflector.
          const instructions = params.prompt
            .filter((message) => message.role === 'system')
            .map((message) => message.content)
            .join('\n\n');
          return {
            ...params,
            prompt: params.prompt.filter(
              (message) => message.role !== 'system',
            ),
            providerOptions: {
              ...params.providerOptions,
              openai: {
                ...params.providerOptions?.openai,
                instructions,
                store: false,
                reasoningEffort: thinkingEffort,
              },
            },
          };
        },
      },
    ],
  });
}
