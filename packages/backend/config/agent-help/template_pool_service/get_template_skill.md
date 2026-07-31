---
tool: template_pool_service
method: get_template_skill
description: "获取模板技能池中指定技能的详情"
summary: "获取模板池中单个技能详情"
paramTypes:
  skillId: "string (required) - 模板技能ID"
since: "1.0"
---

# template_pool_service.get_template_skill

## 功能
获取模板池中指定技能的完整详细信息，包括消耗、伤害、效果、冷却等全部字段。

## 参数详解

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skillId | string | 是 | 模板技能ID（如 medieval-fantasy__fireball） |

## 返回值

```typescript
{
  success: boolean;
  data?: TemplateSkillPoolEntry;
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
- 技能ID必须存在于当前模板池中
- 可先通过 `list_template_skills` 浏览获取技能ID

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|------|------|---------|
| 模板技能未找到 | skillId 不存在 | 先调用 list_template_skills 确认正确的技能ID |
