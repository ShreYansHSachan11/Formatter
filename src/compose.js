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

  /** The widest cell in each column, for a given column count. */
  function columnWidths(cells, cols, fontPt) {
    var widths = [];
    for (var i = 0; i < cols; i++) widths.push(0);
    cells.forEach(function (cell, index) {
      var column = index % cols;
      widths[column] = Math.max(widths[column], PF.text.widthIn(cell, fontPt));
    });
    return widths;
  }

  /**
   * How many cells fit on a row, and how wide each column has to be.
   *
   * Measuring every column separately is what keeps four options on one line.
   * Sizing them all to the widest cell - the obvious way - reads "(d) None of
   * these" as the width of every column, needs four times that, and drops the
   * whole question onto four stacked lines even though the real total is half
   * the page. Here each column is only as wide as its own cells, and whatever
   * space is left over is shared out equally, so the columns stay evenly spaced.
   */
  function packColumns(cells, availableIn, fontPt, maxCols) {
    var limit = Math.max(1, Math.min(maxCols || 6, cells.length));

    for (var cols = limit; cols > 1; cols--) {
      var fitted = fitAt(cells, cols, availableIn, fontPt);
      if (!fitted) continue;

      // Four options over three columns leave one stranded on a line of its
      // own. Spreading them over the same number of rows - two and two - reads
      // better and costs nothing, so it is taken whenever it also fits.
      var balanced = Math.ceil(cells.length / Math.ceil(cells.length / cols));
      if (balanced < cols) {
        var evened = fitAt(cells, balanced, availableIn, fontPt);
        if (evened) return evened;
      }
      return fitted;
    }
    return { cols: 1, widthsIn: null };
  }

  function fitAt(cells, cols, availableIn, fontPt) {
    var widths = columnWidths(cells, cols, fontPt);
    var needed = widths.reduce(function (sum, width) { return sum + width; }, 0);
    if (needed + COLUMN_GAP_IN * (cols - 1) > availableIn) return null;

    var share = (availableIn - needed) / cols;
    return {
      cols: cols,
      widthsIn: widths.map(function (width) { return width + share; })
    };
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

  /*
   * A line the user has retyped in the preview wins over the composed one.
   *
   * Edits are keyed, not positional, and they are applied here rather than to
   * the finished blocks so that everything downstream sees the real text: the
   * columns are packed around the edited words and the page count is measured
   * from them, instead of from the text they replaced.
   */
  function edited(options, key, text) {
    var edits = options && options.edits;
    if (edits && Object.prototype.hasOwnProperty.call(edits, key)) return sanitize(edits[key]);
    return text;
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
    var push = function (key, text) {
      blocks.push({
        type: 'header',
        key: key,
        runs: [run(edited(options, key, text), true)],
        align: 'center',
        indentIn: 0,
        spaceBeforePt: 0
      });
    };

    if (header.school) push('h.school', header.school);
    if (header.exam) push('h.exam', header.exam);
    if (header.subject) push('h.subject', labelFor('subject', header) + header.subject);

    var line4 = [];
    var line4Keys = [];
    var addField = function (key, text) { line4Keys.push(key); line4.push(text); };
    if (header.time) addField('h.time', labelFor('time', header) + header.time);
    if (header.className) addField('h.class', labelFor('class', header) + header.className);
    if (header.maxMarks) addField('h.marks', labelFor('marks', header) + header.maxMarks);

    if (line4.length) {
      blocks.push({
        type: 'header-row',
        cellKeys: line4Keys,
        cells: line4.map(function (cell, index) { return sanitize(edited(options, line4Keys[index], cell)); }),
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

  function composeQuestion(question, density, options, isFirst, base) {
    var blocks = [];
    var available = contentWidthIn(density);
    var fontPt = options.fontSizePt;
    var marksKey = base + '.marks';

    blocks.push({
      type: 'question',
      key: base + '.head',
      marksKey: marksKey,
      runs: [run(edited(options, base + '.head',
        questionPrefix(question, options) + ' ' + question.heading), true)],
      rightRuns: question.marks || (options.edits && options.edits[marksKey])
        ? [run(edited(options, marksKey, '(' + question.marks + ')'), true)]
        : null,
      indentIn: 0,
      hangingIn: 0,
      spaceBeforePt: isFirst
        ? density.gapHeaderPt
        : (options.noQuestionGap ? 0 : density.gapQuestionPt)
    });

    if (question.kind === 'mcq') {
      question.subs.forEach(function (sub, index) {
        var subBase = base + '.s' + index;
        if (sub.stem) {
          blocks.push({
            type: 'sub',
            key: subBase + '.stem',
            runs: [run(edited(options, subBase + '.stem',
              itemText({ label: sub.label, text: sub.stem })), false)],
            indentIn: INDENT.sub,
            hangingIn: INDENT.sub,
            spaceBeforePt: index === 0 ? 0 : density.gapSubPt
          });
        }
        if (sub.options.length) {
          var keys = sub.options.map(function (option, i) { return subBase + '.o' + i; });
          var cells = sub.options.map(function (option, i) {
            return edited(options, keys[i], optionText(option));
          });
          // Every option on one line when they fit, which is what the measured
          // packing is for; only genuinely long choices end up stacked.
          var packed = packColumns(cells, available - INDENT.option, fontPt, cells.length);
          blocks.push({
            type: 'options',
            cellKeys: keys,
            cells: cells,
            cols: packed.cols,
            colWidthsIn: packed.widthsIn,
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
        var headerKeys = [base + '.ch.l', base + '.ch.r'];
        blocks.push({
          type: 'pair',
          cellKeys: headerKeys,
          cells: [question.columnHeaders.left, question.columnHeaders.right].map(function (cell, i) {
            return sanitize(edited(options, headerKeys[i], cell));
          }),
          bold: true,
          cols: 2,
          colWidthsIn: [leftWidth, available - INDENT.pair - leftWidth],
          indentIn: INDENT.pair,
          spaceBeforePt: 0
        });
      }

      question.pairs.forEach(function (pair, index) {
        var pairKeys = [base + '.p' + index + '.l', base + '.p' + index + '.r'];
        blocks.push({
          type: 'pair',
          cellKeys: pairKeys,
          cells: [leftCells[index], pair.right].map(function (cell, i) {
            return sanitize(edited(options, pairKeys[i], cell));
          }),
          cols: 2,
          colWidthsIn: [leftWidth, available - INDENT.pair - leftWidth],
          indentIn: INDENT.pair,
          spaceBeforePt: 0
        });
      });
      return blocks;
    }

    if (question.kind === 'inline') {
      var inlineKeys = question.items.map(function (item, index) { return base + '.i' + index; });
      var inlineCells = question.items.map(function (item, index) {
        return edited(options, inlineKeys[index], itemText(item));
      });
      // How many fit is measured, not guessed: each column is sized from its
      // own items, and a blank counts towards the width, so items answered on
      // the page end up two or three across while bare words sit five across.
      var inlinePacked = packColumns(inlineCells, available - INDENT.item, fontPt, 5);
      blocks.push({
        type: 'inline',
        cellKeys: inlineKeys,
        cells: inlineCells,
        cols: inlinePacked.cols,
        colWidthsIn: inlinePacked.widthsIn,
        indentIn: INDENT.item,
        spaceBeforePt: 0
      });
      return blocks;
    }

    question.items.forEach(function (item, index) {
      var key = base + '.i' + index;
      blocks.push({
        type: 'item',
        key: key,
        runs: [run(edited(options, key, itemText(item)), false)],
        rightRuns: item.box ? [run('[      ]', false)] : null,
        indentIn: INDENT.item,
        hangingIn: INDENT.item,
        spaceBeforePt: index === 0 ? 0 : density.gapSubPt
      });
    });
    return blocks;
  }

  /*
   * A line the user emptied in the preview is a line they deleted - marks and
   * all. Nothing else can produce an empty line here: a question always
   * carries its prefix and an item always carries its label.
   */
  function isEmptyLine(block) {
    if (block.type === 'rule' || block.cells) return false;
    return (block.runs || []).every(function (item) { return !item.text; });
  }

  function compose(paper, density, options) {
    var blocks = composeHeader(paper.header, density, options);
    paper.questions.forEach(function (question, index) {
      blocks = blocks.concat(composeQuestion(question, density, options, index === 0, 'q' + index));
    });
    return blocks.filter(function (block) { return !isEmptyLine(block); });
  }

  PF.compose = {
    PAGE: PAGE,
    DENSITIES: DENSITIES,
    INDENT: INDENT,
    COLUMN_GAP_IN: COLUMN_GAP_IN,
    contentWidthIn: contentWidthIn,
    packColumns: packColumns,
    labelFor: labelFor,
    compose: compose
  };
})(window.PF = window.PF || {});
