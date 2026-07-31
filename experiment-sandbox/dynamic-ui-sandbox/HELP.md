# 动态 UI 协议测试沙箱 · 帮助文档

> 沙箱用途：在脱离后端的环境下，验证 `:::组件{key=value}` 协议的解析、渲染与交互行为是否与 [动态 UI 设计规范](../../docs/design/meta/dynamic-ui-design-specification.md) 一致。代码源自 `packages/frontend` 主链路，验证通过后可原样迁移回主项目。

---

## 一、快速启动

```bash
cd experiment-sandbox/dynamic-ui-sandbox
pnpm install      # 首次运行
pnpm dev          # 启动开发服务器（默认 http://localhost:5199）
pnpm typecheck    # TypeScript 类型检查（无 emit）
pnpm build        # 生产构建（先 tsc --noEmit 再 vite build）
pnpm preview      # 预览生产构建产物
```

> 端口固定 5199（见 [vite.config.ts](src/vite.config.ts)），避免与主项目前端 5173 冲突。

---

## 二、页面布局

启动后浏览器打开 `http://localhost:5199/`，页面分三栏：

| 区域 | 位置 | 作用 |
|------|------|------|
| 样本列表 | 左侧 | 按分类展示测试样本，点击切换到中间编辑框 |
| 协议编辑 + 渲染 | 中间 | 上半为 `:::组件` 协议代码编辑框（可改），下半为实时渲染结果 |
| 交互日志 + 条件上下文 | 右侧 | 上半记录点击交互，下半为 ConditionContext JSON 编辑框 |

### 2.1 样本分类（共 10 类）

| 分类 | 覆盖规范章节 | 验证要点 |
|------|-------------|---------|
| 综合场景 | §2 综合示例 | 多组件组合：旁白 + 角色状态 + 敌人卡 + 行动选项 |
| 显示类组件 | §2.2.1 | progress / badge / stat-block / icon / divider / notify / avatar |
| 交互类组件 | §2.2.2 | button / button-group / options / tabs / tooltip / switch / select |
| 容器类组件 | §2.2.3 | panel / grid / table / scroll-box / columns |
| 游戏专用组件 | §2.2.4 | item-card / quest-item / skill-card / npc-card / narration / choice / dialogue-history |
| 高级功能 | §2.2.4 后半 | shop / craft / enhancement / warehouse |
| Mermaid 地图 | §2.5 | minimap / skill-tree（规范原版 + 行内 `:::class` 后缀各一组） |
| 交互协议链接 | §2.3 | `[文本](protocol:target?params)` 链接映射 |
| 条件表达式 | §2.4 | conditional + AND/OR/NOT/括号分组 |
| 边界与异常 | — | 空内容 / 嵌套 / 非法语法等边界场景 |

每个样本的 `note` 字段标注该样本的验证要点与已知差异，可在样本列表查看。

### 2.2 交互日志

点击渲染结果中的 **按钮 / 链接 / 地图节点 / 技能节点 / switch / select** 会触发 `onInteraction` 回调，日志格式：

```
#序号  [interactionType]  时间
target: 目标ID
params: { 参数键值对 }
```

常见 interactionType：
- `use_skill` / `use_item` / `travel` / `talk_npc` / `accept_quest` / `examine_item` — 来自 `[label](protocol:target)` 链接
- `attack` / `buy_item` / `toggle_setting` 等 — 来自 `:::button{action=xxx}` 的 action 属性
- `select` — 来自 tabs / select 组件

### 2.3 条件上下文（ConditionContext）

右侧 textarea 为 JSON 格式的条件上下文，用于 `:::conditional{condition="..."}` 组件的求值。默认值：

```json
{
  "character": {
    "id": "char_01",
    "name": "勇者",
    "level": 12,
    "currentHP": 120,
    "maxHP": 200,
    "currentMP": 40,
    "maxMP": 60,
    "currentLocationId": "B",
    "attributes": { "strength": 16 },
    "derivedAttributes": {}
  },
  "inventory": [
    { "id": "inv_01", "itemId": "magic-key", "name": "魔法钥匙", "quantity": 1 }
  ],
  "quests": [
    { "id": "main_01", "name": "主线任务", "status": "active" }
  ],
  "skills": [
    { "id": "sk_01", "skill_id": "fireball", "name": "火球术", "unlocked": true, "cooldownRemaining": 0 }
  ]
}
```

**条件表达式语法**（见 [conditionEvaluator.ts](src/utils/conditionEvaluator.ts)）：

| 表达式 | 含义 | 示例 |
|--------|------|------|
| `hasItem:物品ID` | 拥有指定物品 | `hasItem:magic-key` |
| `hasSkill:技能ID` | 拥有指定技能 | `hasSkill:fireball` |
| `hasQuest:任务ID` | 拥有指定任务 | `hasQuest:main_01` |
| `faction:阵营名>=值` | 阵营声望达到值 | `faction:elves>=50` |
| `level>=数值` | 等级达到数值 | `level>=10` |
| `stat:属性名>=值` | 属性达到值 | `stat:strength>=15` |
| `AND` / `OR` / `NOT` | 逻辑与/或/非 | `NOT hasQuest:main_01` |
| `( )` | 括号分组 | `(hasItem:key1 OR hasItem:key2) AND level>=10` |

> **括号分组验证要点**：修改 ctx 的 `character.level` 与 `inventory`，观察 `(hasItem:magic-key OR hasItem:lockpick) AND level>=10` 是否按预期显隐。例如 `{magic-key, level:5}` 应隐藏（无括号优先级会误显示）。

---

## 三、目录结构

```
dynamic-ui-sandbox/
├── src/
│   ├── App.tsx                          # 测试页面：样本列表 + 编辑框 + 渲染区 + 交互日志 + 条件上下文
│   ├── main.tsx                         # React 入口
│   ├── index.css                        # 全局样式入口
│   ├── components/
│   │   ├── ui/                          # 基础 UI 组件（与 packages/frontend/src/components/ui 对齐）
│   │   │   ├── Badge.tsx
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── StatBlock.tsx
│   │   │   ├── Table.tsx                # P2-DUI-2 补齐
│   │   │   └── index.ts
│   │   ├── common/
│   │   │   └── ErrorBoundary.tsx
│   │   └── game/
│   │       ├── dynamic-ui/
│   │       │   ├── UIDirectiveParser.ts # :::组件 语法解析器（核心）
│   │       │   ├── DynamicUIRenderer.tsx# 组件渲染器（核心）
│   │       │   └── index.ts
│   │       └── map-flow/
│   │           ├── MermaidRenderer.tsx  # 通用 Mermaid 渲染外壳（P2-DUI-4 提取）
│   │           ├── MiniMapFlow.tsx      # 地图领域组件（仅保留节点映射）
│   │           ├── SkillTreeFlow.tsx    # 技能树领域组件（仅保留节点映射）
│   │           ├── parseMermaidToFlowData.ts  # Mermaid 语法解析
│   │           ├── directionalLayout.ts       # 方向分层布局
│   │           ├── NodeHandles.tsx            # 节点四向连接点
│   │           ├── PathEdge.tsx               # 边渲染（标签 + 箭头）
│   │           ├── CurrentLocationNode.tsx    # 当前位置节点
│   │           ├── DiscoveredNode.tsx         # 已发现节点
│   │           ├── UndiscoveredNode.tsx       # 未发现节点
│   │           ├── SkillNode.tsx              # 技能节点
│   │           ├── theme.ts                   # React Flow 主题
│   │           ├── types.ts                   # 节点/边类型
│   │           └── map-flow.css
│   ├── hooks/
│   │   └── useTheme.ts
│   ├── i18n/                            # i18n 副本（与主项目 game/common 命名空间对齐）
│   ├── stores/                          # Zustand store 副本
│   ├── styles/                          # CSS 变量 + 动画
│   ├── types/                           # 共享类型副本（@ai-rpg/shared 别名指向）
│   └── utils/                           # 工具函数副本
│       ├── conditionEvaluator.ts        # 条件表达式求值（含括号分组）
│       ├── customDataResolver.ts
│       ├── entityFilter.ts
│       ├── entityMapper.ts
│       ├── cn.ts
│       └── logger.ts
├── vite.config.ts                       # @/ → src/，@ai-rpg/shared → src/types/dynamic-ui.ts
├── tsconfig.json
├── tailwind.config.js
├── package.json
└── debug-mermaid.ts                     # Mermaid 解析调试脚本（临时）
```

---

## 四、与主项目的关系

### 4.1 代码来源

沙箱代码 **依样复制** 自 `packages/frontend` 主链路，保持相同的：
- 路径别名约定（`@/` → `src/`，`@ai-rpg/shared` → 共享类型）
- TypeScript 严格模式
- Tailwind + CSS 变量主题
- i18n 命名空间（`game` / `common`）
- Zustand store 接口

### 4.2 别名映射

[vite.config.ts](vite.config.ts) 将 `@ai-rpg/shared` 别名指向本地 `src/types/dynamic-ui.ts`，使主项目代码复制到沙箱时 **import 路径不变**，迁移成本为零。

### 4.3 验证通过后的迁移

沙箱验证通过的代码可直接复制回 `packages/frontend` 对应位置：

| 沙箱路径 | 主项目对应路径 |
|---------|--------------|
| `src/components/game/dynamic-ui/` | `packages/frontend/src/components/game/dynamic-ui/` |
| `src/components/game/map-flow/` | `packages/frontend/src/components/game/map-flow/` |
| `src/components/ui/` | `packages/frontend/src/components/ui/` |
| `src/utils/conditionEvaluator.ts` | `packages/frontend/src/utils/conditionEvaluator.ts` |
| `src/types/dynamic-ui.ts` | `packages/shared/src/types/dynamic-ui.ts` |

---

## 五、已验证功能清单

以下功能已在沙箱中验证通过（tsc --noEmit 0 错误 + 浏览器全项 PASS）：

- [x] **协议解析**：`:::component{key=value}` 语法，自闭合 / 容器 / 行内 / 卡片二义消歧
- [x] **显示类组件**：progress / badge / stat-block / icon / divider / notify / avatar
- [x] **交互类组件**：button / button-group / options / tabs / tooltip / switch / select
- [x] **容器类组件**：panel / grid / table / scroll-box / columns
- [x] **游戏专用组件**：item-card / quest-item / skill-card / npc-card / narration / choice / dialogue-history
- [x] **高级功能**：shop / craft / enhancement / warehouse
- [x] **Mermaid 地图**：minimap / skill-tree（graph LR/TD 方向、style 行着色、classDef+class、行内 `:::class` 后缀、边标签、有向箭头）
- [x] **条件表达式**：hasItem / hasSkill / hasQuest / faction / level / stat / AND / OR / NOT / **括号分组 `( )`**
- [x] **交互协议链接**：`[文本](protocol:target?params)` → onInteraction 映射
- [x] **MermaidRenderer 通用提取**（P2-DUI-4）：MiniMapFlow / SkillTreeFlow 共用解析+布局+外壳
- [x] **Table.tsx 补齐**（P2-DUI-2）

---

## 六、常见问题

### Q1：页面打开空白 / 控制台报错？

1. 确认 `pnpm install` 已执行
2. 确认端口 5199 未被占用（`netstat -ano | findstr 5199`）
3. 查看终端是否有 Vite 启动错误
4. 浏览器控制台是否有 React 渲染错误（ErrorBoundary 会捕获并显示）

### Q2：修改协议代码后渲染没变化？

- 编辑框失焦后才触发重新解析（`useMemo` 依赖 `code` state）
- 检查协议语法：`:::component{key=value}` 必须以 `:::` 开头
- 容器组件必须有 `:::` 闭合标记（自闭合组件除外）

### Q3：conditional 组件总是显示 / 总是隐藏？

- 检查右侧 ConditionContext JSON 是否合法（解析失败时 conditional 按无上下文处理，默认显示）
- JSON 合法但字段名不匹配时，条件求值结果可能不符预期（如 `itemId` vs `id`）
- 括号分组行为见 [conditionEvaluator.ts](src/utils/conditionEvaluator.ts) 的 `parseAtomOrParens` 递归下降

### Q4：Mermaid 地图渲染为"无法解析地图数据"？

- 确认协议代码以 ` ```mermaid ` 围栏开头
- 确认首行为 `graph LR` 或 `graph TD`（方向声明必需）
- 节点 ID 必须为字母开头（`A[村庄]` 正确，`1[村庄]` 可能解析失败）

### Q5：交互日志没有记录点击事件？

- 确认点击的是可交互元素（按钮 / 链接 / 地图节点 / 技能节点）
- `undiscovered` 地图节点点击被忽略（设计行为）
- 检查组件是否传入了 `onInteraction` 回调（DynamicUIRenderer 的 props）

---

## 七、开发约定

1. **不引入主项目不存在的依赖**：沙箱 dependencies 应与 `packages/frontend` 对齐
2. **不修改主项目代码**：所有改动限于沙箱目录内
3. **保持 import 路径一致**：方便验证通过后原样迁移回主项目
4. **typecheck 必须通过**：`pnpm typecheck` 0 错误是验证通过的前提
