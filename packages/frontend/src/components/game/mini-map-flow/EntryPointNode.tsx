import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useTranslation } from 'react-i18next';
import type { EntryPointNodeData } from './types';

export function EntryPointNode({ data }: NodeProps) {
  const d = data as unknown as EntryPointNodeData;
  const { t } = useTranslation('game');

  return (
    <div
      style={{
        minWidth: 90,
        border: '1px dashed var(--accent)',
        borderRadius: 8,
        background: 'color-mix(in srgb, var(--accent) 8%, var(--bg-secondary))',
        color: 'var(--accent)',
        padding: '4px 8px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
    >
      <Handle type="source" position={Position.Top} id="top" />
      <Handle type="source" position={Position.Bottom} id="bottom" />
      <Handle type="source" position={Position.Left} id="left" />
      <Handle type="source" position={Position.Right} id="right" />
      <div style={{ fontSize: 9, opacity: 0.7, marginBottom: 1 }}>🌐 {d.direction}</div>
      <div style={{ fontSize: 11, fontWeight: 600, textAlign: 'center', lineHeight: 1.2, whiteSpace: 'nowrap' }}>{String(d.regionName)}</div>
      <div style={{ fontSize: 8, color: 'var(--accent)', marginTop: 2, padding: '1px 6px', background: 'color-mix(in srgb, var(--accent) 12%, transparent)', borderRadius: 3, lineHeight: '14px' }}>→ {t('map.travelTo')}</div>
    </div>
  );
}
