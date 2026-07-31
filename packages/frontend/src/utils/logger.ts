export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogCategory = 'system' | 'api' | 'websocket' | 'agent' | 'error' | 'ui' | 'performance' | 'snapshot' | 'consistency' | 'state' | 'network';

export interface DevLogEntry {
  id: string;
  level: LogLevel;
  category: LogCategory;
  source: string;
  message: string;
  timestamp: number;
  data?: unknown;
  stackTrace?: string;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let logHandler: ((entry: DevLogEntry) => void) | null = null;
let minLevel: LogLevel = 'debug';
let enabledCategories: Set<LogCategory> | null = null;

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function shouldLog(level: LogLevel, category: LogCategory): boolean {
  if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[minLevel]) return false;
  if (enabledCategories && !enabledCategories.has(category)) return false;
  return true;
}

function createEntry(
  level: LogLevel,
  category: LogCategory,
  source: string,
  message: string,
  data?: unknown,
  stackTrace?: string
): DevLogEntry {
  return {
    id: generateId(),
    level,
    category,
    source,
    message,
    timestamp: Date.now(),
    data,
    stackTrace,
  };
}

function emitLog(entry: DevLogEntry): void {
  if (!shouldLog(entry.level, entry.category)) return;

  switch (entry.level) {
    case 'debug':
      console.debug(`[${entry.category}][${entry.source}] ${entry.message}`, entry.data ?? '');
      break;
    case 'info':
      console.info(`[${entry.category}][${entry.source}] ${entry.message}`, entry.data ?? '');
      break;
    case 'warn':
      console.warn(`[${entry.category}][${entry.source}] ${entry.message}`, entry.data ?? '');
      break;
    case 'error':
      console.error(`[${entry.category}][${entry.source}] ${entry.message}`, entry.data ?? '');
      break;
  }

  logHandler?.(entry);
}

export function setLogHandler(handler: (entry: DevLogEntry) => void): void {
  logHandler = handler;
}

export function setMinLevel(level: LogLevel): void {
  minLevel = level;
}

export function setEnabledCategories(categories: LogCategory[] | null): void {
  enabledCategories = categories ? new Set(categories) : null;
}

export const logger = {
  debug(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('debug', 'system', source, message, data));
  },

  info(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('info', 'system', source, message, data));
  },

  warn(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('warn', 'system', source, message, data));
  },

  error(source: string, message: string, data?: unknown, stackTrace?: string): void {
    emitLog(createEntry('error', 'error', source, message, data, stackTrace));
  },

  api(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('info', 'api', source, message, data));
  },

  apiError(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('error', 'api', source, message, data));
  },

  ws(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('debug', 'websocket', source, message, data));
  },

  wsEvent(source: string, eventType: string, data?: unknown): void {
    emitLog(createEntry('info', 'websocket', source, `[${eventType}]`, data));
  },

  agent(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('info', 'agent', source, message, data));
  },

  agentError(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('error', 'agent', source, message, data));
  },

  ui(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('debug', 'ui', source, message, data));
  },

  perf(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('info', 'performance', source, message, data));
  },

  snapshot(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('info', 'snapshot', source, message, data));
  },

  consistency(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('info', 'consistency', source, message, data));
  },

  stateChange(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('debug', 'state', source, message, data));
  },

  network(source: string, message: string, data?: unknown): void {
    emitLog(createEntry('info', 'network', source, message, data));
  },

  log(level: LogLevel, category: LogCategory, source: string, message: string, data?: unknown): void {
    emitLog(createEntry(level, category, source, message, data));
  },
};

export function captureGlobalErrors(): () => void {
  const originalOnError = window.onerror;
  const originalOnRejection = window.onunhandledrejection;

  window.onerror = (message, source, lineno, colno, error) => {
    const stackTrace = error?.stack;
    emitLog(createEntry('error', 'error', 'global', String(message), { source, lineno, colno }, stackTrace));
    if (originalOnError) {
      return originalOnError(message, source, lineno, colno, error);
    }
    return false;
  };

  window.onunhandledrejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    const stackTrace = reason instanceof Error ? reason.stack : undefined;
    emitLog(createEntry('error', 'error', 'global', `Unhandled rejection: ${message}`, undefined, stackTrace));
    if (originalOnRejection) {
      originalOnRejection.call(window, event);
    }
  };

  return () => {
    window.onerror = originalOnError;
    window.onunhandledrejection = originalOnRejection;
  };
}
