import pg from 'pg';

// Compose runs a single service instance. A running row from the previous process
// cannot complete after the container has been replaced.
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`
    update agentops.task_delegations set status = 'failed', finished_at = now() where status = 'running';
    update agentops.tasks set status = 'failed', finished_at = now(),
      error = 'The service restarted during execution. Submit a new task to retry.'
      where status in ('queued', 'running');
    update agentops.conversation_activity set status = 'failed' where status = 'running';
  `);
} finally {
  await client.end();
}
