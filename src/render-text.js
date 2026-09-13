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

  function render(result) {
    var lines = [];
    result.blocks.forEach(function (block, index) {
      // A blank line where the layout leaves a visible gap, so the plain-text
      // version breathes the same way the document does.
      if (index > 0 && (block.spaceBeforePt || 0) >= 4) lines.push('');
      lines.push(renderBlock(block));
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  PF.renderText = { render: render };
})(window.PF = window.PF || {});
