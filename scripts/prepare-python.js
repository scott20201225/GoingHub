const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const { execFileSync } = require('child_process');

const TAG = '20261110';
const BASE_URL = `https://github.com/astral-sh/python-build-standalone/releases/download/${TAG}`;

const ASSET_MAP = {
  'darwin-arm64': 'cpython-3.11.18+20261110-aarch64-apple-darwin-install_only_stripped.tar.gz',
  'darwin-x64': 'cpython-3.11.18+20261110-x86_64-apple-darwin-install_only_stripped.tar.gz',
  'win32-x64': 'cpython-3.11.18+20261110-x86_64-pc-windows-msvc-install_only_stripped.tar.gz',
  'win32-arm64': 'cpython-3.11.18+20261110-aarch64-pc-windows-msvc-install_only_stripped.tar.gz',
  'linux-x64': 'cpython-3.11.18+20261110-x86_64-unknown-linux-gnu-install_only_stripped.tar.gz',
  'linux-arm64': 'cpython-3.11.18+20261110-aarch64-unknown-linux-gnu-install_only_stripped.tar.gz'
};

function normalizePlatform(p) {
  if (p === 'mac' || p === 'macos' || p === 'darwin') return 'darwin';
  if (p === 'win' || p === 'windows' || p === 'win32') return 'win32';
  if (p === 'linux') return 'linux';
  return p;
}

function normalizeArch(a) {
  if (a === 'x86_64' || a === 'amd64' || a === 'x64') return 'x64';
  if (a === 'aarch64' || a === 'arm64') return 'arm64';
  return a;
}

const targetPlatform = normalizePlatform(process.argv[2] || process.platform);
const targetArch = normalizeArch(process.argv[3] || process.arch);
const targetKey = `${targetPlatform}-${targetArch}`;

const assetName = ASSET_MAP[targetKey];
if (!assetName) {
  console.error(`[prepare-python] Unsupported platform/arch combo: ${targetKey}`);
  console.error(`Supported targets: ${Object.keys(ASSET_MAP).join(', ')}`);
  process.exit(1);
}

const rootDir = path.resolve(__dirname, '..');
const cacheDir = path.join(rootDir, '.cache', 'python');
const targetPythonDir = path.join(rootDir, 'build-resources', 'python');
const archivePath = path.join(cacheDir, assetName);

fs.mkdirSync(cacheDir, { recursive: true });

async function downloadFile(url, dest) {
  console.log(`[prepare-python] Downloading ${url} ...`);
  const tempDest = `${dest}.tmp`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    await pipeline(res.body, fs.createWriteStream(tempDest));
    fs.renameSync(tempDest, dest);
  } catch (err) {
    try { if (fs.existsSync(tempDest)) fs.unlinkSync(tempDest); } catch (_) {}
    throw err;
  }
}

async function main() {
  console.log(`[prepare-python] Target: ${targetKey} -> ${assetName}`);

  // 1. Download if not cached or empty (< 1MB)
  if (!fs.existsSync(archivePath) || fs.statSync(archivePath).size < 1000000) {
    // If we have test file in /tmp, move it
    const tmpTestFile = '/tmp/test-py.tar.gz';
    if (targetKey === 'darwin-arm64' && fs.existsSync(tmpTestFile) && fs.statSync(tmpTestFile).size > 20000000) {
      console.log(`[prepare-python] Moving pre-downloaded archive from /tmp ...`);
      fs.copyFileSync(tmpTestFile, archivePath);
    } else {
      const downloadUrl = `${BASE_URL}/${encodeURIComponent(assetName)}`;
      await downloadFile(downloadUrl, archivePath);
    }
    console.log(`[prepare-python] Download complete: ${archivePath} (${(fs.statSync(archivePath).size / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    console.log(`[prepare-python] Using cached archive: ${archivePath} (${(fs.statSync(archivePath).size / 1024 / 1024).toFixed(1)} MB)`);
  }

  // 2. Clear previous build-resources/python directory
  if (fs.existsSync(targetPythonDir)) {
    fs.rmSync(targetPythonDir, { recursive: true, force: true });
  }
  const tempExtractDir = path.join(rootDir, 'build-resources', '_temp_python');
  if (fs.existsSync(tempExtractDir)) {
    fs.rmSync(tempExtractDir, { recursive: true, force: true });
  }
  fs.mkdirSync(tempExtractDir, { recursive: true });

  // 3. Extract tarball
  console.log(`[prepare-python] Extracting to ${tempExtractDir} ...`);
  execFileSync('tar', ['-xzf', archivePath, '-C', tempExtractDir], { stdio: 'inherit' });

  // Standalone python tarballs have a top-level "python/" folder
  const extractedPython = path.join(tempExtractDir, 'python');
  if (fs.existsSync(extractedPython)) {
    fs.renameSync(extractedPython, targetPythonDir);
  } else {
    fs.renameSync(tempExtractDir, targetPythonDir);
  }
  if (fs.existsSync(tempExtractDir)) {
    fs.rmSync(tempExtractDir, { recursive: true, force: true });
  }

  // 4. Verify extraction
  const binCheck = targetPlatform === 'win32'
    ? path.join(targetPythonDir, 'python.exe')
    : path.join(targetPythonDir, 'bin', 'python3');

  if (fs.existsSync(binCheck)) {
    if (targetPlatform !== 'win32') {
      try {
        fs.chmodSync(binCheck, 0o755);
      } catch (e) {}
    }
    console.log(`[prepare-python] Successfully staged standalone Python for ${targetKey}: ${binCheck}`);
  } else {
    console.error(`[prepare-python] Warning: Expected executable not found at: ${binCheck}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[prepare-python] Failed:', err);
  process.exit(1);
});
