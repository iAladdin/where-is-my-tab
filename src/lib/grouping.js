export const ACTIVITY_STORAGE_KEY = 'tabActivity';
export const SEE_IT_LATER_STORAGE_KEY = 'seeItLater';
export const PREFERENCES_STORAGE_KEY = 'uiPreferences';
export const TRENDS_STORAGE_KEY = 'domainTrends';

const SEE_IT_LATER_SCHEMA_VERSION = 1;
const PREFERENCES_SCHEMA_VERSION = 4;
const TRENDS_SCHEMA_VERSION = 1;
const TREND_DAILY_RETENTION_DAYS = 400;
const DAY_MS = 86_400_000;
const DEFAULT_EMPTY_TITLE = 'Untitled tab';
const OPEN_GROUP_VIEWS = new Set(['domain', 'window']);

export const GROUP_SORT_OPTIONS = Object.freeze([
  {
    id: 'name',
    label: 'Name'
  },
  {
    id: 'count',
    label: 'Most tabs'
  },
  {
    id: 'recent',
    label: 'Recently active'
  }
]);

const GROUP_SORT_IDS = new Set(GROUP_SORT_OPTIONS.map((option) => option.id));
export const GROUP_SORT_DIRECTIONS = Object.freeze([
  {
    id: 'asc',
    label: 'Ascending'
  },
  {
    id: 'desc',
    label: 'Descending'
  }
]);

const GROUP_SORT_DIRECTION_IDS = new Set(GROUP_SORT_DIRECTIONS.map((direction) => direction.id));
const DEFAULT_GROUP_SORT_DIRECTIONS = Object.freeze({
  name: 'asc',
  count: 'desc',
  recent: 'desc'
});

const COUNT_BUCKET_BOUNDARIES = Object.freeze([10, 20, 50, 100, 200, 500, 1000]);
const RECENT_BUCKETS = Object.freeze([
  { key: 'under-1h', label: '< 1h', upperBoundMs: 60 * 60 * 1000 },
  { key: '1-6h', label: '1–6h', upperBoundMs: 6 * 60 * 60 * 1000 },
  { key: '6-12h', label: '6–12h', upperBoundMs: 12 * 60 * 60 * 1000 },
  { key: '12-24h', label: '12–24h', upperBoundMs: 24 * 60 * 60 * 1000 },
  { key: '1-3d', label: '1–3d', upperBoundMs: 3 * DAY_MS },
  { key: '3d-1w', label: '3d–1w', upperBoundMs: 7 * DAY_MS },
  { key: '1-2w', label: '1–2w', upperBoundMs: 14 * DAY_MS },
  { key: 'over-2w', label: '2w+', upperBoundMs: Infinity }
]);

export const TREND_METRICS = Object.freeze([
  {
    id: 'browseTimeMs',
    label: 'Browsing time'
  },
  {
    id: 'playbackCount',
    label: 'Playback count'
  },
  {
    id: 'openCount',
    label: 'Open count'
  }
]);

export const TREND_WINDOWS = Object.freeze([
  {
    id: '7d',
    label: '7d',
    days: 7
  },
  {
    id: '14d',
    label: '14d',
    days: 14
  },
  {
    id: '30d',
    label: '30d',
    days: 30
  },
  {
    id: 'lifetime',
    label: 'Lifetime',
    days: null
  }
]);

const TREND_METRIC_IDS = new Set(TREND_METRICS.map((metric) => metric.id));

export const THEMES = Object.freeze([
  {
    id: 'mint',
    label: 'Aqua',
    swatch: '#5dbdaf'
  },
  {
    id: 'sand',
    label: 'Pearl',
    swatch: '#cfb38b'
  },
  {
    id: 'ink',
    label: 'Nocturne',
    swatch: '#78d7cf'
  }
]);

export const DEFAULT_THEME_ID = THEMES[0].id;

export const DEFAULT_PROFILE_BUCKET = Object.freeze({
  key: 'profile:current',
  label: 'Current Chrome profile',
  description:
    'Chrome extensions only expose tabs from the current profile instance. Other Chrome profiles stay isolated.'
});

export function tokenizeQuery(query = '') {
  return query
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function getTheme(themeId) {
  return THEMES.find((theme) => theme.id === themeId) ?? THEMES[0];
}

export function getTrendMetric(metricId) {
  return TREND_METRICS.find((metric) => metric.id === metricId) ?? TREND_METRICS[0];
}

export function getTrendWindow(windowId) {
  return TREND_WINDOWS.find((window) => window.id === windowId) ?? TREND_WINDOWS[0];
}

export function normalizePreferences(rawValue) {
  const themeId = rawValue?.themeId;
  const openGroupView = rawValue?.openGroupView;
  const groupSort = rawValue?.groupSort;
  const groupSortDirections = rawValue?.groupSortDirections;
  const legacyGroupSortDirection = rawValue?.groupSortDirection;
  const normalizedGroupSort = GROUP_SORT_IDS.has(groupSort) ? groupSort : 'name';
  const directionOverrides =
    groupSortDirections && typeof groupSortDirections === 'object' ? groupSortDirections : {};

  return {
    version: PREFERENCES_SCHEMA_VERSION,
    themeId: THEMES.some((theme) => theme.id === themeId) ? themeId : DEFAULT_THEME_ID,
    openGroupView: OPEN_GROUP_VIEWS.has(openGroupView) ? openGroupView : 'domain',
    groupSort: normalizedGroupSort,
    groupSortDirections: Object.fromEntries(
      GROUP_SORT_OPTIONS.map((option) => [
        option.id,
        GROUP_SORT_DIRECTION_IDS.has(directionOverrides[option.id])
          ? directionOverrides[option.id]
          : option.id === normalizedGroupSort && GROUP_SORT_DIRECTION_IDS.has(legacyGroupSortDirection)
            ? legacyGroupSortDirection
            : DEFAULT_GROUP_SORT_DIRECTIONS[option.id]
      ])
    )
  };
}

export function sortTabGroups(groups, sortId, options = {}) {
  const itemsKey = options.itemsKey ?? 'tabs';
  const timestampKey = options.timestampKey ?? 'lastActivatedAt';
  const resolvedSortId = GROUP_SORT_IDS.has(sortId) ? sortId : 'name';
  const direction = resolveGroupSortDirection(resolvedSortId, options.direction);

  return [...groups].sort((left, right) => {
    let comparison = 0;

    if (resolvedSortId === 'count') {
      comparison = (left[itemsKey]?.length ?? 0) - (right[itemsKey]?.length ?? 0);
    }

    if (resolvedSortId === 'recent' && comparison === 0) {
      comparison = sortTimestamps(left[timestampKey], right[timestampKey]);
    }

    if (comparison !== 0) {
      return direction === 'desc' ? -comparison : comparison;
    }

    const labelComparison = left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: 'base'
    });
    return resolvedSortId === 'name' && direction === 'desc' ? -labelComparison : labelComparison;
  });
}

export function groupTabGroups(groups, sortId, options = {}) {
  const sourceGroups = Array.isArray(groups) ? groups : [];
  const itemsKey = options.itemsKey ?? 'tabs';
  const timestampKey = options.timestampKey ?? 'lastActivatedAt';
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const resolvedSortId = GROUP_SORT_IDS.has(sortId) ? sortId : 'name';
  const direction = resolveGroupSortDirection(resolvedSortId, options.direction);
  const pinnedGroups = sourceGroups.filter((group) => isPinnedGroup(group, itemsKey, options.pinnedKey));
  const regularGroups = sourceGroups.filter((group) => !isPinnedGroup(group, itemsKey, options.pinnedKey));
  const sections = [];

  if (pinnedGroups.length) {
    sections.push({
      key: 'pinned',
      label: 'Pinned',
      isPinned: true,
      groups: sortTabGroups(pinnedGroups, resolvedSortId, { ...options, direction })
    });
  }

  const bucketDefinitions =
    resolvedSortId === 'name'
      ? buildNameBucketDefinitions(regularGroups)
      : resolvedSortId === 'count'
        ? buildCountBucketDefinitions(regularGroups, itemsKey)
        : buildRecentBucketDefinitions(regularGroups, timestampKey, now);
  const orderedBucketDefinitions =
    resolvedSortId === 'recent'
      ? direction === 'asc'
        ? [...bucketDefinitions].reverse()
        : bucketDefinitions
      : direction === 'desc'
        ? [...bucketDefinitions].reverse()
        : bucketDefinitions;

  for (const bucket of orderedBucketDefinitions) {
    const bucketGroups = regularGroups.filter((group) => bucket.matches(group));
    if (!bucketGroups.length) {
      continue;
    }

    sections.push({
      key: bucket.key,
      label: bucket.label,
      isPinned: false,
      groups: sortTabGroups(bucketGroups, resolvedSortId, {
        ...options,
        direction,
        itemsKey,
        timestampKey
      })
    });
  }

  return sections;
}

function resolveGroupSortDirection(sortId, direction) {
  if (GROUP_SORT_DIRECTION_IDS.has(direction)) {
    return direction;
  }

  return DEFAULT_GROUP_SORT_DIRECTIONS[sortId] ?? 'asc';
}

export function getOtherTabIdsInGroup(group, keptTabId) {
  if (!Number.isInteger(keptTabId) || !Array.isArray(group?.tabs)) {
    return [];
  }

  return Array.from(
    new Set(
      group.tabs
        .map((tab) => tab?.id)
        .filter((tabId) => Number.isInteger(tabId) && tabId !== keptTabId)
    )
  );
}

function isPinnedGroup(group, itemsKey, pinnedKey) {
  if (pinnedKey && group?.[pinnedKey] != null) {
    return Boolean(group[pinnedKey]);
  }

  return (Array.isArray(group?.[itemsKey]) ? group[itemsKey] : []).some((item) => Boolean(item?.pinned));
}

function buildNameBucketDefinitions(groups) {
  const keys = new Set(
    groups.map((group) => {
      const firstCharacter = String(group.label ?? '').trim().charAt(0).toUpperCase();
      if (/^[A-Z]$/.test(firstCharacter)) {
        return firstCharacter;
      }
      if (/^[0-9]$/.test(firstCharacter)) {
        return '0-9';
      }
      return '#';
    })
  );

  return Array.from(keys)
    .sort((left, right) => {
      if (left === '#') return 1;
      if (right === '#') return -1;
      if (left === '0-9') return 1;
      if (right === '0-9') return -1;
      return left.localeCompare(right);
    })
    .map((key) => ({
      key: `name-${key.toLowerCase()}`,
      label: key,
      matches: (group) => {
        const firstCharacter = String(group.label ?? '').trim().charAt(0).toUpperCase();
        if (key === '#') {
          return !/^[A-Z0-9]$/.test(firstCharacter);
        }
        if (key === '0-9') {
          return /^[0-9]$/.test(firstCharacter);
        }
        return firstCharacter === key;
      }
    }));
}

function buildCountBucketDefinitions(groups, itemsKey) {
  const maxCount = groups.reduce((max, group) => Math.max(max, group[itemsKey]?.length ?? 0), 0);
  const definitions = [
    {
      key: 'count-1',
      label: '1 tab',
      matches: (group) => (group[itemsKey]?.length ?? 0) === 1
    },
    {
      key: 'count-2-5',
      label: '2–5 tabs',
      matches: (group) => {
        const count = group[itemsKey]?.length ?? 0;
        return count >= 2 && count <= 5;
      }
    }
  ];

  let lowerBound = 6;
  for (const upperBound of COUNT_BUCKET_BOUNDARIES) {
    if (lowerBound > maxCount) {
      break;
    }

    const bucketLowerBound = lowerBound;
    const bucketUpperBound = upperBound;

    definitions.push({
      key: `count-${bucketLowerBound}-${bucketUpperBound}`,
      label: `${bucketLowerBound}–${bucketUpperBound} tabs`,
      matches: (group) => {
        const count = group[itemsKey]?.length ?? 0;
        return count >= bucketLowerBound && count <= bucketUpperBound;
      }
    });
    lowerBound = upperBound + 1;
  }

  if (lowerBound <= maxCount) {
    definitions.push({
      key: `count-${lowerBound}-plus`,
      label: `${lowerBound}+ tabs`,
      matches: (group) => (group[itemsKey]?.length ?? 0) >= lowerBound
    });
  }

  return definitions;
}

function buildRecentBucketDefinitions(groups, timestampKey, now) {
  const definitions = RECENT_BUCKETS.map((bucket, index) => ({
    key: `recent-${bucket.key}`,
    label: bucket.label,
    matches: (group) => {
      const timestamp = group[timestampKey];
      if (typeof timestamp !== 'number') {
        return false;
      }

      const age = Math.max(0, now - timestamp);
      const previousUpperBound = index === 0 ? -1 : RECENT_BUCKETS[index - 1].upperBoundMs;
      return age > previousUpperBound && age <= bucket.upperBoundMs;
    }
  }));

  definitions.push({
    key: 'recent-no-activity',
    label: 'No activity',
    matches: (group) => typeof group[timestampKey] !== 'number'
  });

  return definitions;
}

export function normalizeSeeItLaterStore(rawValue) {
  const items = Array.isArray(rawValue?.items) ? rawValue.items : [];

  return {
    version: SEE_IT_LATER_SCHEMA_VERSION,
    items: items
      .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.url === 'string')
      .map((item) => ({
        id: item.id,
        title: typeof item.title === 'string' && item.title.trim() ? item.title.trim() : DEFAULT_EMPTY_TITLE,
        url: item.url,
        displayUrl:
          typeof item.displayUrl === 'string' && item.displayUrl.trim() ? item.displayUrl.trim() : item.url,
        favIconUrl: normalizeOptionalString(item.favIconUrl),
        host: typeof item.host === 'string' ? item.host : '',
        groupLabel:
          typeof item.groupLabel === 'string' && item.groupLabel.trim() ? item.groupLabel.trim() : 'Saved tab',
        currentTabId: typeof item.currentTabId === 'number' ? item.currentTabId : null,
        sourceWindowId: typeof item.sourceWindowId === 'number' ? item.sourceWindowId : null,
        lastActivatedAt: typeof item.lastActivatedAt === 'number' ? item.lastActivatedAt : null,
        createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now(),
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now()
      }))
      .sort((left, right) => sortTimestamps(right.updatedAt, left.updatedAt))
  };
}

export function normalizeTrendsStore(rawValue, options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const rawHosts = rawValue?.hosts && typeof rawValue.hosts === 'object' ? rawValue.hosts : {};
  const hosts = {};

  for (const [rawHost, rawEntry] of Object.entries(rawHosts)) {
    const host = normalizeTrendHostKey(rawHost);
    if (!host) {
      continue;
    }

    const entry = normalizeTrendHostEntry(rawEntry, now);
    if (entry) {
      hosts[host] = entry;
    }
  }

  return {
    version: TRENDS_SCHEMA_VERSION,
    hosts,
    runtime: normalizeTrendRuntime(rawValue?.runtime)
  };
}

export function createSeeItLaterItem(tab, now = Date.now()) {
  return {
    id: `later:${now}:${tab.id}`,
    title: tab.title,
    url: tab.url,
    displayUrl: tab.url || tab.displayUrl,
    favIconUrl: tab.favIconUrl,
    host: tab.host,
    groupLabel: tab.groupLabel,
    currentTabId: tab.id,
    sourceWindowId: tab.windowId,
    lastActivatedAt: tab.lastActivatedAt,
    createdAt: now,
    updatedAt: now
  };
}

export function parseTabLocation(rawUrl = '') {
  if (!rawUrl) {
    return {
      host: '',
      groupKey: 'special:uncategorized',
      groupLabel: 'Uncategorized',
      shortUrl: 'Unavailable'
    };
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.hostname) {
      const host = parsed.hostname.toLowerCase();
      const path = `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
      return {
        host,
        groupKey: `domain:${host}`,
        groupLabel: host,
        shortUrl: `${host}${path === '/' ? '' : path}`
      };
    }

    const label = formatSpecialLocation(parsed);
    return {
      host: '',
      groupKey: `special:${label.toLowerCase()}`,
      groupLabel: label,
      shortUrl: label
    };
  } catch {
    const fallbackLabel = rawUrl.slice(0, 64);
    return {
      host: '',
      groupKey: `special:${fallbackLabel.toLowerCase()}`,
      groupLabel: fallbackLabel,
      shortUrl: fallbackLabel
    };
  }
}

export function getTrackableHost(rawUrl = '') {
  if (!rawUrl) {
    return '';
  }

  try {
    const parsed = new URL(rawUrl);
    if ((parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname) {
      return parsed.hostname.toLowerCase();
    }
  } catch {
    return '';
  }

  return '';
}

export function buildTabSnapshot(rawTabs, tabActivityById = {}, rawSeeItLaterStore = undefined, options = {}) {
  const tabs = Array.isArray(rawTabs) ? rawTabs : [];
  const profile = options.profile ?? DEFAULT_PROFILE_BUCKET;
  const query = options.query ?? '';
  const tokens = tokenizeQuery(query);
  const windowLabelById = buildWindowLabels(tabs);
  const normalizedTabs = tabs
    .filter((tab) => typeof tab.id === 'number')
    .map((tab) => normalizeTab(tab, tabActivityById, windowLabelById));
  const normalizedTabsById = new Map(normalizedTabs.map((tab) => [tab.id, tab]));
  const seeItLaterStore = normalizeSeeItLaterStore(rawSeeItLaterStore);
  const openTrackedTabIds = new Set();
  const allGroups = new Map();
  const visibleGroups = new Map();
  const visibleWindowGroups = new Map();

  const seeItLater = {
    openItems: [],
    savedItems: []
  };

  for (const item of seeItLaterStore.items) {
    const openTab = item.currentTabId != null ? normalizedTabsById.get(item.currentTabId) ?? null : null;
    if (openTab) {
      openTrackedTabIds.add(openTab.id);
    }

    const renderedItem = createRenderedSeeItLaterItem(item, openTab);
    if (!tokens.length || tabMatchesTokens(renderedItem, tokens)) {
      if (renderedItem.isOpen) {
        seeItLater.openItems.push(renderedItem);
      } else {
        seeItLater.savedItems.push(renderedItem);
      }
    }
  }

  for (const tab of normalizedTabs) {
    tab.isSaved = openTrackedTabIds.has(tab.id);
    addTabToGroup(allGroups, profile, tab);

    if (!tokens.length || tabMatchesTokens(tab, tokens)) {
      addTabToGroup(visibleGroups, profile, tab);
      addTabToWindowGroup(visibleWindowGroups, profile, tab);
    }
  }

  const looseWindows = buildLooseWindows(normalizedTabs);
  const profileBucket = {
    ...profile,
    groups: sortGroups(Array.from(visibleGroups.values())),
    windowGroups: sortWindowGroups(Array.from(visibleWindowGroups.values())),
    looseWindows,
    seeItLater: {
      openItems: sortTrackedOpenItems(seeItLater.openItems),
      savedItems: sortTrackedSavedItems(seeItLater.savedItems)
    }
  };

  return {
    query,
    profiles: [profileBucket],
    stats: {
      totalTabs: normalizedTabs.length,
      totalGroups: allGroups.size,
      visibleTabs: profileBucket.groups.reduce((count, group) => count + group.tabs.length, 0),
      visibleGroups: profileBucket.groups.length,
      looseWindowCount: looseWindows.length,
      trackedOpenCount: seeItLaterStore.items.filter((item) => item.currentTabId != null && normalizedTabsById.has(item.currentTabId)).length,
      trackedSavedCount: seeItLaterStore.items.filter((item) => item.currentTabId == null || !normalizedTabsById.has(item.currentTabId)).length
    }
  };
}

export function recordTrendMetric(rawValue, host, metricId, amount = 1, options = {}) {
  const timestamp = typeof options.timestamp === 'number' ? options.timestamp : Date.now();
  const normalizedHost = normalizeTrendHostKey(host);
  const safeAmount = normalizePositiveInteger(amount);

  if (!normalizedHost || !TREND_METRIC_IDS.has(metricId) || safeAmount <= 0) {
    return normalizeTrendsStore(rawValue, {
      now: timestamp
    });
  }

  const next = normalizeTrendsStore(rawValue, {
    now: timestamp
  });

  const entry = next.hosts[normalizedHost] ?? createEmptyTrendHostEntry();
  const dayKey = createTrendDayKey(timestamp);

  entry.lifetime[metricId] += safeAmount;
  entry.daily[dayKey] = entry.daily[dayKey] ?? createEmptyTrendCounts();
  entry.daily[dayKey][metricId] += safeAmount;
  entry.lastActivityAt = maxTimestamp(entry.lastActivityAt, timestamp);

  const faviconUrl = normalizeOptionalString(options.faviconUrl);
  if (faviconUrl) {
    entry.faviconUrl = faviconUrl;
  }

  next.hosts[normalizedHost] = entry;
  return next;
}

export function createTrendDayKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getTrendCountsForWindow(hostEntry, windowId, now = Date.now()) {
  const entry = normalizeTrendHostEntry(hostEntry, now);
  if (!entry) {
    return createEmptyTrendCounts();
  }

  const window = getTrendWindow(windowId);
  if (window.days == null) {
    return copyTrendCounts(entry.lifetime);
  }

  const currentDayNumber = getLocalDayNumber(now);
  const minimumDayNumber = currentDayNumber - window.days + 1;
  const counts = createEmptyTrendCounts();

  for (const [dayKey, bucket] of Object.entries(entry.daily)) {
    const dayNumber = parseTrendDayNumber(dayKey);
    if (dayNumber == null || dayNumber < minimumDayNumber || dayNumber > currentDayNumber) {
      continue;
    }

    addTrendCounts(counts, bucket);
  }

  return counts;
}

function getTrendCountsForDayRange(hostEntry, startDayNumber, endDayNumber, now = Date.now()) {
  const entry = normalizeTrendHostEntry(hostEntry, now);
  if (!entry) {
    return createEmptyTrendCounts();
  }

  const counts = createEmptyTrendCounts();

  for (const [dayKey, bucket] of Object.entries(entry.daily)) {
    const dayNumber = parseTrendDayNumber(dayKey);
    if (dayNumber == null || dayNumber < startDayNumber || dayNumber > endDayNumber) {
      continue;
    }

    addTrendCounts(counts, bucket);
  }

  return counts;
}

export function getTrendLeaders(rawValue, options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const metricId = getTrendMetric(options.metricId).id;
  const windowId = getTrendWindow(options.windowId).id;
  const tokens = tokenizeQuery(options.query ?? '');
  const limit = typeof options.limit === 'number' ? Math.max(1, Math.floor(options.limit)) : 10;
  const trendsStore = normalizeTrendsStore(rawValue, {
    now
  });

  return Object.entries(trendsStore.hosts)
    .map(([host, entry]) => {
      const counts = getTrendCountsForWindow(entry, windowId, now);
      return {
        host,
        faviconUrl: entry.faviconUrl,
        lastActivityAt: entry.lastActivityAt,
        counts,
        score: counts[metricId]
      };
    })
    .filter((item) => item.score > 0)
    .filter((item) => !tokens.length || tokens.every((token) => item.host.includes(token)))
    .sort(compareTrendLeaders)
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      rank: index + 1
    }));
}

export function getWeeklyTrendBoards(rawValue, options = {}) {
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const metricId = getTrendMetric(options.metricId).id;
  const tokens = tokenizeQuery(options.query ?? '');
  const limit = typeof options.limit === 'number' ? Math.max(1, Math.floor(options.limit)) : 10;
  const weekCount = typeof options.weekCount === 'number' ? Math.max(1, Math.floor(options.weekCount)) : 52;
  const includeEmptyWeeks = options.includeEmptyWeeks !== false;
  const trendsStore = normalizeTrendsStore(rawValue, {
    now
  });
  const currentWeekStartDayNumber = getLocalWeekStartDayNumber(now);
  const boards = [];

  for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
    const startDayNumber = currentWeekStartDayNumber - weekIndex * 7;
    const endDayNumber = startDayNumber + 6;

    const leaders = Object.entries(trendsStore.hosts)
      .map(([host, entry]) => {
        const counts = getTrendCountsForDayRange(entry, startDayNumber, endDayNumber, now);
        return {
          host,
          faviconUrl: entry.faviconUrl,
          lastActivityAt: entry.lastActivityAt,
          counts,
          score: counts[metricId]
        };
      })
      .filter((item) => item.score > 0)
      .filter((item) => !tokens.length || tokens.every((token) => item.host.includes(token)))
      .sort(compareTrendLeaders)
      .slice(0, limit)
      .map((item, index) => ({
        ...item,
        rank: index + 1
      }));

    if (!includeEmptyWeeks && !leaders.length) {
      continue;
    }

    boards.push({
      id: `trend-week:${startDayNumber}`,
      index: weekIndex,
      startDayNumber,
      endDayNumber,
      weekLabel: formatTrendWeekLabel(startDayNumber, endDayNumber, now),
      isCurrentWeek: weekIndex === 0,
      leaders,
      primary: leaders[0] ?? null,
      secondary: leaders.slice(1, 10),
      hasData: leaders.length > 0
    });
  }

  return boards;
}

export function countTrendHosts(rawValue, now = Date.now()) {
  const trendsStore = normalizeTrendsStore(rawValue, {
    now
  });

  return Object.values(trendsStore.hosts).reduce((count, entry) => {
    const lifetime = entry?.lifetime;
    if (!lifetime) {
      return count;
    }

    return lifetime.browseTimeMs || lifetime.playbackCount || lifetime.openCount ? count + 1 : count;
  }, 0);
}

export function formatDurationMs(durationMs) {
  const value = Math.max(0, Math.round(durationMs ?? 0));
  if (!value) {
    return '0m';
  }

  if (value < 60_000) {
    return '<1m';
  }

  const totalMinutes = Math.round(value / 60_000);
  if (totalMinutes < 60) {
    return `${totalMinutes}m`;
  }

  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return `${minutes}m`;
}

export function formatTrendMetricValue(metricId, value) {
  const metric = getTrendMetric(metricId).id;
  const safeValue = Math.max(0, Math.round(value ?? 0));

  if (metric === 'browseTimeMs') {
    return formatDurationMs(safeValue);
  }

  if (metric === 'playbackCount') {
    return `${safeValue} play${safeValue === 1 ? '' : 's'}`;
  }

  return `${safeValue} open${safeValue === 1 ? '' : 's'}`;
}

function normalizeTab(tab, tabActivityById, windowLabelById) {
  const url = tab.url ?? tab.pendingUrl ?? '';
  const location = parseTabLocation(url);
  const tabId = String(tab.id);
  const activity = tabActivityById[tabId];
  const discarded = Boolean(tab.discarded);
  const frozen = Boolean(tab.frozen);

  return {
    id: tab.id,
    windowId: tab.windowId,
    windowLabel: windowLabelById.get(tab.windowId) ?? 'Window ?',
    title: (tab.title || location.groupLabel || DEFAULT_EMPTY_TITLE).trim(),
    url,
    displayUrl: url || location.shortUrl,
    favIconUrl: normalizeOptionalString(tab.favIconUrl),
    host: location.host,
    groupKey: location.groupKey,
    groupLabel: location.groupLabel,
    active: Boolean(tab.active),
    inactive: discarded || frozen,
    inactiveReason: frozen ? 'frozen' : discarded ? 'discarded' : null,
    pinned: Boolean(tab.pinned),
    audible: Boolean(tab.audible),
    isSaved: false,
    lastActivatedAt:
      activity && typeof activity.lastActivatedAt === 'number' ? activity.lastActivatedAt : null,
    searchText: [tab.title, url, location.groupLabel, location.host].filter(Boolean).join(' ').toLowerCase()
  };
}

function createRenderedSeeItLaterItem(item, openTab) {
  if (openTab) {
    return {
      savedId: item.id,
      currentTabId: openTab.id,
      windowId: openTab.windowId,
      windowLabel: openTab.windowLabel,
      title: openTab.title,
      url: openTab.url,
      displayUrl: openTab.url || openTab.displayUrl,
      favIconUrl: openTab.favIconUrl,
      groupLabel: openTab.groupLabel,
      host: openTab.host,
      lastActivatedAt: openTab.lastActivatedAt,
      inactive: Boolean(openTab.inactive),
      inactiveReason: openTab.inactiveReason ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      isOpen: true,
      searchText: openTab.searchText
    };
  }

  return {
    savedId: item.id,
    currentTabId: null,
    windowId: null,
    windowLabel: null,
    title: item.title,
    url: item.url,
    displayUrl: item.displayUrl || item.url,
    favIconUrl: item.favIconUrl,
    groupLabel: item.groupLabel,
    host: item.host,
    lastActivatedAt: item.lastActivatedAt,
    inactive: false,
    inactiveReason: null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isOpen: false,
    searchText: [item.title, item.url, item.groupLabel, item.host].filter(Boolean).join(' ').toLowerCase()
  };
}

function buildWindowLabels(tabs) {
  const windowIds = Array.from(
    new Set(
      tabs
        .map((tab) => tab.windowId)
        .filter((windowId) => typeof windowId === 'number')
        .sort((left, right) => left - right)
    )
  );

  return new Map(windowIds.map((windowId, index) => [windowId, `Window ${index + 1}`]));
}

function buildLooseWindows(tabs) {
  const windowsById = new Map();

  for (const tab of tabs) {
    if (!windowsById.has(tab.windowId)) {
      windowsById.set(tab.windowId, {
        windowId: tab.windowId,
        windowLabel: tab.windowLabel,
        tabs: []
      });
    }

    windowsById.get(tab.windowId).tabs.push(tab);
  }

  return Array.from(windowsById.values())
    .filter((windowBucket) => windowBucket.tabs.length === 1)
    .sort((left, right) => compareTabs(left.tabs[0], right.tabs[0]));
}

function tabMatchesTokens(tab, tokens) {
  return tokens.every((token) => tab.searchText.includes(token));
}

function addTabToGroup(groupMap, profile, tab) {
  const compositeKey = `${profile.key}:${tab.groupKey}`;

  if (!groupMap.has(compositeKey)) {
    groupMap.set(compositeKey, {
      key: compositeKey,
      label: tab.groupLabel,
      groupKey: tab.groupKey,
      profileKey: profile.key,
      faviconUrl: tab.favIconUrl,
      tabs: [],
      activeCount: 0,
      lastActivatedAt: null
    });
  }

  const group = groupMap.get(compositeKey);
  group.tabs.push(tab);
  if (!group.faviconUrl && tab.favIconUrl) {
    group.faviconUrl = tab.favIconUrl;
  }
  group.activeCount += tab.active ? 1 : 0;
  group.lastActivatedAt = maxTimestamp(group.lastActivatedAt, tab.lastActivatedAt);
  group.tabs.sort(compareTabs);
}

function addTabToWindowGroup(groupMap, profile, tab) {
  const compositeKey = `${profile.key}:window:${tab.windowId}`;

  if (!groupMap.has(compositeKey)) {
    groupMap.set(compositeKey, {
      key: compositeKey,
      label: tab.windowLabel,
      groupKey: `window:${tab.windowId}`,
      profileKey: profile.key,
      faviconUrl: null,
      tabs: [],
      activeCount: 0,
      lastActivatedAt: null,
      windowId: tab.windowId,
      domainKeys: new Set()
    });
  }

  const group = groupMap.get(compositeKey);
  group.tabs.push(tab);
  group.activeCount += tab.active ? 1 : 0;
  group.lastActivatedAt = maxTimestamp(group.lastActivatedAt, tab.lastActivatedAt);
  group.tabs.sort(compareTabs);

  const domainKey = tab.host || tab.groupKey || tab.groupLabel;
  if (domainKey) {
    group.domainKeys.add(domainKey);
  }
}

function sortGroups(groups) {
  return groups.sort((left, right) => left.label.localeCompare(right.label));
}

function sortWindowGroups(groups) {
  return groups
    .map((group) => ({
      ...group,
      domainCount: group.domainKeys.size
    }))
    .sort((left, right) => (left.windowId ?? 0) - (right.windowId ?? 0));
}

function sortTrackedOpenItems(items) {
  return items.sort((left, right) => compareTabs(left, right));
}

function sortTrackedSavedItems(items) {
  return items.sort((left, right) => {
    const timeDifference = sortTimestamps(right.updatedAt, left.updatedAt);
    if (timeDifference !== 0) {
      return timeDifference;
    }

    return left.title.localeCompare(right.title);
  });
}

function compareTabs(left, right) {
  const activeDifference = Number(right.active) - Number(left.active);
  if (activeDifference !== 0) {
    return activeDifference;
  }

  const inactiveDifference = Number(Boolean(left.inactive)) - Number(Boolean(right.inactive));
  if (inactiveDifference !== 0) {
    return inactiveDifference;
  }

  const timeDifference = sortTimestamps(right.lastActivatedAt, left.lastActivatedAt);
  if (timeDifference !== 0) {
    return timeDifference;
  }

  const pinnedDifference = Number(right.pinned) - Number(left.pinned);
  if (pinnedDifference !== 0) {
    return pinnedDifference;
  }

  return left.title.localeCompare(right.title);
}

function compareTrendLeaders(left, right) {
  const scoreDifference = (right.score ?? 0) - (left.score ?? 0);
  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  const timeDifference = sortTimestamps(right.lastActivityAt, left.lastActivityAt);
  if (timeDifference !== 0) {
    return timeDifference;
  }

  return left.host.localeCompare(right.host);
}

function sortTimestamps(left, right) {
  return (left ?? 0) - (right ?? 0);
}

function maxTimestamp(left, right) {
  if (left == null) {
    return right ?? null;
  }

  if (right == null) {
    return left;
  }

  return Math.max(left, right);
}

function normalizeTrendHostEntry(rawValue, now) {
  if (!rawValue || typeof rawValue !== 'object') {
    return null;
  }

  const lifetime = normalizeTrendCounts(rawValue.lifetime);
  const daily = normalizeTrendDailyBuckets(rawValue.daily, now);
  const lastActivityAt = typeof rawValue.lastActivityAt === 'number' ? rawValue.lastActivityAt : null;
  const faviconUrl = normalizeOptionalString(rawValue.faviconUrl);

  if (!hasTrendCounts(lifetime) && !Object.keys(daily).length) {
    return null;
  }

  return {
    lifetime,
    daily,
    lastActivityAt,
    faviconUrl
  };
}

function normalizeTrendDailyBuckets(rawValue, now) {
  if (!rawValue || typeof rawValue !== 'object') {
    return {};
  }

  const currentDayNumber = getLocalDayNumber(now);
  const minimumDayNumber = currentDayNumber - TREND_DAILY_RETENTION_DAYS + 1;
  const daily = {};

  for (const [dayKey, rawBucket] of Object.entries(rawValue)) {
    const dayNumber = parseTrendDayNumber(dayKey);
    if (dayNumber == null || dayNumber < minimumDayNumber) {
      continue;
    }

    const counts = normalizeTrendCounts(rawBucket);
    if (hasTrendCounts(counts)) {
      daily[dayKey] = counts;
    }
  }

  return daily;
}

function normalizeTrendRuntime(rawValue) {
  const rawTabStateById = rawValue?.tabStateById && typeof rawValue.tabStateById === 'object' ? rawValue.tabStateById : {};
  const tabStateById = {};

  for (const [tabId, rawState] of Object.entries(rawTabStateById)) {
    const numericTabId = Number.parseInt(tabId, 10);
    if (!Number.isInteger(numericTabId) || numericTabId < 0 || !rawState || typeof rawState !== 'object') {
      continue;
    }

    const url = typeof rawState.url === 'string' ? rawState.url : '';
    const lastCompletedUrl = typeof rawState.lastCompletedUrl === 'string' ? rawState.lastCompletedUrl : '';
    tabStateById[String(numericTabId)] = {
      url,
      lastCompletedUrl,
      host: normalizeTrendHostKey(rawState.host) || getTrackableHost(url),
      audible: Boolean(rawState.audible),
      windowId: typeof rawState.windowId === 'number' ? rawState.windowId : null
    };
  }

  const rawActiveSession = rawValue?.activeSession;
  const activeSession =
    rawActiveSession &&
    typeof rawActiveSession === 'object' &&
    typeof rawActiveSession.tabId === 'number' &&
    typeof rawActiveSession.windowId === 'number' &&
    typeof rawActiveSession.startedAt === 'number' &&
    typeof rawActiveSession.lastFlushedAt === 'number'
      ? {
          tabId: rawActiveSession.tabId,
          windowId: rawActiveSession.windowId,
          host: normalizeTrendHostKey(rawActiveSession.host),
          startedAt: rawActiveSession.startedAt,
          lastFlushedAt: rawActiveSession.lastFlushedAt
        }
      : null;

  return {
    activeSession:
      activeSession && activeSession.host
        ? activeSession
        : null,
    tabStateById
  };
}

function normalizeTrendCounts(rawValue) {
  return {
    browseTimeMs: normalizePositiveInteger(rawValue?.browseTimeMs),
    playbackCount: normalizePositiveInteger(rawValue?.playbackCount),
    openCount: normalizePositiveInteger(rawValue?.openCount)
  };
}

function createEmptyTrendHostEntry() {
  return {
    lifetime: createEmptyTrendCounts(),
    daily: {},
    lastActivityAt: null,
    faviconUrl: null
  };
}

function createEmptyTrendCounts() {
  return {
    browseTimeMs: 0,
    playbackCount: 0,
    openCount: 0
  };
}

function copyTrendCounts(counts) {
  return {
    browseTimeMs: counts?.browseTimeMs ?? 0,
    playbackCount: counts?.playbackCount ?? 0,
    openCount: counts?.openCount ?? 0
  };
}

function addTrendCounts(target, source) {
  target.browseTimeMs += source?.browseTimeMs ?? 0;
  target.playbackCount += source?.playbackCount ?? 0;
  target.openCount += source?.openCount ?? 0;
  return target;
}

function hasTrendCounts(counts) {
  return Boolean((counts?.browseTimeMs ?? 0) || (counts?.playbackCount ?? 0) || (counts?.openCount ?? 0));
}

function normalizeTrendHostKey(host) {
  return typeof host === 'string' && host.trim() ? host.trim().toLowerCase() : '';
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizePositiveInteger(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.round(value));
}

function getLocalDayNumber(timestamp) {
  const date = new Date(timestamp);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS);
}

function getLocalWeekStartDayNumber(timestamp) {
  const date = new Date(timestamp);
  const dayOffset = (date.getDay() + 6) % 7;
  return getLocalDayNumber(timestamp) - dayOffset;
}

function parseTrendDayNumber(dayKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dayKey);
  if (!match) {
    return null;
  }

  const year = Number.parseInt(match[1], 10);
  const month = Number.parseInt(match[2], 10);
  const day = Number.parseInt(match[3], 10);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function formatTrendWeekLabel(startDayNumber, endDayNumber, now = Date.now()) {
  const startDate = new Date(startDayNumber * DAY_MS);
  const endDate = new Date(endDayNumber * DAY_MS);
  const currentWeekStartDayNumber = getLocalWeekStartDayNumber(now);
  const startFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  });
  const endFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: startDate.getFullYear() === endDate.getFullYear() ? undefined : 'numeric'
  });

  const baseLabel = `${startFormatter.format(startDate)} - ${endFormatter.format(endDate)}`;
  if (startDayNumber === currentWeekStartDayNumber) {
    return `This week · ${baseLabel}`;
  }

  return baseLabel;
}

function formatSpecialLocation(parsedUrl) {
  const protocol = parsedUrl.protocol.toLowerCase();

  if (protocol === 'file:') {
    return 'file://';
  }

  if (protocol === 'about:') {
    return parsedUrl.href.toLowerCase();
  }

  if (parsedUrl.hostname) {
    return `${protocol}//${parsedUrl.hostname}`.toLowerCase();
  }

  const pathname = parsedUrl.pathname.replace(/^\/+/, '');
  return pathname ? `${protocol}${pathname}`.toLowerCase() : protocol;
}

export function formatRelativeTime(timestamp, now = Date.now()) {
  if (!timestamp) {
    return 'Not switched yet';
  }

  const difference = Math.max(0, now - timestamp);

  if (difference < 60_000) {
    return 'Just now';
  }

  if (difference < 3_600_000) {
    return `${Math.round(difference / 60_000)}m ago`;
  }

  if (difference < 86_400_000) {
    return `${Math.round(difference / 3_600_000)}h ago`;
  }

  if (difference < 604_800_000) {
    return `${Math.round(difference / 86_400_000)}d ago`;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(new Date(timestamp));
}
