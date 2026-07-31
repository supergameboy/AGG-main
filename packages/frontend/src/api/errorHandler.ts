export type ErrorCategory = 'network' | 'timeout' | 'auth' | 'validation' | 'not_found' | 'forbidden' | 'server' | 'input_blocked' | 'unknown';

export interface ApiErrorDetail {
  code: string;
  message: string;
  category: ErrorCategory;
  details?: Record<string, unknown>;
  statusCode?: number;
}

const ERROR_CODE_MAP: Record<string, { message: string; category: ErrorCategory }> = {
  INVALID_REQUEST: { message: '请求参数无效', category: 'validation' },
  INPUT_BLOCKED: { message: '输入内容不合规，请重新输入', category: 'input_blocked' },
  MISSING_CHARACTER_DATA: { message: '缺少角色创建数据', category: 'validation' },
  INVALID_CHARACTER_DATA: { message: '角色数据不完整', category: 'validation' },
  INVALID_IMPORT_DATA: { message: '导入数据无效', category: 'validation' },
  VALIDATION_ERROR: { message: '数据验证失败', category: 'validation' },
  INVALID_JSON: { message: 'JSON格式错误', category: 'validation' },
  UNAUTHORIZED: { message: '未授权访问', category: 'auth' },
  FORBIDDEN: { message: '禁止操作（内置资源不可修改/删除）', category: 'forbidden' },
  AGENT_NOT_FOUND: { message: '指定的Agent不存在', category: 'not_found' },
  SAVE_NOT_FOUND: { message: '存档不存在', category: 'not_found' },
  SNAPSHOT_NOT_FOUND: { message: '快照不存在', category: 'not_found' },
  TEMPLATE_NOT_FOUND: { message: '模板不存在', category: 'not_found' },
  PROFILE_NOT_FOUND: { message: 'Agent配置不存在', category: 'not_found' },
  NOT_FOUND: { message: '资源不存在', category: 'not_found' },
  INITIALIZATION_FAILED: { message: '游戏初始化失败', category: 'server' },
  AGENT_PROCESSING_ERROR: { message: 'Agent处理消息时出错', category: 'server' },
  LLM_TIMEOUT: { message: 'AI响应超时，请稍后重试', category: 'timeout' },
  AGENT_TIMEOUT: { message: 'Agent处理超时', category: 'timeout' },
  REQUEST_TIMEOUT: { message: '请求超时', category: 'timeout' },
  INTERNAL_ERROR: { message: '服务器内部错误', category: 'server' },
  SERVICE_UNAVAILABLE: { message: '服务暂不可用', category: 'server' },
  RATE_LIMIT_EXCEEDED: { message: '请求过于频繁，请稍后重试', category: 'server' },
};

function categoryFromStatus(status: number): ErrorCategory {
  if (status === 401) return 'auth';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408) return 'timeout';
  if (status >= 400 && status < 500) return 'validation';
  if (status >= 500) return 'server';
  return 'unknown';
}

export function parseApiError(error: unknown): ApiErrorDetail {
  if (error && typeof error === 'object' && 'code' in error && 'message' in error) {
    const apiErr = error as { code: string; message: string; details?: Record<string, unknown> };
    const mapped = ERROR_CODE_MAP[apiErr.code];
    return {
      code: apiErr.code,
      message: mapped?.message || apiErr.message,
      category: mapped?.category || 'unknown',
      details: apiErr.details,
    };
  }

  if (error && typeof error === 'object') {
    const err = error as Record<string, unknown>;

    if (err.name === 'AxiosError' || err.isAxiosError) {
      const axiosErr = error as { response?: { status?: number; data?: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } }; code?: string; message?: string };
      const status = axiosErr.response?.status;
      const serverError = axiosErr.response?.data?.error;

      if (serverError?.code) {
        const mapped = ERROR_CODE_MAP[serverError.code];
        return {
          code: serverError.code,
          message: mapped?.message || serverError.message || '请求失败',
          category: mapped?.category || (status ? categoryFromStatus(status) : 'unknown'),
          details: serverError.details,
          statusCode: status,
        };
      }

      if (axiosErr.code === 'ECONNABORTED' || axiosErr.code === 'ERR_CANCELED') {
        return {
          code: 'REQUEST_TIMEOUT',
          message: '请求超时，请稍后重试',
          category: 'timeout',
          statusCode: status,
        };
      }

      if (axiosErr.code === 'ERR_NETWORK') {
        return {
          code: 'NETWORK_ERROR',
          message: '网络连接失败，请检查后端服务是否启动',
          category: 'network',
        };
      }

      if (status) {
        return {
          code: `HTTP_${status}`,
          message: status >= 500 ? '服务器错误，请稍后重试' : '请求失败',
          category: categoryFromStatus(status),
          statusCode: status,
        };
      }
    }

    if (err.message && typeof err.message === 'string') {
      const msg = err.message as string;
      if (msg.includes('timeout') || msg.includes('超时')) {
        return { code: 'REQUEST_TIMEOUT', message: '请求超时，请稍后重试', category: 'timeout' };
      }
      if (msg.includes('Network Error') || msg.includes('网络')) {
        return { code: 'NETWORK_ERROR', message: '网络连接失败', category: 'network' };
      }
      return { code: 'UNKNOWN_ERROR', message: msg, category: 'unknown' };
    }
  }

  if (error instanceof Error) {
    return { code: 'UNKNOWN_ERROR', message: error.message, category: 'unknown' };
  }

  return { code: 'UNKNOWN_ERROR', message: '未知错误', category: 'unknown' };
}

export function getUserMessage(error: unknown): string {
  return parseApiError(error).message;
}

export function isInputBlocked(error: unknown): boolean {
  return parseApiError(error).code === 'INPUT_BLOCKED';
}

export function isNotFoundError(error: unknown): boolean {
  return parseApiError(error).category === 'not_found';
}

export function isTimeoutError(error: unknown): boolean {
  return parseApiError(error).category === 'timeout';
}

export function isNetworkError(error: unknown): boolean {
  return parseApiError(error).category === 'network';
}
