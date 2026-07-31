# 交付总览：2DRPG 实时地图 · 决策效果验证沙箱

## 已完成

在 `experiment-sandbox/2drpg-realtime-map` 下建成《2DRPG 实时地图与实时互动系统设计》全决策点验证 demo，覆盖总规划 + 模块1-7 + 附录A-E 的核心机制，**tsc --noEmit 零错误，Playwright 冒烟零控制台错误**，dev server 运行于 http://localhost:5200 。

## 关键实现

| 需求 | 落实 |
|------|------|
| 遵循主项目架构规范 | Vite5+React18+TS strict+Tailwind+Zustand；目录按模块1-7 逐文件映射并标注设计章节；组合根/端口接口/纯函数分层；README 含迁移指引 |
| 功能完备控制面板 | 8 分区：①决策分叉口 ②渲染与光照 ③世界状态 ④调度与结果池 ⑤流式缓存 ⑥性能仪表盘 ⑦资源映射 ⑧事件日志（附录B 实时流） |
| 生产级渲染 | Canvas 2D 等距 + 画家算法 + 贴图预渲染缓存；缩放/平移/点击寻路；迷雾三态；区块占位"未知领域"；60fps |
| 暗黑类 2.5D 混合渲染 | 等距菱形投影 + 墙体棱柱挤出 + 火把闪烁光晕 + 熔岩自发光 + 昼夜循环 + 暗角 + 冷蓝夜色 |
| 精灵图资源映射 | ImageGen 生成暗黑风 4×4 等距图集（约 5-10 credits），chroma-key 抠黑底，TileType→spriteId→图集格位映射，控制面板一键换肤 |

## 决策分叉口（全部可 A/B 即时对比）

渲染器 CSS Grid↔Canvas（附录D）· 风格 俯视/等距/2.5D（§5.2）· 边界策略A硬边界/B上下文（模块2 §3.4）· 边界美化 none/alpha/shader（模块5 §2.1.5）· 内部方案A独立地图/B Z层楼梯切层（模块6，已验证塔楼 Z=2 切层截图）· 区块大小 32/64/96（附录E）· 生成器 procedural/mock_llm/auto（§3.3.5）· ATL/JSON token 估算（§3.2）· 地图规模 S/M/L（模块7）· S1-S8 场景 + Markdown 报告下载（含 DecisionSnapshot）

## 验证结论（截图证据 scripts/*.png）

- 暗黑 2.5D：火把光晕 + 迷雾渐隐 + 等距地块（smoke-1）
- CSS Grid DOM MVP 对照（smoke-2）
- 精灵图集换肤生效（shot-1，ImageGen 沙地/水面贴图直接上屏）
- 白天程序化贴图全亮模式（shot-2）、俯视（shot-3）、深夜巡游（shot-4）
- 方案B 塔楼内 Z=2 原位剖切渲染（interior-B）、方案A 独立内部地图（interior-A）

## 已知边界

- mock_llm 为模拟延迟生成（模块7 mock 模式永久保留语义），real LLM 留待主项目落地
- PixiJS/Three.js 按附录D 分阶段路径以 disabled stub 呈现
- 建筑内部 LLM 生成器在沙箱为程序化模式（附录C 模板直出）
