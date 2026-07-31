/**
 * ClientIdGenerator 单元测试
 *
 * 验证：
 * - generate() 格式校验（client_<uuid>）
 * - validate() 正常路径 / 边界值 / 错误路径
 * - 前后端一致性（generate + validate 互逆）
 */

import { describe, it, expect } from 'vitest';
import { ClientIdGenerator } from '../client-id-generator.js';

describe('ClientIdGenerator', () => {
  // ── generate() ──

  describe('generate()', () => {
    it('应返回 client_ 前缀格式', () => {
      const id = ClientIdGenerator.generate();
      expect(id).toMatch(/^client_[a-f0-9-]+$/);
    });

    it('应每次返回不同的 clientId', () => {
      const id1 = ClientIdGenerator.generate();
      const id2 = ClientIdGenerator.generate();
      const id3 = ClientIdGenerator.generate();
      expect(id1).not.toBe(id2);
      expect(id2).not.toBe(id3);
      expect(id1).not.toBe(id3);
    });

    it('生成的 clientId 应能通过 validate 校验', () => {
      const id = ClientIdGenerator.generate();
      expect(ClientIdGenerator.validate(id)).toBe(true);
    });
  });

  // ── validate() 正常路径 ──

  describe('validate() 正常路径', () => {
    it('应接受 client_<uuid> 格式', () => {
      expect(ClientIdGenerator.validate('client_550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    });

    it('应接受 client_ + 字母数字下划线短横线', () => {
      expect(ClientIdGenerator.validate('client_abc123_DEF-456')).toBe(true);
    });

    it('应接受 generate() 生成的 id', () => {
      const id = ClientIdGenerator.generate();
      expect(ClientIdGenerator.validate(id)).toBe(true);
    });
  });

  // ── validate() 边界值 ──

  describe('validate() 边界值', () => {
    it('应接受长度恰好的 client_ + 100 字符（最大长度）', () => {
      // 'client_' = 7 字符，uuid 最多 36 字符，但允许更长
      // MAX_LENGTH = 100，所以 client_ + 93 字符的合法字符应该通过
      const suffix = 'a'.repeat(93);
      const id = `client_${suffix}`;
      expect(id.length).toBe(100);
      expect(ClientIdGenerator.validate(id)).toBe(true);
    });

    it('应拒绝长度超过 100 的 clientId', () => {
      const suffix = 'a'.repeat(94);
      const id = `client_${suffix}`;
      expect(id.length).toBe(101);
      expect(ClientIdGenerator.validate(id)).toBe(false);
    });

    it('应接受最短合法 client_<单字符>', () => {
      expect(ClientIdGenerator.validate('client_a')).toBe(true);
    });
  });

  // ── validate() 错误路径 ──

  describe('validate() 错误路径', () => {
    it('应拒绝空字符串', () => {
      expect(ClientIdGenerator.validate('')).toBe(false);
    });

    it('应拒绝纯 uuid（无 client_ 前缀）— 修复前后端不一致', () => {
      // 前端当前使用纯 uuid，后端 validate 应拒绝，强制使用 ClientIdGenerator.generate()
      expect(ClientIdGenerator.validate('550e8400-e29b-41d4-a716-446655440000')).toBe(false);
    });

    it('应拒绝 client_ 前缀但后为空', () => {
      expect(ClientIdGenerator.validate('client_')).toBe(false);
    });

    it('应拒绝无 client_ 前缀的字符串', () => {
      expect(ClientIdGenerator.validate('user_123')).toBe(false);
      expect(ClientIdGenerator.validate('abc')).toBe(false);
    });

    it('应拒绝含非法字符的 clientId（空格、中文、特殊符号）', () => {
      expect(ClientIdGenerator.validate('client_ abc')).toBe(false);
      expect(ClientIdGenerator.validate('client_中文')).toBe(false);
      expect(ClientIdGenerator.validate('client_abc!')).toBe(false);
      expect(ClientIdGenerator.validate('client_abc@def')).toBe(false);
    });

    it('应拒绝 client_ 前缀大小写错误', () => {
      expect(ClientIdGenerator.validate('Client_abc')).toBe(false);
      expect(ClientIdGenerator.validate('CLIENT_abc')).toBe(false);
    });
  });

  // ── 前后端一致性 ──

  describe('前后端一致性', () => {
    it('generate() + validate() 互逆：生成 100 次均通过校验', () => {
      for (let i = 0; i < 100; i++) {
        const id = ClientIdGenerator.generate();
        expect(ClientIdGenerator.validate(id)).toBe(true);
      }
    });
  });
});
