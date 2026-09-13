/*
 * layout.js - estimates how tall the paper will be in Word and picks the
 * loosest density that still fits the page budget (2 pages by default).
 *
 * Word is not available to measure against, so heights are estimated from
 * per-character widths. Estimates are deliberately slightly pessimistic: a
 * paper that spills onto a third page is a much worse failure than one that
 * ends up a little tighter than it had to be.
 */
(function (PF) {
  'use strict';

  // Ratio of a font's default single line height to its point size.
  var LINE_FACTOR = { latin: 1.18, devanagari: 1.40 };
  var SAFETY = 0.97; // usable fraction of the text column height

  function lineHeightPt(text, density, fontPt) {
    var factor = PF.text.hasDevanagari(text) ? LINE_FACTOR.devanagari : LINE_FACTOR.latin;
    return fontPt * factor * density.line;
  }

  function blockText(block) {
    if (block.cells) return block.cells.join(' ');
    if (block.runs) {
      return block.runs.map(function (r) { return r.text; }).join('')
        + (block.rightRuns ? ' ' + block.rightRuns.map(function (r) { return r.text; }).join('') : '');
    }
    return '';
  }

  function blockHeightPt(block, density, options) {
    var fontPt = options.fontSizePt;
    var content = PF.compose.contentWidthIn(density);
    var text = blockText(block);
    var height = lineHeightPt(text, density, fontPt);

    if (block.type === 'rule') return fontPt * 0.45 * density.line + (block.spaceBeforePt || 0);

    if (block.cells) {
      var rows;
      if (block.colWidthsIn) {
        rows = 1;
        // A match pair wraps if either side overflows its column.
        block.cells.forEach(function (cell, index) {
          rows = Math.max(rows, PF.text.lineCount(cell, fontPt, block.colWidthsIn[index] - 0.1));
        });
      } else {
        rows = Math.ceil(block.cells.length / (block.cols || 1));
      }
      return rows * height + (block.spaceBeforePt || 0);
    }

    var reserved = block.rightRuns
      ? PF.text.widthIn(blockText({ runs: block.rightRuns }), fontPt) + 0.25
      : 0;
    var available = content - (block.indentIn || 0) - reserved;
    var lines = PF.text.lineCount(blockText({ runs: block.runs }), fontPt, available);
    return lines * height + (block.spaceBeforePt || 0);
  }

  /** Flows blocks into pages so the preview can show real page breaks. */
  function paginate(blocks, density, options) {
    var capacityPt = (PF.compose.PAGE.heightIn - density.marginTopIn - density.marginBottomIn) * 72 * SAFETY;
    var pages = [[]];
    var used = 0;

    blocks.forEach(function (block, index) {
      var height = blockHeightPt(block, density, options);
      if (index > 0 && used + height > capacityPt && pages[pages.length - 1].length) {
        pages.push([]);
        used = 0;
        height -= (block.spaceBeforePt || 0); // no leading gap at the top of a page
      }
      pages[pages.length - 1].push(block);
      used += height;
    });

    return { pages: pages, pageCount: pages.length, capacityPt: capacityPt };
  }

  function totalHeightPt(blocks, density, options) {
    return blocks.reduce(function (sum, block) {
      return sum + blockHeightPt(block, density, options);
    }, 0);
  }

  /**
   * Composes the paper at progressively tighter densities and returns the first
   * result that fits `options.maxPages`.
   */
  function fit(paper, options) {
    var densities = PF.compose.DENSITIES;
    var maxPages = options.maxPages || 2;

    if (options.densityId && options.densityId !== 'auto') {
      var forced = densities.filter(function (d) { return d.id === options.densityId; })[0] || densities[1];
      return build(paper, forced, options, maxPages, false);
    }

    for (var i = 0; i < densities.length; i++) {
      var result = build(paper, densities[i], options, maxPages, true);
      if (result.pageCount <= maxPages) return result;
    }
    return build(paper, densities[densities.length - 1], options, maxPages, true);
  }

  function build(paper, density, options, maxPages, auto) {
    var blocks = PF.compose.compose(paper, density, options);
    var flow = paginate(blocks, density, options);
    return {
      density: density,
      blocks: blocks,
      pages: flow.pages,
      pageCount: flow.pageCount,
      capacityPt: flow.capacityPt,
      heightPt: totalHeightPt(blocks, density, options),
      overflow: flow.pageCount > maxPages,
      auto: !!auto
    };
  }

  PF.layout = {
    fit: fit,
    paginate: paginate,
    blockHeightPt: blockHeightPt,
    lineHeightPt: lineHeightPt,
    blockText: blockText
  };
})(window.PF = window.PF || {});
