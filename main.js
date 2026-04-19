const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { processJob, probeMedia } = require('./lib/videoProcessor');
const { readSettings, writeSettings } = require('./lib/settingsStore');
const { collectVideosFromDir, expandInputPaths } = require('./lib/scanInputVideos');

function humanizeError(msg) {
  if (!msg) return '未知错误';
  const s = String(msg);
  if (s.includes('ENOSPC') || s.includes('No space left')) return '磁盘空间不足，请清理磁盘后重试。';
  if (s.includes('EACCES') || s.includes('EPERM')) return '没有写入权限，请更换导出目录或以管理员权限重试。';
  if (s.includes('ENOENT')) return '文件或目录不存在，请检查路径。';
  if (s.length > 800) return `${s.slice(0, 800)}…`;
  return s;
}

let mainWindow = null;
let activeController = null;
let updateInitialized = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 920,
    height: 780,
    minWidth: 800,
    minHeight: 640,
    title: '视频元数据处理',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function setupAutoUpdater() {
  if (updateInitialized || !app.isPackaged) return;
  updateInitialized = true;

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    sendToRenderer('update:status', { type: 'checking', message: '正在检查更新…' });
  });
  autoUpdater.on('update-available', (info) => {
    sendToRenderer('update:status', {
      type: 'available',
      version: info && info.version ? String(info.version) : '',
      message: '发现新版本，可选择下载并安装。'
    });
  });
  autoUpdater.on('update-not-available', () => {
    sendToRenderer('update:status', { type: 'none', message: '当前已是最新版本。' });
  });
  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update:status', {
      type: 'downloading',
      message: `更新下载中：${Math.round(progress.percent || 0)}%`
    });
  });
  autoUpdater.on('update-downloaded', (info) => {
    sendToRenderer('update:status', {
      type: 'downloaded',
      version: info && info.version ? String(info.version) : '',
      message: '更新已下载，重启应用后自动安装。'
    });
  });
  autoUpdater.on('error', (e) => {
    sendToRenderer('update:status', {
      type: 'error',
      message: humanizeError(e && e.message ? e.message : String(e))
    });
  });
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

ipcMain.handle('paths:desktop', () => app.getPath('desktop'));
ipcMain.handle('app:version', () => app.getVersion());

ipcMain.handle('update:check', async () => {
  if (!app.isPackaged) {
    return { ok: false, error: '开发环境下不检查更新（仅打包后可用）。' };
  }
  try {
    setupAutoUpdater();
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: humanizeError(e && e.message ? e.message : String(e)) };
  }
});

ipcMain.handle('update:install', async () => {
  if (!app.isPackaged) {
    return { ok: false, error: '开发环境下不可安装更新。' };
  }
  try {
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: humanizeError(e && e.message ? e.message : String(e)) };
  }
});

ipcMain.handle('settings:get', () => {
  const s = readSettings(app.getPath('userData'));
  if (s.lastOutputDir && !fs.existsSync(s.lastOutputDir)) {
    const next = { ...s };
    delete next.lastOutputDir;
    return next;
  }
  return s;
});

ipcMain.handle('settings:set', (_e, partial) => {
  if (!partial || typeof partial !== 'object') return false;
  const safe = {};
  if (typeof partial.lastOutputDir === 'string') safe.lastOutputDir = partial.lastOutputDir;
  if (typeof partial.lastPrefix === 'string') safe.lastPrefix = partial.lastPrefix.slice(0, 200);
  if (typeof partial.deleteOriginal === 'boolean') safe.deleteOriginal = partial.deleteOriginal;
  if (partial.lastCrf != null) safe.lastCrf = String(partial.lastCrf).slice(0, 4);
  if (typeof partial.lastForceReencode === 'boolean') safe.lastForceReencode = partial.lastForceReencode;
  if (typeof partial.lastInterpolate === 'boolean') safe.lastInterpolate = partial.lastInterpolate;
  if (partial.lastInterpolateFps != null)
    safe.lastInterpolateFps = String(partial.lastInterpolateFps).slice(0, 4);
  if (typeof partial.lastContentFilter === 'boolean') safe.lastContentFilter = partial.lastContentFilter;
  if (typeof partial.lastContentFilterStrength === 'string')
    safe.lastContentFilterStrength = partial.lastContentFilterStrength.slice(0, 12);
  if (typeof partial.lastSpeedJitterRange === 'string')
    safe.lastSpeedJitterRange = partial.lastSpeedJitterRange.slice(0, 16);
  writeSettings(app.getPath('userData'), safe);
  return true;
});

ipcMain.handle('media:probe', async (_e, filePath) => {
  try {
    const info = await probeMedia(filePath);
    return { ok: true, ...info };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('dialog:openVideo', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件（可多选，追加到列表）',
    properties: ['openFile', 'multiSelections'],
    filters: [
      {
        name: '视频',
        extensions: ['mp4', 'mov', 'mkv', 'avi', 'flv', 'webm', 'm4v', 'wmv', 'mpeg', 'mpg', '3gp']
      },
      { name: '所有文件', extensions: ['*'] }
    ]
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, paths: [] };
  return { ok: true, paths: r.filePaths };
});

/** 选择输入目录：递归扫描其中所有视频并追加到列表 */
ipcMain.handle('dialog:openInputFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择视频文件夹（可多选；均递归包含子文件夹内视频）',
    properties: ['openDirectory', 'multiSelections'],
    buttonLabel: '添加'
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, paths: [] };
  const set = new Set();
  for (const folder of r.filePaths) {
    collectVideosFromDir(folder, []).forEach((p) => set.add(p));
  }
  const paths = Array.from(set).sort((a, b) => a.localeCompare(b));
  return { ok: true, paths };
});

/** 拖拽：支持文件或文件夹路径混合展开 */
ipcMain.handle('input:expandPaths', async (_e, paths) => {
  return expandInputPaths(paths);
});

ipcMain.handle('dialog:openDir', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: '选择导出文件夹',
    properties: ['openDirectory', 'createDirectory']
  });
  if (r.canceled || !r.filePaths.length) return { ok: false, dir: null };
  return { ok: true, dir: r.filePaths[0] };
});

ipcMain.handle('shell:showItem', async (_e, fullPath) => {
  if (!fullPath) return;
  shell.showItemInFolder(fullPath);
});

ipcMain.handle('job:cancel', async () => {
  if (activeController) {
    activeController.abort();
  }
  return true;
});

ipcMain.handle('job:start', async (_event, payload) => {
  const {
    inputPaths,
    outputDir,
    prefix,
    deleteOriginal,
    crf,
    forceReencode,
    interpolate,
    interpolateFps,
    contentFilter,
    contentFilterStrength,
    speedJitterRange
  } =
    payload || {};
  if (activeController) {
    activeController.abort();
  }
  activeController = new AbortController();
  const signal = activeController.signal;

  const send = (channel, data) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  };

  try {
    const results = await processJob({
      inputPaths,
      outputDir,
      prefix: prefix == null ? '' : String(prefix),
      deleteOriginal: !!deleteOriginal,
      crf: crf == null ? '16' : String(crf),
      forceReencode: !!forceReencode,
      interpolate: !!interpolate,
      interpolateFps: interpolateFps == null ? '60' : String(interpolateFps),
      contentFilter: !!contentFilter,
      contentFilterStrength: contentFilterStrength == null ? 'low' : String(contentFilterStrength),
      speedJitterRange: speedJitterRange == null ? '0.98-1.02' : String(speedJitterRange),
      onProgress: (pct) => send('job:progress', { pct }),
      onStage: (msg) => send('job:stage', { msg }),
      signal
    });
    writeSettings(app.getPath('userData'), {
      lastOutputDir: outputDir,
      lastPrefix: prefix == null ? '' : String(prefix),
      deleteOriginal: !!deleteOriginal,
      lastCrf: crf == null ? '16' : String(crf),
      lastForceReencode: !!forceReencode,
      lastInterpolate: !!interpolate,
      lastInterpolateFps: interpolateFps == null ? '60' : String(interpolateFps),
      lastContentFilter: !!contentFilter,
      lastContentFilterStrength: contentFilterStrength == null ? 'low' : String(contentFilterStrength),
      lastSpeedJitterRange: speedJitterRange == null ? '0.98-1.02' : String(speedJitterRange)
    });
    return { ok: true, results };
  } catch (e) {
    const msg = humanizeError(e && e.message ? e.message : String(e));
    return { ok: false, error: msg };
  } finally {
    activeController = null;
  }
});
