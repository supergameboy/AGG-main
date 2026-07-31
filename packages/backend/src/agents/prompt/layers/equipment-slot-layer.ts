import type { PromptLayer, PromptContext, LayerBuildOutput } from '../types.js';
import type { ITemplateProvider } from '../../../game-systems/shared/types.js';
import { createChildLogger } from '../../../utils/logger.js';

const logger = createChildLogger('equipment-slot-layer');

/**
 * EquipmentSlotLayer — 装备槽配置动态注入层
 *
 * 从当前存档的模板配置加载 equipment_slots，注入为 systemPrompt 文本块。
 * 可装备/不可装备 category 从 equipment_slots 配置动态推导（union of all accepted_item_types），
 * 而非写死静态文本，确保提示词与 YAML 数据驱动的真实配置始终一致。
 *
 * 仅对 inventory Agent 注入（装备操作由 inventory Agent 执行）。
 * 注入顺序：order=14，在 RulesLayer(15) 之前，作为数据上下文。
 */
export class EquipmentSlotLayer implements PromptLayer {
  readonly name = 'equipment_slots';
  readonly order = 14;

  async build(ctx: PromptContext): Promise<LayerBuildOutput> {
    // 仅 inventory Agent 需要装备槽信息
    if (ctx.agentKey !== 'inventory') {
      return { content: null, metadata: { reason: 'not_inventory_agent' } };
    }

    const templateId = ctx.templateId;
    const templateProvider = ctx.domain?.templateProvider as ITemplateProvider | undefined;
    if (!templateId || !templateProvider) {
      return { content: null, metadata: { reason: 'no_templateId_or_provider' } };
    }

    try {
      const inventoryRules = await templateProvider.getInventoryRules(templateId);
      const slots = inventoryRules.equipment_slots;

      if (!slots || slots.length === 0) {
        return { content: null, metadata: { reason: 'no_equipment_slots_configured' } };
      }

      // 动态推导可装备 category：出现在任意槽位 accepted_item_types 中的类型
      const equippableTypes = new Set<string>();
      for (const slot of slots) {
        for (const t of slot.accepted_item_types) {
          equippableTypes.add(t);
        }
      }

      // 全量 category（与 InventoryService 中可创建的物品类型保持一致）
      const allCategories = ['weapon', 'armor', 'accessory', 'tool', 'consumable', 'material', 'quest', 'misc'];
      const nonEquippable = allCategories.filter(c => !equippableTypes.has(c));

      // 数组化槽位（capacity>1）渲染时追加"，容量N”标注，让 LLM 识别可装多个物品
      const slotLines = slots.map(s => {
        const capacitySuffix = s.capacity && s.capacity > 1 ? `，容量${s.capacity}` : '';
        return `- ${s.id}（${s.name}${capacitySuffix}）：${s.accepted_item_types.join(', ')}`;
      });

      const content = `<equipment_slots>
当前存档装备槽配置（数据源：模板 YAML，程序运行时按此校验）：
${slotLines.join('\n')}

可装备 category（出现在某槽位的 accepted_item_types 中）：${[...equippableTypes].join(', ')}
不可装备 category（未出现在任何槽位）：${nonEquippable.join(', ')}
</equipment_slots>`;

      return {
        content,
        metadata: {
          slotCount: slots.length,
          equippableTypes: [...equippableTypes],
          nonEquippableTypes: nonEquippable,
        },
      };
    } catch (error) {
      logger.warn('Failed to load equipment slots for prompt injection', {
        templateId,
        agentKey: ctx.agentKey,
        error: error instanceof Error ? error.message : String(error),
      });
      return { content: null, metadata: { reason: 'load_failed' } };
    }
  }
}
