---
tool: dynamic_ui
method: submit_ui
description: "提交动态UI组件指令。使用 :::组件名{属性=\"值\"} 格式。组件名和属性格式参考 dynamic-ui-generation 技能文档。"
summary: "提交动态 UI 组件指令"
paramTypes:
  components: "string (required) - 动态UI组件内容，使用 :::组件语法 格式。示例：:::notify{type=\"info\" title=\"任务更新\"}\\n你接取了新任务\\n:::"
  intensity: "string (optional) - UI强度级别：minimal(1-2个简单组件)、partial(3-5个中等组件)、full(5+个复杂组件或完整面板)。默认minimal"
since: "1.0"
whenToUse:
  - 需要把结构化 UI 组件渲染到前端界面时
  - 输出阶段需要附带交互式卡片、面板或状态展示时
returnsSummary: 返回提交的 UI 内容、强度级别与组件数量
---

# dynamic_ui.submit_ui

## 功能
提交动态UI组件指令。使用 :::组件名{属性="值"} 格式提交UI组件，前端 DynamicUIRenderer 会解析并渲染对应的组件。

## 参数详解

### components（必填）
- **类型**: string
- **说明**: :::组件语法 格式的UI组件内容
- **格式规则**:
  - 块级组件：`:::component{attrs}` 开始，`:::` 结束
  - 行内组件：`:::component{attrs}内容:::`
  - 自闭合组件：`:::component{attrs}`（属性包含所有数据）
  - 属性使用 `{key=value}` 格式，字符串值用双引号，数字值不需要引号

### intensity（可选）
- **类型**: string
- **说明**: UI强度级别，控制组件数量和复杂度
- **默认值**: minimal
- **可选值**:
  - `minimal`：1-2个简单组件（notify、badge），50-200 tokens
  - `partial`：3-5个中等组件（notify + item-card + quest-item），200-500 tokens
  - `full`：5+个复杂组件或完整面板布局，500-1500 tokens

## 支持的组件清单

### 显示类
- `progress`：进度条（HP/MP/EXP）
- `badge`：徽章标签
- `stat-block`：属性数值
- `divider`：分隔线
- `icon`：图标
- `avatar`：头像

### 交互类
- `button`：按钮
- `button-group`：按钮组
- `tabs` + `tab-panel`：标签页
- `select`：下拉选择
- `switch`：开关
- `tooltip`：提示框

### 容器类
- `panel`：面板容器
- `grid`：网格布局
- `columns`：多列布局
- `table`：数据表格
- `scroll-box`：滚动容器
- `options`：选项容器

### 游戏专用
- `character-status`：角色状态卡
- `enemy-card`：敌人卡片
- `item-card`：物品卡片
- `quest-item`：任务条目
- `skill-card`：技能卡片
- `npc-card`：NPC卡片
- `minimap`：小地图
- `skill-tree`：技能树
- `narration`：旁白叙述
- `notify`：系统通知
- `shop`：商店
- `craft`：合成制作
- `enhancement`：装备强化
- `warehouse`：仓库
- `choice`：选择框
- `dialogue-history`：对话历史

## 返回值

```typescript
{
  success: true,
  data: {
    uiComponents: string,    // 提交的组件内容
    uiIntensity: string,     // 强度级别
    componentCount: number   // 识别到的组件数量
  }
}
```

## 注意事项
- 此方法为只读操作，不修改数据库数据
- components 参数必须包含有效的 :::组件语法 格式
- 组件名必须是 DynamicUIRenderer 支持的名称，否则会回退为纯文本渲染
- 属性值用双引号包裹（字符串），数字不需要引号
- 参考 dynamic-ui-generation 技能获取完整的组件清单和属性格式

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| components 为空 | 未传入组件内容 | 必须提供有效的 :::组件语法 内容 |
| 未识别到组件 | 格式不正确 | 确认使用 :::组件名{属性} 格式 |
| intensity 无效 | 传入了非标准值 | 使用 minimal/partial/full 之一 |
