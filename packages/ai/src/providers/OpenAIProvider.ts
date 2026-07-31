import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import type { LLMConfig } from '../types.js';

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(config, 'https://api.openai.com/v1');
  }
}
