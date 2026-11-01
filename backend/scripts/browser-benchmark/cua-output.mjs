// Mastra's structured MCP default currently keeps only text. Preserve the native
// observation refs and image blocks together for computer-use models.
export function cuaModelOutput(output) {
  const blocks =
    output?.[Symbol.for('mastra.mcp.callToolContent')] ?? output?.content ?? [];
  const { content: _content, ...structured } = output ?? {};
  return {
    type: 'content',
    value: [
      {
        type: 'text',
        text: JSON.stringify({
          ...structured,
          ...(blocks.some((b) => b.type === 'text')
            ? {
                text: blocks
                  .filter((b) => b.type === 'text')
                  .map((b) => b.text)
                  .join('\n'),
              }
            : {}),
        }),
      },
      ...blocks
        .filter((b) => b.type === 'image')
        .map((b) => ({ type: 'media', data: b.data, mediaType: b.mimeType })),
    ],
  };
}
