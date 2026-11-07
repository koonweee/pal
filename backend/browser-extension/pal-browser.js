// Resolve and clean only target IDs selected by trusted host code. URLs and
// titles never cross the extension boundary.
globalThis.palBrowser = async function ({ action, targetIds }) {
  const targets = await chrome.debugger.getTargets();
  if (action === 'active') {
    const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    const [tab] = await chrome.tabs.query({ windowId: window.id, active: true });
    const target = targets.find((entry) => entry.tabId === tab?.id);
    if (!target) throw new Error('Active browser tab is unavailable');
    return { targetId: target.id };
  }
  if (action === 'inventory') {
    return {
      targetIds: targets
        .filter((entry) => entry.type === 'page' && Number.isInteger(entry.tabId))
        .map((entry) => entry.id),
    };
  }
  if (action === 'close') {
    const requested = new Set(
      Array.isArray(targetIds)
        ? targetIds.filter((entry) => typeof entry === 'string')
        : [],
    );
    const tabIds = [
      ...new Set(
        targets
          .filter(
            (entry) =>
              requested.has(entry.id) && Number.isInteger(entry.tabId),
          )
          .map((entry) => entry.tabId),
      ),
    ];
    if (tabIds.length) await chrome.tabs.remove(tabIds);
    return { closedCount: tabIds.length };
  }
  throw new Error('Unsupported browser operation');
};
