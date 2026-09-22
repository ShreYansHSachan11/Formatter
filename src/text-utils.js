/*
 * text-utils.js - script detection and width estimation.
 *
 * Width estimation lets the layout engine decide how many lines a paragraph
 * will occupy in Word without actually rendering it, which is what makes the
 * "always fit in 2 pages" rule possible.
 */
(function (PF) {
  'use strict';

  var DEVANAGARI = /[ऀ-ॿ]/;
  /*
   * Devanagari marks come in two kinds, and treating them alike is what made a
   * Hindi paper measure a third narrower than it prints. A mark that sits above
   * or below its consonant adds no width at all; a mark that sits beside it is
   * as wide as a letter. "की" is two glyphs wide, "कु" is one.
   */
  var DEV_STACKED = /[ऀ-ःऺु-ै्॑-ॗॢॣ]/;
  var DEV_BESIDE = { 'ा': 0.34, 'ि': 0.30, 'ी': 0.34, 'ॉ': 0.34,
    'ॊ': 0.34, 'ो': 0.34, 'ौ': 0.40 };

  function hasDevanagari(text) {
    return DEVANAGARI.test(text || '');
  }

  /** Dominant script of a string: 'hi' when Devanagari is present, else 'en'. */
  function scriptOf(text) {
    return hasDevanagari(text) ? 'hi' : 'en';
  }

  /** Approximate advance width of a character, in em units. */
  function charEm(ch) {
    var c = ch.codePointAt(0);
    if (c === 32 || c === 160) return 0.28;
    if (c === 9) return 0; // tabs are positioned, not measured
    if (c >= 0x0900 && c <= 0x097F) {
      if (DEV_STACKED.test(ch)) return 0.03;
      if (DEV_BESIDE[ch] !== undefined) return DEV_BESIDE[ch];
      return 0.66; // a Devanagari letter is wider than a Latin one
    }
    if (c >= 0x41 && c <= 0x5a) return 0.67; // A-Z
    if (c >= 0x61 && c <= 0x7a) return 0.52; // a-z
    if (c >= 0x30 && c <= 0x39) return 0.56; // 0-9
    if ('.,;:\'`!|iltjrf()[]'.indexOf(ch) >= 0) return 0.3;
    if ('_-–—'.indexOf(ch) >= 0) return 0.55;
    return 0.52;
  }

  /** Estimated width of `text` in inches when set at `fontPt`. */
  function widthIn(text, fontPt) {
    var total = 0;
    for (var i = 0; i < (text || '').length; i++) total += charEm(text[i]);
    return (total * fontPt) / 72;
  }

  /** Number of wrapped lines `text` needs inside `availableIn` inches. */
  function lineCount(text, fontPt, availableIn) {
    if (!text) return 1;
    if (availableIn <= 0) return 1;
    return Math.max(1, Math.ceil(widthIn(text, fontPt) / availableIn - 0.02));
  }

  /**
   * Letters as a reader counts them. A stacked Devanagari mark is part of the
   * letter it sits on, so "जनसंख्या" is six letters and not ten - which is the
   * difference between a short item and one too long to sit beside others.
   */
  function letterCount(text) {
    var count = 0;
    for (var i = 0; i < (text || '').length; i++) {
      var ch = text[i];
      if (DEV_STACKED.test(ch)) continue;
      if (/[A-Za-zऀ-ॿ]/.test(ch)) count++;
    }
    return count;
  }

  function collapseSpaces(text) {
    return (text || '').replace(/[ \t ]+/g, ' ').trim();
  }

  PF.text = {
    hasDevanagari: hasDevanagari,
    scriptOf: scriptOf,
    widthIn: widthIn,
    lineCount: lineCount,
    letterCount: letterCount,
    collapseSpaces: collapseSpaces
  };
})(window.PF = window.PF || {});
