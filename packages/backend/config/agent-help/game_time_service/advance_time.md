---
tool: game_time_service
method: advance_time
description: "推进游戏时间，根据行动类型计算时间流逝"
summary: "推进游戏时间"
paramTypes:
  actionType: "string (required) - 行动类型: dialogue/move/explore/combat/trade/rest/use_item/quest_complete/save/status/cast_skill/quest_accept"
  distance: "number (optional) - 移动距离(仅move时需要)"
  restHours: "number (optional) - 休息小时数(仅rest时需要)"
since: "1.0"
---

# game_time_service.advance_time

## 功能
根据行动类型推进游戏时间。不同类型的行动消耗不同的时间量，系统会自动计算时间推进量并更新游戏时间。这是游戏时间推进的唯一写入方法。

## 参数详解

### actionType（必填）
- **类型**: string
- **说明**: 触发时间推进的行动类型
- **可选值及默认时间消耗**:

| actionType | 说明 | 基础时间消耗 | 实际范围（含方差） | 备注 |
|---|---|---|---|---|
| `dialogue` | 与NPC交谈 | 10分钟 | 8~12分钟 | ±20%随机浮动 |
| `move` | 移动到新位置 | 15分钟 | 12~36分钟 | 受distance影响(15~30)，再±20%浮动 |
| `explore` | 探索区域 | 20分钟 | 16~24分钟 | ±20%随机浮动 |
| `combat` | 战斗（含前后整理） | 30分钟 | 24~36分钟 | ±20%随机浮动 |
| `trade` | 商店交易 | 10分钟 | 8~12分钟 | ±20%随机浮动 |
| `rest` | 休息 | 60分钟 | 依restHours×60计算后±20%浮动 | 受restHours参数覆盖 |
| `use_item` | 使用物品 | 5分钟 | 4~6分钟 | ±20%随机浮动 |
| `quest_complete` | 提交任务 | 10分钟 | 8~12分钟 | ±20%随机浮动 |
| `save` | 存档 | 0分钟 | 0分钟 | 不计入游戏时间 |
| `status` | 查看状态 | 0分钟 | 0分钟 | 不计入游戏时间 |
| `cast_skill` | 释放技能 | 0分钟 | 0分钟 | 包含在战斗/对话中 |
| `quest_accept` | 接取任务 | 5分钟 | 4~6分钟 | ±20%随机浮动 |

- **时间浮动规则**: 所有非零基础时间消耗会有 ±20% 的随机浮动（variancePercent=0.2），最终值不低于1分钟

### distance（可选）
- **类型**: number
- **说明**: 移动距离，仅 actionType 为 `move` 时使用
- **影响**: 时间消耗 = baseMinutes + (range - baseMinutes) × min(distance/100, 1)，即距离越远时间消耗越多，上限为 range 值

### restHours（可选）
- **类型**: number
- **说明**: 休息时长（小时），仅 actionType 为 `rest` 时使用
- **影响**: 直接覆盖默认的60分钟基础值，按 restHours × 60 计算时间消耗

## 返回值

```typescript
interface TimePassageResult {
  previousTime: GameTime;    // 推进前的游戏时间
  newTime: GameTime;         // 推进后的游戏时间
  minutesPassed: number;     // 本次推进的分钟数
  periodChanged: boolean;    // 时间段是否发生变化
  dayPassed: boolean;        // 是否跨天
  actionType: string;        // 触发本次推进的行动类型
}

interface GameTime {
  totalMinutes: number;      // 从游戏开始累计的总分钟数
  day: number;               // 游戏天数（从1开始）
  hour: number;              // 当前小时（0-23）
  minute: number;            // 当前分钟（0-59）
  periodOfDay: PeriodOfDay;  // 当前时段
  season: Season;            // 当前季节
}

type PeriodOfDay = 'dawn' | 'morning' | 'noon' | 'afternoon' | 'evening' | 'night' | 'midnight';
type Season = 'spring' | 'summer' | 'autumn' | 'winter';
```

## 注意事项
- 这是写操作，会修改游戏状态（持久化到数据库）
- actionType 必须为枚举值之一，否则 minutesPassed 为 0
- 当 minutesToAdd ≤ 0 时（如 save/status/cast_skill），返回 previousTime === newTime，minutesPassed=0
- 时间推进可能触发时段变化（periodChanged）和跨天（dayPassed），其他系统可据此触发事件
- move 类型需配合 distance 参数，rest 类型需配合 restHours 参数，否则使用默认值

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| minutesPassed 为 0 | actionType 值无效或为 save/status/cast_skill | 使用有效枚举值；save/status/cast_skill 不消耗时间 |
| move 时间消耗偏少 | 未传 distance 参数 | move 类型需传入 distance 以获得合理的时间消耗 |
| rest 时间消耗为默认1小时 | 未传 restHours 参数 | rest 类型需传入 restHours 以覆盖默认值 |
