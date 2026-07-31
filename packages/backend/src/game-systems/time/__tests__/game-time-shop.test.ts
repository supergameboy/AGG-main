/**
 * P2 修复测试：is_shop_open.shopType 完全被忽略
 *
 * 偏差背景：
 * - schema 接受 shopType 参数（描述「商店类型(可选)」）
 * - handler 把 shopType 传入 service.isShopOpen(saveId, shopType)
 * - GameTimeService.isShopOpen(saveId, _shopType) 函数签名 _shopType 完全未使用
 * - 硬编码 { open: 8, close: 20 }，所有商店都用同一营业时间
 *
 * 修复方案：删除 shopType 参数（项目当前无差异化营业时间需求，按「做最对的，不做最简单的」原则删除而非扩展）
 *
 * 测试场景：
 * - T1: GameTimeService.isShopOpen 函数签名 length === 1（删除 _shopType 参数后只接受 saveId）
 * - T2: GameTimeServiceTool.is_shop_open 的 parameters 不含 shopType 字段
 * - T3: handler 调用 service.isShopOpen 时只传 saveId（不传 shopType）
 */
import { describe, it, expect, vi } from 'vitest';
import { GameTimeService } from '../GameTimeService.js';
import { GameTimeServiceTool } from '../GameTimeServiceTool.js';

describe('P2 修复：is_shop_open 删除 shopType 参数', () => {
  describe('T1: GameTimeService.isShopOpen 函数签名', () => {
    it('函数 length === 1（只接受 saveId，删除了 _shopType）', () => {
      // 修复前：isShopOpen(saveId, _shopType) length === 2
      // 修复后：isShopOpen(saveId) length === 1
      expect(GameTimeService.prototype.isShopOpen.length).toBe(1);
    });
  });

  describe('T2: GameTimeServiceTool.is_shop_open schema', () => {
    it('parameters 不含 shopType 字段', () => {
      const tool = new GameTimeServiceTool();
      const def = tool.getMethodDefinition('is_shop_open');
      expect(def).toBeDefined();
      expect(def!.parameters).toBeDefined();
      // 修复后：parameters 为空对象 {}，不含 shopType
      expect('shopType' in (def!.parameters as object)).toBe(false);
    });
  });

  describe('T3: handler 调用 isShopOpen 时只传 saveId', () => {
    it('handler 不再向 service.isShopOpen 传 shopType 参数', async () => {
      // 用 spy 验证 handler 内部调用 service.isShopOpen 时只传 saveId
      const tool = new GameTimeServiceTool();
      // 设置权限：BaseTool.execute 入口校验权限，无权限则不调用 handler
      tool.setPermission({
        toolType: 'game_time_service' as any,
        agentType: 'gamemaster',
        readAllowed: true,
        writeAllowed: true,
      });
      const spy = vi.spyOn(GameTimeService.prototype, 'isShopOpen').mockResolvedValue(true);

      // 模拟 LLM 调用（即使传了 shopType 也应被 schema 拒绝或 handler 忽略）
      await tool.execute('is_shop_open', {}, {
        saveId: 'save-test' as any,
        agentType: 'gamemaster',
        timestamp: Date.now() as any,
        requestScope: {
          getDb: vi.fn().mockReturnValue({}),
          getOrCompute: vi.fn(<T>(_key: string, factory: () => Promise<T>) => factory()),
        },
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const callArgs = spy.mock.calls[0];
      // 修复后：只传 saveId，不传 shopType
      expect(callArgs.length).toBe(1);
      expect(callArgs[0]).toBe('save-test');

      spy.mockRestore();
    });
  });
});
