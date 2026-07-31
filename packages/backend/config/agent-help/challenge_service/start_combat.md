---
tool: challenge_service
method: start_combat
description: "开始新战斗(初始化完整状态+读取角色属性)"
summary: "开始新战斗"
paramTypes:
  enemies: "array<unknown> (required) - 敌人模板数组。每个元素必须包含: name(名称), level(等级), currentHP或hp(当前生命值), maxHP或maxHp(最大生命值), attack(攻击力), defense(防御力), speed(速度,可选)"
  mode: "string (optional) - 挑战模式显式选择(可选,三层覆盖优先级最高层。不传则依次解析: GM覆盖(saves.active_challenge_mode) > 模板默认(default_challenge_mode) > 兜底turn_based_combat)"
returnType: "CombatState"
since: "1.0"
---

# combat_service.start_combat

## 功能
开始一场新战斗，初始化完整战斗状态并读取角色属性。系统会从数据库读取角色当前属性（HP/MP/派生属性），根据敌人模板创建敌人参与者，计算行动顺序，并将战斗状态持久化到数据库。这是战斗流程的入口方法，必须在其他战斗操作之前调用。

## 参数详解

### enemies (required)
敌人模板数组，每个元素描述一个敌人。数组至少包含一个敌人。

每个敌人模板支持以下字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| name | 是 | 敌人名称 |
| level | 是 | 敌人等级 |
| currentHP | 否 | 当前生命值（也可用 hp 字段替代，缺失时按 level×50 回退） |
| hp | 否 | 当前生命值（currentHP 的别名，缺失时按 level×50 回退） |
| maxHP | 否 | 最大生命值（也可用 maxHp 字段替代，缺失时按 level×50 回退） |
| maxHp | 否 | 最大生命值（maxHP 的别名，缺失时按 level×50 回退） |
| attack | 否 | 攻击力（缺失时按 level×5 回退） |
| defense | 否 | 防御力（缺失时按 level×3 回退） |
| speed | 否 | 速度（缺失时按 level×enemy_speed_factor 回退） |

当 currentHP/maxHP 缺失时，回退值为 level×50。

示例：
```json
[
  {"name": "哥布林战士", "level": 3, "currentHP": 150, "maxHP": 150, "attack": 30, "defense": 15, "speed": 8},
  {"name": "哥布林弓手", "level": 2, "hp": 100, "maxHp": 100, "attack": 25, "defense": 10}
]
```

### combatType (optional)
战斗类型，影响战斗规则和结算方式。默认值为 `encounter`（由模板配置决定）。

常见取值：
- `encounter`：普通遭遇战（默认）
- 其他自定义类型（由模板配置定义）

## 返回值
```typescript
interface CombatState {
  combatId: string;           // 战斗ID，格式如 combat_xxxxxxxx
  saveId: string;             // 存档ID
  active: boolean;            // 战斗是否进行中（初始为true）
  turn: number;               // 当前回合号（初始为1）
  round: number;              // 当前轮次号（初始为1）
  currentActorIndex: number;  // 当前行动者索引
  participants: CombatParticipant[];  // 所有参与者（玩家+敌人）
  log: CombatLogEntry[];      // 战斗日志（含初始 combat_started 条目）
  startedAt: number;          // 战斗开始时间戳
  lastActionAt: number;       // 最后行动时间戳
  combatType: string;         // 战斗类型
}

interface CombatParticipant {
  id: string;
  name: string;
  isPlayer: boolean;
  currentHP: number;
  maxHP: number;
  currentMP: number;
  maxMP: number;
  attack: number;
  defense: number;
  speed: number;
  level: number;
  statusEffects: StatusEffect[];
  isDefending: boolean;
  skills?: Array<{ name: string; baseDamage: number; multiplier?: number; cost?: Array<{type: string; amount: number}>; type?: string }>;
  expReward?: number;
  goldReward?: number;
}
```

## 注意事项
- 同一存档同一时间只能有一场活跃战斗。若已有未结束战斗，会覆盖旧战斗状态
- 角色属性从 characters 表实时读取，确保战斗前角色已创建且属性已初始化
- 玩家参与者的攻击/防御/速度优先取 derived_attributes，缺失时回退到基础属性映射
- 行动顺序由模板配置的 initiative_type 决定：`speed`（默认）按速度降序，`random` 随机排列
- 敌人速度缺失时按 level×enemy_speed_factor（默认2）计算回退值

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Character not found | 角色尚未创建 | 先确保角色已创建并初始化属性 |
| 敌人HP异常 | currentHP/maxHP 均未提供 | 传入 currentHP/maxHP 或 hp/maxHp 字段，否则使用 level×50 回退 |
