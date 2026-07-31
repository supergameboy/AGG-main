import { InputValidationResult } from './types.js';
import { AgentMessage } from '../../../../shared/src/types/agent.js';
import { createChildLogger } from '../../utils/logger.js';

const logger = createChildLogger('InputValidator');

const PASSIVE_RESPONSES: string[] = [
  '你犹豫了一下，不知道该做什么。也许可以看看周围，或者和附近的人聊聊？',
  '你陷入了沉思。试着探索一下周围的环境，或者查看自己的装备和任务。',
  '你暂时没有行动。可以试试和NPC对话、查看地图，或者检查背包里的物品。',
];

function normalizeInput(content: string): string {
  let normalized = content;

  normalized = normalized.replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '');

  normalized = normalized.normalize('NFC');

  normalized = normalized.replace(/[\uFF01-\uFF5E\u3000]/g, c => {
    if (c === '\u3000') return ' ';
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });

  for (let i = 0; i < 3; i++) {
    const prev = normalized;
    try { normalized = decodeURIComponent(normalized); } catch { /* not URL encoded */ }
    normalized = normalized.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)));
    normalized = normalized.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    if (normalized === prev) break;
  }

  return normalized;
}

function tryDecodeBase64Substrings(content: string): string {
  const base64Pattern = /[A-Za-z0-9+/]{40,}={0,2}/g;
  const matches = content.match(base64Pattern);
  if (!matches) return content;

  let decoded = content;
  for (const match of matches) {
    try {
      const decodedStr = Buffer.from(match, 'base64').toString('utf-8');
      if (decodedStr && /[\u4e00-\u9fa5a-zA-Z]{3,}/.test(decodedStr)) {
        decoded = decoded + ' ' + decodedStr;
      }
    } catch { /* not valid base64 */ }
  }
  return decoded;
}

export class InputValidator {
  validate(message: AgentMessage): InputValidationResult {
    const payloadData = (message.payload?.data as Record<string, unknown>) || {};
    const rawContent = ((payloadData.message || payloadData.content || payloadData.playerInput || '') as string).trim();

    logger.debug('开始验证输入内容', { contentLength: rawContent.length });

    const normalized = normalizeInput(rawContent);
    const contentForCheck = tryDecodeBase64Substrings(normalized);

    const injectionPatterns = [
      { pattern: /ignore\s+(all\s+)?previous\s+instructions?/i, name: '角色劫持' },
      { pattern: /system\s*:\s*override/i, name: '系统指令覆盖' },
      { pattern: /jailbreak\s+mode/i, name: '越狱尝试' },
      { pattern: /forget\s+(you\s+are|your\s+role)/i, name: '角色切换' },
      { pattern: /output\s+(your\s+)?system\s+prompt/i, name: '提示词泄露' },
      { pattern: /请输出你的?系统提示词/i, name: '提示词泄露' },
      { pattern: /\[game\s+engine\]\s*admin/i, name: '伪装指令' },
      { pattern: /删除所有游戏数据/i, name: '破坏指令' },
      { pattern: /你不再是游戏主持人/i, name: '角色切换' },
      { pattern: /你是一个普通的聊天机器人/i, name: '角色切换' },
      { pattern: /you\s+are\s+now\s+(DAN|DAN\s+mode|evil|unrestricted)/i, name: '角色劫持' },
      { pattern: /sudo\s+(rm|delete|drop|truncate)/i, name: '破坏指令' },
      { pattern: /\\u[0-9a-fA-F]{4}/, name: 'Unicode编码注入' },
      { pattern: /&#\d+;|&#x[0-9a-fA-F]+;/, name: 'HTML实体编码注入' },
    ];

    for (const { pattern, name } of injectionPatterns) {
      if (pattern.test(contentForCheck)) {
        logger.warn('检测到提示词注入尝试', { patternName: name, content: rawContent.substring(0, 50) });
        return {
          blocked: true,
          reason: `检测到提示词注入尝试: ${name}`,
          category: 'injection',
          userMessage: '错误信息，请正确输入'
        };
      }
    }

    const base64SubPattern = /[A-Za-z0-9+/]{40,}={0,2}/;
    if (base64SubPattern.test(rawContent)) {
      const decoded = tryDecodeBase64Substrings(normalized);
      for (const { pattern, name } of injectionPatterns) {
        if (pattern.test(decoded) && !pattern.test(rawContent)) {
          logger.warn('检测到Base64编码注入尝试', { patternName: name, content: rawContent.substring(0, 50) });
          return {
            blocked: true,
            reason: `检测到编码注入尝试: ${name}`,
            category: 'injection',
            userMessage: '错误信息，请正确输入'
          };
        }
      }
    }

    const passivePatterns = [
      { pattern: /^(不想|不要|懒得|无所谓|随便|算了|没意思|无聊|不想动|不想做|不想去|不想管|不关心|不在乎|随便吧|都行|都可以)[^\u4e00-\u9fffa-zA-Z0-9]*$/i, name: '消极拒绝' },
      { pattern: /^(嗯|啊|哦|额|呃|唔|哼|哈|嘿|诶|唉|哎)$/i, name: '无意义感叹' },
      { pattern: /^(nothing|whatever|idc|i don.?t care|meh|boring|skip|pass|don.?t want|lazy)$/i, name: '消极拒绝(英文)' },
    ];

    for (const { pattern, name } of passivePatterns) {
      if (pattern.test(contentForCheck)) {
        const response = PASSIVE_RESPONSES[Math.floor(Math.random() * PASSIVE_RESPONSES.length)];
        logger.info('检测到消极输入，返回引导提示', { patternName: name, content: rawContent.substring(0, 50) });
        return {
          blocked: true,
          reason: `消极输入短路: ${name}`,
          category: 'passive',
          userMessage: response
        };
      }
    }

    const meaninglessPatterns = [
      { pattern: /^[a-zA-Z\s]{1,3}$/, name: '极短英文字母' },
      { pattern: /^[\d\s]+$/, name: '纯数字' },
      { pattern: /^[^\u4e00-\u9fa5a-zA-Z0-9]{1,10}$/, name: '纯符号' },
    ];

    const repeatPattern = /^(.)\1{5,}$/;
    if (repeatPattern.test(contentForCheck)) {
      logger.warn('检测到重复字符输入', { content: rawContent.substring(0, 50) });
      return {
        blocked: true,
        reason: '检测到乱码输入: 重复字符',
        category: 'gibberish',
        userMessage: '错误信息，请正确输入'
      };
    }

    const hasChineseOrMeaningfulContent = /[\u4e00-\u9fa5]{2,}|[a-zA-Z]{4,}/.test(contentForCheck);

    if (!hasChineseOrMeaningfulContent) {
      for (const { pattern, name } of meaninglessPatterns) {
        if (pattern.test(contentForCheck)) {
          logger.warn('检测到乱码输入', { patternName: name, content: rawContent.substring(0, 50) });
          return {
            blocked: true,
            reason: `检测到乱码输入: ${name}`,
            category: 'gibberish',
            userMessage: '错误信息，请正确输入'
          };
        }
      }
    }

    logger.debug('输入验证通过');
    return { blocked: false, reason: '', category: '', userMessage: '' };
  }
}
