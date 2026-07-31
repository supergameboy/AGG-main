---
tool: coordinator_service
method: spawn_agent
description: "调度子Agent执行领域任务。子Agent是领域专家，拥有特定工具权限。如果没有对应类型的子Agent，不再硬失败，而是返回主Agent继续直执的fallback follow-up。"
summary: "调度子Agent执行领域任务"
paramTypes:
  agent_type: "string (required) - 目标子Agent类型。当前可用的子Agent类型见系统提示中的<available_agents>。"
  task: "string (required) - 给子Agent的任务描述"
  action: "string (optional) - 子Agent执行的动作类型。combat: attack/defend/flee, quest: accept/complete/abandon/list/generate, map: move/explore/describe, inventory: list/use/equip/unequip, npc_party: interact/party/relation, skill: list/use/learn, event: list/check/trigger, time: get/advance/wait。默认chat。"
  context: "object (optional) - 传递给子Agent的额外上下文"
  taskContract: "object (optional) - 方案H：任务契约，供审核Agent程序审。格式：{ description: \"任务描述\", expected: { counts: { skills: 5 }, states: { allLearned: true } } }。GM规定数量质量不规定具体名称（不传expected.names）"
since: "1.0"
---

# coordinator_service.spawn_agent

## 功能
调度子Agent执行领域任务。子Agent是领域专家，拥有特定工具权限。如果没有对应类型的子Agent，返回错误，此时请直接使用ServiceTool完成操作。

## 参数详解

### agent_type（必填）
- **类型**: string
- **说明**: 目标子Agent类型。当前可用的子Agent类型见系统提示中的 `<available_agents>`。
- **可选值**: map, combat, quest, npc_party, inventory, skill, numerical, event, time, output

### task（必填）
- **类型**: string
- **说明**: 给子Agent的任务描述，应清晰明确

### action（可选）
- **类型**: string
- **说明**: 子Agent执行的动作类型，默认 chat
- **各Agent可用action**:
  - combat: attack/defend/flee
  - quest: accept/complete/abandon/list/generate
  - map: move/explore/describe
  - inventory: list/use/equip/unequip
  - npc_party: interact/party/relation
  - skill: list/use/learn
  - event: list/check/trigger
  - time: get/advance/wait

### context（可选）
- **类型**: object
- **说明**: 传递给子Agent的额外上下文数据

## 返回值

```typescript
AgentResponse // 子Agent的执行结果
```

## 注意事项
- 此方法为写操作，会触发子Agent执行
- 子Agent拥有特定领域的工具权限，比GameMasterAgent直接操作更专业
- 如果没有对应类型的子Agent，返回错误，此时请直接使用ServiceTool完成操作
- 子Agent执行是同步的，会等待子Agent完成后返回结果

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 子Agent类型不存在 | agent_type 值不在可用列表中 | 检查系统提示中的 `<available_agents>` 获取可用类型 |
| 子Agent执行超时 | 任务过于复杂 | 简化任务描述，或拆分为多个子任务 |
