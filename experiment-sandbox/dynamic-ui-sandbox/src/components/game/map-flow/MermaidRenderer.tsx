import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MarkerType,
  type NodeMouseHandler,
  type Node,
  type Edge,
  type NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import './map-flow.css';
import { PathEdge } from './PathEdge';
import { parseMermaidToFlowData, type ParsedFlowNode } from './parseMermaidToFlowData';
import { directionalLayout, directionHandleSides, type DirectionalLayoutOptions } from './directionalLayout';
import { mapFlowStyles, mapFlowDefaultEdgeOptions } from './theme';
import { useTheme } from '@/hooks/useTheme';
import type { PathEdgeData } from './types';

export interface MermaidRendererProps {
  mermaidCode: string;
  /** React Flow 节点类型注册表 */
  nodeTypes: NodeTypes;
  /** mermaid 解析节点 → React Flow 节点（type/data 为领域差异点，由调用方决定） */
  mapNode: (node: ParsedFlowNode, position: { x: number; y: number }) => Node;
  /** 节点点击回调（原始节点；是否忽略某类节点由调用方判定） */
  onNodeClick?: (node: Node) => void;
  /** 分层布局间距覆盖 */
  layoutOptions?: DirectionalLayoutOptions;
  /** 解析为空时的提示文案 */
  emptyHint?: string;
  /** 容器高度（px） */
  height?: number;
}

const edgeTypes = { path: PathEdge };

function MermaidRendererInner({
  mermaidCode,
  nodeTypes,
  mapNode,
  onNodeClick,
  layoutOptions,
  emptyHint = '无法解析图表数据',
}: MermaidRendererProps) {
  const colorMode = useTheme().resolvedTheme;

  const { nodes, edges } = useMemo((): { nodes: Node[]; edges: Edge[] } => {
    const parsed = parseMermaidToFlowData(mermaidCode);
    if (parsed.nodes.length === 0) return { nodes: [], edges: [] };

    const ids = parsed.nodes.map((n) => n.id);
    const connections = parsed.edges.map((e) => ({ from: e.from, to: e.to }));
    const positions = directionalLayout(ids, connections, parsed.direction, layoutOptions);
    const handleSides = directionHandleSides(parsed.direction);

    const flowNodes: Node[] = parsed.nodes.map((n) =>
      mapNode(n, positions.get(n.id) ?? { x: 0, y: 0 })
    );

    const flowEdges: Edge<PathEdgeData>[] = parsed.edges.map((e, i) => ({
      id: `edge-${i}`,
      source: e.from,
      target: e.to,
      sourceHandle: `s-${handleSides.source}`,
      targetHandle: `t-${handleSides.target}`,
      type: 'path',
      data: {
        isOneWay: e.directed,
        label: e.label,
      },
      style: { stroke: 'var(--border-primary)', strokeWidth: 1.5 },
      markerEnd: e.directed ? { type: MarkerType.ArrowClosed, color: 'var(--border-primary)' } : undefined,
    }));

    return { nodes: flowNodes, edges: flowEdges };
  }, [mermaidCode, mapNode, layoutOptions]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      onNodeClick?.(node);
    },
    [onNodeClick]
  );

  if (nodes.length === 0) {
    return (
      <div className="p-2 text-xs text-[var(--text-muted)]">
        {emptyHint}
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={handleNodeClick}
      defaultEdgeOptions={mapFlowDefaultEdgeOptions}
      fitView
      colorMode={colorMode}
      nodeOrigin={[0.5, 0.5]}
      minZoom={0.3}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      style={mapFlowStyles}
    >
      <Background color="var(--border-primary)" gap={20} size={1} />
      <Controls position="bottom-left" />
    </ReactFlow>
  );
}

export function MermaidRenderer(props: MermaidRendererProps) {
  return (
    <div
      style={{
        height: props.height ?? 300,
        background: 'var(--bg-card)',
        borderRadius: 12,
        overflow: 'hidden',
      }}
    >
      <ReactFlowProvider>
        <MermaidRendererInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
