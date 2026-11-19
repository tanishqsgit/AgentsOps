import { dirname, resolve } from 'node:path';
import pg from 'pg';

const connectionUrl = new URL(process.env.DATABASE_URL!);
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
