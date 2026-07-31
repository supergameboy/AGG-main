---
tool: challenge_service
method: select_challenge_mode
description: "设置挑战模式覆盖(GM覆盖,持久化到saves.active_challenge_mode)"
summary: "设置挑战模式覆盖"
paramTypes:
  mode: "string (required) - 挑战模式(narrative_combat/turn_based_combat/dynamic_combat/puzzle/mini_game/stealth)"
since: "1.0"
---

# challenge_service.select_challenge_mode

## 功能
设置挑战模式覆盖，将指定的 ChallengeMode 持久化到 `saves.active_challenge_mode` 字段。后续调用 `start_combat` 时会读取此覆盖值作为战斗模式，而不使用模板配置的 `default_challenge_mode`。

GM 在创建战斗前可通过此方法动态切换挑战模式（例如将原本的回合制战斗切换为叙事战斗）。

## 参数详解

### mode (required)
挑战模式，必须是以下 6 种 ChallengeMode 之一：

| 取值 | 中文 | 说明 |
|------|------|------|
| `narrative_combat` | 叙事战斗 | GM 全权控制，无回合无数值，靠 narrate_combat 推进 |
| `turn_based_combat` | 回合制战斗 | 双方按速度顺序轮流行动（标准 RPG 模式） |
| `dynamic_combat` | 动态战斗 | 双方同时排队动作，由 queue_action + execute_turn 执行 |
| `puzzle` | 解谜挑战 | 由 Agent G 路径处理，禁止走 G2 程序路径 |
| `mini_game` | 小游戏挑战 | 由 Agent G 路径处理，禁止走 G2 程序路径 |
| `stealth` | 潜行挑战 | 由 Agent G 路径处理，禁止走 G2 程序路径 |

## 返回值
```typescript
{
  success: boolean;       // 操作是否成功
  data?: {                // 成功时返回
    mode: string;         // 已设置的挑战模式（与入参一致）
    message: string;      // 确认信息，如"挑战模式已设置为 turn_based_combat，后续 startCombat 将使用此覆盖"
  };
  error?: string;         // 失败时返回错误信息
}
```

## 注意事项
- 此方法仅写入覆盖标记，**不会立即启动战斗**。后续需调用 `start_combat` 才会真正按此模式开始战斗
- 若不调用此方法，`start_combat` 将使用模板配置的 `default_challenge_mode` 作为默认模式
- `puzzle` / `mini_game` / `stealth` 三种模式由 Agent G 路径处理，**禁止进入 G2 程序执行层**（runtime 会抛错拦截）
- 此方法会经 StagingPool 代理写入 DB（13.1 合规），不绕过影子状态机制

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Invalid challenge mode | mode 参数不是 6 种合法 ChallengeMode 之一 | 检查 mode 拼写，确保在枚举范围内 |
| Save not found | saveId 不存在或已删除 | 确认存档存在且未被销毁 |
