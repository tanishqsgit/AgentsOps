import { Agent, type AgentExecutionOptions } from '@mastra/core/agent';
import { z } from 'zod';
import { employeeRuntime, employeeTools } from './tools.ts';
import { modelWithKey, providerOptionsFor, contextProcessors, reserveFinalStep } from './models.ts';
import { knowledgeToolId } from '../knowledge.ts';

export { demoModel as employeeModel } from './models.ts';
export const taskOutputFormat = z.enum(['text', 'release_brief']);

export const releaseBrief = z.object({
  title: z.string(),
  summary: z.string(),
  changes: z.array(z.string()),
});

export type EmployeeProfile = {
  id: string;
  company_id: string;
  name: string;
  role: string;
  instructions: string;
  tool_ids: string[];
};

export async function generateEmployee(
  employee: EmployeeProfile,
  task: { id: string; prompt: string; output_format: z.infer<typeof taskOutputFormat> },
  team?: { teammates: EmployeeProfile[]; delegation: NonNullable<AgentExecutionOptions['delegation']> },
  extended = false,
  mastra?: import('@mastra/core/mastra').Mastra,
) {
  const teammates = team?.teammates ?? [];
  const runtime = await employeeRuntime(employee.company_id, [employee, ...teammates]);
  const model = modelWithKey(runtime.model.id, runtime.model.apiKey);
  const providerOptions = providerOptionsFor(runtime.model.id);
  const agents = Object.fromEntries(teammates.map(member => [
    `employee_${member.id.replaceAll('-', '')}`,
    new Agent({
      id: member.id,
      name: member.name,
      description: `${member.name} — ${member.role}`,
      instructions: `${member.instructions}\n\nReport what you verified, cite sources where available, and mark unavailable evidence or unfinished work.`,
      model,
      mastra,
      inputProcessors: [...contextProcessors(runtime.model.id), reserveFinalStep(4)],
      tools: employeeTools(member.tool_ids, runtime.connected),
      defaultOptions: { providerOptions, maxSteps: 4, modelSettings: { maxOutputTokens: 4096 } },
    }),
  ]));
  const tools = employeeTools(employee.tool_ids, runtime.connected);
  const hasTools = Object.keys(tools).length > 0;
  const maxSteps = teammates.length ? (extended ? 12 : 6) : hasTools ? (extended ? 8 : 3) : 1;
  const agent = new Agent({
    id: employee.id,
    name: employee.name,
    description: employee.role,
    instructions: teammates.length
      ? `${employee.instructions}\n\nLead this team task. Delegate bounded work by specialty, in parallel when independent. Share actual earlier results with workers whose work depends on them. Review their evidence and disagreements yourself, cite verified sources where available, and identify failed handoffs and uncertainties. Claim completed work only when supported by actual tool or worker results.`
      : employee.instructions,
    model,
    mastra,
    inputProcessors: [...contextProcessors(runtime.model.id),
      ...(maxSteps > 1 && task.output_format === 'text' ? [reserveFinalStep(maxSteps)] : [])],
    agents,
    tools,
  });
  const options = {
    runId: task.id,
    maxSteps,
    abortSignal: AbortSignal.timeout(extended ? 300_000 : 90_000),
    providerOptions,
    modelSettings: { maxOutputTokens: teammates.length ? 8192 : 4096 },
    delegation: team?.delegation,
    tracingOptions: Object.hasOwn(runtime.connected, knowledgeToolId) ? { hideInput: true, hideOutput: true } : undefined,
  };

  if (task.output_format === 'release_brief') {
    const output = await agent.generate(task.prompt, {
      ...options,
      structuredOutput: {
        schema: releaseBrief,
        // Let the supervising model call teammates before returning the JSON brief.
        jsonPromptInjection: teammates.length || hasTools ? 'system' : false,
      },
    });
    options.abortSignal.throwIfAborted();
    if (output.finishReason !== 'error' && output.object) return { text: null, data: output.object };
  } else {
    const output = await agent.generate(task.prompt, options);
    options.abortSignal.throwIfAborted();
    if (output.finishReason !== 'error' && output.text?.trim()) {
      return { text: output.text, data: null };
    }
  }
  throw new Error('The model did not return a usable answer.');
}
