---
tool: template_pool_service
method: list_template_skills
description: "查询模板技能池中的技能(可按分类和推荐职业过滤)"
summary: "按类别查询模板技能池"
paramTypes:
  category: "string (optional) - 按分类过滤(attack/defense/healing/buff/debuff/utility/passive)"
  recommendedClass: "string (optional) - 按推荐职业过滤(返回推荐该职业的技能+无职业限制的技能)"
since: "1.0"
---

# template_pool_service.list_template_skills

## 功能
按类别查询模板技能池，返回匹配的技能列表。用于初始化时浏览可用技能，按分类或推荐职业筛选后选取合适的技能。

## 参数详解

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| category | string | 否 | 按分类过滤。可选值: attack, defense, healing, buff, debuff, utility, passive |
| recommendedClass | string | 否 | 按推荐职业过滤（如 warrior, mage, rogue, priest）。返回 recommendedClasses 包含该职业的技能。**空数组=通用，任何职业筛选都命中** |

## 返回值

```typescript
{
  success: boolean;
  data?: TemplateSkillPoolEntry[];
  error?: string;
}

interface TemplateSkillPoolEntry {
  id: string;
  templateId: string;
  name: string;
  description: string;
  category: string;
  element: string;
  cost: SkillCostEntry[];
  damage: Record<string, unknown>;
  effects: Array<Record<string, unknown>>;
  cooldown: number;
  maxLevel: number;
  targetType: string;
  range: number;
  customData: Record<string, unknown>;
  recommendedClasses: string[];
  source: 'manual' | 'generated';
  createdAt: number;
  updatedAt: number;
}

interface SkillCostEntry {
  type: 'mp' | 'hp' | 'stamina' | 'currency' | 'item';
  amount: number;
  itemId?: string;
  currencyId?: string;
}
```

## 注意事项
- 只读操作，不修改游戏状态
- 不传任何参数时返回当前模板下所有技能
- recommendedClasses 为空数组的技能视为通用技能，任何职业筛选都会命中
- 返回的是模板池数据，需通过 `skill_service.learn_skill` 将技能学习到角色

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|------|------|---------|
| 返回空数组 | 筛选条件无匹配结果 | 调整 category 或 recommendedClass 参数，或不传参数查看全部 |
