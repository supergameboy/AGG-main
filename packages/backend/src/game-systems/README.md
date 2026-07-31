# packages/backend/src/game-systems/

游戏业务系统——每个子目录 = 一个游戏领域的 Service + Tool + Types 三元组。

## 三元组规范

```
{domain}/
├── {Domain}Service.ts      # 业务逻辑（纯计算 + 数据库操作）
├── {Domain}ServiceTool.ts  # Agent 工具暴露（调用 Service，转换参数/结果）
└── types.ts                # 领域专用类型定义
```

## 领域目录

| 目录 | 领域 | 核心职责 |
|------|------|---------|
| `character/` | 角色 | 角色属性、创建选项生成 |
| `combat/` | 战斗 | 回合制战斗、伤害计算 |
| `dialogue/` | 对话 | NPC 对话管理 |
| `event/` | 事件 | 事件触发、EventBus 分发 |
| `init/` | 初始化 | 游戏初始化流程 |
| `inventory/` | 背包 | 物品管理、装备、使用 |
| `map/` | 地图 | 地点管理、导航、探索 |
| `npc/` | NPC | NPC 管理、关系、记忆、队伍 |
| `numerical/` | 数值 | 数值计算、治疗 |
| `quest/` | 任务 | 任务生命周期管理 |
| `skill/` | 技能 | 技能学习、使用、冷却 |
| `story/` | 故事 | 故事上下文、章节管理 |
| `template/` | 模板池 | 技能池/物品池管理 |
| `time/` | 时间 | 游戏时间推进 |
| `batch/` | 批量查询 | 跨领域批量数据查询 |
| `entity-graph/` | 实体图 | EntityGraphService/Builder/Updater/Auditor/SnapshotManager |

## 规则

- Service **不依赖** Agent 概念（不引用 ToolRegistry、ReActAgent 等）
- ServiceTool **只做**参数转换和调用 Service，不含业务逻辑
- Types **只定义**本领域专用类型，跨领域类型放 `services/` 或 `shared/`
- **禁止**放置 HTTP 路由 → 应放 `routes/`
- **禁止**放置 Agent 推理逻辑 → 应放 `agents/`
