#!/usr/bin/env node
/**
 * 文档相对链接检查
 * ============================================================================
 * 只检查仓库内的 .md 文件，外链不发起网络请求。
 */

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib/config');

const EXTRA_FILES = ['README.md', 'CONTRIBUTING.md', 'SECURITY.md'];
const DOCS_DIR = path.join(ROOT, 'docs');
const PLUGIN_GLOB = path.join(ROOT, 'plugins');

function collectMarkdown() {
  const files = new Set(EXTRA_FILES.map((file) => path.join(ROOT, file)));

  if (fs.existsSync(DOCS_DIR)) {
    for (const name of fs.readdirSync(DOCS_DIR)) {
      if (name.endsWith('.md')) files.add(path.join(DOCS_DIR, name));
    }
  }

  if (fs.existsSync(PLUGIN_GLOB)) {
    for (const id of fs.readdirSync(PLUGIN_GLOB)) {
      const readme = path.join(PLUGIN_GLOB, id, 'README.md');
      if (fs.existsSync(readme)) files.add(readme);
    }
  }

  return [...files].sort();
}

function checkFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const errors = [];
  const linkRe = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = linkRe.exec(text)) !== null) {
    const raw = match[1].trim();
    if (!raw || raw.startsWith('#') || raw.startsWith('<')) continue;
    if (/^(https?:|mailto:)/i.test(raw)) continue;
    const target = raw.split('#')[0].split('?')[0];
    if (!target) continue;
    const resolved = path.resolve(path.dirname(file), decodeURI(target));
    if (!fs.existsSync(resolved)) {
      const rel = path.relative(ROOT, file);
      errors.push(`${rel}: 链接目标不存在: ${raw}`);
    }
  }
  return errors;
}

function main() {
  const files = collectMarkdown();
  const errors = [];
  for (const file of files) errors.push(...checkFile(file));

  if (errors.length) {
    for (const error of errors) console.error(`❌ ${error}`);
    process.exit(1);
  }
  console.log(`✅ 文档链接检查通过（${files.length} 个文件）`);
}

try {
  main();
} catch (e) {
  console.error(`❌ ${e.message}`);
  process.exit(1);
}
