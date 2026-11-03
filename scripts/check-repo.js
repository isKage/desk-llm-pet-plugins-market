#!/usr/bin/env node
/**
 * 仓库总检查（npm run check / CI）
 * ============================================================================
 *   1. 校验 plugins/ 下每个插件的清单、入口文件、市场元数据；
 *   2. 逐个打包到临时目录并用安装器同款规则检查；
 *   3. 已发布版本的源码指纹必须与发布记录一致（改源码必须升版本）；
 *   4. docs/index.json 必须能由当前插件状态重新生成且内容一致。
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, ROOT, indexPath } = require('./lib/config');
const { loadAllPlugins, latestPublished } = require('./lib/plugins');
const { packPlugin } = require('./lib/pack');
const { sourceHash } = require('./lib/source');
const { buildIndex, readExistingIndex, sameIndex, validateIndex } = require('./lib/index');
const { compareVersions } = require('./lib/manifest');
const { formatBytes } = require('./lib/package');

function main() {
  const config = loadConfig();
  const { plugins, errors } = loadAllPlugins(config);

  if (!plugins.length) {
    errors.push('plugins/ 下没有插件');
  }

  const warnings = [];
  const tempDir = path.join(ROOT, '.tmp', `check-${process.pid}`);

  try {
    for (const plugin of plugins) {
      try {
        const { outputPath, info } = packPlugin(plugin, config, tempDir);
        const currentHash = sourceHash(plugin.dir);
        if (currentHash !== plugin.sourceHash) {
          errors.push(`${plugin.id}: 源码指纹在检查过程中发生变化`);
        }

        console.log(`✅ ${plugin.id} v${plugin.manifest.version}  打包 ${formatBytes(info.packageBytes)}  ${info.packageHash.slice(0, 12)}…`);

        const latest = latestPublished(plugin);
        if (!latest) {
          warnings.push(`${plugin.id}: 尚未发布，不会出现在 index.json`);
        } else if (compareVersions(latest.version, plugin.manifest.version) === 0) {
          if (!latest.sourceHash) {
            warnings.push(`${plugin.id}: v${latest.version} 的发布记录缺少 sourceHash（旧格式）`);
          } else if (latest.sourceHash !== currentHash) {
            errors.push(
              `${plugin.id}: v${latest.version} 发布后源码被修改（sourceHash 不一致）。` +
              '请提升 plugin.json 版本并重新发布，或恢复源码。'
            );
          }
        } else {
          console.log(`   ↳ 当前源码 v${plugin.manifest.version} 尚未发布（最新发布 v${latest.version}）`);
        }

        if (info.warnings.length) {
          for (const warning of info.warnings) warnings.push(`${plugin.id}: ${warning}`);
        }

        if (info.packageHash !== (latest && latest.sha256) && latest && latest.version === plugin.manifest.version) {
          warnings.push(
            `${plugin.id}: 本地重打包的 SHA-256 与发布记录不同（可能只是 zlib 版本差异）；` +
            '以 Release 上实际资产为准。'
          );
        }

        fs.rmSync(outputPath, { force: true });
      } catch (e) {
        errors.push(`${plugin.id}: ${e.message}`);
      }
    }

    // 索引
    const previous = readExistingIndex();
    const index = buildIndex(config, plugins, previous);
    for (const error of validateIndex(config, index)) errors.push(`index.json: ${error}`);

    if (!previous) {
      errors.push('docs/index.json 不存在，请运行 npm run index');
    } else if (!sameIndex(previous, index)) {
      errors.push('docs/index.json 不是最新，请运行 npm run index 并提交');
    } else {
      console.log(`✅ docs/index.json 已是最新（${index.plugins.length} 个插件）`);
    }

    // 发布记录里的下载条目应与索引一致（URL 由配置计算，避免手写漂移）
    for (const plugin of plugins) {
      const latest = latestPublished(plugin);
      if (!latest) continue;
      const entry = index.plugins.find((item) => item.id === plugin.id);
      if (!entry) {
        errors.push(`${plugin.id}: 已发布但未进入 index.json`);
        continue;
      }
      if (entry.version !== latest.version || entry.download.sha256 !== latest.sha256) {
        errors.push(`${plugin.id}: index.json 与发布记录不一致，请运行 npm run index`);
      }
    }

    const onDisk = path.relative(ROOT, indexPath());
    if (previous) {
      console.log(`✅ ${onDisk} 结构合法`);
    }
  } finally {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
  }

  for (const warning of warnings) console.warn(`⚠️  ${warning}`);

  if (errors.length) {
    console.error('');
    for (const error of errors) console.error(`❌ ${error}`);
    process.exit(1);
  }

  console.log('');
  console.log(`全部检查通过：${plugins.length} 个插件`);
}

try {
  main();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
