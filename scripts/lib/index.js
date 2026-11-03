/**
 * 生成 / 校验 docs/index.json
 * ============================================================================
 * index.json 是 DeskLLMPet 读取的唯一入口。它只包含「已发布」插件的最新版本，
 * 下载地址由 marketplace.config.json + 发布记录计算，避免手写 URL 出错。
 */

const fs = require('fs');
const { indexEntry } = require('./plugins');
const { indexPath, writeJson, readJson } = require('./config');

/**
 * @param {Object} config
 * @param {Array} plugins 已加载插件
 * @param {Object|null} previous 旧索引（用于在内容未变时保持 updatedAt）
 * @param {Date} [now]
 */
function buildIndex(config, plugins, previous = null, now = new Date()) {
  const entries = plugins
    .map((plugin) => indexEntry(plugin, config))
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));

  const sameAsBefore = !!previous
    && Array.isArray(previous.plugins)
    && JSON.stringify(previous.plugins) === JSON.stringify(entries);

  return {
    schemaVersion: 1,
    updatedAt: sameAsBefore && typeof previous.updatedAt === 'string'
      ? previous.updatedAt
      : now.toISOString(),
    plugins: entries
  };
}

function readExistingIndex() {
  try {
    return readJson(indexPath());
  } catch (e) {
    return null;
  }
}

function writeIndex(index) {
  writeJson(indexPath(), index);
}

/** 内容比较时忽略 updatedAt（时间戳本身不构成变更） */
function sameIndex(a, b) {
  if (!a || !b) return false;
  if (a.schemaVersion !== b.schemaVersion) return false;
  return JSON.stringify(a.plugins) === JSON.stringify(b.plugins);
}

/** 检查 docs/index.json 是否与当前插件状态一致；返回差异说明数组 */
function indexDiff(index) {
  const existing = readExistingIndex();
  if (!existing) return ['docs/index.json 不存在'];
  if (sameIndex(existing, index)) return [];
  return ['docs/index.json 与插件源码/发布记录不一致，请运行 npm run index'];
}

/** 校验索引自身结构；返回错误数组 */
function validateIndex(config, index) {
  const errors = [];
  if (!index || typeof index !== 'object' || Array.isArray(index)) {
    return ['index.json 必须是对象'];
  }
  if (index.schemaVersion !== 1) errors.push('schemaVersion 必须是 1');
  if (typeof index.updatedAt !== 'string' || Number.isNaN(Date.parse(index.updatedAt))) {
    errors.push('updatedAt 不是有效时间');
  }
  if (!Array.isArray(index.plugins)) {
    errors.push('plugins 必须是数组');
    return errors;
  }

  const seen = new Set();
  for (const plugin of index.plugins) {
    if (!plugin || typeof plugin !== 'object') {
      errors.push('plugins 条目必须是对象');
      continue;
    }
    if (!plugin.id || seen.has(plugin.id)) errors.push(`插件 id 缺失或重复: ${plugin.id}`);
    seen.add(plugin.id);
    if (!plugin.name || !plugin.version || !plugin.description) {
      errors.push(`${plugin.id}: name / version / description 不能为空`);
    }
    if (!Number.isInteger(plugin.apiVersion) || plugin.apiVersion < 1) {
      errors.push(`${plugin.id}: apiVersion 非法`);
    }
    if (!plugin.minAppVersion) errors.push(`${plugin.id}: 缺少 minAppVersion`);
    if (!Array.isArray(plugin.tags)) errors.push(`${plugin.id}: tags 必须是数组`);
    const download = plugin.download;
    if (!download || typeof download.url !== 'string') {
      errors.push(`${plugin.id}: 缺少 download.url`);
      continue;
    }
    const expectedHost = 'github.com';
    try {
      const url = new URL(download.url);
      if (url.protocol !== 'https:' || url.hostname !== expectedHost) {
        errors.push(`${plugin.id}: 下载地址必须是 https://${expectedHost}/...`);
      }
      if (!url.pathname.startsWith(`/${config.repository}/releases/download/`)) {
        errors.push(`${plugin.id}: 下载地址必须位于 ${config.repository} 的 Releases`);
      }
    } catch (e) {
      errors.push(`${plugin.id}: download.url 不是有效 URL`);
    }
    if (!Number.isInteger(download.size) || download.size <= 0) errors.push(`${plugin.id}: download.size 非法`);
    if (typeof download.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(download.sha256)) {
      errors.push(`${plugin.id}: download.sha256 非法`);
    }
  }

  return errors;
}

module.exports = {
  buildIndex,
  readExistingIndex,
  writeIndex,
  sameIndex,
  indexDiff,
  validateIndex
};
