/*
 * compose.js - Paper model + density -> flat list of layout blocks.
 *
 * Blocks are the single intermediate representation shared by the Word writer,
 * the plain-text writer, the on-screen preview and the page-fitting engine, so
 * all four stay in agreement about what the paper looks like.
 *
 * Block shape:
 *   { type, runs, rightRuns, cells, cols, colWidthsIn,
 *     indentIn, hangingIn, spaceBeforePt, align, border }
 */
(function (PF) {
  'use strict';

  var PAGE = { widthIn: 8.2681, heightIn: 11.6931 }; // A4 = 210 x 297 mm (11906 x 16838 twips)

  var DENSITIES = [
    { id: 'roomy',   label: 'Roomy',        marginTopIn: 0.75, marginBottomIn: 0.65, marginXIn: 0.75, line: 1.10, gapQuestionPt: 7, gapSubPt: 2, gapHeaderPt: 8 },
    { id: 'normal',  label: 'Normal',       marginTopIn: 0.65, marginBottomIn: 0.55, marginXIn: 0.65, line: 1.05, gapQuestionPt: 5, gapSubPt: 1, gapHeaderPt: 6 },
    { id: 'tight',   label: 'Tight',        marginTopIn: 0.55, marginBottomIn: 0.45, marginXIn: 0.60, line: 1.00, gapQuestionPt: 4, gapSubPt: 0, gapHeaderPt: 5 },
    { id: 'tighter', label: 'Tighter',      marginTopIn: 0.50, marginBottomIn: 0.40, marginXIn: 0.55, line: 0.97, gapQuestionPt: 3, gapSubPt: 0, gapHeaderPt: 4 },
    { id: 'compact', label: 'Compact',      marginTopIn: 0.45, marginBottomIn: 0.35, marginXIn: 0.50, line: 0.93, gapQuestionPt: 2, gapSubPt: 0, gapHeaderPt: 3 },
    { id: 'ultra',   label: 'Ultra compact', marginTopIn: 0.40, marginBottomIn: 0.30, marginXIn: 0.45, line: 0.88, gapQuestionPt: 1, gapSubPt: 0, gapHeaderPt: 2 }
  ];

  var INDENT = { sub: 0.3, option: 0.58, item: 0.3, pair: 0.3 };
  var COLUMN_GAP_IN = 0.2;

  function contentWidthIn(density) {
    return PAGE.widthIn - 2 * density.marginXIn;
  }

  /** Largest column count where every cell still fits on one line. */
  function fitColumns(cells, availableIn, fontPt, maxCols) {
    var widest = 0;
    cells.forEach(function (cell) {
      widest = Math.max(widest, PF.text.widthIn(cell, fontPt));
    });
    if (widest <= 0) return 1;
    var cols = Math.floor(availableIn / (widest + COLUMN_GAP_IN));
    return Math.max(1, Math.min(cols, maxCols || 6, cells.length));
  }

  /*
   * Last line of defence. Parsing works with sentinel characters standing in
   * for tabs and space runs; if one ever survived to this point it would be
   * written into the Word file and show up as a hollow box glyph. Every string
   * that becomes a run or a cell passes through here.
   */
  function sanitize(text) {
    return PF.normalize.clean(text);
  }

  function run(text, bold) {
    return { text: sanitize(text), bold: !!bold };
  }

  function questionPrefix(question, options) {
    var style = options.questionPrefix || 'auto';
    if (style === 'auto') {
      style = PF.text.hasDevanagari(question.heading) ? 'प्रश्न' : 'Que';
    }
    return style + ' ' + question.number + '.';
  }

  /**
   * One labelling convention for the whole paper: numbers get "1.", letters
   * (Latin or Devanagari) get "(a)" / "(क)". Options are always bracketed so
   * they read as choices rather than as numbered steps.
   */
  function formatLabel(label, style) {
    if (!label && label !== 0) return '';
    var value = String(label);
    if (style === 'option') return '(' + value + ') ';
    if (/^\d+$/.test(value)) return value + '. ';
    return '(' + value + ') ';
  }

  function optionText(option) {
    return sanitize(formatLabel(option.label, 'option') + option.text) + ' ( )';
  }

  function itemText(item) {
    return sanitize(formatLabel(item.label) + item.text);
  }

  /* ---------------------------------------------------------------- header */

  function composeHeader(header, density, options) {
    var blocks = [];
    var push = function (runs, spaceBeforePt) {
      blocks.push({
        type: 'header',
        runs: runs,
        align: 'center',
        indentIn: 0,
        spaceBeforePt: spaceBeforePt || 0
      });
    };

    if (header.school) push([run(header.school, true)]);
    if (header.exam) push([run(header.exam, true)]);
    if (header.subject) push([run(labelFor('subject', header) + header.subject, true)]);

    var line4 = [];
    if (header.time) line4.push(labelFor('time', header) + header.time);
    if (header.className) line4.push(labelFor('class', header) + header.className);
    if (header.maxMarks) line4.push(labelFor('marks', header) + header.maxMarks);

    if (line4.length) {
      blocks.push({
        type: 'header-row',
        cells: line4.map(sanitize),
        bold: true,
        indentIn: 0,
        spaceBeforePt: 0
      });
    }

    blocks.push({
      type: 'rule',
      runs: [run('', false)],
      indentIn: 0,
      spaceBeforePt: 0,
      border: true
    });
    return blocks;
  }

  function labelFor(field, header) {
    var hindi = PF.text.hasDevanagari(header.subject || '') || PF.text.hasDevanagari(header.exam || '');
    var labels = hindi
      ? { subject: 'विषय: ', time: 'समय: ', class: 'कक्षा: ', marks: 'पूर्णांक: ' }
      : { subject: 'Sub: ', time: 'Time: ', class: 'Class: ', marks: 'M.M. ' };
    return labels[field];
  }

  /* ------------------------------------------------------------- questions */

  function composeQuestion(question, density, options, isFirst) {
    var blocks = [];
    var available = contentWidthIn(density);
    var fontPt = options.fontSizePt;

    blocks.push({
      type: 'question',
      runs: [run(questionPrefix(question, options) + ' ' + question.heading, true)],
      rightRuns: question.marks ? [run('(' + question.marks + ')', true)] : null,
      indentIn: 0,
      hangingIn: 0,
      spaceBeforePt: isFirst
        ? density.gapHeaderPt
        : (options.noQuestionGap ? 0 : density.gapQuestionPt)
    });

    if (question.kind === 'mcq') {
      question.subs.forEach(function (sub, index) {
        if (sub.stem) {
          blocks.push({
            type: 'sub',
            runs: [run(itemText({ label: sub.label, text: sub.stem }), false)],
            indentIn: INDENT.sub,
            hangingIn: INDENT.sub,
            spaceBeforePt: index === 0 ? 0 : density.gapSubPt
          });
        }
        if (sub.options.length) {
          var cells = sub.options.map(optionText);
          blocks.push({
            type: 'options',
            cells: cells,
            cols: fitColumns(cells, available - INDENT.option, fontPt, 4),
            indentIn: INDENT.option,
            spaceBeforePt: 0
          });
        }
      });
      return blocks;
    }

    if (question.kind === 'match') {
      var leftCells = question.pairs.map(function (pair) {
        return formatLabel(pair.label) + pair.left;
      });
      var widestLeft = 0;
      leftCells.forEach(function (cell) {
        widestLeft = Math.max(widestLeft, PF.text.widthIn(cell, fontPt));
      });
      // Columns sit at a third of the width at minimum, so they never look cramped.
      var leftWidth = Math.min(Math.max(widestLeft + 0.45, available / 3), available * 0.55);

      if (question.columnHeaders) {
        blocks.push({
          type: 'pair',
          cells: [question.columnHeaders.left, question.columnHeaders.right].map(sanitize),
          bold: true,
          cols: 2,
          colWidthsIn: [leftWidth, available - INDENT.pair - leftWidth],
          indentIn: INDENT.pair,
          spaceBeforePt: 0
        });
      }

      question.pairs.forEach(function (pair, index) {
        blocks.push({
          type: 'pair',
          cells: [leftCells[index], pair.right].map(sanitize),
          cols: 2,
          colWidthsIn: [leftWidth, available - INDENT.pair - leftWidth],
          indentIn: INDENT.pair,
          spaceBeforePt: 0
        });
      });
      return blocks;
    }

    if (question.kind === 'inline') {
      var inlineCells = question.items.map(itemText);
      // How many fit is measured, not guessed: the widest item decides, and a
      // blank counts towards its width, so items answered on the page end up
      // two or three across while bare words sit five across.
      blocks.push({
        type: 'inline',
        cells: inlineCells,
        cols: fitColumns(inlineCells, available - INDENT.item, fontPt, 5),
        indentIn: INDENT.item,
        spaceBeforePt: 0
      });
      return blocks;
    }

    question.items.forEach(function (item, index) {
      blocks.push({
        type: 'item',
        runs: [run(itemText(item), false)],
        rightRuns: item.box ? [run('[      ]', false)] : null,
        indentIn: INDENT.item,
        hangingIn: INDENT.item,
        spaceBeforePt: index === 0 ? 0 : density.gapSubPt
      });
    });
    return blocks;
  }

  function compose(paper, density, options) {
    var blocks = composeHeader(paper.header, density, options);
    paper.questions.forEach(function (question, index) {
      blocks = blocks.concat(composeQuestion(question, density, options, index === 0));
    });
    return blocks;
  }

  PF.compose = {
    PAGE: PAGE,
    DENSITIES: DENSITIES,
    INDENT: INDENT,
    COLUMN_GAP_IN: COLUMN_GAP_IN,
    contentWidthIn: contentWidthIn,
    fitColumns: fitColumns,
    compose: compose
  };
})(window.PF = window.PF || {});
