# packages/frontend/src/

前端源代码——React + Zustand + TypeScript 游戏界面。

## 分层架构

```
pages/          → 路由页面（组合 components/）
  ↓ 使用
components/     → UI 组件（使用 stores/ 和 api/）
  ↓ 使用
stores/         → 状态管理（使用 api/ 和 mappers/）
  ↓ 使用
api/            → API 客户端（使用 shared/types）
```

## 目录职责

| 目录 | 职责 |
|------|------|
| `api/` | 后端 API 客户端（axios 实例 + 各领域 API 函数） |
| `components/ui/` | 基础 UI 组件库（Button、Card、Modal 等原子组件） |
| `components/game/` | 游戏运行时界面（面板、DevTools、DynamicUI） |
| `components/template/` | 模板编辑器 |
| `components/layout/` | 布局组件 |
| `components/common/` | 通用业务组件（ErrorBoundary、LoadingScreen 等） |
| `config/` | 前端常量 |
| `hooks/` | 自定义 React Hooks |
| `i18n/` | 国际化资源 |
| `mappers/` | 后端数据→前端数据映射 |
| `pages/` | 路由页面组件 |
| `stores/` | Zustand 状态管理 |
| `styles/` | 全局样式 |
| `types/` | 前端专用类型 |
| `utils/` | 工具函数 |

## 规则

- pages **不直接**调用 api → 应通过 stores
- components **不直接**调用 api → 应通过 stores 或 hooks
- 前后端共享类型放 `packages/shared/types/`，不放这里
