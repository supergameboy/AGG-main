---
name: generate-ui
description: 生成动态UI组件指令，按强度分级输出
targetAgent: ["output"]
trigger: [generate_ui, ui_generation]
whenToUse: 需要生成动态UI组件展示游戏数据时使用
recommendedTools: [dynamic_ui]
relatedRules: [response-format]
completionCriteria: UI组件已通过submit_ui提交、组件语法正确、强度级别与场景匹配
version: "3.0"
enabled: true
---

# UI生成

## 任务是什么
根据游戏状态数据生成动态UI组件指令，通过 `dynamic_ui.submit_ui` 工具提交。

## 为什么有这个任务
不同场景对UI复杂度的需求不同。简单场景只需轻量通知，复杂场景需要展示角色面板、物品列表、战斗界面等。按强度分级生成可确保信息量恰当。

## 完成的标准是什么
1. UI组件已通过 `dynamic_ui.submit_ui` 提交
2. 组件语法符合 :::组件名{属性="值"} 格式
3. 强度级别与场景匹配
4. 所有数据来自 peerResults 中的真实数据

## 怎么完成任务

### 1. 确定UI强度
- **minimal**（50-200 tokens）：简单通知、单个任务更新，1-2个简单组件
- **partial**（200-500 tokens）：交易、任务对话、物品展示，3-5个中等组件
- **full**（500-1500 tokens）：战斗、重要剧情、角色面板，5+个复杂组件

### 2. 选择合适的组件
参考 `dynamic-ui-generation` 技能中的完整组件清单。

### 3. 提交UI组件
调用 `dynamic_ui.submit_ui`：
- 参数：`components`(string, 必填): :::组件语法 格式的UI内容
- 参数：`intensity`(string, 可选): minimal/partial/full，默认minimal
- 返回：UI组件确认

### 组件语法规则
1. 块级组件：`:::组件名{属性}` 开始，`:::` 结束（独占一行）
2. 行内组件：`:::组件名{属性}内容:::`（同行闭合）
3. 自闭合组件：`:::组件名{属性}`（属性包含所有数据）
4. 属性使用 `{key=value}` 格式，字符串值用双引号，数字值不需要引号

### 交互协议链接（嵌入文本中）
- `[文本](action:动作名?参数)` 触发游戏动作
- `[文本](item:物品ID)` 查看物品
- `[文本](npc:NPC_ID)` 与NPC交互
- `[文本](location:地点ID)` 前往地点

### 怎么判断任务完成
```json
{
  "completed": true,
  "summary": "UI生成完成",
  "data": {
    "uiIntensity": "minimal|partial|full",
    "componentsGenerated": ["notify", "quest-item"]
  }
}
```
