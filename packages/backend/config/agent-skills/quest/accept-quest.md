---
name: accept-quest
description: 处理任务接取流程
targetAgent: ["quest"]
trigger: [quest_accept, accept_quest]
whenToUse: 玩家决定接取某个可用任务时
recommendedTools: [quest_service, npc_service]
relatedRules: [quest-core, quest-accept-check]
completionCriteria: 任务状态已从available变为active、任务目标已展示
version: "2.0"
enabled: true
---

# 接取任务

## 任务是什么
验证任务可接取性，将可用任务激活为进行中状态，返回任务完整信息供玩家查看。

## 为什么有这个任务
任务接取需要验证前置条件、激活任务状态、展示任务目标。直接调用 `accept_quest` 跳过验证可能导致无效任务被接取，需要按流程执行。

## 完成的标准是什么
1. 已通过 `quest_service.get_available_quests` 获取可接取任务列表
2. 已通过 `quest_service.get_quest` 获取目标任务详情
3. 已通过 `quest_service.accept_quest` 接取任务，状态变为 active
4. 已通过 `npc_service.get_npc` 获取任务发布者信息（若任务关联NPC）
5. 返回结果包含：任务描述、目标列表、奖励信息

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `quest_service.get_available_quests` — 获取当前可接取的任务列表

2. 调用 `quest_service.get_quest` — 获取目标任务的完整详情

3. 参考条件信息 — 根据 `get_quest` 返回的条件字段判断接取合理性
   - `prerequisiteQuestIds`：前置任务ID列表，程序化强制校验，前置任务未完成时不可接取
   - `conditions.accept`：接取条件（如等级、属性等），仅供参考，LLM 根据游戏情境自主判断是否满足，不做程序化强制校验
   - `giverNpcId`：任务发布者NPC的ID，用于获取NPC信息和对话上下文
   - 若任务状态为 `locked`，需先调用 `quest_service.unlock_quest` 解锁后才能接取

4. 调用 `quest_service.accept_quest` — 接取任务，状态从 available 变为 active

5. 调用 `npc_service.get_npc` — 获取任务发布者NPC信息（若任务关联NPC）

### 注意事项
- 必须先通过 `get_available_quests` 确认任务在可接取列表中，不在列表中的任务不可接取
- `get_quest` 的 `quests` 参数是数组格式，即使只查一个任务也需传入数组
- `prerequisiteQuestIds` 是程序化强制校验的前置条件，前置任务未完成时接取会失败
- `conditions.accept` 仅供参考，LLM 根据游戏情境自主判断是否满足接取条件，不做程序化强制校验
- 若任务状态为 `locked`，需先调用 `quest_service.unlock_quest` 解锁后才能接取
- 若任务关联 `giverNpcId`，获取NPC信息用于展示对话上下文
- 接取失败时（前置未完成、任务不存在等），需返回失败原因

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "任务接取完成",
  "data": {
    "questId": "",
    "questName": "",
    "status": "active",
    "objectives": [],
    "rewards": {},
    "questGiver": null
  }
}
```
