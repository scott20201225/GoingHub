const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

class WindowManager {
  constructor(options = {}) {
    this.port = options.port || 8788;
    this.url = `http://127.0.0.1:${this.port}/`;
    this.mainWindow = null;
    this.splashWindow = null;
    this.isQuitting = false;
    this.iconPath = path.join(__dirname, '..', '..', 'assets', 'icon.png');
  }

  createSplash() {
    this.splashWindow = new BrowserWindow({
      width: 420,
      height: 340,
      frame: false,
      transparent: true,
      resizable: false,
      center: true,
      show: true,
      icon: this.iconPath,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', 'preload', 'index.js')
      }
    });

    const splashPath = path.join(__dirname, '..', 'renderer', 'splash.html');
    this.splashWindow.loadFile(splashPath);

    this.splashWindow.on('closed', () => {
      this.splashWindow = null;
    });
  }

  updateSplashStatus(status) {
    if (this.splashWindow && !this.splashWindow.isDestroyed()) {
      this.splashWindow.webContents.send('backend-status', status);
    }
  }

  createMain() {
    this.mainWindow = new BrowserWindow({
      width: 1220,
      height: 840,
      minWidth: 960,
      minHeight: 620,
      title: 'GoingHub',
      icon: this.iconPath,
      backgroundColor: '#0b1120',
      show: false,
      fullscreen: false,
      fullscreenable: false, // Disallow native fullScreen space; green button is zoom/maximize only
      maximizable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, '..', 'preload', 'index.js')
      }
    });

    // Strictly enforce non-fullscreenable state
    this.mainWindow.setFullScreenable(false);

    // Prevent entering fullscreen mode via any shortcuts or web events
    this.mainWindow.on('enter-full-screen', () => {
      this.mainWindow.setFullScreen(false);
      this.mainWindow.setFullScreenable(false);
    });

    if (this.mainWindow.webContents) {
      this.mainWindow.webContents.on('enter-html-full-screen', () => {
        this.mainWindow.setFullScreen(false);
        this.mainWindow.setFullScreenable(false);
      });
    }

    // Handle external links in native system browser
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http:') || url.startsWith('https:')) {
        shell.openExternal(url);
      }
      return { action: 'deny' };
    });

    this.mainWindow.loadURL(this.url);

    this.mainWindow.once('ready-to-show', () => {
      if (this.splashWindow && !this.splashWindow.isDestroyed()) {
        this.splashWindow.close();
      }
      this.mainWindow.setFullScreenable(false);
      this.show();
    });

    // Close button hides window to system tray and hides Dock / taskbar icon safely
    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault();
        this.hide();
      }
    });

    this.mainWindow.on('hide', () => {
      if (process.platform === 'darwin' && app.dock) {
        app.dock.hide();
      }
    });

    this.mainWindow.on('show', () => {
      if (process.platform === 'darwin' && app.dock) {
        app.dock.show();
      }
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });
  }

  async show() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.createMain();
      return;
    }

    if (process.platform === 'darwin' && app.dock) {
      try {
        await app.dock.show();
      } catch (e) {
        // ignore
      }
    }

    if (this.mainWindow.isFullScreen()) {
      this.mainWindow.setFullScreen(false);
    }
    this.mainWindow.setFullScreenable(false);

    if (this.mainWindow.isMinimized()) {
      this.mainWindow.restore();
    }

    this.mainWindow.show();
    this.mainWindow.focus();
    if (process.platform === 'darwin' && app.focus) {
      app.focus({ steal: true });
    }
  }

  hide() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    if (this.mainWindow.isFullScreen()) {
      this.mainWindow.setFullScreen(false);
    }
    this.mainWindow.setFullScreenable(false);
    this.mainWindow.hide();
    if (process.platform === 'darwin' && app.dock) {
      app.dock.hide();
    }
  }

  toggle() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.show();
      return;
    }
    if (this.mainWindow.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  setQuitting(value) {
    this.isQuitting = value;
  }
}

module.exports = WindowManager;
