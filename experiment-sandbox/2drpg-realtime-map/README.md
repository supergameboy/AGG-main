# 2DRPG 实时地图 · 决策效果验证沙箱

> 对应设计文档：`docs/design/system-design-20260727-2drpg-realtime-map/`（总规划 + 模块1-7 + 附录A-E）
> 用途：在落地主项目前，对《2DRPG 实时地图与实时互动系统设计》的**整体效果**与**全部决策分叉口**做可视化/交互验证。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5200
npm run typecheck  # tsc --noEmit（交付门禁：零错误）
```

操作：WASD/方向键移动 · 点击瓦片 A* 寻路 · E 交互/进建筑 · Esc 退出建筑 · 滚轮缩放 · 右键拖拽平移。

## 技术架构（与主项目对齐）

| 维度 | 本沙箱 | 主项目 packages/frontend |
|------|--------|--------------------------|
| 构建 | Vite 5 + React 18 + TS strict | 同左 |
| 状态 | Zustand 4（configStore + mapStore） | 同左（mapStore 扩展语义） |
| 样式 | Tailwind CSS 3 + dark class | 同左 |
| 渲染 | Canvas 2D（等距）/ CSS Grid（DOM） | 模块5 §2.1.3 渲染器矩阵 |
| 引擎 | React 外单例 WorldEngine（组合根注入） | 后端 MapProgram/Service 的进程内合并 |

### 目录 ↔ 设计文档映射

```
src/
├── types/tile-map.ts        ← 模块1 §3.1 + 附录A §3.3（15 种瓦片属性权威表）
├── core/
│   ├── chunk-utils.ts       ← 模块1 §3.1.6 纯函数（坐标/邻居/ID）
│   ├── noise.ts             ← Perlin + 确定性种子（模块6 §五 同 seed 一致）
│   ├── generator.ts         ← 模块2 §3.3.5 GeneratorRouter（procedural/mock_llm/auto）
│   ├── procedural-gen.ts    ← 模块2 ProceduralMapGenerator（LLM 失败兜底）
│   ├── mock-llm-gen.ts      ← 模块7 §2.4.1 MockMapGenerator + ATL/JSON token 估算（§3.2）
│   ├── boundary-strategy.ts ← 模块2 §3.4 策略A硬边界 / 策略B带上下文
│   ├── priority-queue.ts    ← 模块2 §4.2.5 二叉堆 + 去重 Set
│   ├── scheduler.ts         ← 模块2 §3.3 PrefetchScheduler（P0-P3 + 双层去重 + 重试）
│   ├── result-pool.ts       ← 模块4 §2.1 map_pool（pending→consumed/expired）
│   ├── pathfinder.ts        ← 模块3 §3.2.3 A*（曼哈顿启发）
│   ├── fov.ts               ← 模块3 §2.3 FOVCalculator（射线遮挡）
│   ├── lru-cache.ts         ← 模块3 §2.4.3 SubChunkCache（LRU + markLoading/Failed）
│   ├── buildings.ts         ← 模块6 + 附录C（模板库/放置/内部生成/方案A·B 数据）
│   ├── events.ts            ← 附录B 事件总线（C/D 类进程内事件）
│   ├── perf.ts              ← 模块7 §2.1 PerformanceMetricsCollector
│   └── world.ts             ← 总编排（MapProgram G2 语义 + 各模块集成链路）
├── render/
│   ├── tile-sprites.ts      ← 程序化贴图（附录A §4.2 尺寸规范的代码等价物）
│   ├── sprite-sheet.ts      ← 附录A §4 精灵图集加载 + TileType→spriteId→图集映射
│   ├── lighting.ts          ← 暗黑 2.5D 光照（火把闪烁/昼夜/自发光/暗角）
│   ├── Canvas2DRenderer.ts  ← 模块5 §2.1.3 Canvas2DRenderer（附录D Phase 2）
│   └── CssGridRenderer.tsx  ← 模块5 §2.1.3 CssGridRenderer（附录D Phase 1）
├── stores/                  ← 模块5 §2.3 mapStore 扩展语义（configStore 为 Profile 运行时等价物）
└── components/              ← MapViewport（GameLayout 键盘语义）+ RegionBanner（§2.2）+ 控制面板 8 分区
```

## 控制面板 8 分区（决策验证工作流）

1. **决策分叉口**：渲染器（附录D）、渲染风格（§5.2）、边界策略A/B（模块2 §3.4）、边界美化（模块5 §2.1.5）、内部方案A/B（模块6）、区块大小 32/64/96（附录E）、生成器路由（§3.3.5）、ATL/JSON（§3.2）、地图规模（模块7）
2. **渲染与光照**：缩放/相机、火把半径、昼夜循环、环境暗度、迷雾三态、区块网格
3. **世界与地图状态**：种子/密度/速度、区块状态网格（pending→generating→ready/failed）、PlayerMapState、横幅测试
4. **调度与结果池**：P0-P3 开关与命中率、并发、方向阈值、模拟 LLM 延迟、实时队列、map_pool 命中
5. **流式加载与缓存**：网络延迟、缓冲半径、淘汰阈值、LRU 容量、命中率
6. **性能仪表盘**：FPS 曲线、延迟直方图、命中率表、LLM 调用列表、自动巡游（之字/螺旋/随机）、S1-S8 场景预设、Markdown 报告下载（含 DecisionSnapshot + ASCII 图）
7. **资源映射**：程序化绘制 ↔ 精灵图集切换、图集预览、15 瓦片映射状态
8. **事件日志**：附录B 34 类事件子集的实时流（可过滤）

## 推荐验证路径

| # | 对比 | 操作 | 观察点 |
|---|------|------|--------|
| 1 | DOM vs Canvas | ①渲染器切 CSS Grid ↔ Canvas 2D | DOM 节点性能 vs 真等距视觉 |
| 2 | 边界策略 | ①策略A硬边界+美化=无 → 跨区块观察接缝 → 切策略B+alpha_blend | 接缝消失/柔化 |
| 3 | 内部方案 | ①切方案A → 找建筑按 E（180ms 加载）→ 退出；切方案B → 塔楼按 E（秒切）→ 踩楼梯切 Z 层 | 延迟与连续性差异 |
| 4 | 区块大小 | ①切 32/64/96（世界重建） | 流式粒度与生成耗时权衡（附录E 推荐 64 的实证） |
| 5 | 生成器 | ④模拟延迟 2500ms + ①生成器 mock_llm → 移动触发 P0；再切程序化 | 丰富地形 vs 即时但单调 |
| 6 | 性能 | ⑥场景 S2（小·巡游）→ 报告；再 S4（大·巡游）→ 对比 FPS/命中率 | 规模对渲染链路影响 |
| 7 | 资源映射 | ⑦切「精灵图集」 | 同一 tiles[][] 数据 → ImageGen 手绘风贴图换肤 |

## 精灵图再生成

图集由 ImageGen 工具生成（协议 v2 双图集，RPG Maker 分层模型）：

```
public/sprites/plane-tiles-v2.jpg     ← 平面层：4×4 方形俯视纹理（仿射扭曲到菱形）
public/sprites/vertical-tiles-v2.png  ← 垂直层：4×4 直立精灵，纯黑底（运行时 chroma-key）
```

再生成垂直层：用 ImageGen 以「strict 4x4 grid, pure black background, upright sprites, no
watermark」提示词生成（行1: trees/peak/wall/door；行2: stairs/player），存为
`public/sprites/vertical-tiles-v2(1).jpg` 后执行 `scripts/atlas-postprocess.ps1`
（jpg→png 1024×1024、格线/外框/水印填纯黑）。格位约定见 `src/render/sprite-sheet.ts` 的
PLANE_MAPPING / VERTICAL_MAPPING / TILE_RECIPE。注意 `atlas-postprocess.ps1` 必须保持纯
ASCII（Windows PowerShell 5.1 会误读无 BOM 的 UTF-8 中文注释）。

## 冒烟/视觉脚本

```bash
NODE_PATH=../../node_modules node scripts/smoke.cjs   # 控制台错误 + 移动链路截图
NODE_PATH=../../node_modules node scripts/visual.cjs  # 4 组决策分叉视觉截图
```

## 迁移主项目指引

- `types/tile-map.ts` → `packages/shared/src/types/tile-map.ts`（字段级一致，直接替换）
- `core/*` 纯函数/调度/缓存 → `packages/backend/src/game-systems/tile-map/` + `services/tile-map-scheduler/`
  （WorldEngine 需按架构规范拆回 MapProgram G2 / TileMapService F / PrefetchScheduler E 三层；沙箱注释已标注各段归属）
- `render/Canvas2DRenderer.ts` → `packages/frontend/src/renderers/Canvas2DRenderer.ts`（ITileMapRenderer 端口已实现语义）
- 控制面板决策快照（DecisionSnapshot）→ 模块7 PerformanceDashboard Props
- 沙箱 mock_llm → 主项目 real 模式（InstrumentedLLMMapGenerator 装饰器）
