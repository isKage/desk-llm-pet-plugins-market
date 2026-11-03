#!/usr/bin/env node
/**
 * 打包插件
 *
 * 用法：
 *   npm run pack -- plugins/dlp-multi-pets
 *   npm run pack -- plugins/dlp-multi-pets --out dist
 *   npm run pack:all
 *
 * 输出：dist/<id>-<version>.dlmpet
 */

const path = require('path');
const { loadConfig, ROOT } = require('./lib/config');
const { loadPlugin, loadAllPlugins } = require('./lib/plugins');
const { packPlugin } = require('./lib/pack');
const { formatBytes } = require('./lib/package');

function parseArgs(argv) {
  const args = { target: '', outDir: path.join(ROOT, 'dist'), all: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--all') args.all = true;
    else if (arg === '--out') args.outDir = path.resolve(ROOT, argv[++i] || 'dist');
    else if (arg === '--help' || arg === '-h') args.help = true;
    else if (!arg.startsWith('--') && !args.target) args.target = arg;
  }
  return args;
}

function printResult(result) {
  const rel = path.relative(ROOT, result.outputPath).split(path.sep).join('/');
  console.log(`✅ ${rel}`);
  console.log(`   id: ${result.info.manifest.id}  version: ${result.info.manifest.version}`);
  console.log(`   内容: ${result.info.fileCount} 个文件 / ${formatBytes(result.info.totalBytes)}（解压后）`);
  console.log(`   包大小: ${formatBytes(result.info.packageBytes)}`);
  console.log(`   SHA-256: ${result.info.packageHash}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('用法: node scripts/pack-plugin.js <插件目录> [--out <输出目录>]');
    console.log('      node scripts/pack-plugin.js --all [--out <输出目录>]');
    return;
  }

  const config = loadConfig();

  if (args.all) {
    const { plugins, errors } = loadAllPlugins(config);
    if (errors.length) {
      for (const error of errors) console.error(`❌ ${error}`);
      process.exit(1);
    }
    if (!plugins.length) {
      console.error('❌ plugins/ 下没有可打包的插件');
      process.exit(1);
    }
    for (const plugin of plugins) {
      printResult(packPlugin(plugin, config, args.outDir));
      console.log('');
    }
    console.log(`共打包 ${plugins.length} 个插件 → ${path.relative(ROOT, args.outDir)}/`);
    return;
  }

  if (!args.target) {
    console.error('用法: node scripts/pack-plugin.js <插件目录> [--out <输出目录>]');
    process.exit(2);
  }

  const plugin = loadPlugin(path.resolve(ROOT, args.target), config);
  printResult(packPlugin(plugin, config, args.outDir));
}

try {
  main();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
