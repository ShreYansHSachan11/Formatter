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

/* --- report -------------------------------------------------------------- */

if (failures.length) {
  console.error('FAILED (' + failures.length + ')');
  failures.forEach(function (message) { console.error('  - ' + message); });
  process.exit(1);
}

console.log('UI check passed: ' + assets.length + ' assets, ' + wanted.length
  + ' element ids, ' + Object.keys(expected).length + ' modules.');
