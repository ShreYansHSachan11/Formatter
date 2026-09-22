/*
 * render-text.js - layout blocks -> plain text for the clipboard.
 *
 * Columns use real tab characters, so pasting into Word keeps the alignment
 * (Word converts tabs to its own default tab stops) instead of collapsing the
 * layout into a wall of single spaces.
 */
(function (PF) {
  'use strict';

  function runsToText(runs) {
    return (runs || []).map(function (run) { return run.text; }).join('');
  }

  function indentFor(block) {
    var steps = Math.round((block.indentIn || 0) / 0.3);
    return new Array(steps + 1).join('    ');
  }

  function renderBlock(block) {
    if (block.type === 'rule') {
      return new Array(58).join('—');
    }

    if (block.type === 'header-row') {
      return block.cells.join('\t\t');
    }

    if (block.cells) {
      var cols = block.cols || 1;
      var lines = [];
      for (var i = 0; i < block.cells.length; i += cols) {
        lines.push(indentFor(block) + block.cells.slice(i, i + cols).join('\t'));
      }
      return lines.join('\n');
    }

    var text = indentFor(block) + runsToText(block.runs);
    if (block.rightRuns) text += '\t' + runsToText(block.rightRuns);
    return text;
  }

  var MAX_BLANK_LINES = 2;

  /*
   * Blank lines where the layout leaves a visible gap, so the plain-text
   * version breathes the same way the document does. A setting that asks for
   * its gap in lines says how many; anything else gets one.
   */
  function blankLinesBefore(block) {
    if (block.blankLinesBefore) return Math.min(block.blankLinesBefore, MAX_BLANK_LINES);
    return (block.spaceBeforePt || 0) >= 4 ? 1 : 0;
  }

  function render(result) {
    var lines = [];
    result.blocks.forEach(function (block, index) {
      if (index > 0) {
        for (var i = 0; i < blankLinesBefore(block); i++) lines.push('');
      }
      lines.push(renderBlock(block));
    });
    return lines.join('\n')
      .replace(new RegExp('\\n{' + (MAX_BLANK_LINES + 2) + ',}', 'g'),
        new Array(MAX_BLANK_LINES + 2).join('\n'));
  }

  PF.renderText = { render: render };
})(window.PF = window.PF || {});
