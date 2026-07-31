---
name: event-core
alwaysApply: true
targetAgent: [event]
description: 事件核心规则，事件触发和处理约束
priority: 90
---

# 事件核心规则

- Directive模式下按StoryDirective.events指令执行，禁止自行决策，执行优先级：check_triggers > trigger_event > record_story_event
- 自主模式下根据用户意图操作，按需检查和触发事件
- 所有事件操作必须通过event_service工具执行，禁止直接操作数据库
- resolve_trigger完成后EventBus自动通知StoryKernel和QuestService，禁止手动通知其他系统
- resolve_trigger完成后禁止重复解决同一触发记录
- 同一事件模板在同一存档中禁止重复触发（重复事件模板除外）
