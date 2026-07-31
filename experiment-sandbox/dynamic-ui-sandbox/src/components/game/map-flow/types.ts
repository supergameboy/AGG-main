import type { Node, Edge } from '@xyflow/react';
import type { MermaidNodeStyle } from './parseMermaidToFlowData';

export type LocationNodeData = {
  id: string;
  name: string;
  description?: string;
  type?: string;
  parentId?: string;
  childIds?: string[];
  dangerLevel?: number;
  discovered: boolean;
  current: boolean;
  travelTime?: number;
  customData?: Record<string, unknown>;
  /** mermaid style/classDef 解析出的自定义样式，覆盖默认配色 */
  customStyle?: MermaidNodeStyle;
};

export type LocationNode = Node<LocationNodeData, 'current' | 'discovered' | 'undiscovered'>;

export type PathEdgeData = {
  travelTime?: number;
  isOneWay: boolean;
  direction?: string;
  /** mermaid 边标签（如 |南行|），优先于 travelTime 展示 */
  label?: string;
};

export type PathEdge = Edge<PathEdgeData, 'path'>;

export type SkillNodeData = {
  id: string;
  name: string;
  description?: string;
  unlocked: boolean;
  level?: number;
  cost?: number;
  skillType?: string;
  /** mermaid style/classDef 解析出的自定义样式，覆盖默认配色 */
  customStyle?: MermaidNodeStyle;
};

export type SkillNode = Node<SkillNodeData, 'skill'>;
