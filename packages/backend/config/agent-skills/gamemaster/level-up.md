---
name: level-up
description: 处理角色升级流程
targetAgent: [gamemaster]
trigger: [level_up]
whenToUse: 角色经验值达到升级阈值、玩家查看升级信息时
recommendedTools: [numerical_service, character_service, skill_service, coordinator_service]
relatedRules: [numerical-core]
completionCriteria: 角色等级已提升、属性已增长、新技能已解锁、升级叙事已生成
version: "2.0"
enabled: true
---

# 角色升级

## 任务是什么
处理角色升级的完整流程，包括经验值增加、等级提升判定、属性增长计算、新技能解锁和升级叙事生成。

## 为什么有这个任务
升级是角色成长的核心机制，涉及经验值累积、属性重算、技能解锁等多个环节。这些环节有严格的依赖顺序：必须先确认升级，再计算属性增长，最后解锁技能。缺少统一的升级技能会导致属性计算遗漏或技能解锁时机错误。

## 完成的标准是什么
1. `numerical_service.add_experience` 返回成功，经验值已持久化增加
2. 升级后 `numerical_service.calculate_stats` 已重新计算派生属性
3. `character_service.update_attributes` 已更新角色基础属性
4. `character_service.get_full_status` 返回的等级和属性值与升级结果一致
5. 新技能已通过 `skill_service.learn_skill` 学习（如有解锁技能）
6. output Agent已生成并返回升级叙事文本

## 怎么完成任务

### 调用什么子Agent派发什么任务
- 子Agent类型1：numerical（数值计算）
- 派发任务描述：计算升级后的属性增长和经验重算
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "numerical",
    "task": "计算角色升级数值",
    "action": "calculate_level_up",
    "context": {
      "currentLevel": 4,
      "newLevel": 5,
      "currentExp": 1200,
      "expGained": 350,
      "classType": "warrior"
    }
  }
  ```

- 子Agent类型2：output（升级叙事）
- 派发任务描述：根据升级结果生成角色成长的叙事描述
- 调用方法：coordinator_service.spawn_agent，参数示例：
  ```json
  {
    "agent_type": "output",
    "task": "生成升级叙事",
    "action": "narrate_level_up",
    "context": {
      "previousLevel": 4,
      "newLevel": 5,
      "attributeChanges": { "strength": 2, "vitality": 1 },
      "newSkills": ["重击"],
      "characterClass": "warrior"
    }
  }
  ```

### 注入哪些条目的信息
1. 从 `character_service.get_full_status` 获取角色当前等级、属性、经验值，用于判断是否达到升级阈值
2. 从 `numerical_service.add_experience` 的返回结果获取经验值增加和升级判定（add_experience返回amount和leveledUp字段）
3. 从 `skill_service.learn_skill` 获取技能池中可学习的技能
4. 触发升级的事件来源（战斗胜利、任务完成等，从对话上下文中提取）

### 注意事项
1. 经验值增加必须通过 `numerical_service.add_experience`，传入amount参数，不可直接修改角色属性
2. 升级判定逻辑：add_experience返回的结果中包含leveledUp字段，为true时才执行升级流程
3. 属性增长必须通过 `character_service.update_attributes`，deltas对象中只包含变化量（正数），不传全量属性
4. 派生属性（HP上限、MP上限、攻击力等）必须通过 `numerical_service.calculate_stats` 重算，不可手动计算
5. 技能解锁使用 `skill_service.learn_skill`，参数skills数组中每个元素需包含skillIdOrName
6. 一次获得大量经验可能跨越多个等级，需循环处理每级升级直到leveledUp为false

### 收到子Agent返回的结果之后执行什么操作
1. **判断子Agent任务是否成功**：
   - numerical子Agent：检查返回的newLevel和attributeDeltas字段是否有效
   - output子Agent：检查返回的narrative字段是否为非空字符串
2. **成功后更新状态**：
   - 将numerical子Agent计算的属性增量通过 `character_service.update_attributes` 写入，deltas参数为子Agent返回的attributeDeltas
   - 调用 `numerical_service.calculate_stats` 重算并持久化派生属性
   - 若有新技能，调用 `skill_service.learn_skill` 学习，skills参数为子Agent返回的newSkillIds
   - 调用 `character_service.get_full_status` 验证最终状态与升级结果一致
3. **失败后处理**：
   - numerical子Agent失败：不执行属性更新和技能学习，向玩家返回"升级计算异常"
   - output子Agent失败：升级数据仍正常生效，使用默认模板"你升到了X级！"作为叙事兜底
4. **最终向玩家输出**：合并升级结果（新等级、属性变化、新技能列表）和output子Agent生成的叙事文本，返回给玩家
