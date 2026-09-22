/*
 * tests/check-language.js - what the language check offers, and how sure it is.
 *
 *   node tests/check-language.js
 *
 * The two tiers are the whole point of this part of the program: a mechanical
 * fix is applied without asking, and anything that could change the meaning of
 * a question is offered with a tick box. A suggestion that arrives already
 * ticked is, in effect, an automatic change - so what is ticked by default
 * matters as much as what is suggested.
 *
 * The case that made this file: "Who was inky?" makes inky a name, and the
 * paper came back with "The Princess was allowed to climb Trees".
 */
'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var sandbox = { window: {}, console: console };
sandbox.global = sandbox;
vm.createContext(sandbox);
['text-utils.js', 'rules-language.js', 'normalize.js', 'parser.js'].forEach(function (file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', file), 'utf8'), sandbox, { filename: file });
});
var PF = sandbox.window.PF;

var failures = [];

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function suggestionsFor(lines) {
  var prepared = PF.normalize.prepare(lines.join('\n'));
  return { fixes: prepared.fixes, suggestions: PF.normalize.suggest(prepared.lines) };
}

function find(suggestions, word) {
  return suggestions.filter(function (suggestion) { return suggestion.before === word; })[0];
}

console.log('Language check');

/* --- a common word that happened to follow "name of" --------------------- */

var common = suggestionsFor([
  'Que 1. Answer the following questions:',
  'What is the name of trees planted in the school?',
  'The Princess was allowed to climb trees.'
]).suggestions;

var trees = find(common, 'trees');
expect(!!trees, 'the capital for "trees" should still be offered, just not ticked');
expect(!trees || trees.confidence === 'low',
  '"trees" is used as an ordinary word elsewhere in the paper, so its capital '
  + 'must not be ticked by default (it is "' + (trees && trees.confidence) + '")');
console.log('  a word used as an ordinary word elsewhere - offered, unticked');

/* --- a real name, used only as a name ------------------------------------ */

var name = suggestionsFor([
  'Que 1. Answer the following questions:',
  'Who was inky ?',
  'Write two lines about the story.'
]).suggestions;

var inky = find(name, 'inky');
expect(!!inky, '"inky" should be offered a capital');
expect(!inky || inky.confidence === 'high',
  '"inky" is only ever used as a name, so its capital should be ticked by default');
console.log('  a word only ever used as a name - offered, ticked');

/* --- nothing user-facing may carry the numbering marker ------------------ */

var marked = suggestionsFor([
  'Que 1. Answer the following questions:',
  '\u0003RMike lived with his grandpa :',
  '\u0003RThe fox jumped  through the window'
]);

marked.fixes.forEach(function (fix) {
  expect(!/^[a-zA-Z]?Mike|^[a-zA-Z]?The fox/.test(fix.before) || /^(Mike|The fox)/.test(fix.before),
    'the automatic-numbering marker leaked into the list of fixes: "' + fix.before + '"');
});
expect(PF.normalize.clean('\u0003RMike lived with his') === 'Mike lived with his',
  'clean() should take the numbering marker and its format letter together, '
  + 'not leave a stray "R" behind');
console.log('  the numbering marker never reaches anything a person reads');

/* --- a question mark is only for a question ------------------------------ */

/*
 * The question word has to be the whole word. "किस" lives inside "किसी",
 * which asks nothing at all, and a statement about where water belongs came
 * back with a question mark on the end of it.
 */
var STATEMENT = 'सिरभाव किसी भी सहारे के बिना पानी की ठीक जगह बताते थे';
var QUESTION = 'नित्य आनंद में कौन रह सकता है';

expect(PF.normalize.polishFragment(STATEMENT, { terminalQuestionMark: true }) === STATEMENT,
  '"किसी" is not "किस": a statement must not be given a question mark ("'
  + PF.normalize.polishFragment(STATEMENT, { terminalQuestionMark: true }) + '")');
expect(PF.normalize.polishFragment(QUESTION, { terminalQuestionMark: true }) === QUESTION + '?',
  'a Hindi question should still be given its question mark');
console.log('  a question mark only where something is actually asked');

/* --- the mechanical tier still applies without asking -------------------- */

var mechanical = suggestionsFor([
  'Que 1. Fill in the blanks:',
  'He saw a elephant near the ____ gate .'
]);
var joined = mechanical.fixes.map(function (fix) { return fix.after; }).join(' | ');
expect(/an elephant/.test(joined), '"a elephant" should be corrected without asking');
expect(!mechanical.suggestions.some(function (s) { return /elephant/.test(s.before); }),
  'the article fix is mechanical and should not also be offered as a suggestion');
console.log('  a mechanical fix is applied, not offered');

if (failures.length) {
  console.error('\nFAILED (' + failures.length + ')');
  failures.forEach(function (message) { console.error('  - ' + message); });
  process.exit(1);
}

console.log('\nLanguage check passed: the two tiers hold, and the paper decides '
  + 'what counts as a name.');
