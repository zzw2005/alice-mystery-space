import { packager } from '@electron/packager';
import { readdir, unlink } from 'node:fs/promises';
import path from 'node:path';

// The production build targets Windows. A native build exercises the same app and locale set on CI.
const platform = process.argv.includes('--native') ? process.platform : 'win32';
const [output] = await packager({
  dir: '.', name: 'AlicePetNew', platform, arch: 'x64', out: 'release', overwrite: true,
  electronZipDir: process.env.ELECTRON_ZIP_DIR, asar: false,
  ignore: [/package-lock\.json$/, /^\/(release|tests|test-results|scripts|src)(\/|$)/, /^\/(tsconfig\..*|README\.md)$/],
});
const locales = path.join(output, 'locales');
const supported = new Set(['zh-CN.pak', 'zh-TW.pak', 'en-US.pak', 'en-GB.pak']);
for (const name of await readdir(locales)) {
  if (name.endsWith('.pak') && !supported.has(name)) await unlink(path.join(locales, name));
}
console.log(output);
