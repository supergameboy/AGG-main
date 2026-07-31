---
tool: coordinator_service
method: batch_spawn_agents
description: "按波次批量调度子Agent，波内并行、波间串行"
summary: "按波次批量调度子Agent"
paramTypes:
  agents: "array<object{wave:number,agents:array}> (required)"
since: "1.0"
---

# coordinator_service.batch_spawn_agents

## 功能

按波次批量调度多个子 Agent。每波内的 Agent 并行执行，波与波之间串行等待（前一波全部完成后再启动下一波）。

适合有依赖关系的多阶段任务，如游戏初始化：
第一波 (map/skill/inventory) → 第二波 (npc_party) → 第三波 (quest)

## 参数详解

### agents（必填）

- **类型**: array
- **说明**: 分波任务列表，每个元素代表一个波次
- **数组元素结构**:
  - `wave`（number，必填）— 波次编号，从 1 开始递增，数字越小越先执行
  - `agents`（array，必填）— 该波次的子 Agent 列表
    - `agent_type`（string，必填）— 子 Agent 类型，如 map/skill/inventory/npc_party/quest
    - `task`（string，必填）— 任务描述
    - `action`（string，可选）— 动作类型，初始化场景使用各 Agent 的初始化动作（如 `location_init` / `skill_pool_init` / `item_pool_init` / `npc_create` / `generate`）
    - `context`（object，可选）— 额外上下文

## 调用示例

```json
{
  "agents": [
    {
      "wave": 1,
      "agents": [
        {
          "agent_type": "map",
          "task": "创建游戏世界地点：白杨村、暗影森林、龙脊山脉",
          "action": "location_init"
        },
        {
          "agent_type": "skill",
          "task": "初始化法师技能池并学习职业技能",
          "action": "skill_pool_init"
        },
        {
          "agent_type": "inventory",
          "task": "初始化物品池并添加背包物品和装备",
          "action": "item_pool_init"
        }
      ]
    },
    {
      "wave": 2,
      "agents": [
        {
          "agent_type": "npc_party",
          "task": "创建所有NPC并放置到对应位置",
          "action": "npc_create"
        }
      ]
    },
    {
      "wave": 3,
      "agents": [
        {
          "agent_type": "quest",
          "task": "创建主线任务和支线任务",
          "action": "generate"
        }
      ]
    }
  ]
}
```

## 返回值

```typescript
{
  results: AgentResponse[],    // 各子 Agent 的执行结果（含 taskStatus/actions/results）
  summary: {
    total: number,              // 总 Agent 数
    succeeded: number,          // 成功数
    failed: number,             // 失败数
    fallback: number,           // 降级数（Agent 不可用时的兜底）
    waves: number,              // 波次数
  },
  agentSummaries: [             // 子 Agent 任务摘要数组（GM 优先读取该字段校验）
    {
      agent_type: string,             // 如 "map"/"skill"/"inventory"/"npc_party"/"quest"
      success: boolean,                // 是否成功完成
      taskCompleted: boolean,          // 子 Agent 的 taskStatus.completed
      summary: string,                 // 一句话任务总结
      taskReport?: {                   // 子 Agent 主动输出的结构化任务报告（优先读取）
        summary: string,               // 任务总结
        changes: {
          created: Array<{ type: string; name: string; id?: string }>,
          updated: Array<{ type: string; name: string; id?: string; fields?: string[] }>,
          deleted: Array<{ type: string; name: string; id?: string }>,
        },
        keyDecisions?: string[],       // 关键决策说明（含改名原因等）
        startingLocationId?: string,   // 仅 map 子 Agent 输出
        startingLocationName?: string, // 仅 map 子 Agent 输出
      },
    }
  ],
  writeOperations: Array<{     // 各子 Agent 的写操作记录
    agent_type: string,
    operations: Array<{ table: string; action: string; entityId?: string }>,
  }>,
}
```

## 注意事项

- 此方法为写操作，会触发多个子 Agent 并行执行
- 波内 Agent 并行，波间串行等待依赖完成
- 初始化场景必须使用分波模式
- 单个波次内 Agent 无上限，但建议每波不超过 10 个
- **优先读取 `agentSummaries[i].taskReport`** 进行校验——子 Agent 主动输出的结构化任务报告比 `results[i].actions` 更可信。taskReport 缺失时才 fallback 到 `results[i].actions/results`
- **命名一致性校验**：检查 `taskReport.changes.created[].name` 是否与 task 描述一致，不一致且无 keyDecisions 说明时视为违规
- **起始位置校验**：map 子 Agent 的 `taskReport.startingLocationId` 必须对应 level=3 具体位置，否则需立即修正

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| agents参数必须是非空数组 | 未传入 agents 或传入空数组 | 按调用示例格式传入分波任务列表 |
| 子 Agent 类型不存在 | agent_type 值不在可用列表中 | 检查 `<available_agents>` 获取可用类型 |
| 波次执行失败 | 子 Agent 的任务描述不明确 | task 中明确说明操作目标、数量、数据来源 |
| taskReport 缺失 | 子 Agent 未输出 taskReport | fallback 读取 `results[i].actions/results` 兜底提取变更清单 |
| 起始位置层级错误 | map 子 Agent 返回的 startingLocationId 对应 level=2 地点 | 立即创建 level=3 子地点并修正起始位置 |
| 命名不一致 | 子 Agent 创建的实体名称与 task 不一致且无说明 | 视为违规，使用 task 中指定的名称补充创建实体 |
