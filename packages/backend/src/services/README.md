# packages/backend/src/services/

业务服务层——跨游戏系统的编排 + 基础设施服务。

## 核心服务

| 服务 | 职责 |
|------|------|
| `LLMService` | LLM 调用服务 |
| `ContextService` | 上下文管理 |
| `SaveService` | 存档 CRUD |
| `TemplateService` | 模板管理 |
| `GameService` | 游戏回合处理 |
| `WebSocketService` | WS 推送 |
| `StagingPool` | Agent 数据暂存池 |
| `ContextCompressor` | 上下文压缩 |
| `skill-registry/help-registry/rules-engine` | 注册表/规则引擎 |
| `DevModeService/DevTraceCollector` | 开发模式 |

## 规则

- **禁止**放置 HTTP 路由处理 → 应放 `routes/`
- **禁止**放置 Agent 推理循环 → 应放 `agents/`
- 跨系统编排放这里，单领域业务逻辑放 `game-systems/`
