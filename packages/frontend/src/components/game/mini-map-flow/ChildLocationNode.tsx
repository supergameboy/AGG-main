import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { ChildLocationNodeData } from './types';
import { getLocationTypeConfig } from '../map-constants';

export function ChildLocationNode({ data }: NodeProps) {
  const d = data as unknown as ChildLocationNodeData;
  const config = getLocationTypeConfig(d.type);
  const { t } = useTranslation('game');

  const typeLabel = d.type ? t(`map.type.${d.type}`) : null;

  return (
    <div
      style={{
        minWidth: 100,
        border: d.isCurrentLocation
          ? '2px solid var(--accent)'
          : '1px solid var(--border-primary)',
        borderRadius: 8,
        background: d.isCurrentLocation
          ? 'color-mix(in srgb, var(--accent) 15%, var(--bg-secondary))'
          : 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        padding: '4px 8px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        cursor: 'pointer',
        boxShadow: d.isCurrentLocation ? '0 0 8px color-mix(in srgb, var(--accent) 30%, transparent)' : 'none',
        transition: 'border-color 0.2s, box-shadow 0.2s',
      }}
    >
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <div style={{ fontSize: 11, fontWeight: 600, textAlign: 'center', lineHeight: 1.2, display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
        <span>{config.icon}</span>
        <span>{String(d.name)}</span>
      </div>
      <div style={{ fontSize: 9, opacity: 0.7, marginTop: 1, display: 'flex', gap: 4, alignItems: 'center' }}>
        {typeLabel && <span style={{ background: 'color-mix(in srgb, var(--success) 15%, transparent)', padding: '0px 4px', borderRadius: 3 }}>{typeLabel}</span>}
      </div>
      {!d.isCurrentLocation && (
        <div style={{ fontSize: 8, color: 'var(--accent)', marginTop: 2, padding: '1px 6px', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', borderRadius: 3, lineHeight: '14px' }}>→ 前往</div>
      )}
    </div>
  );
}
