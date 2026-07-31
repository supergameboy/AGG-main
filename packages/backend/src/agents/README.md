# packages/backend/src/agents/

Agent 系统核心——定义 Agent 基类、ReAct 推理引擎、工具注册表、Agent 初始化编排。

## 子目录

| 目录 | 职责 |
|------|------|
| `config/` | Agent 配置加载与实例化（ConfigLoader、YamlAgentFactory、ReActAgent） |
| `coordinator/` | Agent 协调层（输入验证、结果整合、响应构建、数据刷新） |
| `runtime/` | Agent 运行时状态管理（快照、钩子、恢复策略、工具暴露预算） |
| `story/` | 故事驱动层（指令生成、后处理管线、连续性审计） |
| `tools/` | Agent 内部服务工具（协调器/技能/帮助/规则/动态UI 按需加载） |
| `prompt/` | 系统提示词构建（layers + blocks + composers + tool-set） |

## 核心文件

- `BaseAgent.ts` — Agent 抽象基类
- `ReActEngine.ts` — ReAct 推理循环（思考→工具调用→观察→回答）
- `ToolRegistry.ts` — 工具注册 + 权限检查（双层：BaseTool + 注册表）
- `AgentFactory.ts` — Agent 工厂
- `init.ts` — Agent 系统初始化

## 规则

- **禁止**放置业务逻辑（战斗/任务/NPC 等）→ 应放 `game-systems/`
- **禁止**放置 HTTP 路由 → 应放 `routes/`
- **禁止**直接数据库操作 → 应通过 `game-systems/` 的 Service
