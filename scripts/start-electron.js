/**
 * 清除 ELECTRON_RUN_AS_NODE（部分 IDE 终端会注入），否则 Electron 会以纯 Node 运行，app 为 undefined。
 */
const { spawnSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');
const cli = path.join(root, 'node_modules', 'electron', 'cli.js');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const r = spawnSync(process.execPath, [cli, '.'], {
  stdio: 'inherit',
  env,
  cwd: root
});

if (r.error) {
  console.error(r.error);
  process.exit(1);
}
process.exit(r.status === null ? 1 : r.status);
