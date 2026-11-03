#!/usr/bin/env node
/**
 * 校验插件目录或插件包
 *
 * 用法：
 *   npm run validate                 # 校验 plugins/ 下全部插件
 *   node scripts/validate-plugin.js plugins/dlp-multi-pets
 *   node scripts/validate-plugin.js dist/dlp-multi-pets-1.0.0.dlmpet
 */

const path = require('path');
const { loadConfig, ROOT } = require('./lib/config');
const { loadPlugin, loadAllPlugins, latestPublished } = require('./lib/plugins');
const { inspectPackage, formatBytes, isPackageFile } = require('./lib/package');
const { compareVersions } = require('./lib/manifest');

function printPlugin(plugin) {
  const latest = latestPublished(plugin);
  console.log(`✅ ${plugin.id}  ${plugin.manifest.name}  v${plugin.manifest.version}`);
  console.log(`   作者: ${plugin.manifest.author || '(未填写)'}`);
  console.log(`   apiVersion: ${plugin.manifest.apiVersion}  minAppVersion: ${plugin.meta.minAppVersion || '(默认)'}`);
  console.log(`   标签: ${(plugin.meta.tags || []).join(' / ') || '(无)'}`);
  console.log(`   源码指纹: ${plugin.sourceHash}`);
  if (!latest) {
    console.log('   发布状态: 尚未发布（不会进入 index.json）');
  } else if (compareVersions(latest.version, plugin.manifest.version) === 0) {
    console.log(`   发布状态: v${latest.version} 已记录（${latest.asset}）`);
  } else {
    console.log(`   发布状态: 已发布 v${latest.version}，当前源码 v${plugin.manifest.version} 待发布`);
  }
}

function printPackage(filePath) {
  const info = inspectPackage(filePath);
  console.log(`✅ ${path.relative(ROOT, filePath)}`);
  console.log(`   id: ${info.manifest.id}  version: ${info.manifest.version}`);
  console.log(`   作者: ${info.manifest.author || '(未填写)'}`);
  console.log(`   内容: ${info.fileCount} 个文件 / ${formatBytes(info.totalBytes)}（解压后）`);
  console.log(`   包大小: ${formatBytes(info.packageBytes)}`);
  console.log(`   SHA-256: ${info.packageHash}`);
  if (info.rootPrefix) console.log(`   包装目录: ${info.rootPrefix}`);
  for (const warning of info.warnings) console.log(`   ⚠️  ${warning}`);
}

function main() {
  const args = process.argv.slice(2);
  const config = loadConfig();
  const all = args.includes('--all') || args.length === 0;
  const target = args.find((arg) => !arg.startsWith('--'));

  if (all && !target) {
    const { plugins, errors } = loadAllPlugins(config);
    for (const plugin of plugins) {
      printPlugin(plugin);
      console.log('');
    }
    for (const error of errors) console.error(`❌ ${error}`);
    if (errors.length) process.exit(1);
    if (!plugins.length) {
      console.error('❌ plugins/ 下没有插件');
      process.exit(1);
    }
    console.log(`共校验 ${plugins.length} 个插件，全部通过。`);
    return;
  }

  if (!target) {
    console.error('用法: node scripts/validate-plugin.js <插件目录 | .dlmpet> | --all');
    process.exit(2);
  }

  const resolved = path.resolve(ROOT, target);
  if (isPackageFile(resolved)) {
    printPackage(resolved);
  } else {
    printPlugin(loadPlugin(resolved, config));
  }
}

try {
  main();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
