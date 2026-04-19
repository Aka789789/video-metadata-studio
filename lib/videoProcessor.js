const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getFfmpegPath } = require('./ffmpegPaths');

const TARGET_W = 1080;
const TARGET_H = 1920;

const DEVICE_POOL = [
  'iPhone 16 Pro Max',
  'iPhone 16 Pro',
  'iPhone 16 Plus',
  'iPhone 16',
  'iPhone 15 Pro Max',
  'iPhone 15 Pro',
  'iPhone 15',
  'iPhone 14 Pro',
  'HUAWEI Mate 70 Pro',
  'HUAWEI Mate 70',
  'HUAWEI Pura 80 Ultra',
  'HUAWEI Pura 70 Pro',
  'Xiaomi 15 Ultra',
  'Xiaomi 15',
  'Xiaomi 14 Ultra',
  'Redmi K80 Pro',
  'OPPO Find X8 Ultra',
  'OPPO Find X8',
  'OPPO Reno13 Pro',
  'vivo X200 Pro',
  'vivo X200',
  'HONOR Magic7 Pro',
  'HONOR Magic7',
  'Samsung Galaxy S25 Ultra',
  'Samsung Galaxy S25+',
  'Samsung Galaxy S24 Ultra',
  'Google Pixel 9 Pro XL',
  'Google Pixel 9 Pro',
  'OnePlus 13',
  'realme GT7 Pro',
  'Nothing Phone (3)'
];

const OS_VER_POOL = [
  'iOS 19.0',
  'iOS 18.6',
  'iOS 18.5',
  'iOS 18.4.1',
  'iOS 18.3',
  'HarmonyOS NEXT 5.0',
  'HarmonyOS 4.3',
  'HarmonyOS 4.2',
  'Android 16',
  'Android 15',
  'Android 14',
  'HyperOS 2.0',
  'MIUI 15',
  'ColorOS 15',
  'OriginOS 5',
  'OneUI 7.0',
  'realme UI 6.0',
  'Nothing OS 3.0'
];

const KEYWORD_POOL_EN = [
  'mobile,vertical,short',
  'vlog,social,clip',
  'daily,life,record',
  'casual,outdoor,phone',
  'family,moment,share',
  'travel,street,4k',
  'creator,content,reel',
  'story,memories,auto'
];

const DESCRIPTION_POOL_EN = [
  'Casual clip recorded with built-in camera app.',
  'Personal mobile video. No edit metadata retained.',
  'Smartphone capture for sharing.',
  'Vertical handheld recording.',
  'Auto exposure and stabilization on device.'
];

const SYNOPSIS_POOL_EN = [
  'Short mobile recording.',
  'Phone capture, default camera.',
  'Handheld vertical clip.',
  'Everyday smartphone footage.'
];

const TITLE_ZH_POOL = ['随手拍', '生活记录', '手机录像', '日常片段', '短片', '记录'];

const GENRE_POOL = ['Home Video', 'Personal', 'Movies', 'Clip', 'Uncategorized'];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function pick(arr) {
  return arr[randomInt(0, arr.length - 1)];
}

/** 伪造 iOS 风格内部版本号，如 22E240 */
function randomFakeIosBuild() {
  const major = randomInt(21, 24);
  const letter = String.fromCharCode(65 + randomInt(0, 25));
  const tail = randomInt(100, 999);
  return `${major}${letter}${tail}`;
}

function inferMake(device) {
  const d = device.toLowerCase();
  if (d.includes('iphone') || d.includes('ipad')) return 'Apple Inc.';
  if (d.includes('huawei')) return 'HUAWEI';
  if (d.includes('xiaomi') || d.includes('redmi')) return 'Xiaomi';
  if (d.includes('oppo') || d.includes('reno')) return 'OPPO';
  if (d.includes('vivo')) return 'vivo';
  if (d.includes('honor')) return 'HONOR';
  if (d.includes('samsung') || d.includes('galaxy')) return 'Samsung';
  if (d.includes('google') || d.includes('pixel')) return 'Google';
  if (d.includes('oneplus')) return 'OnePlus';
  if (d.includes('realme')) return 'realme';
  if (d.includes('nothing')) return 'Nothing';
  return 'Generic';
}

function isAppleFamily(device) {
  return /iphone|ipad|ipod/i.test(device);
}

function randomPurchaseDate() {
  const y = randomInt(2021, 2025);
  const m = randomInt(1, 12);
  const day = randomInt(1, 28);
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(day)}`;
}

/**
 * 将若干键值展开为 ffmpeg -metadata 参数（值内避免出现未转义的 =）
 */
function flattenMetadataKvs(entries) {
  const out = [];
  for (const [k, v] of entries) {
    if (v === undefined || v === null) continue;
    const s = String(v).replace(/[\r\n]/g, ' ').trim();
    if (!s.length) continue;
    out.push('-metadata', `${k}=${s}`);
  }
  return out;
}

/** 流级元数据：常见「Core Media / Handler」风格 */
function buildStreamMetadataArgs(hasAudio) {
  const videoHandlers = [
    'Core Media Video',
    'VideoHandler',
    'Core Media Video (Apple)'
  ];
  const audioHandlers = [
    'Core Media Audio',
    'SoundHandler',
    'Core Media Audio (Apple)'
  ];
  const vh = pick(videoHandlers);
  const out = ['-metadata:s:v:0', `handler_name=${vh}`];
  if (hasAudio) {
    out.push('-metadata:s:a:0', `handler_name=${pick(audioHandlers)}`);
  }
  return out;
}

function buildQuicktimeStyleMetadata(device, osVer, ct) {
  if (!isAppleFamily(device)) return [];
  const build = randomFakeIosBuild();
  const safeModel = device.replace(/=/g, '-');
  return flattenMetadataKvs([
    ['com.apple.quicktime.make', 'Apple'],
    ['com.apple.quicktime.model', safeModel],
    ['com.apple.quicktime.software', `${osVer} (${build})`],
    ['com.apple.quicktime.creationdate', ct],
    ['com.apple.quicktime.description', pick(DESCRIPTION_POOL_EN)],
    ['com.apple.quicktime.keywords', pick(KEYWORD_POOL_EN)],
    ['com.apple.quicktime.displayname', safeModel],
    ['com.apple.quicktime.information', `Recorded with ${safeModel}, ${osVer}.`],
    ['com.apple.quicktime.narration', pick(['off', 'none', 'disabled'])],
    ['com.apple.quicktime.title', pick(TITLE_ZH_POOL)],
    ['com.apple.quicktime.genre', pick(GENRE_POOL)]
  ]);
}

function buildAndroidStyleMetadata(device, osVer) {
  const d = device.toLowerCase();
  const api = pick(['35', '34', '33', '36']);
  const patch = randomInt(1, 12);
  const common = flattenMetadataKvs([
    ['com.android.version', api],
    ['com.android.manufacturer', inferMake(device)],
    ['android.build.display.id', `BP${patch}.${randomInt(10, 99)}.${randomInt(100000, 999999)}`],
    ['android.build.version.release', pick(['15', '16', '14'])],
    ['android.build.version.sdk', api],
    ['android.build.type', 'user'],
    ['android.build.tags', 'release-keys'],
    ['ro.product.model', device.replace(/=/g, '-')],
    ['ro.boot.hardware', pick(['qcom', 'exynos', 'mediatek', 'kirin', 'tensor'])],
    ['ro.build.fingerprint', `generic/${pick(['user', 'release'])}/${randomInt(10, 99)}`],
    ['ro.build.version.incremental', `${randomInt(10000000, 99999999)}`],
    ['ro.build.version.security_patch', randomPurchaseDate()],
    ['ro.build.description', `${osVer} user release-keys`]
  ]);
  const brand = [];
  if (d.includes('xiaomi') || d.includes('redmi')) {
    brand.push(
      ...flattenMetadataKvs([
        ['hyperos.version', pick(['OS2.0.8.0', 'OS2.0.12.0', 'OS1.0.45.0', 'OS2.0.200.0'])],
        ['miui.version', pick(['V816.0.5.0', 'V815.0.2.0', 'V817.0.1.0'])]
      ])
    );
  }
  if (d.includes('oppo') || d.includes('reno')) {
    brand.push(
      ...flattenMetadataKvs([
        ['coloros.version', pick(['V15.0.0', 'V15.0.2', 'V14.0.5', 'V15.1.0'])]
      ])
    );
  }
  if (d.includes('vivo')) {
    brand.push(
      ...flattenMetadataKvs([
        ['originos.version', pick(['5.0', '5.1', '4.0', '5.2'])],
        ['funtouch.version', pick(['15.0', '14.1', '15.1'])]
      ])
    );
  }
  if (d.includes('oneplus')) {
    brand.push(
      ...flattenMetadataKvs([
        ['oxygenos.version', pick(['15.0', '15.0.1', '14.0.12', '15.0.2'])]
      ])
    );
  }
  if (d.includes('samsung')) {
    brand.push(
      ...flattenMetadataKvs([
        ['oneui.version', pick(['7.0', '6.1', '6.0', '7.1'])],
        ['sec.patch', randomPurchaseDate()]
      ])
    );
  }
  if (d.includes('google') || d.includes('pixel')) {
    brand.push(
      ...flattenMetadataKvs([
        ['google.build.id', `BP${patch}.${randomInt(10, 99)}`],
        ['vendor.patch', randomPurchaseDate()]
      ])
    );
  }
  if (d.includes('huawei')) {
    brand.push(
      ...flattenMetadataKvs([
        ['emui.version', pick(['14.2.0', '15.0.0', '14.0.5'])],
        ['hw_sc.build.platform.version', pick(['5.0.0', '4.3.0', '5.1.0'])]
      ])
    );
  }
  if (d.includes('honor')) {
    brand.push(
      ...flattenMetadataKvs([
        ['magicos.version', pick(['9.0', '8.0', '9.1'])],
        ['honor.build', pick(['MagicOS 9.0.0', 'MagicOS 8.0.2'])]
      ])
    );
  }
  if (d.includes('realme')) {
    brand.push(
      ...flattenMetadataKvs([
        ['realmeui.version', pick(['6.0', '5.0', '6.1'])],
        ['rmx.build', pick(['RMX5060', 'RMX5010', 'RMX3850'])]
      ])
    );
  }
  if (d.includes('nothing')) {
    brand.push(
      ...flattenMetadataKvs([
        ['nothingos.version', pick(['3.0', '2.5', '3.0.1'])]
      ])
    );
  }
  return [...common, ...brand];
}

/** 生成与原文件无关的随机时间（过去 400～2000 天内） */
function randomCreationTime() {
  const now = Date.now();
  const daysAgo = randomInt(400, 2000);
  const t = new Date(now - daysAgo * 86400000 - randomInt(0, 86400000));
  const pad = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}T${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}.000000Z`;
}

function buildMetadataArgs(device, osVer, fingerprint, ext) {
  const ct = randomCreationTime();
  const blank = ' ';
  const software = `${device}; ${osVer}`;
  const make = inferMake(device);
  const safeModel = device.replace(/=/g, '-');
  const keywords = pick(KEYWORD_POOL_EN);
  const desc = pick(DESCRIPTION_POOL_EN);
  const syn = pick(SYNOPSIS_POOL_EN);
  const titleZh = pick(TITLE_ZH_POOL);
  const genre = pick(GENRE_POOL);
  const grouping = `grp-${crypto.randomBytes(5).toString('hex')}`;
  const assetId = crypto.randomBytes(8).toString('hex');
  const sessionId = crypto.randomBytes(6).toString('hex');
  const year = ct.slice(0, 10).slice(0, 4);
  const track = String(randomInt(1, 12));
  const bitrateHint = pick(['8 Mbps VBR', '12 Mbps VBR', 'Auto VBR', 'HEVC preferred off']);

  const global = flattenMetadataKvs([
    ['title', titleZh],
    ['artist', blank],
    ['album', blank],
    ['album_artist', blank],
    ['encoder', software],
    ['software', software],
    ['comment', `${fingerprint};asset=${assetId};sid=${sessionId}`],
    ['copyright', blank],
    ['description', desc],
    ['synopsis', syn],
    ['genre', genre],
    ['keywords', `${keywords};uid=${assetId}`],
    ['grouping', grouping],
    ['compilation', '0'],
    ['creation_time', ct],
    ['date', ct.slice(0, 10)],
    ['year', year],
    ['track', track],
    ['disc', '1'],
    ['make', make],
    ['model', safeModel],
    ['purchase_date', randomPurchaseDate()],
    ['network', blank],
    ['episode_id', blank],
    ['show', blank],
    ['rating', '0'],
    ['sort_name', titleZh],
    ['sort_album', blank],
    ['sort_artist', blank],
    ['composer', blank],
    ['lyrics', blank],
    ['publisher', blank],
    ['encoded_by', `${make} Camera`],
    ['language', pick(['und', 'mul', 'zho'])],
    ['recording_hint', bitrateHint],
    ['reel_name', `CAM${randomInt(100, 999)}`],
    ['scene', pick(['default', 'auto', 'indoor', 'outdoor'])],
    ['user_comment', pick(['auto', 'none', 'default'])],
    ['category', pick(['Selfie', 'Video', 'Memories', 'General'])],
    ['content_id', assetId],
    ['episode_sort', String(randomInt(0, 5))],
    ['season_number', String(randomInt(0, 1))],
    ['gapless_playback', pick(['0', '-1'])],
    ['podcast', '0'],
    ['hd_video', pick(['0', '1'])],
    ['stereo', pick(['1', '0'])],
    ['media_type_name', pick(['Movie', 'Normal', 'Music Video', 'Home Movie'])]
  ]);

  let platformExtras = [];
  if (isAppleFamily(device) && ['.mov', '.mp4', '.m4v'].includes(ext)) {
    platformExtras = buildQuicktimeStyleMetadata(device, osVer, ct);
  } else if (!isAppleFamily(device)) {
    platformExtras = buildAndroidStyleMetadata(device, osVer);
  }

  const out = ['-map_metadata', '-1', ...global, ...platformExtras];
  if (ext === '.mp4' || ext === '.m4v') {
    out.push(
      '-metadata',
      'major_brand=isom',
      '-metadata',
      'minor_version=512',
      '-metadata',
      'compatible_brands=isomiso2avc1mp41'
    );
  }
  return out;
}

function formatFlagsForExt(ext) {
  switch (ext) {
    case '.mp4':
    case '.m4v':
      return ['-f', 'mp4', '-movflags', '+faststart+use_metadata_tags'];
    case '.mov':
      return ['-f', 'mov', '-movflags', '+use_metadata_tags'];
    case '.mkv':
      return ['-f', 'matroska'];
    case '.avi':
      return ['-f', 'avi'];
    case '.flv':
      return ['-f', 'flv'];
    default:
      return ['-f', 'mp4', '-movflags', '+faststart+use_metadata_tags'];
  }
}

/** 使用 ffmpeg -i 解析宽高、时长、是否有音频（不依赖 ffprobe） */
function probeMedia(inputPath) {
  const ffmpegPath = getFfmpegPath();
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', inputPath], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('error', reject);
    child.on('close', () => {
      let width = 0;
      let height = 0;
      const lines = stderr.split('\n');
      for (const line of lines) {
        if (line.includes('Video:')) {
          const m = line.match(/(\d{2,5})x(\d{2,5})/);
          if (m) {
            width = parseInt(m[1], 10);
            height = parseInt(m[2], 10);
            break;
          }
        }
      }
      let durationSec = 0;
      const dm = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}\.\d+)/);
      if (dm) {
        durationSec =
          parseInt(dm[1], 10) * 3600 + parseInt(dm[2], 10) * 60 + parseFloat(dm[3]);
      }
      const hasAudio = /Stream\s+#\d+:\d+.*Audio:/.test(stderr);
      if (!width || !height) {
        reject(new Error('无法解析视频分辨率，文件可能不是有效视频或格式不受支持。'));
        return;
      }
      resolve({ width, height, durationSec, hasAudio });
    });
  });
}

function fileMd5(filePath) {
  const hash = crypto.createHash('md5');
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
      hash.update(buf.subarray(0, n));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function validateOutputVideo(ffmpegPath, outputPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-i', outputPath], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    let stderr = '';
    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });
    child.on('close', () => {
      const ok = /Duration:/.test(stderr) && /Video:/.test(stderr);
      const st = fs.statSync(outputPath);
      if (!ok || st.size < 32) {
        reject(new Error('导出文件校验失败：无法读取有效视频信息或文件过小。'));
        return;
      }
      resolve();
    });
  });
}

function getExt(filePath) {
  const e = path.extname(filePath).toLowerCase();
  if (['.mp4', '.m4v', '.mov', '.mkv', '.avi', '.flv'].includes(e)) return e;
  return '.mp4';
}

function formatDateTimeTag(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * 从 preferredSeq 起递增，直到找到不存在的文件名（避免覆盖历史文件）
 */
function pickUniqueFinalPath(outputDir, prefix, dtTag, ext, preferredSeq = 1) {
  const basePrefix = prefix.trim();
  for (let seq = preferredSeq; seq < 10000; seq++) {
    const seqStr = String(seq).padStart(3, '0');
    const name = basePrefix
      ? `${basePrefix}_${dtTag}_${seqStr}${ext}`
      : `${dtTag}_${seqStr}${ext}`;
    const full = path.join(outputDir, name);
    if (!fs.existsSync(full)) return { full, seqStr };
  }
  throw new Error('无法生成唯一文件名，请清理导出目录后重试。');
}

/**
 * 运行 ffmpeg，解析 -progress 输出到 stdout
 */
function runFfmpegWithProgress(args, durationSec, onProgress, signal) {
  const ffmpegPath = getFfmpegPath();
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const onAbort = () => {
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    let stderr = '';
    child.stderr.on('data', (d) => {
      const chunk = d.toString();
      stderr += chunk;
      const tm = chunk.match(/time=(\d{2}):(\d{2}):(\d{2}\.\d+)/);
      if (tm && durationSec > 0 && typeof onProgress === 'function') {
        const sec =
          parseInt(tm[1], 10) * 3600 +
          parseInt(tm[2], 10) * 60 +
          parseFloat(tm[3]);
        onProgress(Math.min(99.9, (sec / durationSec) * 100));
      }
    });

    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString();
      const parts = buf.split('\n');
      buf = parts.pop() || '';
      for (const line of parts) {
        if (line.startsWith('out_time_ms=')) {
          const ms = parseInt(line.split('=')[1], 10);
          if (!Number.isFinite(ms) || !durationSec) continue;
          const pct = Math.min(99.9, (ms / 1e6 / durationSec) * 100);
          if (typeof onProgress === 'function') onProgress(pct);
        }
      }
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (signal && signal.aborted) {
        reject(new Error('已取消'));
        return;
      }
      if (code === 0) {
        if (typeof onProgress === 'function') onProgress(100);
        resolve(stderr);
      } else reject(new Error(stderr.trim() || `FFmpeg 退出码 ${code}`));
    });
  });
}

function normalizeCrf(v) {
  if (v == null || v === '') return '16';
  const n = parseInt(String(v), 10);
  if (Number.isFinite(n) && n >= 14 && n <= 28) return String(n);
  return '16';
}

function normalizeInterpolateFps(v) {
  if (v == null || v === '') return 60;
  const n = parseInt(String(v), 10);
  if (Number.isFinite(n) && n >= 48 && n <= 240) return n;
  return 60;
}

function normalizeSpeedFactor(v) {
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0.95 && n <= 1.05) return n;
  return 1;
}

function parseSpeedJitterRange(v) {
  const s = String(v == null ? '' : v).trim();
  const m = s.match(/^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/);
  if (!m) return { min: 0.98, max: 1.02 };
  let min = Number(m[1]);
  let max = Number(m[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0.98, max: 1.02 };
  if (min > max) [min, max] = [max, min];
  min = Math.max(0.95, Math.min(1.05, min));
  max = Math.max(0.95, Math.min(1.05, max));
  if (max - min < 0.0001) return { min: 0.98, max: 1.02 };
  return { min, max };
}

function normalizeContentFilterStrength(v) {
  const s = String(v == null ? '' : v).toLowerCase();
  if (s === 'high') return 'high';
  if (s === 'mid' || s === 'medium') return 'mid';
  return 'low';
}

function buildContentFilterVf(strength) {
  // 内容微扰以色彩微调为主：尽量避免加噪导致码率暴涨
  const st = normalizeContentFilterStrength(strength);
  const base = {
    low: {
      contrast: [1.006, 1.014],
      brightness: [0.003, 0.009],
      saturation: [1.008, 1.022],
      gamma: [0.992, 1.008],
      hueDeg: [-0.8, 0.8]
    },
    mid: {
      contrast: [1.012, 1.024],
      brightness: [0.006, 0.014],
      saturation: [1.015, 1.036],
      gamma: [0.986, 1.014],
      hueDeg: [-1.5, 1.5]
    },
    high: {
      contrast: [1.02, 1.04],
      brightness: [0.01, 0.02],
      saturation: [1.025, 1.055],
      gamma: [0.978, 1.022],
      hueDeg: [-2.3, 2.3]
    }
  }[st];
  const contrast = randomFloat(base.contrast[0], base.contrast[1]).toFixed(4);
  const brightness = randomFloat(base.brightness[0], base.brightness[1]).toFixed(4);
  const saturation = randomFloat(base.saturation[0], base.saturation[1]).toFixed(4);
  const gamma = randomFloat(base.gamma[0], base.gamma[1]).toFixed(4);
  const hueDeg = randomFloat(base.hueDeg[0], base.hueDeg[1]).toFixed(3);
  return `eq=contrast=${contrast}:brightness=${brightness}:saturation=${saturation}:gamma=${gamma},hue=h=${hueDeg}`;
}

function buildAudioTempoFilters(speedFactor) {
  const atempo = 1 / normalizeSpeedFactor(speedFactor);
  // 0.98~1.02 范围单个 atempo 即可；此处保留通用拆分逻辑
  const filters = [];
  let x = atempo;
  while (x < 0.5) {
    filters.push('atempo=0.5');
    x /= 0.5;
  }
  while (x > 2.0) {
    filters.push('atempo=2.0');
    x /= 2.0;
  }
  filters.push(`atempo=${x.toFixed(6)}`);
  return filters;
}

async function processOneFile({
  inputPath,
  outputDir,
  prefix,
  dtTag,
  seqStart,
  deleteOriginal,
  crf,
  forceReencode,
  interpolate,
  interpolateFps,
  contentFilter,
  contentFilterStrength,
  speedJitterRange,
  onProgress,
  onStage,
  signal
}) {
  const ffmpegPath = getFfmpegPath();
  const ext = getExt(inputPath);
  const { width, height, durationSec, hasAudio } = await probeMedia(inputPath);
  const device = DEVICE_POOL[randomInt(0, DEVICE_POOL.length - 1)];
  const osVer = OS_VER_POOL[randomInt(0, OS_VER_POOL.length - 1)];
  const fingerprint = `id-${crypto.randomBytes(16).toString('hex')}`;

  const md5In = fileMd5(inputPath);

  const pickedName = pickUniqueFinalPath(outputDir, prefix, dtTag, ext, seqStart);
  const finalPath = pickedName.full;
  const finalName = path.basename(finalPath);

  const tempBase = `._vms_work_${crypto.randomBytes(8).toString('hex')}`;
  const tempPath = path.join(outputDir, `${tempBase}${ext}`);

  if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);

  const metaArgs = buildMetadataArgs(device, osVer, fingerprint, ext);
  const streamMetaArgs = buildStreamMetadataArgs(hasAudio);
  const isExact = width === TARGET_W && height === TARGET_H;
  const mux = formatFlagsForExt(ext);
  const doInterp = !!interpolate;
  const interpFps = normalizeInterpolateFps(interpolateFps);
  const doForceReencode = !!forceReencode;
  const doContentFilter = !!contentFilter;
  const contentVf = doContentFilter ? buildContentFilterVf(contentFilterStrength) : '';
  const doSpeedJitter = doContentFilter;
  const speedRange = parseSpeedJitterRange(speedJitterRange);
  const speedFactor = doSpeedJitter ? randomFloat(speedRange.min, speedRange.max) : 1;
  const speedFactorText = speedFactor.toFixed(4);

  const commonOut = ['-y', '-progress', 'pipe:1', '-nostats'];

  let md5Out;
  try {
    if (isExact) {
      if (!doInterp && !doForceReencode && !doContentFilter && !doSpeedJitter) {
        if (typeof onStage === 'function')
          onStage('检测到 1080×1920，跳过分辨率调整，仅重封装并写入元数据…');
        const args = [
          ...commonOut,
          '-i',
          inputPath,
          '-map',
          '0',
          '-c',
          'copy',
          ...metaArgs,
          ...streamMetaArgs,
          ...mux,
          tempPath
        ];
        await runFfmpegWithProgress(args, durationSec, onProgress, signal);
      } else {
        if (typeof onStage === 'function') {
          const tags = [];
          if (doInterp) tags.push(`补帧 ${interpFps} FPS`);
          if (doContentFilter) tags.push(`内容微扰 ${normalizeContentFilterStrength(contentFilterStrength)}`);
          if (doSpeedJitter) tags.push(`速度微改 ${speedFactorText}x`);
          if (!tags.length) tags.push('强制重编码');
          onStage(`检测到 1080×1920，正在${tags.join(' + ')}…`);
        }
        const vfChain = [];
        if (doInterp)
          vfChain.push(`minterpolate=fps=${interpFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`);
        if (doContentFilter) vfChain.push(contentVf);
        if (doSpeedJitter) vfChain.push(`setpts=${(1 / speedFactor).toFixed(6)}*PTS`);
        const vf = vfChain.length ? vfChain.join(',') : null;
        const af = doSpeedJitter && hasAudio ? buildAudioTempoFilters(speedFactor).join(',') : null;
        const args = [
          ...commonOut,
          '-i',
          inputPath,
          ...(vf ? ['-vf', vf] : []),
          ...(af ? ['-af', af] : []),
          '-c:v',
          'libx264',
          '-crf',
          normalizeCrf(crf),
          '-preset',
          'medium',
          '-pix_fmt',
          'yuv420p',
          ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
          ...metaArgs,
          ...streamMetaArgs,
          ...mux,
          tempPath
        ];
        await runFfmpegWithProgress(args, durationSec, onProgress, signal);
      }
    } else {
      if (typeof onStage === 'function') {
        const tags = ['缩放至 1080×1920'];
        if (doInterp) tags.push(`补帧 ${interpFps} FPS`);
        if (doContentFilter) tags.push(`内容微扰 ${normalizeContentFilterStrength(contentFilterStrength)}`);
        if (doSpeedJitter) tags.push(`速度微改 ${speedFactorText}x`);
        onStage(`正在${tags.join(' + ')}…`);
      }
      const vfChain = [
        `scale=${TARGET_W}:${TARGET_H}:force_original_aspect_ratio=decrease`,
        `pad=${TARGET_W}:${TARGET_H}:(ow-iw)/2:(oh-ih)/2:black`
      ];
      if (doInterp)
        vfChain.push(`minterpolate=fps=${interpFps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`);
      if (doContentFilter) vfChain.push(contentVf);
      if (doSpeedJitter) vfChain.push(`setpts=${(1 / speedFactor).toFixed(6)}*PTS`);
      const vf = vfChain.join(',');
      const af = doSpeedJitter && hasAudio ? buildAudioTempoFilters(speedFactor).join(',') : null;
      const args = [
        ...commonOut,
        '-i',
        inputPath,
        '-vf',
        vf,
        ...(af ? ['-af', af] : []),
        '-c:v',
        'libx264',
        '-crf',
        normalizeCrf(crf),
        '-preset',
        'medium',
        '-pix_fmt',
        'yuv420p',
        ...(hasAudio ? ['-c:a', 'aac', '-b:a', '192k'] : ['-an']),
        ...metaArgs,
        ...streamMetaArgs,
        ...mux,
        tempPath
      ];
      await runFfmpegWithProgress(args, durationSec, onProgress, signal);
    }

    if (typeof onStage === 'function') onStage('正在校验导出文件…');
    await validateOutputVideo(ffmpegPath, tempPath);

    md5Out = fileMd5(tempPath);
    if (md5Out === md5In) {
      throw new Error('MD5 校验异常：输出与源文件指纹相同，已中止以防数据异常。');
    }

    fs.renameSync(tempPath, finalPath);
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
    throw err;
  }

  if (typeof onStage === 'function') onStage('处理完成');

  if (deleteOriginal) {
    try {
      fs.unlinkSync(inputPath);
    } catch (e) {
      throw new Error(`导出已成功，但删除原文件失败：${e.message}`);
    }
  }

  return { finalPath, finalName, md5In, md5Out, skippedScale: isExact };
}

async function processJob({
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
  speedJitterRange,
  onProgress,
  onStage,
  signal
}) {
  if (!inputPaths || !inputPaths.length) throw new Error('请选择至少一个视频文件。');
  if (!outputDir || !fs.existsSync(outputDir)) throw new Error('导出目录无效或不存在。');

  const prog =
    typeof onProgress === 'function'
      ? onProgress
      : () => {
          /* noop */
        };
  const st =
    typeof onStage === 'function'
      ? onStage
      : () => {
          /* noop */
        };

  const dtTag = formatDateTimeTag();
  const results = [];
  const total = inputPaths.length;

  for (let i = 0; i < inputPaths.length; i++) {
    if (signal && signal.aborted) throw new Error('已取消');
    const inputPath = inputPaths[i];
    if (!fs.existsSync(inputPath)) {
      throw new Error(`文件不存在：${inputPath}`);
    }

    const fileLabel = `${i + 1}/${total}`;
    const wrapProgress = (pct) => {
      const base = (i / total) * 100;
      const slice = (1 / total) * Math.min(100, Math.max(0, pct));
      prog(base + slice);
    };

    const r = await processOneFile({
      inputPath,
      outputDir,
      prefix,
      dtTag,
      seqStart: i + 1,
      deleteOriginal,
      crf,
      forceReencode,
      interpolate,
      interpolateFps,
      contentFilter,
      contentFilterStrength,
      speedJitterRange,
      onProgress: wrapProgress,
      onStage: (msg) => st(`[${fileLabel}] ${msg}`),
      signal
    });
    results.push(r);
  }

  prog(100);
  return results;
}

module.exports = {
  processJob,
  probeMedia,
  formatDateTimeTag,
  pickUniqueFinalPath,
  getExt,
  TARGET_W,
  TARGET_H
};
