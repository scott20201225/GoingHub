const { app } = require('electron');
const { spawn, execSync, exec } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

function parseSemver(v) {
  if (!v) return [0, 0, 0];
  const clean = String(v).trim().replace(/^v/, '').split('-');
  const parts = clean[0].split('.').map(n => parseInt(n, 10) || 0);
  while (parts.length < 3) parts.push(0);
  return parts;
}

function isNewer(v1, v2) {
  const p1 = parseSemver(v1);
  const p2 = parseSemver(v2);
  for (let i = 0; i < 3; i++) {
    if (p1[i] > p2[i]) return true;
    if (p1[i] < p2[i]) return false;
  }
  return false;
}

class BackendManager {
  constructor(options = {}) {
    this.port = options.port || 8788;
    this.host = options.host || '127.0.0.1';
    this.childProcess = null;
    this.isManaged = false;

    // Resolve backend directory & user data directory
    this.userData = app.getPath('userData');
    this.accountsDir = path.join(this.userData, 'accounts');
    this.usageDir = path.join(this.userData, 'usage');
    this.activeCoreDir = path.join(this.userData, 'core');

    this.bundledBackendDir = app.isPackaged
      ? path.join(process.resourcesPath, 'backend')
      : path.join(__dirname, '..', '..', 'backend');

    // Ensure core is initialized in user-writable directory for seamless hot updates
    this.ensureCoreInitialized();
    this.backendDir = this.activeCoreDir;
    this.scriptPath = path.join(this.backendDir, 'wb_proxy.py');

    fs.mkdirSync(this.accountsDir, { recursive: true });
    fs.mkdirSync(this.usageDir, { recursive: true });

    this.pythonExecutable = this.detectPythonExecutable();
  }

  getKernelVersion() {
    const versionFile = path.join(this.activeCoreDir, 'version.json');
    if (fs.existsSync(versionFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
        if (data.version) return data.version;
      } catch (e) {}
    }
    const bundledVersionFile = path.join(this.bundledBackendDir, 'version.json');
    if (fs.existsSync(bundledVersionFile)) {
      try {
        const data = JSON.parse(fs.readFileSync(bundledVersionFile, 'utf8'));
        if (data.version) return data.version;
      } catch (e) {}
    }
    return 'v2.1.2';
  }

  ensureCoreInitialized() {
    fs.mkdirSync(this.activeCoreDir, { recursive: true });
    const activeProxy = path.join(this.activeCoreDir, 'wb_proxy.py');
    const versionFile = path.join(this.activeCoreDir, 'version.json');
    const bundledVersionFile = path.join(this.bundledBackendDir, 'version.json');

    let shouldSeed = false;
    if (!fs.existsSync(activeProxy) || !fs.existsSync(versionFile)) {
      shouldSeed = true;
    } else if (fs.existsSync(bundledVersionFile)) {
      try {
        const bundledData = JSON.parse(fs.readFileSync(bundledVersionFile, 'utf8'));
        const activeData = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
        // ONLY upgrade if the bundled version is strictly NEWER than active (e.g. user installed a brand new DMG release)
        // NEVER overwrite if active is newer (e.g. active was hot-updated to a newer version)
        if (bundledData.version && activeData.version && isNewer(bundledData.version, activeData.version)) {
          console.log(`[BackendManager] Bundled baseline (${bundledData.version}) is newer than active (${activeData.version}). Upgrading core...`);
          shouldSeed = true;
        }
      } catch (e) {
        // Keep current active core
      }
    }

    if (shouldSeed) {
      console.log(`[BackendManager] Initializing user core at: ${this.activeCoreDir}`);
      this.copyDirSync(this.bundledBackendDir, this.activeCoreDir);
      if (fs.existsSync(bundledVersionFile)) {
        fs.copyFileSync(bundledVersionFile, versionFile);
      }
    }
  }

  copyDirSync(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    if (!fs.existsSync(src)) return;
    const entries = fs.readdirSync(src, { withFileTypes: true });
    for (const entry of entries) {
      const s = path.join(src, entry.name);
      const d = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__pycache__' && entry.name !== '.git' && entry.name !== 'accounts' && entry.name !== 'usage') {
          this.copyDirSync(s, d);
        }
      } else if (entry.isFile()) {
        fs.copyFileSync(s, d);
      }
    }
  }

  detectPythonExecutable() {
    const isWin = process.platform === 'win32';

    // 1. Check bundled runtime in packaged build (if provided)
    if (app.isPackaged) {
      const bundledPy = isWin
        ? path.join(process.resourcesPath, 'python', 'python.exe')
        : path.join(process.resourcesPath, 'python', 'bin', 'python3');
      if (fs.existsSync(bundledPy)) {
        return bundledPy;
      }
    }

    // 2. Check local portable directory
    const portablePy = isWin
      ? path.join(this.backendDir, 'python', 'python.exe')
      : path.join(this.backendDir, 'python', 'bin', 'python3');
    if (fs.existsSync(portablePy)) {
      return portablePy;
    }

    // 3. System Python detection (macOS / Windows / Linux)
    const candidates = isWin
      ? ['python.exe', 'python3.exe', 'py.exe']
      : [
          'python3',
          '/opt/homebrew/bin/python3',
          '/usr/local/bin/python3',
          '/usr/bin/python3',
          'python'
        ];

    for (const cmd of candidates) {
      try {
        const out = execSync(`"${cmd}" -c "import sys; print(sys.version_info >= (3, 9))"`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 2500
        });
        if (out.trim() === 'True') {
          return cmd;
        }
      } catch (e) {
        // continue
      }
    }

    return isWin ? 'python.exe' : 'python3';
  }

  isPortInUse() {
    try {
      execSync(`"${this.pythonExecutable}" "${this.scriptPath}" --port ${this.port} --probe-only`, {
        stdio: 'ignore',
        timeout: 3000
      });
      return true; // exit code 0: probe found instance already running
    } catch (e) {
      return false; // exit code 3 or error: port is free
    }
  }

  start() {
    if (this.isPortInUse()) {
      console.log(`[BackendManager] Port ${this.port} already running. Attaching to existing instance.`);
      this.isManaged = false;
      return Promise.resolve(false);
    }

    console.log(`[BackendManager] Starting backend: ${this.pythonExecutable} ${this.scriptPath}`);
    console.log(`[BackendManager] Accounts directory: ${this.accountsDir}`);

    const args = [
      this.scriptPath,
      '--port', String(this.port),
      '--accounts-dir', this.accountsDir,
      '--usage-dir', this.usageDir
    ];

    const cleanEnv = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PYTHONNOUSERSITE: '1'
    };
    // Ensure total isolation from any system Python environment variables
    delete cleanEnv.PYTHONPATH;
    delete cleanEnv.PYTHONHOME;

    this.childProcess = spawn(this.pythonExecutable, args, {
      cwd: this.backendDir,
      env: cleanEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.isManaged = true;

    this.childProcess.stdout.on('data', (data) => {
      try {
        process.stdout.write(`[GoingHub Core] ${data}`);
      } catch (_) {}
    });

    this.childProcess.stderr.on('data', (data) => {
      try {
        process.stderr.write(`[GoingHub Core Error] ${data}`);
      } catch (_) {}
    });

    this.childProcess.on('exit', (code, signal) => {
      try {
        console.log(`[BackendManager] Backend process exited (code=${code}, signal=${signal})`);
      } catch (_) {}
      this.childProcess = null;
    });

    return Promise.resolve(true);
  }

  waitForReady(timeoutMs = 15000) {
    const startTime = Date.now();
    const url = `http://${this.host}:${this.port}/`;

    return new Promise((resolve, reject) => {
      const check = () => {
        if (Date.now() - startTime > timeoutMs) {
          return reject(new Error('本地后端服务连接超时，请检查 Python 3 环境是否正常。'));
        }

        const req = http.get(url, (res) => {
          resolve(true);
        });

        req.on('error', () => {
          setTimeout(check, 250);
        });

        req.setTimeout(1200, () => {
          req.destroy();
          setTimeout(check, 250);
        });
      };

      check();
    });
  }

  stop() {
    if (!this.childProcess || !this.isManaged) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      console.log('[BackendManager] Stopping backend process...');
      const pid = this.childProcess.pid;

      if (process.platform === 'win32') {
        exec(`taskkill /pid ${pid} /T /F`, () => {
          this.childProcess = null;
          resolve();
        });
      } else {
        this.childProcess.kill('SIGTERM');
        const timer = setTimeout(() => {
          if (this.childProcess) {
            this.childProcess.kill('SIGKILL');
          }
          this.childProcess = null;
          resolve();
        }, 2000);

        this.childProcess.on('exit', () => {
          clearTimeout(timer);
          this.childProcess = null;
          resolve();
        });
      }
    });
  }
}

module.exports = BackendManager;
