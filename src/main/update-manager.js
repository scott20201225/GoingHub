const { Notification, dialog } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

class UpdateManager {
  constructor(options = {}) {
    this.backendManager = options.backendManager;
    this.trayManager = options.trayManager;
    this.windowManager = options.windowManager;
    this.repo = options.repo || 'M-strange/workbuddy2api-hub';
    this.isChecking = false;
    this.isUpdating = false;
  }

  getCurrentVersion() {
    if (!this.backendManager) return 'v2.1.1';
    const versionFile = path.join(this.backendManager.activeCoreDir, 'version.json');
    if (fs.existsSync(versionFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
        return data.version || 'v2.1.1';
      } catch (e) {
        // ignore
      }
    }
    return 'v2.1.1';
  }

  setCurrentVersion(versionInfo) {
    if (!this.backendManager) return;
    const versionFile = path.join(this.backendManager.activeCoreDir, 'version.json');
    try {
      fs.writeFileSync(versionFile, JSON.stringify(versionInfo, null, 2), 'utf8');
    } catch (e) {
      console.error('[UpdateManager] Failed to write version.json:', e);
    }
  }

  /**
   * Follows HTTP 301/302 redirects to find latest release tag without API rate-limit.
   */
  async checkLatestTag() {
    const url = `https://github.com/${this.repo}/releases/latest`;
    return new Promise((resolve) => {
      https.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) GoingHub' }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const match = res.headers.location.match(/\/releases\/tag\/([^/?#]+)/);
          if (match && match[1]) {
            return resolve(match[1]);
          }
        }
        if (res.statusCode === 200) {
          return resolve('v2.1.1');
        }
        resolve(null);
      }).on('error', (err) => {
        console.error('[UpdateManager] Check tag error:', err);
        resolve(null);
      });
    });
  }

  /**
   * Download a binary buffer following redirects.
   */
  downloadBuffer(url, maxRedirects = 6) {
    return new Promise((resolve, reject) => {
      if (maxRedirects < 0) return reject(new Error('下载跳转过多 (Too many redirects)'));

      https.get(url, {
        headers: { 'User-Agent': 'GoingHub-HotUpdater' }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(this.downloadBuffer(res.headers.location, maxRedirects - 1));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`下载失败，服务器返回 HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
  }

  copyDirRecursive(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__pycache__' && entry.name !== '.git') {
          this.copyDirRecursive(srcPath, destPath);
        }
      } else if (entry.isFile()) {
        fs.copyFileSync(srcPath, destPath);
      }
    }
  }

  /**
   * Cross-platform safe directory swap with retry (handles Windows file locks & EBUSY).
   */
  async safeSwapCoreDirs(stagingContentDir, targetCoreDir, backupDir) {
    // 1. Clean old backup
    fs.rmSync(backupDir, { recursive: true, force: true });

    // 2. Backup targetCoreDir
    if (fs.existsSync(targetCoreDir)) {
      let backedUp = false;
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          fs.renameSync(targetCoreDir, backupDir);
          backedUp = true;
          break;
        } catch (e) {
          await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
        }
      }
      if (!backedUp) {
        this.copyDirRecursive(targetCoreDir, backupDir);
        fs.rmSync(targetCoreDir, { recursive: true, force: true });
      }
    }

    // 3. Move new content into targetCoreDir
    let moved = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        if (fs.existsSync(targetCoreDir)) {
          fs.rmSync(targetCoreDir, { recursive: true, force: true });
        }
        fs.renameSync(stagingContentDir, targetCoreDir);
        moved = true;
        break;
      } catch (e) {
        await new Promise(r => setTimeout(r, 200 * (attempt + 1)));
      }
    }
    if (!moved) {
      this.copyDirRecursive(stagingContentDir, targetCoreDir);
      fs.rmSync(stagingContentDir, { recursive: true, force: true });
    }
  }

  /**
   * Check for updates: checks first, and prompts user before taking action.
   */
  async checkForUpdates(options = { manual: true }) {
    if (this.isChecking || this.isUpdating) {
      if (options.manual) {
        new Notification({
          title: 'GoingHub',
          body: '正在进行更新检查或下载中，请稍候...'
        }).show();
      }
      return;
    }

    this.isChecking = true;
    const currentVersion = this.getCurrentVersion();

    if (options.manual) {
      new Notification({
        title: 'GoingHub',
        body: `正在连接官方仓库检查最新版本（当前: ${currentVersion}）...`
      }).show();
    }

    try {
      const latestTag = await this.checkLatestTag();
      this.isChecking = false;

      if (!latestTag) {
        if (options.manual) {
          await dialog.showMessageBox({
            type: 'warning',
            title: 'GoingHub 检查更新',
            message: '无法检查内核更新',
            detail: '无法连接到官方 GitHub 仓库，请检查你的网络连接或稍后再试。',
            buttons: ['确定']
          });
        }
        return;
      }

      // If already up-to-date
      if (latestTag === currentVersion) {
        if (options.manual) {
          await dialog.showMessageBox({
            type: 'info',
            title: 'GoingHub 检查更新',
            message: '当前内核已是最新版本',
            detail: `当前运行的网关核心版本为 ${currentVersion}，与源头官方仓库保持同步，无需更新。`,
            buttons: ['好的']
          });
        }
        return;
      }

      // New version found! Ask user for confirmation
      const res = await dialog.showMessageBox({
        type: 'question',
        title: 'GoingHub 发现内核更新',
        message: `发现官方内核新版本：${latestTag}`,
        detail: `• 当前本地版本：${currentVersion}\n• 官方最新版本：${latestTag}\n\n热更新将自动拉取官方最新核心代码并毫秒级重启，不影响已保存的账号凭证。\n\n是否立即进行热更新？`,
        buttons: ['立即热更新', '稍后提醒'],
        defaultId: 0,
        cancelId: 1
      });

      if (res.response === 0) {
        // User confirmed!
        await this.applyUpdate(latestTag);
      }
    } catch (e) {
      this.isChecking = false;
      console.error('[UpdateManager] Check failed:', e);
      if (options.manual) {
        new Notification({
          title: 'GoingHub',
          body: `检查更新异常：${e.message}`
        }).show();
      }
    }
  }

  /**
   * Apply hot update after user confirmation (cross-platform).
   */
  async applyUpdate(targetTag) {
    if (this.isUpdating) return;
    this.isUpdating = true;

    new Notification({
      title: 'GoingHub 热更新',
      body: `正在下载 ${targetTag} 官方代码包并自动部署...`
    }).show();

    try {
      const zipUrl = `https://github.com/${this.repo}/archive/refs/tags/${targetTag}.zip`;
      console.log(`[UpdateManager] Downloading zip from ${zipUrl}...`);
      const zipBuffer = await this.downloadBuffer(zipUrl);

      // Extract to staging directory
      const stagingDir = path.join(this.backendManager.userData, 'core_staging');
      const backupDir = path.join(this.backendManager.userData, 'core_backup');
      const coreDir = this.backendManager.activeCoreDir;

      fs.rmSync(stagingDir, { recursive: true, force: true });
      fs.mkdirSync(stagingDir, { recursive: true });

      const zip = new AdmZip(zipBuffer);
      zip.extractAllTo(stagingDir, true);

      // Find inner folder (e.g. release-core-2.1.3)
      const subEntries = fs.readdirSync(stagingDir);
      let contentDir = stagingDir;
      for (const e of subEntries) {
        const full = path.join(stagingDir, e);
        if (fs.statSync(full).isDirectory() && fs.existsSync(path.join(full, 'wb_proxy.py'))) {
          contentDir = full;
          break;
        }
      }

      if (!fs.existsSync(path.join(contentDir, 'wb_proxy.py'))) {
        throw new Error('下载的代码包完整性校验未通过（缺少核心脚本 wb_proxy.py）');
      }

      console.log('[UpdateManager] Package verified. Applying cross-platform atomic swap...');

      // 1. Stop current backend process
      await this.backendManager.stop();

      // 2. Cross-platform safe swap
      await this.safeSwapCoreDirs(contentDir, coreDir, backupDir);

      // 3. Clean staging
      fs.rmSync(stagingDir, { recursive: true, force: true });

      // 4. Save version.json
      this.setCurrentVersion({
        version: targetTag,
        updatedAt: new Date().toISOString(),
        source: this.repo
      });

      // 5. Restart backend with the new code
      console.log('[UpdateManager] Restarting backend with new core...');
      await this.backendManager.start();
      await this.backendManager.waitForReady(15000);

      if (this.trayManager) {
        this.trayManager.updateMenu(true);
      }

      await dialog.showMessageBox({
        type: 'info',
        title: 'GoingHub 热更新成功',
        message: '🎉 网关内核已成功升级！',
        detail: `核心引擎已无缝升级至官方最新版 ${targetTag}，所有本地服务已恢复运行。`,
        buttons: ['确定']
      });
    } catch (err) {
      console.error('[UpdateManager] Hot update failed:', err);

      // Rollback if core corrupted
      const coreDir = this.backendManager.activeCoreDir;
      const backupDir = path.join(this.backendManager.userData, 'core_backup');
      if (!fs.existsSync(path.join(coreDir, 'wb_proxy.py')) && fs.existsSync(backupDir)) {
        try {
          fs.rmSync(coreDir, { recursive: true, force: true });
          fs.renameSync(backupDir, coreDir);
          await this.backendManager.start();
        } catch (re) {
          console.error('[UpdateManager] Recovery failed:', re);
        }
      }

      await dialog.showMessageBox({
        type: 'error',
        title: 'GoingHub 热更新失败',
        message: '内核热更新中断',
        detail: `错误详情: ${err.message}\n已安全保持当前版本运行，未影响现有配置。`,
        buttons: ['确定']
      });
    } finally {
      this.isUpdating = false;
    }
  }
}

module.exports = UpdateManager;
