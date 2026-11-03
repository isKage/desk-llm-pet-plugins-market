#!/usr/bin/env node
/**
 * 记录一个已上传到 GitHub Release 的插件包，并刷新索引
 *
 * 用法：
 *   npm run release:record -- plugins/dlp-multi-pets dist/dlp-multi-pets-1.0.0.dlmpet
 *   npm run release:record -- plugins/dlp-multi-pets dist/dlp-multi-pets-1.0.0.dlmpet --tag plugin-dlp-multi-pets-v1.0.0
 *
 * 执行前请先创建好对应的 GitHub Release 并上传该包；索引里的下载地址会立即指向它。
 * 脚本会把版本、tag、包名、大小、SHA-256、源码指纹写入 plugins/<id>/marketplace.json，
 * 然后重新生成 docs/index.json。
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, ROOT, tagFor, assetFor } = require('./lib/config');
const { loadPlugin, loadAllPlugins } = require('./lib/plugins');
const { inspectPackage } = require('./lib/package');
const { sourceHash } = require('./lib/source');
const { buildIndex, readExistingIndex, writeIndex, validateIndex } = require('./lib/index');
const { compareVersions } = require('./lib/manifest');

function parseArgs(argv) {
  const args = { pluginDir: '', packagePath: '', tag: '', publishedAt: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--tag') args.tag = argv[++i] || '';
    else if (arg === '--published-at') args.publishedAt = argv[++i] || '';
    else if (!arg.startsWith('--') && !args.pluginDir) args.pluginDir = arg;
    else if (!arg.startsWith('--') && !args.packagePath) args.packagePath = arg;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pluginDir || !args.packagePath) {
    console.error('用法: node scripts/record-release.js <插件目录> <插件包> [--tag <tag>] [--published-at <ISO>]');
    process.exit(2);
  }

  const config = loadConfig();
  const plugin = loadPlugin(path.resolve(ROOT, args.pluginDir), config);
  const packagePath = path.resolve(ROOT, args.packagePath);

  if (!fs.existsSync(packagePath)) {
    throw new Error(`插件包不存在: ${args.packagePath}`);
  }

  const info = inspectPackage(packagePath);
  if (info.manifest.id !== plugin.id) {
    throw new Error(`包内 id (${info.manifest.id}) 与插件目录 (${plugin.id}) 不一致`);
  }
  if (info.manifest.version !== plugin.manifest.version) {
    throw new Error(`包内版本 (${info.manifest.version}) 与 plugin.json (${plugin.manifest.version}) 不一致`);
  }

  const expectedAsset = assetFor(config, plugin.id, plugin.manifest.version);
  if (path.basename(packagePath) !== expectedAsset) {
    throw new Error(`包名应为 ${expectedAsset}（实际 ${path.basename(packagePath)}），请用 npm run pack 重新打包`);
  }

  const tag = args.tag || tagFor(config, plugin.id, plugin.manifest.version);
  const expectedTag = tagFor(config, plugin.id, plugin.manifest.version);
  if (tag !== expectedTag) {
    throw new Error(`tag 应为 ${expectedTag}（实际 ${tag}）`);
  }

  const publishedAt = args.publishedAt || new Date().toISOString();
  if (Number.isNaN(Date.parse(publishedAt))) {
    throw new Error(`publishedAt 不是有效时间: ${publishedAt}`);
  }

  const currentHash = sourceHash(plugin.dir);
  const published = Array.isArray(plugin.meta.published) ? [...plugin.meta.published] : [];
  const index = published.findIndex((entry) => entry.version === plugin.manifest.version);
  const previous = index >= 0 ? published[index] : null;

  const entry = {
    version: plugin.manifest.version,
    tag,
    asset: expectedAsset,
    size: info.packageBytes,
    sha256: info.packageHash,
    sourceHash: currentHash,
    publishedAt: previous && !args.publishedAt ? previous.publishedAt : publishedAt
  };

  if (previous) {
    if (previous.sha256 !== entry.sha256) {
      console.warn(`⚠️  v${entry.version} 的包内容与上次记录不同（${previous.sha256.slice(0, 12)}… → ${entry.sha256.slice(0, 12)}…）`);
      console.warn('   请确认已用 gh release upload --clobber 覆盖 Release 资产。');
    }
    if (previous.sourceHash && previous.sourceHash !== entry.sourceHash) {
      console.warn(`⚠️  v${entry.version} 的源码在该版本发布后发生变化；通常应升版本再发布。`);
    }
    published[index] = entry;
  } else {
    published.push(entry);
  }

  published.sort((a, b) => compareVersions(a.version, b.version));

  const nextMeta = {
    ...plugin.meta,
    id: plugin.id,
    published
  };
  fs.writeFileSync(plugin.metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`, 'utf8');

  // 重新加载全部插件，确保写入后的元数据能通过校验，再刷新索引
  const { plugins, errors: loadErrors } = loadAllPlugins(config);
  if (loadErrors.length) {
    for (const error of loadErrors) console.error(`❌ ${error}`);
    process.exit(1);
  }
  const indexObject = buildIndex(config, plugins, readExistingIndex());
  const errors = validateIndex(config, indexObject);
  if (errors.length) {
    for (const error of errors) console.error(`❌ ${error}`);
    process.exit(1);
  }
  writeIndex(indexObject);

  console.log(`✅ 已记录 ${plugin.id} v${plugin.manifest.version}`);
  console.log(`   tag: ${tag}`);
  console.log(`   asset: ${expectedAsset}`);
  console.log(`   size: ${info.packageBytes}B`);
  console.log(`   SHA-256: ${info.packageHash}`);
  console.log(`   sourceHash: ${currentHash}`);
  console.log(`   索引: docs/index.json`);
  console.log('');
  console.log('下一步：确认 Release 已上传该包，然后提交 marketplace.json 与 docs/index.json。');
}

try {
  main();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
