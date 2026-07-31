---
tool: npc_service
method: get_npc
description: "获取NPC详情(含完整属性)"
summary: "获取NPC详情"
paramTypes:
  npcs: "array<object{npcId:string}> (required) - 要获取的NPC列表"
returnType: "NPCProfile"
since: "1.0"
---

# npc_service.get_npc

## 功能
批量获取指定NPC的完整属性详情。通过NPC ID列表查询，返回每个NPC的所有属性信息。支持使用UUID、templateNpcId或NPC名称作为查询标识。

## 参数详解

### npcs（必填）
- **类型**: array
- **说明**: 要获取的NPC列表，支持批量查询
- **数组元素结构**:
  - `npcId`（string，必填）— NPC标识，支持三种形式：
    - UUID（如 `npc_铁匠_1779730545205`）
    - templateNpcId（如 `medieval-fantasy__blacksmith`）
    - NPC名称（如 `铁匠`，名称匹配不唯一时取第一条）

## 返回值

```typescript
NPCProfile
{
  id: string;                    // NPC唯一ID（系统分配）
  saveId: string;                // 所属存档ID
  templateNpcId: string | null;  // 模板NPC ID（自由创建的NPC为null）
  name: string;                  // NPC名称
  title: string;                 // 头衔
  description: string;           // 外观与特征描述
  role: string;                  // 角色（merchant/guard/healer等）
  race: string;                  // 种族（human/elf/dwarf等）
  locationId: string | null;     // 当前位置ID
  level: number;                 // 等级
  services: Array<{              // 提供的服务列表
    type: string;                // 服务类型（trade/quest/secret等）
    name: string;                // 服务名称
  }>;
  dialogueHistory: Array<{       // 对话历史
    speaker: string;             // 发言者
    content: string;             // 内容
    emotion: string;             // 情感
    timestamp: number;           // 时间戳
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
  customData: Record<string, unknown>;       // 自定义数据（含personality/background/abilities/disposition等）
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
- 此方法为只读操作，不会修改任何NPC数据
- npcId 支持多种标识形式，系统按 UUID → templateNpcId → 名称 的顺序解析
- 批量查询时，每个元素都会独立解析
- 如需获取更全面的聚合信息（含关系、服务等），可使用 `get_npc_full_status` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| NPC不存在 | npcId 错误或编造 | 使用 `list_npcs` 确认有效的NPC ID |
| 名称匹配到错误NPC | 同名NPC存在 | 使用UUID精确匹配 |
| 数组为空 | 未传入必填参数 | 至少提供一个有效的 npcId |
