/**
 * 插件目录加载、元数据校验与索引条目生成
 * ============================================================================
 * 目录约定：
 *   plugins/<id>/plugin.json       # 插件清单（与安装到 DeskLLMPet 的内容一致）
 *   plugins/<id>/marketplace.json  # 市场元数据（不会打进插件包）
 *   plugins/<id>/...               # 插件源码
 */

const fs = require('fs');
const path = require('path');
const {
  normalizeManifest,
  validateManifestPaths,
  isValidSemver,
  compareVersions
} = require('./manifest');
const { sourceHash } = require('./source');
const { tagFor, assetFor, downloadUrl, readJson } = require('./config');

const ROOT = path.resolve(__dirname, '..', '..');
const PLUGINS_DIR = path.join(ROOT, 'plugins');
const META_FILE = 'marketplace.json';

function pluginDirs(root = PLUGINS_DIR) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
    .map((entry) => path.join(root, entry.name))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

function readManifest(pluginDir) {
  const file = path.join(pluginDir, 'plugin.json');
  const raw = readJson(file);
  return normalizeManifest(raw, { fallbackId: path.basename(pluginDir) });
}

/**
 * 加载并校验单个插件目录。
 * 校验失败直接抛错；批量校验由调用方逐个捕获，避免一个坏插件挡住其它插件。
 */
function loadPlugin(pluginDir, config = null) {
  const dir = path.resolve(pluginDir);
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`插件目录不存在: ${pluginDir}`);
  }

  const idFromDir = path.basename(dir);
  const manifest = readManifest(dir);
  if (manifest.id !== idFromDir) {
    throw new Error(`目录名必须与 plugin.json 的 id 一致: 目录 ${idFromDir} / id ${manifest.id}`);
  }
  if (!isValidSemver(manifest.version)) {
    throw new Error(`version 必须是 semver（如 1.0.0）: ${manifest.version}`);
  }
  validateManifestPaths(manifest, dir);

  const metaPath = path.join(dir, META_FILE);
  if (!fs.existsSync(metaPath)) {
    throw new Error(`缺少 ${META_FILE}（市场元数据：tags / minAppVersion / published）`);
  }
  const meta = readJson(metaPath);
  validateMeta(meta, manifest, config);

  return {
    dir,
    id: manifest.id,
    manifest,
    meta,
    metaPath
  };
}

/** 市场元数据校验；config 可选，用于校验 tag / 包名规则 */
function validateMeta(meta, manifest, config) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error(`${META_FILE} 必须是对象`);
  }
  if (meta.id !== undefined && meta.id !== manifest.id) {
    throw new Error(`${META_FILE} 的 id 与 plugin.json 不一致: ${meta.id} / ${manifest.id}`);
  }
  if (meta.author !== undefined && typeof meta.author !== 'string') {
    throw new Error(`${META_FILE} 的 author 必须是字符串`);
  }
  if (meta.homepage !== undefined) {
    if (typeof meta.homepage !== 'string' || !/^https:\/\//.test(meta.homepage)) {
      throw new Error(`${META_FILE} 的 homepage 必须是 https URL`);
    }
  }
  if (meta.minAppVersion !== undefined && !isValidSemver(meta.minAppVersion)) {
    throw new Error(`${META_FILE} 的 minAppVersion 必须是 semver`);
  }

  const tags = meta.tags === undefined ? [] : meta.tags;
  if (!Array.isArray(tags)) throw new Error(`${META_FILE} 的 tags 必须是数组`);
  if (tags.length > 8) throw new Error(`${META_FILE} 的 tags 最多 8 个`);
  const seenTags = new Set();
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag.trim()) throw new Error(`${META_FILE} 的 tags 必须是非空字符串`);
    if (tag.length > 24) throw new Error(`${META_FILE} 的 tag 过长（最多 24 字符）: ${tag}`);
    if (seenTags.has(tag)) throw new Error(`${META_FILE} 的 tags 有重复: ${tag}`);
    seenTags.add(tag);
  }

  const published = meta.published === undefined ? [] : meta.published;
  if (!Array.isArray(published)) throw new Error(`${META_FILE} 的 published 必须是数组`);

  const seenVersions = new Set();
  for (const entry of published) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`${META_FILE} 的 published 条目必须是对象`);
    }
    const version = String(entry.version || '');
    if (!isValidSemver(version)) throw new Error(`published 版本不是 semver: ${version}`);
    if (seenVersions.has(version)) throw new Error(`published 版本重复: ${version}`);
    seenVersions.add(version);

    if (config) {
      const expectedTag = tagFor(config, manifest.id, version);
      const expectedAsset = assetFor(config, manifest.id, version);
      if (entry.tag !== expectedTag) {
        throw new Error(`published ${version} 的 tag 应为 ${expectedTag}，实际 ${entry.tag}`);
      }
      if (entry.asset !== expectedAsset) {
        throw new Error(`published ${version} 的 asset 应为 ${expectedAsset}，实际 ${entry.asset}`);
      }
    } else {
      if (typeof entry.tag !== 'string' || !entry.tag) throw new Error(`published ${version} 缺少 tag`);
      if (typeof entry.asset !== 'string' || !entry.asset.endsWith('.dlmpet')) {
        throw new Error(`published ${version} 的 asset 必须是 .dlmpet`);
      }
    }

    if (!Number.isInteger(entry.size) || entry.size <= 0) {
      throw new Error(`published ${version} 的 size 必须是正整数`);
    }
    if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`published ${version} 的 sha256 必须是 64 位小写十六进制`);
    }
    if (entry.sourceHash !== undefined && !/^[a-f0-9]{64}$/.test(entry.sourceHash)) {
      throw new Error(`published ${version} 的 sourceHash 必须是 64 位小写十六进制`);
    }
    if (typeof entry.publishedAt !== 'string' || Number.isNaN(Date.parse(entry.publishedAt))) {
      throw new Error(`published ${version} 的 publishedAt 不是有效时间`);
    }
  }

  const latest = latestPublished({ meta });
  if (latest && compareVersions(latest.version, manifest.version) > 0) {
    throw new Error(`已发布版本 ${latest.version} 高于源码版本 ${manifest.version}，请提升 plugin.json 版本号`);
  }
}

/** 按 semver 取最新已发布条目；没有则返回 null */
function latestPublished(plugin) {
  const published = Array.isArray(plugin.meta && plugin.meta.published) ? plugin.meta.published : [];
  let latest = null;
  for (const entry of published) {
    if (!latest || compareVersions(entry.version, latest.version) > 0) latest = entry;
  }
  return latest;
}

function loadAllPlugins(config = null) {
  const plugins = [];
  const errors = [];
  const seen = new Map();

  for (const dir of pluginDirs()) {
    try {
      const plugin = loadPlugin(dir, config);
      if (seen.has(plugin.id)) {
        errors.push(`${path.basename(dir)}: id 与 ${seen.get(plugin.id)} 重复`);
        continue;
      }
      seen.set(plugin.id, path.basename(dir));
      plugin.sourceHash = sourceHash(dir);
      plugins.push(plugin);
    } catch (e) {
      errors.push(`${path.basename(dir)}: ${e.message}`);
    }
  }

  return { plugins, errors };
}

/** 生成一条 index.json 插件记录；未发布返回 null */
function indexEntry(plugin, config) {
  const latest = latestPublished(plugin);
  if (!latest) return null;

  const entry = {
    id: plugin.manifest.id,
    name: plugin.manifest.name,
    version: latest.version,
    description: plugin.manifest.description,
    author: plugin.meta.author || plugin.manifest.author || '',
    apiVersion: plugin.manifest.apiVersion,
    minAppVersion: plugin.meta.minAppVersion || config.defaultMinAppVersion,
    tags: Array.isArray(plugin.meta.tags) ? plugin.meta.tags : [],
    download: {
      url: downloadUrl(config, latest.tag, latest.asset),
      size: latest.size,
      sha256: latest.sha256
    }
  };

  if (plugin.meta.homepage) entry.homepage = plugin.meta.homepage;
  return entry;
}

module.exports = {
  ROOT,
  PLUGINS_DIR,
  META_FILE,
  pluginDirs,
  loadPlugin,
  validateMeta,
  loadAllPlugins,
  latestPublished,
  indexEntry
};
