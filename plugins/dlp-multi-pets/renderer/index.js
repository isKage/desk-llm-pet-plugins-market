/**
 * 克隆桌宠渲染进程
 * ============================================================================
 * 只负责：播放配置里的动画、拖拽本窗口、单击反应、右键打开原生菜单。
 * 窗口尺寸 / 透明度 / 配置同步由主进程完成。
 */

const state = {
  config: null,
  idle: [],
  click: [],
  drag: null,
  idleInterval: 15000,

  currentIdle: '',
  idleTimer: null,
  isPlayingClick: false,
  placeholderAnimId: null,

  isDragging: false,
  hasMoved: false,
  dragStarted: false,
  startX: 0,
  startY: 0
};

const elements = {
  container: document.getElementById('pet-container'),
  video: document.getElementById('pet-video')
};

function clamp(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(max, Math.max(min, num));
}

async function init() {
  if (!window.multiPetAPI) {
    console.warn('multiPetAPI 不可用，显示占位动画');
    showPlaceholder();
    return;
  }
  await loadConfig();
  setupEvents();
  startIdleTimer();
  playRandomIdle();
}

async function loadConfig() {
  try {
    const config = await window.multiPetAPI.getConfig();
    applyConfig(config, true);
  } catch (e) {
    console.warn('读取配置失败，使用占位动画:', e.message);
    showPlaceholder();
  }
}

function applyConfig(config, initial = false) {
  if (!config || typeof config !== 'object') return;
  const previous = state.config;
  state.config = config;
  state.idle = Array.isArray(config.animations && config.animations.idle)
    ? config.animations.idle.filter((item) => item && item.url)
    : [];
  state.click = Array.isArray(config.animations && config.animations.click)
    ? config.animations.click.filter((item) => item && item.url)
    : [];
  state.drag = config.animations && config.animations.drag ? config.animations.drag : null;
  state.idleInterval = Number(config.idleInterval) > 0 ? Number(config.idleInterval) : 15000;

  applyCrop();
  startIdleTimer();

  const poolsChanged = initial || !samePool(previous && previous.animations && previous.animations.idle, config.animations && config.animations.idle)
    || !samePool(previous && previous.animations && previous.animations.click, config.animations && config.animations.click);

  if (!initial && poolsChanged && !state.isPlayingClick && !state.isDragging) {
    playRandomIdle();
  }
}

function samePool(a, b) {
  const left = Array.isArray(a) ? a.map((item) => item && item.name) : [];
  const right = Array.isArray(b) ? b.map((item) => item && item.name) : [];
  return left.join('\n') === right.join('\n');
}

function applyCrop() {
  const pet = (state.config && state.config.pet) || {};
  const crop = clamp(pet.crop, 0.25, 1, 0.55);
  const offsetX = clamp(pet.cropOffsetX, -50, 50, 0);
  const offsetY = clamp(pet.cropOffsetY, -50, 50, 0);
  elements.container.style.setProperty('--pet-crop', String(crop));
  elements.container.style.setProperty('--pet-offset-x', `${offsetX}%`);
  elements.container.style.setProperty('--pet-offset-y', `${offsetY}%`);
}

function setupEvents() {
  elements.container.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  elements.container.addEventListener('contextmenu', onContextMenu);
  elements.video.addEventListener('error', onVideoError);

  // 不允许把文件拖进克隆窗口导致页面导航
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  if (typeof window.multiPetAPI.onConfigChanged === 'function') {
    window.multiPetAPI.onConfigChanged((config) => applyConfig(config));
  }
}

// ====== 拖拽 ======

function onMouseDown(e) {
  if (e.button !== 0) return;
  state.isDragging = true;
  state.hasMoved = false;
  state.dragStarted = false;
  state.startX = e.screenX;
  state.startY = e.screenY;
  e.preventDefault();
}

function onMouseMove(e) {
  if (!state.isDragging) return;
  const deltaX = e.screenX - state.startX;
  const deltaY = e.screenY - state.startY;
  if (Math.abs(deltaX) <= 3 && Math.abs(deltaY) <= 3) return;

  if (!state.hasMoved) {
    state.hasMoved = true;
    if (state.drag) {
      state.dragStarted = true;
      playVideo(state.drag, true);
    }
  }

  window.multiPetAPI.moveWindow({
    deltaX: Math.round(deltaX),
    deltaY: Math.round(deltaY)
  });
  state.startX = e.screenX;
  state.startY = e.screenY;
}

function onMouseUp() {
  if (!state.isDragging) return;
  state.isDragging = false;
  if (!state.hasMoved) {
    playClickReaction();
  } else {
    if (!state.isPlayingClick) playRandomIdle();
  }
  state.dragStarted = false;
}

// ====== 右键菜单 ======

function onContextMenu(e) {
  e.preventDefault();
  if (typeof window.multiPetAPI.openContextMenu === 'function') {
    window.multiPetAPI.openContextMenu().catch((err) => {
      console.warn('打开菜单失败:', err && err.message);
    });
  }
}

// ====== 动画 ======

function startIdleTimer() {
  if (state.idleTimer) clearInterval(state.idleTimer);
  state.idleTimer = setInterval(() => {
    if (!state.isPlayingClick && !state.isDragging) playRandomIdle();
  }, state.idleInterval);
}

function playRandomIdle() {
  if (state.idle.length === 0) {
    showPlaceholder();
    return;
  }
  let index = Math.floor(Math.random() * state.idle.length);
  if (state.idle.length > 1) {
    let guard = 0;
    while (state.idle[index].name === state.currentIdle && guard < 10) {
      index = Math.floor(Math.random() * state.idle.length);
      guard += 1;
    }
  }
  const anim = state.idle[index];
  state.currentIdle = anim.name;
  playVideo(anim.url, true);
}

function playClickReaction() {
  if (state.isPlayingClick || state.isDragging) return;
  if (state.click.length === 0) {
    shake();
    return;
  }

  state.isPlayingClick = true;
  const anim = state.click[Math.floor(Math.random() * state.click.length)];
  const video = elements.video;
  playVideo(anim.url, false);

  const onEnded = () => {
    video.removeEventListener('ended', onEnded);
    state.isPlayingClick = false;
    if (!state.isDragging) playRandomIdle();
  };
  video.addEventListener('ended', onEnded);

  setTimeout(() => {
    if (!state.isPlayingClick) return;
    state.isPlayingClick = false;
    video.removeEventListener('ended', onEnded);
    if (!state.isDragging) playRandomIdle();
  }, 5000);
}

function playVideo(url, loop) {
  if (!url) {
    showPlaceholder();
    return;
  }
  hidePlaceholder();
  const video = elements.video;
  video.style.display = '';
  video.classList.add('switching');
  video.loop = !!loop;
  video.src = url;
  video.play()
    .then(() => {
      setTimeout(() => video.classList.remove('switching'), 200);
    })
    .catch((err) => {
      console.warn('播放动画失败:', err.message);
      video.classList.remove('switching');
      showPlaceholder();
    });
}

function shake() {
  const container = elements.container;
  container.style.transition = 'transform 0.1s ease';
  container.style.transform = 'translateX(-5px)';
  setTimeout(() => { container.style.transform = 'translateX(5px)'; }, 100);
  setTimeout(() => { container.style.transform = 'translateX(-3px)'; }, 200);
  setTimeout(() => { container.style.transform = 'translateX(0)'; }, 300);
}

function onVideoError() {
  const src = elements.video.src || '';
  console.warn('动画加载失败:', src);
  showPlaceholder();
}

// ====== 占位动画 ======

function hidePlaceholder() {
  const canvas = document.getElementById('placeholder-canvas');
  if (canvas) canvas.style.display = 'none';
  if (state.placeholderAnimId) {
    cancelAnimationFrame(state.placeholderAnimId);
    state.placeholderAnimId = null;
  }
}

function showPlaceholder() {
  const video = elements.video;
  video.style.display = 'none';
  const container = elements.container;

  let canvas = document.getElementById('placeholder-canvas');
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'placeholder-canvas';
    canvas.width = 200;
    canvas.height = 200;
    container.insertBefore(canvas, video);
  }
  canvas.style.display = 'block';
  const context = canvas.getContext('2d');
  let frame = 0;

  if (state.placeholderAnimId) cancelAnimationFrame(state.placeholderAnimId);

  function animate() {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const bounce = Math.sin(frame * 0.1) * 10;
    const bodyY = cy + bounce;

    context.fillStyle = '#8a2be2';
    context.beginPath();
    context.arc(cx, bodyY, 50, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = '#fff';
    context.beginPath();
    context.arc(cx - 15, bodyY - 10, 12, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(cx + 15, bodyY - 10, 12, 0, Math.PI * 2);
    context.fill();

    context.fillStyle = '#1a1a2e';
    context.beginPath();
    context.arc(cx - 15, bodyY - 10, 5, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(cx + 15, bodyY - 10, 5, 0, Math.PI * 2);
    context.fill();

    context.strokeStyle = '#1a1a2e';
    context.lineWidth = 2;
    context.beginPath();
    context.arc(cx, bodyY + 5, 20, 0.1 * Math.PI, 0.9 * Math.PI);
    context.stroke();

    context.fillStyle = '#7b2d8e';
    context.beginPath();
    context.arc(cx - 30, bodyY - 45, 15, 0, Math.PI * 2);
    context.fill();
    context.beginPath();
    context.arc(cx + 30, bodyY - 45, 15, 0, Math.PI * 2);
    context.fill();

    frame += 1;
    state.placeholderAnimId = requestAnimationFrame(animate);
  }

  animate();
}

document.addEventListener('DOMContentLoaded', init);
