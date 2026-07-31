---
name: npc-attribute-init
description: NPC属性初始化——生成基础属性并计算派生属性
targetAgent: [npc_party]
trigger: [initialize]
whenToUse: NPC首次需要属性数据时（查看详情、进入战斗等场景），需初始化基础属性和派生属性
recommendedTools: [npc_service, numerical_service]
relatedRules: [npc-core]
completionCriteria: NPC基础属性已生成并写入，派生属性已计算，初始化标记已设置
version: "2.0"
enabled: true
---

# NPC属性初始化

## 任务是什么
为NPC生成基础属性（力量、敏捷、体质、智力、感知、魅力），计算派生属性（HP/MP/攻击/防御等），并标记初始化完成。

## 为什么有这个任务
NPC在首次需要属性数据的场景（查看详情、进入战斗、属性检定等）时，必须先完成属性初始化。基础属性由LLM根据NPC角色特征生成，派生属性由数值系统统一计算，确保属性体系一致。

## 完成的标准是什么
1. NPC属性初始化状态已检查，未初始化时执行初始化
2. 基础属性已根据NPC角色特征生成并写入
3. 派生属性已通过数值系统计算
4. NPC已标记为属性已初始化

## 怎么完成任务

### 调用什么工具完成什么操作
1. 调用 npc_service.ensure_attr_initialized — 确认NPC属性未初始化
2. 调用 npc_service.get_npc — 获取NPC的name/role/race/level/description
3. 根据NPC特征生成6项基础属性（strength/agility/constitution/intelligence/perception/charisma），属性值范围1-20
4. 调用 npc_service.update_npc — 写入attributes
5. 调用 numerical_service.calculate_stats — 计算派生属性（ownerType='npc'，ownerId=npcId）
6. 调用 npc_service.mark_attr_initialized — 标记属性已初始化

### 注意事项
- 属性值必须为正整数，普通人为10，英雄级为15+
- 主属性根据角色调整：战士力量高、法师智力高、盗贼敏捷高
- 等级越高的NPC主属性应越高，特殊NPC（Boss、精英）可突破20上限
- 生成属性后必须调用 mark_attr_initialized，避免重复初始化
- 派生属性由 numerical_service 统一计算，禁止手动计算

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "NPC属性初始化完成",
  "data": {
    "npcId": "npc-xxx",
    "role": "warrior",
    "attributes": {
      "strength": 16,
      "agility": 12,
      "constitution": 14,
      "intelligence": 8,
      "perception": 10,
      "charisma": 9
    },
    "attrInitialized": true
  }
}
```
