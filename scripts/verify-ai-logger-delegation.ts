/**
 * 验证脚本：确认 ai 包 logger 委托 shared 接入 winston 的链路在运行时工作
 *
 * 模拟 backend 启动流程：
 * 1. 加载 backend logger（触发 registerChildLoggerFactory 注册 winston 工厂）
 * 2. 加载 ai 包 LLMService（触发 ai 包模块级 const logger = createChildLogger）
 * 3. 调用 logger.info，检查 ai-*.log 文件是否写入
 *
 * 运行：pnpm --filter @ai-rpg/backend exec tsx scripts/verify-ai-logger-delegation.ts
 */

import { logger as backendLogger } from '../packages/backend/src/utils/logger.js';
import { LLMService } from '../packages/ai/src/LLMService.js';
import { createChildLogger } from '../packages/ai/src/utils/logger.js';
import fs from 'fs';
import path from 'path';

const today = new Date().toISOString().slice(0, 10);
const aiLogPath = path.join('game_data', 'logs', `ai-${today}.log`);
const sizeBefore = fs.existsSync(aiLogPath) ? fs.statSync(aiLogPath).size : 0;

backendLogger.info('verify-ai-logger: backend logger loaded, factory registered');

const aiLogger = createChildLogger('llm-service');
aiLogger.info('verify-ai-logger: ai package createChildLogger test', {
  tag: 'LLM-INPUT',
  test: true,
});

// 触发 LLMService 模块加载（其模块级 const logger 已在 import 时执行）
void LLMService;

setTimeout(() => {
  const sizeAfter = fs.existsSync(aiLogPath) ? fs.statSync(aiLogPath).size : 0;
  const content = fs.existsSync(aiLogPath) ? fs.readFileSync(aiLogPath, 'utf-8') : '';

  console.log('--- Verification Result ---');
  console.log(`ai log file: ${aiLogPath}`);
  console.log(`size before: ${sizeBefore}, after: ${sizeAfter}`);
  console.log(`content includes "verify-ai-logger": ${content.includes('verify-ai-logger')}`);
  console.log(`content includes "LLM-INPUT": ${content.includes('LLM-INPUT')}`);
  console.log(`content includes "llm-service": ${content.includes('llm-service')}`);

  if (sizeAfter > sizeBefore && content.includes('verify-ai-logger')) {
    console.log('PASS: ai package logger delegation works correctly');
    process.exit(0);
  } else {
    console.log('FAIL: ai package logger delegation did not write to ai-*.log');
    process.exit(1);
  }
}, 500);
