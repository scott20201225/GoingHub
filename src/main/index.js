const { app, dialog } = require('electron');

// Suppress EIO / EPIPE crashes when GUI app is running without an attached terminal
if (process.stdout && process.stdout.on) {
  process.stdout.on('error', (err) => {
    if (err && (err.code === 'EIO' || err.code === 'EPIPE')) return;
  });
}
if (process.stderr && process.stderr.on) {
  process.stderr.on('error', (err) => {
    if (err && (err.code === 'EIO' || err.code === 'EPIPE')) return;
  });
}
process.on('uncaughtException', (err) => {
  if (err && (err.code === 'EIO' || err.code === 'EPIPE')) return;
  try {
    console.error('[UncaughtException]', err);
  } catch (_) {}
});

const BackendManager = require('./backend-manager');
const WindowManager = require('./window-manager');
const TrayManager = require('./tray-manager');
const UpdateManager = require('./update-manager');

// Enforce single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  const PORT = 8788;
  const backendManager = new BackendManager({ port: PORT });
  const windowManager = new WindowManager({ port: PORT });
  const updateManager = new UpdateManager({
    backendManager,
    windowManager
  });
  const trayManager = new TrayManager({
    port: PORT,
    windowManager,
    backendManager,
    updateManager
  });
  updateManager.trayManager = trayManager;

  app.on('second-instance', () => {
    // When someone tries to run a second instance, focus our main window
    windowManager.show();
  });

  app.whenReady().then(async () => {
    // 1. Show splash window
    windowManager.createSplash();
    windowManager.updateSplashStatus('正在检测与启动本地网关...');

    // 2. Setup tray
    trayManager.setup();

    // 3. Start backend process
    try {
      await backendManager.start();
      windowManager.updateSplashStatus('正在等待后端服务就绪...');
      await backendManager.waitForReady(15000);

      // 4. Backend is ready, open main window
      windowManager.createMain();
      trayManager.updateMenu(true);

      // 5. Check for core updates silently on startup (after 3.5 seconds)
      setTimeout(() => {
        updateManager.checkForUpdates({ manual: false });
      }, 3500);
    } catch (err) {
      console.error('[Main] Startup failure:', err);
      dialog.showErrorBox(
        'GoingHub 启动失败',
        `无法启动本地代理网关服务：\n${err.message}\n\n请确认已安装 Python 3.9+ 环境。`
      );
      app.quit();
    }
  });

  app.on('activate', () => {
    windowManager.show();
  });

  app.on('window-all-closed', () => {
    // On macOS, Windows, Linux, keep running in tray unless explicit quit
    // No-op: service keeps running in background
  });

  app.on('before-quit', async (e) => {
    windowManager.setQuitting(true);
    await backendManager.stop();
  });
}
