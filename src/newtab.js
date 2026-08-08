import {
  ACTIVITY_STORAGE_KEY,
  buildTabSnapshot,
  countTrendHosts,
  createSeeItLaterItem,
  DEFAULT_PROFILE_BUCKET,
  formatRelativeTime,
  formatTrendMetricValue,
  GROUP_SORT_DIRECTIONS,
  GROUP_SORT_OPTIONS,
  groupTabGroups,
  getTrendLeaders,
  getOtherTabIdsInGroup,
  getWeeklyTrendBoards,
  normalizePreferences,
  normalizeSeeItLaterStore,
  normalizeTrendsStore,
  PREFERENCES_STORAGE_KEY,
  SEE_IT_LATER_STORAGE_KEY,
  TRENDS_STORAGE_KEY,
  TREND_METRICS,
  TREND_WINDOWS,
  THEMES
} from './lib/grouping.js';
import { createIcon } from './lib/icons.js';

const CONTENT_VIEWS = Object.freeze({
  OPEN: 'open',
  TRENDS: 'trends',
  LATER: 'later'
});

const OPEN_GROUP_VIEWS = Object.freeze({
  DOMAIN: 'domain',
  WINDOW: 'window'
});

const LAYOUT_GAP_PX = 18;
const SEARCH_FOCUS_RETRY_MS = Object.freeze([0, 80, 180, 320, 520]);

const CONTENT_TAB_ICONS = Object.freeze({
  [CONTENT_VIEWS.OPEN]: 'stack',
  [CONTENT_VIEWS.TRENDS]: 'trend',
  [CONTENT_VIEWS.LATER]: 'bookmark'
});

const elements = {
  searchLeading: document.querySelector('#search-leading'),
  searchInput: document.querySelector('#search-input'),
  clearSearch: document.querySelector('#clear-search'),
  results: document.querySelector('#results'),
  themeSwitcher: document.querySelector('#theme-switcher')
};

const extensionRoot = chrome.runtime.getURL('/');
const FAVICON_CACHE_LIMIT = 256;
const faviconLoadCache = new Map();

const state = {
  query: '',
  tabs: [],
  tabActivity: {},
  seeItLater: normalizeSeeItLaterStore(),
  trends: normalizeTrendsStore(),
  preferences: normalizePreferences(),
  profile: DEFAULT_PROFILE_BUCKET,
  contentView: CONTENT_VIEWS.OPEN,
  openGroupView: normalizePreferences().openGroupView,
  groupSort: normalizePreferences().groupSort,
  groupSortDirections: normalizePreferences().groupSortDirections,
  expandedCards: new Set(),
  trendMetric: TREND_METRICS[0].id,
  trendWindow: TREND_WINDOWS[0].id,
  snapshot: null,
  laterGroups: [],
  error: null
};

let refreshTimer = null;
let layoutFrame = 0;
let searchFocusTimers = [];

initialize().catch((error) => {
  console.error('Failed to initialize new tab page.', error);
  state.error = 'Could not load tabs from Chrome.';
  render();
});

async function initialize() {
  renderSearchLeading();
  renderClearSearchButton();
  bindUiEvents();
  await refreshSnapshotInputs();
  scheduleSearchInputFocus();
}

function renderSearchLeading() {
  elements.searchLeading.replaceChildren(createIcon('search'));
}

function renderClearSearchButton() {
  elements.clearSearch.className = 'search-clear';
  elements.clearSearch.setAttribute('aria-label', 'Clear search');
  elements.clearSearch.title = 'Clear search';
  elements.clearSearch.replaceChildren(createIcon('close'));
}

function bindUiEvents() {
  window.addEventListener('resize', () => {
    schedulePackedLayout();
  });

  window.addEventListener('focus', () => {
    scheduleSearchInputFocus();
  });

  window.addEventListener('pageshow', () => {
    scheduleSearchInputFocus();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      scheduleSearchInputFocus();
    }
  });

  elements.searchInput.addEventListener('input', (event) => {
    state.query = event.target.value;
    render();
  });

  elements.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.query) {
      event.preventDefault();
      clearQuery();
      return;
    }

    if (event.key === 'Enter') {
      const firstCandidate = getPrimaryCandidate();
      if (!firstCandidate) {
        return;
      }

      event.preventDefault();
      if (state.contentView === CONTENT_VIEWS.OPEN) {
        void activateExistingTab(firstCandidate.id, firstCandidate.windowId);
        return;
      }

      if (firstCandidate.isOpen && typeof firstCandidate.currentTabId === 'number' && typeof firstCandidate.windowId === 'number') {
        void activateExistingTab(firstCandidate.currentTabId, firstCandidate.windowId);
        return;
      }

      void openSavedLaterItem(firstCandidate);
    }
  });

  elements.clearSearch.addEventListener('click', () => {
    clearQuery();
  });

  const refreshListeners = [
    chrome.tabs.onCreated,
    chrome.tabs.onRemoved,
    chrome.tabs.onMoved,
    chrome.tabs.onAttached,
    chrome.tabs.onDetached,
    chrome.tabs.onUpdated,
    chrome.tabs.onActivated,
    chrome.tabs.onReplaced,
    chrome.windows.onFocusChanged
  ];

  for (const listener of refreshListeners) {
    listener.addListener(() => {
      scheduleRefresh();
    });
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') {
      return;
    }

    if (changes[ACTIVITY_STORAGE_KEY]) {
      state.tabActivity = normalizeActivityStore(changes[ACTIVITY_STORAGE_KEY].newValue);
    }

    if (changes[SEE_IT_LATER_STORAGE_KEY]) {
      state.seeItLater = normalizeSeeItLaterStore(changes[SEE_IT_LATER_STORAGE_KEY].newValue);
    }

    if (changes[TRENDS_STORAGE_KEY]) {
      state.trends = normalizeTrendsStore(changes[TRENDS_STORAGE_KEY].newValue);
    }

    if (changes[PREFERENCES_STORAGE_KEY]) {
      state.preferences = normalizePreferences(changes[PREFERENCES_STORAGE_KEY].newValue);
      state.openGroupView = state.preferences.openGroupView;
      state.groupSort = state.preferences.groupSort;
      state.groupSortDirections = state.preferences.groupSortDirections;
    }

    render();
  });
}

function clearQuery() {
  state.query = '';
  elements.searchInput.value = '';
  render();
  focusSearchInput({
    force: true
  });
}

function scheduleSearchInputFocus() {
  clearScheduledSearchFocus();

  for (const delay of SEARCH_FOCUS_RETRY_MS) {
    const timer = window.setTimeout(() => {
      focusSearchInput();
    }, delay);
    searchFocusTimers.push(timer);
  }
}

function clearScheduledSearchFocus() {
  for (const timer of searchFocusTimers) {
    clearTimeout(timer);
  }

  searchFocusTimers = [];
}

function focusSearchInput(options = {}) {
  if (!shouldFocusSearchInput(options)) {
    return false;
  }

  try {
    elements.searchInput.focus({
      preventScroll: true
    });
  } catch {
    elements.searchInput.focus();
  }

  if (document.activeElement !== elements.searchInput) {
    return false;
  }

  const selectionEnd = elements.searchInput.value.length;
  if (typeof elements.searchInput.setSelectionRange === 'function') {
    elements.searchInput.setSelectionRange(selectionEnd, selectionEnd);
  }

  return true;
}

function shouldFocusSearchInput({ force = false } = {}) {
  if (document.visibilityState !== 'visible') {
    return false;
  }

  const activeElement = document.activeElement;
  if (activeElement === elements.searchInput) {
    return false;
  }

  if (force) {
    return true;
  }

  if (!activeElement || activeElement === document.body || activeElement === document.documentElement) {
    return true;
  }

  return !isInteractiveElement(activeElement);
}

function isInteractiveElement(element) {
  return element.matches(
    'input, button, select, textarea, a[href], [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
  );
}

function getPrimaryCandidate() {
  if (state.contentView === CONTENT_VIEWS.TRENDS) {
    return null;
  }

  if (state.contentView === CONTENT_VIEWS.LATER) {
    return state.laterGroups[0]?.items?.[0] ?? null;
  }

  return state.snapshot?.profiles?.[0]?.groups?.[0]?.tabs?.[0] ?? null;
}

function scheduleRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    void refreshSnapshotInputs();
  }, 80);
}

async function refreshSnapshotInputs() {
  state.error = null;

  try {
    try {
      await chrome.runtime.sendMessage({
        type: 'sync-trends-runtime'
      });
    } catch {
      // Best-effort warmup only.
    }

    const [tabs, stored] = await Promise.all([
      chrome.tabs.query({}),
      chrome.storage.local.get([
        ACTIVITY_STORAGE_KEY,
        SEE_IT_LATER_STORAGE_KEY,
        TRENDS_STORAGE_KEY,
        PREFERENCES_STORAGE_KEY
      ])
    ]);

    state.tabs = tabs.filter((tab) => !isExtensionTab(tab));
    state.tabActivity = normalizeActivityStore(stored[ACTIVITY_STORAGE_KEY]);
    state.seeItLater = normalizeSeeItLaterStore(stored[SEE_IT_LATER_STORAGE_KEY]);
    state.trends = normalizeTrendsStore(stored[TRENDS_STORAGE_KEY]);
    state.preferences = normalizePreferences(stored[PREFERENCES_STORAGE_KEY]);
    state.openGroupView = state.preferences.openGroupView;
    state.groupSort = state.preferences.groupSort;
    state.groupSortDirections = state.preferences.groupSortDirections;
  } catch (error) {
    console.error('Failed to refresh tab snapshot.', error);
    state.error = 'Could not read the current tab list.';
  }

  render();
}

function render() {
  applyTheme();
  renderThemeSwitcher();
  elements.clearSearch.hidden = !state.query;

  if (state.error) {
    elements.results.replaceChildren(
      renderEmptyBlock('Chrome tab access failed', 'Reopen the page or reload the extension and try again.')
    );
    return;
  }

  const snapshot = buildTabSnapshot(state.tabs, state.tabActivity, state.seeItLater, {
    query: state.query,
    profile: state.profile
  });

  state.snapshot = snapshot;
  state.laterGroups = buildTrackedGroups(snapshot.profiles[0].seeItLater);
  elements.results.replaceChildren(
    renderProfile(snapshot.profiles[0], state.laterGroups, state.query, buildTrackedItemIndex(state.seeItLater))
  );
  schedulePackedLayout();
}

function applyTheme() {
  document.documentElement.dataset.theme = state.preferences.themeId;
}

function renderThemeSwitcher() {
  const fragment = document.createDocumentFragment();

  for (const theme of THEMES) {
    const button = document.createElement('button');
    button.className = 'theme-option';
    button.type = 'button';
    button.setAttribute('aria-pressed', String(theme.id === state.preferences.themeId));
    button.setAttribute('aria-label', `Switch theme to ${theme.label}`);
    button.title = `Switch theme to ${theme.label}`;
    button.addEventListener('click', () => {
      void setTheme(theme.id);
    });

    const swatch = document.createElement('span');
    swatch.className = 'theme-swatch';
    swatch.style.setProperty('--swatch', theme.swatch);

    button.append(swatch);
    fragment.append(button);
  }

  elements.themeSwitcher.replaceChildren(fragment);
}

function renderProfile(profile, laterGroups, query, trackedItemsByTabId) {
  const section = document.createElement('section');
  section.className = 'profile-section';

  const header = document.createElement('div');
  header.className = 'profile-header';

  const titleBlock = document.createElement('div');
  titleBlock.className = 'profile-title-block';

  const title = document.createElement('h2');
  title.className = 'profile-title';
  title.textContent = profile.label;

  const detail = document.createElement('p');
  detail.className = 'profile-detail';
  detail.textContent = buildProfileDetail(profile, laterGroups);

  titleBlock.append(title, detail);
  titleBlock.title = profile.description;

  const actionRail = document.createElement('div');
  actionRail.className = 'profile-action-rail';

  const primaryControls = document.createElement('div');
  primaryControls.className = 'profile-primary-controls';

  const controls = document.createElement('div');
  controls.className = 'profile-controls';

  const looseCount = profile.looseWindows.length;
  const gatherLabel = looseCount
    ? `Gather ${looseCount} solo tab${looseCount === 1 ? '' : 's'} into one window`
    : 'Gather solo tabs';

  const gatherButton = createIconButton({
    icon: 'stack',
    label: gatherLabel,
    tone: 'is-primary',
    count: looseCount,
    disabled: looseCount < 2,
    onClick: () => {
      void gatherSoloTabs(profile.looseWindows);
    }
  });

  controls.append(gatherButton);
  primaryControls.append(renderContentTabs(profile, laterGroups));

  if (state.contentView === CONTENT_VIEWS.OPEN) {
    primaryControls.append(renderOpenViewControl());
  }

  if (state.contentView !== CONTENT_VIEWS.TRENDS) {
    primaryControls.append(renderGroupSortControl());
  }

  primaryControls.append(controls);
  actionRail.append(primaryControls);

  header.append(titleBlock, actionRail);
  section.append(header);

  const content =
    state.contentView === CONTENT_VIEWS.OPEN
      ? renderOpenGroups(profile, query, trackedItemsByTabId)
      : state.contentView === CONTENT_VIEWS.TRENDS
        ? renderTrendsView(query)
        : renderLaterGroups(laterGroups, query);

  section.append(content);
  return section;
}

function renderContentTabs(profile, laterGroups) {
  const tabList = document.createElement('div');
  tabList.className = 'content-tabs';
  tabList.setAttribute('role', 'tablist');
  tabList.setAttribute('aria-label', 'Main content view');

  const openCount = profile.groups.reduce((count, group) => count + group.tabs.length, 0);
  const trendCount = countTrendHosts(state.trends);
  const laterCount = laterGroups.reduce((count, group) => count + group.items.length, 0);

  tabList.append(
    createContentTab('Current open tabs', CONTENT_VIEWS.OPEN, openCount),
    createContentTab('Trends', CONTENT_VIEWS.TRENDS, trendCount),
    createContentTab('See it later tabs', CONTENT_VIEWS.LATER, laterCount)
  );

  return tabList;
}

function createContentTab(label, view, count) {
  const button = document.createElement('button');
  button.className = 'content-tab';
  button.type = 'button';
  button.setAttribute('role', 'tab');
  button.setAttribute('aria-selected', String(state.contentView === view));
  button.setAttribute('aria-pressed', String(state.contentView === view));
  button.addEventListener('click', () => {
    if (state.contentView !== view) {
      state.contentView = view;
      render();
    }
  });

  const icon = createIcon(CONTENT_TAB_ICONS[view] ?? 'open');
  icon.classList.add('content-tab-icon');

  const text = document.createElement('span');
  text.className = 'content-tab-label';
  text.textContent = label;

  const badge = document.createElement('span');
  badge.className = 'content-tab-count';
  badge.textContent = String(count);

  button.append(icon, text, badge);
  return button;
}

function renderOpenGroups(profile, query, trackedItemsByTabId) {
  const sourceGroups = state.openGroupView === OPEN_GROUP_VIEWS.WINDOW ? profile.windowGroups : profile.groups;
  const sections = groupTabGroups(sourceGroups, state.groupSort, {
    direction: getCurrentGroupSortDirection()
  });
  if (!sections.length) {
    return renderSectionEmpty(buildOpenGroupEmptyMessage(query));
  }

  return renderGroupedCardSections(sections, (group, index) =>
    renderOpenGroupCard(group, trackedItemsByTabId, index, state.openGroupView)
  );
}

function renderLaterGroups(laterGroups, query) {
  if (!laterGroups.length) {
    const message = query.trim()
      ? `No saved tabs match "${query}".`
      : 'Tabs you mark for later will appear here, grouped by exact hostname.';
    return renderSectionEmpty(message);
  }

  const sections = groupTabGroups(laterGroups, state.groupSort, {
    direction: getCurrentGroupSortDirection(),
    itemsKey: 'items',
    timestampKey: 'lastTouchedAt'
  });

  return renderGroupedCardSections(sections, (group, index) => renderLaterGroupCard(group, index));
}

function renderGroupedCardSections(sections, renderCard) {
  const container = document.createElement('div');
  container.className = 'grouped-card-sections';

  sections.forEach((section) => {
    const sectionElement = document.createElement('section');
    sectionElement.className = `grouped-card-section${section.isPinned ? ' is-pinned-section' : ''}`;

    const heading = document.createElement('header');
    heading.className = 'grouped-card-section-heading';

    const title = document.createElement('div');
    title.className = 'grouped-card-section-title';
    if (section.isPinned) {
      const icon = createIcon('pin');
      icon.classList.add('grouped-card-section-icon');
      title.append(icon);
    }

    const label = document.createElement('h3');
    label.textContent = section.label;
    title.append(label);

    const count = document.createElement('span');
    count.className = 'grouped-card-section-count';
    count.textContent = `${section.groups.length} group${section.groups.length === 1 ? '' : 's'}`;

    heading.append(title, count);

    const grid = document.createElement('div');
    grid.className = 'masonry-grid';
    section.groups.forEach((group, index) => {
      grid.append(renderCard(group, index));
    });

    sectionElement.append(heading, grid);
    container.append(sectionElement);
  });

  return container;
}

function renderTrendsView(query) {
  const panel = document.createElement('section');
  panel.className = 'trends-panel';
  const selectedMetric = TREND_METRICS.find((metric) => metric.id === state.trendMetric) ?? TREND_METRICS[0];
  const weeklyBoards = getWeeklyTrendBoards(state.trends, {
    metricId: state.trendMetric,
    query,
    weekCount: 52,
    includeEmptyWeeks: !query.trim()
  });

  const header = document.createElement('div');
  header.className = 'trends-panel-header';

  const copy = document.createElement('div');
  copy.className = 'trends-panel-copy';

  const title = document.createElement('h3');
  title.className = 'trends-panel-title';
  title.textContent = 'Trends';

  const detail = document.createElement('p');
  detail.className = 'trends-panel-detail';
  detail.textContent = buildTrendsDetail(query);

  copy.append(title, detail);

  const controls = document.createElement('div');
  controls.className = 'trends-panel-controls';
  controls.append(
    renderTrendSwitchGroup('Time window', TREND_WINDOWS, state.trendWindow, (nextWindow) => {
      if (state.trendWindow !== nextWindow) {
        state.trendWindow = nextWindow;
        render();
      }
    }),
    renderTrendSwitchGroup('Metric', TREND_METRICS, state.trendMetric, (nextMetric) => {
      if (state.trendMetric !== nextMetric) {
        state.trendMetric = nextMetric;
        render();
      }
    })
  );

  header.append(copy, controls);
  panel.append(header);

  const leaders = getTrendLeaders(state.trends, {
    metricId: state.trendMetric,
    windowId: state.trendWindow,
    query,
    limit: 10
  });

  if (!leaders.length) {
    panel.append(
      renderSectionEmpty(
        query.trim()
          ? `No tracked domains match "${query}".`
          : 'Trend tracking starts from this version onward. Keep browsing in this Chrome profile and reopen a new tab to see the leaderboard populate.'
      )
    );
  } else {
    const list = document.createElement('div');
    list.className = 'trends-list';

    for (const leader of leaders) {
      list.append(renderTrendRow(leader));
    }

    panel.append(list);
  }

  const note = document.createElement('p');
  note.className = 'trends-note';
  note.textContent =
    'Exact hostnames are ranked with forward-looking local data. Browsing time and playback are best-effort and start collecting after this version is installed.';

  panel.append(note);
  panel.append(renderWeeklyTrendArchive(weeklyBoards, selectedMetric, query));
  panel.append(renderTrendsDebugPanel(leaders));
  return panel;
}

function renderOpenViewControl() {
  const switcher = renderTrendSwitchGroup(
    'Card view',
    [
      {
        id: OPEN_GROUP_VIEWS.DOMAIN,
        label: 'Domain'
      },
      {
        id: OPEN_GROUP_VIEWS.WINDOW,
        label: 'Window'
      }
    ],
    state.openGroupView,
    (nextView) => {
      if (state.openGroupView !== nextView) {
        void setOpenGroupView(nextView);
      }
    }
  );
  switcher.classList.add('is-card-view');
  return switcher;
}

function renderGroupSortControl() {
  const label = document.createElement('label');
  label.className = 'group-sort-control';

  const text = document.createElement('span');
  text.className = 'group-sort-label';
  text.textContent = 'Sort by';

  const select = document.createElement('select');
  select.className = 'group-sort-select';
  select.setAttribute('aria-label', 'Sort cards by');

  for (const option of GROUP_SORT_OPTIONS) {
    const node = document.createElement('option');
    node.value = option.id;
    node.textContent = option.label;
    node.selected = option.id === state.groupSort;
    select.append(node);
  }

  const directionSelect = document.createElement('select');
  directionSelect.className = 'group-sort-direction';
  directionSelect.setAttribute('aria-label', 'Sort direction');
  for (const direction of GROUP_SORT_DIRECTIONS) {
    const node = document.createElement('option');
    node.value = direction.id;
    node.textContent = direction.id === 'asc' ? 'Asc' : 'Desc';
    node.selected = direction.id === getCurrentGroupSortDirection();
    directionSelect.append(node);
  }

  select.addEventListener('change', () => {
    void setGroupSort(select.value);
  });
  directionSelect.addEventListener('change', () => {
    void setGroupSortDirection(directionSelect.value);
  });

  label.append(text, select, directionSelect);
  return label;
}

function getCurrentGroupSortDirection() {
  return state.groupSortDirections?.[state.groupSort] ?? (state.groupSort === 'name' ? 'asc' : 'desc');
}

function buildOpenGroupEmptyMessage(query) {
  if (query.trim()) {
    return state.openGroupView === OPEN_GROUP_VIEWS.WINDOW
      ? `No window cards match "${query}".`
      : `No domain groups match "${query}".`;
  }

  return state.openGroupView === OPEN_GROUP_VIEWS.WINDOW
    ? 'Open tabs will appear here as window cards.'
    : 'Open tabs will appear here as domain cards.';
}

function renderTrendSwitchGroup(label, options, selectedId, onSelect) {
  const group = document.createElement('div');
  group.className = 'trend-switch-group';

  const title = document.createElement('span');
  title.className = 'trend-switch-label';
  title.textContent = label;

  const controls = document.createElement('div');
  controls.className = 'trend-switch-controls';

  for (const option of options) {
    const button = document.createElement('button');
    button.className = 'trend-switch-button';
    button.type = 'button';
    button.setAttribute('aria-pressed', String(selectedId === option.id));
    button.textContent = option.label;
    button.title = `${label}: ${option.label}`;
    button.addEventListener('click', () => {
      onSelect(option.id);
    });
    controls.append(button);
  }

  group.append(title, controls);
  return group;
}

function renderTrendRow(leader) {
  const row = document.createElement('article');
  row.className = 'trend-row';

  const rank = document.createElement('span');
  rank.className = 'trend-rank';
  rank.textContent = String(leader.rank);
  rank.title = `Rank ${leader.rank}`;

  const main = document.createElement('div');
  main.className = 'trend-main';

  const hostRow = document.createElement('div');
  hostRow.className = 'trend-host-row';

  const host = document.createElement('span');
  host.className = 'trend-host';
  setNodeText(host, leader.host, {
    maxLength: 52,
    tailLength: 20
  });

  hostRow.append(
    renderFavicon(leader.faviconUrl, leader.host, '', {
      fallbackPageUrl: buildTrendHostPageUrl(leader.host)
    }),
    host
  );

  const meta = document.createElement('p');
  meta.className = 'trend-meta';
  meta.textContent = buildTrendMetaText(leader);
  meta.title = meta.textContent;

  main.append(hostRow, meta);

  const score = document.createElement('div');
  score.className = 'trend-score';

  const value = document.createElement('span');
  value.className = 'trend-score-value';
  value.textContent = formatTrendMetricValue(state.trendMetric, leader.score);

  const label = document.createElement('span');
  label.className = 'trend-score-label';
  label.textContent = TREND_METRICS.find((metric) => metric.id === state.trendMetric)?.label ?? 'Score';

  score.append(value, label);
  row.append(rank, main, score);
  return row;
}

function renderWeeklyTrendArchive(boards, metric, query) {
  const section = document.createElement('section');
  section.className = 'weekly-trends-section';

  const header = document.createElement('div');
  header.className = 'weekly-trends-header';

  const titleBlock = document.createElement('div');
  titleBlock.className = 'weekly-trends-copy';

  const title = document.createElement('h4');
  title.className = 'weekly-trends-title';
  title.textContent = '52-week archive';

  const detail = document.createElement('p');
  detail.className = 'weekly-trends-detail';
  detail.textContent = query.trim()
    ? `Showing weekly top-10 cards for hostnames matching "${query}" under ${metric.label.toLowerCase()}.`
    : `One card per week. The #1 host sits on top, and ranks 2-10 fill the 3x3 grid below for ${metric.label.toLowerCase()}.`;

  titleBlock.append(title, detail);
  header.append(titleBlock);
  section.append(header);

  if (!boards.length) {
    section.append(renderSectionEmpty('No weekly trend cards match the current search.'));
    return section;
  }

  const grid = document.createElement('div');
  grid.className = 'weekly-trends-grid';

  for (const board of boards) {
    grid.append(renderWeeklyTrendCard(board, metric));
  }

  section.append(grid);
  return section;
}

function renderWeeklyTrendCard(board, metric) {
  const card = document.createElement('article');
  card.className = `weekly-trend-card${board.hasData ? '' : ' is-empty'}`;

  const header = document.createElement('div');
  header.className = 'weekly-trend-card-header';

  const label = document.createElement('h5');
  label.className = 'weekly-trend-card-title';
  label.textContent = board.weekLabel;
  label.title = board.weekLabel;

  const count = document.createElement('span');
  count.className = 'weekly-trend-card-count';
  count.textContent = board.hasData ? `${board.leaders.length}/10` : '0/10';
  count.title = board.hasData ? `${board.leaders.length} ranked hostnames this week` : 'No ranked hostnames this week';

  header.append(label, count);
  card.append(header);

  if (!board.primary) {
    const empty = document.createElement('div');
    empty.className = 'weekly-trend-empty';
    empty.textContent = board.isCurrentWeek
      ? 'No trend data yet for this week.'
      : 'No stored trend data for this week.';
    card.append(empty);
    return card;
  }

  const primary = document.createElement('div');
  primary.className = 'weekly-trend-primary';

  const rank = document.createElement('span');
  rank.className = 'weekly-trend-primary-rank';
  rank.textContent = '#1';

  const favicon = renderFavicon(board.primary.faviconUrl, board.primary.host, 'is-trend-primary', {
    fallbackPageUrl: buildTrendHostPageUrl(board.primary.host),
    size: 64
  });

  const host = document.createElement('span');
  host.className = 'weekly-trend-primary-host';
  setNodeText(host, board.primary.host, {
    maxLength: 30,
    tailLength: 12
  });

  const score = document.createElement('span');
  score.className = 'weekly-trend-primary-score';
  score.textContent = formatTrendMetricValue(metric.id, board.primary.score);
  score.title = `${board.primary.host} • ${score.textContent}`;

  primary.append(rank, favicon, host, score);
  card.append(primary);

  const secondaryGrid = document.createElement('div');
  secondaryGrid.className = 'weekly-trend-secondary-grid';

  for (let slotIndex = 0; slotIndex < 9; slotIndex += 1) {
    const leader = board.secondary[slotIndex] ?? null;
    secondaryGrid.append(renderWeeklyTrendMiniCell(leader, metric, slotIndex + 2));
  }

  card.append(secondaryGrid);
  return card;
}

function renderWeeklyTrendMiniCell(leader, metric, rankNumber) {
  const cell = document.createElement(leader ? 'button' : 'div');
  cell.className = `weekly-trend-mini${leader ? ' is-button' : ''}${leader ? '' : ' is-empty'}`;

  if (!leader) {
    const placeholder = document.createElement('span');
    placeholder.className = 'weekly-trend-mini-rank';
    placeholder.textContent = `#${rankNumber}`;
    cell.append(placeholder);
    return cell;
  }

  const rank = document.createElement('span');
  rank.className = 'weekly-trend-mini-rank';
  rank.textContent = `#${rankNumber}`;

  const favicon = renderFavicon(leader.faviconUrl, leader.host, 'is-trend-mini', {
    fallbackPageUrl: buildTrendHostPageUrl(leader.host),
    size: 32
  });
  const value = formatTrendMetricValue(metric.id, leader.score);
  const tooltip = leader.host;

  cell.type = 'button';
  cell.title = tooltip;
  cell.setAttribute('aria-label', `Open ${leader.host} (${value})`);
  cell.addEventListener('click', () => {
    void openTrendHost(leader.host);
  });
  cell.append(rank, favicon);
  return cell;
}

function renderTrendsDebugPanel(leaders) {
  const payload = buildTrendsDebugPayload(leaders);
  const details = document.createElement('details');
  details.className = 'trends-debug';
  details.open = payload.summary.storedHostCount === 0;

  const summary = document.createElement('summary');
  summary.className = 'trends-debug-summary';

  const summaryCopy = document.createElement('div');
  summaryCopy.className = 'trends-debug-summary-copy';

  const title = document.createElement('span');
  title.className = 'trends-debug-title';
  title.textContent = 'Debug panel';

  const subtitle = document.createElement('span');
  subtitle.className = 'trends-debug-subtitle';
  subtitle.textContent = buildTrendsDebugSummary(payload.summary);

  summaryCopy.append(title, subtitle);
  summary.append(summaryCopy);
  details.append(summary);

  const body = document.createElement('div');
  body.className = 'trends-debug-body';

  const hint = document.createElement('p');
  hint.className = 'trends-debug-hint';
  hint.textContent = buildTrendsDebugHint(payload.summary);

  const actions = document.createElement('div');
  actions.className = 'trends-debug-actions';
  actions.append(
    createIconButton({
      icon: 'copy',
      label: 'Copy trends debug payload',
      tone: 'is-secondary',
      onClick: () => {
        void copyTextToClipboard(JSON.stringify(payload, null, 2));
      }
    })
  );

  const stats = document.createElement('div');
  stats.className = 'trends-debug-stats';

  for (const [label, value] of [
    ['Stored hosts', String(payload.summary.storedHostCount)],
    ['Leaders shown', String(payload.summary.leaderCount)],
    ['Trackable tabs now', String(payload.summary.trackableTabCount)],
    ['Runtime tab states', String(payload.summary.runtimeTabStateCount)],
    ['Active session', payload.summary.activeSessionHost || 'None']
  ]) {
    stats.append(createDebugStat(label, value));
  }

  const storeSection = document.createElement('div');
  storeSection.className = 'trends-debug-section';

  const storeTitle = document.createElement('h4');
  storeTitle.className = 'trends-debug-section-title';
  storeTitle.textContent = 'Current trackable tabs';

  const storeList = document.createElement('div');
  storeList.className = 'trends-debug-list';

  if (!payload.trackableTabs.length) {
    storeList.append(createDebugListItem('No active http/https tabs in the current extension context.'));
  } else {
    for (const tab of payload.trackableTabs) {
      storeList.append(
        createDebugListItem(
          `${tab.host} • tab ${tab.tabId} • window ${tab.windowId} • ${tab.active ? 'active' : 'inactive'}${
            tab.audible ? ' • audible' : ''
          }`
        )
      );
    }
  }

  storeSection.append(storeTitle, storeList);

  const hostsSection = document.createElement('div');
  hostsSection.className = 'trends-debug-section';

  const hostsTitle = document.createElement('h4');
  hostsTitle.className = 'trends-debug-section-title';
  hostsTitle.textContent = 'Stored hosts overview';

  const hostsList = document.createElement('div');
  hostsList.className = 'trends-debug-list';

  if (!payload.hosts.length) {
    hostsList.append(createDebugListItem('No host metrics have been persisted yet.'));
  } else {
    for (const host of payload.hosts) {
      hostsList.append(
        createDebugListItem(
          `${host.host} • ${formatTrendMetricValue('openCount', host.lifetime.openCount)} • ${formatTrendMetricValue(
            'playbackCount',
            host.lifetime.playbackCount
          )} • ${formatTrendMetricValue('browseTimeMs', host.lifetime.browseTimeMs)}${
            host.lastActivityAt ? ` • updated ${formatRelativeTime(host.lastActivityAt)}` : ''
          }`
        )
      );
    }
  }

  hostsSection.append(hostsTitle, hostsList);

  const rawSection = document.createElement('div');
  rawSection.className = 'trends-debug-section';

  const rawTitle = document.createElement('h4');
  rawTitle.className = 'trends-debug-section-title';
  rawTitle.textContent = 'Raw payload';

  const raw = document.createElement('pre');
  raw.className = 'trends-debug-raw';
  raw.textContent = JSON.stringify(payload, null, 2);

  rawSection.append(rawTitle, raw);

  body.append(hint, actions, stats, storeSection, hostsSection, rawSection);
  details.append(body);
  return details;
}

function createDebugStat(label, value) {
  const card = document.createElement('div');
  card.className = 'trends-debug-stat';

  const title = document.createElement('span');
  title.className = 'trends-debug-stat-label';
  title.textContent = label;

  const content = document.createElement('strong');
  content.className = 'trends-debug-stat-value';
  content.textContent = value;
  content.title = value;

  card.append(title, content);
  return card;
}

function createDebugListItem(text) {
  const item = document.createElement('div');
  item.className = 'trends-debug-item';
  item.textContent = text;
  item.title = text;
  return item;
}

function renderOpenGroupCard(group, trackedItemsByTabId, order, view) {
  const card = document.createElement('article');
  card.className = 'group-card';
  card.dataset.cardOrder = String(order);

  const cardStateKey = `open:${view}:${group.key}`;
  const tabListId = `open-card-tabs-${order}`;
  const isExpanded = state.expandedCards.has(cardStateKey);

  const header = document.createElement('header');
  header.className = 'group-card-header';

  const tabList = document.createElement('div');
  tabList.className = 'tab-list';
  tabList.id = tabListId;
  tabList.hidden = !isExpanded;

  header.append(
    renderGroupCardToggle({
      card,
      cardStateKey,
      controlsId: tabListId,
      heading: renderGroupHeading(
        group.label,
        view === OPEN_GROUP_VIEWS.WINDOW ? null : group.faviconUrl,
        buildOpenGroupMetaText(group, view),
        buildGroupFaviconPageUrl(group, view)
      ),
      isExpanded,
      tabList
    }),
    renderOpenGroupActions(group, view)
  );

  for (const tab of group.tabs) {
    tabList.append(
      renderOpenTabRow(tab, trackedItemsByTabId.get(tab.id) ?? null, {
        keepOnly:
          view === OPEN_GROUP_VIEWS.DOMAIN && group.tabs.length > 1
            ? () => closeOtherTabsInGroup(group, tab.id)
            : null,
        groupLabel: group.label
      })
    );
  }

  card.classList.toggle('is-expanded', isExpanded);
  card.append(header, tabList);
  return card;
}

function renderLaterGroupCard(group, order) {
  const card = document.createElement('article');
  card.className = 'group-card is-later-group';
  card.dataset.cardOrder = String(order);

  const cardStateKey = `later:${group.key}`;
  const tabListId = `later-card-tabs-${order}`;
  const isExpanded = state.expandedCards.has(cardStateKey);

  const header = document.createElement('header');
  header.className = 'group-card-header';

  const tabList = document.createElement('div');
  tabList.className = 'tab-list';
  tabList.id = tabListId;
  tabList.hidden = !isExpanded;

  header.append(
    renderGroupCardToggle({
      card,
      cardStateKey,
      controlsId: tabListId,
      heading: renderGroupHeading(
        group.label,
        group.faviconUrl,
        buildLaterGroupMetaText(group),
        group.items[0]?.url ?? ''
      ),
      isExpanded,
      tabList
    }),
    renderLaterGroupStats(group)
  );

  for (const item of group.items) {
    tabList.append(renderLaterItemRow(item));
  }

  card.classList.toggle('is-expanded', isExpanded);
  card.append(header, tabList);
  return card;
}

function renderGroupCardToggle({ card, cardStateKey, controlsId, heading, isExpanded, tabList }) {
  const button = document.createElement('button');
  button.className = 'group-card-toggle';
  button.type = 'button';
  button.setAttribute('aria-expanded', String(isExpanded));
  button.setAttribute('aria-controls', controlsId);
  button.title = isExpanded ? 'Collapse card' : 'Expand card';

  const icon = createIcon('chevron');
  icon.classList.add('group-toggle-icon');
  button.append(heading, icon);

  button.addEventListener('click', () => {
    const nextExpanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(nextExpanded));
    button.title = nextExpanded ? 'Collapse card' : 'Expand card';
    card.classList.toggle('is-expanded', nextExpanded);
    tabList.hidden = !nextExpanded;

    if (nextExpanded) {
      state.expandedCards.add(cardStateKey);
    } else {
      state.expandedCards.delete(cardStateKey);
    }

    schedulePackedLayout();
  });

  return button;
}

function schedulePackedLayout() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame = requestAnimationFrame(() => {
    rebalancePackedGrids();
  });
}

function rebalancePackedGrids() {
  for (const grid of elements.results.querySelectorAll('.masonry-grid')) {
    rebalancePackedGrid(grid);
  }
}

function rebalancePackedGrid(grid) {
  const cards = Array.from(grid.querySelectorAll('.group-card')).sort(
    (left, right) => Number(left.dataset.cardOrder ?? 0) - Number(right.dataset.cardOrder ?? 0)
  );

  if (!cards.length) {
    return;
  }

  const columnCount = getPackedColumnCount(grid.clientWidth);
  grid.style.setProperty('--masonry-columns', String(columnCount));

  if (columnCount <= 1) {
    grid.replaceChildren(...cards);
    return;
  }

  const columns = Array.from({ length: columnCount }, () => {
    const column = document.createElement('div');
    column.className = 'masonry-column';
    return column;
  });

  cards.forEach((card, index) => {
    columns[index % columnCount].append(card);
  });

  grid.replaceChildren(...columns);
}

function getPackedColumnCount(containerWidth) {
  const laneWidth = readCssNumber('--lane-width', 360);
  return Math.max(1, Math.floor((containerWidth + LAYOUT_GAP_PX) / (laneWidth + LAYOUT_GAP_PX)));
}

function readCssNumber(variableName, fallback) {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(variableName));
  return Number.isFinite(value) ? value : fallback;
}

function renderGroupHeading(label, faviconUrl, metaText, faviconPageUrl = '') {
  const heading = document.createElement('span');
  heading.className = 'group-heading';

  const titleRow = document.createElement('span');
  titleRow.className = 'group-title-row';

  const domain = document.createElement('span');
  domain.className = 'group-domain';
  setNodeText(domain, label, {
    maxLength: 54,
    tailLength: 18
  });

  titleRow.append(renderFavicon(faviconUrl, label, '', { fallbackPageUrl: faviconPageUrl }), domain);

  const meta = document.createElement('span');
  meta.className = 'group-meta';
  meta.textContent = metaText;
  meta.title = metaText;

  heading.append(titleRow, meta);
  return heading;
}

function renderOpenGroupActions(group, view) {
  const actions = document.createElement('div');
  actions.className = 'group-actions';

  if (view === OPEN_GROUP_VIEWS.DOMAIN) {
    actions.append(
      createIconButton({
        icon: 'merge',
        label: `Merge ${group.label} into one window`,
        tone: 'is-secondary',
        onClick: () => {
          void mergeGroupToWindow(group);
        }
      })
    );
  }

  actions.append(
    createIconButton({
      icon: 'trash',
      label: `Close all tabs in ${group.label}`,
      tone: 'is-danger',
      onClick: () => {
        void closeTabs(
          group.tabs
            .map((tab) => tab.id)
            .filter((tabId) => typeof tabId === 'number')
        );
      }
    }),
    createIconButton({
      icon: 'open',
      label:
        view === OPEN_GROUP_VIEWS.WINDOW
          ? `Focus ${group.label}`
          : `Switch to the latest ${group.label} tab`,
      tone: 'is-primary',
      onClick: () => {
        const preferredTab = group.tabs.find((tab) => tab.active) ?? group.tabs[0];
        if (preferredTab) {
          void activateExistingTab(preferredTab.id, preferredTab.windowId);
        }
      }
    })
  );

  return actions;
}

function renderLaterGroupStats(group) {
  const stats = document.createElement('div');
  stats.className = 'group-stats';

  const openCount = document.createElement('span');
  openCount.className = 'group-stat-pill';
  openCount.textContent = group.openCount ? `${group.openCount} open` : 'Saved';

  const totalCount = document.createElement('span');
  totalCount.className = 'group-stat-pill';
  totalCount.textContent = `${group.items.length} total`;

  stats.append(openCount, totalCount);
  return stats;
}

function renderOpenTabRow(tab, trackedItem, options = {}) {
  const row = document.createElement('article');
  row.className = `tab-row${tab.active ? ' is-active' : ''}${tab.inactive ? ' is-inactive' : ''}${trackedItem ? ' is-tracked' : ''}`;

  const main = document.createElement('button');
  main.className = 'tab-main';
  main.type = 'button';
  main.addEventListener('click', () => {
    void activateExistingTab(tab.id, tab.windowId);
  });

  main.append(
    createBadge(tab.windowLabel, tab.active ? 'is-active' : 'is-window'),
    createLine('tab-title', tab.title, {
      maxLength: 72,
      tailLength: 18
    }),
    createLine('tab-url', tab.url || tab.displayUrl, {
      maxLength: 84,
      tailLength: 24
    }),
    renderOpenTabMetaLine(tab)
  );

  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  if (typeof options.keepOnly === 'function') {
    actions.append(
      createIconButton({
        icon: 'dedupe',
        label: `Keep only ${tab.title} in ${options.groupLabel}`,
        tone: 'is-secondary',
        onClick: options.keepOnly
      })
    );
  }

  const bookmarkButton = createIconButton({
    icon: 'bookmark',
    label: trackedItem ? `Remove ${tab.title} from See it later` : `Add ${tab.title} to See it later`,
    tone: trackedItem ? 'is-selected' : 'is-secondary',
    pressed: Boolean(trackedItem),
    onClick: () => {
      if (trackedItem) {
        void removeSeeItLaterItem(trackedItem.id);
        return;
      }

      void addTabToSeeItLater(tab);
    }
  });

  const closeButton = createIconButton({
    icon: 'close',
    label: `Close ${tab.title}`,
    tone: 'is-danger',
    onClick: () => {
      void closeTab(tab.id);
    }
  });

  actions.append(bookmarkButton, closeButton);
  row.append(main, actions);
  return row;
}

function renderOpenTabMetaLine(tab) {
  const line = document.createElement('div');
  line.className = 'tab-meta-line';

  if (tab.inactive) {
    const badge = document.createElement('span');
    badge.className = 'tab-status-badge is-inactive';
    badge.textContent = 'Inactive';
    badge.title =
      tab.inactiveReason === 'discarded'
        ? 'Chrome has discarded this tab due to inactivity.'
        : tab.inactiveReason === 'frozen'
          ? 'Chrome has frozen this tab due to inactivity.'
          : 'Chrome has marked this tab inactive.';
    line.append(badge);
  }

  line.append(
    createLine(
      'tab-time',
      tab.lastActivatedAt ? `Last switched ${formatRelativeTime(tab.lastActivatedAt)}` : 'Not switched yet',
      {
        truncate: false
      }
    )
  );

  return line;
}

function renderLaterItemRow(item) {
  const row = document.createElement('article');
  row.className = `tab-row${item.isOpen ? ' is-active is-tracked' : ' is-saved-row'}`;

  const main = document.createElement('button');
  main.className = 'tab-main';
  main.type = 'button';
  main.addEventListener('click', () => {
    if (item.isOpen && typeof item.currentTabId === 'number' && typeof item.windowId === 'number') {
      void activateExistingTab(item.currentTabId, item.windowId);
      return;
    }

    void openSavedLaterItem(item);
  });

  main.append(
    createBadge(item.isOpen ? item.windowLabel : 'Saved', item.isOpen ? 'is-window' : 'is-saved'),
    createLine('tab-title', item.title, {
      maxLength: 72,
      tailLength: 18
    }),
    createLine('tab-url', item.displayUrl, {
      maxLength: 84,
      tailLength: 24
    }),
    createLine(
      'tab-time',
      item.isOpen
        ? item.lastActivatedAt
          ? `Last switched ${formatRelativeTime(item.lastActivatedAt)}`
          : 'Not switched yet'
        : `Saved ${formatRelativeTime(item.updatedAt)}`,
      {
        truncate: false
      }
    )
  );

  const actions = document.createElement('div');
  actions.className = 'tab-actions';

  if (item.isOpen && typeof item.currentTabId === 'number') {
    actions.append(
      createIconButton({
        icon: 'close',
        label: `Close ${item.title}`,
        tone: 'is-danger',
        onClick: () => {
          void closeTab(item.currentTabId);
        }
      })
    );
  } else {
    actions.append(
      createIconButton({
        icon: 'open',
        label: `Open ${item.title}`,
        tone: 'is-primary',
        onClick: () => {
          void openSavedLaterItem(item);
        }
      })
    );
  }

  actions.append(
    createIconButton({
      icon: 'trash',
      label: `Remove ${item.title} from See it later`,
      tone: 'is-secondary',
      onClick: () => {
        void removeSeeItLaterItem(item.savedId);
      }
    })
  );

  row.append(main, actions);
  return row;
}

function createLine(className, fullText, options = {}) {
  const node = document.createElement('span');
  node.className = `tab-line ${className}`;
  setNodeText(node, fullText, options);
  return node;
}

function setNodeText(node, fullText, options = {}) {
  const {
    maxLength = 72,
    tailLength = 18,
    fallback = 'Unavailable',
    truncate = true
  } = options;

  const value = typeof fullText === 'string' && fullText.trim() ? fullText.trim() : fallback;
  node.textContent = truncate ? middleTruncate(value, maxLength, tailLength) : value;
  node.title = value;
}

function createBadge(text, tone) {
  const badge = document.createElement('span');
  badge.className = `window-badge ${tone}`;
  badge.textContent = text;
  badge.title = text;
  return badge;
}

function middleTruncate(value, maxLength = 72, tailLength = 18) {
  if (value.length <= maxLength) {
    return value;
  }

  const safeTailLength = Math.min(tailLength, Math.max(4, Math.floor(maxLength / 2) - 2));
  const headLength = Math.max(8, maxLength - safeTailLength - 1);
  return `${value.slice(0, headLength)}…${value.slice(-safeTailLength)}`;
}

function renderFavicon(faviconUrl, label, variantClass = '', options = {}) {
  const shell = document.createElement('span');
  shell.className = variantClass ? `favicon-shell ${variantClass}` : 'favicon-shell';

  const fallback = document.createElement('span');
  fallback.className = 'favicon-fallback';
  fallback.textContent = (label || '?').slice(0, 1).toUpperCase();

  shell.append(fallback);

  const source = resolveFaviconSource(faviconUrl, options.fallbackPageUrl, options.size);
  if (!source) {
    return shell;
  }

  const cacheEntry = getFaviconCacheEntry(source);
  if (cacheEntry.status === 'error') {
    return shell;
  }

  if (cacheEntry.status === 'loaded') {
    shell.dataset.loaded = 'true';
  } else {
    cacheEntry.shells.add(shell);
  }

  const image = document.createElement('img');
  image.className = 'favicon-image';
  image.alt = '';
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('load', () => {
    settleFaviconCacheEntry(source, 'loaded');
  });
  image.addEventListener('error', () => {
    settleFaviconCacheEntry(source, 'error');
    image.remove();
  });
  image.src = source;

  shell.prepend(image);
  return shell;
}

function resolveFaviconSource(explicitFaviconUrl, fallbackPageUrl, size = 32) {
  if (typeof fallbackPageUrl === 'string' && /^https?:\/\//i.test(fallbackPageUrl.trim())) {
    const safeSize = Number.isFinite(size) ? Math.max(16, Math.round(size)) : 32;
    return `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(fallbackPageUrl.trim())}&size=${safeSize}`;
  }

  if (typeof explicitFaviconUrl === 'string' && explicitFaviconUrl.trim()) {
    return explicitFaviconUrl.trim();
  }

  if (!fallbackPageUrl) {
    return null;
  }

  const safeSize = Number.isFinite(size) ? Math.max(16, Math.round(size)) : 32;
  return `${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(fallbackPageUrl)}&size=${safeSize}`;
}

function getFaviconCacheEntry(source) {
  const existing = faviconLoadCache.get(source);
  if (existing) {
    return existing;
  }

  if (faviconLoadCache.size >= FAVICON_CACHE_LIMIT) {
    for (const [cachedSource, cachedEntry] of faviconLoadCache) {
      if (cachedEntry.status !== 'loading') {
        faviconLoadCache.delete(cachedSource);
        break;
      }
    }
  }

  const entry = {
    status: 'loading',
    shells: new Set()
  };
  faviconLoadCache.set(source, entry);
  return entry;
}

function settleFaviconCacheEntry(source, status) {
  const entry = faviconLoadCache.get(source);
  if (!entry) {
    return;
  }

  entry.status = status;
  for (const shell of entry.shells) {
    if (status === 'loaded') {
      shell.dataset.loaded = 'true';
    } else {
      delete shell.dataset.loaded;
    }
  }
  entry.shells.clear();
}

function buildTrendHostPageUrl(host) {
  if (typeof host !== 'string' || !host.trim()) {
    return '';
  }

  return `https://${host.trim().toLowerCase()}/`;
}

function buildGroupFaviconPageUrl(group, view) {
  if (view === OPEN_GROUP_VIEWS.DOMAIN && typeof group.label === 'string' && group.label.trim()) {
    return buildTrendHostPageUrl(group.label);
  }

  return group.tabs?.find((tab) => /^https?:\/\//i.test(tab.url ?? ''))?.url ?? '';
}

function createIconButton({ icon, label, tone = 'is-secondary', count = null, disabled = false, pressed, onClick }) {
  const button = document.createElement('button');
  button.className = `icon-button ${tone}`;
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;

  if (pressed !== undefined) {
    button.setAttribute('aria-pressed', String(pressed));
  }

  if (count != null) {
    button.classList.add('has-count');
  }

  if (disabled) {
    button.disabled = true;
  }

  if (typeof onClick === 'function') {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(event);
    });
  }

  button.append(createIcon(icon));

  if (count != null) {
    const badge = document.createElement('span');
    badge.className = 'icon-button-count';
    badge.textContent = String(count);
    button.append(badge);
  }

  return button;
}

function renderSectionEmpty(message) {
  const node = document.createElement('div');
  node.className = 'section-empty';

  const detail = document.createElement('p');
  detail.textContent = message;

  node.append(detail);
  return node;
}

function renderEmptyBlock(titleText, message) {
  const block = document.createElement('section');
  block.className = 'empty-state';

  const title = document.createElement('h2');
  title.textContent = titleText;

  const detail = document.createElement('p');
  detail.textContent = message;

  block.append(title, detail);
  return block;
}

async function copyTextToClipboard(value) {
  if (!value) {
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    return;
  } catch {
    const helper = document.createElement('textarea');
    helper.value = value;
    helper.setAttribute('readonly', '');
    helper.style.position = 'fixed';
    helper.style.opacity = '0';
    document.body.append(helper);
    helper.select();
    document.execCommand('copy');
    helper.remove();
  }
}

function buildProfileDetail(profile, laterGroups) {
  const openTabCount = profile.groups.reduce((count, group) => count + group.tabs.length, 0);
  const laterCount = laterGroups.reduce((count, group) => count + group.items.length, 0);

  return `${profile.groups.length} domain group${profile.groups.length === 1 ? '' : 's'} • ${openTabCount} open tab${
    openTabCount === 1 ? '' : 's'
  } • ${laterCount} tracked for later • ${profile.looseWindows.length} solo window${profile.looseWindows.length === 1 ? '' : 's'}`;
}

function buildTrendsDebugPayload(leaders) {
  const trackableTabs = state.tabs
    .map((tab) => {
      const url = tab.url ?? tab.pendingUrl ?? '';
      let host = '';

      try {
        const parsed = new URL(url);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          host = parsed.hostname.toLowerCase();
        }
      } catch {
        host = '';
      }

      if (!host) {
        return null;
      }

      return {
        tabId: tab.id,
        windowId: tab.windowId,
        active: Boolean(tab.active),
        audible: Boolean(tab.audible),
        host,
        title: tab.title || ''
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const activeDifference = Number(right.active) - Number(left.active);
      if (activeDifference !== 0) {
        return activeDifference;
      }

      return left.host.localeCompare(right.host);
    });

  const hosts = Object.entries(state.trends.hosts)
    .map(([host, entry]) => ({
      host,
      lifetime: {
        browseTimeMs: entry.lifetime?.browseTimeMs ?? 0,
        playbackCount: entry.lifetime?.playbackCount ?? 0,
        openCount: entry.lifetime?.openCount ?? 0
      },
      dailyKeys: Object.keys(entry.daily ?? {}).sort(),
      lastActivityAt: entry.lastActivityAt ?? null
    }))
    .sort((left, right) => {
      const scoreDifference =
        (right.lifetime.openCount + right.lifetime.playbackCount + right.lifetime.browseTimeMs) -
        (left.lifetime.openCount + left.lifetime.playbackCount + left.lifetime.browseTimeMs);

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return left.host.localeCompare(right.host);
    });

  return {
    generatedAt: new Date().toISOString(),
    selectedView: state.contentView,
    selectedMetric: state.trendMetric,
    selectedWindow: state.trendWindow,
    query: state.query,
    summary: {
      storedHostCount: hosts.length,
      leaderCount: leaders.length,
      trackableTabCount: trackableTabs.length,
      runtimeTabStateCount: Object.keys(state.trends.runtime?.tabStateById ?? {}).length,
      activeSessionHost: state.trends.runtime?.activeSession?.host ?? null,
      activeSessionTabId: state.trends.runtime?.activeSession?.tabId ?? null,
      activeSessionWindowId: state.trends.runtime?.activeSession?.windowId ?? null
    },
    activeSession: state.trends.runtime?.activeSession ?? null,
    runtimeTabStateById: state.trends.runtime?.tabStateById ?? {},
    trackableTabs,
    leaders: leaders.map((leader) => ({
      rank: leader.rank,
      host: leader.host,
      score: leader.score,
      counts: leader.counts,
      lastActivityAt: leader.lastActivityAt ?? null
    })),
    hosts
  };
}

function buildTrendsDebugSummary(summary) {
  return `${summary.storedHostCount} stored host${summary.storedHostCount === 1 ? '' : 's'} • ${
    summary.trackableTabCount
  } trackable tab${summary.trackableTabCount === 1 ? '' : 's'} • ${
    summary.activeSessionHost ? `active ${summary.activeSessionHost}` : 'no active session'
  }`;
}

function buildTrendsDebugHint(summary) {
  if (!summary.trackableTabCount) {
    return 'No active http/https tabs are visible right now. Trends ignores the extension page itself, chrome:// pages, and other non-web URLs.';
  }

  if (!summary.runtimeTabStateCount) {
    return 'Trackable tabs exist, but the background runtime cache is still empty. Reload the extension page once, or switch to a normal webpage tab and back, so the service worker can sync the current tab set.';
  }

  if (!summary.storedHostCount) {
    return 'Trackable tabs exist, but no trend metrics have been persisted yet. Refresh or navigate a normal webpage to trigger open-count collection, or keep one webpage focused for a bit and then switch away to flush browse time.';
  }

  if (!summary.activeSessionHost) {
    return 'Stored trend data exists, but there is no active focused webpage session right now. Focus a normal webpage tab if you want browse-time collection to continue.';
  }

  return 'The debug payload below shows the current trends store, runtime session, and visible trackable tabs.';
}

function buildTrendsDetail(query) {
  const selectedMetric = TREND_METRICS.find((metric) => metric.id === state.trendMetric) ?? TREND_METRICS[0];
  const selectedWindow = TREND_WINDOWS.find((window) => window.id === state.trendWindow) ?? TREND_WINDOWS[0];
  const hostnameCount = countTrendHosts(state.trends);
  const detail = `Top exact hostnames by ${selectedMetric.label.toLowerCase()} in ${selectedWindow.label.toLowerCase()} • ${hostnameCount} tracked hostname${
    hostnameCount === 1 ? '' : 's'
  }`;

  if (!query.trim()) {
    return detail;
  }

  return `${detail} • Filtering by hostname match for "${query}"`;
}

function buildTrendMetaText(leader) {
  const parts = [
    formatTrendMetricValue('browseTimeMs', leader.counts.browseTimeMs),
    formatTrendMetricValue('playbackCount', leader.counts.playbackCount),
    formatTrendMetricValue('openCount', leader.counts.openCount)
  ];

  if (leader.lastActivityAt) {
    parts.push(`Updated ${formatRelativeTime(leader.lastActivityAt)}`);
  }

  return parts.join(' • ');
}

function buildOpenGroupMetaText(group, view) {
  const baseTime = group.lastActivatedAt ? `Last switched ${formatRelativeTime(group.lastActivatedAt)}` : 'No switch history';

  if (view === OPEN_GROUP_VIEWS.WINDOW) {
    return `${group.tabs.length} tab${group.tabs.length === 1 ? '' : 's'} • ${
      group.domainCount ?? 0
    } domain${group.domainCount === 1 ? '' : 's'} • ${baseTime}`;
  }

  return `${group.tabs.length} tab${group.tabs.length === 1 ? '' : 's'} • ${baseTime}`;
}

function buildLaterGroupMetaText(group) {
  return `${group.items.length} tracked • ${group.openCount ? `${group.openCount} open now` : 'Saved'} • ${
    group.lastTouchedAt ? `Updated ${formatRelativeTime(group.lastTouchedAt)}` : 'Waiting'
  }`;
}

function buildTrackedGroups(seeItLater) {
  const groups = new Map();

  for (const item of [...seeItLater.openItems, ...seeItLater.savedItems]) {
    const label = item.groupLabel || item.host || 'Saved tab';
    const key = item.host ? `tracked:${item.host}` : `tracked:${label.toLowerCase()}`;

    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label,
        faviconUrl: item.favIconUrl ?? null,
        items: [],
        openCount: 0,
        lastTouchedAt: null
      });
    }

    const group = groups.get(key);
    group.items.push(item);
    group.openCount += item.isOpen ? 1 : 0;
    group.lastTouchedAt = maxTimestamp(group.lastTouchedAt, item.isOpen ? item.lastActivatedAt : item.updatedAt);

    if (!group.faviconUrl && item.favIconUrl) {
      group.faviconUrl = item.favIconUrl;
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      items: group.items.sort(compareTrackedItems)
    }))
    .sort(compareTrackedGroups);
}

function buildTrackedItemIndex(seeItLaterStore) {
  return new Map(
    seeItLaterStore.items
      .filter((item) => typeof item.currentTabId === 'number')
      .map((item) => [item.currentTabId, item])
  );
}

function compareTrackedGroups(left, right) {
  return left.label.localeCompare(right.label);
}

function compareTrackedItems(left, right) {
  const openDifference = Number(right.isOpen) - Number(left.isOpen);
  if (openDifference !== 0) {
    return openDifference;
  }

  const timeDifference = (right.lastActivatedAt ?? right.updatedAt ?? 0) - (left.lastActivatedAt ?? left.updatedAt ?? 0);
  if (timeDifference !== 0) {
    return timeDifference;
  }

  return left.title.localeCompare(right.title);
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

function normalizeActivityStore(rawValue) {
  if (!rawValue || typeof rawValue !== 'object' || !rawValue.tabs || typeof rawValue.tabs !== 'object') {
    return {};
  }

  return rawValue.tabs;
}

function isExtensionTab(tab) {
  const tabUrl = tab.url ?? tab.pendingUrl ?? '';
  return typeof tabUrl === 'string' && tabUrl.startsWith(extensionRoot);
}

async function activateExistingTab(tabId, windowId) {
  if (typeof tabId !== 'number' || typeof windowId !== 'number') {
    return;
  }

  try {
    await chrome.tabs.update(tabId, {
      active: true
    });
    await chrome.windows.update(windowId, {
      focused: true
    });
  } catch (error) {
    console.error('Failed to activate existing tab.', error);
  }
}

async function closeTab(tabId) {
  await closeTabs([tabId]);
}

async function closeOtherTabsInGroup(group, keptTabId) {
  await closeTabs(getOtherTabIdsInGroup(group, keptTabId));
}

async function closeTabs(tabIds) {
  const validTabIds = Array.from(
    new Set(tabIds.filter((tabId) => typeof tabId === 'number' && Number.isInteger(tabId)))
  );

  if (!validTabIds.length) {
    return;
  }

  try {
    await chrome.tabs.remove(validTabIds);
  } catch (error) {
    console.error('Failed to close tabs.', error);
  }
}

async function openTrendHost(host) {
  const url = buildTrendHostPageUrl(host);
  if (!url) {
    return;
  }

  try {
    await chrome.tabs.create({
      url,
      active: true
    });
  } catch (error) {
    console.error('Failed to open a trend hostname.', error);
  }
}

async function addTabToSeeItLater(tab) {
  const nextStore = buildSeeItLaterStoreForTab(tab);
  await persistSeeItLaterStore(nextStore);
}

function buildSeeItLaterStoreForTab(tab) {
  const now = Date.now();
  const items = state.seeItLater.items.map((item) => ({ ...item }));
  const existingIndex = items.findIndex((item) => item.currentTabId === tab.id || item.url === tab.url);

  if (existingIndex === -1) {
    items.unshift(createSeeItLaterItem(tab, now));
  } else {
    const existing = items.splice(existingIndex, 1)[0];
    items.unshift({
      ...existing,
      ...createSeeItLaterItem(tab, now),
      id: existing.id,
      createdAt: existing.createdAt,
      updatedAt: now
    });
  }

  return normalizeSeeItLaterStore({
    items
  });
}

async function removeSeeItLaterItem(savedId) {
  const nextStore = normalizeSeeItLaterStore({
    items: state.seeItLater.items.filter((item) => item.id !== savedId)
  });
  await persistSeeItLaterStore(nextStore);
}

async function openSavedLaterItem(item) {
  try {
    const createdTab = await chrome.tabs.create({
      url: item.url,
      active: true
    });

    const nextStore = normalizeSeeItLaterStore({
      items: state.seeItLater.items.map((savedItem) =>
        savedItem.id === item.savedId
          ? {
              ...savedItem,
              currentTabId: createdTab.id ?? null,
              sourceWindowId: createdTab.windowId ?? null,
              updatedAt: Date.now()
            }
          : savedItem
      )
    });

    await persistSeeItLaterStore(nextStore);
  } catch (error) {
    console.error('Failed to reopen a saved tab.', error);
  }
}

async function persistSeeItLaterStore(nextStore) {
  state.seeItLater = nextStore;
  render();

  try {
    await chrome.storage.local.set({
      [SEE_IT_LATER_STORAGE_KEY]: nextStore
    });
  } catch (error) {
    console.error('Failed to persist see-it-later state.', error);
  }
}

async function setTheme(themeId) {
  const nextPreferences = normalizePreferences({
    ...state.preferences,
    themeId
  });
  state.preferences = nextPreferences;
  state.openGroupView = nextPreferences.openGroupView;
  state.groupSort = nextPreferences.groupSort;
  state.groupSortDirections = nextPreferences.groupSortDirections;
  render();

  try {
    await chrome.storage.local.set({
      [PREFERENCES_STORAGE_KEY]: nextPreferences
    });
  } catch (error) {
    console.error('Failed to persist theme.', error);
  }
}

async function setOpenGroupView(openGroupView) {
  const nextPreferences = normalizePreferences({
    ...state.preferences,
    openGroupView
  });
  state.preferences = nextPreferences;
  state.openGroupView = nextPreferences.openGroupView;
  state.groupSort = nextPreferences.groupSort;
  state.groupSortDirections = nextPreferences.groupSortDirections;
  render();

  try {
    await chrome.storage.local.set({
      [PREFERENCES_STORAGE_KEY]: nextPreferences
    });
  } catch (error) {
    console.error('Failed to persist open group view.', error);
  }
}

async function setGroupSort(groupSort) {
  const nextPreferences = normalizePreferences({
    ...state.preferences,
    groupSort
  });
  state.preferences = nextPreferences;
  state.openGroupView = nextPreferences.openGroupView;
  state.groupSort = nextPreferences.groupSort;
  state.groupSortDirections = nextPreferences.groupSortDirections;
  render();

  try {
    await chrome.storage.local.set({
      [PREFERENCES_STORAGE_KEY]: nextPreferences
    });
  } catch (error) {
    console.error('Failed to persist card sorting.', error);
  }
}

async function setGroupSortDirection(direction) {
  const nextPreferences = normalizePreferences({
    ...state.preferences,
    groupSortDirections: {
      ...state.preferences.groupSortDirections,
      [state.groupSort]: direction
    }
  });
  state.preferences = nextPreferences;
  state.openGroupView = nextPreferences.openGroupView;
  state.groupSort = nextPreferences.groupSort;
  state.groupSortDirections = nextPreferences.groupSortDirections;
  render();

  try {
    await chrome.storage.local.set({
      [PREFERENCES_STORAGE_KEY]: nextPreferences
    });
  } catch (error) {
    console.error('Failed to persist card sort direction.', error);
  }
}

async function mergeGroupToWindow(group) {
  const tabs = group.tabs.filter((tab) => typeof tab.id === 'number');
  if (!tabs.length) {
    return;
  }

  try {
    const [firstTab, ...restTabs] = tabs;
    const nextWindow = await chrome.windows.create({
      tabId: firstTab.id,
      focused: true
    });

    for (const tab of restTabs) {
      await chrome.tabs.move(tab.id, {
        windowId: nextWindow.id,
        index: -1
      });
    }

    await chrome.windows.update(nextWindow.id, {
      focused: true
    });
  } catch (error) {
    console.error('Failed to merge a group into a new window.', error);
  }
}

async function gatherSoloTabs(looseWindows) {
  const tabs = looseWindows.flatMap((windowBucket) => windowBucket.tabs);
  if (tabs.length < 2) {
    return;
  }

  try {
    const [firstTab, ...restTabs] = tabs;
    const nextWindow = await chrome.windows.create({
      tabId: firstTab.id,
      focused: true
    });

    for (const tab of restTabs) {
      await chrome.tabs.move(tab.id, {
        windowId: nextWindow.id,
        index: -1
      });
    }

    await chrome.windows.update(nextWindow.id, {
      focused: true
    });
  } catch (error) {
    console.error('Failed to gather solo tabs into one window.', error);
  }
}
