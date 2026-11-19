export const dynamic = 'force-dynamic';

export function GET() {
  const configured = Boolean(
    process.env.AGENTOPS_API_URL?.trim() &&
    process.env.SUPABASE_URL?.trim() &&
    process.env.SUPABASE_PUBLISHABLE_KEY?.trim(),
  );

  return Response.json({ status: configured ? 'ok' : 'unavailable' }, {
    status: configured ? 200 : 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
