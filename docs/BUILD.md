# 跨平台构建与发布指南

## 📦 跨平台打包构建

本项目使用 `electron-builder` 进行各平台的标准化构建：

```bash
# 构建当前系统对应的安装包
npm run build

# 构建 macOS 平台 (生成 DMG 与 ZIP)
npm run build:mac
npm run build:mac:arm64 # 针对 Apple Silicon
npm run build:mac:x64   # 针对 Intel
npm run build:mac:universal # 通用双架构包

# 构建 Windows 平台 (生成 NSIS 安装包与 Portable 便携版)
npm run build:win
npm run build:win:x64   # 针对 64 位 x64
npm run build:win:arm64 # 针对 ARM64
npm run build:win:portable

# 构建 Linux 平台 (生成 AppImage 与 deb)
npm run build:linux
npm run build:linux:x64
npm run build:linux:arm64
```

打包生成的文件将保存在 `dist/` 目录下。

---

## 🤖 GitHub Actions CI/CD 多平台自动发版

本项目已配置完整的 GitHub Actions 持续集成流水线（`.github/workflows/release.yml`）：
- 每当向仓库推送版本标签（例如 `v1.0.0`）或在 GitHub 网页手动点击 **Run workflow**；
- 矩阵并行启动原生虚拟机环境；
- 自动编译输出各平台的生产安装包（`.dmg`, `.zip`, `.exe`, `.AppImage`, `.deb`, `.tar.gz`）；
- 自动计算并输出 `SHA256SUMS.txt` 校验和；
- 自动发布到 GitHub Releases 供用户下载。
