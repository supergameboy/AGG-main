---
tool: map_service
method: delete_location
description: "删除地点"
summary: "删除地点"
paramTypes:
  locationId: "string (required) - 要删除的地点ID"
since: "2.0"
---

# map_service.delete_location

## 功能
删除指定的地点。删除前会检查该地点是否仍有NPC驻留或角色当前位置在此，如有则拒绝删除。

## 参数详解

### locationId（必填）
- **类型**: string
- **说明**: 要删除的地点ID
- **来源**: 必须使用预加载上下文返回的真实地点ID，禁止编造ID

## 返回值
```typescript
// 删除成功
{ success: true, data: { deleted: true } }

// 地点不存在
{ success: false, data: { deleted: false } }
```

## 注意事项
- 此方法为写操作，会永久删除地点数据，操作不可逆
- **安全检查**：如果地点仍有NPC驻留，抛出异常拒绝删除（需先移动NPC）
- **安全检查**：如果角色当前位置在此地点，抛出异常拒绝删除（需先移动角色到其他地点）
- 地点不存在时返回 `{ success: false, data: { deleted: false } }`，不抛出异常
- 删除前请确认没有任务依赖该地点
- 谨慎使用此方法，建议仅在确实需要移除地点时调用

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 地点不存在 | locationId 错误 | 使用 `search_locations` 确认有效地点 |
| 仍有NPC驻留 | 地点中还有NPC | 先使用 `npc_service.update_npc` 将NPC移动到其他地点 |
| 角色当前位置在此 | 角色位于被删除地点 | 先使用 `npc_service.move_to` 将角色移动到其他地点 |
