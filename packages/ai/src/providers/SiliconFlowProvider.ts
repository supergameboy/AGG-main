import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import type { LLMConfig } from '../types.js';

export class SiliconFlowProvider extends OpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(config, 'https://api.siliconflow.cn/v1');
  }
}
