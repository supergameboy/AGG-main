import { type NodeProps } from '@xyflow/react';
import { NodeHandles } from './NodeHandles';
import { NODE_COLORS } from './theme';
import type { SkillNodeData } from './types';

export function SkillNode({ data }: NodeProps) {
  const d = data as SkillNodeData;
  const unlocked = d.unlocked === true;
  const colors = unlocked ? NODE_COLORS.skill.unlocked : NODE_COLORS.skill.locked;
  const custom = d.customStyle;
  return (
    <div
      title={d.description ?? undefined}
      style={{
        width: 140,
        height: 60,
        border: `${unlocked ? '2px' : '1px'} ${custom?.strokeDasharray || !unlocked ? 'dashed' : 'solid'} ${custom?.stroke ?? colors.border}`,
        borderRadius: 12,
        background: custom?.fill ?? colors.bg,
        color: custom?.color ?? colors.text,
        opacity: unlocked ? 1 : 0.6,
        padding: '6px 10px',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        cursor: 'pointer',
      }}
    >
      <NodeHandles />
      <div style={{ fontSize: 12, fontWeight: 600, textAlign: 'center' }}>{String(d.name)}</div>
      {d.level != null && (
        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 2 }}>Lv.{d.level}</div>
      )}
    </div>
  );
}
