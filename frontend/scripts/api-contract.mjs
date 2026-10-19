import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import openapiTS, { astToString } from 'openapi-typescript';
import prettier from 'prettier';

const schema = new URL(
  '../../backend/openapi/first-party-v1.json',
  import.meta.url,
);
const document = JSON.parse(await readFile(schema, 'utf8'));
const output = fileURLToPath(
  new URL('../src/api/generated.ts', import.meta.url),
);
const versionOutput = fileURLToPath(
  new URL('../src/api/contract.ts', import.meta.url),
);
const prettierConfig = (await prettier.resolveConfig(output)) ?? {};
const rendered = await prettier.format(astToString(await openapiTS(schema)), {
  ...prettierConfig,
  parser: 'typescript',
});
const contractVersion = Number(document.info?.version);
if (!Number.isSafeInteger(contractVersion) || contractVersion < 1)
  throw new Error('OpenAPI info.version must be a positive contract integer.');
const renderedVersion = await prettier.format(
  `// Generated from backend/openapi/first-party-v1.json.\nexport const FIRST_PARTY_CONTRACT_VERSION = ${contractVersion} as const;\n`,
  { ...prettierConfig, parser: 'typescript' },
);

if (process.argv[2] === 'check') {
  const current = await readFile(output, 'utf8');
  const currentVersion = await readFile(versionOutput, 'utf8');
  if (current !== rendered || currentVersion !== renderedVersion) {
    console.error('src/api/generated.ts is stale; run npm run api:generate.');
    process.exitCode = 1;
  }
} else {
  await writeFile(output, rendered);
  await writeFile(versionOutput, renderedVersion);
}
