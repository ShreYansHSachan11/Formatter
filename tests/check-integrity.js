/*
 * tests/check-integrity.js - the formatter may restyle a paper, never rewrite it.
 *
 *   node tests/check-integrity.js
 *
 * Three invariants, each guarding a bug that has actually happened:
 *
 *   1. No content is lost. Every word of the source must still be there, as
 *      many times as before. (A "Fill in the blanks" question was once read as
 *      a match question and four of its five items were dropped.)
 *   2. No sentence is split into columns. A question only becomes a match when
 *      it really is one. ("Uncle John lived in a city" became "Uncle | John
 *      lived in a city" because of a double space.)
 *   3. No control character reaches the output. (Tab sentinels leaked into the
 *      text and showed up in Word as hollow box glyphs.)
 *
 * Suggestions are switched off here: they are allowed to change words, which
 * would defeat invariant 1. They are covered by run-pipeline.js instead.
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var sandbox = { window: {}, console: console };
sandbox.global = sandbox;
vm.createContext(sandbox);
['text-utils.js', 'rules-language.js', 'normalize.js', 'parser.js', 'compose.js',
  'layout.js', 'render-text.js', 'samples.js'].forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8'), sandbox, { filename: file });
});
var PF = sandbox.window.PF;

var OPTIONS = {
  fontSizePt: 12, latinFont: 'Arial', hindiFont: 'Nirmala UI',
  questionPrefix: 'auto', maxPages: 2, densityId: 'auto'
};

var CASES = [
  {
    name: 'loose-spacing fixture (double spaces everywhere)',
    text: fs.readFileSync(path.join(__dirname, 'fixtures', 'loose-spacing.txt'), 'utf8'),
    kinds: ['mcq', 'list', 'match', 'list', 'list'],
    marks: ['5', '5', '5', '5', '5']
  },
  {
    name: 'short-items fixture (gaps in numbering, one-word items)',
    text: fs.readFileSync(path.join(__dirname, 'fixtures', 'short-items.txt'), 'utf8'),
    kinds: ['inline', 'mcq'],
    marks: ['10', '5'],
    // A number missing from one line is filled in from its neighbours, and
    // items with a blank are packed several to a line instead of one each.
    // How many fit is measured column by column, so a narrow item does not
    // have to pay for the widest one in the question.
    lines: [
      /^\s*1\. C a t __________\t2\. B r e a d __________\t3\. B a t __________$/m,
      /^\s*10\. F a t h e r __________$/m,
      /^\s*1\. Traditional dress of Punjab$/m,
      /^\s*\(a\) Salwal kameez \( \)\t\(b\) Dhoti kurta \( \)$/m,
      /^\s*\(a\) Daman & chundar \( \)\t\(b\) Pheran \( \)$/m
    ]
  },
  {
    name: 'stacked-options fixture (options typed one per line)',
    text: fs.readFileSync(path.join(__dirname, 'fixtures', 'stacked-options.txt'), 'utf8'),
    kinds: ['mcq', 'mcq', 'list', 'list', 'inline', 'list'],
    marks: ['5', '4', '6', '5', '5', '5'],
    // Options typed one below the other are stacked back onto a single row -
    // but only under a heading that says the paper is to be ticked, or when
    // each line carries its own box. The lettered lines in question 3 are
    // answers to be written, and must stay one per line.
    lines: [
      /^\s*\(a\) Elephant \( \)\t\(b\) Ant \( \)\t\(c\) Dog \( \)$/m,
      /^\s*\(a\) In the water \( \)\t\(b\) On a tree \( \)\t\(c\) Under the ground \( \)$/m,
      /^\s*\(a\) Kolkata \( \)\t\(b\) New Delhi \( \)\t\(c\) Mumbai \( \)$/m,
      /^\s*\(a\) What is your name\?$/m,
      /^\s*\(b\) Where do you live\?$/m,
      // Statements to mark true or false carry a box each, but they are not
      // choices and must stay one per line - even the short ones, which is
      // where the temptation to stack them comes from.
      /^\s*1\. The sun rises in the east \( \)$/m,
      /^\s*2\. Fish live in water \( \)$/m,
      /^\s*3\. Cows eat grass \( \)$/m,
      // A heading can say "choose the correct" and still be a question whose
      // lines are written on, not ticked: a line with a blank in it is never a
      // choice, and neither is a sentence.
      /^\s*\(a\) Sugar is _+\t\(b\) Salt is _+/m,
      /^\s*\(a\) Write a letter to your friend\.$/m
    ]
  },
  {
    name: 'two-columns fixture (items typed two to a line)',
    text: fs.readFileSync(path.join(__dirname, 'fixtures', 'two-columns.txt'), 'utf8'),
    kinds: ['inline', 'match'],
    marks: ['5', '5'],
    // Items typed two to a line are read down the left column and then the
    // right, so I, IV, II, V, III on the page is I, II, III, IV, V in the
    // paper. The two columns of a matching question are a pair, not two items,
    // and the label of an answer stays the label it was typed as.
    lines: [
      /^\s*\(I\) Talk-\t\(II\) Red-\t\(III\) See-\t\(IV\) Face-\t\(V\) Fail-$/m,
      /^\s*\(a\) Cat\t+\(b\) Meow$/m,
      /^\s*\(c\) Dog\t+\(d\) Bark$/m
    ]
  },
  {
    name: 'hindi-wrapped fixture (a paper whose lines were broken by hand)',
    text: fs.readFileSync(path.join(__dirname, 'fixtures', 'hindi-wrapped.txt'), 'utf8'),
    kinds: ['list', 'mcq', 'list', 'list', 'list', 'plain', 'list', 'plain', 'list', 'inline',
      'list', 'list'],
    marks: ['1x2', '1x5', '1x5', '1x5', '2x5', '1x2', '1x5', '', '1x3', '1x5', '1x2', '1x2'],
    maxPages: 3,
    // Every line here that was broken in the middle is put back together: the
    // rest of a statement, the rest of a word list, the rest of an option and
    // the rest of a heading. A label typed with a danda or a comma inside its
    // brackets is still that label, and a Hindi instruction keeps its own
    // punctuation instead of being given a colon.
    lines: [
      // Four lines of verse, quoted rather than listed: the heading keeps its
      // own line and its marks, and the poem is left exactly as it was typed -
      // not run together, and not numbered 1 to 4. Its lines end with the
      // vertical bar and the double danda a keyboard without a danda produces.
      /^\s*प्रश्न 1\. निम्नलिखित पदो का संदर्भ सहित व्याख्या कीजिए \|\t\(1x2\)$/m,
      /^\s*कंफूका गुरु जगत का राम मिलावन और \|$/m,
      /^\s*सो सतगुरु को जानिए, मुक्ति दिखावन ठौर ॥।$/m,
      /^\s*और काज उनकु नही, द्रव्य कमावन हेता॥$/m,
      /^\s*\(ख\) सिरभाव किसी भी _+ के बिना पानी की ठीक जगह बताते थे।$/m,
      /^\s*खिदमत, ज्ञात, सूम, प्रलय, संयोग, प्रचुर, शुक्राचार्य, लवण शाश्वत, तूलिका$/m,
      /^\s*\(ग\) चित्रकार की खबर लेने के लिए राजा ने कितने समय पश्चात अहलकार को भेजा\?$/m,
      /^\s*प्रश्न 6\. अपनी पाठ्य पुस्तक से आठ लाइन की कविता लिखिए जो इस प्रश्न पत्र में ना आया हो।\t\(1x2\)$/m,
      /^\s*प्रश्न 7\. निम्नलिखित शब्दों के संधि विच्छेद कीजिए तथा संधि का नाम लिखिए।\t\(1x5\)$/m,
      /^\s*\(ग\) लेखक दुर्घटना के बाद जाना चाह रहा था-$/m,
      /^\s*\(क\) आकाश_ पाताल का अंतर होना _$/m,
      /\(द\) एक सौ तीस बच्चे \( \)$/m,
      /^\s*प्रश्न 9\. मुहावरा लिखिए\t\(1x3\)$/m,
      /^\s*\(क\) दूरदर्शन।\t+\(ख\) जनसंख्या की समस्या\t+\(ग\) दीपावली$/m,
      // Two sentences to fill in, neither of them labelled, the first of them
      // ending in the middle of a sentence. A line with a blank in it is an
      // item however it is punctuated, so these two must stay two.
      /^\s*1\. मोहन प्रतिदिन विद्यालय जाता है और वहाँ _+ पढ़ता$/m,
      /^\s*2\. सीता अपनी माता के साथ बाज़ार _+ जाती है।$/m,
      // Verse usually has no stop at the end of a line at all, which is
      // exactly what makes a line look unfinished. A quoted poem is left
      // alone whatever its punctuation.
      /^\s*हिमालय के आँगन में उसे प्रथम किरणों का दे उपहार$/m,
      /^\s*उषा ने हँस अभिवादन किया और पहनाया हीरक हार$/m
    ],
    // Nothing in a Hindi paper is given a colon it was not typed with, and no
    // question mark is invented for a sentence that is not asking anything.
    absent: [/।:/, /:$/m, /बताते\?/, /पश्चात\?/,
      /\d\. कंफूका/, /कीजिए \| कंफूका/]
  },
  {
    name: 'letter-spaced fixture (words written out letter by letter)',
    text: fs.readFileSync(path.join(__dirname, 'fixtures', 'letter-spaced.txt'), 'utf8'),
    kinds: ['inline'],
    // Prose rules must not touch these: "a i" is not an article waiting to
    // become "an", and "o o" is not a word typed twice.
    lines: [
      /1\. C h a i r /, /2\. B o o k /, /3\. T r e e /, /4\. R a i n /, /5\. L e t t e r /,
      /6\. P a i n t /, /7\. S e e /, /8\. B a l l o o n /, /9\. S c h o o l /, /10\. F a t h e r /
    ]
  },
  {
    name: 'hindi sample',
    text: PF.samples.hindi,
    kinds: ['mcq', 'list', 'list', 'match', 'plain', 'list', 'inline', 'plain', 'plain', 'inline', 'inline']
  },
  {
    name: 'english sample',
    text: PF.samples.english,
    kinds: ['mcq', 'list', 'list', 'list', 'inline', 'match', 'inline', 'plain', 'inline']
  }
];

var failures = [];

function fail(caseName, message) {
  failures.push(caseName + ': ' + message);
}

/**
 * Words only - labels, punctuation and spacing are the formatter's business.
 *
 * The danda is punctuation, however it is typed: "कीजिए ।" and "कीजिए।" are
 * the same word followed by the same full stop, and counting the danda as a
 * letter made every sentence the formatter tidied look like a lost word. The
 * marks are counted the same way whether they were typed "(1x 5)" or "(1x5)".
 */
function tokens(text) {
  return (text.toLowerCase()
    .replace(/[।॥]/g, ' ')
    .replace(/(\d)\s*[x×]\s*(\d)/g, function (all, before, after) {
      return before + ' x ' + after;
    })
    .match(/[a-z0-9ऀ-ॣ०-ॿ]+/g) || []);
}

/*
 * The header is compared separately from the questions, because its labels are
 * rewritten by design ("Sub - English" becomes "Sub: English", and a Hindi
 * paper gets Hindi labels). Inside the questions nothing may change except the
 * question prefix, so the list of excused words stays this short - a word lost
 * in a question body is a bug even if it is the letter "m".
 */
var RESTYLED = ('question questions que ques q प्रश्न').split(' ');

// No \b after the Devanagari: a Devanagari letter is not a word character to a
// JavaScript regular expression, so "प्रश्न 1." never matched and a Hindi
// paper's header was compared as though it were part of the questions.
var QUESTION_START_RE = /^\s*(que|ques|question|q|प्रश्न)(?![a-z])/i;

/** Everything from the first question onwards. */
function questionBody(text) {
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    if (QUESTION_START_RE.test(lines[i])) return lines.slice(i).join('\n');
  }
  return text;
}

function countWords(text) {
  var counts = {};
  tokens(questionBody(text)).forEach(function (word) {
    if (RESTYLED.indexOf(word) >= 0) return;
    counts[word] = (counts[word] || 0) + 1;
  });
  return counts;
}

function run(testCase) {
  var prepared = PF.normalize.prepare(testCase.text);
  var paper = PF.parser.parse(prepared.lines, {
    properNouns: PF.normalize.buildProperNounMap(prepared.lines),
    acceptedSuggestions: [],
    fontSizePt: 12
  });
  var result = PF.layout.fit(paper, testCase.maxPages
    ? Object.assign({}, OPTIONS, { maxPages: testCase.maxPages })
    : OPTIONS);
  var output = PF.renderText.render(result);

  /* 1. nothing lost ------------------------------------------------------ */
  var before = countWords(testCase.text);
  var after = countWords(output);
  var lost = Object.keys(before).filter(function (word) {
    return (after[word] || 0) < before[word];
  }).map(function (word) {
    return word + ' (' + before[word] + '→' + (after[word] || 0) + ')';
  });
  if (lost.length) {
    fail(testCase.name, lost.length + ' word(s) lost: ' + lost.slice(0, 10).join(', '));
  }

  /* 2. question shapes --------------------------------------------------- */
  var kinds = paper.questions.map(function (q) { return q.kind; });
  if (testCase.kinds && kinds.join(',') !== testCase.kinds.join(',')) {
    fail(testCase.name, 'question kinds changed\n      expected: ' + testCase.kinds.join(', ')
      + '\n      actual:   ' + kinds.join(', '));
  }

  /* 3. no control characters -------------------------------------------- */
  var control = output.match(/[ --]/g);
  if (control) {
    fail(testCase.name, control.length + ' control character(s) in the output');
  }

  /* marks land on the question, not inside a sub-question ---------------- */
  if (testCase.marks) {
    var marks = paper.questions.map(function (q) { return q.marks; });
    if (marks.join(',') !== testCase.marks.join(',')) {
      fail(testCase.name, 'marks wrong: expected ' + testCase.marks.join(', ')
        + ', got ' + marks.join(', '));
    }
  }

  /* expected lines, exactly as they will be laid out --------------------- */
  if (testCase.lines) {
    testCase.lines.forEach(function (pattern) {
      if (!pattern.test(output)) fail(testCase.name, 'expected a line matching ' + pattern);
    });
  }

  /* punctuation the formatter must not invent ---------------------------- */
  if (testCase.absent) {
    testCase.absent.forEach(function (pattern) {
      if (pattern.test(output)) fail(testCase.name, 'the output should hold nothing matching ' + pattern);
    });
  }

  /* every item, option and pair carries a label -------------------------- */
  paper.questions.forEach(function (q) {
    var groups = [q.items, q.pairs].concat(q.subs.map(function (sub) { return sub.options; }));
    groups.concat([q.subs.filter(function (sub) { return sub.stem; })]).forEach(function (group) {
      if (group.length < 2) return;
      var unlabelled = group.filter(function (entry) { return !entry.label; }).length;
      if (unlabelled && unlabelled < group.length) {
        fail(testCase.name, 'Q' + q.number + ' has ' + unlabelled + ' unlabelled entr(ies) '
          + 'in a group of ' + group.length + ' - numbering has a hole in it');
      }
    });
  });

  /* a match question must never hold a blank or a tick box --------------- */
  paper.questions.filter(function (q) { return q.kind === 'match'; }).forEach(function (q) {
    q.pairs.forEach(function (pair) {
      if (/(_{3,}|\(\s*\)|\[\s*\])/.test(pair.left + ' ' + pair.right)) {
        fail(testCase.name, 'Q' + q.number + ' was split into columns although it '
          + 'contains a blank or a tick box: "' + pair.left + '" | "' + pair.right + '"');
      }
    });
  });

  console.log('  ' + testCase.name
    + ' - ' + paper.questions.length + ' questions, ' + tokens(testCase.text).length + ' words, '
    + result.pageCount + ' page(s)');
}

console.log('Content integrity');
CASES.forEach(run);

/*
 * The header always looks like the same header.
 *
 * Time, class and marks share the fourth line and are spread across the width.
 * A paper that only gives one of them used to put that one field on a row of
 * its own, which reads as a line hanging off the left margin under three
 * centred ones.
 */
(function checkLonelyHeaderField() {
  var source = ['S.S Academy koirauna Bhadohi', 'Half _ yearly Examination', 'Sub- Hindi',
    'Class - 8th', 'Que 1. Tick the correct option (5)', 'a. one ( ) b. two ( )'].join('\n');
  var prepared = PF.normalize.prepare(source);
  var paper = PF.parser.parse(prepared.lines, {
    properNouns: {}, acceptedSuggestions: [], fontSizePt: 12
  });
  var blocks = PF.layout.fit(paper, OPTIONS).blocks;
  var classBlock = blocks.filter(function (block) {
    return (block.key === 'h.class') || (block.cellKeys || []).indexOf('h.class') >= 0;
  })[0];

  if (!classBlock) {
    fail('lonely header field', 'the class went missing from the header');
  } else if (classBlock.type === 'header-row') {
    fail('lonely header field', 'the only field on the fourth line was laid out as a row, '
      + 'so it sits at the left margin under three centred lines');
  } else if (classBlock.align !== 'center') {
    fail('lonely header field', 'a header line on its own should be centred with the rest');
  }

  var header = paper.header;
  if (header.school !== 'S.S. ACADEMY KOIRAUNA BHADOHI' || header.exam !== 'Half Yearly Examination') {
    fail('lonely header field', 'the title lines should be tidied to the house style, got "'
      + header.school + '" / "' + header.exam + '"');
  }
  console.log('  header - a single field on the fourth line stays centred, titles tidied');
})();

/*
 * The two-line spacing, end to end.
 *
 * A gap stated in lines has to survive all the way to the writers, and the
 * plain-text version is where that is easiest to get wrong: it turns a gap
 * into blank lines, and used to allow exactly one however large the gap was.
 * Nothing else may change - the same words, the same questions, on a paper
 * that is simply taller.
 */
(function checkSpacious() {
  var prepared = PF.normalize.prepare(PF.samples.english);
  var paper = PF.parser.parse(prepared.lines, {
    properNouns: PF.normalize.buildProperNounMap(prepared.lines),
    acceptedSuggestions: [],
    fontSizePt: 12
  });

  function textAt(densityId) {
    var options = Object.assign({}, OPTIONS, { densityId: densityId });
    return PF.renderText.render(PF.layout.fit(paper, options));
  }

  var spacious = textAt('spacious');
  var roomy = textAt('roomy');

  var questions = (spacious.match(/\n\n\nQue \d+\./g) || []).length;
  if (questions < paper.questions.length - 1) {
    fail('spacious spacing', 'expected two blank lines above every question but the '
      + 'first, found ' + questions + ' of ' + (paper.questions.length - 1));
  }
  if (/\n{5,}/.test(spacious)) {
    fail('spacious spacing', 'more than two blank lines in a row in the copied text');
  }
  if (/\n\n\nQue \d+\./.test(roomy)) {
    fail('roomy spacing', 'only the two-line setting may leave two blank lines');
  }
  if (tokens(spacious).join(' ') !== tokens(roomy).join(' ')) {
    fail('spacious spacing', 'the spacing changed the words of the paper');
  }

  /*
   * Two lines means two lines of the font in use. A gap frozen at a number of
   * points is two lines at 12pt, one and a half at 16pt, and too small to see
   * in a Hindi paper, where a line is a good deal taller.
   */
  function gapPt(densityId, fontSizePt, sample) {
    var source = PF.normalize.prepare(PF.samples[sample || 'english']);
    var parsed = PF.parser.parse(source.lines, {
      properNouns: {}, acceptedSuggestions: [], fontSizePt: fontSizePt
    });
    var result = PF.layout.fit(parsed, Object.assign({}, OPTIONS,
      { densityId: densityId, fontSizePt: fontSizePt, maxPages: 99 }));
    var gaps = result.blocks.filter(function (block) { return block.blankLinesBefore; });
    return gaps.length ? gaps[0].spaceBeforePt : 0;
  }

  var small = gapPt('spacious', 12);
  var large = gapPt('spacious', 16);
  if (!(large > small * 1.25)) {
    fail('spacious spacing', 'the gap should grow with the font: ' + small + 'pt at 12pt '
      + 'became ' + large + 'pt at 16pt');
  }
  if (!(gapPt('spacious', 12, 'hindi') > small)) {
    fail('spacious spacing', 'a Hindi line is taller, so two Hindi lines must be a '
      + 'bigger gap than two English ones');
  }

  var automatic = PF.layout.fit(paper, Object.assign({}, OPTIONS, { densityId: 'auto' }));
  if (automatic.density.id === 'spacious') {
    fail('spacious spacing', 'automatic spacing must never choose a setting that is '
      + 'only offered by name');
  }
  console.log('  two-line spacing - ' + questions + ' two-line gaps, same words as Roomy, '
    + 'never chosen automatically');
})();

if (failures.length) {
  console.error('\nFAILED (' + failures.length + ')');
  failures.forEach(function (message) { console.error('  - ' + message); });
  process.exit(1);
}
console.log('\nAll integrity checks passed.');
