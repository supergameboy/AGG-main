---
tool: npc_service
method: update_npc
description: "更新NPC属性。传入attributes时程序自动调用NumericalService计算derivedAttributes/maxHp/maxMp并满血初始化currentHp/currentMp，LLM无需手动调calculate_derived_attributes"
summary: "更新NPC属性"
paramTypes:
  updates: "array<object{npcId:string,name:string,description:string,title:string,customData:object,role:string,race:string,level:number,mood:number,visible:boolean,locationId:string,attributes:string,currentHp:number,maxHp:number,currentMp:number,maxMp:number,visibility:object}> (required) - 要更新的NPC列表"
returnType: "NPCProfile"
since: "1.0"
---

# npc_service.update_npc

## 功能
批量更新NPC的属性，只需传入需要修改的字段。支持更新名称、描述、头衔、角色、种族、等级、心情、隐藏状态、位置和自定义数据等。当传入 locationId 时，会触发NPC位置迁移（等同 `move_npc`）。

## 参数详解

### updates（必填）
- **类型**: array
- **说明**: 要更新的NPC列表，支持批量更新
- **数组元素结构**:
  - `npcId`（string，必填）— NPC ID，支持 UUID、templateNpcId 或 NPC名称
  - `name`（string，可选）— 名称
  - `description`（string，可选）— 描述
  - `title`（string，可选）— 头衔
  - `customData`（object，可选）— 自定义数据，整体替换
  - `role`（string，可选）— 角色
  - `race`（string，可选）— 种族
  - `level`（number，可选）— 等级
  - `mood`（number，可选）— 心情
  - `visible`（boolean，可选）— 是否对玩家可见，设为 true 让玩家遇到该NPC
  - `locationId`（string，可选）— NPC的新位置ID，传入时会触发位置迁移（更新NPC的 location_id，同时更新新旧地点的 npcs 列表）
  - `attributes`（string，可选）— NPC基础属性 JSON 字符串，如 `{"strength":10,"agility":8}`。由 LLM 生成后写入，derivedAttributes 由 NumericalService 自动计算
  - `currentHp`（number，可选）— 当前生命值
  - `maxHp`（number，可选）— 最大生命值
  - `currentMp`（number，可选）— 当前魔法值
  - `maxMp`（number，可选）— 最大魔法值
  - `visibility`（object，可选）— NPC信息可见性控制，结构见 NPCVisibility 类型

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
- 此方法为写操作，会修改NPC数据
- 只需传入需要修改的字段，未传入的字段保持不变
- npcId 为必填项，支持 UUID、templateNpcId 或 NPC名称，**禁止编造ID**
- visible 设为 true 可让玩家遇到该NPC（常用于剧情推进后解锁新NPC）
- customData 传入时会整体替换，注意保留原有字段
- **当传入 locationId 时，会触发NPC位置迁移**：旧地点的 npcs 列表移除该NPC，新地点的 npcs 列表添加该NPC。此行为等同 `move_npc` 方法
- 如果不传任何可更新字段，返回当前NPC数据不做修改

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| NPC不存在 | npcId 错误 | 使用 `list_npcs` 确认有效的NPC ID |
| 更新失败 | npcId 未提供 | npcId 为必填参数 |
| 位置迁移失败 | locationId 对应的地点不存在 | 使用 `map_service.get_location` 确认地点ID |
| customData 丢失 | 传入的 customData 覆盖了原有字段 | 传入前先获取当前 customData，合并后再更新 |
