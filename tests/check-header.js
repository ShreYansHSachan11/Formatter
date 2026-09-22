/*
 * tests/check-header.js - the four header lines, read from however they were typed.
 *
 *   node tests/check-header.js
 *
 * The header is the one part of the paper that is identical every time, so it
 * has to survive every spelling of "Time-", "Class:-", "M.M.50" that turns up.
 * The case that broke it: "Time- 2:30 Class:- 1st" produced a time of
 * "2:30 Class", and the word Class then appeared twice on the line.
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

var CASES = [
  {
    name: 'time and class on one line, no units',
    lines: ['SS ACADEMY KOIRAUNA BHADOHI', 'Half yearly examination 2026-27', 'Sub:- English',
      'Time- 2:30 Class:- 1st M.M. 50'],
    expect: { school: 'S.S. ACADEMY KOIRAUNA BHADOHI', subject: 'English', className: '1st', time: '2:30', maxMarks: '50' }
  },
  {
    name: 'tab-separated, with a unit',
    lines: ['S.S. ACADEMY KOIRAUNA BHADOHI', 'HALF YEARLY EXAMINATION 2026 -27', 'Sub - English',
      'Time - 2:30 h\tClass - 2nd (B)\tM.M.50'],
    expect: { school: 'S.S. ACADEMY KOIRAUNA BHADOHI', subject: 'English', className: '2nd (B)', time: '2:30 h', maxMarks: '50' }
  },
  {
    name: 'hours spelled out',
    lines: ['SUNRISE ACADEMY', 'Annual examination 2026-27', 'Subject: Maths',
      'Time: 3 hours', 'Class: 5th', 'M.M. 80'],
    // "SUNRISE" is a word, not initials, so it keeps its spelling.
    expect: { school: 'SUNRISE ACADEMY', subject: 'Maths', className: '5th', time: '3 hours', maxMarks: '80' }
  },
  {
    name: 'hindi paper',
    lines: ['S.S. ACADEMY KOIRAUNA BHADOHI', 'Half yearly examination 2026-27', 'Sub:- Hindi',
      'Time- 2:30    Class:- 5th    M.M. 50'],
    expect: { school: 'S.S. ACADEMY KOIRAUNA BHADOHI', subject: 'Hindi', className: '5th', time: '2:30', maxMarks: '50' }
  },
  {
    name: 'an abbreviated subject keeps its last dot',
    lines: ['S.S. ACADEMY KOIRAUNA BHADOHI', 'Half yearly examination 2026-27', 'Sub:- G.K.',
      'Time- 2:30 Class:- 4th M.M. 50'],
    expect: { school: 'S.S. ACADEMY KOIRAUNA BHADOHI', subject: 'G.K.', className: '4th', time: '2:30', maxMarks: '50' }
  },
  {
    name: 'saint schools keep their usual abbreviation',
    lines: ['ST JOSEPH SCHOOL', 'Half yearly examination 2026-27', 'Sub:- English',
      'Time- 2:30 Class:- 3rd M.M. 50'],
    expect: { school: 'ST JOSEPH SCHOOL', subject: 'English', className: '3rd', time: '2:30', maxMarks: '50' }
  },
  {
    // The class-8 Hindi paper, typed exactly as it arrived. The underscores
    // are separators drawn by hand, and "Mark" is the label this teacher uses
    // for the maximum marks. Reading neither of them lost the whole last line.
    name: 'underscores for separators, and "Mark" for M.M.',
    lines: ['S.S Academy koirauna Bhadohi', 'Half _ yearly Examination', 'Class - 8th',
      'Sub- Hindi', 'Time_ 2:30\t\t\tMark__50'],
    expect: {
      school: 'S.S. ACADEMY KOIRAUNA BHADOHI',
      exam: 'Half Yearly Examination',
      subject: 'Hindi', className: '8th', time: '2:30', maxMarks: '50'
    }
  },
  {
    name: 'marks spelled out in full',
    lines: ['S.S. ACADEMY KOIRAUNA BHADOHI', 'ANNUAL EXAMINATION 2026-27', 'Subject: Maths',
      'Class: 12th', 'Time: 3 hours', 'Maximum Marks - 100'],
    expect: { exam: 'Annual Examination 2026-27', subject: 'Maths', className: '12th',
      time: '3 hours', maxMarks: '100' }
  },
  {
    // "Marketing" begins with the word "Mark". A subject must not end there.
    name: 'a subject that begins like a label',
    lines: ['S.S. ACADEMY KOIRAUNA BHADOHI', 'Half yearly examination 2026-27',
      'Sub: Marketing   Class: 11th   Total Marks: 70'],
    expect: { subject: 'Marketing', className: '11th', maxMarks: '70' }
  },
  {
    // "Standard" is a class label in half the papers in the country and an
    // ordinary word in the other half. A class has to look like a class.
    name: 'a word that only looks like a class label',
    lines: ['S.S. ACADEMY KOIRAUNA BHADOHI', 'Standard Examination 2026-27', 'Sub: English',
      'Std. 6   Time: 2:30   M.M. 50'],
    expect: { exam: 'Standard Examination 2026-27', className: '6', time: '2:30', maxMarks: '50' }
  },
  {
    name: 'labels in Hindi',
    lines: ['एस.एस. एकेडमी कोइरौना भदोही', 'अर्धवार्षिक परीक्षा 2026-27',
      'विषय- हिंदी', 'समय_ 2:30    कक्षा- 5    पूर्णांक__50'],
    expect: { subject: 'हिंदी', className: '5', time: '2:30', maxMarks: '50' }
  }
];

var failures = [];

console.log('Header parsing');
CASES.forEach(function (testCase) {
  var source = testCase.lines.concat(['Que 1. Tick the correct option (5)', 'a. one ( ) b. two ( )']).join('\n');
  var prepared = PF.normalize.prepare(source);
  var header = PF.parser.parse(prepared.lines, { fontSizePt: 12 }).header;

  var wrong = Object.keys(testCase.expect).filter(function (field) {
    return header[field] !== testCase.expect[field];
  });

  if (wrong.length) {
    wrong.forEach(function (field) {
      failures.push(testCase.name + ': ' + field + ' = "' + header[field]
        + '", expected "' + testCase.expect[field] + '"');
    });
  }

  // No field may swallow the label of the next one.
  ['time', 'className', 'subject'].forEach(function (field) {
    if (/\b(class|time|sub|subject|m\.?m)\b/i.test(header[field] || '')) {
      failures.push(testCase.name + ': ' + field + ' = "' + header[field]
        + '" has run into the next field');
    }
  });

  console.log('  ' + testCase.name + ' - ' + header.time + ' | ' + header.className + ' | M.M. ' + header.maxMarks);
});

if (failures.length) {
  console.error('\nFAILED (' + failures.length + ')');
  failures.forEach(function (message) { console.error('  - ' + message); });
  process.exit(1);
}
console.log('\nHeader check passed: ' + CASES.length + ' header styles read correctly.');
