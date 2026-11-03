/**
 * 多桌宠克隆插件（主进程）
 * ============================================================================
 * - 右键主桌宠 → 「克隆」：创建一个新的透明桌宠窗口；
 * - 右键克隆体 → 原生菜单 → 「删除当前克隆体」：直接 destroy 窗口，不做隐藏；
 * - 所有克隆体共用主程序 config.json 的 pet / animations 配置；
 * - 主桌宠永远保留；如果主桌宠被隐藏，最后一个克隆体不允许删除。
 *
 * 插件只读写自己的目录和 Electron userData，不修改本体源码。
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { Menu, screen } = require('electron');

/** 空闲动画切换间隔（与本体桌宠一致） */
const IDLE_INTERVAL = 15000;
/** 判断点击反应动画的关键词（与本体 scanAnimationFiles 保持一致） */
const CLICK_REACTION_RE = /点击回应|被吓|被鼠标|拖拽|炸毛|害羞|生气|开心跃动|傲娇/i;
/** 拖拽动画关键词 */
const DRAG_RE = /被鼠标拖拽|拖拽悬空/i;

/** 当前插件上下文 */
let ctx = null;
/** 当前所有克隆窗口 */
const clones = new Set();
/** 配置变化监听 */
let configWatcher = null;
let pollTimer = null;
let syncTimer = null;
let disposed = false;
/** 上一次已同步的 pet/animations 配置签名 */
let lastConfigKey = '';
/** 最近一次成功读取的配置，避免配置文件瞬时写入一半时把克隆体重置为默认值 */
let lastGoodConfig = null;

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

function userDataDir() {
  try {
    return ctx.host.app.getPath('userData');
  } catch (e) {
    return '';
  }
}

function mainConfigPath() {
  const dir = userDataDir();
  return dir ? path.join(dir, 'config.json') : '';
}

function appRoot() {
  try {
    return ctx.host.app.getAppPath();
  } catch (e) {
    return '';
  }
}

function readMainConfig() {
  const file = mainConfigPath();
  if (!file) return null;
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function defaultConfig() {
  return {
    pet: { scale: 1, opacity: 1, crop: 0.55, cropOffsetX: 0, cropOffsetY: 0 },
    animations: { idlePool: [], clickPool: [] }
  };
}

function currentConfig() {
  const raw = readMainConfig();
  if (!raw || typeof raw !== 'object') {
    return lastGoodConfig || defaultConfig();
  }
  const pet = raw.pet && typeof raw.pet === 'object' ? raw.pet : {};
  const animations = raw.animations && typeof raw.animations === 'object' ? raw.animations : {};
  const config = {
    pet: {
      scale: clamp(pet.scale, 0.5, 2, 1),
      opacity: clamp(pet.opacity, 0.2, 1, 1),
      crop: clamp(pet.crop, 0.25, 1, 0.55),
      cropOffsetX: clamp(pet.cropOffsetX, -50, 50, 0),
      cropOffsetY: clamp(pet.cropOffsetY, -50, 50, 0)
    },
    animations: {
      idlePool: Array.isArray(animations.idlePool) ? animations.idlePool.filter((n) => typeof n === 'string') : [],
      clickPool: Array.isArray(animations.clickPool) ? animations.clickPool.filter((n) => typeof n === 'string') : []
    }
  };
  lastGoodConfig = config;
  return config;
}

/** 当前窗口边长（与本体 calcWindowSize 一致） */
function calcWindowSize(pet) {
  const scale = clamp(pet && pet.scale, 0.5, 2, 1);
  const crop = clamp(pet && pet.crop, 0.25, 1, 0.55);
  return Math.max(80, Math.round(300 * scale * crop));
}

// ============================================================================
// 动画素材扫描（只读本体 assets，不复制文件）
// ============================================================================

function assetsRoot() {
  const root = appRoot();
  return root ? path.join(root, 'assets') : '';
}

function scanWebmDir(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && /\.webm$/i.test(entry.name))
    .map((entry) => {
      const full = path.join(dir, entry.name);
      return { name: entry.name, url: pathToFileURL(full).href };
    });
}

function dedupeByName(list) {
  const seen = new Set();
  return list.filter((item) => {
    if (!item || seen.has(item.name)) return false;
    seen.add(item.name);
    return true;
  });
}

/** 返回本体 assets 下的闲置/点击/拖拽动画列表 */
function scanAnimations() {
  const root = assetsRoot();
  if (!root) return { idle: [], click: [], drag: null };

  const idleDir = path.join(root, 'animations', 'idle');
  const clickDir = path.join(root, 'animations', 'click');
  const thumbDir = path.join(root, 'thumb');

  const thumb = scanWebmDir(thumbDir);
  const idle = dedupeByName([
    ...scanWebmDir(idleDir),
    ...thumb.filter((item) => !CLICK_REACTION_RE.test(item.name))
  ]);
  const click = dedupeByName([
    ...scanWebmDir(clickDir),
    ...thumb.filter((item) => CLICK_REACTION_RE.test(item.name))
  ]);

  const all = [...idle, ...click];
  const drag = all.find((item) => DRAG_RE.test(item.name)) || null;
  return { idle, click, drag };
}

function pickPool(all, saved) {
  if (!Array.isArray(saved) || saved.length === 0) return all;
  const filtered = all.filter((item) => saved.includes(item.name));
  return filtered.length > 0 ? filtered : all;
}

/** 发给渲染进程的配置（含可直接播放的 file:// URL） */
function rendererConfig() {
  const cfg = currentConfig();
  const animations = scanAnimations();
  return {
    pet: cfg.pet,
    idleInterval: IDLE_INTERVAL,
    animations: {
      idle: pickPool(animations.idle, cfg.animations.idlePool),
      click: pickPool(animations.click, cfg.animations.clickPool),
      drag: animations.drag ? animations.drag.url : null
    }
  };
}

// ============================================================================
// 窗口
// ============================================================================

function windowOf(event) {
  try {
    const BW = ctx.host.BrowserWindow;
    return BW && typeof BW.fromWebContents === 'function' ? BW.fromWebContents(event.sender) : null;
  } catch (e) {
    return null;
  }
}

function allWindows() {
  try {
    const BW = ctx.host.BrowserWindow;
    return BW && typeof BW.getAllWindows === 'function' ? BW.getAllWindows() : [];
  } catch (e) {
    return [];
  }
}

/** 找本体主桌宠窗口（用于定位、判断是否还能删除最后一个克隆体） */
function findMainPetWindow() {
  return allWindows().find((win) => {
    try {
      if (!win || win.isDestroyed()) return false;
      return /\/renderer\/pet\/pet\.html(?:[?#]|$)/.test(win.webContents.getURL());
    } catch (e) {
      return false;
    }
  }) || null;
}

function lastClone() {
  let last = null;
  for (const win of clones) {
    if (!win.isDestroyed()) last = win;
  }
  return last;
}

function isMac() {
  return process.platform === 'darwin';
}

/** 计算新克隆体的位置：相对来源窗口偏移，并收敛在屏幕可用区域内 */
function nextPosition(sourceWin, size) {
  const offset = 28 + (clones.size % 5) * 28;
  let x;
  let y;

  const source = sourceWin && !sourceWin.isDestroyed()
    ? sourceWin
    : (findMainPetWindow() || lastClone());

  if (source && !source.isDestroyed()) {
    const bounds = source.getBounds();
    x = bounds.x + offset;
    y = bounds.y + offset;
  } else {
    const area = screen.getPrimaryDisplay().workArea;
    x = area.x + area.width - size - 80;
    y = area.y + area.height - size - 80;
  }

  const display = screen.getDisplayNearestPoint({ x, y });
  const area = display.workArea;
  x = Math.min(Math.max(x, area.x + 8), area.x + area.width - size - 8);
  y = Math.min(Math.max(y, area.y + 8), area.y + area.height - size - 8);
  return { x, y };
}

function canDeleteClone(win) {
  if (!win || !clones.has(win)) return false;
  // 还有别的克隆体：删掉这个也不会变成 0 个
  if (clones.size > 1) return true;
  // 只剩最后一个克隆体：只有主桌宠还可见时才允许删除
  const main = findMainPetWindow();
  return !!(main && !main.isDestroyed() && main.isVisible());
}

/** 创建克隆体；sourceWin 为触发「克隆」的窗口（主桌宠或另一个克隆体） */
function createClone(sourceWin) {
  if (disposed) return { success: false, error: '插件已停用' };
  const cfg = currentConfig();
  const size = calcWindowSize(cfg.pet);
  const pos = nextPosition(sourceWin, size);

  let win;
  try {
    win = ctx.createWindow({
      width: size,
      height: size,
      x: pos.x,
      y: pos.y,
      show: false,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      hasShadow: false,
      acceptFirstMouse: true,
      webPreferences: {
        backgroundThrottling: false
      }
    });
  } catch (e) {
    ctx.warn('创建克隆窗口失败:', e.message);
    return { success: false, error: e.message };
  }

  clones.add(win);
  win.on('closed', () => {
    clones.delete(win);
  });
  // 系统关闭（Cmd+W / Alt+F4）也遵守「至少保留一个」：主桌宠隐藏时不允许关掉最后一个克隆体
  win.on('close', (event) => {
    if (!win.__dlpAllowClose && !canDeleteClone(win)) {
      event.preventDefault();
    }
  });

  try {
    win.loadFile(path.join(ctx.dir, 'renderer', 'index.html'));
  } catch (e) {
    ctx.warn('加载克隆页面失败:', e.message);
    clones.delete(win);
    try { win.destroy(); } catch (err) { /* 忽略 */ }
    return { success: false, error: e.message };
  }

  win.setAlwaysOnTop(true, isMac() ? 'screen-saver' : 'floating');
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch (e) { /* 平台不支持时忽略 */ }
  win.setOpacity(cfg.pet.opacity);

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
  });
  // 兜底：某些环境下 ready-to-show 可能很晚才触发
  setTimeout(() => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  }, 2000);

  ctx.log(`已创建克隆体（当前 ${clones.size} 个）`);
  return { success: true, count: clones.size };
}

/** 删除克隆体：直接销毁窗口，不隐藏 */
function deleteClone(win) {
  if (!win || win.isDestroyed() || !clones.has(win)) {
    return { success: false, error: '这不是克隆窗口' };
  }
  if (!canDeleteClone(win)) {
    return { success: false, error: '至少保留一个桌宠形象' };
  }
  clones.delete(win);
  win.__dlpAllowClose = true;
  try {
    win.destroy();
  } catch (e) {
    return { success: false, error: e.message };
  }
  ctx.log(`已删除克隆体（剩余 ${clones.size} 个）`);
  return { success: true, count: clones.size };
}

/** 克隆窗口的右键原生菜单 */
function showCloneMenu(win) {
  if (!win || win.isDestroyed()) return { success: false, error: '窗口不可用' };
  const deletable = canDeleteClone(win);
  const menu = Menu.buildFromTemplate([
    {
      label: '克隆',
      click: () => createClone(win)
    },
    {
      label: '删除当前克隆体',
      enabled: deletable,
      click: () => deleteClone(win)
    },
    { type: 'separator' },
    {
      label: '设置',
      click: () => {
        try {
          if (ctx.host && typeof ctx.host.openSettings === 'function') ctx.host.openSettings();
        } catch (e) { /* 忽略 */ }
      }
    }
  ]);
  menu.popup({ window: win });
  return { success: true };
}

// ============================================================================
// 配置同步
// ============================================================================

function configKey(cfg) {
  return JSON.stringify({ pet: cfg.pet, animations: cfg.animations });
}

/** 主程序设置变化后，把所有克隆体的尺寸/透明度和动画配置同步过去 */
function syncConfig(force = false) {
  if (disposed) return;
  const cfg = currentConfig();
  const key = configKey(cfg);
  if (!force && key === lastConfigKey) return;
  lastConfigKey = key;

  const payload = rendererConfig();
  const size = calcWindowSize(cfg.pet);

  for (const win of clones) {
    if (win.isDestroyed()) {
      clones.delete(win);
      continue;
    }
    try {
      const bounds = win.getBounds();
      if (bounds.width !== size || bounds.height !== size) {
        win.setBounds({ x: bounds.x, y: bounds.y, width: size, height: size });
      }
      win.setOpacity(cfg.pet.opacity);
    } catch (e) {
      ctx.warn('同步克隆体配置失败:', e.message);
    }
  }

  ctx.ipc.send('config-changed', payload);
}

function scheduleSync() {
  if (disposed) return;
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    syncConfig();
  }, 120);
}

function startConfigWatcher() {
  lastConfigKey = configKey(currentConfig());
  const dir = userDataDir();
  if (dir) {
    try {
      configWatcher = fs.watch(dir, (event, filename) => {
        if (!filename || String(filename) === 'config.json') scheduleSync();
      });
    } catch (e) {
      ctx.warn('监听配置文件失败，将使用轮询:', e.message);
    }
  }
  // 轮询兜底：不同平台的 fs.watch 行为不完全一致
  pollTimer = setInterval(() => syncConfig(), 1000);
}

function stopConfigWatcher() {
  if (configWatcher) {
    try { configWatcher.close(); } catch (e) { /* 忽略 */ }
    configWatcher = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (syncTimer) {
    clearTimeout(syncTimer);
    syncTimer = null;
  }
}

function cleanup() {
  if (disposed) return;
  disposed = true;
  stopConfigWatcher();
  for (const win of [...clones]) {
    try {
      win.__dlpAllowClose = true;
      if (!win.isDestroyed()) win.destroy();
    } catch (e) { /* 忽略 */ }
  }
  clones.clear();
}

// ============================================================================
// 插件生命周期
// ============================================================================

module.exports = {
  activate(pluginCtx) {
    ctx = pluginCtx;

    // 克隆体 IPC
    ctx.ipc.handle('get-config', () => rendererConfig());
    ctx.ipc.handle('window-info', (event) => {
      const win = windowOf(event);
      return { cloneCount: clones.size, canDelete: canDeleteClone(win) };
    });
    ctx.ipc.handle('context-menu', (event) => showCloneMenu(windowOf(event)));
    ctx.ipc.handle('clone', (event) => createClone(windowOf(event)));
    // 删除是单向命令：窗口会被销毁，不需要返回 Promise
    ctx.ipc.on('delete-current', (event) => {
      deleteClone(windowOf(event));
    });
    ctx.ipc.handle('open-settings', () => {
      try {
        if (ctx.host && typeof ctx.host.openSettings === 'function') {
          ctx.host.openSettings();
          return { success: true };
        }
      } catch (e) { /* 忽略 */ }
      return { success: false, error: '当前宿主不支持打开设置' };
    });

    // 拖拽：只移动触发事件的克隆窗口
    ctx.ipc.on('move-window', (event, payload) => {
      const win = windowOf(event);
      if (!win || win.isDestroyed() || !clones.has(win)) return;
      const deltaX = Math.round(Number(payload && payload.deltaX) || 0);
      const deltaY = Math.round(Number(payload && payload.deltaY) || 0);
      if (!deltaX && !deltaY) return;
      const bounds = win.getBounds();
      win.setBounds({
        x: bounds.x + deltaX,
        y: bounds.y + deltaY,
        width: bounds.width,
        height: bounds.height
      });
    });

    // 主桌宠 / 托盘菜单里的「克隆」
    ctx.onCommand((command) => {
      if (command === 'clone') {
        createClone(findMainPetWindow() || lastClone());
      }
    });

    // 配置变更：主程序保存设置后，所有克隆体一起变化
    startConfigWatcher();
    ctx.onDeactivate(cleanup);
    ctx.log('多桌宠插件已就绪（右键主桌宠 → 克隆）');
  },

  deactivate() {
    cleanup();
  }
};
