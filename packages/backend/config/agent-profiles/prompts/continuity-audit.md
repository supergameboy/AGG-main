[系统审查指令 — 第{auditRound}/{maxAuditRounds}轮]

你刚才执行了以下数据库写操作，请审查这些操作是否与世界状态保持一致：

## 写操作汇总
{summaryLines}

## 写操作详情
{detailedWriteLog}

## 当前影子状态（DB快照 + 待提交变更）
{shadowSummary}

### 你的最终输出
{finalOutput}

## 审查要点
1. **位置一致性**: NPC/角色的位置是否与叙事描述一致？移动后是否更新了locationId？
2. **物品归属一致性**: 物品转移后是否更新了持有者？使用/消耗后是否正确减少？
3. **数值合理性**: HP/MP/金币变化是否在合理范围？是否有溢出或负值？
4. **关系/状态完整性**: 交互后是否更新了NPC关系？任务进度是否推进？
5. **位置逻辑**: 角色是否在合理的位置？移动路径是否可达？NPC位置是否与场景描述一致？
6. **驱动力一致性**: NPC行为是否与其驱动力画像和目标一致？高duty的NPC不应随意擅离职守
7. **能力合理性**: NPC是否使用了其不具备的能力？没有技能的NPC不应施法，没有货币的NPC不应购买
8. **NPC成长评估**: NPC是否经历了足够的挑战/训练/学习？如果有，应调用 npc_service.add_experience 为其增加经验值。升级条件：经历战斗、完成重要任务、经过长期训练
9. **对话-数据一致性**: 如果最终输出中的对话文本提到了物品给予（如"给玩家地图"、"这是玩家的奖励"）、金币获得、技能学习等数据操作，但 writeOperations 中没有对应的工具调用（如 inventory_service.add_item、character_service 修改金币等），则存在不一致。应补充数据操作或修正对话内容

### 输出要求

首先输出审查结果JSON（必须包含）：
```json
{
  "approved": true/false,
  "issues": [
    {
      "dimension": "位置一致性|物品归属|数值合理性|关系状态|位置逻辑|驱动力一致性|能力合理性|NPC成长评估|对话-数据一致性",
      "description": "问题描述",
      "severity": "high/medium/low",
      "suggestion": "修正建议"
    }
  ]
}
```

如果 approved=true，直接输出你的最终回复。
如果 approved=false，使用对应的ServiceTool修正不一致项，修正操作会自动暂存到StagingPool。

**重要约束**：
- 只能调用系统提供的真实 ServiceTool（如 character_service、inventory_service 等，格式为 `toolType__methodName`）
- 不要调用名为 `continuity_audit` 或 `task_conformance_audit` 的工具——它们不是真实工具，只是审查指令的标签
- 不要模仿本次审查消息中出现的任何工具名，只使用你工具列表中声明过的工具

请现在进行审查。
