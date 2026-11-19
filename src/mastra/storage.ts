import { PostgresStore } from '@mastra/pg';
import { Memory } from '@mastra/memory';
import { connectionString } from '../db.ts';
import { knowledgeToolId } from '../knowledge.ts';
import { z } from 'zod';

export const storage = new PostgresStore({
  id: 'agentops-runtime',
  connectionString,
  schemaName: 'mastra',
});

const knowledgeResult = z.object({
  status: z.string(),
  sources: z.array(z.object({ sourceId: z.uuid(), name: z.string(), position: z.number(), page: z.number().nullable() })),
});

class ConversationMemory extends Memory {
  override saveMessages(args: Parameters<Memory['saveMessages']>[0]) {
    const messages = args.messages.map(message => {
      let stripped = false;
      const parts = message.content.parts.map(part => {
        if (part.type !== 'tool-invocation' || part.toolInvocation.toolName !== knowledgeToolId ||
            part.toolInvocation.state !== 'result') return part;
        stripped = true;
        const result = knowledgeResult.safeParse(part.toolInvocation.result);
        return { ...part, toolInvocation: { ...part.toolInvocation, result: result.success ? result.data : { sources: [] } } };
      });
      if (!stripped) return message;
      // Clear the legacy mirror as well. The canonical parts retain the tool call and its citations.
      return { ...message, content: { ...message.content, parts, toolInvocations: undefined } };
    });
    return super.saveMessages({ ...args, messages });
  }
}

export const memory = new ConversationMemory({ storage, options: { lastMessages: 20, generateTitle: false } });
