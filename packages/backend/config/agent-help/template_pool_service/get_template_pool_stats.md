---
tool: template_pool_service
method: get_template_pool_stats
description: "获取模板池统计信息(技能/物品数量及分类)"
summary: "获取模板池统计信息"
since: "1.0"
---

# template_pool_service.get_template_pool_stats

## 功能
获取当前模板池的统计信息，包括技能总数、物品总数及各分类的数量分布。用于快速了解模板池的规模和内容构成。

## 参数详解

无参数。

## 返回值

```typescript
{
  success: boolean;
  data?: {
    skillCount: number;       // 技能总数
    itemCount: number;        // 物品总数
    skillCategories: Record<string, number>; // 技能分类及数量
    itemCategories: Record<string, number>;  // 物品分类及数量
  };
  error?: string;
}
```

## 注意事项
- 只读操作，不修改游戏状态
- 返回的 skillCategories 和 itemCategories 是当前模板池中实际存在的分类，非固定枚举
- 可用于在调用 `list_template_skills` / `list_template_items` 前了解可用分类

## 常见错误

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| 返回数据为空 | 模板池尚未填充数据 | 先通过编辑器或生成端点填充模板池数据 |
