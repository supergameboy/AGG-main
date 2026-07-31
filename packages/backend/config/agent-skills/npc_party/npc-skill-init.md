---
name: npc-skill-init
description: NPC技能初始化——通过模板池浏览并学习技能，优先从模板池复制
targetAgent: [npc_party]
trigger: [npc_skill_init]
whenToUse: NPC首次需要技能数据时（战斗、技能交互、查看技能等场景），需初始化技能
recommendedTools: [skill_service, template_pool_service, npc_service]
relatedRules: [npc-core]
completionCriteria: NPC技能已学习完成，初始化标记已设置
version: "3.0"
enabled: true
---

# NPC技能初始化

## 任务是什么
为NPC分配初始技能，优先从模板池浏览并学习。模板池有数据时，按推荐分类浏览后直接学习；模板池无数据时，回退到手动创建。

## 为什么有这个任务
NPC在首次需要技能数据的场景（战斗、技能交互、查看技能等场景）时，必须先完成技能初始化。模板池提供预构建的技能供直接复制学习，减少LLM生成开销，确保NPC与角色共享同一技能来源。

## 完成的标准是什么
1. NPC技能初始化状态已检查，未初始化时执行初始化
2. 匹配NPC角色和等级的技能已学习
3. NPC已标记为技能已初始化

## 怎么完成任务

### Step 0：检查模板池数据
调用 `template_pool_service.get_template_pool_stats()` 检查模板池中是否有技能数据。
- 如果返回的技能数量 > 0，进入 Step 1（模板池路径）
- 如果返回的技能数量 = 0，进入 Step 2（回退路径）

### Step 1（模板池有数据）：浏览并直接学习
1. 调用 `npc_service.get_npc` — 获取NPC的name/role/race/level/description
2. 调用 `template_pool_service.list_template_skills({ recommendedClass: 'NPC角色' })` 按推荐分类浏览模板池技能
3. 从浏览结果中选择适合NPC的技能，调用 `skill_service.learn_skill({ skills: [{ skillIdOrName: '技能名', ownerType: 'npc', ownerId: npcId }] })` 直接学习
4. 调用 `npc_service.mark_skill_initialized` — 标记NPC技能已初始化

技能按NPC角色选择：
- 战士类NPC：攻击/防御/战吼类技能
- 法师类NPC：元素攻击/增益类技能
- 盗贼类NPC：敏捷/暗影类技能
- 商人/平民类NPC：0-2个基础技能即可

### Step 2（模板池无数据）：回退到手动创建
1. 调用 `npc_service.get_npc` — 获取NPC的name/role/race/level/description
2. 调用 `skill_service.learn_skill({ skills: [{ skillIdOrName: '技能名', ownerType: 'npc', ownerId: npcId, name: '技能名', category: '分类', element: '元素', cost: [...], damage: {...}, maxLevel: 5 }] })` 一步完成创建+回写模板池+学习
3. 调用 `npc_service.mark_skill_initialized` — 标记NPC技能已初始化

### 注意事项
- 模板池有数据时，优先走浏览+学习的一步路径，无需手动 add_pool_skill
- NPC技能默认visible=false（对玩家不可见），战斗时可设为true
- 等级越高的NPC，技能等级应越高
- 技能数量控制在2-5个，商人和平民类NPC可少于2个
- 生成技能后必须调用 mark_skill_initialized，避免重复初始化

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "NPC技能初始化完成",
  "data": {
    "npcId": "npc-xxx",
    "role": "warrior",
    "skillsLearned": 3,
    "skillNames": ["重击", "防御姿态", "战吼"],
    "skillInitialized": true
  }
}
```
