---
name: continuity-audit
description: 审查游戏世界的连续性，发现并修复不一致
targetAgent: [gamemaster]
trigger: []
whenToUse: 长时间游戏后需要检查世界一致性、发现叙事矛盾时
recommendedTools: [npc_service, map_service, quest_service, coordinator_service]
relatedRules: [data-integrity]
completionCriteria: 不一致问题已识别并修复、世界状态已校正
version: "2.0"
enabled: true
---

# 连续性审查

## 任务是什么
审计游戏世界的一致性，通过交叉验证角色位置、NPC分布、任务进度、实体关系等数据，检测逻辑矛盾和信息冲突，并修复发现的不一致问题。

## 为什么有这个任务
长时间游戏后，多次状态变更可能产生数据矛盾：NPC出现在不可能的位置、任务进度与故事事件不对齐、实体关系图出现断裂等。这些问题如果不定期审计和修复，会累积导致叙事矛盾和逻辑错误，影响游戏体验。

## 完成的标准是什么
1. 通过 `entity_graph_service.get_entity_relations` 已获取实体关系数据
2. `npc_service.get_npc` 已获取关键NPC的状态数据用于交叉验证
3. `map_service.get_current_location` 已获取角色位置数据
4. `quest_service.list_quests` 已获取任务进度数据
5. 发现的不一致问题已逐条记录（包含实体ID、矛盾描述、修复方案）
6. 修复操作已通过对应服务执行并返回成功状态码
7. output Agent已生成审计报告叙事

## 怎么完成任务

### 调用什么子Agent派发什么任务
- 子Agent类型：output（审计报告叙事）
- 派发任务描述：根据审计结果生成审计报告叙事
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "output",
    "task": "生成连续性审计报告",
    "action": "narrate_audit_report",
    "context": {
      "issuesFound": 2,
      "issues": [
        {
          "entityType": "npc",
          "entityId": "npc-merchant-01",
          "issue": "NPC位于酒馆但关系图显示在市场",
          "fixApplied": "已将NPC位置更新为市场"
        },
        {
          "entityType": "quest",
          "entityId": "quest-main-03",
          "issue": "任务目标已完成但任务状态仍为进行中",
          "fixApplied": "已将任务状态更新为可完成"
        }
      ],
      "totalEntitiesChecked": 15
    }
  }
  ```

### 注入哪些条目的信息
1. 从 `entity_graph_service.get_npc_profile` 获取 NPC 画像+关系数据（含认识程度、关系倾向评分），用于验证 NPC 认知与关系是否合理
2. 从 `entity_graph_service.get_location_summary` 获取地点概览（含 NPC/物品/子地点/连接），用于验证地点内容一致性
3. 从 `npc_service.get_npc` 获取关键NPC的完整状态，用于验证NPC位置、关系值是否与画像数据一致
4. 从 `map_service.get_current_location` 获取角色当前位置，用于验证角色位置与场景是否匹配
5. 从 `quest_service.list_quests` 获取所有任务列表，用于验证任务进度与故事事件是否对齐

### 注意事项
1. 使用 `get_entity_relations` 查询实体关系，使用 `get_npc_profile` 查询 NPC 画像
2. 交叉验证的核心检查项：
   - 角色位置与当前场景是否匹配
   - NPC位置与其实体关系是否矛盾
   - 任务进度与已完成的故事事件是否对齐
   - 实体关系是否存在断裂引用（引用了不存在的实体）
   - 对话-数据一致性：如果对话文本中提到物品给予（如"给玩家地图"、"这是玩家的奖励"）、金币获得、技能学习等数据操作，检查 writeOperations 中是否有对应的工具调用（inventory_service.add_item、character_service 修改金币等）。如果对话提到了数据操作但 writeOperations 中没有对应记录，应提示补充数据操作或修正对话内容
3. 修复操作必须针对根本原因，不可仅修改表面数据。例如NPC位置矛盾时，需根据故事上下文判断正确位置，而非随机选择
4. 修复NPC位置使用 `npc_service.move_npc`，修复任务状态使用 `quest_service.update_objective` 或 `quest_service.complete_quest`
5. 审计结果需完整记录，即使未发现不一致也应输出"审计通过"的报告

### 收到子Agent返回的结果之后执行什么操作
1. **判断子Agent任务是否成功**：检查output Agent返回的narrative字段是否为非空字符串
2. **成功后更新状态**：审计报告为只读输出，无需额外状态更新；修复操作已在审计过程中通过对应服务执行
3. **失败后处理**：
   - output Agent失败：审计数据仍有效，使用结构化文本格式输出审计结果作为兜底
   - 修复操作失败：记录失败的修复项，在审计报告中标注"修复失败需人工介入"，不回滚已成功的修复
4. **最终向玩家输出**：将output Agent生成的审计报告叙事返回给玩家，包含发现的问题数量、已修复的问题和待处理的问题

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "连续性审计完成",
  "data": {
    "totalEntitiesChecked": 15,
    "issuesFound": 2,
    "issuesFixed": 2,
    "issuesPending": 0,
    "auditPassed": true
  }
}
```
