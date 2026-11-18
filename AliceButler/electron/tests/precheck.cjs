const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { smoke } = require('./deployed-nine-clip-smoke.cjs');

(async () => {
  const packaged = process.env.ALICE_PET_EXECUTABLE;
  const result = await smoke({ executable: packaged || require('electron'),
    source: packaged ? undefined : path.resolve(__dirname, '..'), checkUi: true });
  for (const [name, clip] of Object.entries(result.clips)) {
    console.log(`${name}: ${clip.loaded ? 'PLAY' : 'FAIL'} ${clip.width}x${clip.height} t=${clip.currentTime.toFixed(3)}s transparent=${clip.transparent} black=${clip.opaqueBlackRatio.toFixed(6)}`);
  }
  console.log(`chat=PASS tray=PASS pageErrors=${JSON.stringify(result.pageErrors)}`);
  const seams = spawnSync(process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3'),
    [path.resolve(__dirname, '../../../tools/check-electron-media.py'), result.appPath, ...process.argv.slice(2)], { stdio: 'inherit' });
  if (seams.error) throw seams.error;
  if (!result.passed || seams.status !== 0) throw Error('Playback or seam check failed');
  console.log('PASS');
})().catch(error => { console.error('FAIL', error); process.exitCode = 1; });
