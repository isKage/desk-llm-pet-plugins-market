/**
 * 市场配置加载与 URL / tag 约定
 * ============================================================================
 * 所有仓库地址、Pages 地址、Release tag 与包名规则都集中在
 * marketplace.config.json。改仓库名时只改这一个文件，再重新生成索引。
 */

const fs = require('fs');
const path = require('path');
const { isValidSemver } = require('./manifest');

const ROOT = path.resolve(__dirname, '..', '..');
const CONFIG_PATH = path.join(ROOT, 'marketplace.config.json');

function readJson(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    throw new Error(`无法读取 ${path.relative(ROOT, filePath)}: ${e.message}`);
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${path.relative(ROOT, filePath)} 不是合法 JSON: ${e.message}`);
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function fillPattern(pattern, values) {
  return String(pattern)
    .split('{id}').join(values.id)
    .split('{version}').join(values.version);
}

function loadConfig(filePath = CONFIG_PATH) {
  const raw = readJson(filePath);

  if (Number(raw.schemaVersion) !== 1) {
    throw new Error('marketplace.config.json: schemaVersion 必须是 1');
  }

  const repository = String(raw.repository || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('marketplace.config.json: repository 必须是 owner/repo 形式');
  }

  const [owner, repo] = repository.split('/');
  const fallbackBase = /\.github\.io$/i.test(repo)
    ? `https://${repo.toLowerCase()}`
    : `https://${owner.toLowerCase()}.github.io/${repo}`;
  const pagesBaseUrl = String(raw.pagesBaseUrl || fallbackBase).trim().replace(/\/+$/, '');
  try {
    const url = new URL(pagesBaseUrl);
    if (url.protocol !== 'https:') throw new Error('必须是 https');
  } catch (e) {
    throw new Error(`marketplace.config.json: pagesBaseUrl 无效（${e.message}）`);
  }

  const releaseTagPattern = String(raw.releaseTagPattern || '').trim();
  if (!releaseTagPattern.includes('{id}') || !releaseTagPattern.includes('{version}')) {
    throw new Error('marketplace.config.json: releaseTagPattern 必须包含 {id} 与 {version}');
  }

  const assetNamePattern = String(raw.assetNamePattern || '').trim();
  if (!assetNamePattern.includes('{id}') || !assetNamePattern.includes('{version}')) {
    throw new Error('marketplace.config.json: assetNamePattern 必须包含 {id} 与 {version}');
  }
  if (!assetNamePattern.endsWith('.dlmpet')) {
    throw new Error('marketplace.config.json: assetNamePattern 必须以 .dlmpet 结尾');
  }

  const defaultMinAppVersion = String(raw.defaultMinAppVersion || '').trim();
  if (!isValidSemver(defaultMinAppVersion)) {
    throw new Error('marketplace.config.json: defaultMinAppVersion 必须是 semver');
  }

  return {
    schemaVersion: 1,
    repository,
    pagesBaseUrl,
    releaseTagPattern,
    assetNamePattern,
    defaultMinAppVersion
  };
}

function tagFor(config, id, version) {
  return fillPattern(config.releaseTagPattern, { id, version });
}

function assetFor(config, id, version) {
  return fillPattern(config.assetNamePattern, { id, version });
}

function downloadUrl(config, tag, asset) {
  return `https://github.com/${config.repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(asset)}`;
}

function indexUrl(config) {
  return `${config.pagesBaseUrl}/index.json`;
}

function indexPath() {
  return path.join(ROOT, 'docs', 'index.json');
}

module.exports = {
  ROOT,
  CONFIG_PATH,
  loadConfig,
  readJson,
  writeJson,
  fillPattern,
  tagFor,
  assetFor,
  downloadUrl,
  indexUrl,
  indexPath
};
