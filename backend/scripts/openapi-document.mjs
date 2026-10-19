export function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableJson(entry)]),
    );
  return value;
}

export async function renderedDocument() {
  const { createFirstPartyOpenApiDocument } =
    await import('../dist/adapters/first-party/openapi-document.js');
  return `${JSON.stringify(stableJson(await createFirstPartyOpenApiDocument()), null, 2)}\n`;
}
