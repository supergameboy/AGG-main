import { describe, it, expect } from 'vitest';
import { normalizeKeys, parseLLMJson, extractJSONFromContent, attemptTruncatedJSONRepair } from '../../utils/llm-json.js';

describe('normalizeKeys', () => {
  it('converts snake_case keys to camelCase', () => {
    const input = { initial_projection: { chapter: 'ch1', main_quest: 'quest1' } };
    const result = normalizeKeys(input) as any;
    expect(result.initialProjection).toBeDefined();
    expect(result.initialProjection.chapter).toBe('ch1');
    expect(result.initialProjection.mainQuest).toBe('quest1');
    expect(result.initial_projection).toBeUndefined();
  });

  it('preserves already camelCase keys', () => {
    const input = { initialProjection: { chapter: 'ch1', mainQuest: 'quest1' } };
    const result = normalizeKeys(input) as any;
    expect(result.initialProjection.chapter).toBe('ch1');
    expect(result.initialProjection.mainQuest).toBe('quest1');
  });

  it('handles mixed snake_case and camelCase keys', () => {
    const input = { story_goal: 'goal1', playerFacingObjective: 'obj1' };
    const result = normalizeKeys(input) as any;
    expect(result.storyGoal).toBe('goal1');
    expect(result.playerFacingObjective).toBe('obj1');
    expect(result.story_goal).toBeUndefined();
  });

  it('recursively normalizes nested objects', () => {
    const input = {
      task_review: {
        completion: 'complete',
        missing_requirements: ['req1'],
      },
      second_layer_decision: {
        should_schedule: true,
        constraints: {
          must_reveal: ['hint1'],
          must_hide: [],
        },
      },
    };
    const result = normalizeKeys(input) as any;
    expect(result.taskReview).toBeDefined();
    expect(result.taskReview.completion).toBe('complete');
    expect(result.taskReview.missingRequirements).toEqual(['req1']);
    expect(result.secondLayerDecision).toBeDefined();
    expect(result.secondLayerDecision.shouldSchedule).toBe(true);
    expect(result.secondLayerDecision.constraints.mustReveal).toEqual(['hint1']);
  });

  it('normalizes arrays of objects', () => {
    const input = [
      { agent_type: 'challenge', task_description: 'fight' },
      { agent_type: 'quest', task_description: 'search' },
    ];
    const result = normalizeKeys(input) as any[];
    expect(result[0].agentType).toBe('challenge');
    expect(result[0].taskDescription).toBe('fight');
    expect(result[1].agentType).toBe('quest');
  });

  it('does not modify non-snake_case keys', () => {
    const input = { id: 'abc', name: 'test', type: 'story' };
    const result = normalizeKeys(input) as any;
    expect(result.id).toBe('abc');
    expect(result.name).toBe('test');
    expect(result.type).toBe('story');
  });

  it('handles null and undefined values', () => {
    const input = { storyGoal: null, playerFacingObjective: undefined };
    const result = normalizeKeys(input) as any;
    expect(result.storyGoal).toBeNull();
    expect(result.playerFacingObjective).toBeUndefined();
  });

  it('handles primitive values (string, number, boolean)', () => {
    expect(normalizeKeys('hello')).toBe('hello');
    expect(normalizeKeys(42)).toBe(42);
    expect(normalizeKeys(true)).toBe(true);
    expect(normalizeKeys(null)).toBeNull();
    expect(normalizeKeys(undefined)).toBeUndefined();
  });

  it('does not convert single-word keys (no underscores)', () => {
    const input = { chapter: 'ch1', quest: 'q1' };
    const result = normalizeKeys(input) as any;
    expect(result.chapter).toBe('ch1');
    expect(result.quest).toBe('q1');
  });

  it('handles keys with numbers after underscore', () => {
    const input = { layer_1_agents: ['challenge'], node_2_type: 'quest' };
    const result = normalizeKeys(input) as any;
    expect(result.layer1Agents).toEqual(['challenge']);
    expect(result.node2Type).toBe('quest');
  });
});

describe('extractJSONFromContent', () => {
  it('extracts JSON from complete markdown code block', () => {
    const input = '```json\n{"key": "value"}\n```';
    const result = extractJSONFromContent(input);
    expect(result).toBe('{"key": "value"}');
  });

  it('extracts JSON from markdown code block without closing ```', () => {
    const input = '```json\n{"initialProjection": {"chapter": "ch1", "mainQuest": "mq1"}}';
    const result = extractJSONFromContent(input);
    expect(result.startsWith('{')).toBe(true);
    expect(result).toContain('"initialProjection"');
  });

  it('extracts JSON from markdown code block with truncated content', () => {
    const input = '```json\n{"initialProjection": {"chapter": "ch1"},\n  "storyGoal": "goal",\n  "cha';
    const result = extractJSONFromContent(input);
    expect(result.startsWith('{')).toBe(true);
    expect(result).toContain('"initialProjection"');
  });

  it('returns raw content if already starts with {', () => {
    const input = '{"key": "value"}';
    const result = extractJSONFromContent(input);
    expect(result).toBe('{"key": "value"}');
  });
});

describe('attemptTruncatedJSONRepair', () => {
  it('repairs truncated JSON with unclosed string', () => {
    const input = '{"initialProjection": {"chapter": "ch1"}, "storyGoal": "goal", "cha';
    const result = attemptTruncatedJSONRepair(input);
    expect(result).not.toBeNull();
    expect(result!.initialProjection).toEqual({ chapter: 'ch1' });
  });

  it('repairs truncated JSON with missing closing braces', () => {
    const input = '{"initialProjection": {"chapter": "ch1", "mainQuest": "mq1"}';
    const result = attemptTruncatedJSONRepair(input);
    expect(result).not.toBeNull();
    expect(result!.initialProjection).toEqual({ chapter: 'ch1', mainQuest: 'mq1' });
  });

  it('repairs truncated JSON with incomplete key-value pair at end', () => {
    const input = '{"a": 1, "b": [1, 2], "c": "val", "incomplete';
    const result = attemptTruncatedJSONRepair(input);
    expect(result).not.toBeNull();
    expect(result!.a).toBe(1);
    expect(result!.b).toEqual([1, 2]);
  });

  it('repairs JSON with trailing comma', () => {
    const input = '{"a": 1, "b": 2,}';
    const result = attemptTruncatedJSONRepair(input);
    expect(result).not.toBeNull();
    expect(result!.a).toBe(1);
    expect(result!.b).toBe(2);
  });

  it('repairs truncated JSON with trailing comma after last complete element', () => {
    const input = '{"initialProjection": {"chapter": "ch1"}, "hooks": ["h1"],';
    const result = attemptTruncatedJSONRepair(input);
    expect(result).not.toBeNull();
    expect(result!.initialProjection).toEqual({ chapter: 'ch1' });
    expect(result!.hooks).toEqual(['h1']);
  });

  it('repairs deeply truncated JSON by progressive truncation', () => {
    const input = '{"a": {"b": {"c": 1}}, "d": "incomplete';
    const result = attemptTruncatedJSONRepair(input);
    expect(result).not.toBeNull();
    expect(result!.a).toBeDefined();
  });

  it('returns null for completely unparseable content', () => {
    const input = 'this is not json at all';
    const result = attemptTruncatedJSONRepair(input);
    expect(result).toBeNull();
  });

  it('handles string values containing } character correctly', () => {
    const input = '{"message": "hello } world", "next": "tru';
    const result = attemptTruncatedJSONRepair(input);
    expect(result).not.toBeNull();
    expect(result!.message).toBe('hello } world');
  });
});

describe('parseLLMJson with normalizeKeys', () => {
  it('automatically normalizes snake_case keys from LLM output', () => {
    const input = JSON.stringify({
      initial_projection: { chapter: 'chapter_1', main_quest: 'Find the artifact' },
      story_goal: 'Save the kingdom',
      initial_hooks: ['hook1', 'hook2'],
    });
    const result = parseLLMJson(input, 'test') as any;
    expect(result.initialProjection).toBeDefined();
    expect(result.initialProjection.chapter).toBe('chapter_1');
    expect(result.initialProjection.mainQuest).toBe('Find the artifact');
    expect(result.storyGoal).toBe('Save the kingdom');
    expect(result.initialHooks).toEqual(['hook1', 'hook2']);
  });

  it('handles LLM output wrapped in markdown code blocks', () => {
    const input = '```json\n{"initial_projection": {"chapter": "ch1", "main_quest": "mq1"}}\n```';
    const result = parseLLMJson(input, 'test') as any;
    expect(result.initialProjection.chapter).toBe('ch1');
    expect(result.initialProjection.mainQuest).toBe('mq1');
  });

  it('handles truncated LLM output in markdown code block without closing ```', () => {
    const input = '```json\n{"initialProjection": {"chapter": "ch1", "mainQuest": "mq1"},\n  "initialHooks": ["h1", "h2"],\n  "storyGoal": "Save the world",\n  "cha';
    const result = parseLLMJson(input, 'test') as any;
    expect(result.initialProjection).toBeDefined();
    expect(result.initialProjection.chapter).toBe('ch1');
    expect(result.initialHooks).toEqual(['h1', 'h2']);
  });

  it('preserves camelCase LLM output unchanged', () => {
    const input = JSON.stringify({
      initialProjection: { chapter: 'ch1', mainQuest: 'mq1' },
      storyGoal: 'goal',
    });
    const result = parseLLMJson(input, 'test') as any;
    expect(result.initialProjection.chapter).toBe('ch1');
    expect(result.initialProjection.mainQuest).toBe('mq1');
    expect(result.storyGoal).toBe('goal');
  });

  it('normalizes deeply nested snake_case structures', () => {
    const input = JSON.stringify({
      second_layer_decision: {
        should_schedule: true,
        agents: ['challenge'],
        constraints: {
          must_reveal: ['secret1'],
          must_hide: ['hidden1'],
        },
      },
    });
    const result = parseLLMJson(input, 'test') as any;
    expect(result.secondLayerDecision.shouldSchedule).toBe(true);
    expect(result.secondLayerDecision.constraints.mustReveal).toEqual(['secret1']);
  });

  it('normalizes DAG plan with snake_case node fields', () => {
    const input = JSON.stringify({
      version: '1.0',
      layer: 1,
      nodes: [
        { id: 'n1', agent_type: 'challenge', depends_on: [], task_description: 'Fight' },
      ],
    });
    const result = parseLLMJson(input, 'test') as any;
    expect(result.nodes[0].agentType).toBe('challenge');
    expect(result.nodes[0].dependsOn).toEqual([]);
    expect(result.nodes[0].taskDescription).toBe('Fight');
  });

  it('handles real-world truncated LLM output scenario', () => {
    const input = '```json\n{\n  "initialProjection": {\n    "chapter": "chapter_1",\n    "mainQuest": "Investigate the village"\n  },\n  "initialHooks": [\n    "hook_village_quest",\n    "hook_iron_merchant"\n  ],\n  "storyGoal": "Save the kingdom",\n  "cha';
    const result = parseLLMJson(input, 'test') as any;
    expect(result.initialProjection).toBeDefined();
    expect(result.initialProjection.chapter).toBe('chapter_1');
    expect(result.initialHooks).toEqual(['hook_village_quest', 'hook_iron_merchant']);
  });
});
