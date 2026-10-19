import 'dotenv/config';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { AuthStorage } from '@mastra/code-sdk/auth/storage';

const authPath = resolve(
  process.env.PAL_AGENT_AUTH_PATH ?? './data/agent/auth.json',
);
const terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
});
try {
  await new AuthStorage(authPath).login('openai-codex', {
    authMode: process.argv.includes('--device') ? 'device' : 'browser',
    onAuth: ({ url, instructions }) => {
      console.log(url);
      if (instructions) console.log(instructions);
    },
    onPrompt: ({ message }) => terminal.question(`${message} `),
    onProgress: (message) => console.log(message),
  });
  console.log(`ChatGPT login saved to ${authPath}`);
} catch {
  console.error('ChatGPT login failed. Run agent:login again.');
  process.exitCode = 1;
} finally {
  terminal.close();
}
