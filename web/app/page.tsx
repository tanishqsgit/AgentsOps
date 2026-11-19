import { connection } from 'next/server';
import { Console } from './console';

export default async function Page() {
  await connection();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return <main className="auth"><p>Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for the web app.</p></main>;
  return <Console url={url} publishableKey={key} />;
}
