import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(rootDir, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const newtabHtml = await readFile(path.join(rootDir, 'newtab.html'), 'utf8');
const backgroundJs = await readFile(path.join(rootDir, 'src/background.js'), 'utf8');
const newtabJs = await readFile(path.join(rootDir, 'src/newtab.js'), 'utf8');
const iconsJs = await readFile(path.join(rootDir, 'src/lib/icons.js'), 'utf8');

assert.equal(manifest.manifest_version, 3, 'Expected Manifest V3.');
assert.equal(
  manifest.chrome_url_overrides?.newtab,
  'newtab.html',
  'Expected a chrome_url_overrides.newtab entry.'
);
assert.ok(
  Array.isArray(manifest.permissions) && manifest.permissions.includes('tabs'),
  'Expected the tabs permission.'
);
assert.ok(
  Array.isArray(manifest.permissions) && manifest.permissions.includes('alarms'),
  'Expected the alarms permission for trends timing.'
);
assert.ok(
  Array.isArray(manifest.permissions) && manifest.permissions.includes('storage'),
  'Expected the storage permission.'
);
assert.ok(
  Array.isArray(manifest.permissions) && manifest.permissions.includes('favicon'),
  'Expected the favicon permission for extension favicon fallbacks.'
);
assert.ok(
  Array.isArray(manifest.permissions) && manifest.permissions.includes('scripting'),
  'Expected the scripting permission for local page descriptions.'
);
assert.deepEqual(
  manifest.host_permissions,
  ['http://*/*', 'https://*/*'],
  'Expected HTTP and HTTPS host access for local meta descriptions.'
);
assert.ok(
  Array.isArray(manifest.permissions) && !manifest.permissions.includes('identity'),
  'Expected no identity permission.'
);
assert.ok(
  Array.isArray(manifest.permissions) && !manifest.permissions.includes('identity.email'),
  'Expected no identity.email permission.'
);
assert.equal(
  manifest.background?.service_worker,
  'src/background.js',
  'Expected src/background.js as the service worker.'
);
assert.equal(manifest.icons?.['16'], 'assets/icons/icon16.png', 'Expected a 16px extension icon.');
assert.equal(manifest.icons?.['48'], 'assets/icons/icon48.png', 'Expected a 48px extension icon.');
assert.equal(manifest.icons?.['128'], 'assets/icons/icon128.png', 'Expected a 128px extension icon.');
assert.match(newtabHtml, /id="search-input"/, 'Expected the global search input in newtab.html.');
assert.match(newtabHtml, /id="search-leading"/, 'Expected the leading search icon mount in newtab.html.');
assert.match(newtabHtml, /id="theme-switcher"/, 'Expected the theme switcher mount in newtab.html.');
assert.match(newtabHtml, /id="clear-search"/, 'Expected the search clear control in newtab.html.');
assert.match(newtabHtml, /id="results"/, 'Expected the main results mount in newtab.html.');
assert.match(backgroundJs, /TRENDS_STORAGE_KEY/, 'Expected background trends persistence wiring.');
assert.match(backgroundJs, /chrome\.alarms/, 'Expected background alarm-based trends tracking.');
assert.doesNotMatch(backgroundJs, /chrome\.identity/, 'Expected no Chrome identity API usage.');
assert.match(newtabJs, /CONTENT_VIEWS\.\s*TRENDS/, 'Expected a Trends content view in the new-tab UI.');
assert.match(newtabJs, /getTrendLeaders/, 'Expected Trends leaderboard rendering in the new-tab UI.');
assert.match(newtabJs, /renderGroupSortControl/, 'Expected the persisted card sort control.');
assert.match(newtabJs, /setGroupSortDirection/, 'Expected Asc\/Desc sort direction persistence.');
assert.match(newtabJs, /hydrateTabDescriptions/, 'Expected local webpage description hydration.');
assert.match(newtabJs, /renderGroupedCardSections/, 'Expected visible sort bucket sections.');
assert.match(newtabJs, /expandedCards/, 'Expected compact expandable card state.');
assert.match(newtabJs, /closeOtherTabsInGroup/, 'Expected the keep-only-this-tab action.');
assert.match(newtabJs, /import \{ createIcon \} from '\.\/lib\/icons\.js'/, 'Expected Lucide icon helper wiring.');
assert.match(iconsJs, /Generated .* from Lucide/, 'Expected the generated Lucide icon subset.');
assert.doesNotMatch(newtabJs, /const ICONS\s*=/, 'Expected no hand-authored icon registry in the UI controller.');

for (const relativePath of [
  'README.md',
  'assets/icons/icon16.png',
  'assets/icons/icon48.png',
  'assets/icons/icon128.png',
  'assets/chrome-web-store/promo-440x280.png',
  'newtab.html',
  'src/background.js',
  'src/newtab.js',
  'src/lib/grouping.js',
  'src/lib/icons.js',
  'src/styles.css'
]) {
  await access(path.join(rootDir, relativePath));
}

console.log('Manifest smoke-check passed.');
