# DeskLLMPet 插件市场

DeskLLMPet 的官方插件索引与插件源码仓库。

- **应用读取的索引**：<https://iskage.github.io/desk-llm-pet-plugins-market/index.json>
- **插件包**：本仓库的 [GitHub Releases](https://github.com/isKage/desk-llm-pet-plugins-market/releases)
- **主程序**：[isKage/desk-llm-pet](https://github.com/isKage/desk-llm-pet)

插件和主程序分开发布：主程序只负责「发现 → 下载 → 校验 → 安装」，插件源码、打包和版本记录都在本仓库。

## 当前收录

| 插件 | 版本 | 说明 |
|---|---|---|
| [多桌宠克隆](plugins/dlp-multi-pets) | 1.0.0 | 右键克隆多个桌宠窗口，共享主程序设置 |

## 用户：安装插件

需要 DeskLLMPet **1.2.0 或更高版本**。

1. 打开 DeskLLMPet → **设置 → 🧩 插件**；
2. 点「选择插件包」，选择从 [Releases](https://github.com/isKage/desk-llm-pet-plugins-market/releases) 下载的 `.dlmpet` 文件；
3. 确认预览信息并勾选「可信来源」，安装。

也可以把 `.dlmpet` 放进插件目录后点「重新扫描」。安装、卸载、启用/禁用都在同一个设置页完成。

> 插件拥有本机权限，请只安装来自可信来源的插件包。

## 插件作者：提交插件

1. 在 `plugins/<id>/` 放置插件源码，`plugin.json` 的 `id` 必须与目录名一致；
2. 添加 `marketplace.json`（标签、最低主程序版本等市场元数据）；
3. 运行 `npm ci && npm run check`；
4. 提 PR，说明功能、权限和网络访问。

详细要求见 [插件提交指南](docs/authoring.md)。

## 维护者：发布

```bash
npm ci
npm run check

# 打包
npm run pack -- plugins/dlp-multi-pets

# 创建 GitHub Release 并上传 dist/dlp-multi-pets-1.0.0.dlmpet 后：
npm run release:record -- plugins/dlp-multi-pets dist/dlp-multi-pets-1.0.0.dlmpet
npm run index
```

也可以直接打 tag，让 [publish.yml](.github/workflows/publish.yml) 自动打包、发布、更新索引：

```bash
git tag plugin-dlp-multi-pets-v1.0.0
git push origin plugin-dlp-multi-pets-v1.0.0
```

完整流程、首次发布和排错见 [发布插件](docs/publishing.md)。

## 目录结构

```text
.
├── marketplace.config.json      # 仓库地址、Pages 地址、tag / 包名规则
├── plugins/
│   └── dlp-multi-pets/          # 插件源码（唯一事实来源）
│       ├── plugin.json
│       ├── marketplace.json     # 市场元数据 + 已发布记录（不进入插件包）
│       ├── main.js
│       ├── preload.js
│       └── renderer/
├── scripts/
│   ├── lib/                     # 清单/包校验、打包、索引生成
│   ├── pack-plugin.js
│   ├── validate-plugin.js
│   ├── build-index.js
│   ├── record-release.js
│   ├── tag-info.js
│   └── check-repo.js
├── docs/
│   ├── index.json               # 应用读取的插件索引（GitHub Pages）
│   ├── publishing.md
│   ├── index-schema.md
│   ├── authoring.md
│   └── app-integration.md
└── .github/workflows/
    ├── validate.yml             # PR / main 校验
    └── publish.yml              # tag 发布
```

## 安全模型

- 插件运行在 DeskLLMPet 主进程，**没有沙箱**；市场审核不是安全边界。
- 索引记录每个包的 **大小 + SHA-256**，应用下载后必须重新校验。
- 下载地址只允许本仓库的 GitHub Releases，应用不应信任索引里的任意 URL。
- 只收录经过人工审核的 PR；不自动更新，安装前始终由用户确认。

漏洞报告方式见 [SECURITY.md](SECURITY.md)。

## 相关文档

- [发布插件](docs/publishing.md)
- [索引格式](docs/index-schema.md)
- [插件提交指南](docs/authoring.md)
- [主程序接入计划](docs/app-integration.md)
- [主程序插件开发文档](https://github.com/isKage/desk-llm-pet/blob/main/docs/plugins/development.md)

## License

[MIT](LICENSE)
