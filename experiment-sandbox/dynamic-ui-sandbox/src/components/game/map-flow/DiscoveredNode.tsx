import { type NodeProps } from '@xyflow/react';
import { NodeHandles } from './NodeHandles';
import { NODE_COLORS } from './theme';
import type { LocationNodeData } from './types';

export function DiscoveredNode({ data, selected }: NodeProps) {
  const d = data as LocationNodeData;
  const colors = NODE_COLORS.discovered;
  const custom = d.customStyle;
  return (
    <div
      title={d.description ?? undefined}
      style={{
        width: 180,
        height: 80,
        border: `2px solid ${selected ? 'var(--accent)' : custom?.stroke ?? colors.border}`,
        borderStyle: custom?.strokeDasharray ? 'dashed' : 'solid',
        borderRadius: 12,
        background: custom?.fill ?? colors.bg,
        color: custom?.color ?? colors.text,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
    >
      <NodeHandles />
      <div style={{ fontSize: 13, fontWeight: 600, textAlign: 'center', lineHeight: 1.2 }}>{String(d.name)}</div>
      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
        {d.type && <span style={{ background: 'color-mix(in srgb, var(--success) 15%, transparent)', padding: '1px 6px', borderRadius: 4 }}>{String(d.type)}</span>}
        {d.dangerLevel != null && <span style={{ color: d.dangerLevel >= 7 ? 'var(--error)' : d.dangerLevel >= 4 ? 'var(--warning)' : 'var(--success)' }}>Lv.{d.dangerLevel}</span>}
      </div>
    </div>
  );
}
