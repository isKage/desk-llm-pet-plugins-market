# 插件索引格式

DeskLLMPet 读取的索引固定发布在：

```text
https://iskage.github.io/desk-llm-pet-plugins-market/index.json
```

该文件由 `npm run index` 生成，**不要手写**。GitHub Pages 从 `main` 分支的 `/docs` 目录发布，`docs/.nojekyll` 保证 JSON 不被 Jekyll 处理。

## 1. 示例

```json
{
  "schemaVersion": 1,
  "updatedAt": "2026-11-03T06:20:47.226Z",
  "plugins": [
    {
      "id": "dlp-multi-pets",
      "name": "多桌宠克隆",
      "version": "1.0.0",
      "description": "右键桌宠即可克隆多个形象，所有桌宠共享同一套设置。",
      "author": "isKage",
      "apiVersion": 1,
      "minAppVersion": "1.2.0",
      "tags": ["桌宠", "多窗口", "趣味"],
      "homepage": "https://github.com/isKage/desk-llm-pet",
      "download": {
        "url": "https://github.com/isKage/desk-llm-pet-plugins-market/releases/download/plugin-dlp-multi-pets-v1.0.0/dlp-multi-pets-1.0.0.dlmpet",
        "size": 11795,
        "sha256": "64412043a40e601b71ba173a56f229f3f8e3a8e6752946b0a4881057dc1ef37f"
      }
    }
  ]
}
```

## 2. 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `schemaVersion` | number | 索引格式版本，当前为 `1` |
| `updatedAt` | string | ISO-8601 时间；内容未变时保持不变 |
| `plugins` | array | 已发布插件，按 `id` 排序 |
| `plugins[].id` | string | 插件唯一标识，与 `plugin.json` 一致 |
| `plugins[].name` | string | 展示名称 |
| `plugins[].version` | string | 最新已发布版本（semver） |
| `plugins[].description` | string | 一句话说明 |
| `plugins[].author` | string | 作者 |
| `plugins[].apiVersion` | number | 插件 API 版本；大于宿主支持版本时应用必须隐藏/拒绝 |
| `plugins[].minAppVersion` | string | 最低 DeskLLMPet 版本；应用版本更低时隐藏 |
| `plugins[].tags` | string[] | 分类标签，最多 8 个 |
| `plugins[].homepage` | string? | 可选，插件主页（https） |
| `plugins[].download.url` | string | `.dlmpet` 的 GitHub Release 地址 |
| `plugins[].download.size` | number | 包字节数 |
| `plugins[].download.sha256` | string | 包 SHA-256（64 位小写十六进制） |

## 3. 应用侧规则

接入插件市场的应用应遵守：

1. **只读取一个固定 URL**，不要在客户端搜索 GitHub API（限流且不可审核）。
2. 过滤：
   - `apiVersion > 宿主 PLUGIN_API_VERSION` → 不显示；
   - `minAppVersion > 当前应用版本` → 不显示；
   - `id` 重复 → 只保留第一条并记录错误。
3. 下载：
   - 只允许 `https://github.com/isKage/desk-llm-pet-plugins-market/releases/download/...`；
   - 校验 `Content-Length` / 实际大小与 `size` 一致；
   - 计算 SHA-256，必须与 `sha256` 完全一致；
   - 校验通过后再交给现有 `plugin-installer` 安装。
4. 安装前仍需用户确认「可信来源」；**不自动安装、不自动更新**。
5. 索引解析失败时保持「市场不可用」，不能影响已安装插件和主程序功能。

## 4. 兼容与演进

- 字段只增不改；新增可选字段不提升 `schemaVersion`。
- 破坏性变更（重命名、删除字段、语义变化）必须提升 `schemaVersion`，应用按版本分支处理。
- `updatedAt` 只用于缓存/展示；应用不要用它决定是否需要更新，应以每个插件的 `version` 为准。
- 下载地址的域名与仓库路径是安全边界的一部分，修改仓库名属于破坏性变更。
