/*
 * tests/check-ui.js - static consistency check between index.html and the scripts.
 *
 *   node tests/check-ui.js
 *
 * Catches the mistakes a browser would only reveal at runtime: an element id
 * the app looks up but the page never defines, a <script> pointing at a file
 * that is not there, or a module that fails to parse.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var app = fs.readFileSync(path.join(ROOT, 'src', 'app.js'), 'utf8');

var failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

/* --- every <script src> and <link href> resolves ------------------------- */

var assets = [];
html.replace(/<script src="([^"]+)"/g, function (_, src) { assets.push(src); return ''; });
html.replace(/<link[^>]+href="([^"]+)"/g, function (_, href) { assets.push(href); return ''; });

assets.forEach(function (asset) {
  check(fs.existsSync(path.join(ROOT, asset)), 'missing file referenced by index.html: ' + asset);
});

/* --- every id the app looks up exists in the page ------------------------ */

var pageIds = {};
html.replace(/id="([^"]+)"/g, function (_, id) { pageIds[id] = true; return ''; });

var wanted = [];
var block = app.match(/\[\s*\n([\s\S]*?)\]\.forEach\(function \(id\)/);
check(!!block, 'could not find the element-id list in app.js');
if (block) {
  block[1].replace(/'([A-Za-z0-9_]+)'/g, function (_, id) { wanted.push(id); return ''; });
}
app.replace(/\$\('([A-Za-z0-9_]+)'\)/g, function (_, id) { wanted.push(id); return ''; });

wanted.forEach(function (id) {
  check(pageIds[id], 'app.js uses #' + id + ', which index.html does not define');
});

/* --- every module parses and registers itself on PF ---------------------- */

var expected = {
  'text-utils.js': 'text',
  'rules-language.js': 'rules',
  'normalize.js': 'normalize',
  'parser.js': 'parser',
  'compose.js': 'compose',
  'layout.js': 'layout',
  'render-docx.js': 'renderDocx',
  'render-text.js': 'renderText',
  'render-preview.js': 'renderPreview',
  'read-docx.js': 'readDocx',
  'samples.js': 'samples'
};

var sandbox = { window: {}, document: { addEventListener: function () {} }, console: console };
sandbox.global = sandbox;
vm.createContext(sandbox);

Object.keys(expected).forEach(function (file) {
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8'), sandbox, { filename: file });
    check(!!sandbox.window.PF[expected[file]], file + ' did not register PF.' + expected[file]);
  } catch (error) {
    failures.push(file + ' failed to load: ' + error.message);
  }
});

/* --- the paper prints as paper, not as a screenshot of the tool ---------- */

/*
 * Printing has no output this test can read, so what is checked is that the
 * rules it depends on are there at all: an A4 page box with no margin of its
 * own (the margins are inside the page, where the formatter put them), the
 * on-screen scaling undone, the tool's own furniture hidden, and a page break
 * between one sheet and the next.
 */
var css = fs.readFileSync(path.join(ROOT, 'assets', 'styles.css'), 'utf8');
var printBlock = css.slice(css.indexOf('@media print'));

check(/@page\s*\{[^}]*size:\s*A4[^}]*margin:\s*0/.test(css),
  'the printed page should be A4 with no margin of its own');
check(css.indexOf('@media print') >= 0, 'there is no print stylesheet');
check(/\.topbar[^{]*\{[^}]*display:\s*none/.test(printBlock),
  'printing should leave out the toolbar');
check(/\.panel|\.preview-bar/.test(printBlock) && /display:\s*none/.test(printBlock),
  'printing should leave out the controls and the preview bar');
check(/\.preview-scale[^{]*\{[^}]*transform:\s*none/.test(printBlock),
  'the preview is scaled down to fit its column on screen; printing must undo that');
check(/page-break-before:\s*always|break-before:\s*page/.test(printBlock),
  'each page of the paper should start a new sheet');

/* --- report -------------------------------------------------------------- */

if (failures.length) {
  console.error('FAILED (' + failures.length + ')');
  failures.forEach(function (message) { console.error('  - ' + message); });
  process.exit(1);
}

console.log('UI check passed: ' + assets.length + ' assets, ' + wanted.length
  + ' element ids, ' + Object.keys(expected).length + ' modules.');
