/**
 * 插件源码目录扫描与「源码指纹」
 * ============================================================================
 * 打包与校验共用同一份排除规则，确保 sourceHash 与 .dlmpet 内容一致。
 * sourceHash 用于判断「已发布版本的源码是否被改动」：发布后改源码必须升版本，
 * 否则 npm run check 会报错。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.github', '.vscode', '.idea', '.tmp', 'dist', 'dist-plugins'
]);

const EXCLUDED_FILES = new Set([
  '.DS_Store', 'Thumbs.db', 'marketplace.json'
]);

/** 是否为不进入插件包的文件 */
function isExcludedFile(name) {
  if (EXCLUDED_FILES.has(name)) return true;
  if (/\.(dlmpet|zip|log)$/i.test(name)) return true;
  return false;
}

/** 深度优先扫描，返回按相对路径排序的文件列表 */
function listSourceFiles(pluginDir) {
  const base = path.resolve(pluginDir);
  const files = [];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(base, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (EXCLUDED_DIRS.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && !isExcludedFile(entry.name)) {
        files.push({ rel, full });
      }
    }
  }

  walk(base);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

/** 源码指纹：相对路径 + 每个文件的 SHA-256，忽略换行差异之外的一切元数据 */
function sourceHash(pluginDir) {
  const hash = crypto.createHash('sha256');
  for (const file of listSourceFiles(pluginDir)) {
    const fileHash = crypto.createHash('sha256').update(fs.readFileSync(file.full)).digest('hex');
    hash.update(file.rel);
    hash.update('\0');
    hash.update(fileHash);
    hash.update('\n');
  }
  return hash.digest('hex');
}

module.exports = {
  EXCLUDED_DIRS,
  EXCLUDED_FILES,
  isExcludedFile,
  listSourceFiles,
  sourceHash
};
