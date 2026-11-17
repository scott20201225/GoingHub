## 🍎 macOS 安装与“已损坏”解决说明 (macOS Notice)

因为当前 macOS 构建版本使用自签名（未购买昂贵的 Apple 开发者年费证书），首次安装打开时 macOS Gatekeeper 安全机制可能会拦截并提示 **“GoingHub 已损坏，无法打开。你应该将它移到废纸篓”** 或 **“来自未知的开发者”**。

这属于 macOS 对开源未经公证软件的通用安全拦截提示，软件本身安全无害。请参照以下方法一键解除限制：

### 极简解决方法（终端执行一行命令）：

1. 打开 macOS **终端**（Terminal.app）；
2. 复制并执行以下命令：
   ```bash
   sudo xattr -r -d com.apple.quarantine /Applications/GoingHub.app
   ```
3. 按回车，输入你的 Mac 登录密码（终端输入密码时不会显示任何字符，输入完成直接回车即可）；
4. 重新点击打开 `/Applications/GoingHub.app` 即可秒级顺畅启动！

> 💡 **提示**：若未将软件拖入系统的 `应用程序`（Applications）文件夹，在终端中输入 `sudo xattr -r -d com.apple.quarantine `（注意最后留一个空格），然后直接将 `GoingHub.app` 图标拖进终端窗口后回车即可。

---

### macOS Installation Notice (English)

Since the macOS build is currently ad-hoc signed without an Apple Developer ID certificate, macOS Gatekeeper may block the first launch with the message *"GoingHub is damaged and can't be opened"*.

This is standard macOS behavior for unsigned open-source applications. You can clear the quarantine attribute with a single command:

```bash
sudo xattr -r -d com.apple.quarantine /Applications/GoingHub.app
```
*(Enter your Mac administrator password when prompted).*
