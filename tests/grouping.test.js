import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTabSnapshot,
  countTrendHosts,
  createTrendDayKey,
  formatTrendMetricValue,
  formatRelativeTime,
  GROUP_SORT_DIRECTIONS,
  GROUP_SORT_OPTIONS,
  groupTabGroups,
  getOtherTabIdsInGroup,
  getTrendCountsForWindow,
  getTrendLeaders,
  getWeeklyTrendBoards,
  normalizePreferences,
  normalizeTrendsStore,
  parseTabLocation,
  recordTrendMetric,
  sortTabGroups
} from '../src/lib/grouping.js';

test('parseTabLocation uses exact hostnames and preserves subdomains', () => {
  assert.equal(parseTabLocation('https://example.com/path').groupLabel, 'example.com');
  assert.equal(parseTabLocation('https://admin.example.com/path').groupLabel, 'admin.example.com');
  assert.notEqual(
    parseTabLocation('https://example.com/path').groupKey,
    parseTabLocation('https://admin.example.com/path').groupKey
  );
});

test('buildTabSnapshot groups matching domains across windows and keeps stable hostname ordering', () => {
  const snapshot = buildTabSnapshot(
    [
      {
        id: 1,
        windowId: 300,
        title: 'Inbox',
        url: 'https://mail.google.com/mail/u/0/#inbox',
        favIconUrl: 'https://mail.google.com/favicon.ico',
        active: false
      },
      {
        id: 2,
        windowId: 901,
        title: 'Work Inbox',
        url: 'https://mail.google.com/mail/u/1/#inbox',
        active: true
      },
      {
        id: 3,
        windowId: 901,
        title: 'Admin Console',
        url: 'https://admin.google.com/ac/home',
        active: false
      }
    ],
    {
      1: { lastActivatedAt: 10_000 },
      2: { lastActivatedAt: 20_000 },
      3: { lastActivatedAt: 15_000 }
    }
  );

  assert.equal(snapshot.stats.totalGroups, 2);
  assert.equal(snapshot.stats.totalTabs, 3);
  assert.equal(snapshot.stats.looseWindowCount, 1);

  const [firstGroup, secondGroup] = snapshot.profiles[0].groups;
  assert.equal(firstGroup.label, 'admin.google.com');
  assert.equal(secondGroup.label, 'mail.google.com');
  assert.equal(secondGroup.tabs.length, 2);
  assert.equal(secondGroup.tabs[0].windowLabel, 'Window 2');
  assert.equal(secondGroup.faviconUrl, 'https://mail.google.com/favicon.ico');

  const [firstWindowGroup, secondWindowGroup] = snapshot.profiles[0].windowGroups;
  assert.equal(firstWindowGroup.label, 'Window 1');
  assert.equal(firstWindowGroup.tabs.length, 1);
  assert.equal(firstWindowGroup.domainCount, 1);
  assert.equal(secondWindowGroup.label, 'Window 2');
  assert.equal(secondWindowGroup.tabs.length, 2);
  assert.equal(secondWindowGroup.domainCount, 2);
});

test('buildTabSnapshot carries locally-read page descriptions into tab cards', () => {
  const snapshot = buildTabSnapshot(
    [{ id: 1, windowId: 1, title: 'Docs', url: 'https://docs.example.com/start' }],
    {},
    undefined,
    { tabDescriptions: { '1': 'A short documentation overview.' } }
  );

  assert.equal(snapshot.profiles[0].groups[0].tabs[0].description, 'A short documentation overview.');
});

test('group ordering stays predictable even when activity and size differ', () => {
  const snapshot = buildTabSnapshot(
    [
      {
        id: 1,
        windowId: 1,
        title: 'Release notes',
        url: 'https://zeta.example.com/releases',
        active: true
      },
      {
        id: 2,
        windowId: 2,
        title: 'Inbox',
        url: 'https://alpha.example.com/mail',
        active: false
      },
      {
        id: 3,
        windowId: 3,
        title: 'Inbox copy',
        url: 'https://alpha.example.com/other',
        active: false
      }
    ],
    {
      1: { lastActivatedAt: 40_000 },
      2: { lastActivatedAt: 10_000 },
      3: { lastActivatedAt: 15_000 }
    }
  );

  assert.deepEqual(
    snapshot.profiles[0].groups.map((group) => group.label),
    ['alpha.example.com', 'zeta.example.com']
  );
});

test('inactive lifecycle tabs sink to the end of their domain card', () => {
  const snapshot = buildTabSnapshot(
    [
      {
        id: 1,
        windowId: 1,
        title: 'Active doc',
        url: 'https://docs.example.com/a',
        active: true
      },
      {
        id: 2,
        windowId: 1,
        title: 'Recent doc',
        url: 'https://docs.example.com/b',
        active: false
      },
      {
        id: 3,
        windowId: 2,
        title: 'Discarded doc',
        url: 'https://docs.example.com/c',
        active: false,
        discarded: true
      }
    ],
    {
      1: { lastActivatedAt: 10_000 },
      2: { lastActivatedAt: 20_000 },
      3: { lastActivatedAt: 30_000 }
    }
  );

  const group = snapshot.profiles[0].groups[0];
  assert.equal(group.label, 'docs.example.com');
  assert.deepEqual(group.tabs.map((tab) => tab.id), [1, 2, 3]);
  assert.equal(group.tabs[2].inactive, true);
  assert.equal(group.tabs[2].inactiveReason, 'discarded');
});

test('search filters tabs by domain, URL, and title', () => {
  const tabs = [
    {
      id: 1,
      windowId: 1,
      title: 'Quarterly Revenue',
      url: 'https://docs.example.com/spreadsheets/d/123'
    },
    {
      id: 2,
      windowId: 2,
      title: 'Support Inbox',
      url: 'https://mail.example.com/u/0/#inbox'
    },
    {
      id: 3,
      windowId: 3,
      title: 'Release Notes',
      url: 'https://example.com/releases/may'
    }
  ];

  const titleMatch = buildTabSnapshot(tabs, {}, undefined, { query: 'revenue' });
  assert.equal(titleMatch.stats.visibleGroups, 1);
  assert.equal(titleMatch.profiles[0].groups[0].tabs[0].id, 1);

  const domainMatch = buildTabSnapshot(tabs, {}, undefined, { query: 'mail.example.com inbox' });
  assert.equal(domainMatch.stats.visibleGroups, 1);
  assert.equal(domainMatch.profiles[0].groups[0].tabs[0].id, 2);

  const urlMatch = buildTabSnapshot(tabs, {}, undefined, { query: 'releases may' });
  assert.equal(urlMatch.stats.visibleGroups, 1);
  assert.equal(urlMatch.profiles[0].groups[0].tabs[0].id, 3);
});

test('see-it-later items split into open and saved subsections', () => {
  const tabs = [
    {
      id: 1,
      windowId: 10,
      title: 'Hacker News',
      url: 'https://news.ycombinator.com/',
      active: true
    },
    {
      id: 2,
      windowId: 11,
      title: 'Roadmap',
      url: 'https://example.com/roadmap'
    }
  ];

  const snapshot = buildTabSnapshot(
    tabs,
    {
      1: { lastActivatedAt: 50_000 }
    },
    {
      items: [
        {
          id: 'later-open',
          currentTabId: 1,
          url: 'https://news.ycombinator.com/',
          title: 'Older title',
          groupLabel: 'news.ycombinator.com',
          displayUrl: 'https://news.ycombinator.com/',
          createdAt: 10_000,
          updatedAt: 20_000
        },
        {
          id: 'later-saved',
          currentTabId: 99,
          url: 'https://example.com/roadmap',
          title: 'Roadmap',
          groupLabel: 'example.com',
          displayUrl: 'https://example.com/roadmap',
          createdAt: 12_000,
          updatedAt: 40_000
        }
      ]
    }
  );

  assert.equal(snapshot.stats.trackedOpenCount, 1);
  assert.equal(snapshot.stats.trackedSavedCount, 1);
  assert.equal(snapshot.profiles[0].seeItLater.openItems.length, 1);
  assert.equal(snapshot.profiles[0].seeItLater.savedItems.length, 1);
  assert.equal(snapshot.profiles[0].seeItLater.openItems[0].title, 'Hacker News');
  assert.equal(snapshot.profiles[0].seeItLater.savedItems[0].savedId, 'later-saved');
  const trackedGroup = snapshot.profiles[0].groups.find((group) => group.label === 'news.ycombinator.com');
  assert.equal(trackedGroup?.tabs.some((tab) => tab.isSaved), true);
});

test('trend rankings keep exact hostnames separate and honor time windows', () => {
  const dayMs = 86_400_000;
  const now = new Date('2026-05-09T12:00:00Z').valueOf();

  let trends = normalizeTrendsStore();
  trends = recordTrendMetric(trends, 'docs.example.com', 'openCount', 4, {
    timestamp: now
  });
  trends = recordTrendMetric(trends, 'example.com', 'openCount', 9, {
    timestamp: now - 40 * dayMs
  });
  trends = recordTrendMetric(trends, 'example.com', 'openCount', 2, {
    timestamp: now - 2 * dayMs
  });
  trends = recordTrendMetric(trends, 'video.example.com', 'playbackCount', 3, {
    timestamp: now - 6 * dayMs
  });
  trends = recordTrendMetric(trends, 'docs.example.com', 'browseTimeMs', 120_000, {
    timestamp: now - dayMs
  });

  assert.equal(countTrendHosts(trends, now), 3);

  const weeklyOpenLeaders = getTrendLeaders(trends, {
    metricId: 'openCount',
    windowId: '7d',
    now
  });

  assert.deepEqual(
    weeklyOpenLeaders.map((leader) => leader.host),
    ['docs.example.com', 'example.com']
  );
  assert.equal(weeklyOpenLeaders[0].score, 4);
  assert.equal(weeklyOpenLeaders[1].score, 2);

  const lifetimeOpenLeaders = getTrendLeaders(trends, {
    metricId: 'openCount',
    windowId: 'lifetime',
    now
  });

  assert.equal(lifetimeOpenLeaders[0].host, 'example.com');
  assert.equal(lifetimeOpenLeaders[0].score, 11);

  assert.equal(getTrendCountsForWindow(trends.hosts['example.com'], '30d', now).openCount, 2);
  assert.equal(getTrendCountsForWindow(trends.hosts['example.com'], 'lifetime', now).openCount, 11);
});

test('trend normalization prunes stale daily buckets but keeps lifetime totals', () => {
  const now = new Date('2026-05-09T12:00:00Z').valueOf();
  const staleKey = createTrendDayKey(now - 430 * 86_400_000);
  const recentKey = createTrendDayKey(now - 3 * 86_400_000);

  const trends = normalizeTrendsStore(
    {
      hosts: {
        'example.com': {
          lifetime: {
            browseTimeMs: 180_000,
            playbackCount: 2,
            openCount: 12
          },
          daily: {
            [staleKey]: {
              openCount: 7
            },
            [recentKey]: {
              openCount: 3
            }
          }
        }
      }
    },
    {
      now
    }
  );

  assert.deepEqual(Object.keys(trends.hosts['example.com'].daily), [recentKey]);
  assert.equal(getTrendCountsForWindow(trends.hosts['example.com'], '30d', now).openCount, 3);
  assert.equal(getTrendCountsForWindow(trends.hosts['example.com'], 'lifetime', now).openCount, 12);
});

test('weekly trend boards produce rolling top-10 cards for the selected metric', () => {
  const dayMs = 86_400_000;
  const now = new Date('2026-05-10T12:00:00Z').valueOf();

  let trends = normalizeTrendsStore();
  trends = recordTrendMetric(trends, 'alpha.example.com', 'openCount', 12, {
    timestamp: now - dayMs
  });
  trends = recordTrendMetric(trends, 'beta.example.com', 'openCount', 8, {
    timestamp: now - 2 * dayMs
  });
  trends = recordTrendMetric(trends, 'gamma.example.com', 'openCount', 6, {
    timestamp: now - 8 * dayMs
  });
  trends = recordTrendMetric(trends, 'delta.example.com', 'openCount', 4, {
    timestamp: now - 9 * dayMs
  });

  const boards = getWeeklyTrendBoards(trends, {
    metricId: 'openCount',
    now,
    weekCount: 4
  });

  assert.equal(boards.length, 4);
  assert.equal(boards[0].isCurrentWeek, true);
  assert.equal(boards[0].primary?.host, 'alpha.example.com');
  assert.equal(boards[0].leaders[0].score, 12);
  assert.equal(boards[0].leaders[1].host, 'beta.example.com');
  assert.equal(boards[1].primary?.host, 'gamma.example.com');
  assert.equal(boards[1].leaders[1].host, 'delta.example.com');
  assert.equal(boards[2].hasData, false);

  const filteredBoards = getWeeklyTrendBoards(trends, {
    metricId: 'openCount',
    now,
    weekCount: 4,
    query: 'gamma',
    includeEmptyWeeks: false
  });

  assert.equal(filteredBoards.length, 1);
  assert.equal(filteredBoards[0].primary?.host, 'gamma.example.com');
});

test('formatTrendMetricValue returns readable metric labels', () => {
  assert.equal(formatTrendMetricValue('browseTimeMs', 45_000), '<1m');
  assert.equal(formatTrendMetricValue('playbackCount', 2), '2 plays');
  assert.equal(formatTrendMetricValue('openCount', 1), '1 open');
});

test('sortTabGroups supports name, count, and recent ordering without mutating input', () => {
  const groups = [
    { label: 'beta.example.com', tabs: [{ id: 1 }], lastActivatedAt: 30_000 },
    { label: 'alpha.example.com', tabs: [{ id: 2 }, { id: 3 }], lastActivatedAt: 10_000 },
    { label: 'gamma.example.com', tabs: [{ id: 4 }], lastActivatedAt: 50_000 }
  ];

  assert.deepEqual(
    sortTabGroups(groups, 'name').map((group) => group.label),
    ['alpha.example.com', 'beta.example.com', 'gamma.example.com']
  );
  assert.deepEqual(
    sortTabGroups(groups, 'count').map((group) => group.label),
    ['alpha.example.com', 'beta.example.com', 'gamma.example.com']
  );
  assert.deepEqual(
    sortTabGroups(groups, 'recent').map((group) => group.label),
    ['gamma.example.com', 'beta.example.com', 'alpha.example.com']
  );
  assert.deepEqual(
    sortTabGroups(groups, 'count', { direction: 'asc' }).map((group) => group.label),
    ['beta.example.com', 'gamma.example.com', 'alpha.example.com']
  );
  assert.deepEqual(
    sortTabGroups(groups, 'name', { direction: 'desc' }).map((group) => group.label),
    ['gamma.example.com', 'beta.example.com', 'alpha.example.com']
  );
  assert.equal(groups[0].label, 'beta.example.com');
});

test('getOtherTabIdsInGroup keeps the selected tab and returns unique peers to close', () => {
  assert.deepEqual(
    getOtherTabIdsInGroup(
      {
        tabs: [{ id: 10 }, { id: 11 }, { id: 11 }, { id: 12 }, { id: null }]
      },
      11
    ),
    [10, 12]
  );
  assert.deepEqual(getOtherTabIdsInGroup({ tabs: [{ id: 10 }] }, 10), []);
  assert.deepEqual(getOtherTabIdsInGroup(undefined, 10), []);
});

test('groupTabGroups keeps pinned cards first and creates only populated name buckets', () => {
  const sections = groupTabGroups([
      { label: 'beta.example.com', tabs: [{ id: 1 }] },
      { label: 'alpha.example.com', tabs: [{ id: 2, pinned: true }] },
      { label: 'apple.example.com', tabs: [{ id: 5 }] },
      { label: '7.example.com', tabs: [{ id: 3 }] },
      { label: '中文.example.com', tabs: [{ id: 4 }] }
  ], 'name');

  assert.deepEqual(sections.map((section) => section.label), ['Pinned', 'A', 'B', '0-9', '#']);
  assert.deepEqual(sections[0].groups.map((group) => group.label), ['alpha.example.com']);
  assert.deepEqual(sections[4].groups.map((group) => group.label), ['中文.example.com']);
  assert.deepEqual(
    groupTabGroups(
      [
        { label: 'alpha', tabs: [{ id: 1 }] },
        { label: 'beta', tabs: [{ id: 2 }] },
        { label: 'zulu', tabs: [{ id: 3 }] }
      ],
      'name',
      { direction: 'desc' }
    ).map((section) => section.label),
    ['Z', 'B', 'A']
  );
});

test('groupTabGroups uses adaptive populated count buckets', () => {
  const makeTabs = (count) => Array.from({ length: count }, (_, index) => ({ id: index + 1 }));
  const sections = groupTabGroups(
    [
      { label: 'one', tabs: makeTabs(1) },
      { label: 'four', tabs: makeTabs(4) },
      { label: 'seven', tabs: makeTabs(7) },
      { label: 'twenty-five', tabs: makeTabs(25) },
      { label: 'one-hundred-one', tabs: makeTabs(101) }
    ],
    'count'
  );

  assert.deepEqual(sections.map((section) => section.label), ['101–200 tabs', '21–50 tabs', '6–10 tabs', '2–5 tabs', '1 tab']);
  assert.deepEqual(
    groupTabGroups(
      [
        { label: 'one', tabs: makeTabs(1) },
        { label: 'seven', tabs: makeTabs(7) },
        { label: 'twenty-five', tabs: makeTabs(25) }
      ],
      'count',
      { direction: 'asc' }
    ).map((section) => section.label),
    ['1 tab', '6–10 tabs', '21–50 tabs']
  );
});

test('groupTabGroups places recent cards into populated age ranges', () => {
  const now = 1_000_000_000;
  const hour = 60 * 60 * 1000;
  const day = 24 * hour;
  const sections = groupTabGroups(
    [
      { label: 'fresh', tabs: [{ id: 1 }], lastActivatedAt: now - 30 * 60 * 1000 },
      { label: 'today', tabs: [{ id: 2 }], lastActivatedAt: now - 8 * hour },
      { label: 'week', tabs: [{ id: 3 }], lastActivatedAt: now - 5 * day },
      { label: 'unknown', tabs: [{ id: 4 }], lastActivatedAt: null }
    ],
    'recent',
    { now }
  );

  assert.deepEqual(sections.map((section) => section.label), ['< 1h', '6–12h', '3d–1w', 'No activity']);
  assert.equal(sections[0].groups[0].label, 'fresh');
  assert.deepEqual(
    groupTabGroups(
      [
        { label: 'fresh', tabs: [{ id: 1 }], lastActivatedAt: now - 30 * 60 * 1000 },
        { label: 'week', tabs: [{ id: 3 }], lastActivatedAt: now - 5 * day },
        { label: 'unknown', tabs: [{ id: 4 }], lastActivatedAt: null }
      ],
      'recent',
      { now, direction: 'asc' }
    ).map((section) => section.label),
    ['No activity', '3d–1w', '< 1h']
  );
});

test('normalizePreferences falls back to the default theme', () => {
  const preferences = normalizePreferences({ themeId: 'ink', openGroupView: 'window', groupSort: 'recent' });
  assert.equal(preferences.themeId, 'ink');
  assert.equal(preferences.openGroupView, 'window');
  assert.equal(preferences.groupSort, 'recent');
  assert.deepEqual(preferences.groupSortDirections, { name: 'asc', count: 'desc', recent: 'desc' });
  assert.equal(
    normalizePreferences({ groupSort: 'recent', groupSortDirection: 'asc' }).groupSortDirections.recent,
    'asc'
  );
  assert.equal(normalizePreferences({ themeId: 'missing' }).themeId, 'mint');
  assert.equal(normalizePreferences(undefined).themeId, 'mint');
  assert.equal(normalizePreferences({ openGroupView: 'invalid' }).openGroupView, 'domain');
  assert.equal(normalizePreferences({ groupSort: 'invalid' }).groupSort, GROUP_SORT_OPTIONS[0].id);
  assert.equal(GROUP_SORT_DIRECTIONS[0].id, 'asc');
});

test('formatRelativeTime reports a stable human-readable label', () => {
  const now = new Date('2026-05-09T12:00:00Z').valueOf();

  assert.equal(formatRelativeTime(now - 15_000, now), 'Just now');
  assert.equal(formatRelativeTime(now - 120_000, now), '2m ago');
  assert.equal(formatRelativeTime(now - 7_200_000, now), '2h ago');
});
