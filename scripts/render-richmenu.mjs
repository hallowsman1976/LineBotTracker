// Renders assets/richmenu.html to assets/richmenu.png with headless Edge (Thai fonts come from Windows).
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
].find(existsSync);
if (!EDGE) throw new Error('Microsoft Edge not found');

const out = resolve('assets/richmenu.png');
execFileSync(EDGE, [
  '--headless',
  '--disable-gpu',
  '--hide-scrollbars',
  '--force-device-scale-factor=1',
  // Gives the web font and icon font time to load before the screenshot.
  '--virtual-time-budget=8000',
  `--screenshot=${out}`,
  '--window-size=2500,1686',
  pathToFileURL(resolve('assets/richmenu.html')).href,
]);

const kb = statSync(out).size / 1024;
console.log(`rendered ${out} (${kb.toFixed(0)} KB)`);
// LINE rejects rich menu images over 1 MB.
if (kb > 1024) throw new Error('image exceeds LINE 1 MB limit');
