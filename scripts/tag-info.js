#!/usr/bin/env node
/**
 * 解析发布 tag → 插件 id / 版本 / 包名（GitHub Actions 用）
 *
 * 用法：
 *   node scripts/tag-info.js plugin-dlp-multi-pets-v1.0.0
 *   node scripts/tag-info.js --tag plugin-dlp-multi-pets-v1.0.0
 *
 * 输出可直接追加到 $GITHUB_OUTPUT 的 key=value 行。
 */

const { loadConfig, tagFor, assetFor } = require('./lib/config');
const { loadAllPlugins } = require('./lib/plugins');

function main() {
  const args = process.argv.slice(2);
  let tag = '';
  const tagIndex = args.indexOf('--tag');
  if (tagIndex >= 0) tag = args[tagIndex + 1] || '';
  else tag = args.find((arg) => !arg.startsWith('--')) || '';

  if (!tag) {
    console.error('用法: node scripts/tag-info.js <tag>');
    process.exit(2);
  }

  const config = loadConfig();
  const { plugins, errors } = loadAllPlugins(config);
  if (errors.length) {
    for (const error of errors) console.error(`❌ ${error}`);
    process.exit(1);
  }

  const matches = plugins.filter((plugin) => tagFor(config, plugin.id, plugin.manifest.version) === tag);
  if (matches.length === 0) {
    console.error(`❌ tag 与任何插件当前版本都不匹配: ${tag}`);
    console.error('   请确认 plugin.json 版本已提升，或 tag 格式为:', config.releaseTagPattern);
    for (const plugin of plugins) {
      console.error(`   - ${tagFor(config, plugin.id, plugin.manifest.version)}`);
    }
    process.exit(1);
  }
  if (matches.length > 1) {
    console.error(`❌ tag 匹配到多个插件: ${matches.map((item) => item.id).join(', ')}`);
    process.exit(1);
  }

  const plugin = matches[0];
  const values = {
    id: plugin.id,
    version: plugin.manifest.version,
    tag,
    asset: assetFor(config, plugin.id, plugin.manifest.version),
    plugin_dir: `plugins/${plugin.id}`,
    title: `${plugin.manifest.name} v${plugin.manifest.version}`
  };

  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}=${value}`);
  }
}

try {
  main();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
