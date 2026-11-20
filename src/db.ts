import { dirname, resolve } from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required. Set it to the PostgreSQL connection URL or attach a PostgreSQL database to the Mastra deployment environment.');
}

const connectionUrl = URL.parse(databaseUrl);
if (!connectionUrl || !['postgres:', 'postgresql:'].includes(connectionUrl.protocol)) {
  throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
}
const rootCertificate = connectionUrl.searchParams.get('sslrootcert');
if (rootCertificate) {
  // Mastra dev runs from its public directory. npm still points to the project root.
  const packageFile = process.env.npm_package_json;
  const projectDir = packageFile ? dirname(packageFile) : process.cwd();
  connectionUrl.searchParams.set('sslrootcert', resolve(projectDir, rootCertificate));
}

export const connectionString = connectionUrl.toString();
export const db = new pg.Pool({ connectionString });
db.on('error', error => console.error('Idle database connection was lost:', error.message));
