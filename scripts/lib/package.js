/**
 * 插件包（.dlmpet / .zip）只读检查
 * ============================================================================
 * 规则与 DeskLLMPet v1.2.0 的 src/plugins/plugin-installer.js 保持一致：
 *   - 拒绝绝对路径、`..`、反斜杠、Windows 保留名、symlink、加密条目；
 *   - 限制包大小 / 解压总量 / 条目数 / 单文件大小；
 *   - 包根目录或唯一一层包装目录中必须有 plugin.json；
 *   - 清单声明的 main / preload 必须存在于包内。
 *
 * 这里只读，不落盘。发布流程用它自校验，CI 也用它验证每个包。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { normalizeManifest, isValidSemver } = require('./manifest');

const PACKAGE_EXTENSIONS = ['.dlmpet', '.zip'];

const LIMITS = {
  maxPackageBytes: 20 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxEntries: 2000,
  maxFileBytes: 32 * 1024 * 1024,
  maxManifestBytes: 1024 * 1024,
  maxPathLength: 240
};

class PackageError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'PackageError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function fail(code, message, cause) {
  throw new PackageError(code, message, cause);
}

function formatBytes(bytes) {
  const num = Number(bytes) || 0;
  if (num < 1024) return `${num}B`;
  if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)}KB`;
  return `${(num / (1024 * 1024)).toFixed(1)}MB`;
}

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isPackageFile(filePath) {
  return PACKAGE_EXTENSIONS.includes(path.extname(String(filePath || '')).toLowerCase());
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/** 校验 zip 条目相对路径是否安全；不安全返回 null */
function normalizeEntryName(rawName, options = {}) {
  const maxPathLength = options.maxPathLength || LIMITS.maxPathLength;
  if (typeof rawName !== 'string' || !rawName) return null;
  if (rawName.includes('\0') || /[\u0000-\u001f]/.test(rawName)) return null;
  if (rawName.includes('\\')) return null;
  if (rawName.length > maxPathLength) return null;
  if (rawName.startsWith('/') || /^[a-zA-Z]:/.test(rawName)) return null;

  let name = rawName;
  while (name.startsWith('./')) name = name.slice(2);
  const isDir = name.endsWith('/');
  if (isDir) name = name.replace(/\/+$/, '');
  if (!name || name.includes('//')) return null;

  const segments = name.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') return null;
    if (/[<>:"|?*]/.test(segment)) return null;
    if (/[. ]$/.test(segment)) return null;
    if (WINDOWS_RESERVED.test(segment)) return null;
  }
  return isDir ? `${name}/` : name;
}

/** 归档内应忽略的垃圾条目 */
function shouldIgnoreEntry(name) {
  if (!name) return true;
  if (name === '__MACOSX/' || name.startsWith('__MACOSX/')) return true;
  const base = name.replace(/\/$/, '').split('/').pop();
  return base === '.DS_Store' || base === 'Thumbs.db';
}

function entryMode(entry) {
  const raw = Number(entry && entry.header && entry.header.attr);
  if (!Number.isFinite(raw) || raw === 0) return 0;
  return (raw >>> 16) & 0xffff;
}

function isSymlinkEntry(entry) {
  return (entryMode(entry) & 0o170000) === 0o120000;
}

function isSpecialEntry(entry) {
  const mode = entryMode(entry);
  if (!mode) return false;
  const type = mode & 0o170000;
  return type !== 0 && type !== 0o100000 && type !== 0o040000;
}

function entrySize(entry) {
  const size = Number(entry && entry.header && entry.header.size);
  return Number.isFinite(size) && size >= 0 ? size : 0;
}

function entryMethod(entry) {
  const method = Number(entry && entry.header && entry.header.method);
  return Number.isFinite(method) ? method : 0;
}

function entryIsEncrypted(entry) {
  const flags = Number(entry && entry.header && entry.header.flags);
  return Number.isFinite(flags) && (flags & 0x1) !== 0;
}

/** 打开包并做大小 / 路径 / 类型校验 */
function openPackage(packagePath) {
  if (!isPackageFile(packagePath)) {
    fail('INVALID_PACKAGE', `不支持的插件包扩展名: ${path.extname(packagePath) || '(无)'}`);
  }

  let stat;
  try {
    stat = fs.statSync(packagePath);
  } catch (e) {
    fail('NOT_FOUND', `插件包不存在: ${packagePath}`, e);
  }
  if (!stat.isFile()) fail('INVALID_PACKAGE', '插件包必须是文件');
  if (stat.size > LIMITS.maxPackageBytes) {
    fail('TOO_LARGE', `插件包超过大小限制（${formatBytes(stat.size)} > ${formatBytes(LIMITS.maxPackageBytes)}）`);
  }

  let zip;
  try {
    zip = new AdmZip(packagePath);
  } catch (e) {
    fail('INVALID_PACKAGE', `无法读取插件包（不是有效的 ZIP？）: ${e.message}`, e);
  }

  const entries = zip.getEntries();
  if (!Array.isArray(entries) || entries.length === 0) {
    fail('INVALID_PACKAGE', '插件包是空的');
  }
  if (entries.length > LIMITS.maxEntries) {
    fail('TOO_LARGE', `插件包条目过多（${entries.length} > ${LIMITS.maxEntries}）`);
  }

  for (const entry of entries) {
    const normalized = normalizeEntryName(entry.entryName);
    if (!normalized) {
      fail('UNSAFE_ENTRY', `插件包包含不安全的路径: ${entry.entryName}`);
    }
    if (shouldIgnoreEntry(normalized)) continue;
    if (entryIsEncrypted(entry)) {
      fail('UNSAFE_ENTRY', `插件包包含加密条目: ${normalized}`);
    }
    if (isSymlinkEntry(entry)) {
      fail('UNSAFE_ENTRY', `插件包包含符号链接: ${normalized}`);
    }
    if (isSpecialEntry(entry)) {
      fail('UNSAFE_ENTRY', `插件包包含特殊文件: ${normalized}`);
    }
    if (!entry.isDirectory) {
      const method = entryMethod(entry);
      if (method !== 0 && method !== 8) {
        fail('INVALID_PACKAGE', `不支持的压缩方式 (${method}): ${normalized}`);
      }
      if (entrySize(entry) > LIMITS.maxFileBytes) {
        fail('TOO_LARGE', `单个文件超过限制: ${normalized}`);
      }
    }
  }

  return {
    zip,
    entries,
    packageBytes: stat.size,
    packageHash: sha256File(packagePath)
  };
}

/** 从条目列表里定位 plugin.json 与包根前缀 */
function locateManifest(entries) {
  const candidates = [];
  const seen = new Set();
  let totalBytes = 0;
  let fileCount = 0;

  for (const entry of entries) {
    const name = normalizeEntryName(entry.entryName);
    if (!name || shouldIgnoreEntry(name)) continue;

    const duplicateKey = name.toLowerCase();
    if (seen.has(duplicateKey)) {
      fail('INVALID_PACKAGE', `插件包包含重复路径: ${name}`);
    }
    seen.add(duplicateKey);

    if (!entry.isDirectory) {
      totalBytes += entrySize(entry);
      fileCount += 1;
    }
    if (name === 'plugin.json') {
      candidates.push({ entry, name, prefix: '' });
    } else if (/^[^/]+\/plugin\.json$/.test(name)) {
      candidates.push({ entry, name, prefix: name.slice(0, name.length - 'plugin.json'.length) });
    }
  }

  if (candidates.length === 0) {
    fail('INVALID_PACKAGE', '插件包根目录缺少 plugin.json');
  }
  if (candidates.length > 1) {
    fail('INVALID_PACKAGE', `插件包包含多个 plugin.json: ${candidates.map((c) => c.name).join(', ')}`);
  }

  return { candidate: candidates[0], totalBytes, fileCount };
}

function readManifestFromEntry(entry) {
  if (entrySize(entry) > LIMITS.maxManifestBytes) {
    fail('TOO_LARGE', 'plugin.json 过大');
  }
  let text;
  try {
    text = entry.getData().toString('utf8');
  } catch (e) {
    fail('INVALID_PACKAGE', `无法读取 plugin.json: ${e.message}`, e);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (e) {
    fail('INVALID_PACKAGE', `plugin.json 解析失败: ${e.message}`, e);
  }
}

/**
 * 只读检查插件包
 * @param {string} packagePath
 * @returns {Object} 预览信息
 */
function inspectPackage(packagePath) {
  const opened = openPackage(packagePath);
  const { candidate, totalBytes, fileCount } = locateManifest(opened.entries);

  if (totalBytes > LIMITS.maxTotalBytes) {
    fail('TOO_LARGE', `插件包解压后超过限制（${formatBytes(totalBytes)} > ${formatBytes(LIMITS.maxTotalBytes)}）`);
  }

  const rawManifest = readManifestFromEntry(candidate.entry);
  const fallbackId = candidate.prefix ? candidate.prefix.replace(/\/$/, '') : '';
  let manifest;
  try {
    manifest = normalizeManifest(rawManifest, { fallbackId });
  } catch (e) {
    fail('INVALID_PACKAGE', e.message, e);
  }
  if (!isValidSemver(manifest.version)) {
    fail('INVALID_PACKAGE', `version 必须是 semver（如 1.0.0）: ${manifest.version}`);
  }

  const names = new Set(
    opened.entries
      .map((entry) => normalizeEntryName(entry.entryName))
      .filter(Boolean)
      .filter((name) => !name.endsWith('/'))
  );
  const lowerNames = new Set([...names].map((name) => name.toLowerCase()));
  const rootPrefix = candidate.prefix;
  const required = [manifest.main];
  if (manifest.preload) required.push(manifest.preload);
  for (const rel of required) {
    const full = `${rootPrefix}${rel}`.toLowerCase();
    if (!lowerNames.has(full)) {
      fail('INVALID_PACKAGE', `清单声明的文件不在包内: ${rel}`);
    }
  }

  if (rootPrefix) {
    for (const name of names) {
      if (!name.startsWith(rootPrefix)) {
        fail('INVALID_PACKAGE', `插件包根目录与包装目录混放: ${name}`);
      }
    }
  }

  const warnings = [];
  if (manifest.author === '') warnings.push('清单未填写 author');
  if (rootPrefix) warnings.push(`插件包外层有一层目录 ${rootPrefix.replace(/\/$/, '')}，安装时会自动去掉`);
  if ([...names].some((name) => name.startsWith(`${rootPrefix}node_modules/`))) {
    warnings.push('插件包包含 node_modules，安装包体积可能较大');
  }

  return {
    ok: true,
    packagePath,
    packageName: path.basename(packagePath),
    packageBytes: opened.packageBytes,
    packageHash: opened.packageHash,
    manifest,
    rootPrefix,
    fileCount,
    totalBytes,
    warnings
  };
}

module.exports = {
  PACKAGE_EXTENSIONS,
  LIMITS,
  PackageError,
  formatBytes,
  sha256File,
  isPackageFile,
  normalizeEntryName,
  shouldIgnoreEntry,
  inspectPackage
};
