import type { DriveProfile } from '@/types';

export const DRIVE_DIMENSIONS: { key: keyof DriveProfile; label: string; color: string }[] = [
  { key: 'survival', label: '生存', color: 'var(--error)' },
  { key: 'social', label: '社交', color: 'var(--primary)' },
  { key: 'ambition', label: '野心', color: 'var(--warning)' },
  { key: 'knowledge', label: '求知', color: 'var(--info)' },
  { key: 'duty', label: '责任', color: 'var(--success)' },
  { key: 'creativity', label: '创造', color: 'var(--accent)' },
];
