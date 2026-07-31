import { describe, expect, it, afterEach } from 'vitest';
import { ModelConfigService } from '@ai-rpg/ai';
import { InMemoryModelConfigStore } from './helpers/InMemoryModelConfigStore.js';

describe('ModelConfigService — seedFromConvictConfig（M1：IModelConfigStore 端口）', () => {
  let service: ModelConfigService | null = null;

  afterEach(() => {
    service?.destroy();
    service = null;
  });

  function createService(store: InMemoryModelConfigStore): ModelConfigService {
    service = new ModelConfigService(store);
    return service;
  }

  it('seeds provider from convict config when no default provider exists', async () => {
    const store = new InMemoryModelConfigStore();
    const svc = createService(store);

    const mockConfig = {
      provider: 'openai',
      apiKey: 'sk-test-key-123',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      temperature: 0.7,
    };

    await svc.seedFromConvictConfig(mockConfig);

    const defaults = await svc.getDefaults();
    expect(defaults.defaultProviderId).toBeTruthy();

    const provider = await svc.getProvider(defaults.defaultProviderId!);
    expect(provider).toBeTruthy();
    expect(provider!.providerType).toBe('openai');
    expect(provider!.defaultModel).toBe('gpt-4o');
  });

  it('does not overwrite existing default provider', async () => {
    const store = new InMemoryModelConfigStore();
    const svc = createService(store);

    // 先 seed 一次
    await svc.seedFromConvictConfig({
      provider: 'openai',
      apiKey: 'sk-first-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4',
      temperature: 0.7,
    });

    const firstDefaults = await svc.getDefaults();

    // 再 seed 一次，不应覆盖
    await svc.seedFromConvictConfig({
      provider: 'deepseek',
      apiKey: 'sk-second-key',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-v3',
      temperature: 0.5,
    });

    const secondDefaults = await svc.getDefaults();
    expect(secondDefaults.defaultProviderId).toBe(firstDefaults.defaultProviderId);
    expect(secondDefaults.defaultModel).toBe('gpt-4');
  });

  it('skips seeding when apiKey is empty', async () => {
    const store = new InMemoryModelConfigStore();
    const svc = createService(store);

    await svc.seedFromConvictConfig({
      provider: 'openai',
      apiKey: '',
      baseUrl: '',
      model: 'gpt-4',
      temperature: 0.7,
    });

    const defaults = await svc.getDefaults();
    expect(defaults.defaultProviderId).toBeNull();
  });

  it('updates existing provider of same type when re-seeding', async () => {
    const store = new InMemoryModelConfigStore();
    const svc = createService(store);

    // Seed with first key
    await svc.seedFromConvictConfig({
      provider: 'openai',
      apiKey: 'sk-old-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4',
      temperature: 0.7,
    });

    // Re-seed with new key (same provider type)
    await svc.seedFromConvictConfig({
      provider: 'openai',
      apiKey: 'sk-new-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o',
      temperature: 0.7,
    });

    const provider = await svc.getProvider((await svc.getDefaults()).defaultProviderId!);
    expect(provider!.defaultModel).toBe('gpt-4o');
  });

  it('respects LLM_PROVIDER env var format', async () => {
    const store = new InMemoryModelConfigStore();
    const svc = createService(store);

    await svc.seedFromConvictConfig({
      provider: 'gemini',
      apiKey: 'gemini-test-key',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      model: 'gemini-2.0-flash',
      temperature: 0.5,
    });

    const provider = await svc.getProvider((await svc.getDefaults()).defaultProviderId!);
    expect(provider!.providerType).toBe('gemini');
  });
});
