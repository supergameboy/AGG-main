import { Fragment } from 'react';
import { Handle, Position } from '@xyflow/react';

const SIDES = [
  { position: Position.Top, id: 'top' },
  { position: Position.Bottom, id: 'bottom' },
  { position: Position.Left, id: 'left' },
  { position: Position.Right, id: 'right' },
] as const;

/**
 * 双向连接点：每个方位同时挂 source（s-{side}）与 target（t-{side}）Handle，
 * 配合边的 sourceHandle/targetHandle 按布局方向精确连线。
 */
export function NodeHandles() {
  return (
    <>
      {SIDES.map(({ position, id }) => (
        <Fragment key={id}>
          <Handle type="source" position={position} id={`s-${id}`} />
          <Handle type="target" position={position} id={`t-${id}`} />
        </Fragment>
      ))}
    </>
  );
}
