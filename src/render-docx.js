/*
 * render-docx.js - layout blocks -> a .docx file.
 *
 * Columns are produced with tab stops rather than tables: tab stops keep every
 * row inside the normal paragraph flow (so line spacing stays uniform and the
 * two-page estimate stays honest) and they survive copy/paste into Word.
 */
(function (PF) {
  'use strict';

  var TWIP = 1440; // twips per inch

  function d() {
    if (!window.docx) throw new Error('The docx library failed to load.');
    return window.docx;
  }

  function twips(inches) {
    return Math.round(inches * TWIP);
  }

  function fontFor(text, options) {
    return PF.text.hasDevanagari(text) ? options.hindiFont : options.latinFont;
  }

  /**
   * Splits mixed Hindi/English text so each run carries the right font.
   * Word picks fonts per run, so a single run would force one script to use a
   * fallback face and break the visual rhythm of the paper.
   */
  function splitByScript(text) {
    var segments = [];
    var current = '';
    var currentIsHindi = null;

    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      var isHindi = PF.text.hasDevanagari(ch);
      var neutral = !/[A-Za-zऀ-ॿ]/.test(ch);
      if (currentIsHindi === null || neutral || isHindi === currentIsHindi) {
        current += ch;
        if (currentIsHindi === null && !neutral) currentIsHindi = isHindi;
      } else {
        segments.push({ text: current, hindi: currentIsHindi });
        current = ch;
        currentIsHindi = isHindi;
      }
    }
    if (current) segments.push({ text: current, hindi: !!currentIsHindi });
    return segments;
  }

  function makeRuns(text, bold, options, extra) {
    var docx = d();
    return splitByScript(text).map(function (segment, index) {
      return new docx.TextRun(Object.assign({
        text: segment.text,
        bold: !!bold,
        font: segment.hindi ? options.hindiFont : options.latinFont,
        size: options.fontSizePt * 2,
        sizeComplexScript: options.fontSizePt * 2,
        boldComplexScript: !!bold
      }, index === 0 ? extra || {} : {}));
    });
  }

  function tabRun(options) {
    var docx = d();
    return new docx.TextRun({
      children: [new docx.Tab()],
      size: options.fontSizePt * 2
    });
  }

  function spacing(block, density, options) {
    return {
      before: Math.round((block.spaceBeforePt || 0) * 20),
      after: 0,
      line: Math.round(240 * density.line),
      lineRule: d().LineRuleType.AUTO
    };
  }

  function baseParagraph(block, density, options, extras) {
    var docx = d();
    return Object.assign({
      spacing: spacing(block, density, options),
      indent: {
        left: twips(block.indentIn || 0),
        hanging: twips(block.hangingIn || 0)
      }
    }, extras || {});
  }

  function rightTabStop(density) {
    return {
      type: d().TabStopType.RIGHT,
      position: twips(PF.compose.contentWidthIn(density))
    };
  }

  function renderTextBlock(block, density, options) {
    var docx = d();
    var children = [];
    block.runs.forEach(function (run) {
      children = children.concat(makeRuns(run.text, run.bold, options));
    });

    var tabStops = [];
    if (block.rightRuns) {
      tabStops.push(rightTabStop(density));
      children.push(tabRun(options));
      block.rightRuns.forEach(function (run) {
        children = children.concat(makeRuns(run.text, run.bold, options));
      });
    }

    return new docx.Paragraph(baseParagraph(block, density, options, {
      children: children,
      tabStops: tabStops,
      alignment: block.align === 'center' ? docx.AlignmentType.CENTER : docx.AlignmentType.LEFT,
      keepNext: block.type === 'question'
    }));
  }

  /** Header line with Time (left) / Class (centre) / M.M. (right). */
  function renderHeaderRow(block, density, options) {
    var docx = d();
    var content = PF.compose.contentWidthIn(density);
    var children = [];

    block.cells.forEach(function (cell, index) {
      if (index > 0) children.push(tabRun(options));
      children = children.concat(makeRuns(cell, block.bold, options));
    });

    return new docx.Paragraph(baseParagraph(block, density, options, {
      children: children,
      tabStops: [
        { type: docx.TabStopType.CENTER, position: twips(content / 2) },
        { type: docx.TabStopType.RIGHT, position: twips(content) }
      ]
    }));
  }

  /** Equal-width (or explicitly sized) columns built from left tab stops. */
  function renderColumnBlock(block, density, options) {
    var docx = d();
    var content = PF.compose.contentWidthIn(density);
    var indent = block.indentIn || 0;
    var cols = block.cols || 1;

    var positions = [];
    if (block.colWidthsIn) {
      var offset = indent;
      for (var i = 0; i < block.colWidthsIn.length - 1; i++) {
        offset += block.colWidthsIn[i];
        positions.push(offset);
      }
    } else {
      var colWidth = (content - indent) / cols;
      for (var c = 1; c < cols; c++) positions.push(indent + c * colWidth);
    }

    var children = [];
    block.cells.forEach(function (cell, index) {
      var column = index % cols;
      if (index > 0 && column === 0) {
        children = children.concat(makeRuns(cell, block.bold, options, { break: 1 }));
        return;
      }
      if (index > 0) children.push(tabRun(options));
      children = children.concat(makeRuns(cell, block.bold, options));
    });

    return new docx.Paragraph(baseParagraph(block, density, options, {
      children: children,
      tabStops: positions.map(function (position) {
        return { type: docx.TabStopType.LEFT, position: twips(position) };
      })
    }));
  }

  function renderRule(block, density, options) {
    var docx = d();
    return new docx.Paragraph(baseParagraph(block, density, options, {
      children: [new docx.TextRun({ text: '', size: options.fontSizePt * 2 })],
      border: {
        bottom: { style: docx.BorderStyle.SINGLE, size: 6, space: 1, color: '000000' }
      }
    }));
  }

  function renderBlock(block, density, options) {
    if (block.type === 'rule') return renderRule(block, density, options);
    if (block.type === 'header-row') return renderHeaderRow(block, density, options);
    if (block.cells) return renderColumnBlock(block, density, options);
    return renderTextBlock(block, density, options);
  }

  function buildDocument(result, options) {
    var docx = d();
    var density = result.density;

    return new docx.Document({
      styles: {
        default: {
          document: {
            run: {
              font: options.latinFont,
              size: options.fontSizePt * 2,
              sizeComplexScript: options.fontSizePt * 2
            },
            paragraph: {
              spacing: { before: 0, after: 0, line: Math.round(240 * density.line), lineRule: docx.LineRuleType.AUTO }
            }
          }
        }
      },
      sections: [{
        properties: {
          page: {
            size: { width: twips(PF.compose.PAGE.widthIn), height: twips(PF.compose.PAGE.heightIn) },
            margin: {
              top: twips(density.marginTopIn),
              bottom: twips(density.marginBottomIn),
              left: twips(density.marginXIn),
              right: twips(density.marginXIn)
            }
          }
        },
        children: result.blocks.map(function (block) {
          return renderBlock(block, density, options);
        })
      }]
    });
  }

  function toBlob(result, options) {
    return d().Packer.toBlob(buildDocument(result, options));
  }

  PF.renderDocx = {
    buildDocument: buildDocument,
    toBlob: toBlob,
    splitByScript: splitByScript
  };
})(window.PF = window.PF || {});
