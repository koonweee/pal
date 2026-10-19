// Chrome owns group membership. Session storage survives worker suspension;
// each session/tab gets its own key so concurrent workers do not overwrite it.
const prefix = 'task:';
const colors = [
  'blue',
  'red',
  'yellow',
  'green',
  'pink',
  'purple',
  'cyan',
  'orange',
];
const creating = new Map();

async function record(taskId) {
  return (await chrome.storage.session.get(prefix + taskId))[prefix + taskId];
}
async function save(taskId, value) {
  await chrome.storage.session.set({ [prefix + taskId]: value });
}
async function members(groupId) {
  return chrome.tabs.query({ groupId });
}
async function ensureGroup(taskId, title, tabId) {
  if (creating.has(taskId)) return creating.get(taskId);
  const pending = (async () => {
    let value = await record(taskId);
    if (value && (await members(value.groupId)).length) return value;
    const groupId = await chrome.tabs.group({ tabIds: [tabId] });
    const color =
      colors[
        Array.from(taskId).reduce((sum, c) => sum + c.charCodeAt(0), 0) %
          colors.length
      ];
    await chrome.tabGroups.update(groupId, {
      title: title.slice(0, 80),
      color,
    });
    value = { taskId, groupId, lastActivity: Date.now() };
    await save(taskId, value);
    return value;
  })();
  creating.set(taskId, pending);
  try {
    return await pending;
  } finally {
    creating.delete(taskId);
  }
}
async function group(taskId, title, targetId, sessionId) {
  const targets = await chrome.debugger.getTargets();
  const tabId = targets.find((entry) => entry.id === targetId)?.tabId;
  if (tabId === undefined) throw new Error('Browser tab target is unavailable');
  const value = await ensureGroup(taskId, title, tabId);
  const existing = await chrome.tabGroups.get(value.groupId);
  const tab = await chrome.tabs.get(tabId);
  if (tab.windowId !== existing.windowId)
    await chrome.tabs.move(tabId, { windowId: existing.windowId, index: -1 });
  await chrome.tabs.group({ tabIds: [tabId], groupId: value.groupId });
  await chrome.storage.session.set({
    ['session:' + sessionId]: { taskId, sessionId },
    ['tab:' + tabId]: { taskId, sessionId },
  });
  return value;
}
async function describe(value, all, targets) {
  return {
    ...value,
    sessions: Object.entries(all)
      .filter(
        ([key, session]) =>
          key.startsWith('session:') && session.taskId === value.taskId,
      )
      .map(([, session]) => session.sessionId),
    tabs: (await members(value.groupId)).map(({ id, url, title }) => ({
      id,
      url,
      title,
      targetId: targets.find((entry) => entry.tabId === id)?.id,
      sessionId: all['tab:' + id]?.sessionId,
    })),
  };
}

globalThis.palBrowser = async function ({
  action,
  taskId,
  title,
  targetId,
  sessionId = taskId,
}) {
  if (action === 'list' || action === 'get') {
    const all = await chrome.storage.session.get(null);
    const targets = await chrome.debugger.getTargets();
    if (action === 'get') {
      const value = all[prefix + taskId];
      return value ? describe(value, all, targets) : null;
    }
    return Promise.all(
      Object.entries(all)
        .filter(([key]) => key.startsWith(prefix))
        .map(([, value]) => describe(value, all, targets)),
    );
  }
  if (action === 'group') return group(taskId, title, targetId, sessionId);
  const value = await record(taskId);
  if (action === 'close' || action === 'close_session') {
    const all = await chrome.storage.session.get(null);
    if (value) {
      const tabs = (await members(value.groupId)).filter(
        (tab) =>
          action === 'close' || all['tab:' + tab.id]?.sessionId === sessionId,
      );
      if (tabs.length) await chrome.tabs.remove(tabs.map((tab) => tab.id));
    }
    const keys = Object.entries(all)
      .filter(
        ([, entry]) =>
          entry.taskId === taskId &&
          (action === 'close' || entry.sessionId === sessionId),
      )
      .map(([key]) => key);
    if (keys.length) await chrome.storage.session.remove(keys);
    return { closed: true };
  }
  if (action === 'touch' && value) {
    value.lastActivity = Date.now();
    await save(taskId, value);
  }
  return value || null;
};

// Popups inherit both the opener's current group and its session. Human-moved
// tabs are preserved because cleanup always checks current group membership.
chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab.openerTabId) return;
  try {
    const opener = await chrome.tabs.get(tab.openerTabId);
    const all = await chrome.storage.session.get(null);
    const owner = all['tab:' + opener.id];
    if (!owner || all[prefix + owner.taskId]?.groupId !== opener.groupId)
      return;
    const group = await chrome.tabGroups.get(opener.groupId);
    if (tab.windowId !== group.windowId)
      await chrome.tabs.move(tab.id, { windowId: group.windowId, index: -1 });
    await chrome.tabs.group({ tabIds: [tab.id], groupId: opener.groupId });
    await chrome.storage.session.set({ ['tab:' + tab.id]: owner });
  } catch (error) {
    console.warn('Pal popup grouping failed', error);
  }
});
