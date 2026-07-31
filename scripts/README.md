# scripts/

开发与测试脚本——PowerShell 7+ 工具集。

## 测试脚本

> 所有测试脚本使用正常游戏端点 `POST /api/v1/game`，与前端发送的请求格式一致。
> 仅通过 `GET /api/v1/dev/presets` 加载预设数据（只读辅助端点）。

| 脚本 | 用途 | 示例 |
|------|------|------|
| `dev-quick-init.ps1` | 快速初始化游戏（加载预设 → initialize） | `pwsh -File scripts/dev-quick-init.ps1 -Preset "medieval-fantasy/warrior"` |
| `dev-chat.ps1` | 发送对话消息 | `pwsh -File scripts/dev-chat.ps1 -SaveId "save-xxx" -Message "查看我的技能"` |
| `dev-ab-test.ps1` | A/B 测试（init+chat 或 chat-only） | `pwsh -File scripts/dev-ab-test.ps1 -Preset "..." -Message "..." -Label "test-1"` |
| `dev-ab-test.ps1` | A/B 测试（仅对话，复用已有存档） | `pwsh -File scripts/dev-ab-test.ps1 -SaveId "save-xxx" -Message "..." -Label "test-2"` |
| `dev-compare.ps1` | 对比两次 A/B 测试结果 | `pwsh -File scripts/dev-compare.ps1 -TestId1 "id1" -TestId2 "id2"` |

## 运维脚本

| 脚本 | 用途 |
|------|------|
| `backup.ps1` | 项目异地备份 |
| `analyze-log-errors.ps1` | 日志错误分析 |
| `extract-tool-errors.ps1` | 工具错误提取 |
| `extract-tool-errors-deep.ps1` | 工具错误深度提取 |
| `extract-bug-logs.ps1` | Bug 日志提取 |

## 规则

- 脚本语言：**PowerShell 7+**（`#Requires -Version 7.0`）
- 运行方式：`pwsh -File scripts/{script}.ps1`
- 日志落盘：测试结果必须 `> Out-File`，禁止仅终端输出
- **禁止直接调用 API**：测试必须通过脚本，禁止 `curl`/`Invoke-RestMethod`
- **禁止**放置业务代码或运行时代码
