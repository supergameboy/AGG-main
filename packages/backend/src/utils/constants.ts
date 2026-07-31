export const INIT_ACTIONS = ['initialize', 'init', 'create_character', 'initialize_game', 'full_initialization', 'enrich_data'] as const;

export type InitAction = typeof INIT_ACTIONS[number];

export function isInitAction(action: string): action is InitAction {
  return (INIT_ACTIONS as readonly string[]).includes(action);
}
