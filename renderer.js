const api = window.vmsApi;

const el = (id) => document.getElementById(id);

const LIST_COLLAPSE_MAX = 5;

let inputPaths = [];
/** 与 inputPaths 下标对齐的探测结果，元素为 null 表示尚未完成 */
let probeResults = [];
/** 列表是否展开显示全部（仅当数量大于 LIST_COLLAPSE_MAX 时有效） */
let listExpanded = false;
/** 递增以作废进行中的 refreshProbes（例如清空列表后不再写回旧数量） */
let probeSessionId = 0;
let outputDir = '';
let running = false;
let prefixSaveTimer = null;

function baseNameOnly(fullPath) {
  const s = String(fullPath).replace(/\\/g, '/');
  const i = s.lastIndexOf('/');
  return i >= 0 ? s.slice(i + 1) : s;
}

function mergePathsDedupe(existing, more) {
  const set = new Set([...(existing || []), ...(more || [])]);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function scheduleSaveSettings(partial) {
  if (prefixSaveTimer) clearTimeout(prefixSaveTimer);
  prefixSaveTimer = setTimeout(() => {
    prefixSaveTimer = null;
    api.setSettings(partial).catch(() => {});
  }, 600);
}

function formatDateTimeTag(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function updatePreview() {
  const prefix = el('prefix').value || '';
  const dt = formatDateTimeTag();
  const base = prefix.trim()
    ? `${prefix.trim()}_${dt}_001.mp4`
    : `${dt}_001.mp4`;
  el('previewText').textContent = base;
}

function metaTextForProbe(r) {
  if (r == null) return '正在读取分辨率…';
  if (r.ok) {
    return `原分辨率：${r.width}×${r.height}，时长约 ${r.durationSec.toFixed(1)} 秒`;
  }
  return `无法读取：${r.error || '未知错误'}`;
}

function updateFileListToolbar() {
  const n = inputPaths.length;
  const toolbar = el('fileListToolbar');
  const summary = el('fileListSummary');
  const btn = el('btnToggleFileList');
  if (n === 0) {
    summary.textContent = '';
    summary.innerHTML = '';
    btn.textContent = '展开全部';
    btn.hidden = true;
    btn.removeAttribute('aria-expanded');
    btn.removeAttribute('title');
    toolbar.hidden = true;
    return;
  }
  toolbar.hidden = false;
  if (n <= LIST_COLLAPSE_MAX) {
    summary.innerHTML = `已添加 <strong>${n}</strong> 个视频（已全部展示）`;
    btn.hidden = true;
    listExpanded = false;
    btn.removeAttribute('aria-expanded');
    btn.removeAttribute('title');
  } else {
    const rest = n - LIST_COLLAPSE_MAX;
    if (listExpanded) {
      summary.innerHTML = `已添加 <strong>${n}</strong> 个视频 · <span class="file-list-sub">已全部展开，列表区域可上下滚动</span>`;
      btn.textContent = '▼ 收起列表';
      btn.title = '折叠为仅显示前 5 条，并滚回列表顶部';
    } else {
      summary.innerHTML = `已添加 <strong>${n}</strong> 个视频 · <span class="file-list-sub">当前展示前 ${LIST_COLLAPSE_MAX} 条 · 另有 <strong>${rest}</strong> 条已折叠</span>`;
      btn.textContent = `▶ 展开全部（还有 ${rest} 条）`;
      btn.title = `在下方列表中展开显示全部 ${n} 个文件`;
    }
    btn.hidden = false;
    btn.setAttribute('aria-expanded', listExpanded ? 'true' : 'false');
  }
}

function updateFileListWrapState() {
  const wrap = el('fileListWrap');
  if (!wrap) return;
  const n = inputPaths.length;
  wrap.classList.remove(
    'file-list-wrap--empty',
    'file-list-wrap--short',
    'file-list-wrap--collapsed-long',
    'file-list-wrap--expanded-long'
  );
  if (n === 0) {
    wrap.classList.add('file-list-wrap--empty');
    return;
  }
  if (n <= LIST_COLLAPSE_MAX) {
    wrap.classList.add('file-list-wrap--short');
    return;
  }
  wrap.classList.add(
    listExpanded ? 'file-list-wrap--expanded-long' : 'file-list-wrap--collapsed-long'
  );
}

function renderFileListRows() {
  const ul = el('fileList');
  ul.innerHTML = '';
  const n = inputPaths.length;
  const limit = listExpanded || n <= LIST_COLLAPSE_MAX ? n : LIST_COLLAPSE_MAX;
  for (let i = 0; i < limit; i++) {
    const p = inputPaths[i];
    const r = probeResults[i];
    const li = document.createElement('li');
    const nameEl = document.createElement('div');
    nameEl.className = 'file-name';
    nameEl.textContent = baseNameOnly(p);
    const pathSpan = document.createElement('div');
    pathSpan.className = 'file-path-full';
    pathSpan.textContent = p;
    pathSpan.title = p;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = metaTextForProbe(r);
    li.appendChild(nameEl);
    li.appendChild(pathSpan);
    li.appendChild(meta);
    ul.appendChild(li);
  }
}

function updateFileListUI() {
  updateFileListToolbar();
  renderFileListRows();
  updateFileListWrapState();
}

async function refreshProbes(paths) {
  const session = ++probeSessionId;
  listExpanded = false;
  probeResults = paths.map(() => null);
  updateFileListUI();
  for (let i = 0; i < paths.length; i++) {
    const r = await api.probeMedia(paths[i]);
    if (session !== probeSessionId) return;
    probeResults[i] = r;
    if (session !== probeSessionId) return;
    updateFileListUI();
  }
}

async function setDefaultOutDir() {
  try {
    const desktop = await api.getDesktopPath();
    if (desktop) {
      outputDir = desktop;
      el('outDir').value = desktop;
    }
  } catch {
    /* ignore */
  }
}

async function applyLoadedSettings() {
  try {
    const s = await api.getSettings();
    if (s.lastOutputDir && typeof s.lastOutputDir === 'string') {
      outputDir = s.lastOutputDir;
      el('outDir').value = s.lastOutputDir;
    } else {
      await setDefaultOutDir();
    }
    if (typeof s.lastPrefix === 'string') el('prefix').value = s.lastPrefix;
    el('deleteOriginal').checked =
      typeof s.deleteOriginal === 'boolean' ? s.deleteOriginal : true;
    el('deleteWarn').hidden = !el('deleteOriginal').checked;
    if (s.lastCrf != null && el('crfSelect').querySelector(`option[value="${s.lastCrf}"]`)) {
      el('crfSelect').value = String(s.lastCrf);
    }
    if (typeof s.lastForceReencode === 'boolean') {
      el('forceReencode').checked = s.lastForceReencode;
    } else {
      el('forceReencode').checked = false;
    }
    if (typeof s.lastInterpolate === 'boolean') {
      el('interpolateEnable').checked = s.lastInterpolate;
    } else {
      el('interpolateEnable').checked = false;
    }
    if (
      s.lastInterpolateFps != null &&
      el('interpolateFps').querySelector(`option[value="${String(s.lastInterpolateFps)}"]`)
    ) {
      el('interpolateFps').value = String(s.lastInterpolateFps);
    }
    el('interpolateFps').disabled = !el('interpolateEnable').checked;
    updateInterpolateAdvancedState();

    if (typeof s.lastContentFilter === 'boolean') {
      el('contentFilterEnable').checked = s.lastContentFilter;
    } else {
      el('contentFilterEnable').checked = false;
    }
    if (
      typeof s.lastContentFilterStrength === 'string' &&
      el('contentFilterStrength').querySelector(`option[value="${s.lastContentFilterStrength}"]`)
    ) {
      el('contentFilterStrength').value = s.lastContentFilterStrength;
    }
    el('contentFilterStrength').disabled = !el('contentFilterEnable').checked;
    if (
      typeof s.lastSpeedJitterRange === 'string' &&
      el('speedJitterRange').querySelector(`option[value="${s.lastSpeedJitterRange}"]`)
    ) {
      el('speedJitterRange').value = s.lastSpeedJitterRange;
    }
    el('speedJitterRange').disabled = !el('contentFilterEnable').checked;
    updateContentAdvancedState();
  } catch {
    await setDefaultOutDir();
  }
}

function updateContentAdvancedState() {
  const advanced = el('contentAdvanced');
  if (!advanced) return;
  const enabled = el('contentFilterEnable').checked && !running;
  advanced.classList.toggle('is-disabled', !enabled);
  if (!enabled) advanced.open = false;
}

function updateInterpolateAdvancedState() {
  const advanced = el('interpolateAdvanced');
  if (!advanced) return;
  const enabled = el('interpolateEnable').checked && !running;
  advanced.classList.toggle('is-disabled', !enabled);
  if (!enabled) advanced.open = false;
}

function setRunning(isRun) {
  running = isRun;
  const btn = el('btnStart');
  if (isRun) {
    btn.textContent = '取消';
    btn.classList.remove('primary');
    btn.classList.add('danger');
    btn.disabled = false;
  } else {
    btn.textContent = '开始处理';
    btn.classList.remove('danger');
    btn.classList.add('primary');
    btn.disabled = false;
  }
  el('btnPickVideo').disabled = isRun;
  el('btnPickInputFolder').disabled = isRun;
  el('btnClearInputs').disabled = isRun;
  el('btnToggleFileList').disabled = isRun;
  el('btnPickDir').disabled = isRun;
  el('prefix').disabled = isRun;
  el('crfSelect').disabled = isRun;
  el('deleteOriginal').disabled = isRun;
  el('forceReencode').disabled = isRun;
  el('interpolateEnable').disabled = isRun;
  el('interpolateFps').disabled = isRun || !el('interpolateEnable').checked;
  updateInterpolateAdvancedState();
  el('contentFilterEnable').disabled = isRun;
  el('contentFilterStrength').disabled = isRun || !el('contentFilterEnable').checked;
  el('speedJitterRange').disabled = isRun || !el('contentFilterEnable').checked;
  updateContentAdvancedState();
  el('dropzone').style.pointerEvents = isRun ? 'none' : '';
}

function bindEvents() {
  const unsubUpdate = api.onUpdateStatus((data) => {
    const msg = data && data.message ? String(data.message) : '';
    if (msg) {
      el('statusText').textContent = msg;
    }
    const installBtn = el('btnInstallUpdate');
    if (!installBtn) return;
    if (data && data.type === 'downloaded') {
      installBtn.hidden = false;
      installBtn.disabled = false;
    } else if (data && data.type === 'checking') {
      installBtn.disabled = true;
    } else if (data && data.type === 'error') {
      installBtn.disabled = false;
    }
  });

  el('btnPickVideo').addEventListener('click', async () => {
    const r = await api.openVideoDialog();
    if (r.ok && r.paths && r.paths.length) {
      inputPaths = mergePathsDedupe(inputPaths, r.paths);
      el('statusText').textContent = `列表共 ${inputPaths.length} 个文件，正在读取信息…`;
      await refreshProbes(inputPaths);
      el('statusText').textContent = `列表共 ${inputPaths.length} 个文件`;
    }
  });

  el('btnPickInputFolder').addEventListener('click', async () => {
    const r = await api.openInputFolderDialog();
    if (r.ok && r.paths && r.paths.length) {
      inputPaths = mergePathsDedupe(inputPaths, r.paths);
      el('statusText').textContent = `已从文件夹追加 ${r.paths.length} 个视频，列表共 ${inputPaths.length} 个，正在读取信息…`;
      await refreshProbes(inputPaths);
      el('statusText').textContent = `列表共 ${inputPaths.length} 个文件`;
    } else if (r.ok && (!r.paths || !r.paths.length)) {
      el('statusText').textContent = '该文件夹内未找到支持格式的视频';
    }
  });

  el('btnClearInputs').addEventListener('click', () => {
    probeSessionId += 1;
    inputPaths = [];
    probeResults = [];
    listExpanded = false;
    updateFileListUI();
    el('statusText').textContent = '已清空待处理列表';
  });

  el('btnToggleFileList').addEventListener('click', () => {
    if (inputPaths.length <= LIST_COLLAPSE_MAX) return;
    listExpanded = !listExpanded;
    updateFileListUI();
    const wrap = el('fileListWrap');
    if (wrap && !listExpanded) {
      wrap.scrollTop = 0;
    }
  });

  el('btnPickDir').addEventListener('click', async () => {
    const r = await api.openDirDialog();
    if (r.ok && r.dir) {
      outputDir = r.dir;
      el('outDir').value = r.dir;
      api.setSettings({ lastOutputDir: r.dir }).catch(() => {});
    }
  });

  el('prefix').addEventListener('input', () => {
    updatePreview();
    scheduleSaveSettings({ lastPrefix: el('prefix').value });
  });

  el('deleteOriginal').addEventListener('change', () => {
    el('deleteWarn').hidden = !el('deleteOriginal').checked;
    api.setSettings({ deleteOriginal: el('deleteOriginal').checked }).catch(() => {});
  });

  el('crfSelect').addEventListener('change', () => {
    api.setSettings({ lastCrf: el('crfSelect').value }).catch(() => {});
  });

  el('forceReencode').addEventListener('change', () => {
    api.setSettings({ lastForceReencode: el('forceReencode').checked }).catch(() => {});
  });

  el('interpolateEnable').addEventListener('change', () => {
    const on = el('interpolateEnable').checked;
    el('interpolateFps').disabled = !on;
    updateInterpolateAdvancedState();
    api.setSettings({ lastInterpolate: on }).catch(() => {});
    if (on) api.setSettings({ lastInterpolateFps: el('interpolateFps').value }).catch(() => {});
  });

  el('interpolateFps').addEventListener('change', () => {
    api.setSettings({ lastInterpolateFps: el('interpolateFps').value }).catch(() => {});
  });
  el('interpolateAdvanced').addEventListener('toggle', () => {
    if (el('interpolateAdvanced').classList.contains('is-disabled')) {
      el('interpolateAdvanced').open = false;
    }
  });

  el('contentFilterEnable').addEventListener('change', () => {
    const on = el('contentFilterEnable').checked;
    el('contentFilterStrength').disabled = !on;
    el('speedJitterRange').disabled = !on;
    updateContentAdvancedState();
    api.setSettings({ lastContentFilter: on }).catch(() => {});
    if (on) {
      api
        .setSettings({
          lastContentFilterStrength: el('contentFilterStrength').value,
          lastSpeedJitterRange: el('speedJitterRange').value
        })
        .catch(() => {});
    }
  });

  el('contentFilterStrength').addEventListener('change', () => {
    api.setSettings({ lastContentFilterStrength: el('contentFilterStrength').value }).catch(
      () => {}
    );
  });

  el('speedJitterRange').addEventListener('change', () => {
    api.setSettings({ lastSpeedJitterRange: el('speedJitterRange').value }).catch(() => {});
  });
  el('contentAdvanced').addEventListener('toggle', () => {
    if (el('contentAdvanced').classList.contains('is-disabled')) {
      el('contentAdvanced').open = false;
    }
  });

  const dz = el('dropzone');
  dz.addEventListener('dragover', (e) => {
    e.preventDefault();
    dz.classList.add('drag');
  });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag'));
  dz.addEventListener('drop', async (e) => {
    e.preventDefault();
    dz.classList.remove('drag');
    const files = Array.from(e.dataTransfer.files || []);
    const rawPaths = files.map((f) => f.path).filter(Boolean);
    if (!rawPaths.length) return;
    const expanded = await api.expandInputPaths(rawPaths);
    if (!expanded.length) {
      el('statusText').textContent = '未识别到视频文件（支持拖拽文件或文件夹）';
      return;
    }
    inputPaths = mergePathsDedupe(inputPaths, expanded);
    el('statusText').textContent = `已追加 ${expanded.length} 个，列表共 ${inputPaths.length} 个，正在读取信息…`;
    await refreshProbes(inputPaths);
    el('statusText').textContent = `列表共 ${inputPaths.length} 个文件`;
  });

  el('btnStart').addEventListener('click', async () => {
    if (running) {
      await api.cancelJob();
      return;
    }
    if (!inputPaths.length) {
      el('statusText').textContent = '请先选择视频文件';
      return;
    }
    if (!outputDir) {
      el('statusText').textContent = '请选择导出目录';
      return;
    }
    el('progressBar').style.width = '0%';
    el('logLine').textContent = '';
          el('logLine').title = '';
    el('statusText').textContent = '处理中…';
    setRunning(true);

    const unsubP = api.onProgress(({ pct }) => {
      el('progressBar').style.width = `${Math.round(pct)}%`;
    });
    const unsubS = api.onStage(({ msg }) => {
      el('logLine').textContent = msg;
      el('logLine').title = msg || '';
    });
    try {
      const result = await api.startJob({
        inputPaths,
        outputDir,
        prefix: el('prefix').value,
        deleteOriginal: el('deleteOriginal').checked,
        crf: el('crfSelect').value,
        forceReencode: el('forceReencode').checked,
        interpolate: el('interpolateEnable').checked,
        interpolateFps: el('interpolateFps').value,
        contentFilter: el('contentFilterEnable').checked,
        contentFilterStrength: el('contentFilterStrength').value,
        speedJitterRange: el('speedJitterRange').value
      });
      el('statusText').textContent = '';
      if (result.ok) {
        el('progressBar').style.width = '100%';
        const n = result.results ? result.results.length : 0;
        const last = result.results && result.results[result.results.length - 1];
        if (last && last.finalPath) {
          el('logLine').textContent =
            n > 1 ? `${last.finalPath}（共 ${n} 个输出）` : last.finalPath;
          el('logLine').title = last.finalPath;
          api.showInFolder(last.finalPath);
        } else {
          el('logLine').textContent = '';
        }
        // 若勾选了“处理完成后删除原视频”，导出成功后同步清空待处理列表，避免显示已不存在的源文件。
        if (el('deleteOriginal').checked) {
          probeSessionId += 1;
          inputPaths = [];
          probeResults = [];
          listExpanded = false;
          updateFileListUI();
        }
      } else {
        const err = result.error || '';
        el('progressBar').style.width = '0%';
        if (err.includes('已取消')) {
          el('logLine').textContent = '';
        } else {
          el('logLine').textContent = err;
          el('logLine').title = err || '';
        }
      }
    } finally {
      unsubP();
      unsubS();
      setRunning(false);
    }
  });

  el('btnCheckUpdate').addEventListener('click', async () => {
    const r = await api.checkForUpdates();
    if (!r || !r.ok) {
      el('statusText').textContent = (r && r.error) || '检查更新失败';
    }
  });

  el('btnInstallUpdate').addEventListener('click', async () => {
    const r = await api.installDownloadedUpdate();
    if (!r || !r.ok) {
      el('statusText').textContent = (r && r.error) || '安装更新失败';
    }
  });

  window.addEventListener('beforeunload', () => {
    unsubUpdate();
  });
}

async function init() {
  await applyLoadedSettings();
  try {
    const version = await api.getAppVersion();
    if (version) {
      el('appVersion').textContent = `v${String(version)}`;
    }
  } catch {
    el('appVersion').textContent = 'v--';
  }
  updatePreview();
  bindEvents();
  el('statusText').textContent = '';
}

init();
