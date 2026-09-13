/*
 * tests/check-numbering.js - item numbers must survive, however they were typed.
 *
 *   node tests/check-numbering.js
 *
 * Word stores the numbers of an automatic numbered list in numbering.xml, not
 * in the text, so a paper typed that way arrives with no visible numbers at
 * all - and the formatted paper came out with the numbering gone.
 *
 * This builds a .docx the way Word does (numPr + numbering.xml, no numbers in
 * the text), reads it back and checks the numbers are there.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var JSZip = require(path.join(ROOT, 'vendor', 'jszip.min.js'));
var xmldom = loadXmlDom();

/*
 * Browsers have DOMParser built in; Node does not, so this one test needs a
 * shim. It is a dev dependency only - the app itself installs nothing.
 */
function loadXmlDom() {
  try {
    return require('@xmldom/xmldom');
  } catch (error) {
    try {
      return require(path.join(process.env.XMLDOM_PATH, 'node_modules', '@xmldom', 'xmldom'));
    } catch (ignored) {
      console.log('SKIPPED: this test needs an XML parser for Node.');
      console.log('Run "npm install" once, then "node tests/check-numbering.js" again.');
      process.exit(0);
    }
  }
}

var sandbox = { window: {}, console: console, DOMParser: xmldom.DOMParser, Promise: Promise };
sandbox.global = sandbox;
sandbox.window.JSZip = JSZip;
vm.createContext(sandbox);
['text-utils.js', 'rules-language.js', 'normalize.js', 'parser.js', 'compose.js',
  'layout.js', 'render-text.js', 'read-docx.js'].forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8'), sandbox, { filename: file });
});
var PF = sandbox.window.PF;

/* ------------------------------------------------ a Word-style numbered list */

var W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function plain(text) {
  return '<w:p><w:r><w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>';
}

/** A paragraph whose number comes from numbering.xml, exactly like Word's. */
function numbered(text, numId, level) {
  return '<w:p><w:pPr><w:numPr><w:ilvl w:val="' + (level || 0) + '"/>'
    + '<w:numId w:val="' + numId + '"/></w:numPr></w:pPr>'
    + '<w:r><w:t xml:space="preserve">' + text + '</w:t></w:r></w:p>';
}

var DOCUMENT = '<?xml version="1.0" encoding="UTF-8"?><w:document ' + W + '><w:body>'
  + plain('S.S. ACADEMY KOIRAUNA BHADOHI')
  + plain('HALF YEARLY EXAMINATION 2026-27')
  + plain('Sub - English')
  + plain('Time - 2:30 h\tClass - 2nd (A)\tM.M.50')
  + plain('Question - 2 Answer the following question (5)')
  + numbered('Who did the fox meet in the forest ?', '1')
  + numbered('What did Murugan reply ?', '1')
  + numbered('Who has seven chicks ?', '1')
  + numbered('What sound do Ducks make on the water ?', '1')
  + numbered('Who chooses salt ?', '1')
  + plain('Question - 4 Fill in the blanks (5)')
  + numbered('The fox _____ the wolf to an old house', '2')
  + numbered('The woman went out of the _____', '2')
  + numbered('The fox jumped ____ the small window', '2')
  + plain('Question - 6 Choose the correct word (5)')
  + numbered('Sugar is _____', '3')   // a lettered list: a. b. c.
  + numbered('Salt is _____', '3')
  + numbered('Water is _____', '3')
  + '</w:body></w:document>';

function abstractNum(id, format) {
  return '<w:abstractNum w:abstractNumId="' + id + '">'
    + '<w:lvl w:ilvl="0"><w:numFmt w:val="' + format + '"/><w:lvlText w:val="%1."/></w:lvl>'
    + '</w:abstractNum>';
}

var NUMBERING = '<?xml version="1.0" encoding="UTF-8"?><w:numbering ' + W + '>'
  + abstractNum('0', 'decimal')
  + abstractNum('1', 'lowerLetter')
  + '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>'
  + '<w:num w:numId="2"><w:abstractNumId w:val="0"/></w:num>'
  + '<w:num w:numId="3"><w:abstractNumId w:val="1"/></w:num>'
  + '</w:numbering>';

/* ------------------------------------------------------------------- checks */

var failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

var zip = new JSZip();
zip.file('word/document.xml', DOCUMENT);
zip.file('word/numbering.xml', NUMBERING);

zip.generateAsync({ type: 'nodebuffer' })
  .then(function (buffer) { return PF.readDocx.read(buffer); })
  .then(function (text) {
    var prepared = PF.normalize.prepare(text);
    var paper = PF.parser.parse(prepared.lines, { fontSizePt: 12 });
    var result = PF.layout.fit(paper, {
      fontSizePt: 12, latinFont: 'Arial', hindiFont: 'Nirmala UI',
      questionPrefix: 'auto', maxPages: 2, densityId: 'auto'
    });
    var output = PF.renderText.render(result);

    console.log(output.split('\n').filter(function (line) {
      return line.trim();
    }).map(function (line) { return '  ' + line; }).join('\n'));

    expect(paper.questions.length === 3, 'expected 3 questions, got ' + paper.questions.length);

    // The numbers exist nowhere in the source text - they must be reconstructed.
    var q2 = paper.questions[0];
    expect(q2.items.length === 5, 'Q2 should have 5 items, has ' + q2.items.length);
    expect(q2.items.map(function (i) { return i.label; }).join(',') === '1,2,3,4,5',
      'Q2 numbering is "' + q2.items.map(function (i) { return i.label; }).join(',') + '", expected 1,2,3,4,5');

    var q4 = paper.questions[1];
    expect(q4.items.map(function (i) { return i.label; }).join(',') === '1,2,3',
      'Q4 numbering is "' + q4.items.map(function (i) { return i.label; }).join(',') + '", expected 1,2,3');

    // A lettered list in Word stays lettered here.
    var q6 = paper.questions[2];
    expect(q6.items.map(function (i) { return i.label; }).join(',') === 'a,b,c',
      'Q6 lettering is "' + q6.items.map(function (i) { return i.label; }).join(',') + '", expected a,b,c');

    // Every item line in the output starts with its label.
    expect(/^\s*1\. Who did the fox meet/m.test(output), 'Q2 item 1 is not numbered in the output');
    expect(/^\s*5\. Who chooses salt/m.test(output), 'Q2 item 5 is not numbered in the output');
    expect(/\(a\) Sugar is/.test(output), 'Q6 item a is not lettered in the output');

    if (failures.length) {
      console.error('\nFAILED (' + failures.length + ')');
      failures.forEach(function (message) { console.error('  - ' + message); });
      process.exit(1);
    }
    console.log('\nNumbering check passed: Word\'s automatic numbering survives.');
  })
  .catch(function (error) {
    console.error('FAILED:', error && error.stack || error);
    process.exit(1);
  });
