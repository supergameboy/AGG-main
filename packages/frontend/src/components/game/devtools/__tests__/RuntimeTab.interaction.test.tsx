import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

type RuntimeSubTab = 'staging' | 'eventbus' | 'audit' | 'graph' | 'postreact' | 'snapshot';

type RuntimeState = {
  activeSubTab: RuntimeSubTab;
  stagingPool: { stagingWriteTraces: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> } | null;
  stagingPoolLoading: boolean;
  eventBus: { eventBusTraces: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> } | null;
  eventBusLoading: boolean;
  auditLog: { auditTraces: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> } | null;
  auditLogLoading: boolean;
  graphChanges: { graphChangeTraces: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> } | null;
  graphChangesLoading: boolean;
  runtimeSnapshots: { runtimeSnapshots: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> } | null;
  runtimeSnapshotsLoading: boolean;
  runtimeSnapshotsError: null;
  postReact: { postReactTraces: Array<{ type: string; data: Record<string, unknown>; timestamp: number }> } | null;
  postReactLoading: boolean;
  postReactError: null;
  liveEvents: Array<{ type: string; data: unknown; timestamp: number }>;
  setActiveSubTab: (tab: RuntimeSubTab) => void;
  fetchStagingPool: (saveId: string) => void;
  fetchEventBus: (saveId: string) => void;
  fetchAuditLog: (saveId: string) => void;
  fetchGraphChanges: (saveId: string) => void;
  fetchRuntimeSnapshots: (saveId: string) => void;
  fetchPostReact: (saveId: string) => void;
};

const setActiveSubTabMock = vi.fn();
const fetchRuntimeSnapshotsMock = vi.fn();
const fetchPostReactMock = vi.fn();

const runtimeState: RuntimeState = {
  activeSubTab: 'staging',
  stagingPool: null,
  stagingPoolLoading: false,
  eventBus: null,
  eventBusLoading: false,
  auditLog: null,
  auditLogLoading: false,
  graphChanges: null,
  graphChangesLoading: false,
  runtimeSnapshots: null,
  runtimeSnapshotsLoading: false,
  runtimeSnapshotsError: null,
  postReact: null,
  postReactLoading: false,
  postReactError: null,
  liveEvents: [],
  setActiveSubTab: setActiveSubTabMock,
  fetchStagingPool: vi.fn(),
  fetchEventBus: vi.fn(),
  fetchAuditLog: vi.fn(),
  fetchGraphChanges: vi.fn(),
  fetchRuntimeSnapshots: fetchRuntimeSnapshotsMock,
  fetchPostReact: fetchPostReactMock,
};

function setupMockReact() {
  let hookCursor = 0;
  const previousDeps: Array<unknown[] | undefined> = [];
  const refs: Array<{ current: unknown }> = [];

  const beginRender = () => {
    hookCursor = 0;
  };

  vi.doMock('react', async () => {
    const actual = await vi.importActual<typeof import('react')>('react');
    return {
      ...actual,
      useCallback: <T extends (...args: never[]) => unknown>(callback: T) => {
        hookCursor++;
        return callback;
      },
      useEffect: (effect: () => void | (() => void), deps?: unknown[]) => {
        const currentIndex = hookCursor++;
        const lastDeps = previousDeps[currentIndex];
        const hasChanged = !deps
          || !lastDeps
          || deps.length !== lastDeps.length
          || deps.some((dep, index) => dep !== lastDeps[index]);

        if (hasChanged) {
          effect();
        }

        previousDeps[currentIndex] = deps ? [...deps] : undefined;
      },
      useMemo: <T,>(factory: () => T) => {
        hookCursor++;
        return factory();
      },
      useRef: <T,>(initialValue: T) => {
        const currentIndex = hookCursor++;
        if (!refs[currentIndex]) {
          refs[currentIndex] = { current: initialValue };
        }

        return refs[currentIndex] as { current: T };
      },
    };
  });

  return { beginRender };
}

function getTextContent(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(getTextContent).join('');
  }

  if (!node || typeof node !== 'object' || !('props' in node)) {
    return '';
  }

  return getTextContent((node as ReactElement).props.children);
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean
): ReactElement | null {
  if (!node) {
    return null;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElement(child, predicate);
      if (match) {
        return match;
      }
    }
    return null;
  }

  if (typeof node !== 'object' || !('props' in node)) {
    return null;
  }

  const element = node as ReactElement;
  if (predicate(element)) {
    return element;
  }

  return findElement(element.props.children, predicate);
}

describe('RuntimeTab interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    runtimeState.activeSubTab = 'staging';
    setActiveSubTabMock.mockImplementation((tab: RuntimeSubTab) => {
      runtimeState.activeSubTab = tab;
    });
    runtimeState.setActiveSubTab = setActiveSubTabMock;
    runtimeState.fetchRuntimeSnapshots = fetchRuntimeSnapshotsMock;
    runtimeState.fetchPostReact = fetchPostReactMock;
  });

  it('切换到 Snapshot 页签后应触发 fetchRuntimeSnapshots(saveId)', async () => {
    const { beginRender } = setupMockReact();

    vi.doMock('@/stores/runtimeStore', () => ({
      useRuntimeStore: (selector: (state: RuntimeState) => unknown) => selector(runtimeState),
    }));

    vi.doMock('@/stores/gameStore', () => ({
      useGameStore: (selector: (state: { saveId: string | null }) => unknown) =>
        selector({ saveId: 'save-1' }),
    }));

    const { RuntimeTab } = await import('../RuntimeTab');

    beginRender();
    const initialTree = RuntimeTab({});
    const snapshotButton = findElement(
      initialTree,
      (element) =>
        element.type === 'button' && getTextContent(element.props.children).includes('快照')
    );

    expect(snapshotButton).not.toBeNull();

    snapshotButton?.props.onClick();
    beginRender();
    RuntimeTab({});

    expect(setActiveSubTabMock).toHaveBeenCalledWith('snapshot');
    expect(fetchRuntimeSnapshotsMock).toHaveBeenCalledWith('save-1');
  }, 10000);

  it('切换到 Post-react 页签后应触发 fetchPostReact(saveId)', async () => {
    const { beginRender } = setupMockReact();

    vi.doMock('@/stores/runtimeStore', () => ({
      useRuntimeStore: (selector: (state: RuntimeState) => unknown) => selector(runtimeState),
    }));

    vi.doMock('@/stores/gameStore', () => ({
      useGameStore: (selector: (state: { saveId: string | null }) => unknown) =>
        selector({ saveId: 'save-1' }),
    }));

    const { RuntimeTab } = await import('../RuntimeTab');

    beginRender();
    const initialTree = RuntimeTab({});
    const postReactButton = findElement(
      initialTree,
      (element) =>
        element.type === 'button' && getTextContent(element.props.children).includes('Post-react')
    );

    expect(postReactButton).not.toBeNull();

    postReactButton?.props.onClick();
    beginRender();
    RuntimeTab({});

    expect(setActiveSubTabMock).toHaveBeenCalledWith('postreact');
    expect(fetchPostReactMock).toHaveBeenCalledWith('save-1');
  }, 10000);

  it('Post-react 页签已激活且收到审计完成事件后应自动刷新 traces', async () => {
    const { beginRender } = setupMockReact();

    runtimeState.activeSubTab = 'postreact';
    runtimeState.liveEvents = [];

    vi.doMock('@/stores/runtimeStore', () => ({
      useRuntimeStore: (selector: (state: RuntimeState) => unknown) => selector(runtimeState),
    }));

    vi.doMock('@/stores/gameStore', () => ({
      useGameStore: (selector: (state: { saveId: string | null }) => unknown) =>
        selector({ saveId: 'save-1' }),
    }));

    const { RuntimeTab } = await import('../RuntimeTab');

    beginRender();
    RuntimeTab({});

    expect(fetchPostReactMock).toHaveBeenCalledTimes(1);

    runtimeState.liveEvents = [
      { type: 'dev:audit_decision', data: {}, timestamp: 1718000000000 },
    ];

    beginRender();
    RuntimeTab({});

    expect(fetchPostReactMock).toHaveBeenCalledTimes(2);
    expect(fetchPostReactMock).toHaveBeenLastCalledWith('save-1');
  });

  it('最后一条 live event 无关时也应基于最近相关事件自动刷新 traces', async () => {
    const { beginRender } = setupMockReact();

    runtimeState.activeSubTab = 'postreact';
    runtimeState.liveEvents = [];

    vi.doMock('@/stores/runtimeStore', () => ({
      useRuntimeStore: (selector: (state: RuntimeState) => unknown) => selector(runtimeState),
    }));

    vi.doMock('@/stores/gameStore', () => ({
      useGameStore: (selector: (state: { saveId: string | null }) => unknown) =>
        selector({ saveId: 'save-1' }),
    }));

    const { RuntimeTab } = await import('../RuntimeTab');

    beginRender();
    RuntimeTab({});

    expect(fetchPostReactMock).toHaveBeenCalledTimes(1);

    runtimeState.liveEvents = [
      { type: 'dev:audit_decision', data: {}, timestamp: 1718000000000 },
      { type: 'dev:graph_change', data: {}, timestamp: 1718000000001 },
    ];

    beginRender();
    RuntimeTab({});

    expect(fetchPostReactMock).toHaveBeenCalledTimes(2);
    expect(fetchPostReactMock).toHaveBeenLastCalledWith('save-1');
  });

  it('Snapshot 页签已激活且收到 runtime snapshot 事件后应自动刷新 traces', async () => {
    const { beginRender } = setupMockReact();

    runtimeState.activeSubTab = 'snapshot';
    runtimeState.liveEvents = [];

    vi.doMock('@/stores/runtimeStore', () => ({
      useRuntimeStore: (selector: (state: RuntimeState) => unknown) => selector(runtimeState),
    }));

    vi.doMock('@/stores/gameStore', () => ({
      useGameStore: (selector: (state: { saveId: string | null }) => unknown) =>
        selector({ saveId: 'save-1' }),
    }));

    const { RuntimeTab } = await import('../RuntimeTab');

    beginRender();
    RuntimeTab({});

    expect(fetchRuntimeSnapshotsMock).toHaveBeenCalledTimes(1);

    runtimeState.liveEvents = [
      { type: 'dev:runtime_snapshot', data: {}, timestamp: 1718000000000 },
    ];

    beginRender();
    RuntimeTab({});

    expect(fetchRuntimeSnapshotsMock).toHaveBeenCalledTimes(2);
    expect(fetchRuntimeSnapshotsMock).toHaveBeenLastCalledWith('save-1');
  });
});
