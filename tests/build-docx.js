/*
 * tests/build-docx.js - builds real .docx files from the samples and checks
 * the generated XML.
 *
 *   node tests/build-docx.js
 *
 * Writes the files next to the repo in ./out/ so they can be opened in Word.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var OUT = path.join(ROOT, 'out');
var JSZip = require(path.join(ROOT, 'vendor', 'jszip.min.js'));

var sandbox = { window: {}, console: console, Blob: Blob, setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval, process: process, TextEncoder: TextEncoder, TextDecoder: TextDecoder };
sandbox.global = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor', 'docx.iife.js'), 'utf8'), sandbox, { filename: 'docx.iife.js' });
sandbox.window.docx = sandbox.docx;

['text-utils.js', 'rules-language.js', 'normalize.js', 'parser.js', 'compose.js',
  'layout.js', 'render-docx.js', 'render-text.js', 'samples.js'].forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8'), sandbox, { filename: file });
});

var PF = sandbox.window.PF;

var OPTIONS = {
  fontSizePt: 12,
  latinFont: 'Arial',
  hindiFont: 'Nirmala UI',
  questionPrefix: 'auto',
  maxPages: 2,
  densityId: 'auto'
};

function buildOne(name, sourceText, extra) {
  var options = Object.assign({}, OPTIONS, extra || {});
  var prepared = PF.normalize.prepare(sourceText || PF.samples[name]);
  var suggestions = PF.normalize.suggest(prepared.lines);
  var paper = PF.parser.parse(prepared.lines, {
    properNouns: PF.normalize.buildProperNounMap(prepared.lines),
    acceptedSuggestions: suggestions.filter(function (s) { return s.confidence === 'high'; }),
    fontSizePt: options.fontSizePt
  });
  var result = PF.layout.fit(paper, options);

  return PF.renderDocx.toBlob(result, options).then(function (blob) {
    return blob.arrayBuffer();
  }).then(function (buffer) {
    var file = path.join(OUT, name + '.docx');
    fs.writeFileSync(file, Buffer.from(buffer));
    return JSZip.loadAsync(buffer).then(function (zip) {
      return Promise.all([
        zip.file('word/document.xml').async('string'),
        zip.file('word/settings.xml').async('string')
      ]);
    }).then(function (parts) {
      report(name, file, parts[0], result, extra, parts[1]);
    });
  });
}

var failed = 0;

function report(name, file, xml, result, extra, settingsXml) {
  var checks = {
    // Word keeps a paragraph's space-before even at the top of a page, which
    // would leave the two-line setting starting a page two lines down while
    // the preview shows it at the top.
    'space before suppressed after a page break':
      /suppressSpBfAfterPgBrk/.test(settingsXml || ''),
    // 2 lines x 12pt x 1.18 x 1.15 line spacing = 33pt = 660 twips.
    'two-line gap between questions':
      name !== 'spacious' || /w:before="660"/.test(xml),
    'page size A4 (11906 x 16838 twips)': /w:w="11906"/.test(xml) && /w:h="16838"/.test(xml),
    'font size 24 half-points (12pt)': /w:sz w:val="24"/.test(xml),
    'complex-script size set': /w:szCs w:val="24"/.test(xml),
    'tab stops present': /<w:tabs>/.test(xml),
    'right tab for marks': /w:val="right"/.test(xml),
    'header rule (border)': /<w:pBdr>/.test(xml),
    // Only the English paper has a column list long enough to wrap (10 spellings).
    'line breaks for wrapped rows': name !== 'english' || /<w:br\/>/.test(xml),
    'hindi font applied': name !== 'hindi' || /Nirmala UI/.test(xml),
    'latin font applied': /Arial/.test(xml),
    'no empty paragraphs run together': !/<w:p\/><w:p\/>/.test(xml)
  };

  // A paper corrected by hand has to reach the file as corrected, and a line
  // added in the preview has to arrive as a paragraph of its own.
  if (extra && extra.edits) checks['hand-edited line in the document'] = /Ticked by hand/.test(xml);
  if (extra && extra.inserts) checks['hand-added line in the document'] = /Added by hand/.test(xml);

  console.log('\n=== ' + name + ' ===');
  console.log('  file      : ' + path.relative(ROOT, file) + ' (' + fs.statSync(file).size + ' bytes)');
  console.log('  density   : ' + result.density.id + ', pages: ' + result.pageCount);
  console.log('  paragraphs: ' + (xml.match(/<w:p [^>]*>|<w:p>/g) || []).length);
  Object.keys(checks).forEach(function (label) {
    if (!checks[label]) failed++;
    console.log('  ' + (checks[label] ? '[ok]  ' : '[FAIL]') + ' ' + label);
  });
}

fs.mkdirSync(OUT, { recursive: true });
var extra = process.argv[2];
buildOne('english')
  .then(function () { return buildOne('hindi'); })
  .then(function () {
    // The same paper with a line corrected and a line added in the preview.
    return buildOne('edited', PF.samples.english, {
      edits: { 'q0.head': 'Que 1. Ticked by hand:' },
      inserts: { 'q0.head': ['Added by hand, under the question'] }
    });
  })
  .then(function () {
    // The same paper with two blank lines between the questions to write in.
    return buildOne('spacious', PF.samples.english, { densityId: 'spacious' });
  })
  .then(function () {
    if (!extra) return null;
    return buildOne(path.basename(extra).replace(/.[^.]+$/, ''), fs.readFileSync(extra, 'utf8'));
  })
  .then(function () {
    // A check that prints [FAIL] and then exits 0 is a check nobody sees.
    if (failed) {
      console.error('\n' + failed + ' check(s) failed.');
      process.exit(1);
    }
  })
  .catch(function (error) {
    console.error('FAILED:', error && error.stack || error);
    process.exit(1);
  });
