---
name: complete-quest
description: 处理任务完成和奖励发放
targetAgent: ["quest"]
trigger: [quest_complete]
whenToUse: 任务所有目标已达成、玩家提交任务完成时
recommendedTools: [quest_service, numerical_service, inventory_service, character_service, skill_service]
relatedRules: [quest-core, quest-complete-reward]
completionCriteria: 任务已标记完成、奖励已发放、任务链已推进
version: "2.0"
enabled: true
---

# 完成任务

## 任务是什么
验证任务所有目标是否达成，完成任务并发放经验、金币、物品奖励，检查后续任务链是否解锁。

## 为什么有这个任务
任务完成涉及目标验证、状态变更和多类型奖励发放，需要按顺序调用多个服务确保数据一致性。跳过验证直接完成可能导致未达成目标的任务被关闭。

## 完成的标准是什么
1. 已通过 `quest_service.check_completion` 验证任务目标全部达成
2. 已通过 `quest_service.complete_quest` 将任务状态标记为 completed
3. 已通过 `numerical_service.add_experience` 发放经验奖励
4. 已通过 `inventory_service.add_item` 发放物品奖励
5. 已通过 `character_service.modify_currency` 发放金币奖励
6. 已通过 `skill_service.learn_skill` 发放技能奖励（若奖励包含技能）
7. 返回结果包含：发放的奖励明细、是否解锁后续任务

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 `quest_service.check_completion` — 检查任务所有目标是否已达成

2. 调用 `quest_service.complete_quest` — 完成任务，状态变为 completed

3. 调用 `numerical_service.add_experience` — 发放经验奖励

4. 调用 `inventory_service.add_item` — 发放物品奖励

5. 调用 `character_service.modify_currency` — 发放金币奖励

6. 调用 `skill_service.learn_skill` — 发放技能奖励（若奖励包含技能）

7. 调用 `quest_service.get_available_quests` — 检查是否有后续任务解锁

### 注意事项
- 必须先调用 `check_completion` 验证目标全部达成，未达成则不可调用 `complete_quest`
- 奖励发放顺序：经验 → 金币 → 货币 → 物品 → 技能，确保经验升级后的属性加成先于物品装备，技能最后发放
- 任务奖励配置从 `complete_quest` 返回结果中获取，不可硬编码
- 物品奖励可能为空（任务只给经验和金币），此时不需要调用 `add_item`
- 后续任务解锁通过对比 `get_available_quests` 完成前后列表差异确认
- 任务完成后会触发 `quest_completed` 事件，自动解锁依赖该任务的 locked 任务
- 完成当前任务后，检查 `questChainId`，如果同链有后续 locked 任务，会自动解锁
- 若 `check_completion` 返回不可完成，需返回未达成目标列表供玩家参考

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "任务完成并发放奖励",
  "data": {
    "questId": "",
    "questName": "",
    "status": "completed",
    "rewards": {
      "experience": 0,
      "currency": 0,
      "items": []
    },
    "leveledUp": false,
    "unlockedQuests": []
  }
}
```
