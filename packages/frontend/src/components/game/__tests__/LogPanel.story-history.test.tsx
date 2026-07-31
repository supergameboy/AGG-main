import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LogPanel } from '../LogPanel';

describe('LogPanel story history', () => {
  const instantLogs = [
    {
      id: 'log-1',
      type: 'system' as const,
      message: '即时系统反馈',
      timestamp: new Date('2026-05-13T14:20:00.000Z').getTime(),
    },
  ];

  const storyHistoryEvents = [
    {
      id: 'evt-1',
      save_id: 'save-1',
      chapter: 'chapter_2',
      event_type: 'major_record',
      title: '玩家确认灰雾源头线索',
      description: '村长给出关键线索',
      importance: 'critical' as const,
      participants: '["npc-chief"]',
      impact: '{"source":"post_review"}',
      timestamp: new Date('2026-05-13T14:10:00.000Z').getTime(),
    },
  ];

  const pagination = {
    page: 1,
    pageSize: 20,
    total: 1,
    totalPages: 1,
  };

  it('即时日志轨道应显示 tab 标签', () => {
    const LogPanelAny = LogPanel as unknown as (props: Record<string, unknown>) => JSX.Element;
    const markup = renderToStaticMarkup(
      <LogPanelAny
        logs={instantLogs}
        storyHistory={storyHistoryEvents}
        storyHistoryPagination={pagination}
        isStoryHistoryLoading={false}
        initialTrack="instant"
      />
    );

    expect(markup).toContain('即时日志');
    expect(markup).toContain('重大记录');
  });

  it('重大记录轨道应显示重大记录 tab', () => {
    const LogPanelAny = LogPanel as unknown as (props: Record<string, unknown>) => JSX.Element;
    const markup = renderToStaticMarkup(
      <LogPanelAny
        logs={instantLogs}
        storyHistory={storyHistoryEvents}
        storyHistoryPagination={pagination}
        isStoryHistoryLoading={false}
        initialTrack="major"
      />
    );

    expect(markup).toContain('重大记录');
    expect(markup).toContain('即时日志');
  });

  it('双轨 tab 标签应同时存在', () => {
    const LogPanelAny = LogPanel as unknown as (props: Record<string, unknown>) => JSX.Element;
    const markup = renderToStaticMarkup(
      <LogPanelAny
        logs={instantLogs}
        storyHistory={storyHistoryEvents}
        storyHistoryPagination={pagination}
        isStoryHistoryLoading={false}
      />
    );

    expect(markup).toContain('即时日志');
    expect(markup).toContain('重大记录');
  });
});
