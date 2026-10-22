export const AGENT_HOME = '/home/pal';

/** Historical paths retained in conversations and schedules resolve only in execution. */
export function executionPath(path: string) {
  for (const [old, current] of [
    ['/data/home', AGENT_HOME],
    ['/data/workspace', AGENT_HOME + '/workspace'],
    ['/data/uploads', AGENT_HOME + '/incoming'],
  ]) {
    if (path === old || path.startsWith(old + '/'))
      return current + path.slice(old.length);
  }
  return path;
}
