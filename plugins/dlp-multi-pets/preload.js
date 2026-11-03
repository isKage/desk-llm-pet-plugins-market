/**
 * 多桌宠克隆插件：克隆窗口的 preload
 * 只暴露渲染进程需要的最小 API。
 */

const { contextBridge, ipcRenderer } = require('electron');

const channel = (name) => `plugin:dlp-multi-pets:${name}`;

contextBridge.exposeInMainWorld('multiPetAPI', {
  /** 获取当前主程序配置（pet + 可用动画 URL） */
  getConfig: () => ipcRenderer.invoke(channel('get-config')),
  /** 主程序设置变化时通知（尺寸/透明度由主进程调整，动画与裁剪在这里应用） */
  onConfigChanged: (callback) => {
    ipcRenderer.on(channel('config-changed'), (event, config) => callback(config));
  },
  /** 拖拽：主进程按触发事件的窗口移动，不会误移动主桌宠 */
  moveWindow: (payload) => ipcRenderer.send(channel('move-window'), payload),
  /** 打开克隆窗口的原生右键菜单（克隆 / 删除当前克隆体 / 设置） */
  openContextMenu: () => ipcRenderer.invoke(channel('context-menu')),
  /** 从当前克隆体继续克隆 */
  clone: () => ipcRenderer.invoke(channel('clone')),
  /** 删除当前克隆体（直接关闭窗口） */
  deleteCurrent: () => ipcRenderer.send(channel('delete-current')),
  /** 打开主程序设置页 */
  openSettings: () => ipcRenderer.invoke(channel('open-settings')),
  /** 当前克隆数量 / 当前窗口是否可删除 */
  getWindowInfo: () => ipcRenderer.invoke(channel('window-info'))
});
