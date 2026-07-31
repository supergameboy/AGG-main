import { describe, expect, it } from 'vitest';
import { MODE_AGENT_MAPPING } from '../agent-mapping.js';

/**
 * 集成验证测试：ModeRouter 输出的 AgentType 与 fantasy_rpg.yaml 注册名一致
 *
 * 验证点：
 * - MODE_AGENT_MAPPING 中所有 candidateAgentTypes 与 fantasy_rpg.yaml 的 englishId 集合一致
 * - 不存在拼写错误（如 combat_director 应为 combat）
 * - 不存在未注册的 AgentType（导致 spawn_agent 找不到 Agent）
 *
 * 设计依据：[agent-config-and-g2-subroutine 设计](../../../../../../docs/design/fractal-design-20260724-agent-config-and-g2-subroutine/fractal-design-20260724-agent-config-and-g2-subroutine.md) §6.2
 */

/**
 * fantasy_rpg.yaml 中注册的 englishId 集合（Agent 真实类型名）
 *
 * 来源：packages/backend/config/agent-profiles/fantasy_rpg.yaml
 * 更新时机：yaml 新增/删除 Agent 时同步更新此集合
 */
const REGISTERED_AGENT_TYPES = new Set([
  'gamemaster',
  'map',
  'challenge',
  'output',
  'quest',
  'npc_party',
  'inventory',
  'skill',
  'event',
  'time',
]);

/**
 * 收集 MODE_AGENT_MAPPING 中所有出现过的 candidateAgentTypes
 */
function collectAllCandidateAgentTypes(): Set<string> {
  const allTypes = new Set<string>();
  for (const intentMap of Object.values(MODE_AGENT_MAPPING)) {
    for (const agents of Object.values(intentMap)) {
      for (const agent of agents) {
        allTypes.add(agent);
      }
    }
  }
  return allTypes;
}

describe('ModeRouter 集成验证 - AgentType 名称一致性', () => {
  it('MODE_AGENT_MAPPING 中所有 AgentType 都在 REGISTERED_AGENT_TYPES 集合中', () => {
    const allCandidates = collectAllCandidateAgentTypes();
    const unregistered = [...allCandidates].filter(
      (type) => !REGISTERED_AGENT_TYPES.has(type),
    );

    expect(unregistered).toEqual([]);
  });

  it('不存在 combat_director 拼写错误（应为 challenge）', () => {
    const allCandidates = collectAllCandidateAgentTypes();
    expect(allCandidates.has('combat_director')).toBe(false);
    expect(allCandidates.has('challenge')).toBe(true);
  });

  it('combat intentHint 在 text_rpg/rpg_2d 模式下候选包含 challenge Agent', () => {
    expect(MODE_AGENT_MAPPING.text_rpg.combat).toContain('challenge');
    expect(MODE_AGENT_MAPPING.rpg_2d.combat).toContain('challenge');
  });

  it('gamemaster 在所有 gameMode 的所有 intentHint 中都存在（兜底）', () => {
    for (const [gameMode, intentMap] of Object.entries(MODE_AGENT_MAPPING)) {
      for (const [intentHint, agents] of Object.entries(intentMap)) {
        expect(agents).toContain('gamemaster');
      }
    }
  });
});
