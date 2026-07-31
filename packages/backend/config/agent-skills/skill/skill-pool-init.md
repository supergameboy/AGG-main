---
name: skill-pool-init
description: 基于预注入的模板数据和池数据初始化角色技能池
targetAgent: ["skill"]
trigger: [skill_pool_init]
whenToUse: 初始化阶段为角色生成适合职业的技能池
recommendedTools: [skill_service]
relatedRules: [skill-pool-core]
completionCriteria: 角色已学习 GM 指定数量且适合职业的技能、技能覆盖多个类别、技能列表可查到已学习技能
version: "2.2"
enabled: true
---

# 技能池初始化

## 任务是什么
基于预注入的"模板数据.技能定义"和"池数据.技能"两类数据源，为角色学习 GM 指定数量且适合职业的技能。

## 为什么有这个任务
初始化阶段需要为角色配置技能。技能数据已由游戏数据处理器预注入到上下文，包含两类数据源：
- **模板数据.技能定义**：YAML 种子定义的技能（确定存在）
- **池数据.技能**：模板池 DB 中已审核的可复用技能（可能为空，非空时质量更高）

无需主动查询数据库。GM 根据游戏情况在派发任务时指定学习数量和质量要求，子 Agent 基于注入数据自主选择具体技能。调用 learn_skill 时系统自动完成"模板池查找→字段合并→复制到存档池→学习"全链路。

## 完成的标准是什么
1. 角色已学习 GM 派发任务中指定数量的技能
2. 学习的技能适合角色职业（recommendedClasses 作为参考，非硬性筛选）
3. 学习的技能覆盖多个类别，避免只学单一类别
4. 调用 skill_service.list_skills 确认已学习技能列表

## 怎么完成任务

### 调用什么工具完成什么操作
1. 读取 injectedContext 中的"模板数据.技能定义"和"池数据.技能"文本块——获取两类可用技能列表
2. 根据 GM 派发任务中的数量要求，结合角色职业特点自主选择具体技能（recommendedClasses 作为参考，可选取非推荐但适合角色的技能）
3. 调用 skill_service.learn_skill——按名称学习选定的技能（系统自动完成模板池查找→字段合并→复制到存档池→学习；若池数据+模板数据均无该名称，则需传入全部字段创建）
4. 调用 skill_service.list_skills——确认已学习技能列表

### 注意事项
1. 禁止调用 list_template_skills / list_template_items 工具——数据已预注入到上下文
2. 应学习多个类别的技能，避免只学单一类别（不能只学攻击，也不能只学防御，应多类别搭配）
3. recommendedClasses 作为参考，允许根据角色特点自主选择非推荐但适合的技能，增加游戏随机性
4. 学习的技能名称必须与注入数据中的 name 字段完全一致
5. learn_skill 内置三级查找（存档池→模板池→字段齐全创建+回写模板池），覆盖全链路。禁止调用 add_pool_skill——模板池由程序自动管理，Agent 无需也无法手动管理

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "技能池初始化完成",
  "data": {
    "learnedCount": "<GM 派发的数量>",
    "learnedSkills": ["<实际学习的技能名称列表>"],
    "categoriesCovered": ["<实际覆盖的类别列表>"]
  }
}
```
