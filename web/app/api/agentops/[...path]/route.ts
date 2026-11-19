type RouteContext = { params: Promise<{ path: string[] }> };

async function forward(request: Request, context: RouteContext) {
  const { path } = await context.params;
  if (path.some(segment => !/^[a-zA-Z0-9_-]+$/.test(segment))) {
    return Response.json({ error: 'Invalid path.' }, { status: 400 });
  }
  const origin = process.env.AGENTOPS_API_URL ?? 'http://127.0.0.1:4111';
  const url = new URL('/agentops/v1/' + path.join('/'), origin);
  url.search = new URL(request.url).search;
  const headers = new Headers();
  for (const field of ['authorization', 'content-type']) {
    const value = request.headers.get(field);
    if (value) headers.set(field, value);
  }
  try {
    const multipart = request.method === 'POST' && path.length === 3 && path[0] === 'companies' && path[2] === 'knowledge';
    const init: RequestInit & { duplex?: 'half' } = {
      method: request.method, headers, cache: 'no-store',
      body: multipart ? request.body : ['POST', 'PUT'].includes(request.method) ? await request.text() : undefined,
    };
    if (multipart) init.duplex = 'half';
    const response = await fetch(url, init);
    const responseHeaders = new Headers({
      'Content-Type': response.headers.get('Content-Type') ?? 'application/json',
      'Cache-Control': 'no-store',
    });
    const protocol = response.headers.get('x-vercel-ai-ui-message-stream');
    if (protocol) responseHeaders.set('x-vercel-ai-ui-message-stream', protocol);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return Response.json({ error: 'The AgentOps service is unavailable.' }, { status: 502 });
  }
}

export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
