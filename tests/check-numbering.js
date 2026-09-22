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

/** A numbered paragraph broken over two lines with Shift+Enter, as Word stores it. */
function numberedWithBreak(first, second, numId) {
  return '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + numId + '"/></w:numPr></w:pPr>'
    + '<w:r><w:t xml:space="preserve">' + first + '</w:t><w:br/><w:t xml:space="preserve">'
    + second + '</w:t></w:r></w:p>';
}

/** A numbered paragraph holding a second, hand-numbered item after a tab. */
function numberedPair(left, right, numId) {
  return '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="' + numId + '"/></w:numPr></w:pPr>'
    + '<w:r><w:t xml:space="preserve">' + left + '</w:t><w:tab/><w:t xml:space="preserve">'
    + right + '</w:t></w:r></w:p>';
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

/*
 * Word wraps content in more than paragraphs: a content control (w:sdt) can
 * hold whole questions and a cell can hold another table. Both used to be
 * dropped on the floor without a trace.
 */
var CONTAINERS = '<?xml version="1.0" encoding="UTF-8"?><w:document ' + W + '><w:body>'
  + plain('PLAIN paragraph')
  + '<w:sdt><w:sdtPr/><w:sdtContent>' + plain('INSIDE a content control') + '</w:sdtContent></w:sdt>'
  + '<w:tbl><w:tr><w:tc>' + plain('CELL one') + '</w:tc><w:tc>' + plain('CELL two') + '</w:tc></w:tr>'
  + '<w:tr><w:tc><w:tbl><w:tr><w:tc>' + plain('NESTED table cell') + '</w:tc></w:tr></w:tbl></w:tc>'
  + '<w:tc>' + plain('CELL four') + '</w:tc></w:tr></w:tbl>'
  + plain('LAST paragraph')
  + '</w:body></w:document>';

/* ----------------------------------------- a real paper, as Word stores it
 *
 * Every line of this came back wrong from a class-5 English paper:
 *
 *   Q1  a row of options typed with square boxes was read as five separate
 *       questions, one per option, and the stems lost their numbers;
 *   Q3  a statement broken with Shift+Enter became an item of its own, and
 *       everything below it was numbered one too high;
 *   Q6  the box of phrases above the sentences was numbered as item 1;
 *   Q8  items typed two to a line came out as "Talk- IV. Face-".
 */

var PAPER = '<?xml version="1.0" encoding="UTF-8"?><w:document ' + W + '><w:body>'
  + plain('S.S. ACADEMY KOIRAUNA BHADOHI')
  + plain('Half Yearly Examination 2026-27')
  + plain('Sub - English	Class - 5th')
  + plain('Time - 2:30 hrs	M.M. 50')

  + plain('Que.1- Choose the correct option. (5)')
  + numbered('Mike lived with his:', '11')
  + plain('(a) grandpa [ ]	(b) mother [ ]	(c) granny [ ]')
  + numbered('What did Hector use to tie the princess with?', '11')
  + plain('(a) a rope [ ]	(b) tree trunk[ ]	(c) vine [ ]')
  + plain('III. What action does Totto-chan repeatedly do with her desk?')
  + plain('(a) paint it [ ]	(b) open and shut it [ ]	(c) clean it [ ]')

  + plain("Que.3- Write 'T' for true and 'F' for false statements:(5)")
  + numbered('Grandma had a lot of interesting stories to share. [ ]', '12')
  + numberedWithBreak('Totto-chan stood at the window to look at the beautiful view',
    'outside.[ ]', '12')
  + numbered('Pods are not entirely controlled by computers. [ ]', '12')

  + plain('Que.6- Complete the sentences with the phrases given in the box. (5)')
  + plain('(in the sky, over the tree, across the floor, in the pond)')
  + numbered('The stars are shining ________.', '13')
  + numbered('The fish are swimming ________.', '13')
  + numbered('The birds are flying ________.', '13')

  + plain('Que.8- Write the rhyming word. (5)')
  + numberedPair('Talk-', 'IV. Face-', '14')
  + numberedPair('Red-', 'V. Fail-', '14')
  + numbered('See-', '14')
  + '</w:body></w:document>';

var PAPER_NUMBERING = '<?xml version="1.0" encoding="UTF-8"?><w:numbering ' + W + '>'
  + abstractNum('9', 'upperRoman')
  + '<w:num w:numId="11"><w:abstractNumId w:val="9"/></w:num>'
  + '<w:num w:numId="12"><w:abstractNumId w:val="9"/></w:num>'
  + '<w:num w:numId="13"><w:abstractNumId w:val="9"/></w:num>'
  + '<w:num w:numId="14"><w:abstractNumId w:val="9"/></w:num>'
  + '</w:numbering>';

function labelsOf(question) {
  return (question.items.length ? question.items : question.subs)
    .map(function (entry) { return entry.label || '-'; }).join(',');
}

function readPaper() {
  var zip = new JSZip();
  zip.file('word/document.xml', PAPER);
  zip.file('word/numbering.xml', PAPER_NUMBERING);

  return zip.generateAsync({ type: 'nodebuffer' })
    .then(function (buffer) { return PF.readDocx.read(buffer); })
    .then(function (text) {
      var prepared = PF.normalize.prepare(text);
      var paper = PF.parser.parse(prepared.lines, { fontSizePt: 12 });
      var result = PF.layout.fit(paper, {
        fontSizePt: 12, latinFont: 'Arial', hindiFont: 'Nirmala UI',
        questionPrefix: 'auto', maxPages: 2, densityId: 'auto'
      });
      var output = PF.renderText.render(result);
      var q1 = paper.questions[0], q3 = paper.questions[1];
      var q6 = paper.questions[2], q8 = paper.questions[3];

      // Q1: options are options, whichever brackets the boxes are typed with.
      expect(q1.kind === 'mcq', 'Q1 should be a tick-the-option question, is ' + q1.kind);
      expect(q1.subs.length === 3, 'Q1 should have 3 sub-questions, has ' + q1.subs.length);
      expect(labelsOf(q1) === 'I,II,III', 'Q1 stems are numbered ' + labelsOf(q1) + ', expected I,II,III');
      expect(/\(a\) Grandpa \( \)\t\(b\) Mother \( \)\t\(c\) Granny \( \)/.test(output),
        'Q1 options should sit on one line as a row of three');

      // Q3: a line broken with Shift+Enter is the rest of the statement above.
      expect(q3.items.length === 3, 'Q3 should have 3 statements, has ' + q3.items.length);
      expect(/beautiful view outside\./.test(output), 'Q3 statement was cut in two');
      expect(labelsOf(q3) === 'I,II,III', 'Q3 is numbered ' + labelsOf(q3) + ', expected I,II,III');

      // Q6: the box of phrases is not one of the sentences.
      expect(q6.items.length === 4, 'Q6 should have a lead line and 3 sentences, has ' + q6.items.length);
      expect(q6.items[0].lead === true, 'the box of phrases should not be an item');
      expect(labelsOf(q6) === '-,I,II,III', 'Q6 is numbered ' + labelsOf(q6) + ', expected -,I,II,III');

      // Q8: two items to a line, read down the columns.
      expect(q8.items.length === 5, 'Q8 should have 5 words, has ' + q8.items.length);
      expect(labelsOf(q8) === 'I,II,III,IV,V', 'Q8 is numbered ' + labelsOf(q8) + ', expected I,II,III,IV,V');
      expect(q8.items.map(function (i) { return i.text; }).join(' ') === 'Talk- Red- See- Face- Fail-',
        'Q8 words are in the wrong order: ' + q8.items.map(function (i) { return i.text; }).join(' '));

      // An instruction ends with one mark, not two.
      expect(/Choose the correct option:/.test(output) && !/option\.:/.test(output),
        'the heading should end "option:", not "option.:"');
    });
}

function readContainers() {
  var zip = new JSZip();
  zip.file('word/document.xml', CONTAINERS);
  return zip.generateAsync({ type: 'nodebuffer' })
    .then(function (buffer) { return PF.readDocx.read(buffer); })
    .then(function (text) {
      ['PLAIN paragraph', 'INSIDE a content control', 'CELL one', 'CELL two',
        'NESTED table cell', 'CELL four', 'LAST paragraph'].forEach(function (wanted) {
        expect(text.indexOf(wanted) >= 0, 'lost from the document: "' + wanted + '"');
      });
      // Cells of one row stay on one line, separated by a tab.
      expect(/CELL one\tCELL two/.test(text), 'table row did not come back as tab-separated columns');
    });
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

    return readContainers().then(readPaper);
  })
  .then(function () {
    if (failures.length) {
      console.error('\nFAILED (' + failures.length + ')');
      failures.forEach(function (message) { console.error('  - ' + message); });
      process.exit(1);
    }
    console.log('\nReader check passed: automatic numbering, content controls and '
      + 'nested tables all survive.');
  })
  .catch(function (error) {
    console.error('FAILED:', error && error.stack || error);
    process.exit(1);
  });
