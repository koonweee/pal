import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'src');
const violations = [];

const bootstrapDomOwners = new Set([
  'src/main.tsx',
  'src/theme/ThemeProvider.tsx',
]);
const capabilityOwners = new Set(['src/layout/use-responsive.ts']);
const literalColorOwners = new Set([
  'src/desktop/Desktop.tsx', // noVNC canvas integration
  'src/theme/tokens.ts',
  'src/theme/ThemeProvider.tsx',
]);

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) return files(filename);
    return /\.tsx?$/.test(entry.name) ? [filename] : [];
  });
}

function cssFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = resolve(directory, entry.name);
    if (entry.isDirectory()) return cssFiles(filename);
    return entry.name.endsWith('.css') ? [filename] : [];
  });
}

for (const filename of files(sourceRoot)) {
  const path = relative(root, filename);
  if (path === 'src/api/generated.ts') continue;
  const source = readFileSync(filename, 'utf8');
  const parsed = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  function inspect(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'matchMedia' &&
      !capabilityOwners.has(path)
    ) {
      violations.push(
        `${path}: responsive matchMedia belongs in a shared owner`,
      );
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      node.name.text === 'maxTouchPoints' &&
      !capabilityOwners.has(path)
    ) {
      violations.push(
        `${path}: touch capability reads belong in a shared owner`,
      );
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['getElementById', 'querySelector', 'querySelectorAll'].includes(
        node.expression.name.text,
      ) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'document' &&
      !bootstrapDomOwners.has(path)
    ) {
      violations.push(
        `${path}: React features must use props, state, and refs`,
      );
    }
    if (
      ts.isJsxOpeningLikeElement(node) &&
      ts.isIdentifier(node.tagName) &&
      ['button', 'input', 'select', 'textarea', 'dialog'].includes(
        node.tagName.text,
      )
    ) {
      violations.push(`${path}: controls require a supported UI primitive`);
    }
    ts.forEachChild(node, inspect);
  }
  inspect(parsed);
  if (
    !literalColorOwners.has(path) &&
    /['"`](?:#[\da-f]{3,8}|rgba?\(|hsla?\()/i.test(source)
  )
    violations.push(
      `${path}: literal UI colors belong in semantic theme owners`,
    );
}

for (const filename of cssFiles(sourceRoot)) {
  const path = relative(root, filename);
  const source = readFileSync(filename, 'utf8');
  if (/(?:#[\da-f]{3,8}|rgba?\(|hsla?\()/i.test(source))
    violations.push(`${path}: CSS colors must use semantic theme variables`);

  const hoverMediaStack = [false];
  let blockHeader = '';
  for (const part of source.split(/([{}])/)) {
    if (part === '{') {
      const header = blockHeader.trim();
      const insideHoverMedia = hoverMediaStack.at(-1);
      if (header.includes(':hover') && !insideHoverMedia)
        violations.push(`${path}: hover styles require @media (hover: hover)`);
      hoverMediaStack.push(
        insideHoverMedia || /^@media\s*\(hover:\s*hover\)/.test(header),
      );
      blockHeader = '';
    } else if (part === '}') {
      hoverMediaStack.pop();
      blockHeader = '';
    } else {
      blockHeader += part;
    }
  }
}

if (violations.length) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
} else {
  console.log('UI architecture checks passed.');
}
