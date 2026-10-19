import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import assert from 'node:assert/strict';

/**
 * Architecture lint invoked by `npm run lint`.
 *
 * It scans ordinary static TypeScript imports/exports and file placement for
 * the adapter boundaries that Oxlint cannot express with the repository's
 * current configuration. Representative assertions below keep the focused
 * rules honest. This is a maintenance guard against accidental dependencies,
 * not a parser, module loader, or security boundary.
 */

const sourceRoot = resolve('src');
const adaptersRoot = 'adapters/';

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) => {
        const path = resolve(directory, entry.name);
        return entry.isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
      }),
    )
  ).flat();
}

function imports(source) {
  return [...source.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^'";]+?\s+from\s+)?['"]([^'"]+)['"]/g)]
    .map((match) => match[1]);
}

/** Returns boundary violations for one source file and its import specifiers. */
export function boundaryViolations(path, specifiers) {
  const normalized = path.split(sep).join('/');
  const inAdapter = normalized.startsWith(adaptersRoot);
  const compositionRoot = normalized === 'app.module.ts';
  const violations = [];
  if (!inAdapter && /(?:^|\/)adapters\//.test(normalized))
    throw new Error('Path normalization failed');
  if (!inAdapter && (normalized.endsWith('.controller.ts') || normalized.endsWith('.dto.ts')))
    violations.push('transport controller/DTO must live under adapters/');
  for (const specifier of specifiers) {
    if (
      !inAdapter &&
      !compositionRoot &&
      (specifier.includes('/adapters/') || specifier.startsWith('../adapters'))
    )
      violations.push(`core imports adapter: ${specifier}`);
    if (!inAdapter && ['express', 'busboy', 'content-disposition'].includes(specifier))
      violations.push(`core imports client protocol package: ${specifier}`);
    if (normalized.startsWith('application/contracts/')) {
      if (
        specifier.startsWith('@nestjs/') ||
        specifier === 'express' ||
        specifier.includes('/database/') ||
        specifier.includes('.repository') ||
        specifier.includes('/agent/') ||
        specifier.includes('/adapters/')
      )
        violations.push(`application contract imports implementation: ${specifier}`);
    }
    if (
      normalized.startsWith('adapters/telegram/') &&
      (specifier.includes('.repository') || specifier.includes('/database/'))
    )
      violations.push(`Telegram driver imports persistence implementation: ${specifier}`);
    if (
      normalized.startsWith('adapters/first-party/') &&
      (specifier.includes('.repository') ||
        specifier.includes('/database/') ||
        specifier.includes('mastra-agent-runtime'))
    )
      violations.push(`first-party adapter bypasses application service: ${specifier}`);
    if (
      normalized.startsWith('adapters/secondary/') &&
      normalized.endsWith('.repository.ts') &&
      /\/database\/schema(?:\.js)?$/.test(specifier)
    )
      violations.push(`secondary repository queries core schema: ${specifier}`);
  }
  return violations;
}

assert.deepEqual(
  boundaryViolations('chat/example.ts', ['../adapters/first-party/api.js']),
  ['core imports adapter: ../adapters/first-party/api.js'],
);
assert.deepEqual(boundaryViolations('application/contracts/example.ts', ['@nestjs/common']), [
  'application contract imports implementation: @nestjs/common',
]);
assert.deepEqual(
  boundaryViolations('adapters/telegram/driver.ts', ['../../chat/chat.repository.js']),
  ['Telegram driver imports persistence implementation: ../../chat/chat.repository.js'],
);
assert.deepEqual(
  boundaryViolations('adapters/first-party/api.ts', ['../../tasks/tasks.repository.js']),
  ['first-party adapter bypasses application service: ../../tasks/tasks.repository.js'],
);
assert.deepEqual(
  boundaryViolations('adapters/secondary/example.repository.ts', [
    '../../database/schema.js',
  ]),
  ['secondary repository queries core schema: ../../database/schema.js'],
);

const violations = [];
for (const absolute of await files(sourceRoot)) {
  const path = relative(sourceRoot, absolute).split(sep).join('/');
  const source = await readFile(absolute, 'utf8');
  if (
    !path.startsWith(adaptersRoot) &&
    /\b(?:BadRequestException|NotFoundException|ConflictException|ServiceUnavailableException|HttpException|ForbiddenException|UnauthorizedException)\b/.test(
      source,
    )
  )
    violations.push(`${path}: core exposes an HTTP exception`);
  for (const reason of boundaryViolations(path, imports(source)))
    violations.push(`${path}: ${reason}`);
}
if (violations.length) {
  process.stderr.write(violations.join('\n') + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('Adapter boundaries verified.\n');
}
