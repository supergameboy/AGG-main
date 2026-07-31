import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js';
import type { LLMConfig } from '../types.js';

export class SparkProvider extends OpenAICompatibleProvider {
  constructor(config: LLMConfig) {
    super(config, 'https://spark-api-open.xf-yun.com/v1');
  }
}
