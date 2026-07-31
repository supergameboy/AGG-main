---
tool: skill_service
method: learn_skill
description: "从技能池学习技能(检查前置条件和等级要求)。传入技能名称即可，程序会自动从存档技能池→模板技能池→创建新技能的三级路径匹配。若技能已学习，会增量更新非黑名单字段（visible/level/exp等）"
summary: "学习技能到角色"
paramTypes:
  skills: "array<object{name:string,visible:boolean,level:number,exp:number,ownerType:string,ownerId:string,description:string,category:string,element:string,cost:array,damage:object,effects:array,cooldown:number,maxLevel:number,targetType:string,range:number,customData:object}> (required) - 要学习的技能列表"
since: "1.1"
---

# skill_service.learn_skill

## 功能
学习技能到角色。内置三级查找：存档技能池→模板池复制→字段完整则创建并回写模板池。传入技能名称即可一步完成。

## 参数详解

### skills（required）
- **类型**: array
- **说明**: 要学习的技能数组，每个元素包含以下字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| skillIdOrName | string | 是 | 技能池中的技能ID或名称，系统自动三级匹配：存档技能池→模板池复制→字段完整则创建 |
| name | string | 否 | 技能名称（三级查找未命中时，用于创建新技能） |
| description | string | 否 | 技能描述（创建新技能时使用） |
| category | string | 否 | 技能分类：attack/defense/healing/buff/debuff/utility/passive |
| element | string | 否 | 元素属性：fire/water/earth/wind/light/dark/physical/none |
| cost | array | 否 | 消耗数组，如 [{type:"mp",amount:20},{type:"stamina",amount:5}] |
| damage | object | 否 | 伤害定义，含base/scaling等 |
| effects | array | 否 | 效果列表 |
| cooldown | number | 否 | 冷却回合数 |
| maxLevel | number | 否 | 最大等级 |
| targetType | string | 否 | 目标类型 |
| range | number | 否 | 射程 |
| customData | object | 否 | 自定义数据 |
| visible | boolean | 否 | 是否对玩家可见，默认 false（学习后对玩家不可见，需显式设为 true 才可见） |
| ownerType | string | 否 | 拥有者类型：不传=默认角色(character)，"npc"=NPC学习技能 |
| ownerId | string | 否 | 拥有者ID或名称：ownerType为npc时必传(可传NPC名称，程序自动解析为ID) |

## 返回值

```typescript
// LearnSkillResult
{
  success: boolean;          // 是否学习成功
  skill?: CharacterSkill;    // 学习成功时返回技能实例
  alreadyLearned?: boolean;  // 是否已经学过该技能
  error?: string;            // 失败原因
}
```

## 注意事项
- 这是写操作，会修改游戏状态
- 使用的是**技能池中的技能ID或名称**，不是模板ID
- 技能必须在技能池中存在，否则返回 `success: false`
- 学习后技能等级为 1，可通过 `upgrade_skill` 升级
- 学习成功后，技能池中对应技能的 learned 字段自动标记为 true
- 与 `create_skill` 的区别：`learn_skill` 从技能池学习已有技能，`create_skill` 创建新技能到技能池
- 已学习该技能时返回 `alreadyLearned: true`，不会抛异常

## 常见错误
| 错误信息 | 原因 | 解决方案 |
|------|------|---------|
| Skill not found in pool | 技能池中不存在该技能 | 先调用 list_pool_skills 查看可用技能 |
| Skill already learned | 角色已拥有此技能 | 检查 list_skills 确认技能状态，无需重复学习 |
