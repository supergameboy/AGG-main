/**
 * 共享类型副本 —— 从 packages/shared/src/types/dynamic-ui.ts 提取的渲染主链路子集。
 * 在沙箱中通过 vite/tsconfig 别名 `@ai-rpg/shared` 指向本文件，
 * 使 UIDirectiveParser / DynamicUIRenderer 的 import 语句与项目完全一致（原样复制）。
 */

export type UIInteractionType =
  | 'use_item'
  | 'equip_item'
  | 'unequip_item'
  | 'drop_item'
  | 'examine_item'
  | 'learn_skill'
  | 'use_skill'
  | 'view_skill'
  | 'travel'
  | 'travel_to'
  | 'talk_npc'
  | 'accept_quest'
  | 'complete_quest'
  | 'abandon_quest'
  | 'buy_item'
  | 'sell_item'
  | 'craft_item'
  | 'enhance_item'
  | 'deposit_item'
  | 'withdraw_item'
  | 'select'
  | 'custom';

export interface UIInteractionData {
  interactionType: UIInteractionType;
  target?: string;
  displayName?: string;
  params?: Record<string, unknown>;
}

export interface UIParsedNode {
  type: 'component' | 'text' | 'markdown' | 'mermaid';
  component?: string;
  attrs?: Record<string, unknown>;
  children?: UIParsedNode[];
  content?: string;
  /**
   * 行内节点标记：由行内组件切分器（一行文本中嵌套 :::name{...}...:::）产生的
   * 文本/组件节点标记为 true。渲染层据此将连续行内节点合并为同一段落流式渲染，
   * 保证 "文本 + tooltip/badge 组件 + 文本" 在同一行内联展示。
   */
  inline?: boolean;
}

// 对应 packages/shared/src/types/i18n.ts 的默认语言常量（i18n/index.ts 入口依赖）
export const DEFAULT_LOCALE = 'zh-CN';
