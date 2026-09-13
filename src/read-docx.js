/*
 * read-docx.js - reads a .docx file back into plain lines.
 *
 * The document XML is read directly instead of going through a converter,
 * because two things a converter throws away carry meaning here:
 *
 *   tabs and table cells - the signals that mark the two columns of a
 *                          "match the following" question;
 *   automatic numbering  - a Word numbered list stores "1." "2." "3." in
 *                          numbering.xml, not in the text. Read the text alone
 *                          and every item number silently disappears.
 *
 * An automatically numbered paragraph is marked with AUTO_LABEL plus a letter
 * for the number format. The parser turns that into a real label once it knows
 * where each question starts, which is the only place the counting can be done
 * correctly.
 */
(function (PF) {
  'use strict';

  var AUTO_LABEL = '';

  // Word's numFmt values -> the single letter carried in the marker.
  var FORMAT_CODES = {
    decimal: 'd',
    decimalZero: 'd',
    lowerLetter: 'a',
    upperLetter: 'A',
    lowerRoman: 'r',
    upperRoman: 'R',
    bullet: 'b'
  };

  function childrenByTag(node, tagName) {
    var out = [];
    for (var i = 0; i < node.childNodes.length; i++) {
      var child = node.childNodes[i];
      if (child.nodeType === 1 && child.nodeName === tagName) out.push(child);
    }
    return out;
  }

  function firstChild(node, tagName) {
    return node ? childrenByTag(node, tagName)[0] : null;
  }

  function attr(node, name) {
    return node && node.getAttribute ? node.getAttribute(name) : null;
  }

  /* ------------------------------------------------------------- numbering */

  /** Builds a lookup: (numId, level) -> format code, from numbering.xml. */
  function parseNumbering(xml) {
    var levels = {};   // abstractNumId -> { level -> code }
    var numToAbstract = {};

    if (xml) {
      var doc = new DOMParser().parseFromString(xml, 'application/xml');

      var abstracts = doc.getElementsByTagName('w:abstractNum');
      for (var a = 0; a < abstracts.length; a++) {
        var abstractId = attr(abstracts[a], 'w:abstractNumId');
        var byLevel = {};
        var lvls = childrenByTag(abstracts[a], 'w:lvl');
        for (var l = 0; l < lvls.length; l++) {
          var format = attr(firstChild(lvls[l], 'w:numFmt'), 'w:val');
          byLevel[attr(lvls[l], 'w:ilvl') || '0'] = FORMAT_CODES[format] || 'd';
        }
        levels[abstractId] = byLevel;
      }

      var nums = doc.getElementsByTagName('w:num');
      for (var n = 0; n < nums.length; n++) {
        numToAbstract[attr(nums[n], 'w:numId')] = attr(firstChild(nums[n], 'w:abstractNumId'), 'w:val');
      }
    }

    return function (numId, level) {
      var abstractId = numToAbstract[numId];
      var byLevel = levels[abstractId];
      if (!byLevel) return 'd'; // numbered, format unknown - decimal is the safe guess
      return byLevel[level] || byLevel['0'] || 'd';
    };
  }

  /** The marker for a paragraph that Word numbers automatically, or ''. */
  function autoLabelMarker(paragraph, formatFor) {
    var numPr = firstChild(firstChild(paragraph, 'w:pPr'), 'w:numPr');
    if (!numPr) return '';

    var numId = attr(firstChild(numPr, 'w:numId'), 'w:val');
    if (!numId || numId === '0') return ''; // numbering explicitly switched off

    var level = attr(firstChild(numPr, 'w:ilvl'), 'w:val') || '0';
    var code = formatFor(numId, level);
    if (code === 'b') return ''; // a bullet is decoration, not a label
    return AUTO_LABEL + code;
  }

  /* ------------------------------------------------------------------ text */

  /** Text of one <w:p>, with tabs and line breaks preserved. */
  function paragraphText(paragraph) {
    var text = '';
    var nodes = paragraph.getElementsByTagName('*');
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.nodeName === 'w:t') {
        text += node.textContent;
      } else if (node.nodeName === 'w:tab') {
        // <w:tab> also declares tab *stops* inside <w:pPr><w:tabs>; only the
        // ones sitting directly in a run are actual tab characters.
        if (node.parentNode && node.parentNode.nodeName === 'w:r') text += '\t';
      } else if (node.nodeName === 'w:br' || node.nodeName === 'w:cr') {
        text += '\n';
      }
    }
    return text;
  }

  function paragraphLines(paragraph, formatFor) {
    var lines = paragraphText(paragraph).split('\n');
    var marker = autoLabelMarker(paragraph, formatFor);
    if (marker && lines[0].trim()) lines[0] = marker + lines[0];
    return lines;
  }

  function tableLines(table, formatFor) {
    return childrenByTag(table, 'w:tr').map(function (row) {
      return childrenByTag(row, 'w:tc').map(function (cell) {
        // A cell holds blocks of its own, including tables nested inside it.
        return walk(cell, formatFor).join(' ').trim();
      }).join('\t');
    });
  }

  /**
   * Collects the lines of every block inside `container`, in document order.
   *
   * Word wraps content in more than paragraphs and tables: a content control
   * (w:sdt) can hold whole questions, and a cell can hold another table.
   * Looking only for w:p and w:tbl at one level silently loses all of it.
   */
  function walk(container, formatFor) {
    var lines = [];
    for (var i = 0; i < container.childNodes.length; i++) {
      var node = container.childNodes[i];
      if (node.nodeType !== 1) continue;

      if (node.nodeName === 'w:p') {
        lines = lines.concat(paragraphLines(node, formatFor));
      } else if (node.nodeName === 'w:tbl') {
        lines = lines.concat(tableLines(node, formatFor));
      } else if (node.nodeName === 'w:sdt') {
        var content = firstChild(node, 'w:sdtContent');
        if (content) lines = lines.concat(walk(content, formatFor));
      }
    }
    return lines;
  }

  function bodyToLines(body, formatFor) {
    return walk(body, formatFor || function () { return 'd'; });
  }

  /* ----------------------------------------------------------------- entry */

  function readEntry(zip, name) {
    var entry = zip.file(name);
    return entry ? entry.async('string') : Promise.resolve('');
  }

  /** Resolves to the document's text. Rejects with a readable message on failure. */
  function read(arrayBuffer) {
    if (!window.JSZip) return Promise.reject(new Error('The zip reader failed to load.'));

    return window.JSZip.loadAsync(arrayBuffer).then(function (zip) {
      if (!zip.file('word/document.xml')) {
        throw new Error('That file does not look like a Word document.');
      }
      return Promise.all([
        readEntry(zip, 'word/document.xml'),
        readEntry(zip, 'word/numbering.xml')
      ]);
    }).then(function (parts) {
      var doc = new DOMParser().parseFromString(parts[0], 'application/xml');
      if (doc.getElementsByTagName('parsererror').length) {
        throw new Error('The Word document could not be read.');
      }
      var body = doc.getElementsByTagName('w:body')[0];
      if (!body) throw new Error('The Word document has no readable body.');
      return bodyToLines(body, parseNumbering(parts[1])).join('\n');
    });
  }

  PF.readDocx = {
    AUTO_LABEL: AUTO_LABEL,
    read: read,
    bodyToLines: bodyToLines,
    parseNumbering: parseNumbering
  };
})(window.PF = window.PF || {});
