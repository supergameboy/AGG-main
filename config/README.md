# config/

运行时 YAML 配置——Agent 系统的配置驱动数据源。

## 目录结构

| 目录 | 职责 | 内容格式 |
|------|------|---------|
| `agent-help/` | 工具帮助文档 | 按服务分子目录，每个方法一个 `.md` |
| `agent-profiles/` | Agent Profile | `.yaml` + `prompts/*.md` |
| `agent-rules/` | Agent 行为规则 | `always-apply/*.md` + `hooked/*.md` |
| `agent-skills/` | Agent 技能 | 按 Agent 类型分子目录的 `.md` |
| `dev-presets/` | 开发预设 | 按模板分，每个预设一个 `.yaml` |
| `templates/` | 游戏模板 | 每个模板一个 `.yaml` |
| `tools/` | 工具权限 | `data-tools.yaml`（ServiceTool 定义在代码 `*ServiceTool.ts`） |

## 根级配置文件

| 文件 | 职责 |
|------|------|
| `agent-context-rules.yaml` | 上下文注入规则 |
| `interaction-mapping.yaml` | 前端操作→action/intentHint 映射 |
| `keyword-rules.json` | 关键词规则 |

## 规则

- YAML 配置是**唯一数据源**，禁止在代码中硬编码覆盖
- 帮助文档命名：`{method_name}.md`
- 规则/技能命名：`{descriptive_name}.md`
- **禁止**放置 TypeScript 代码
