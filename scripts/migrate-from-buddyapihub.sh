#!/usr/bin/env bash
# ==============================================================================
# BuddyApiHub -> GoingHub 数据一键全量迁移脚本 (macOS)
# ==============================================================================
set -e

SOURCE_DIR="$HOME/Library/Application Support/BuddyApiHub"
TARGET_DIR="$HOME/Library/Application Support/GoingHub"

echo "=================================================="
echo "🚀 开始将 BuddyApiHub 数据全量迁移至 GoingHub..."
echo "=================================================="

# 1. 检查源目录是否存在
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ 错误: 未找到源数据目录: $SOURCE_DIR"
    echo "请确认是否曾在当前 Mac 用户下运行过 BuddyApiHub。"
    exit 1
fi

# 2. 检查并退出运行中的进程，避免数据库或文件锁冲突
if pgrep -fi "BuddyApiHub" >/dev/null 2>&1; then
    echo "⚠️ 检测到 BuddyApiHub 正在运行，正在安全退出以保证数据完整..."
    pkill -fi "BuddyApiHub" || true
    sleep 1
fi

if pgrep -fi "GoingHub" >/dev/null 2>&1; then
    echo "⚠️ 检测到 GoingHub 正在运行，正在安全退出以便写入新数据..."
    pkill -fi "GoingHub" || true
    sleep 1
fi

# 3. 创建目标目录并全量同步
mkdir -p "$TARGET_DIR"

echo "📦 正在复制全部账号凭证、配置、模型映射与使用量数据..."
rsync -av --exclude="Singleton*" --exclude="*journal" "$SOURCE_DIR/" "$TARGET_DIR/"

# 4. 彻底清理目标目录中可能残留的进程单例锁
rm -f "$TARGET_DIR/SingletonLock" "$TARGET_DIR/SingletonSocket" "$TARGET_DIR/SingletonCookie"

echo ""
echo "=================================================="
echo "✅ 迁移成功完成！"
echo "源数据目录: $SOURCE_DIR"
echo "新数据目录: $TARGET_DIR"
if [ -d "$TARGET_DIR/accounts" ]; then
    acc_count=$(find "$TARGET_DIR/accounts" -name "*.json" ! -name "settings.json" ! -name "model.json" ! -name "active_realm.json" | wc -l | tr -d ' ')
    echo "🔑 已同步账号数量: $acc_count 个"
fi
echo "所有账号池凭证、代理设置、模型映射已完整就绪。"
echo "您现在可以启动 GoingHub，直接无缝继续使用！"
echo "=================================================="
