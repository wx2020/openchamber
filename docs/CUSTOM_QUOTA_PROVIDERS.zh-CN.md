# 自定义提供商用量扩展 (Custom Quota Providers)

OpenChamber 原生支持在界面中查看模型提供商的额度与用量窗口（如 5 小时窗口、重置时间、使用百分比等）。

为了支持自定义模型中转、代理商或私有 API，本 Fork 仓库内置了外部提供商加载器（Custom Quota Hook）。无需重新编译或改动应用源码，只需在本地配置目录下放置单个 JavaScript 脚本，即可为任意提供商添加额度查询与监控。

## 预编译安装包下载

全平台构建由 GitHub Actions 在上游发布新版本时自动触发，可在 [Releases 页面](https://github.com/wx2020/openchamber/releases) 下载：

- **Windows**: `OpenChamber-*.win-x64.exe` / `OpenChamber-*.win-arm64.exe`
- **Android**: `OpenChamber-*-android.apk` (使用 AOSP debug 证书签名，可直接安装)
- **Linux**: `OpenChamber-*.AppImage` (x86_64 与 ARM64)
- **VS Code 插件**: `openchamber-*.vsix`
- **Web / CLI**: `openchamber-web-*.tgz`

## 脚本放置路径

OpenChamber 在后台服务启动时会自动扫描以下目录中的 `*.js`、`*.mjs` 或 `*.cjs` 脚本：

- **Windows**: `%USERPROFILE%\.config\openchamber\quota-providers\`  
  *(例如 `C:\Users\<用户名>\.config\openchamber\quota-providers\`)*
- **Linux / macOS**: `~/.config/openchamber/quota-providers/`
- **自定义环境变量**: 设置 `OPENCHAMBER_QUOTA_PROVIDERS_DIR` 指定任意本地目录

若目录尚不存在，手动创建即可。

## 扩展脚本格式规范

每个脚本为一个标准的 ESM 模块，需导出以下字段与函数：

```javascript
// ~/.config/openchamber/quota-providers/deepseek.js

/**
 * 提供商唯一标识（在设置和凭据存储中使用）
 */
export const providerId = 'deepseek';

/**
 * 界面显示的提供商名称
 */
export const providerName = 'DeepSeek';

/**
 * 检查当前提供商是否已配置可用凭证
 * @param {Record<string, unknown>} credentials 用户在设置界面输入的凭据（如 apiKey 等）
 * @returns {boolean}
 */
export function isConfigured(credentials) {
  // 如果该提供商无需凭证，可直接返回 true
  return Boolean(credentials?.apiKey);
}

/**
 * 查询当前提供商的用量数据
 * @param {Record<string, unknown>} credentials 用户凭据
 * @param {{ signal?: AbortSignal }} options 包含请求中止信号
 * @returns {Promise<Array<{ label: string, usedPercent: number, resetAt?: string }>>}
 */
export async function fetchQuota(credentials, { signal } = {}) {
  // 向提供商接口发起请求
  const res = await fetch('https://api.deepseek.com/user/balance', {
    headers: {
      Authorization: `Bearer ${credentials.apiKey}`,
    },
    signal,
  });

  if (!res.ok) {
    throw new Error(`查询失败: HTTP ${res.status}`);
  }

  const data = await res.json();

  // 返回用量窗口数组（支持多个窗口，如近期窗口与周期窗口）
  return [
    {
      label: '余额消耗',
      // usedPercent 取值范围 0 - 100
      usedPercent: Math.min(100, Math.round((data.used / data.total) * 100)),
      // resetAt 为可选的 ISO 8601 时间戳字符串
      resetAt: data.reset_time ? new Date(data.reset_time).toISOString() : undefined,
    },
  ];
}
```

### 返回字段说明

`fetchQuota` 函数需返回一个数组，数组元素包含：
- `label`: 字符串，窗口显示名称（例如 `"5-hour window"`、`"月度额度"` 等）
- `usedPercent`: 数字（0 至 100），用量进度条显示的百分比
- `resetAt` *(可选)*: ISO 格式的时间戳字符串（例如 `"2026-09-21T18:00:00.000Z"`），界面会自动根据此时间倒计时

## 使用步骤

1. 在上述路径创建对应的 `.js` 文件并保存代码。
2. 启动或重启 OpenChamber。
3. 进入 **Settings → Providers**（设置 → 提供商），在列表中会看到新注册的自定义提供商。
4. 输入对应的 API Key 或其他配置凭证并保存。
5. 在主界面或侧边栏即可看到实时用量状态与重置倒计时。

## 上游同步原理

本 Fork 仓库配置了自动化同步工作流（`.github/workflows/sync-upstream-release.yml`）：
- 每 6 小时自动检测官方 `openchamber/openchamber` 仓库的最新正式发布。
- 检测到新版本时，自动拉取上游 tag 并执行微挂载脚本（`scripts/apply-custom-quota-hook.mjs`）。
- 自动触发多平台交叉编译并发布全平台安装包，保证持续跟进上游新功能。
