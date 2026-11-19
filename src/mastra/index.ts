import { MastraAuthSupabase } from '@mastra/auth-supabase';
import { Mastra } from '@mastra/core/mastra';
import { ConsoleLogger } from '@mastra/core/logger';
import { MastraPlatformExporter, Observability, SensitiveDataFilter } from '@mastra/observability';
import { routes, scheduledTask, backgroundTask } from '../routes.ts';
import { telegram } from './telegram.ts';
import { storage } from './storage.ts';
import { releaseReview } from './review.ts';

export const mastra = new Mastra({
  agents: telegram ? { [telegram.agent.id]: telegram.agent } : undefined,
  workflows: { releaseReview, [scheduledTask.id]: scheduledTask, [backgroundTask.id]: backgroundTask },
  storage,
  logger: new ConsoleLogger({
    name: 'AgentOps',
    filter({ message, args }) {
      if (!message.startsWith('Upstream LLM API error') && message !== 'Error in LLM execution') return true;
      // Provider errors can carry request bodies and response headers.
      const context = args[0] as { runId?: unknown } | undefined;
      console.error('Model execution failed', typeof context?.runId === 'string' ? context.runId : '');
      return false;
    },
  }),
  observability: process.env.MASTRA_PROJECT_ID && process.env.MASTRA_PLATFORM_ACCESS_TOKEN
    ? new Observability({
      configs: {
        default: {
          serviceName: 'agentops',
          exporters: [new MastraPlatformExporter()],
          spanOutputProcessors: [new SensitiveDataFilter()],
        },
      },
    })
    : undefined,
  server: {
    host: '0.0.0.0',
    port: 4111,
    middleware: [
      async (c, next) => {
        if (c.req.path === '/healthz' || c.req.path.startsWith('/agentops/v1/')
          || (c.req.method === 'POST' && c.req.path === telegram?.webhookPath)) {
          return next();
        }
        return c.notFound();
      },
    ],
    auth: new MastraAuthSupabase({
      anonKey: process.env.SUPABASE_PUBLISHABLE_KEY,
      authorizeUser: user => Boolean(user.id && user.email_confirmed_at),
    }),
    apiRoutes: routes,
  },
});
