import { beforeEach, describe, expect, it, vi } from 'vitest';

const { apiGetMock } = vi.hoisted(() => ({
  apiGetMock: vi.fn(),
}));

vi.mock('../client', () => ({
  llmClient: {
    post: vi.fn(),
  },
  apiClient: {
    get: apiGetMock,
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import { gameApi } from '../gameApi';

describe('gameApi.getStoryHistory', () => {
  beforeEach(() => {
    apiGetMock.mockReset();
    apiGetMock.mockResolvedValue({
      events: [],
      pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
    });
  });

  it('应请求 save 下的 story history HTTP 接口', async () => {
    await gameApi.getStoryHistory('save-1', { page: 2, pageSize: 15 });

    expect(apiGetMock).toHaveBeenCalledWith('/saves/save-1/story/history?page=2&pageSize=15');
  });
});
