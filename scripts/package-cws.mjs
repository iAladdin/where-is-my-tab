import { mkdir, mkdtemp, readFile, rm, cp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(rootDir, 'release', 'chrome-web-store');
const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
const version = packageJson.version ?? '0.0.0';
const zipName = `where-is-my-tab-${version}-chrome-web-store.zip`;
const zipPath = path.join(releaseDir, zipName);

await mkdir(releaseDir, {
  recursive: true
});

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'where-is-my-tab-cws-'));
const stageDir = path.join(tempRoot, 'package');

try {
  await mkdir(stageDir, {
    recursive: true
  });

  for (const relativePath of ['manifest.json', 'newtab.html', 'THIRD_PARTY_NOTICES.md']) {
    await cp(path.join(rootDir, relativePath), path.join(stageDir, relativePath));
  }

  await cp(path.join(rootDir, 'src'), path.join(stageDir, 'src'), {
    recursive: true
  });

  await cp(path.join(rootDir, 'assets', 'icons'), path.join(stageDir, 'assets', 'icons'), {
    recursive: true
  });

  await rm(zipPath, {
    force: true
  });

  execFileSync('zip', ['-qr', zipPath, '.'], {
    cwd: stageDir
  });

  console.log(zipPath);
} finally {
  await rm(tempRoot, {
    recursive: true,
    force: true
  });
}
