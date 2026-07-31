import type { Node, Edge } from '@xyflow/react';

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
};

export type LocationNode = Node<LocationNodeData, 'current' | 'discovered' | 'undiscovered'>;

export type PathEdgeData = {
  travelTime?: number;
  isOneWay: boolean;
  direction?: string;
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
};

export type SkillNode = Node<SkillNodeData, 'skill'>;
