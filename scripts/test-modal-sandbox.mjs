import assert from 'node:assert/strict';
import { modalCredentialsSchema, sandboxTool } from '../src/mastra/sandbox.ts';

const credentials = modalCredentialsSchema.safeParse({
  tokenId: process.env.MODAL_TOKEN_ID,
  tokenSecret: process.env.MODAL_TOKEN_SECRET,
});

if (!credentials.success) {
  console.error('Set MODAL_TOKEN_ID (ak-…) and the matching MODAL_TOKEN_SECRET (as-…) before running the live test.');
  process.exitCode = 1;
} else {
  try {
    const result = await sandboxTool(credentials.data).execute({ code: `
import socket
import sys

print(6 * 7)
print("stderr check", file=sys.stderr)
try:
    with socket.create_connection(("1.1.1.1", 443), timeout=3):
        raise RuntimeError("Outbound connection unexpectedly succeeded")
except OSError:
    print("Outbound connection blocked")
sys.exit(7)
` });
    assert.equal(result.exitCode, 7);
    assert.equal(result.stdout.trim(), '42\nOutbound connection blocked');
    assert.equal(result.stderr.trim(), 'stderr check');
    console.log('Modal smoke test passed. Python output, exit code, and blocked outbound connection verified.');
  } catch {
    console.error('Modal smoke test failed. Check the token pair, workspace capacity, and sandbox logs in Modal.');
    process.exitCode = 1;
  }
}
