---
tool: challenge_service
method: narrate_combat
description: "叙事战斗专用:GM描述战斗动作(不修改数值,仅推进叙事)"
summary: "叙事战斗动作"
paramTypes:
  action: "string (required) - 动作描述(如\"挥剑斩向哥布林\")"
  description: "string (required) - GM对动作结果的叙事描述"
  targetId: "string (optional) - 目标参与者ID或名称(13.2 name/id兼容,从ChallengeState.participants匹配)"
since: "1.0"
---

# challenge_service.narrate_combat

## 功能
叙事战斗专用方法，由 GM 在 `narrative_combat` 模式下调用，描述战斗动作并推进叙事。

与 `execute_turn` 不同，此方法**不修改任何战斗数值**（HP/MP/状态效果均不变），仅通过 `narrative-strategy` 策略写入叙事日志，让 GM 全权控制战斗节奏与结果。

适用于：
- 不需要严格数值判定的剧情战斗
- GM 描述性的连贯叙事（如"玩家挥剑斩落，哥布林惨叫倒地"）
- 战斗中插入事件、对话、环境互动等叙事元素

## 参数详解

### action (required)
动作的简短描述，作为叙事日志的动作部分。例如：
- `"挥剑斩向哥布林"`
- `"施放火球术"`
- `"翻滚躲避"`

### description (required)
GM 对动作结果的叙事描述，将作为日志主体。可包含：
- 动作结果（命中/未中/暴击）
- 视觉/听觉/触觉描述
- 对目标的影响（恐惧/愤怒/受伤等情感反应）

### targetId (optional)
目标参与者的 ID 或名称。**支持 13.2 name/id 双兼容**：
- 传入 ID：精确匹配 `ChallengeState.participants[].id`
- 传入名称：模糊匹配 `ChallengeState.participants[].name`
- 不传：表示无明确目标的动作（如范围攻击、自我增益）

## 返回值
```typescript
{
  success: boolean;       // 操作是否成功
  data?: {               // 成功时返回
    description: string;      // GM 叙事描述（与入参 description 一致）
    combatEnded: boolean;    // 战斗是否结束（叙事模式始终为 false，由 GM 决定何时调用 end_combat）
    hint: string;            // 操作提示，如"叙事战斗由 GM 控制，可继续 narrate_combat 或 end_combat 结束"
  };
  error?: string;        // 失败时返回错误信息
}
```

## 注意事项
- **仅适用于 narrative_combat 模式**。若当前不是叙事战斗，调用此方法会失败（建议先调用 `select_challenge_mode('narrative_combat')` + `start_combat`）
- 不修改数值：HP/MP/状态效果均保持不变，仅推进叙事日志
- 战斗结束由 GM 显式调用 `end_combat` 决定，`combatEnded` 始终返回 `false`
- targetId 通过内存匹配 `ChallengeState.participants` 实现 name/id 兼容（不调用 DB 查询）
- 此方法会经 StagingPool 代理写入 DB（13.1 合规）

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 无进行中的战斗，请先调用 start_combat | 当前没有活跃战斗 | 先调用 `start_combat` 启动战斗 |
| 战斗已结束 | 战斗状态 active=false | 战斗已结束，无需继续 narrate |
| 未找到目标参与者: xxx | targetId 在 participants 中无匹配 | 检查 targetId 拼写，或使用 `get_combat_state` 查看当前 participants |
