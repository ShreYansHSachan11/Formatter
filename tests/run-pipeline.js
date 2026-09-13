/*
 * tests/run-pipeline.js - headless check of the formatting pipeline.
 *
 *   node tests/run-pipeline.js [hindi|english]
 *
 * Loads the browser modules into a minimal fake window, runs a sample paper
 * through normalise -> parse -> fit, and prints the structure, the chosen
 * density, the estimated page count and the plain-text output.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var SRC = path.join(__dirname, '..', 'src');
var MODULES = [
  'text-utils.js', 'rules-language.js', 'normalize.js', 'parser.js',
  'compose.js', 'layout.js', 'render-text.js', 'samples.js'
];

var sandbox = { window: {}, console: console };
sandbox.global = sandbox;
vm.createContext(sandbox);
MODULES.forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), sandbox, { filename: file });
});

var PF = sandbox.window.PF;
var which = process.argv[2] || 'english';
var raw = PF.samples[which] || fs.readFileSync(which, 'utf8');

var prepared = PF.normalize.prepare(raw);
var properNouns = PF.normalize.buildProperNounMap(prepared.lines);
var suggestions = PF.normalize.suggest(prepared.lines);

var paper = PF.parser.parse(prepared.lines, {
  properNouns: properNouns,
  acceptedSuggestions: suggestions.filter(function (s) { return s.confidence === "high"; })
});

var options = {
  fontSizePt: 12,
  latinFont: 'Arial',
  hindiFont: 'Nirmala UI',
  questionPrefix: 'auto',
  maxPages: 2,
  densityId: 'auto'
};

var result = PF.layout.fit(paper, options);

console.log('=== header ===');
console.log(paper.header);

console.log('\n=== questions ===');
paper.questions.forEach(function (q) {
  var count = q.kind === 'mcq' ? q.subs.length
    : q.kind === 'match' ? q.pairs.length
      : q.items.length;
  console.log('  Q' + q.number + '  ' + pad(q.kind, 7) + ' marks=' + pad(q.marks || '-', 3)
    + ' parts=' + pad(String(count), 3) + '  ' + q.heading);
});

console.log('\n=== proper nouns unified ===');
console.log(properNouns);

console.log('\n=== suggestions ===');
suggestions.forEach(function (s) {
  console.log('  [' + s.confidence + '] "' + s.before + '" -> "' + s.after + '"  (' + s.note + ')');
});

console.log('\n=== layout ===');
console.log('  density   : ' + result.density.id);
console.log('  pages     : ' + result.pageCount + (result.overflow ? '  *** OVER BUDGET ***' : ''));
console.log('  height    : ' + Math.round(result.heightPt) + 'pt of '
  + Math.round(result.capacityPt * options.maxPages) + 'pt available');
console.log('  blocks    : ' + result.blocks.length);

console.log('\n=== text output ===');
console.log(PF.renderText.render(result));

function pad(value, width) {
  var out = String(value);
  while (out.length < width) out += ' ';
  return out;
}
