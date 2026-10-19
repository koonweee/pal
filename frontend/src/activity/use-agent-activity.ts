import { useCallback, useState } from 'react';
import type { AgentActivity } from '../api/client';

// The existing stream routes snapshots here; conversation caches own no activity.
export function useAgentActivity() {
  const [snapshot, setSnapshot] = useState<AgentActivity>();
  const clear = useCallback(() => setSnapshot(undefined), []);
  const receive = useCallback((next: AgentActivity) => {
    setSnapshot((previous) =>
      !previous || next.revision > previous.revision ? next : previous,
    );
  }, []);
  return { snapshot, clear, receive };
}
