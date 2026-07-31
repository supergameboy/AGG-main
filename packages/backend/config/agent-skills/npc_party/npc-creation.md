---
name: npc-creation
description: 创建新NPC到游戏世界
targetAgent: ["npc_party"]
trigger: [npc_create]
whenToUse: 需要在世界中添加新NPC、剧情发展需要新角色登场时
recommendedTools: [npc_service, map_service, game_init_service]
relatedRules: [npc-core]
completionCriteria: NPC已创建并分配真实ID、NPC已放置到指定地点
version: "2.0"
enabled: true
---

# 创建NPC

## 任务是什么
根据剧情需要创建新NPC，分配到游戏世界的指定地点，获取系统分配的真实ID。

## 为什么有这个任务
剧情发展需要动态创建NPC，创建过程需要确定NPC属性、指定放置地点、验证创建结果。创建后获取的真实ID是后续NPC交互（对话、交易、战斗）的必要前提。

## 完成的标准是什么
1. 已通过 `map_service.get_current_location` 确认角色当前位置（用于确定NPC放置地点）
2. 已通过 `npc_service.create_npc` 创建NPC，获取系统分配的真实ID
3. 已通过 `npc_service.get_npcs_by_location` 验证NPC已出现在目标地点
4. 返回结果包含：NPC真实ID、名称、属性、所在地点

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `game_init_service.get_template_data({ sections: ["starting_scene"] })` — 获取 `starting_scene.npcs` 中的 stats 数据，作为 NPC 属性生成的参考基线
2. 调用 `map_service.get_current_location` — 获取角色当前位置（当未指定NPC放置地点时使用当前位置）
3. 调用 `npc_service.create_npc` — 创建NPC并获取系统分配的真实ID
4. 调用 `npc_service.get_npcs_by_location` — 验证NPC已出现在目标地点

### 注意事项
- `create_npc` 的 `npcs` 参数是数组格式，支持批量创建，但每次创建应确保属性完整
- `locationId` 为必需属性，若未指定放置地点则使用 `get_current_location` 获取当前位置ID
- 创建后必须通过 `get_npcs_by_location` 验证NPC确实出现在目标地点
- NPC的 `role` 和 `race` 需符合游戏世界设定，不可随意填写
- 创建返回的真实ID是后续所有NPC操作的唯一标识，必须记录并返回
- **懒加载**：NPC创建后属性/物品/技能均为未初始化状态（attr_initialized=0, inv_initialized=0, skill_initialized=0）
- 属性在首次查看/战斗时由 `npc-attribute-init` skill按需生成
- 物品在首次交易/偷窃/战斗时由 `npc-equipment-init` skill按需生成
- 技能在首次技能交互/战斗时由 `npc-skill-init` skill按需生成
- 不需要创建后立即初始化所有数据，减少LLM调用次数

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "NPC创建完成",
  "data": {
    "npcId": "",
    "name": "",
    "role": "",
    "race": "",
    "level": 1,
    "locationId": "",
    "locationName": ""
  }
}
```

### 输出约束（最高优先级）
- `npc_create` 任务最终 JSON 输出**仅包含** `npcs` 数组 + `taskReport` 字段
- **禁止输出** `npcName`/`npcResponse` 字段（这些字段仅用于 `npc_interact` 任务）
- **禁止生成场景叙事内容**（如"清晨的阳光...""你站在广场上..."），场景叙事由 OutputAgent/GameMaster 负责
