const fs = require('fs');
const path = require('path');

/** 与界面、处理逻辑一致的可识别视频扩展名 */
const VIDEO_EXT = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.avi',
  '.flv',
  '.webm',
  '.m4v',
  '.wmv',
  '.mpeg',
  '.mpg',
  '.3gp'
]);

/**
 * 递归收集目录下所有视频文件（含子文件夹）
 */
function collectVideosFromDir(rootDir, out = []) {
  if (!rootDir || !fs.existsSync(rootDir)) return out;
  const st = fs.statSync(rootDir);
  if (!st.isDirectory()) return out;
  let entries;
  try {
    entries = fs.readdirSync(rootDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.')) continue;
    const full = path.join(rootDir, ent.name);
    try {
      if (ent.isDirectory()) {
        collectVideosFromDir(full, out);
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (VIDEO_EXT.has(ext)) out.push(full);
      }
    } catch {
      /* 跳过无权限等 */
    }
  }
  return out;
}

/**
 * 路径列表：文件则按扩展名过滤；目录则递归扫描
 */
function expandInputPaths(paths) {
  if (!Array.isArray(paths)) return [];
  const out = new Set();
  for (const p of paths) {
    if (!p || typeof p !== 'string') continue;
    try {
      if (!fs.existsSync(p)) continue;
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        collectVideosFromDir(p, []).forEach((x) => out.add(x));
      } else if (st.isFile()) {
        const ext = path.extname(p).toLowerCase();
        if (VIDEO_EXT.has(ext)) out.add(p);
      }
    } catch {
      /* skip */
    }
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

module.exports = { collectVideosFromDir, expandInputPaths, VIDEO_EXT };
