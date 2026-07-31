import { v4 as uuidv4 } from 'uuid';

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: {
    timestamp: number;
    requestId: string;
  };
}

export function successResponse<T>(data: T, requestId?: string): ApiResponse<T> {
  return {
    success: true,
    data,
    meta: {
      timestamp: Date.now(),
      requestId: requestId || uuidv4(),
    },
  };
}

export function errorResponse(
  code: string,
  message: string,
  details?: Record<string, unknown>,
  requestId?: string
): ApiResponse {
  return {
    success: false,
    error: { code, message, details },
    meta: {
      timestamp: Date.now(),
      requestId: requestId || uuidv4(),
    },
  };
}
