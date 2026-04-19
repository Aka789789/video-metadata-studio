const fs = require('fs');
const path = require('path');

function settingsPath(userData) {
  return path.join(userData, 'app-settings.json');
}

function readSettings(userData) {
  const p = settingsPath(userData);
  try {
    if (!fs.existsSync(p)) return {};
    const raw = fs.readFileSync(p, 'utf8');
    const data = JSON.parse(raw);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function writeSettings(userData, partial) {
  const cur = readSettings(userData);
  const next = { ...cur, ...partial };
  const dir = userData;
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(settingsPath(userData), JSON.stringify(next, null, 2), 'utf8');
}

module.exports = { readSettings, writeSettings };
