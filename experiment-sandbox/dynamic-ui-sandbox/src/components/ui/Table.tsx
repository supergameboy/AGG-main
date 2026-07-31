import { cn } from '@/utils/cn';

export interface TableProps {
  /** 表头单元格；缺省时不渲染 thead */
  header?: React.ReactNode[];
  /** 数据行，每行一组单元格 */
  rows: React.ReactNode[][];
  /** 奇数行斑马纹 */
  striped?: boolean;
  /** 行悬浮高亮 */
  hoverable?: boolean;
  /** 紧凑模式（小字号） */
  compact?: boolean;
  className?: string;
}

export function Table({
  header,
  rows,
  striped = false,
  hoverable = false,
  compact = false,
  className,
}: TableProps) {
  return (
    <div className={cn('overflow-x-auto rounded border border-[var(--border-primary)]', className)}>
      <table className={cn('w-full text-sm', compact && 'text-xs')}>
        {header && header.length > 0 && (
          <thead>
            <tr className="bg-[var(--bg-tertiary)]">
              {header.map((cell, i) => (
                <th
                  key={i}
                  className="px-2 py-1 text-left font-semibold text-[var(--text-primary)] border-b border-[var(--border-primary)]"
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((cells, r) => (
            <tr
              key={r}
              className={cn(
                hoverable && 'hover:bg-[var(--bg-tertiary)]',
                striped && r % 2 === 1 && 'bg-[var(--bg-tertiary)]/50'
              )}
            >
              {cells.map((cell, c) => (
                <td
                  key={c}
                  className="px-2 py-1 text-[var(--text-secondary)] border-b border-[var(--border-primary)]/50"
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
