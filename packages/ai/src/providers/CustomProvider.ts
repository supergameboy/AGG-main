import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import type { LLMConfig } from '../types.js';

export class CustomProvider extends OpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(config);
  }
}
