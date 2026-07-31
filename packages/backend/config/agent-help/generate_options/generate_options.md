---
tool: generate_options
method: generate_options
description: "AI创造全新角色选项(种族/职业/背景)，排除模板已有选项，增加游戏随机性，游戏前操作，不需要saveId"
summary: "AI创造全新角色选项"
paramTypes:
  templateId: "string (required) - 模板ID"
since: "2.0"
---

# generate_options.generate_options

## 功能

根据模板的世界设定和已有角色选项，AI 驱动一次性创造全新的种族、职业和背景选项。系统会读取模板中 `character_creation` 已有的种族/职业/背景，要求 AI 生成不重复的全新选项，为游戏增加随机性和多样性。

**核心特点**：
- 一次性返回种族、职业、背景三类选项，无需分步调用
- 自动排除模板中已有的选项（按 ID 去重）
- AI 生成的种族 `available_classes` 会自动校验，仅保留已有职业 ID 和新生成职业 ID
- 所有生成结果经过严格校验和清洗（属性范围、ID 格式、必填字段等）

## 参数详解

### templateId（必填）
- **类型**: string
- **说明**: 模板 ID，系统据此读取世界设定名称和 `character_creation` 中已有的种族/职业/背景数据
- **来源**: `game_init_service.get_template_data` 返回的模板 ID，或预设模板标识符

## 返回值

```typescript
interface GeneratedRace {
  id: string;                  // 英文小写 kebab-case ID
  name: string;                // 中文名称
  description: string;         // 50-100字描述
  bonuses: Record<string, number>;   // 属性加成，key 为 str/dex/con/int/wis/cha
  penalties: Record<string, number>; // 属性惩罚，key 为 str/dex/con/int/wis/cha
  abilities: string[];         // 种族特有能力，2-3个
  available_classes: string[]; // 可用职业 ID 列表，至少2个
}

interface GeneratedClass {
  id: string;                  // 英文小写 kebab-case ID
  name: string;                // 中文名称
  description: string;         // 50-100字描述
  primary_attributes: string[]; // 主属性，从 str/dex/con/int/wis/cha 中选2个
  hit_die: string;             // 生命骰: "d6" | "d8" | "d10" | "d12"
  skill_proficiencies: string[]; // 技能熟练，2-3个
  starting_equipment: string[];  // 初始装备 ID，2-3个
}

interface GeneratedBackground {
  id: string;                  // 英文小写 kebab-case ID
  name: string;                // 中文名称
  description: string;         // 50-100字描述
  feature: string;             // 特性，格式 "特性名称 - 特性描述"
  attribute_bonuses: Record<string, number>; // 属性加成，总和 0~+2
  skill_proficiencies: string[]; // 技能熟练，2个
  languages: string[];         // 语言，1-2个
  equipment: string[];         // 装备 ID，2-3个
}

interface GeneratedOptionsResult {
  races: GeneratedRace[];       // AI 生成的全新种族列表（3-5个）
  classes: GeneratedClass[];    // AI 生成的全新职业列表（3-5个）
  backgrounds: GeneratedBackground[]; // AI 生成的全新背景列表（3-5个）
}

// 返回值结构
{
  success: true,
  data: GeneratedOptionsResult
}
```

## 注意事项

- 此方法为只读操作，不会修改任何游戏状态或模板数据
- 不需要 `saveId`，仅需 `templateId` 即可工作（游戏前操作）
- 生成结果由 AI 驱动（temperature=0.9），每次调用可能产生不同内容
- 如果 ConfigLoader 或 LLMService 未初始化，返回空列表 `{ races: [], classes: [], backgrounds: [] }`
- AI 生成失败时不会抛出异常，而是返回空列表
- 种族属性加成/惩罚总和超出范围（-2~+3）时会被自动调整
- 背景属性加成总和超过 +2 时会被自动削减
- 职业无初始装备时，使用模板 `initial_data.default_equipment` 或回退到 `basic-weapon`
- 选择完种族/职业/背景后，将结果传入 `game_init_service.init_stats` 完成角色创建

## 常见错误

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| `templateId is required` | 未传入 templateId 参数 | 必须传入有效的模板 ID |
| 返回空列表 | ConfigLoader 或 LLMService 未初始化 | 确保服务依赖已通过 `setDependencies` 注入 |
| 返回空列表 | LLM 调用失败或返回非 JSON | 检查 LLM 服务状态，重试调用 |
| 返回空列表 | 模板不存在或 character_creation 为空 | 先通过 `get_template_data` 确认模板有效 |
| 种族 available_classes 为已有职业 | AI 生成的职业 ID 与已有职业不匹配 | 属于正常行为，系统会自动回退到已有职业 |
