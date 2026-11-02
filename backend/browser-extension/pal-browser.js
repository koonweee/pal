// Resolve Chrome's active tab without reading or managing unrelated tab state.
globalThis.palBrowser = async function ({ action }) {
  if (action !== 'active') throw new Error('Unsupported browser operation');
  const window = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  const [tab] = await chrome.tabs.query({ windowId: window.id, active: true });
  const target = (await chrome.debugger.getTargets()).find((entry) => entry.tabId === tab?.id);
  if (!target) throw new Error('Active browser tab is unavailable');
  return { targetId: target.id };
};
