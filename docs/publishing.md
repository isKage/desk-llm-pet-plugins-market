# 发布插件

本文面向仓库维护者，描述如何把一个插件版本发布到市场。

## 0. 一次性准备

1. 确认 `marketplace.config.json` 的 `repository` 与 `pagesBaseUrl` 和真实仓库一致；
2. GitHub 仓库 **Settings → Pages**：
   - Source：`Deploy from a branch`
   - Branch：`main`，目录 `/docs`
3. 仓库 **Settings → Actions → General → Workflow permissions**：
   - 选择 `Read and write permissions`（`publish.yml` 需要创建 Release 并提交索引）。

> `docs/.nojekyll` 已存在，GitHub Pages 会原样提供 `docs/index.json`。

## 1. 版本规则

- 插件版本只由 `plugins/<id>/plugin.json` 的 `version` 决定，必须是 semver（如 `1.0.0`）。
- 每次发布一个版本，生成：

  ```text
  tag:   plugin-<id>-v<version>      # 例：plugin-dlp-multi-pets-v1.0.0
  asset: <id>-<version>.dlmpet       # 例：dlp-multi-pets-1.0.0.dlmpet
  ```

- **已发布版本不可变**：发布后改源码必须提升版本号，否则 `npm run check` 会因 `sourceHash` 不一致而失败。

## 2. 发布前检查

```bash
npm ci
npm run check
```

`npm run check` 会：

1. 校验所有插件的清单、入口文件、市场元数据；
2. 按安装器规则重新打包并检查路径、大小、symlink 等；
3. 确认已发布版本的源码指纹没有变化；
4. 确认 `docs/index.json` 能从当前状态重新生成且内容一致。

## 3. 方式 A：手动发布（首次推荐）

### 3.1 打包

```bash
npm run pack -- plugins/dlp-multi-pets
```

产物：`dist/dlp-multi-pets-1.0.0.dlmpet`（`dist/` 已被 git 忽略）。

记录 SHA-256，后面写索引需要：

```bash
shasum -a 256 dist/dlp-multi-pets-1.0.0.dlmpet
```

### 3.2 创建 GitHub Release

网页方式：

1. 仓库 → **Releases → Draft a new release**；
2. Tag：`plugin-dlp-multi-pets-v1.0.0`，Target：`main`；
3. Title：`多桌宠克隆 v1.0.0`；
4. 上传 `dist/dlp-multi-pets-1.0.0.dlmpet`；
5. Publish release。

或使用 `gh`：

```bash
gh release create plugin-dlp-multi-pets-v1.0.0 \
  dist/dlp-multi-pets-1.0.0.dlmpet \
  --title "多桌宠克隆 v1.0.0" \
  --notes "插件包：dlp-multi-pets-1.0.0.dlmpet"
```

> 必须上传**打包脚本生成的那个文件**。如果重新打包，包哈希会变，需要重新执行下一步。

### 3.3 记录发布并生成索引

```bash
npm run release:record -- \
  plugins/dlp-multi-pets \
  dist/dlp-multi-pets-1.0.0.dlmpet \
  --tag plugin-dlp-multi-pets-v1.0.0
```

脚本会：

- 校验包内 `id` / `version` 与源码一致；
- 把大小、SHA-256、源码指纹写入 `plugins/<id>/marketplace.json`；
- 重新生成 `docs/index.json`，下载地址指向刚创建的 Release。

### 3.4 提交

```bash
git add plugins/dlp-multi-pets/marketplace.json docs/index.json
git commit -m "release: dlp-multi-pets v1.0.0"
git push origin main
```

### 3.5 验证

```bash
curl -s https://iskage.github.io/desk-llm-pet-plugins-market/index.json | head -40
curl -L -o /tmp/plugin.dlmpet \
  https://github.com/isKage/desk-llm-pet-plugins-market/releases/download/plugin-dlp-multi-pets-v1.0.0/dlp-multi-pets-1.0.0.dlmpet
shasum -a 256 /tmp/plugin.dlmpet
```

哈希应与 `docs/index.json` 中的 `download.sha256` 一致。Pages 首次部署可能需要 1–2 分钟。

## 4. 方式 B：打 tag 自动发布

适合已经开启 Actions 写权限的仓库。

```bash
# 1. 提升 plugin.json 版本，更新 README / marketplace.json（如需要）
# 2. 本地检查
npm run check
# 3. 提交并推送 main
git add -A
git commit -m "release: dlp-multi-pets v1.0.1"
git push origin main
# 4. 从 main HEAD 打 tag 并推送
git tag plugin-dlp-multi-pets-v1.0.1
git push origin plugin-dlp-multi-pets-v1.0.1
```

[publish.yml](../.github/workflows/publish.yml) 会：

1. 解析 tag，确认插件当前版本与 tag 一致；
2. 确认 tag 就是 `origin/main` 最新提交；
3. 打包；
4. 创建 Release 并上传 `.dlmpet`；
5. 调用 `release:record` 写入发布记录和索引；
6. 把 `docs/index.json`、`marketplace.json` 提交回 `main`。

> 自动流程要求 tag 打在 `main` 最新提交上，避免索引和源码版本错位。
> 如果 `main` 开启了分支保护，bot 无法直接 push，需要改用方式 A，或允许 `github-actions[bot]` 推送。

## 5. 常见问题

### `docs/index.json` 404

- 确认 Pages 的目录是 `/docs`，分支是 `main`；
- 确认 `docs/index.json` 已提交并推送；
- 等待 1–2 分钟，或在 **Actions → pages build and deployment** 查看部署状态。

### 应用里下载失败

- Release 是否已 Publish（不是 Draft）；
- tag 与 asset 名是否与 `docs/index.json` 完全一致；
- 索引里的 `sha256` 是否对应上传的文件；
- 私有仓库的 Release 需要登录，插件市场应保持公开。

### `npm run check` 报 sourceHash 不一致

已发布版本的源码被修改了。二选一：

- 提升 `plugin.json` 版本，按新版本重新发布；
- 还原源码到发布时的状态。

### `npm run check` 报 index 不是最新

```bash
npm run index
git add docs/index.json plugins/*/marketplace.json
```

### 本地重打包的 SHA-256 与索引不同

不同 Node / zlib 版本可能压出不同的字节，这是正常警告。**以 Release 上实际资产为准**；如果要更新同一版本，重新上传后执行 `release:record` 更新索引。

## 6. 回滚

不要删除已发布的版本记录，也不要复用版本号。推荐：

1. 修复问题并发布更高版本；
2. 如需紧急下架，从 `docs/index.json` 移除该插件并提交，Release 保留作为历史记录。
