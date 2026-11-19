import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('Set DATABASE_URL before running migrations.');

const client = new pg.Client({ connectionString });
await client.connect();
try {
  const directory = new URL('../db/', import.meta.url);
  const files = (await readdir(directory)).filter(file => file.endsWith('.sql')).sort();
  for (const file of files) {
    await client.query(await readFile(new URL(file, directory), 'utf8'));
  }
  console.log('AgentOps schema is ready.');
} finally {
  await client.end();
}
