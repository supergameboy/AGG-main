import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import type { LLMConfig } from '../types.js';

export class GeminiProvider extends OpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(config, 'https://generativelanguage.googleapis.com/v1beta/openai');
  }
}
