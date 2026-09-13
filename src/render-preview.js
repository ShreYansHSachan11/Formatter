/*
 * render-preview.js - layout blocks -> on-screen A4 pages.
 *
 * The preview is built from the same blocks and the same measurements as the
 * .docx, so what it shows about page count and column layout matches the file
 * the user downloads.
 */
(function (PF) {
  'use strict';

  var PX_PER_IN = 96;

  function el(tag, className) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }

  function runsToText(runs) {
    return (runs || []).map(function (run) { return run.text; }).join('');
  }

  function isBold(runs) {
    return (runs || []).some(function (run) { return run.bold; });
  }

  function fontStack(text, options) {
    return PF.text.hasDevanagari(text)
      ? '"' + options.hindiFont + '", "Nirmala UI", sans-serif'
      : '"' + options.latinFont + '", Arial, sans-serif';
  }

  function styleBlock(node, block, density, options) {
    node.style.marginTop = (block.spaceBeforePt || 0) / 72 + 'in';
    node.style.lineHeight = String(1.2 * density.line);
    node.style.fontSize = options.fontSizePt + 'pt';
  }

  function renderBlock(block, density, options) {
    var content = PF.compose.contentWidthIn(density);

    if (block.type === 'rule') {
      var rule = el('div', 'pv-rule');
      styleBlock(rule, block, density, options);
      return rule;
    }

    if (block.type === 'header-row') {
      var row = el('div', 'pv-header-row');
      styleBlock(row, block, density, options);
      block.cells.forEach(function (cell, index) {
        var cellNode = el('span');
        cellNode.textContent = cell;
        cellNode.style.fontWeight = block.bold ? '700' : '400';
        cellNode.style.fontFamily = fontStack(cell, options);
        cellNode.style.textAlign = index === 0 ? 'left' : (index === block.cells.length - 1 ? 'right' : 'center');
        row.appendChild(cellNode);
      });
      return row;
    }

    if (block.cells) {
      var grid = el('div', 'pv-grid');
      styleBlock(grid, block, density, options);
      grid.style.marginLeft = (block.indentIn || 0) + 'in';
      grid.style.gridTemplateColumns = block.colWidthsIn
        ? block.colWidthsIn.map(function (w) { return w + 'in'; }).join(' ')
        : 'repeat(' + (block.cols || 1) + ', 1fr)';
      block.cells.forEach(function (cell) {
        var cellNode = el('span');
        cellNode.textContent = cell;
        cellNode.style.fontWeight = block.bold ? '700' : '400';
        cellNode.style.fontFamily = fontStack(cell, options);
        grid.appendChild(cellNode);
      });
      return grid;
    }

    var text = runsToText(block.runs);
    var line = el('div', 'pv-line' + (block.align === 'center' ? ' pv-center' : ''));
    styleBlock(line, block, density, options);
    line.style.paddingLeft = (block.indentIn || 0) + 'in';
    line.style.textIndent = -(block.hangingIn || 0) + 'in';
    line.style.fontFamily = fontStack(text, options);
    line.style.fontWeight = isBold(block.runs) ? '700' : '400';

    var main = el('span');
    main.textContent = text;
    line.appendChild(main);

    if (block.rightRuns) {
      line.classList.add('pv-split');
      var right = el('span', 'pv-right');
      right.textContent = runsToText(block.rightRuns);
      line.appendChild(right);
    }
    return line;
  }

  function render(container, result, options) {
    container.innerHTML = '';
    var density = result.density;

    result.pages.forEach(function (blocks, pageIndex) {
      var page = el('div', 'pv-page');
      page.style.width = PF.compose.PAGE.widthIn * PX_PER_IN + 'px';
      page.style.height = PF.compose.PAGE.heightIn * PX_PER_IN + 'px';
      page.style.paddingTop = density.marginTopIn + 'in';
      page.style.paddingBottom = density.marginBottomIn + 'in';
      page.style.paddingLeft = density.marginXIn + 'in';
      page.style.paddingRight = density.marginXIn + 'in';

      blocks.forEach(function (block, index) {
        var node = renderBlock(block, density, options);
        if (index === 0) node.style.marginTop = '0';
        page.appendChild(node);
      });

      var badge = el('div', 'pv-badge');
      badge.textContent = 'Page ' + (pageIndex + 1);
      page.appendChild(badge);
      container.appendChild(page);
    });
  }

  PF.renderPreview = { render: render, PX_PER_IN: PX_PER_IN };
})(window.PF = window.PF || {});
