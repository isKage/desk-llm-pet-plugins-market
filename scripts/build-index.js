#!/usr/bin/env node
/**
 * 生成 docs/index.json
 *
 * 用法：
 *   npm run index          # 写入 docs/index.json
 *   npm run index:check    # 只检查是否最新（CI 用）
 *   node scripts/build-index.js --stdout
 *
 * index.json 只由本脚本生成，不要手写。
 */

const path = require('path');
const { loadConfig, ROOT } = require('./lib/config');
const { loadAllPlugins } = require('./lib/plugins');
const {
  buildIndex,
  readExistingIndex,
  writeIndex,
  sameIndex,
  validateIndex
} = require('./lib/index');

function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const stdout = args.includes('--stdout');

  const config = loadConfig();
  const { plugins, errors } = loadAllPlugins(config);
  if (errors.length) {
    for (const error of errors) console.error(`❌ ${error}`);
    console.error('插件状态不合法，已停止生成索引。');
    process.exit(1);
  }

  const previous = readExistingIndex();
  const index = buildIndex(config, plugins, previous);

  const structureErrors = validateIndex(config, index);
  if (structureErrors.length) {
    for (const error of structureErrors) console.error(`❌ ${error}`);
    process.exit(1);
  }

  if (stdout) {
    process.stdout.write(`${JSON.stringify(index, null, 2)}\n`);
    return;
  }

  if (check) {
    if (!previous) {
      console.error('❌ docs/index.json 不存在，请运行 npm run index');
      process.exit(1);
    }
    if (!sameIndex(previous, index)) {
      console.error('❌ docs/index.json 不是最新，请运行 npm run index 并提交');
      process.exit(1);
    }
    console.log(`✅ docs/index.json 已是最新（${index.plugins.length} 个插件）`);
    return;
  }

  writeIndex(index);
  const rel = path.relative(ROOT, path.join(ROOT, 'docs', 'index.json'));
  console.log(`✅ 已生成 ${rel}（${index.plugins.length} 个插件）`);
  for (const plugin of index.plugins) {
    console.log(`   ${plugin.id} v${plugin.version}  ${plugin.download.size}B  ${plugin.download.sha256.slice(0, 12)}…`);
  }
}

try {
  main();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
