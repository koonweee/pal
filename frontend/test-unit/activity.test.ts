import { act, renderHook } from '@testing-library/react';
import { useAgentActivity } from '../src/activity/use-agent-activity';
import { describe, expect, it } from 'vitest';
import type { AgentActivity } from '../src/api/client';
import { selectBubble, selectCompletion } from '../src/activity/select-bubble';
const online = { online: true, connected: true, opened: true };
const empty: AgentActivity = {
  revision: 1,
  status: 'idle',
  mainWorking: false,
  runningTasks: [],
  needsInputTasks: [],
  latestCompletion: null,
};
const task = { id: 'task', title: 'Lunch with Sam', commentary: null };

describe('activity selection', () => {
  it('prioritizes connection, input, distinct running tasks, Main, completion, then idle', () => {
    const busy = {
      ...empty,
      status: 'working' as const,
      mainWorking: true,
      runningTasks: [task, { ...task, id: 'two' }],
      needsInputTasks: [task],
    };
    expect(selectBubble(busy, { ...online, online: false }, 0)?.text).toBe(
      'offline',
    );
    expect(selectBubble(busy, { ...online, connected: false }, 0)?.text).toBe(
      'reconnecting…',
    );
    expect(selectBubble(undefined, online, 0)?.dots).toBe(true);
    expect(selectBubble(busy, online, 0)).toMatchObject({
      text: 'need your input',
      taskId: 'task',
    });
    expect(
      selectBubble(
        { ...busy, needsInputTasks: [task, { ...task, id: 'two' }] },
        online,
        0,
      )?.text,
    ).toBe('need your input on 2 tasks');
    expect(
      selectBubble({ ...busy, needsInputTasks: [] }, online, 0)?.text,
    ).toBe('working on 2 tasks');
    expect(selectBubble({ ...empty, mainWorking: true }, online, 0)?.dots).toBe(
      true,
    );
    expect(selectBubble(empty, online, 0)).toBeUndefined();
  });
  it('uses current-run commentary and title fallback without lowercasing source content', () => {
    expect(
      selectBubble({ ...empty, runningTasks: [task] }, online, 0)?.text,
    ).toBe('Lunch with Sam');
    expect(
      selectBubble(
        {
          ...empty,
          runningTasks: [
            {
              ...task,
              commentary: {
                messageId: 'm',
                sequence: 1,
                text: 'Checking Sam’s\n  calendar…',
              },
            },
          ],
        },
        online,
        0,
      ),
    ).toMatchObject({
      text: 'Checking Sam’s calendar…',
      taskId: 'task',
      messageId: 'm',
    });
  });
  it('keeps a completion celebration available alongside Main, running tasks, and input requests', () => {
    const completion = {
      id: 'done',
      title: 'Finished work',
      cueId: 'cue',
      occurredAt: new Date(1000).toISOString(),
    };
    for (const state of [
      { ...empty, mainWorking: true },
      { ...empty, runningTasks: [task] },
      { ...empty, runningTasks: [task, { ...task, id: 'two' }] },
      { ...empty, needsInputTasks: [task] },
    ]) {
      const current = { ...state, latestCompletion: completion };
      expect(selectCompletion(current, online, 1001)).toBe(completion);
      expect(selectBubble(current, online, 1001)?.kind).not.toBe('completion');
    }
    const current = { ...empty, latestCompletion: completion };
    expect(
      selectCompletion(current, { ...online, online: false }, 1001),
    ).toBeNull();
    expect(
      selectCompletion(current, { ...online, connected: false }, 1001),
    ).toBeNull();
    expect(selectCompletion(current, online, 6000)).toBeNull();
  });
  it('expires completion using the original timestamp, including reconnects', () => {
    const state = {
      ...empty,
      latestCompletion: {
        ...task,
        cueId: 'cue',
        occurredAt: new Date(1000).toISOString(),
      },
    };
    expect(selectBubble(state, online, 1001)).toMatchObject({
      text: 'Lunch with Sam',
      kind: 'completion',
    });
    expect(selectBubble(state, online, 6000)).toBeUndefined();
  });
});

it('accepts newer snapshots and resets revision acceptance on reconnect', () => {
  const { result } = renderHook(useAgentActivity);
  act(() => result.current.receive({ ...empty, revision: 8 }));
  act(() =>
    result.current.receive({ ...empty, revision: 7, mainWorking: true }),
  );
  expect(result.current.snapshot?.revision).toBe(8);
  act(() => result.current.clear());
  expect(result.current.snapshot).toBeUndefined();
  act(() => result.current.receive({ ...empty, revision: 1 }));
  expect(result.current.snapshot?.revision).toBe(1);
});
