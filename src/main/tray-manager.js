const { app, Tray, Menu, clipboard, Notification, shell, nativeImage, nativeTheme, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

class TrayManager {
  constructor(options = {}) {
    this.port = options.port || 8788;
    this.windowManager = options.windowManager;
    this.backendManager = options.backendManager;
    this.updateManager = options.updateManager || null;
    this.tray = null;
    this.apiUrl = `http://127.0.0.1:${this.port}/v1`;
    this.webUrl = `http://127.0.0.1:${this.port}/`;

    this.assetsDir = path.join(__dirname, '..', '..', 'assets');
    this.menuAssetsDir = path.join(this.assetsDir, 'menu');
    this.isMac = process.platform === 'darwin';
    this.trayIconPath = path.join(this.assetsDir, 'tray-icon.svg');
    this._menuIconCache = {};
    this.lastIsRunning = true;
  }

  getTrayIcon() {
    const isDark = nativeTheme.shouldUseDarkColors;
    const iconColor = isDark ? '#ffffff' : '#333333';
    const svgPath = path.join(this.assetsDir, 'tray-icon.svg');
    if (fs.existsSync(svgPath)) {
      try {
        const { Resvg } = require('@resvg/resvg-js');
        const svg = fs.readFileSync(svgPath, 'utf8');
        // Adapt theme across macOS, Windows, Linux: white in dark mode, dark grey in light mode
        const themedSvg = svg.replace(/black/g, iconColor);
        const resvg = new Resvg(themedSvg, { fitTo: { mode: 'width', value: 44 } });
        const pngBuffer = resvg.render().asPng();
        const img = nativeImage.createFromBuffer(pngBuffer, { scaleFactor: 2.0 });
        if (this.isMac) {
          img.setTemplateImage(true);
        }
        return img;
      } catch (e) {
        console.error('Failed to render tray-icon.svg:', e);
      }
    }
    const fallbackPath = path.join(this.assetsDir, this.isMac ? 'tray-iconTemplate.png' : 'tray-icon.png');
    if (fs.existsSync(fallbackPath)) {
      const img = nativeImage.createFromPath(fallbackPath);
      if (this.isMac) {
        img.setTemplateImage(true);
      }
      return img;
    }
    return nativeImage.createEmpty();
  }

  getMenuIcon(name) {
    const isDark = nativeTheme.shouldUseDarkColors;
    const cacheKey = `${name}_${isDark ? 'dark' : 'light'}`;
    if (this._menuIconCache[cacheKey]) {
      return this._menuIconCache[cacheKey];
    }

    const svgPath = path.join(this.menuAssetsDir, `${name}.svg`);
    if (fs.existsSync(svgPath)) {
      try {
        const { Resvg } = require('@resvg/resvg-js');
        const svg = fs.readFileSync(svgPath, 'utf8');
        const iconColor = isDark ? '#ffffff' : '#333333';
        const themedSvg = svg.replace(/black/g, iconColor);
        // Reduced by 1/3 from 44px to 30px buffer (15x15 pt logical) to align with menu font baseline
        const resvg = new Resvg(themedSvg, { fitTo: { mode: 'width', value: 30 } });
        const pngBuffer = resvg.render().asPng();
        const img = nativeImage.createFromBuffer(pngBuffer, { scaleFactor: 2.0 });
        if (this.isMac) {
          img.setTemplateImage(true);
        }
        this._menuIconCache[cacheKey] = img;
        return img;
      } catch (e) {
        console.error(`Failed to render menu svg ${name}.svg:`, e);
      }
    }

    const iconFileName = this.isMac ? `${name}Template.png` : `${name}.png`;
    const fullPath = path.join(this.menuAssetsDir, iconFileName);
    if (fs.existsSync(fullPath)) {
      const img = nativeImage.createFromPath(fullPath);
      if (this.isMac) {
        img.setTemplateImage(true);
      }
      this._menuIconCache[cacheKey] = img;
      return img;
    }
    return null;
  }

  setup() {
    const trayImage = this.getTrayIcon();
    this.tray = new Tray(trayImage);
    this.tray.setToolTip('GoingHub - Multi-Protocol AI Gateway');

    this.updateMenu(true);

    this.tray.on('double-click', () => {
      this.windowManager.toggle();
    });

    // Re-render tray icon and menu icons dynamically when system appearance changes
    nativeTheme.on('updated', () => {
      if (this.tray) {
        this.tray.setImage(this.getTrayIcon());
        this._menuIconCache = {};
        this.updateMenu(this.lastIsRunning);
      }
    });
  }

  updateMenu(isRunning = true) {
    this.lastIsRunning = isRunning;
    const statusText = isRunning ? `● 服务运行中 (端口: ${this.port})` : '○ 服务未运行';
    const kernelVer = this.backendManager ? this.backendManager.getKernelVersion() : 'v2.2.0';
    const versionLabel = `GoingHub  v${app.getVersion()} (内核 ${kernelVer})`;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: versionLabel,
        enabled: false
      },
      {
        label: statusText,
        enabled: false
      },
      { type: 'separator' },
      {
        label: '打开控制面板',
        icon: this.getMenuIcon('dashboard'),
        click: () => {
          this.windowManager.show();
        }
      },
      {
        label: '复制 API 基础地址 (/v1)',
        icon: this.getMenuIcon('copy'),
        click: () => {
          clipboard.writeText(this.apiUrl);
          new Notification({
            title: 'GoingHub',
            body: `已复制 API 接口地址: ${this.apiUrl}\n(支持 OpenAI / Responses / Claude Messages 等多协议)`
          }).show();
        }
      },
      {
        label: '在默认浏览器中打开',
        icon: this.getMenuIcon('browser'),
        click: () => {
          shell.openExternal(this.webUrl);
        }
      },
      {
        label: '打开凭证数据目录 (accounts)',
        icon: this.getMenuIcon('folder'),
        click: () => {
          if (this.backendManager && this.backendManager.accountsDir) {
            shell.openPath(this.backendManager.accountsDir);
          }
        }
      },
      { type: 'separator' },
      {
        label: '重启网关服务',
        icon: this.getMenuIcon('restart'),
        click: async () => {
          new Notification({
            title: 'GoingHub',
            body: '正在重启后端网关服务...'
          }).show();
          await this.backendManager.stop();
          await this.backendManager.start();
          await this.backendManager.waitForReady();
          this.updateMenu(true);
          new Notification({
            title: 'GoingHub',
            body: '网关服务重启成功！'
          }).show();
        }
      },
      {
        label: '检查内核更新',
        icon: this.getMenuIcon('update'),
        click: () => {
          if (this.updateManager) {
            this.updateManager.checkForUpdates({ manual: true });
          }
        }
      },
      {
        label: '开机自动启动',
        icon: this.getMenuIcon(app.getLoginItemSettings().openAtLogin ? 'checkbox-checked' : 'checkbox-unchecked'),
        click: () => {
          const current = app.getLoginItemSettings().openAtLogin;
          app.setLoginItemSettings({ openAtLogin: !current });
          this.updateMenu(this.lastIsRunning);
        }
      },
      {
        label: '关于 GoingHub (About)',
        icon: this.getMenuIcon('about'),
        click: () => {
          this.showAboutDialog();
        }
      },
      { type: 'separator' },
      {
        label: '退出 GoingHub',
        icon: this.getMenuIcon('quit'),
        click: () => {
          this.windowManager.setQuitting(true);
          app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);

    if (process.platform === 'darwin' && app.setAboutPanelOptions) {
      app.setAboutPanelOptions({
        applicationName: 'GoingHub',
        applicationVersion: `v${app.getVersion()}`,
        version: `Kernel: ${kernelVer}`,
        copyright: 'MIT License',
        credits: 'Multi-Protocol AI Gateway Desktop Client (macOS, Windows & Linux)\n\n免责声明 (Disclaimer):\n本项目仅用于协议学习与个人开发测试，不提供任何商业服务或可用性担保。因使用非官方客户端产生的账号风控、限制或封禁由使用者自行承担，请优先使用官方客户端。'
      });
    }
  }

  showAboutDialog() {
    const appVer = app.getVersion();
    const kernelVer = this.backendManager ? this.backendManager.getKernelVersion() : 'v2.2.0';
    const detailText = [
      '【关于本客户端 / About GoingHub】',
      '• 客户端定位：本软件是开箱即用的跨平台多协议大模型网关客户端。',
      '  全面支持 OpenAI Chat Completions、OpenAI Responses（Codex CLI）、Anthropic Claude Messages（Claude Code）以及多模态图像/视频生成等多种主流 API 协议格式。',
      '  (This is a multi-protocol AI gateway desktop client. It supports OpenAI Chat Completions, OpenAI Responses for Codex CLI, Anthropic Claude Messages for Claude Code, and Image/Video Generation APIs.)',
      '',
      `• 当前版本：客户端 v${appVer} | 内置内核 ${kernelVer}`,
      `  (Current Versions: Client v${appVer} | Bundled Kernel ${kernelVer})`,
      '',
      '• ⚠️ 免责声明 (Disclaimer)：',
      '  本项目仅用于协议学习与个人开发测试，不提供任何商业服务或可用性担保。因使用非官方客户端产生的账号风控、限制或封禁由使用者自行承担，请优先使用官方客户端。',
      '  (This project is intended solely for protocol study and personal development/testing, without any commercial service or availability warranty. Any account risk control, restriction, or ban resulting from using unofficial clients is entirely the user\'s responsibility. Please prioritize using official clients.)',
      '',
      '• 开源协议 (License)：MIT License',
      '• 客户端 GitHub 仓库：https://github.com/scott20201225/GoingHub'
    ].join('\n');

    dialog.showMessageBox({
      type: 'info',
      title: '关于 GoingHub / About GoingHub',
      message: `GoingHub v${appVer} (内核 ${kernelVer})`,
      detail: detailText,
      buttons: ['确定 (OK)', '访问 GitHub 仓库 (GitHub Repo)'],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then(({ response }) => {
      if (response === 1) {
        shell.openExternal('https://github.com/scott20201225/GoingHub');
      }
    });
  }
}

module.exports = TrayManager;
