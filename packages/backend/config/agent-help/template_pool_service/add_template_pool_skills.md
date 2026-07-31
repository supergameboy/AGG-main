---
tool: template_pool_service
method: add_template_pool_skills
description: "批量向模板技能池添加技能（仅模板生成路径可用，source自动设为generated）"
paramTypes:
  skills: "array (required) - 技能数组，每项包含: name(必填), description, category, element, icon, cost, damage, effects, cooldown, maxLevel, targetType, range, recommendedClasses"
since: "1.0"
returnsSummary: '{ success: boolean, data: TemplateSkillPoolEntry[], errors?: Array<{name: string, error: string}> }'
---

# template_pool_service.add_template_pool_skills

<!-- @manual: 本文件 frontmatter 由 generate-agent-help 自动维护，正文由人工维护 -->
<!-- 如需完全手工维护 frontmatter，在正文任意处添加 <!-- @manual-frontmatter --> 标记 -->

## 功能
批量向模板技能池添加技能，source 自动设为 generated。单次调用传入所有生成的技能，减少工具调用次数。

## 参数详解
| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skills | array | 是 | 技能数组，每项字段如下 |

### skills 数组每项字段
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 技能名称，需唯一 |
| description | string | 否 | 技能描述，默认空 |
| category | string | 否 | 分类: attack/defense/healing/buff/debuff/utility/passive，默认 attack |
| element | string | 否 | 元素: physical/fire/ice/lightning/holy/shadow/arcane，默认 physical |
| cost | array | 否 | 消耗列表 [{type: string, value: number}] |
| damage | object | 否 | 伤害数据 {base: number, scaling: number, stat: string} |
| effects | array | 否 | 效果列表 |
| cooldown | number | 否 | 冷却回合数，默认 0 |
| maxLevel | number | 否 | 最大等级，默认 10 |
| targetType | string | 否 | 目标类型: single/all/self/area，默认 single |
| range | number | 否 | 施法范围，默认 1 |
| recommendedClasses | array | 否 | 推荐职业列表，默认 [] |

## 返回值
```typescript
{
  success: boolean;
  data: TemplateSkillPoolEntry[];
  errors?: Array<{ name: string; error: string }>;
}
```

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| templateId 不可用 | 未在模板上下文中调用 | 确保在模板池生成路径中调用 |
| skills 数组不能为空 | 未传入 skills 参数 | 传入至少一个技能 |
| name 重复 | 同名技能已存在 | 检查已有技能列表，使用不重复的名称 |
