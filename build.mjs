// Bundles src/ into a single dist/Code.js for Apps Script.
// clasp 3 no longer transpiles TypeScript, and Apps Script has no module
// system, so the bundle is an IIFE exposed as `App` plus top-level wrapper
// functions that Apps Script can see (doPost, triggers, editor-run helpers).
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';

const GLOBALS = ['doPost', 'doGet', 'setup', 'checkProperties', 'showWebhookUrl', 'testGemini', 'setupRichMenu',
  'monthlySummaryTrigger', 'setupMonthlyTrigger', 'sendMonthlySummaryNow'];

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'App',
  target: 'es2020',
  outfile: 'dist/Code.js',
  loader: { '.png': 'base64' },
  footer: {
    js: GLOBALS.map((name) => `function ${name}(e) { return App.${name}(e); }`).join('\n'),
  },
});

copyFileSync('appsscript.json', 'dist/appsscript.json');
console.log('built dist/Code.js');
