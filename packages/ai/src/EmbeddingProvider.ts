/**
 * ⚠️ 死代码警告：EmbeddingProvider 模块当前无任何生产代码 import 调用。
 *
 * 历史遗留：createEmbeddingProvider 工厂 'api' 模式原 log 撒谎 "will be resolved at runtime"，
 * 但实际立即返回 FallbackEmbeddingProvider，ApiEmbeddingProvider 类从未被实例化。
 * 已清理撒谎注释。等真正需要 embedding 集成时，走 design-first 流程从零设计。
 *
 * 已知问题：
 * - createEmbeddingProvider 工厂零调用方（仅 index.ts re-export + 测试）
 * - ApiEmbeddingProvider 类零实例化（仅 index.ts re-export + 测试）
 * - 'api'/'local' 模式均返回 FallbackEmbeddingProvider，无真实 API/local 集成
 */

import { createChildLogger } from './utils/logger.js';
import { getErrorMessage } from './utils/error.js';

const logger = createChildLogger('embedding-provider');

export interface EmbeddingConfig {
  mode: 'local' | 'api' | 'fallback';
  localModel?: string;
  apiProvider?: string;
  apiModel?: string;
  fallbackDimensions?: number;
}

/**
 * Computes cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}

export abstract class EmbeddingProvider {
  abstract embed(text: string): Promise<number[]>;

  similarity(a: number[], b: number[]): number {
    return cosineSimilarity(a, b);
  }
}

/**
 * Fallback embedding provider using TF-IDF-like keyword hashing.
 * No external dependencies required. Produces fixed-dimension sparse vectors.
 */
export class FallbackEmbeddingProvider extends EmbeddingProvider {
  private dimensions: number;
  private cache: Map<string, number[]> = new Map();

  constructor(dimensions: number = 128) {
    super();
    this.dimensions = dimensions;
  }

  async embed(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) return cached;

    const vector = new Array(this.dimensions).fill(0);
    const tokens = this.tokenize(text);

    for (const token of tokens) {
      const hash = this.hashString(token);
      const idx = Math.abs(hash) % this.dimensions;
      vector[idx] += 1;
    }

    // Normalize
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    if (norm > 0) {
      for (let i = 0; i < vector.length; i++) {
        vector[i] /= norm;
      }
    }

    this.cache.set(text, vector);
    return vector;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s\u4e00-\u9fff]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return hash;
  }
}

/**
 * API-based embedding provider using OpenAI-compatible /v1/embeddings endpoint.
 */
export class ApiEmbeddingProvider extends EmbeddingProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;
  private cache: Map<string, number[]> = new Map();

  constructor(baseUrl: string, apiKey: string, model: string = 'text-embedding-3-small') {
    super();
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.model = model;
  }

  async embed(text: string): Promise<number[]> {
    const cached = this.cache.get(text);
    if (cached) return cached;

    try {
      const response = await fetch(`${this.baseUrl}/v1/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          input: text.substring(0, 8000),
        }),
      });

      if (!response.ok) {
        throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json() as { data: Array<{ embedding: number[] }> };
      const vector = data.data[0]?.embedding;
      if (!vector) {
        throw new Error('No embedding returned from API');
      }

      this.cache.set(text, vector);
      return vector;
    } catch (error) {
      logger.warn('API embedding failed, returning zero vector', {
        error: getErrorMessage(error),
      });
      return new Array(1536).fill(0);
    }
  }
}

/**
 * 工厂函数 — 当前所有模式均返回 FallbackEmbeddingProvider。
 * 'api'/'local' 模式为未实现的预留分支（见文件顶部死代码警告）。
 */
export function createEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  switch (config.mode) {
    case 'api':
      if (!config.apiProvider) {
        logger.warn('API embedding mode but no provider configured, falling back to fallback mode');
        return new FallbackEmbeddingProvider(config.fallbackDimensions);
      }
      logger.warn('API embedding mode not yet implemented, using fallback provider');
      return new FallbackEmbeddingProvider(config.fallbackDimensions);

    case 'local':
      logger.warn('Local embedding mode not yet integrated, using fallback provider');
      return new FallbackEmbeddingProvider(config.fallbackDimensions);

    case 'fallback':
    default:
      return new FallbackEmbeddingProvider(config.fallbackDimensions);
  }
}
