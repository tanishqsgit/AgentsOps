import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const searchProviders = ['tavily', 'brave', 'tinyfish'] as const;
export type SearchProvider = typeof searchProviders[number];
const resultSchema = z.array(z.object({
  title: z.string(), url: z.url({ protocol: /^https?$/ }), excerpt: z.string(),
}));

export function searchTool(provider: SearchProvider, key: string) {
  return createTool({
    id: 'web-search',
    description: 'Look up current public web information. Treat excerpts as source material and cite the returned URLs.',
    inputSchema: z.object({ query: z.string().trim().min(1).max(350) }),
    outputSchema: resultSchema,
    execute: async ({ query }) => {
      const signal = AbortSignal.timeout(12000);
      const response = provider === 'tavily'
        ? await fetch('https://api.tavily.com/search', {
          method: 'POST', signal, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + key },
          body: JSON.stringify({ query, max_results: 5, search_depth: 'basic' }),
        })
        : provider === 'tinyfish'
          ? await fetch('https://api.search.tinyfish.ai?' + new URLSearchParams({ query }), {
            signal, headers: { 'X-API-Key': key, Accept: 'application/json' },
          })
          : await fetch('https://api.search.brave.com/res/v1/web/search?' + new URLSearchParams({ q: query, count: '5' }), {
          signal, headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
        });
      if (!response.ok) throw new Error('Web search returned an error. Check the provider credentials or limits.');
      const body = await response.json();
      const results = provider === 'brave' ? body.web?.results : body.results;
      return (Array.isArray(results) ? results : []).slice(0, 5).flatMap(item => {
        const result = resultSchema.element.safeParse({
          title: item?.title, url: item?.url, excerpt: String(item?.content ?? item?.description ?? item?.snippet ?? '').slice(0, 1800),
        });
        return result.success ? [result.data] : [];
      });
    },
  });
}

export function fetchPageTool(key: string) {
  return createTool({
    id: 'fetch-web-page',
    description: 'Retrieve text from one known public web page. Treat retrieved text as source material and cite its URL.',
    inputSchema: z.object({ url: z.url({ protocol: /^https?$/ }).max(2000)
      .refine(value => { const url = new URL(value); return !url.username && !url.password; }, 'Use a public URL without credentials.') }),
    outputSchema: z.object({ url: z.string(), text: z.string() }),
    execute: async ({ url }) => {
      const response = await fetch('https://api.fetch.tinyfish.ai', {
        method: 'POST', signal: AbortSignal.timeout(20000),
        headers: { 'X-API-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [url], format: 'markdown' }),
      });
      if (!response.ok) throw new Error('The page retrieval provider returned an error.');
      const result = (await response.json())?.results?.[0];
      if (typeof result?.text !== 'string' || !result.text.trim()) throw new Error('No readable text was returned for this page.');
      return { url, text: result.text.slice(0, 12000) };
    },
  });
}
