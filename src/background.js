import {
  ACTIVITY_STORAGE_KEY,
  getTrackableHost,
  normalizeSeeItLaterStore,
  normalizeTrendsStore,
  recordTrendMetric,
  SEE_IT_LATER_STORAGE_KEY,
  TRENDS_STORAGE_KEY
} from './lib/grouping.js';

const STORAGE_SCHEMA_VERSION = 1;
const BROWSE_TIME_ALARM_NAME = 'trend-browse-time-tick';
const BROWSE_TIME_ALARM_PERIOD_MINUTES = 1;
const MAX_BROWSE_TIME_INCREMENT_MS = 75_000;

const extensionRoot = chrome.runtime.getURL('/');

let writeQueue = Promise.resolve();
let trendsWarmupPromise = null;

void warmTrendsRuntime();

chrome.runtime.onInstalled.addListener(() => {
  void warmTrendsRuntime();
});

chrome.runtime.onStartup.addListener(() => {
  void warmTrendsRuntime();
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  void enqueueActivityUpdate((activity) => {
    activity.tabs[String(tabId)] = {
      lastActivatedAt: Date.now()
    };
    return activity;
  });

  void enqueueTrendsUpdate(async (trends) => {
    const now = Date.now();
    let next = flushActiveSession(trends, now, {
      clear: true
    });

    const tab = await safeGetTab(tabId);
    next = syncRuntimeTabState(next, tab, {
      markCurrentUrlComplete: false
    });

    if (typeof windowId === 'number' && (await isWindowFocused(windowId))) {
      next = startActiveSession(next, tab, now);
    }

    return next;
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!shouldHandleTrendTabUpdate(changeInfo)) {
    return;
  }

  void enqueueTrendsUpdate(async (trends) => {
    const now = Date.now();
    const currentTab = tab ?? (await safeGetTab(tabId));
    const previousState = getRuntimeTabState(trends, tabId);
    const currentUrl = getTabUrl(currentTab, previousState?.url);
    const currentHost = getTrackableHost(currentUrl);
    const faviconUrl = normalizeFavicon(currentTab?.favIconUrl);
    let next = trends;

    if (next.runtime.activeSession?.tabId === tabId && next.runtime.activeSession.host !== currentHost) {
      next = flushActiveSession(next, now, {
        clear: true
      });
    }

    next = syncRuntimeTabState(next, currentTab, {
      markCurrentUrlComplete: false
    });

    if (
      changeInfo.status === 'complete' &&
      currentHost &&
      currentUrl &&
      previousState?.lastCompletedUrl !== currentUrl
    ) {
      next = recordTrendMetric(next, currentHost, 'openCount', 1, {
        timestamp: now,
        faviconUrl
      });

      const runtimeState = getRuntimeTabState(next, tabId);
      if (runtimeState) {
        runtimeState.lastCompletedUrl = currentUrl;
      }
    }

    if (changeInfo.audible === true && !previousState?.audible && currentHost) {
      next = recordTrendMetric(next, currentHost, 'playbackCount', 1, {
        timestamp: now,
        faviconUrl
      });
    }

    if (currentTab?.active && typeof currentTab.windowId === 'number' && (await isWindowFocused(currentTab.windowId))) {
      next = startActiveSession(next, currentTab, now);
    }

    return next;
  });
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueueActivityUpdate((activity) => {
    delete activity.tabs[String(tabId)];
    return activity;
  });

  void enqueueSeeItLaterUpdate((seeItLaterStore) => {
    seeItLaterStore.items = seeItLaterStore.items.map((item) =>
      item.currentTabId === tabId
        ? {
            ...item,
            currentTabId: null,
            updatedAt: Date.now()
          }
        : item
    );
    return seeItLaterStore;
  });

  void enqueueTrendsUpdate((trends) => {
    const now = Date.now();
    let next = trends;

    if (next.runtime.activeSession?.tabId === tabId) {
      next = flushActiveSession(next, now, {
        clear: true
      });
    }

    delete next.runtime.tabStateById[String(tabId)];
    return next;
  });
});

chrome.tabs.onReplaced.addListener((addedTabId, removedTabId) => {
  void enqueueActivityUpdate((activity) => {
    const removed = activity.tabs[String(removedTabId)];
    if (removed) {
      activity.tabs[String(addedTabId)] = removed;
      delete activity.tabs[String(removedTabId)];
    }
    return activity;
  });

  void enqueueSeeItLaterUpdate((seeItLaterStore) => {
    seeItLaterStore.items = seeItLaterStore.items.map((item) =>
      item.currentTabId === removedTabId
        ? {
            ...item,
            currentTabId: addedTabId,
            updatedAt: Date.now()
          }
        : item
    );
    return seeItLaterStore;
  });

  void enqueueTrendsUpdate((trends) => {
    const next = trends;
    const removed = next.runtime.tabStateById[String(removedTabId)];

    if (removed) {
      next.runtime.tabStateById[String(addedTabId)] = removed;
      delete next.runtime.tabStateById[String(removedTabId)];
    }

    if (next.runtime.activeSession?.tabId === removedTabId) {
      next.runtime.activeSession = {
        ...next.runtime.activeSession,
        tabId: addedTabId
      };
    }

    return next;
  });
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  void enqueueTrendsUpdate(async (trends) => {
    const now = Date.now();
    let next = flushActiveSession(trends, now, {
      clear: true
    });

    if (windowId === chrome.windows.WINDOW_ID_NONE) {
      return next;
    }

    const activeTab = await getActiveTabForWindow(windowId);
    next = syncRuntimeTabState(next, activeTab, {
      markCurrentUrlComplete: false
    });
    next = startActiveSession(next, activeTab, now);
    return next;
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== BROWSE_TIME_ALARM_NAME) {
    return;
  }

  void enqueueTrendsUpdate((trends) =>
    flushActiveSession(trends, Date.now(), {
      clear: false
    })
  );
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'sync-trends-runtime') {
    void warmTrendsRuntime()
      .then(() => sendResponse({
        ok: true
      }))
      .catch(() =>
        sendResponse({
          ok: false
        })
      );

    return true;
  }

  return false;
});

function warmTrendsRuntime() {
  if (trendsWarmupPromise) {
    return trendsWarmupPromise;
  }

  trendsWarmupPromise = (async () => {
    await ensureTrendAlarm();
    await pruneClosedTabs();
    await syncTrendsRuntime();
  })()
    .catch((error) => {
      console.error('Failed to warm trends runtime state.', error);
      throw error;
    })
    .finally(() => {
      trendsWarmupPromise = null;
    });

  return trendsWarmupPromise;
}

async function ensureTrendAlarm() {
  try {
    await chrome.alarms.create(BROWSE_TIME_ALARM_NAME, {
      periodInMinutes: BROWSE_TIME_ALARM_PERIOD_MINUTES
    });
  } catch (error) {
    console.error('Failed to schedule the trends browse-time alarm.', error);
  }
}

async function pruneClosedTabs() {
  const tabs = await chrome.tabs.query({});
  const openTabIds = new Set(tabs.map((tab) => String(tab.id)).filter(Boolean));

  await enqueueActivityUpdate((activity) => {
    for (const tabId of Object.keys(activity.tabs)) {
      if (!openTabIds.has(tabId)) {
        delete activity.tabs[tabId];
      }
    }

    return activity;
  });

  await enqueueTrendsUpdate((trends) => {
    for (const tabId of Object.keys(trends.runtime.tabStateById)) {
      if (!openTabIds.has(tabId)) {
        delete trends.runtime.tabStateById[tabId];
      }
    }

    if (trends.runtime.activeSession && !openTabIds.has(String(trends.runtime.activeSession.tabId))) {
      trends.runtime.activeSession = null;
    }

    return trends;
  });
}

async function syncTrendsRuntime() {
  const [tabs, focusedWindow] = await Promise.all([
    chrome.tabs.query({}),
    getLastFocusedWindow()
  ]);

  await enqueueTrendsUpdate((trends) => {
    const now = Date.now();
    const next = normalizeTrendsStore(trends, {
      now
    });

    next.runtime.tabStateById = {};

    for (const tab of tabs) {
      if (!isRelevantRuntimeTab(tab)) {
        continue;
      }

      next.runtime.tabStateById[String(tab.id)] = createRuntimeTabState(tab, null, {
        markCurrentUrlComplete: true
      });
    }

    if (focusedWindow?.focused && typeof focusedWindow.id === 'number') {
      const activeTab = tabs.find(
        (tab) => isRelevantRuntimeTab(tab) && tab.active && tab.windowId === focusedWindow.id
      );
      next.runtime.activeSession = createActiveSession(activeTab, now);
    } else {
      next.runtime.activeSession = null;
    }

    return next;
  });
}

function enqueueActivityUpdate(mutator) {
  writeQueue = writeQueue
    .then(async () => {
      const current = await readActivityStore();
      const next = mutator(structuredClone(current)) ?? current;
      await chrome.storage.local.set({
        [ACTIVITY_STORAGE_KEY]: next
      });
    })
    .catch((error) => {
      console.error('Failed to update tab activity store.', error);
    });

  return writeQueue;
}

function enqueueSeeItLaterUpdate(mutator) {
  writeQueue = writeQueue
    .then(async () => {
      const current = await readSeeItLaterStore();
      const next = mutator(structuredClone(current)) ?? current;
      await chrome.storage.local.set({
        [SEE_IT_LATER_STORAGE_KEY]: next
      });
    })
    .catch((error) => {
      console.error('Failed to update see-it-later store.', error);
    });

  return writeQueue;
}

function enqueueTrendsUpdate(mutator) {
  writeQueue = writeQueue
    .then(async () => {
      const current = await readTrendsStore();
      const next = (await mutator(structuredClone(current))) ?? current;
      await chrome.storage.local.set({
        [TRENDS_STORAGE_KEY]: next
      });
    })
    .catch((error) => {
      console.error('Failed to update trends store.', error);
    });

  return writeQueue;
}

async function readActivityStore() {
  const stored = await chrome.storage.local.get(ACTIVITY_STORAGE_KEY);
  const existing = stored[ACTIVITY_STORAGE_KEY];

  if (!existing || typeof existing !== 'object') {
    return {
      version: STORAGE_SCHEMA_VERSION,
      tabs: {}
    };
  }

  return {
    version: STORAGE_SCHEMA_VERSION,
    tabs: typeof existing.tabs === 'object' && existing.tabs ? existing.tabs : {}
  };
}

async function readSeeItLaterStore() {
  const stored = await chrome.storage.local.get(SEE_IT_LATER_STORAGE_KEY);
  return normalizeSeeItLaterStore(stored[SEE_IT_LATER_STORAGE_KEY]);
}

async function readTrendsStore() {
  const stored = await chrome.storage.local.get(TRENDS_STORAGE_KEY);
  return normalizeTrendsStore(stored[TRENDS_STORAGE_KEY]);
}

function shouldHandleTrendTabUpdate(changeInfo) {
  return (
    typeof changeInfo?.status === 'string' ||
    typeof changeInfo?.url === 'string' ||
    typeof changeInfo?.audible === 'boolean' ||
    typeof changeInfo?.favIconUrl === 'string'
  );
}

function flushActiveSession(trends, now, options = {}) {
  const session = trends.runtime.activeSession;
  if (!session?.host) {
    if (options.clear) {
      trends.runtime.activeSession = null;
    }
    return trends;
  }

  const elapsed = Math.max(0, now - session.lastFlushedAt);
  const boundedElapsed = Math.min(elapsed, MAX_BROWSE_TIME_INCREMENT_MS);
  let next = trends;

  if (boundedElapsed > 0) {
    next = recordTrendMetric(next, session.host, 'browseTimeMs', boundedElapsed, {
      timestamp: now
    });
  }

  if (options.clear) {
    next.runtime.activeSession = null;
  } else if (next.runtime.activeSession) {
    next.runtime.activeSession = {
      ...next.runtime.activeSession,
      lastFlushedAt: now
    };
  }

  return next;
}

function startActiveSession(trends, tab, now) {
  const session = createActiveSession(tab, now);
  if (!session) {
    trends.runtime.activeSession = null;
    return trends;
  }

  const existing = trends.runtime.activeSession;
  if (
    existing &&
    existing.tabId === session.tabId &&
    existing.windowId === session.windowId &&
    existing.host === session.host
  ) {
    return trends;
  }

  trends.runtime.activeSession = session;
  return trends;
}

function createActiveSession(tab, now) {
  if (!isRelevantRuntimeTab(tab)) {
    return null;
  }

  const host = getTrackableHost(getTabUrl(tab));
  if (!host) {
    return null;
  }

  return {
    tabId: tab.id,
    windowId: tab.windowId,
    host,
    startedAt: now,
    lastFlushedAt: now
  };
}

function syncRuntimeTabState(trends, tab, options = {}) {
  if (!isRelevantRuntimeTab(tab)) {
    return trends;
  }

  const existingState = getRuntimeTabState(trends, tab.id);
  trends.runtime.tabStateById[String(tab.id)] = createRuntimeTabState(tab, existingState, {
    markCurrentUrlComplete: options.markCurrentUrlComplete
  });
  return trends;
}

function createRuntimeTabState(tab, existingState = null, options = {}) {
  const url = getTabUrl(tab);
  return {
    url,
    lastCompletedUrl:
      options.markCurrentUrlComplete && url ? url : existingState?.lastCompletedUrl ?? '',
    host: getTrackableHost(url),
    audible: Boolean(tab.audible),
    windowId: typeof tab.windowId === 'number' ? tab.windowId : null
  };
}

function getRuntimeTabState(trends, tabId) {
  return trends.runtime.tabStateById[String(tabId)] ?? null;
}

function getTabUrl(tab, fallback = '') {
  if (!tab || typeof tab !== 'object') {
    return fallback;
  }

  if (typeof tab.url === 'string' && tab.url) {
    return tab.url;
  }

  if (typeof tab.pendingUrl === 'string' && tab.pendingUrl) {
    return tab.pendingUrl;
  }

  return fallback;
}

async function safeGetTab(tabId) {
  if (typeof tabId !== 'number') {
    return null;
  }

  try {
    return await chrome.tabs.get(tabId);
  } catch {
    return null;
  }
}

async function isWindowFocused(windowId) {
  try {
    const window = await chrome.windows.get(windowId);
    return Boolean(window?.focused);
  } catch {
    return false;
  }
}

async function getActiveTabForWindow(windowId) {
  try {
    const tabs = await chrome.tabs.query({
      active: true,
      windowId
    });
    return tabs.find((tab) => isRelevantRuntimeTab(tab)) ?? null;
  } catch {
    return null;
  }
}

async function getLastFocusedWindow() {
  try {
    return await chrome.windows.getLastFocused();
  } catch {
    return null;
  }
}

function isRelevantRuntimeTab(tab) {
  return typeof tab?.id === 'number' && !isExtensionTab(tab);
}

function isExtensionTab(tab) {
  const url = getTabUrl(tab);
  return typeof url === 'string' && url.startsWith(extensionRoot);
}

function normalizeFavicon(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
