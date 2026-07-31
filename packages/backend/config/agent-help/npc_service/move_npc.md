---
tool: npc_service
method: move_npc
description: "将NPC迁移到新地点。迁移后应使用add_npc_memory为NPC记录位置变更记忆(类型event,内容描述从哪迁到哪)"
summary: "将NPC迁移到新地点"
paramTypes:
  moves: "array<object{npcId:string,locationId:string}> (required) - NPC迁移列表"
since: "1.0"
---

# npc_service.move_npc

## 功能
将NPC迁移到新的地点。迁移时会验证目标地点是否存在，并自动更新旧地点和新地点的NPC列表。迁移完成后应使用 `add_npc_memory` 为NPC记录位置变更记忆（类型 event，内容描述从哪迁到哪）。

## 参数详解

### moves（必填）
- **类型**: array
- **说明**: NPC迁移列表，支持批量迁移
- **数组元素结构**:
  - `npcId`（string，必填）— NPC ID，可使用 UUID、templateNpcId 或 NPC 名称
  - `locationId`（string，必填）— 目标地点ID，**必须使用预加载上下文中的真实地点ID**，禁止编造ID

## 返回值
```typescript
{
  id: string;          // NPC ID
  name: string;        // NPC名称
  locationId: string;  // 迁移后的新地点ID
}
```

## 注意事项
- 此方法为写操作，会修改NPC的位置数据
- **locationId 必须来自预加载上下文中的真实地点ID，禁止编造ID**
- 迁移前会验证目标地点是否存在，不存在则抛出错误
- 迁移会自动更新旧地点和新地点的NPC列表（从旧地点移除，添加到新地点）
- 迁移后建议使用 `add_npc_memory` 为NPC记录位置变更记忆，类型为 event，内容描述从哪迁到哪
- 批量迁移时每个元素都会被独立处理

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| NPC not found | npcId 不存在或编造 | 使用 `list_npcs` 或预加载上下文获取真实NPC ID |
| Target location not found | locationId 不存在或编造 | 使用 `map_service.get_location` 或预加载上下文获取真实地点ID |
| NPC位置未变 | 迁移到当前所在地点 | 确认目标地点与NPC当前位置不同 |
