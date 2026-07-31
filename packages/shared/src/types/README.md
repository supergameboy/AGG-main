# packages/shared/src/types/

前后端共享类型定义——前后端数据契约的唯一来源。

## 类型文件

| 文件 | 职责 |
|------|------|
| `api.ts` | API 请求/响应通用类型 |
| `core.ts` | 核心基础类型 |
| `game.ts` | 游戏领域类型 |
| `agent.ts` | Agent 相关类型 |
| `agent-coordination.ts` | 跨层共享的 Agent 协调类型（UnifiedPostReviewDecision + AuditIssue，打破 agents↔services 类型依赖） |
| `agent-config.ts` | Agent 配置类型 |
| `dynamic-ui.ts` | 动态 UI 类型 |
| `template.ts` | 模板类型 |
| `i18n.ts` | 国际化类型 |
| `model-config.ts` | 模型配置类型 |
| `execution-trace.ts` | 执行追踪类型 |
| `errors.ts` | 跨层共享错误类型（如 ContextOverflowError，仅做属性赋值，无业务逻辑） |

## 规则

- 修改任何共享类型时，**必须**确认前后端均能编译通过
- 后端专用类型放 `packages/backend/src/types/`
- 前端专用类型放 `packages/frontend/src/types/`
- **禁止**放置运行时逻辑（`errors.ts` 例外：仅限简单 Error 子类，构造函数只做属性赋值，用于打破跨层循环依赖）
