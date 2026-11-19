import { TokenLimiterProcessor, type Processor } from '@mastra/core/processors';
import { Agent } from '@mastra/core/agent';
import { getProviderConfig, parseModelString, PROVIDER_REGISTRY } from '@mastra/core/llm';

export const demoModel = 'mistral/zai-glm-5-3-flash';

export function configuredModel(settings: { model_id: string | null; model_api_key: string | null; mistral_api_key: string | null }) {
  return { id: settings.model_id ?? demoModel, apiKey: settings.model_id ? settings.model_api_key : settings.mistral_api_key };
}

export function modelWithKey(id: string, apiKey: string | null) {
  const { provider, modelId } = parseModelString(id);
  if (!provider || !modelId) throw new Error('A model must use its Mastra provider/model ID.');
  return apiKey ? { providerId: provider, modelId, apiKey } : id;
}

export function providerOptionsFor(id: string) {
  return id === demoModel ? { mistral: { reasoningEffort: 'low' } } : undefined;
}

export const modelProviders = Object.entries(PROVIDER_REGISTRY)
  .filter(([, config]) => config.models.length)
  .map(([id, config]) => ({ id, name: config.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export function providerModelIds(provider: string) {
  const config = getProviderConfig(provider);
  return config?.models.filter(id => !config.deprecatedModels?.includes(id)) ?? [];
}

export async function verifyModel(id: string, apiKey: string | null) {
  const { provider, modelId } = parseModelString(id);
  if (!provider || (id !== demoModel && !providerModelIds(provider).includes(modelId))) return false;
  try {
    const agent = new Agent({ id: 'agentops-model-check', name: 'Model check', instructions: 'Respond briefly.',
      model: modelWithKey(id, apiKey) });
    const result = await agent.generate('Reply with OK.', {
      maxSteps: 1, abortSignal: AbortSignal.timeout(15000),
      modelSettings: { maxOutputTokens: 128 }, providerOptions: providerOptionsFor(id),
    });
    return result.finishReason !== 'error' && Boolean(result.text?.trim());
  } catch { return false; }
}

export function contextProcessors(id: string) {
  return id === demoModel ? [new TokenLimiterProcessor({ limit: 24_000, trimMode: 'best-fit' })] : [];
}

export function reserveFinalStep(maxSteps: number) {
  return {
    id: 'reserve-final-step',
    async processInputStep({ stepNumber }) {
      if (stepNumber === maxSteps - 1) return { toolChoice: 'none' };
    },
  } satisfies Processor;
}
