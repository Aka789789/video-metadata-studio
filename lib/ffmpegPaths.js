const path = require('path');

/**
 * 解析打包后 asar 中的二进制路径（需与 asarUnpack 配置一致）
 */
function fixAsarBinary(p) {
  if (!p) return p;
  return p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
}

function getFfmpegPath() {
  const ffmpeg = require('ffmpeg-static');
  return fixAsarBinary(ffmpeg);
}

module.exports = { getFfmpegPath, fixAsarBinary };
