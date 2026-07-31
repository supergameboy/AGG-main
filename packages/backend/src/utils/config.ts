import path from 'path';
import { fileURLToPath } from 'url';
import convict from 'convict';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const GAME_DATA_DIR = process.env.GAME_DATA_DIR || path.resolve(__dirname, '../../../../game_data');

// export const DEFAULT_TIMEOUT_MS = 300000;
export const DEFAULT_TIMEOUT_MS = 0; // 超时已禁用，0 = 不超时

// WS 心跳是保活机制，不是超时，不应被 DEFAULT_TIMEOUT_MS=0 影响。
// 0 在运行时表示禁用心跳（不 ping），但默认 30s 是合理的保活间隔。
const DEFAULT_WS_HEARTBEAT_MS = 30_000;

const configSchema = convict({
  env: {
    doc: 'The application environment.',
    format: ['production', 'development', 'test'],
    default: 'development',
    env: 'NODE_ENV',
  },
  server: {
    port: {
      doc: 'The port to bind.',
      format: 'port',
      default: 17334,
      env: 'PORT',
    },
    host: {
      doc: 'The host to bind.',
      format: String,
      default: 'localhost',
      env: 'HOST',
    },
    corsOrigins: {
      doc: 'Allowed CORS origins (comma-separated)',
      format: String,
      default: 'http://localhost:5173,http://localhost:3000',
      env: 'CORS_ORIGINS',
    },
  },
  database: {
    filename: {
      doc: 'Path to SQLite database file.',
      format: String,
      default: path.join(GAME_DATA_DIR, 'game.db'),
      env: 'DATABASE_PATH',
    },
    pool: {
      min: {
        doc: 'Minimum database pool size.',
        format: 'int',
        default: 1,
      },
      max: {
        doc: 'Maximum database pool size.',
        format: 'int',
        default: 5,
      },
    },
  },
  logs: {
    level: {
      doc: 'Log level',
      format: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
      default: 'info',
      env: 'LOG_LEVEL',
    },
    dir: {
      doc: 'Directory to store log files',
      format: String,
      default: path.join(GAME_DATA_DIR, 'logs'),
      env: 'LOG_DIR',
    },
  },
  gameData: {
    dir: {
      doc: 'Directory to store game data',
      format: String,
      default: GAME_DATA_DIR,
      env: 'GAME_DATA_DIR',
    },
    saves: {
      doc: 'Directory to store save files',
      format: String,
      default: path.join(GAME_DATA_DIR, 'saves'),
    },
    templates: {
      doc: 'Directory to store template files',
      format: String,
      default: path.join(GAME_DATA_DIR, 'templates'),
    },
    images: {
      doc: 'Directory to store images',
      format: String,
      default: path.join(GAME_DATA_DIR, 'images'),
    },
    backups: {
      doc: 'Directory to store backups',
      format: String,
      default: path.join(GAME_DATA_DIR, 'backups'),
    },
  },
  llm: {
    provider: {
      doc: 'LLM provider',
      format: ['openai', 'gemini', 'deepseek', 'glm', 'kimi', 'custom'],
      default: 'openai',
      env: 'LLM_PROVIDER',
    },
    apiKey: {
      doc: 'LLM API Key',
      format: String,
      default: '',
      env: 'LLM_API_KEY',
      sensitive: true,
    },
    baseUrl: {
      doc: 'LLM API Base URL',
      format: String,
      default: '',
      env: 'LLM_BASE_URL',
    },
    model: {
      doc: 'LLM Model',
      format: String,
      default: 'gpt-4',
      env: 'LLM_MODEL',
    },
    temperature: {
      doc: 'LLM Temperature',
      format: Number,
      default: 0.7,
      env: 'LLM_TEMPERATURE',
    },
  },
  contextCompression: {
    doc: '上下文压缩配置',
    format: Object,
    default: {
      eventThreshold: 50,
      maxMessages: 100,
      retainRecentCount: 10,
      npcMemoryThreshold: 30,
      npcCustomDataSizeKB: 32,
      npcProtectThreshold: 4,
    },
  },
  timeout: {
    chat: {
      doc: 'Chat request timeout (ms). Unified to 5min initialization wait time.',
      format: 'int',
      default: DEFAULT_TIMEOUT_MS,
      env: 'TIMEOUT_CHAT',
    },
    directMessage: {
      doc: 'Direct message timeout (ms). Unified to 5min initialization wait time.',
      format: 'int',
      default: DEFAULT_TIMEOUT_MS,
      env: 'TIMEOUT_DIRECT_MESSAGE',
    },
    llmProvider: {
      doc: 'LLM Provider HTTP request timeout (ms). Unified to 5min initialization wait time.',
      format: 'int',
      default: DEFAULT_TIMEOUT_MS,
      env: 'TIMEOUT_LLM_PROVIDER',
    },
    agentProcessing: {
      doc: 'Agent processing timeout (ms). Unified to 5min initialization wait time.',
      format: 'int',
      default: DEFAULT_TIMEOUT_MS,
      env: 'TIMEOUT_AGENT_PROCESSING',
    },
    dagNode: {
      doc: 'DAG node execution timeout (ms). Unified to 5min initialization wait time.',
      format: 'int',
      default: DEFAULT_TIMEOUT_MS,
      env: 'TIMEOUT_DAG_NODE',
    },
    toolExecution: {
      doc: 'Tool method execution timeout (ms). Unified to 5min initialization wait time.',
      format: 'int',
      default: DEFAULT_TIMEOUT_MS,
      env: 'TIMEOUT_TOOL_EXECUTION',
    },
    reactIteration: {
      doc: 'ReAct single iteration timeout (ms). Unified to 5min initialization wait time.',
      format: 'int',
      default: DEFAULT_TIMEOUT_MS,
      env: 'TIMEOUT_REACT_ITERATION',
    },
    reactMaxTokens: {
      doc: 'ReAct loop maximum total tokens before forced termination.',
      format: 'int',
      default: 100000,
      env: 'TIMEOUT_REACT_MAX_TOKENS',
    },
    wsHeartbeat: {
      doc: 'WebSocket heartbeat interval (ms). 0 disables heartbeat. Default 30s keeps connection alive without depending on DEFAULT_TIMEOUT_MS.',
      format: 'int',
      default: DEFAULT_WS_HEARTBEAT_MS,
      env: 'TIMEOUT_WS_HEARTBEAT',
    },
    wsMaxMissedHeartbeats: {
      doc: 'WebSocket max missed heartbeats before disconnect.',
      format: 'int',
      default: 3,
      env: 'TIMEOUT_WS_MAX_MISSED_HEARTBEATS',
    },
  },
});

configSchema.validate({ allowed: 'strict' });

export const config = configSchema.getProperties();

export type Config = typeof config;
