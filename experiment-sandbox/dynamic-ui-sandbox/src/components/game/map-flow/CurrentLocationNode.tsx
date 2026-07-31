import { type NodeProps } from '@xyflow/react';
import { NodeHandles } from './NodeHandles';
import { NODE_COLORS } from './theme';
import type { LocationNodeData } from './types';

export function CurrentLocationNode({ data }: NodeProps) {
  const d = data as LocationNodeData;
  const colors = NODE_COLORS.current;
  const custom = d.customStyle;
  return (
    <div
      style={{
        width: 200,
        height: 90,
        border: `2px solid ${custom?.stroke ?? colors.border}`,
        borderStyle: custom?.strokeDasharray ? 'dashed' : 'solid',
        borderRadius: 12,
        background: custom?.fill ?? colors.bg,
        color: custom?.color ?? colors.text,
        boxShadow: colors.glow,
        padding: '8px 12px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        animation: 'pulse 2s ease-in-out infinite',
      }}
    >
      <NodeHandles />
      <div style={{ fontSize: 10, opacity: 0.8, marginBottom: 2 }}>📍 当前位置</div>
      <div style={{ fontSize: 14, fontWeight: 700, textAlign: 'center', lineHeight: 1.2 }}>{String(d.name)}</div>
      <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
        {d.type && <span style={{ background: 'color-mix(in srgb, var(--accent) 20%, transparent)', padding: '1px 6px', borderRadius: 4 }}>{String(d.type)}</span>}
      </div>
      <style>{`@keyframes pulse { 0%, 100% { box-shadow: var(--glow-accent); } 50% { box-shadow: 0 0 24px color-mix(in srgb, var(--accent) 50%, transparent); } }`}</style>
    </div>
  );
}
