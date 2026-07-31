import { describe, it, expect, beforeEach } from 'vitest';
import { TraceCollector } from '../TraceCollector.js';

describe('TraceCollector', () => {
  let collector: TraceCollector;

  beforeEach(() => {
    collector = new TraceCollector('req-001');
  });

  describe('recordIteration', () => {
    it('records iteration without tool call', () => {
      collector.recordIteration({
        agentType: 'challenge',
        iteration: 1,
        maxIterations: 5,
      });

      const traces = collector.getAgentTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0].agentType).toBe('challenge');
      expect(traces[0].iterations).toBe(1);
      expect(traces[0].maxIterations).toBe(5);
      expect(traces[0].toolCalls).toHaveLength(0);
    });

    it('records iteration with tool call', () => {
      collector.recordIteration({
        agentType: 'dialogue',
        iteration: 2,
        maxIterations: 10,
        toolCall: {
          tool: 'get_npc_state',
          args: { npcId: 'blacksmith' },
          resultPreview: '{"mood":"friendly"}',
          duration: 120,
          isReadOperation: true,
        },
      });

      const traces = collector.getAgentTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0].iterations).toBe(2);
      expect(traces[0].maxIterations).toBe(10);
      expect(traces[0].toolCalls).toHaveLength(1);
      expect(traces[0].toolCalls[0]).toEqual({
        iteration: 2,
        tool: 'get_npc_state',
        args: { npcId: 'blacksmith' },
        resultPreview: '{"mood":"friendly"}',
        duration: 120,
        isReadOperation: true,
      });
    });
  });

  describe('setReachedMax', () => {
    it('sets reachedMax flag', () => {
      collector.recordIteration({
        agentType: 'quest',
        iteration: 5,
        maxIterations: 5,
      });

      collector.setReachedMax('quest', true);

      const trace = collector.getAgentTraces().find(t => t.agentType === 'quest');
      expect(trace?.reachedMax).toBe(true);
    });
  });

  describe('setTokenUsage', () => {
    it('sets token usage data', () => {
      collector.recordIteration({
        agentType: 'challenge',
        iteration: 1,
        maxIterations: 5,
      });

      const usage = { input: 500, output: 200, total: 700, cacheHit: 100, cacheMiss: 400 };
      collector.setTokenUsage('challenge', usage);

      const trace = collector.getAgentTraces().find(t => t.agentType === 'challenge');
      expect(trace?.tokenUsage).toEqual(usage);
    });
  });

  describe('setFinalAnswer', () => {
    it('sets final answer', () => {
      collector.recordIteration({
        agentType: 'dialogue',
        iteration: 3,
        maxIterations: 10,
      });

      collector.setFinalAnswer('dialogue', 'The blacksmith greets you warmly.');

      const trace = collector.getAgentTraces().find(t => t.agentType === 'dialogue');
      expect(trace?.finalAnswer).toBe('The blacksmith greets you warmly.');
    });
  });

  describe('toAgentTraceData', () => {
    it('returns complete trace data', () => {
      collector.recordIteration({
        agentType: 'challenge',
        iteration: 2,
        maxIterations: 5,
        toolCall: {
          tool: 'roll_dice',
          args: { sides: 20 },
          resultPreview: '15',
          duration: 50,
          isReadOperation: false,
        },
      });

      collector.setTokenUsage('challenge', { input: 300, output: 100, total: 400, cacheHit: 50, cacheMiss: 250 });
      collector.setFinalAnswer('challenge', 'You hit the goblin for 15 damage.');
      collector.setReachedMax('challenge', false);

      const data = collector.toAgentTraceData();

      expect(data.requestId).toBe('req-001');
      expect(data.agentTraces).toHaveLength(1);
      expect(data.coordinatorDecisions).toEqual([]);
      expect(data.agentTraces[0].agentType).toBe('challenge');
      expect(data.agentTraces[0].iterations).toBe(2);
      expect(data.agentTraces[0].maxIterations).toBe(5);
      expect(data.agentTraces[0].reachedMax).toBe(false);
      expect(data.agentTraces[0].toolCalls).toHaveLength(1);
      expect(data.agentTraces[0].tokenUsage).toEqual({ input: 300, output: 100, total: 400, cacheHit: 50, cacheMiss: 250 });
      expect(data.agentTraces[0].finalAnswer).toBe('You hit the goblin for 15 damage.');
    });
  });

  describe('multiple agents', () => {
    it('records traces for different agent types independently', () => {
      collector.recordIteration({
        agentType: 'challenge',
        iteration: 1,
        maxIterations: 5,
        toolCall: {
          tool: 'roll_dice',
          args: { sides: 20 },
          resultPreview: '18',
          duration: 30,
          isReadOperation: false,
        },
      });

      collector.recordIteration({
        agentType: 'dialogue',
        iteration: 1,
        maxIterations: 10,
        toolCall: {
          tool: 'get_npc_state',
          args: { npcId: 'merchant' },
          resultPreview: '{"mood":"neutral"}',
          duration: 80,
          isReadOperation: true,
        },
      });

      collector.recordIteration({
        agentType: 'challenge',
        iteration: 2,
        maxIterations: 5,
        toolCall: {
          tool: 'apply_damage',
          args: { target: 'goblin', amount: 18 },
          resultPreview: 'dead',
          duration: 20,
          isReadOperation: false,
        },
      });

      const traces = collector.getAgentTraces();
      expect(traces).toHaveLength(2);

      const combatTrace = traces.find(t => t.agentType === 'challenge');
      const dialogueTrace = traces.find(t => t.agentType === 'dialogue');

      expect(combatTrace?.iterations).toBe(2);
      expect(combatTrace?.toolCalls).toHaveLength(2);
      expect(combatTrace?.maxIterations).toBe(5);

      expect(dialogueTrace?.iterations).toBe(1);
      expect(dialogueTrace?.toolCalls).toHaveLength(1);
      expect(dialogueTrace?.maxIterations).toBe(10);
    });
  });

  describe('getAgentTraces', () => {
    it('returns all agent traces', () => {
      collector.recordIteration({ agentType: 'challenge', iteration: 1, maxIterations: 5 });
      collector.recordIteration({ agentType: 'dialogue', iteration: 1, maxIterations: 10 });
      collector.recordIteration({ agentType: 'quest', iteration: 1, maxIterations: 8 });

      const traces = collector.getAgentTraces();
      expect(traces).toHaveLength(3);

      const types = traces.map(t => t.agentType).sort();
      expect(types).toEqual(['challenge', 'dialogue', 'quest']);
    });
  });
});
