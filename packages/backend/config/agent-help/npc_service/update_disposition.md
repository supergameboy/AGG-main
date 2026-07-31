---
tool: npc_service
method: update_disposition
description: "更新NPC态度/心情"
summary: "更新NPC态度/心情"
paramTypes:
  npcId: "string (required) - NPC ID"
  disposition: "string (required) - 态度值(devoted/friendly/warm/neutral/cold/hostile/hated)"
returnType: "NPCProfile"
since: "1.0"
---

# npc_service.update_disposition

## 功能
更新NPC的态度/心情，这会影响NPC与角色交互时的对话选项和行为。态度值存储在NPC的 customData.disposition 中。

## 参数详解

### npcId（必填）
- **类型**: string
- **说明**: 要更新态度的NPC ID
- **来源**: 必须使用预加载上下文或 `list_npcs` 返回的真实ID，禁止编造ID

### disposition（必填）
- **类型**: string
- **说明**: NPC的新态度值
- **可选值**（7种态度，从最正面到最负面）:
  - `devoted` — 忠诚，最正面的态度
  - `friendly` — 友好，会提供更多对话选项和帮助
  - `warm` — 亲切，态度温和
  - `neutral` — 中立，标准交互模式
  - `cold` — 冷淡，回应简短
  - `hostile` — 敌对，可能拒绝交互或发起攻击
  - `hated` — 仇恨，最负面的态度

## 返回值

```typescript
NPCProfile // 更新后的NPC完整数据
```

NPCProfile 结构：

```typescript
{
  id: string;                    // NPC唯一ID
  saveId: string;                // 所属存档ID
  templateNpcId: string | null;  // 模板NPC ID
  name: string;                  // NPC名称
  title: string;                 // 头衔
  description: string;           // 外观与特征描述
  role: string;                  // 角色
  race: string;                  // 种族
  locationId: string | null;     // 当前位置ID
  level: number;                 // 等级
  services: Array<{ type: string; name: string }>;  // 提供的服务列表
  dialogueHistory: Array<{       // 对话历史
    speaker: string;
    content: string;
    emotion: string;
    timestamp: number;
  }>;
  inParty: boolean;              // 是否在队伍中
  joinedPartyAt: number | null;  // 加入队伍时间
  reputation: number;            // 声望值
  mood: number;                  // 心情值
  visible: boolean;              // 是否对玩家可见
  visibility?: {                 // 信息可见性控制
    attributes: 'hidden' | 'vague' | 'visible';
    hpMp: 'hidden' | 'bar_only' | 'visible';
    equipment: 'hidden' | 'outline' | 'visible';
    inventory: 'hidden' | 'count_only' | 'visible';
    skills: 'hidden' | 'category' | 'visible';
  };
  attrInitialized: boolean;      // 属性是否已初始化
  invInitialized: boolean;       // 物品是否已初始化
  skillInitialized: boolean;     // 技能是否已初始化
  relation?: string;             // 关系标签
  customData: Record<string, unknown>;       // 自定义数据（disposition存储在此字段中）
  currency: Record<string, number>;          // 货币
  attributes: Record<string, unknown>;       // 基础属性
  derivedAttributes: Record<string, unknown>; // 派生属性
  currentHp: number | null;      // 当前生命值
  maxHp: number | null;          // 最大生命值
  currentMp: number | null;      // 当前魔法值
  maxMp: number | null;          // 最大魔法值
}
```

## 注意事项
- 此方法为写操作，会修改NPC的态度数据
- 态度值存储在 customData.disposition 中，更新时会合并保留其他 customData 字段
- 态度变化应与游戏剧情和交互逻辑一致
- 态度与关系值不同：态度是NPC的整体情绪状态（手动设置），关系值是与特定目标的数值关系
- `get_npc_full_status` 返回的 disposition 是根据关系值自动映射的，与此方法手动设置的值是不同概念

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| NPC不存在 | npcId 错误 | 使用 `list_npcs` 确认有效的NPC ID |
| 无效的态度值 | disposition 传入了非枚举值 | 使用 devoted/friendly/warm/neutral/cold/hostile/hated 之一 |
