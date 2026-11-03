/**
 * 把 plugins/<id>/ 打成 .dlmpet
 * ============================================================================
 * 与主程序的打包脚本行为一致：排除依赖目录、旧包、市场元数据与系统垃圾文件。
 * 条目时间固定为 1980-01-01，保证同一份源码在本机重复打包得到相同字节
 * （不同 Node / zlib 版本之间不承诺完全一致，因此发布以实际上传的包为准）。
 */

const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const { listSourceFiles } = require('./source');
const { assetFor } = require('./config');
const { inspectPackage } = require('./package');

const FIXED_TIME = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));

/**
 * @param {{dir: string, id: string, manifest: Object}} plugin 已加载的插件
 * @param {Object} config 市场配置
 * @param {string} outDir 输出目录
 * @returns {{outputPath: string, info: Object}}
 */
function packPlugin(plugin, config, outDir) {
  const files = listSourceFiles(plugin.dir);
  if (!files.some((file) => file.rel === 'plugin.json')) {
    throw new Error('打包列表里缺少 plugin.json');
  }

  fs.mkdirSync(outDir, { recursive: true });
  const outputPath = path.join(outDir, assetFor(config, plugin.id, plugin.manifest.version));

  const zip = new AdmZip();
  for (const file of files) {
    const entry = zip.addFile(file.rel, fs.readFileSync(file.full));
    entry.header.time = FIXED_TIME;
  }
  zip.writeZip(outputPath);

  let info;
  try {
    info = inspectPackage(outputPath);
  } catch (e) {
    try { fs.rmSync(outputPath, { force: true }); } catch (err) { /* 忽略 */ }
    throw new Error(`打包后校验失败（产物已删除）: ${e.message}`);
  }

  if (info.manifest.id !== plugin.id || info.manifest.version !== plugin.manifest.version) {
    try { fs.rmSync(outputPath, { force: true }); } catch (err) { /* 忽略 */ }
    throw new Error(`包内清单与源码不一致: ${info.manifest.id}@${info.manifest.version} / ${plugin.id}@${plugin.manifest.version}`);
  }

  return { outputPath, info };
}

module.exports = { packPlugin };
