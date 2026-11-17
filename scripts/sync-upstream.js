#!/usr/bin/env node
/**
 * GoingHub Upstream Kernel Synchronizer
 * Upstream target: https://github.com/M-strange/workbuddy2api-hub
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const REPO_OWNER = 'M-strange';
const REPO_NAME = 'workbuddy2api-hub';
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}.git`;

const projectRoot = path.resolve(__dirname, '..');
const targetBackendDir = path.join(projectRoot, 'backend');
const cacheDir = path.join(projectRoot, 'node_modules', '.cache', 'upstream-release');

console.log('[Sync] === GoingHub Upstream Kernel Synchronizer ===');
console.log(`[Sync] Community Upstream: ${REPO_URL}`);

/**
 * Resolves the latest release tag via GitHub HTTP redirect (avoids API rate limit)
 */
function resolveLatestReleaseTagViaHttp() {
  return new Promise((resolve, reject) => {
    const url = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/latest`;
    const req = https.request(url, {
      method: 'HEAD',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GoingHub/2.2.0; +https://github.com/scott20201225/GoingHub)'
      }
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const match = res.headers.location.match(/\/releases\/tag\/([^/?#]+)/);
        if (match && match[1]) {
          return resolve(match[1]);
        }
      }
      reject(new Error(`Failed to resolve latest release tag via HTTP (HTTP status: ${res.statusCode})`));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => {
      req.destroy();
      reject(new Error('Timeout resolving latest release tag via HTTP'));
    });
    req.end();
  });
}

/**
 * Fallback to git ls-remote to find the newest tag
 */
function resolveLatestTagViaGit() {
  try {
    const output = execSync(`git ls-remote --tags --refs ${REPO_URL}`, {
      encoding: 'utf8',
      timeout: 15000,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const tags = [];
    const lines = output.trim().split('\n');
    for (const line of lines) {
      const match = line.match(/refs\/tags\/(v[0-9]+(?:\.[0-9]+)+)/);
      if (match && match[1]) {
        tags.push(match[1]);
      }
    }
    if (tags.length === 0) return null;
    tags.sort((a, b) => {
      const pa = a.replace(/^v/, '').split('.').map(Number);
      const pb = b.replace(/^v/, '').split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const na = pa[i] || 0;
        const nb = pb[i] || 0;
        if (na !== nb) return na - nb;
      }
      return 0;
    });
    return tags[tags.length - 1];
  } catch (e) {
    return null;
  }
}

async function getLatestReleaseTag() {
  try {
    const tag = await resolveLatestReleaseTagViaHttp();
    if (tag) return tag;
  } catch (err) {
    console.warn(`[Sync] HTTP tag resolution warning: ${err.message}. Trying git ls-remote...`);
  }

  const gitTag = resolveLatestTagViaGit();
  if (gitTag) return gitTag;

  throw new Error(`无法连接上游仓库 ${REPO_URL} 解析最新版本！`);
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__pycache__' && entry.name !== '.git') {
        copyDirRecursive(s, d);
      }
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

async function main() {
  let latestTag;
  try {
    console.log('[Sync] 正在检测社区上游最新 release 标签...');
    latestTag = await getLatestReleaseTag();
    console.log(`[Sync] 社区上游最新 release 标签为: ${latestTag}`);
  } catch (err) {
    console.warn(`[Sync] ⚠️ 检测失败: ${err.message}`);
    // Check if local backend exists
    const versionFile = path.join(targetBackendDir, 'version.json');
    if (fs.existsSync(versionFile)) {
      console.log('[Sync] 本地已有内置后端内核，构建继续。');
      return;
    }
    process.exit(1);
  }

  // Support lightweight check mode for auto-sync cron workflows
  if (process.argv.includes('--check-only')) {
    const versionFile = path.join(targetBackendDir, 'version.json');
    let currentVersion = null;
    if (fs.existsSync(versionFile)) {
      try {
        currentVersion = JSON.parse(fs.readFileSync(versionFile, 'utf8')).version;
      } catch (e) {}
    }
    const hasUpdate = (currentVersion !== latestTag);
    console.log(`[Sync] Integrated kernel: ${currentVersion || 'none'}`);
    console.log(`[Sync] Community upstream: ${latestTag}`);
    console.log(`[Sync] Has new release:    ${hasUpdate}`);
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_update=${hasUpdate}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `latest_tag=${latestTag}\n`);
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `current_version=${currentVersion || ''}\n`);
    }
    return;
  }

  // Fetch release files into cache directory
  fs.mkdirSync(path.dirname(cacheDir), { recursive: true });
  let fetchSuccess = false;

  console.log(`[Sync] 正在拉取上游 release [${latestTag}] 源码...`);
  try {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    execSync(`git clone --depth 1 --branch ${latestTag} ${REPO_URL} "${cacheDir}"`, {
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 60000
    });
    fetchSuccess = true;
  } catch (gitErr) {
    console.warn(`[Sync] git clone 失败 (${gitErr.message})，尝试直接下载 release zip 兜底...`);
    try {
      const zipUrl = `https://codeload.github.com/${REPO_OWNER}/${REPO_NAME}/zip/refs/tags/${latestTag}`;
      const AdmZip = require('adm-zip');
      const tempZipPath = path.join(projectRoot, 'node_modules', '.cache', `upstream-${latestTag}.zip`);

      await new Promise((resolve, reject) => {
        const fileStream = fs.createWriteStream(tempZipPath);
        https.get(zipUrl, (res) => {
          if (res.statusCode !== 200) {
            return reject(new Error(`下载 release zip 失败，HTTP ${res.statusCode}`));
          }
          res.pipe(fileStream);
          fileStream.on('finish', () => {
            fileStream.close();
            resolve();
          });
        }).on('error', reject);
      });

      const zip = new AdmZip(tempZipPath);
      zip.extractAllTo(path.dirname(cacheDir), true);
      const extractedRoot = path.join(path.dirname(cacheDir), `${REPO_NAME}-${latestTag.replace(/^v/, '')}`);
      if (fs.existsSync(extractedRoot)) {
        fs.renameSync(extractedRoot, cacheDir);
        fetchSuccess = true;
      }
      fs.rmSync(tempZipPath, { force: true });
    } catch (zipErr) {
      console.error(`[Sync] zipball 下载亦失败: ${zipErr.message}`);
    }
  }

  if (!fetchSuccess) {
    console.warn('[Sync] ⚠️ 未能成功拉取最新代码，使用本地当前内置内核。');
    return;
  }

  // Synchronize files to backend/
  console.log('[Sync] 正在将最新代码同步至 backend/ 目录...');
  copyDirRecursive(cacheDir, targetBackendDir);

  // Write version.json
  const versionInfo = {
    version: latestTag,
    synced_at: new Date().toISOString(),
    upstream: REPO_URL,
    tag: latestTag
  };
  fs.writeFileSync(
    path.join(targetBackendDir, 'version.json'),
    JSON.stringify(versionInfo, null, 2) + '\n',
    'utf8'
  );

  console.log(`[Sync] ✅ 上游内核代码同步完成，当前内核版本: ${latestTag}`);
}

main().catch(err => {
  console.error('[Sync] 发生未处理异常:', err);
  process.exit(1);
});
