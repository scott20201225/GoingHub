@echo off
chcp 65001 >nul
:: ==============================================================================
:: BuddyApiHub -> GoingHub 数据一键全量迁移脚本 (Windows)
:: ==============================================================================
title BuddyApiHub -^> GoingHub 数据迁移工具

echo ==================================================
echo 🚀 开始将 BuddyApiHub 数据全量迁移至 GoingHub...
echo ==================================================

set "SOURCE_DIR=%APPDATA%\BuddyApiHub"
set "TARGET_DIR=%APPDATA%\GoingHub"

:: 1. 检查源目录是否存在
if not exist "%SOURCE_DIR%" (
    echo ❌ 错误: 未检测到 BuddyApiHub 数据目录:
    echo    %SOURCE_DIR%
    echo 请确认您是否在当前电脑上运行过 BuddyApiHub。
    pause
    exit /b 1
)

:: 2. 检查并退出运行中的进程，避免文件占用
tasklist /fi "imagename eq BuddyApiHub.exe" 2>nul | find /i "BuddyApiHub.exe" >nul
if not errorlevel 1 (
    echo ⚠️ 检测到 BuddyApiHub 正在运行，正在关闭以防止文件占用...
    taskkill /f /im BuddyApiHub.exe >nul 2>&1
    timeout /t 2 >nul
)

tasklist /fi "imagename eq GoingHub.exe" 2>nul | find /i "GoingHub.exe" >nul
if not errorlevel 1 (
    echo ⚠️ 检测到 GoingHub 正在运行，正在关闭以写入新配置...
    taskkill /f /im GoingHub.exe >nul 2>&1
    timeout /t 2 >nul
)

:: 3. 创建目标目录
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

:: 4. 使用 robocopy 进行全量安全镜像复制（排除进程锁与缓存锁）
echo 📦 正在复制账号池凭证、模型配置与历史使用量数据...
robocopy "%SOURCE_DIR%" "%TARGET_DIR%" /E /XF Singleton* *.lock /R:1 /W:1 >nul

:: 5. 清理可能残留的单例锁
if exist "%TARGET_DIR%\SingletonLock" del /f /q "%TARGET_DIR%\SingletonLock" >nul 2>&1
if exist "%TARGET_DIR%\SingletonSocket" del /f /q "%TARGET_DIR%\SingletonSocket" >nul 2>&1
if exist "%TARGET_DIR%\SingletonCookie" del /f /q "%TARGET_DIR%\SingletonCookie" >nul 2>&1

echo.
echo ==================================================
echo ✅ 迁移成功完成！
echo 源目录: %SOURCE_DIR%
echo 新目录: %TARGET_DIR%
echo.
echo 所有账号池凭证、代理设置、模型映射已完整就绪。
echo 您现在可以双击启动 GoingHub.exe 直接使用！
echo ==================================================
pause
