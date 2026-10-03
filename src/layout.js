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

  var SAFETY = 0.97; // usable fraction of the text column height

  // One line's height lives in compose.js, because a gap stated in lines has to
  // be measured with the same ruler the page height is estimated with.
  function lineHeightPt(text, density, fontPt) {
    return PF.compose.lineHeightPt(text, density, fontPt);
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
      var cols = block.cols || (block.colWidthsIn ? block.colWidthsIn.length : 1);
      var rows = 0;
      // One row per group of `cols` cells, plus any row that wraps because a
      // cell is wider than the column it sits in.
      for (var start = 0; start < block.cells.length; start += cols) {
        var lines = 1;
        for (var i = start; i < Math.min(start + cols, block.cells.length); i++) {
          if (!block.colWidthsIn) continue;
          lines = Math.max(lines, PF.text.lineCount(block.cells[i], fontPt, block.colWidthsIn[i - start] - 0.1));
        }
        rows += lines;
      }
      return Math.max(rows, 1) * height + (block.spaceBeforePt || 0);
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
      var forced = densities.filter(function (d) { return d.id === options.densityId; })[0]
        || byId(densities, 'normal') || densities[0];
      return build(paper, forced, options, maxPages, false);
    }

    // Automatic never reaches for a setting that only makes sense as a choice:
    // a two-line gap is something you ask for, not something a short paper
    // should fall into because it happens to have room.
    var ladder = densities.filter(function (d) { return !d.manualOnly; });
    if (!ladder.length) ladder = densities;

    for (var i = 0; i < ladder.length; i++) {
      var result = build(paper, ladder[i], options, maxPages, true);
      if (result.pageCount <= maxPages) return result;
    }
    return build(paper, ladder[ladder.length - 1], options, maxPages, true);
  }

  function byId(densities, id) {
    return densities.filter(function (d) { return d.id === id; })[0];
  }

  /* ------------------------------------------------- two copies on one sheet
   *
   * A paper for the smallest classes is a page and a half of writing room and
   * half a page of questions, and it is printed two to a sheet and cut in
   * half. Doing that here means two things.
   *
   * The room to write goes. A line with nothing on it but blanks is not a
   * question - the question above it already says what to write - and it is
   * the first thing to give up when two papers have to share one sheet.
   *
   * And the cut is put halfway down the sheet rather than wherever the first
   * copy happens to end, so both halves are the same size and a straight cut
   * through the middle gives two identical papers.
   */
  var WRITING_ROOM_RE = /^[\s_.…—–-]*$/;
  var CUT_BREATH_PT = 10;

  function isWritingRoom(block) {
    if (block.type === 'rule' || block.type === 'header' || block.type === 'header-row') return false;
    var text = blockText(block).replace(/[\u0001\u0002\u0003]/g, ' ');
    return text.trim() !== '' && WRITING_ROOM_RE.test(text);
  }

  /** The same line again, with nothing that ties it to the one it came from. */
  function copyOf(block) {
    var copy = {};
    Object.keys(block).forEach(function (name) { copy[name] = block[name]; });
    // A copy is not edited: it is the first one over again, and giving it the
    // same keys would put two lines in the preview answering to one edit.
    delete copy.key;
    delete copy.cellKeys;
    delete copy.marksKey;
    return copy;
  }

  function twoUp(blocks, density, options) {
    var first = blocks.filter(function (block) { return !isWritingRoom(block); });
    if (!first.length) return blocks;

    var usablePt = (PF.compose.PAGE.heightIn - density.marginTopIn - density.marginBottomIn)
      * 72 * SAFETY;
    var rulePt = options.fontSizePt * 0.45 * density.line;
    var gap = Math.max(CUT_BREATH_PT,
      usablePt / 2 - totalHeightPt(first, density, options) - rulePt - CUT_BREATH_PT);

    var cut = {
      type: 'rule', dashed: true, runs: [{ text: '', bold: false }],
      indentIn: 0, spaceBeforePt: gap, border: true
    };

    var second = first.map(copyOf);
    second[0].spaceBeforePt = CUT_BREATH_PT;

    return first.concat([cut], second);
  }

  function build(paper, density, options, maxPages, auto) {
    var blocks = PF.compose.compose(paper, density, options);
    if (options.twoUp) blocks = twoUp(blocks, density, options);
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
