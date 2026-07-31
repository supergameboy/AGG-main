---
tool: inventory_service
method: remove_pool_item
description: "从物品池中删除物品定义。"
summary: "从物品池中删除物品定义"
paramTypes:
  poolItemId: "string (required) - 物品池条目ID"
since: "1.0"
---

# inventory_service.remove_pool_item

## 功能
从物品池中删除指定物品定义。删除后该物品不可再被 `add_item_from_pool` 选取。

## 参数详解

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| poolItemId | string | 是 | 物品池条目ID |

**示例**:
```json
{ "poolItemId": "pool_烈焰之剑_1779730545205" }
```

## 返回值
```typescript
{ success: boolean }  // 是否删除成功
```

## 注意事项
- 删除后该物品定义不可再被 `add_item_from_pool` 选取
- 已选取到背包的物品实例不受影响，删除的仅是物品池中的定义
- 删除操作不可逆，如需恢复需重新通过 `add_pool_item` 添加

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| Pool item not found | poolItemId 不存在 | 使用 `list_pool_items` 获取有效的条目ID |
| 已被取用的物品仍可删除 | 删除的仅是物品池中的定义，已取用到背包的物品实例不受影响 | 确认无需保留后再删除 |
| 参数缺失 | 未提供 poolItemId | poolItemId 为必填参数 |
