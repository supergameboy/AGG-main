---
tool: npc_service
method: create_npc
description: "创建NPC到游戏世界。LLM需传入完整的NPC属性（性格、背景、能力等），程序自动分配ID，返回含真实ID的完整NPC数据"
summary: "创建NPC到游戏世界"
paramTypes:
  npcs: "array<object{name:string,role:string,race:string,locationId:string,description:string,personality:string,background:string,abilities:string,disposition:string,level:number,services:array,title:string,visible:boolean}> (required) - 要创建的NPC列表，每个元素需提供完整的NPC属性"
returnType: "NPCProfile"
since: "1.0"
---

# npc_service.create_npc

## 功能
批量创建NPC到游戏世界。LLM需要为每个NPC提供完整的属性信息（性格、背景、能力等），不再依赖模板。程序会为每个新NPC自动分配唯一ID（格式如 `npc_铁匠_1779730545205`），返回包含真实ID的完整NPC数据。创建后的NPC可用于后续所有操作。

## 参数详解

### npcs（必填）
- **类型**: array
- **说明**: 要创建的NPC列表，支持批量创建
- **数组元素结构**:
  - `name`（string，必填）— NPC名称
  - `role`（string，必填）— NPC角色，如 merchant、guard、healer、quest_giver、warrior、mage、thief、scholar、commoner 等
  - `race`（string，必填）— NPC种族，如 human、elf、dwarf、orc、halfling、gnome、dragonborn 等
  - `locationId`（string，必填）— NPC所在地点ID或名称(如"白杨村")，支持名称自动解析
  - `description`（string，可选）— NPC外观与特征描述，如"身材魁梧的矮人，满脸络腮胡，手臂粗壮有力"
  - `personality`（string，可选）— NPC性格描述，如"温和友善但固执，对陌生人保持警惕"等
  - `background`（string，可选）— NPC背景故事，如身世、经历、为何出现在此地等
  - `abilities`（string，可选）— NPC能力描述，如技能、特长、战斗方式等
  - `disposition`（string，可选）— NPC对玩家的初始态度，devoted/friendly/warm/neutral/cold/hostile/hated，默认neutral
  - `level`（number，可选）— NPC等级，默认1
  - `services`（array，可选）— NPC提供的服务列表，每个元素为 `{ type: string; name: string }` 对象
    - `type`（string）— 服务类型，如 `trade`、`quest`、`secret` 等
    - `name`（string）— 服务名称
    - 示例: `[{ "type": "trade", "name": "商店" }, { "type": "quest", "name": "任务" }]`
  - `title`（string，可选）— NPC头衔，如"铁匠大师"等
  - `visible`（boolean，可选）— 是否对玩家可见，默认 false。设为 true 则玩家立即遇到该NPC（如起始NPC）

## 返回值

```typescript
NPCProfile // 新创建的NPC完整数据（含系统分配的真实ID）
```

NPCProfile 结构：

```typescript
{
  id: string;                    // NPC唯一ID（系统自动分配，格式 npc_{名称}_{时间戳}）
  saveId: string;                // 所属存档ID
  templateNpcId: string | null;  // 自由创建的NPC为null
  name: string;                  // NPC名称
  title: string;                 // 头衔
  description: string;           // 外观与特征描述
  role: string;                  // 角色
  race: string;                  // 种族
  locationId: string | null;     // 当前位置ID
  level: number;                 // 等级
  services: Array<{ type: string; name: string }>;  // 提供的服务列表
  dialogueHistory: Array<{       // 对话历史（新建时为空）
    speaker: string;
    content: string;
    emotion: string;
    timestamp: number;
  }>;
  inParty: boolean;              // 是否在队伍中（新建时为false）
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
  attrInitialized: boolean;      // 属性是否已初始化（新建时为false）
  invInitialized: boolean;       // 物品是否已初始化（新建时为false）
  skillInitialized: boolean;     // 技能是否已初始化（新建时为false）
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

## 创建示例

```json
{
  "npcs": [{
    "name": "铁匠格鲁姆",
    "role": "merchant",
    "race": "dwarf",
    "locationId": "白杨村",
    "description": "身材魁梧的矮人，满脸络腮胡，手臂粗壮有力，围裙上满是锻造痕迹",
    "personality": "粗犷豪爽，对朋友慷慨大方，对陌生人保持警惕，对武器锻造有着近乎偏执的热爱",
    "background": "来自铁锤堡的矮人铁匠世家，因与族长争执而离家出走，辗转来到白杨村开设铁匠铺，已有十年",
    "abilities": "精通武器锻造与矿石鉴定，能打造精良级武器，擅长使用战锤战斗",
    "disposition": "warm",
    "level": 8,
    "services": [{ "type": "trade", "name": "武器锻造" }, { "type": "quest", "name": "寻找稀有矿石" }],
    "title": "铁匠大师",
    "visible": true
  }]
}
```

## 注意事项
- 此方法为写操作，会创建新的NPC数据
- **必须提供必填属性**：name、role、race、locationId 为必填项，description/personality/background 为可选项
- **locationId 支持ID或名称(如"白杨村")，系统自动解析**；也可使用 `map_service.get_location` 获取真实地点ID
- NPC ID 由系统自动分配（格式 `npc_{名称}_{时间戳}`），后续操作必须使用返回的真实ID
- 不再设置 template_npc_id，自由创建的NPC不关联模板
- personality、background、abilities 存储在 customData 中，可通过 get_npc 获取
- visible 默认为 false，起始NPC应设为 true
- 创建NPC后属性/物品/技能均为未初始化状态（attr_initialized=0, inv_initialized=0, skill_initialized=0），首次交互时通过懒加载技能初始化
- 创建NPC时会自动将NPC ID添加到目标地点的 npcs 列表中
- 批量创建时每个元素都会被独立处理

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 地点不存在 | locationId 错误 | 使用 `map_service.get_location` 确认有效的地点ID或名称 |
| 必填参数缺失 | name/role/race/locationId 未提供 | 确保提供所有必填参数 |
| 名称重复 | 多个NPC同名 | 考虑添加区分性前缀或后缀 |
