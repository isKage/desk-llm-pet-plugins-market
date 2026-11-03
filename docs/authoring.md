# 插件提交指南

本仓库只收录能在 DeskLLMPet 中正常安装、且通过人工审核的插件。

## 1. 目录与清单

```text
plugins/<id>/
├── plugin.json          # 必需，id 必须与目录名一致
├── marketplace.json     # 必需，市场元数据（不会进入插件包）
├── main.js              # 主进程入口
├── preload.js           # 可选
└── renderer/            # 可选
```

`plugin.json` 的字段、`ctx` API、窗口/IPC 用法见主程序文档：

- [插件开发指南](https://github.com/isKage/desk-llm-pet/blob/main/docs/plugins/development.md)
- [打包插件](https://github.com/isKage/desk-llm-pet/blob/main/docs/plugins/packaging.md)

硬性要求：

- `id` 小写，只允许字母数字和 `. _ -`，以字母/数字开头，且与目录名一致；
- `version` 是 semver；
- `apiVersion` 不超过当前主程序支持的版本；
- `main` / `preload` 必须位于插件目录内；
- 不提交 `node_modules/`、`.dlmpet`、`.zip`、日志或本地配置；
- 插件必须自包含，不能依赖主程序内部文件路径（只能通过 `ctx` / 宿主提供的能力）。

## 2. `marketplace.json`

```json
{
  "id": "my-plugin",
  "author": "your-name",
  "tags": ["桌宠", "工具"],
  "minAppVersion": "1.2.0",
  "homepage": "https://github.com/you/my-plugin",
  "published": []
}
```

| 字段 | 必填 | 说明 |
|---|:---:|---|
| `id` | ✅ | 与 `plugin.json` 一致 |
| `author` | | 市场展示作者；缺省用 `plugin.json` |
| `tags` | | 最多 8 个，每个 ≤ 24 字符 |
| `minAppVersion` | | 最低主程序版本，semver；缺省用市场默认值 |
| `homepage` | | 插件主页或仓库，必须 https |
| `published` | ✅ | 发布记录，由维护者运行 `release:record` 写入，**PR 不要手改** |

`published` 的每一项包含 `version / tag / asset / size / sha256 / sourceHash / publishedAt`，用于生成索引和判断源码是否在发布后被修改。

## 3. 提交前自测

```bash
npm ci
npm run check

# 打包后在真实 DeskLLMPet 中安装测试
npm run pack -- plugins/my-plugin
```

逐项确认：

- [ ] 设置 → 🧩 插件 → 选择插件包可安装；
- [ ] 菜单项、设置面板、窗口、IPC 正常；
- [ ] 禁用/启用、卸载后无残留窗口或定时器；
- [ ] 不修改主程序配置文件（只能读）；
- [ ] 网络请求有超时和错误提示；
- [ ] 在 macOS 和 Windows 各测一次（至少说明测试平台）。

## 4. PR 检查清单

- [ ] 只改动 `plugins/<id>/`（以及必要的文档）；
- [ ] 没有 `node_modules/`、构建产物、密钥、个人路径；
- [ ] `plugin.json` 版本是新的；已发布版本没有被改写；
- [ ] `marketplace.json` 的 `published` 没有被手动修改；
- [ ] PR 描述写清：功能、权限、网络访问、测试平台；
- [ ] CI `Validate` 通过。

维护者合并后会统一打包、发布 Release、写入 `published` 并更新索引。插件作者不需要自己创建 Release。

## 5. 审核关注点

- 是否读取/上传用户数据，是否有明确说明；
- 是否执行任意命令、下载并运行外部代码；
- 是否在无提示的情况下创建大量窗口、常驻定时器或高频网络请求；
- 是否包含混淆代码、可疑二进制；
- 卸载/停用是否清理干净。

插件运行在主进程且没有沙箱，审核不能替代用户对来源的信任。发现恶意插件请按 [SECURITY.md](../SECURITY.md) 报告。
