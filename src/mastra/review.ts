import { createStep, createWorkflow } from '@mastra/core/workflows';
import { z } from 'zod';
import { releaseBrief } from './employee.ts';

export const reviewDecision = z.object({ approved: z.boolean(), reviewerId: z.uuid(), note: z.string().max(1000).optional() });

const review = createStep({
  id: 'review',
  inputSchema: releaseBrief,
  outputSchema: z.object({ brief: releaseBrief, decision: reviewDecision }),
  suspendSchema: z.object({ reason: z.string() }),
  resumeSchema: reviewDecision,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData) return suspend({ reason: 'Waiting for a release decision.' });
    return { brief: inputData, decision: resumeData };
  },
});

export const releaseReview = createWorkflow({
  id: 'release-brief-review',
  inputSchema: releaseBrief,
  outputSchema: review.outputSchema,
}).then(review).commit();

export async function reviewState(taskId: string) {
  const run = await releaseReview.getWorkflowRunById(taskId);
  if (!run) return null;
  const step = run.steps?.review;
  const output = run.result?.decision ?? (Array.isArray(step) ? undefined : step?.output?.decision);
  const decision = reviewDecision.safeParse(output);
  return { status: run.status, decision: decision.success ? decision.data : null, createdAt: run.createdAt, updatedAt: run.updatedAt,
    step: Array.isArray(step) ? null : step?.status ?? null };
}
