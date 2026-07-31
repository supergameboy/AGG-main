---
tool: npc_service
method: list_npcs
description: "获取存档中所有NPC列表(含完整信息：id/name/role/race/level/location/description/services/reputation/mood/inParty/visible)。输出NPC数据时必须使用返回的真实ID，禁止编造ID"
summary: "获取所有NPC列表"
paramTypes:
  visibility: "string (optional) - 可见性过滤：不传=只返回玩家可见的NPC，\"all\"=返回全部NPC(含不可见)，\"visible\"=只返回可见的NPC，\"hidden\"=只返回不可见的NPC"
returnType: "NPCProfile[]"
since: "1.0"
---

# npc_service.list_npcs

## 功能
获取当前存档中的所有NPC列表，返回每个NPC的完整详情。支持按可见性过滤，默认仅返回玩家已遇到的NPC。

## 参数详解

### visibility（可选）
- **类型**: string
- **说明**: 按NPC可见性过滤结果
- **可选值**:
  - 不传参数 — 仅返回可见NPC（默认行为）
  - `"all"` — 返回全部NPC
  - `"visible"` — 仅返回可见NPC
  - `"hidden"` — 仅返回不可见NPC
- **默认行为**: 不传此参数时仅返回可见NPC

## 返回值

```typescript
NPCProfile[] // 按名称升序排列
```

每个 NPCProfile 结构：

```typescript
{
  id: string;                    // NPC唯一ID（系统分配）
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
  customData: Record<string, unknown>;       // 自定义数据
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
- **输出NPC数据时必须使用返回的真实ID，禁止编造ID**
- 隐藏NPC是玩家尚未遇到的，不应在对话中透露其存在
- 如需获取特定NPC的更详细信息，可使用 `get_npc` 或 `get_npc_full_status` 方法

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 返回空列表 | 无匹配的NPC或存档未初始化 | 确认游戏已完成初始化，或调整 visibility 参数 |
| 使用了编造的NPC ID | 未使用返回的真实ID | 必须使用此方法返回的id字段值 |
