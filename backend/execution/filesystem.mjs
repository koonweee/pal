import { LocalFilesystem } from '@mastra/core/workspace';

const filesystem = new LocalFilesystem({
  basePath: '/home/pal',
  contained: true,
});
const methods = new Set([
  'readFile',
  'writeFile',
  'appendFile',
  'deleteFile',
  'copyFile',
  'moveFile',
  'mkdir',
  'rmdir',
  'readdir',
  'exists',
  'stat',
  'realpath',
]);
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 40_000_000)
    throw new Error('File operation exceeds limit');
}
try {
  const { method, args } = JSON.parse(input);
  if (!methods.has(method) || !Array.isArray(args))
    throw new Error('Invalid file operation');
  if (method === 'writeFile' || method === 'appendFile')
    args[1] = Buffer.from(args[1].base64, 'base64');
  if (method === 'writeFile' && args[2]?.expectedMtime)
    args[2].expectedMtime = new Date(args[2].expectedMtime);
  let value = await filesystem[method](...args);
  if (Buffer.isBuffer(value)) value = { base64: value.toString('base64') };
  process.stdout.write(JSON.stringify({ value }));
} catch (error) {
  process.stdout.write(
    JSON.stringify({
      error: { message: error.message, name: error.name, code: error.code },
    }),
  );
}
