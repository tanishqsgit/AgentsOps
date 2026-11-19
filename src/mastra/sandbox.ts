import { E2BSandbox } from '@mastra/e2b';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export function sandboxTool(apiKey: string) {
  return createTool({
    id: 'python-sandbox',
    description: 'Run short Python calculations or transform supplied data in an isolated, temporary environment with no internet access. Print values to return them.',
    inputSchema: z.object({ code: z.string().trim().min(1).max(12000) }),
    outputSchema: z.object({ stdout: z.string(), stderr: z.string(), exitCode: z.number() }),
    execute: async ({ code }) => {
      const sandbox = new E2BSandbox({
        apiKey, timeout: 60_000, lifecycle: { onTimeout: 'kill' }, network: { denyOut: ({ allTraffic }) => [allTraffic] },
      });
      try {
        await sandbox.start();
        const result = await sandbox.executeCommand?.('python3', ['-I', '-c', code], { timeout: 20_000 });
        if (!result) throw new Error('Python execution unavailable.');
        return { stdout: result.stdout.slice(0, 10000), stderr: result.stderr.slice(0, 4000), exitCode: result.exitCode };
      } catch {
        throw new Error('The Python sandbox could not run the code. Check the sandbox account and available capacity.');
      } finally {
        await sandbox.destroy().catch(() => {});
      }
    },
  });
}
