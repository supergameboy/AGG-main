import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cosineSimilarity,
  FallbackEmbeddingProvider,
  ApiEmbeddingProvider,
} from '@ai-rpg/ai';

// ---------------------------------------------------------------------------
// cosineSimilarity
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('identical vectors return 1.0', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it('orthogonal vectors return 0', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 10);
  });

  it('opposite vectors return -1', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 10);
  });

  it('empty vectors return 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
  });

  it('vectors of different lengths return 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('zero vectors return 0', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('computes correct similarity for arbitrary vectors', () => {
    const a = [1, 2, 3];
    const b = [4, 5, 6];
    // dot = 1*4 + 2*5 + 3*6 = 32
    // normA = sqrt(14), normB = sqrt(77)
    // expected = 32 / (sqrt(14) * sqrt(77))
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
    expect(cosineSimilarity(a, b)).toBeCloseTo(expected, 10);
  });
});

// ---------------------------------------------------------------------------
// FallbackEmbeddingProvider
// ---------------------------------------------------------------------------

describe('FallbackEmbeddingProvider', () => {
  let provider: FallbackEmbeddingProvider;

  beforeEach(() => {
    provider = new FallbackEmbeddingProvider(128);
  });

  it('returns vector of correct dimensions', async () => {
    const vector = await provider.embed('hello world');
    expect(vector).toHaveLength(128);
  });

  it('same text produces same vector (deterministic)', async () => {
    const v1 = await provider.embed('hello world');
    const v2 = await provider.embed('hello world');
    expect(v1).toEqual(v2);
  });

  it('different texts produce different vectors', async () => {
    const v1 = await provider.embed('hello world');
    const v2 = await provider.embed('goodbye world');
    // Vectors should not be identical
    const identical = v1.every((val, idx) => val === v2[idx]);
    expect(identical).toBe(false);
  });

  it('cosine similarity for identical texts is 1.0', async () => {
    const v = await provider.embed('hello world');
    expect(provider.similarity(v, v)).toBeCloseTo(1.0, 10);
  });

  it('cosine similarity for very different texts is low', async () => {
    const v1 = await provider.embed('attack the dragon with a sword');
    const v2 = await provider.embed('buy bread from the merchant');
    const sim = provider.similarity(v1, v2);
    // Different texts should have lower similarity than identical texts
    expect(sim).toBeLessThan(1.0);
  });

  it('handles empty text', async () => {
    const vector = await provider.embed('');
    expect(vector).toHaveLength(128);
    // Empty text produces zero vector (no tokens to hash)
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    expect(norm).toBe(0);
  });

  it('handles Chinese text', async () => {
    const vector = await provider.embed('你好世界');
    expect(vector).toHaveLength(128);
    // Chinese text should produce a non-zero vector
    const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0));
    expect(norm).toBeGreaterThan(0);
  });

  it('caches results for same input', async () => {
    const v1 = await provider.embed('cached text');
    const v2 = await provider.embed('cached text');
    // Should return the exact same reference from cache
    expect(v1).toBe(v2);
  });

  it('custom dimensions parameter', async () => {
    const customProvider = new FallbackEmbeddingProvider(256);
    const vector = await customProvider.embed('test');
    expect(vector).toHaveLength(256);
  });

  it('similarity method uses cosineSimilarity', async () => {
    const v1 = await provider.embed('hello');
    const v2 = await provider.embed('world');
    const sim = provider.similarity(v1, v2);
    const directSim = cosineSimilarity(v1, v2);
    expect(sim).toBeCloseTo(directSim, 10);
  });
});

// ---------------------------------------------------------------------------
// ApiEmbeddingProvider
// ---------------------------------------------------------------------------

describe('ApiEmbeddingProvider', () => {
  let provider: ApiEmbeddingProvider;

  beforeEach(() => {
    provider = new ApiEmbeddingProvider(
      'https://api.example.com',
      'test-api-key',
      'text-embedding-3-small',
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calls the correct API endpoint', async () => {
    const mockEmbedding = new Array(1536).fill(0).map((_, i) => i * 0.001);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ embedding: mockEmbedding }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await provider.embed('test input');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.example.com/v1/embeddings');
    expect(options!.method).toBe('POST');
    expect(options!.headers).toHaveProperty('Authorization', 'Bearer test-api-key');

    const body = JSON.parse(options!.body as string);
    expect(body.model).toBe('text-embedding-3-small');
    expect(body.input).toBe('test input');

    expect(result).toEqual(mockEmbedding);
  });

  it('caches results for same input', async () => {
    const mockEmbedding = new Array(1536).fill(0.5);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ embedding: mockEmbedding }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const v1 = await provider.embed('cached query');
    const v2 = await provider.embed('cached query');

    // fetch should only be called once due to caching
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(v1).toBe(v2); // Same reference from cache
  });

  it('falls back to zero vector on API error', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Internal Server Error', { status: 500 }),
    );

    const result = await provider.embed('error test');

    expect(result).toHaveLength(1536);
    expect(result.every(v => v === 0)).toBe(true);
  });

  it('falls back to zero vector on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(
      new Error('Network error'),
    );

    const result = await provider.embed('network error test');

    expect(result).toHaveLength(1536);
    expect(result.every(v => v === 0)).toBe(true);
  });

  it('falls back to zero vector when response has no embedding', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const result = await provider.embed('empty data test');

    expect(result).toHaveLength(1536);
    expect(result.every(v => v === 0)).toBe(true);
  });

  it('truncates input text to 8000 characters', async () => {
    const mockEmbedding = new Array(1536).fill(0.1);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ embedding: mockEmbedding }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );

    const longText = 'a'.repeat(10000);
    await provider.embed(longText);

    const body = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string);
    expect(body.input.length).toBe(8000);
  });

  it('similarity method uses cosineSimilarity', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(provider.similarity(a, b)).toBeCloseTo(0, 10);
  });
});
