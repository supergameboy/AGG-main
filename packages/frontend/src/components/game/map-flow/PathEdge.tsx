import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react';
import type { PathEdgeData } from './types';

export function PathEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const d = data as PathEdgeData | undefined;
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const isOneWay = d?.isOneWay ?? false;
  const travelTime = d?.travelTime;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          stroke: selected ? 'var(--accent)' : 'var(--border-primary)',
          strokeWidth: selected ? 2 : 1.5,
        }}
        markerEnd={isOneWay ? markerEnd : undefined}
      />
      {travelTime != null && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              fontSize: 10,
              color: 'var(--text-muted)',
              background: 'var(--bg-primary)',
              padding: '1px 4px',
              borderRadius: 3,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
          >
            {String(travelTime)}h
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
