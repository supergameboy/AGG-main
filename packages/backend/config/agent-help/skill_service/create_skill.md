---
tool: skill_service
method: create_skill
description: "自由创建技能(写入技能池,可选是否立即学习)"
summary: "创建技能到技能池"
paramTypes:
  skills: "array<object{name:string,description:string,category:string,element:string,cost:array,maxLevel:number,damage:object,scalingStat:string,cooldown:number,effects:array,skillType:string,targetType:string,range:number,customData:object,visible:boolean,learn:boolean,ownerType:string,ownerId:string}> (required) - 要创建的技能列表"
since: "1.1"
---

# skill_service.create_skill

## 功能
创建新技能到技能池，可选是否立即学习。默认只添加到技能池（learn=false），设置 learn=true 则同时学习。

## 参数详解

### skills（required）
- **类型**: array
- **说明**: 要创建的技能数组，每个元素包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| name | string | 是 | 技能名称 |
| description | string | 否 | 技能描述，不传默认空字符串 |
| category | string | 否 | 技能类别，默认 `"attack"`。可选值：attack/defense/healing/buff/debuff/utility/passive |
| element | string | 否 | 元素属性，默认 `"none"`。可选值：fire/water/earth/wind/light/dark/physical/none |
| cost | array | 否 | 消耗数组，如 `[{type:"mp",amount:20},{type:"stamina",amount:5}]`，默认空数组 |
| maxLevel | number | 否 | 最大等级，默认 10 |
| damage | object | 否 | 伤害数据，如 `{base:10, min:5, max:15, scaling:"strength*0.5"}` |
| cooldown | number | 否 | 冷却回合数，默认 0 |
| effects | array | 否 | 效果列表，如 `[{type:"damage",value:10,target:"enemy"}]` |
| targetType | string | 否 | 目标类型，默认 `"single"`。可选值：single/self/aoe/all |
| range | number | 否 | 技能范围，默认 1 |
| customData | object | 否 | 自定义数据，默认空对象 |
| visible | boolean | 否 | 是否对玩家可见，默认 true（创建即可见）。设为 false 则对玩家不可见 |
| learn | boolean | 否 | 是否立即学习，默认 false（只添加到技能池） |
| ownerType | string | 否 | 拥有者类型：不传=默认角色(character)，"npc"=NPC创建技能 |
| ownerId | string | 否 | 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID) |

### cost 消耗数组格式
```typescript
// SkillCostEntry
{
  type: 'mp' | 'hp' | 'stamina' | 'currency' | 'item';  // 消耗类型
  amount: number;                                         // 消耗数量
  itemId?: string;                                        // item类型时的物品ID
  currencyId?: string;                                    // currency类型时的货币ID
}
```

示例：
- 纯MP消耗: `[{type:"mp",amount:20}]`
- MP+体力消耗: `[{type:"mp",amount:15},{type:"stamina",amount:5}]`
- 消耗物品: `[{type:"item",amount:1,itemId:"herb_001"}]`

## 返回值

```typescript
// LearnSkillResult
{
  success: boolean;          // 是否创建成功
  skill?: CharacterSkill;    // learn=true时返回技能实例
  poolSkillId?: string;      // 技能池中的技能ID
  error?: string;            // 失败原因
}
```

## 注意事项
- 这是写操作，会修改游戏状态
- 默认 learn=false，只添加到技能池，角色不会获得该技能
- 设置 learn=true 时，等同于 add_pool_skill + learn_skill 一步完成
- 与 `learn_skill` 的区别：`create_skill` 创建新技能，`learn_skill` 从技能池学习已有技能
- 技能池ID格式: `pool_{name}_{timestamp}`
- cost 支持多种资源消耗组合，使用技能时所有资源必须同时满足

## 常见错误
| 错误 | 原因 | 解决方案 |
|------|------|---------|
| 创建失败 | 缺少必填字段 name | 确保 name 已填写 |
| 数据库写入失败 | name 包含特殊字符 | 使用常规字符命名技能 |
