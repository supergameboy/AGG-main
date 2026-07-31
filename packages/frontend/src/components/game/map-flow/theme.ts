export const mapFlowStyles = {
  backgroundColor: 'var(--bg-card)',
};

export const mapFlowDefaultEdgeOptions = {
  type: 'path' as const,
  style: { stroke: 'var(--border-primary)', strokeWidth: 1.5 },
  animated: false,
};

export const NODE_COLORS = {
  current: {
    border: 'var(--accent)',
    bg: 'var(--accent)',
    text: '#ffffff',
    glow: 'var(--glow-accent)',
  },
  discovered: {
    border: 'var(--success)',
    bg: 'var(--bg-secondary)',
    text: 'var(--text-primary)',
    glow: 'none',
  },
  undiscovered: {
    border: 'var(--border-primary)',
    bg: 'var(--bg-primary)',
    text: 'var(--text-muted)',
    glow: 'none',
  },
  skill: {
    unlocked: {
      border: 'var(--success)',
      bg: 'var(--bg-secondary)',
      text: 'var(--text-primary)',
    },
    locked: {
      border: 'var(--border-primary)',
      bg: 'var(--bg-primary)',
      text: 'var(--text-muted)',
    },
  },
};

export const NODE_SIZES = {
  current: { width: 200, height: 90 },
  discovered: { width: 180, height: 80 },
  undiscovered: { width: 120, height: 50 },
  skill: { width: 140, height: 60 },
};
