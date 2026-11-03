# 参与贡献

感谢你为 DeskLLMPet 插件市场提交插件或改进文档。

## 提交插件

1. Fork 本仓库；
2. 在 `plugins/<id>/` 添加插件源码与 `marketplace.json`；
3. 本地运行：

   ```bash
   npm ci
   npm run check
   ```

4. 在真实 DeskLLMPet 中安装测试（`npm run pack -- plugins/<id>`）；
5. 提交 PR，按 [插件提交指南](docs/authoring.md) 填写说明。

## 修改工具或文档

- 修改 `scripts/` 后请运行 `npm run check`；
- 修改索引格式必须同步更新 [docs/index-schema.md](docs/index-schema.md)，破坏性变更提升 `schemaVersion`；
- 不要手动编辑 `docs/index.json` 或 `marketplace.json` 的 `published` 字段，它们由脚本生成。

## 提交信息

推荐使用 Conventional Commits：

```text
feat(dlp-multi-pets): 支持从克隆体继续克隆
fix(scripts): 修正索引 URL 校验
docs: 补充首次发布步骤
```

## 行为准则

- 不提交恶意代码、混淆代码、密钥或个人数据；
- 不提交与插件无关的大文件；
- 尊重他人的插件 id 与版本号，不复用已发布的版本。

安全问题请按 [SECURITY.md](SECURITY.md) 私下报告，不要开公开 Issue。
