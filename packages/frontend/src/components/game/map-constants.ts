export interface LocationTypeConfig {
  icon: string;
  bgColor: string;
  textColor: string;
}

const DEFAULT_CONFIG: LocationTypeConfig = {
  icon: '📍',
  bgColor: 'var(--accent)',
  textColor: '#ffffff',
};

export const LOCATION_TYPE_CONFIG: Record<string, LocationTypeConfig> = {
  village: { icon: '🏘️', bgColor: '#22c55e', textColor: '#ffffff' },
  city: { icon: '🏰', bgColor: '#3b82f6', textColor: '#ffffff' },
  dungeon: { icon: '⚔️', bgColor: '#ef4444', textColor: '#ffffff' },
  forest: { icon: '🌲', bgColor: '#059669', textColor: '#ffffff' },
  desert: { icon: '🏜️', bgColor: '#d97706', textColor: '#ffffff' },
  mountain: { icon: '⛰️', bgColor: '#6b7280', textColor: '#ffffff' },
  port: { icon: '⚓', bgColor: '#0ea5e9', textColor: '#ffffff' },
  ruins: { icon: '🏚️', bgColor: '#8b5cf6', textColor: '#ffffff' },
  cave: { icon: '🕳️', bgColor: '#78716c', textColor: '#ffffff' },
  temple: { icon: '⛩️', bgColor: '#eab308', textColor: '#1a1a1a' },
  swamp: { icon: '🌿', bgColor: '#65a30d', textColor: '#ffffff' },
  plains: { icon: '🌾', bgColor: '#84cc16', textColor: '#1a1a1a' },
  region: { icon: '📍', bgColor: '#6366f1', textColor: '#ffffff' },
  shop: { icon: '🏪', bgColor: 'var(--accent)', textColor: '#ffffff' },
  inn: { icon: '🛏️', bgColor: 'var(--accent)', textColor: '#ffffff' },
  tavern: { icon: '🍺', bgColor: 'var(--accent)', textColor: '#ffffff' },
  poi: { icon: '📍', bgColor: 'var(--accent)', textColor: '#ffffff' },
};

export function getLocationTypeConfig(type: string | undefined): LocationTypeConfig {
  if (!type) return DEFAULT_CONFIG;
  return LOCATION_TYPE_CONFIG[type] ?? DEFAULT_CONFIG;
}
