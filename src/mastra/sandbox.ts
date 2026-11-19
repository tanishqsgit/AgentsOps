import { createTool } from '@mastra/core/tools';
import { ModalClient, type Sandbox } from 'modal';
import { z } from 'zod';

export const modalCredentialsSchema = z.strictObject({
  tokenId: z.string().trim().max(500).regex(/^ak-[\w-]+$/, 'Enter a Modal token ID beginning with ak-.'),
  tokenSecret: z.string().trim().max(500).regex(/^as-[\w-]+$/, 'Enter a Modal token secret beginning with as-.'),
});

async function readOutput(stream: ReadableStream<string>, limit: number) {
  const reader = stream.getReader();
  let output = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return output;
      output += value.slice(0, limit - output.length);
    }
  } finally {
    reader.releaseLock();
  }
}

export function sandboxTool(credentials: z.infer<typeof modalCredentialsSchema>) {
  return createTool({
    id: 'python-sandbox',
    description: 'Run short Python calculations or transform supplied data in an isolated, temporary environment with no internet access. Print values to return them.',
    inputSchema: z.object({ code: z.string().trim().min(1).max(12000) }),
    outputSchema: z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number() }),
    execute: async ({ code }) => {
      let client: ModalClient | undefined;
      let sandbox: Sandbox | undefined;
      try {
        client = new ModalClient({ ...credentials, timeoutMs: 30_000, maxRetries: 0 });
        const app = await client.apps.fromName('agentops-sandbox', { createIfMissing: true });
        // The Mastra Modal adapter does not expose the creation-time egress policy.
        sandbox = await client.sandboxes.create(app, client.images.fromRegistry('python:3.13-slim'), {
          timeoutMs: 60_000,
          blockNetwork: true,
        });
        const process = await sandbox.exec(['python3', '-I', '-c', code], { mode: 'text', timeoutMs: 20_000 });
        const [stdout, stderr, exitCode] = await Promise.all([
          readOutput(process.stdout, 10000), readOutput(process.stderr, 4000), process.wait(),
        ]);
        return { stdout, stderr, exitCode };
      } catch {
        throw new Error('The Python sandbox could not run the code. Check the sandbox account and available capacity.');
      } finally {
        await sandbox?.terminate().catch(() => {});
        sandbox?.detach();
        client?.close();
      }
    },
  });
}
