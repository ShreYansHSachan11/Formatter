/*
 * parser.js - turns cleaned lines into a Paper model.
 *
 * Paper = {
 *   header: { school, exam, subject, className, time, maxMarks },
 *   questions: [{
 *     number, heading, marks, kind, items | subs | pairs, columnHeaders
 *   }]
 * }
 *
 * kind is one of:
 *   'mcq'    - sub-questions, each with tickable options   -> options laid out in a row
 *   'match'  - two columns to be matched                   -> left/right columns
 *   'inline' - short one-word items                        -> several per row
 *   'list'   - one item per line (sentences, blanks, Q&A)
 *   'plain'  - the heading is the whole question
 */
(function (PF) {
  'use strict';


  var QUESTION_RE = new RegExp(
    '^\\s*(?:' +
    '(?:Q|Que|Ques|Quest|Question|QUE)\\s*[-\\u2013\\u2014._:]*\\s*(\\d{1,2})' +
    '|(?:\\u092A\\u094D\\u0930\\u0936\\u094D\\u0928)\\s*[-\\u2013\\u2014._:]*\\s*(\\d{1,2})' +
    ')\\s*[-\\u2013\\u2014.:\\)]*\\s*(.*)$', 'i');

  var MARKS_RE = /[\(\[]\s*(\d{1,2})\s*[\)\]]\s*[\.\?:]*\s*$/;
  var EMPTY_BOX_RE = /\(\s*\)/g;
  var TF_BOX_RE = /\[\s*\]\s*$/;
  var LABEL_RE = /^\(?\s*([0-9]{1,2}|[A-Za-z]|[अ-ह])\s*[\)\.–—-]+\s*/;
  var MATCH_KEYWORDS = /(match the following|match the|मिलान)/i;
  var COLUMN_HEADER_RE = /(column|कॉलम|कॉलम)/i;

  /* ---------------------------------------------------------------- header */

  function parseHeader(lines) {
    var joined = lines.map(PF.normalize.clean).join(' | ');
    var header = {
      school: '',
      exam: '',
      subject: '',
      className: '',
      time: '',
      maxMarks: ''
    };

    var subject = joined.match(/sub(?:ject)?\s*[-:.–]*\s*([^|]+?)(?=\s*(?:\||time|class|m\.?m|$))/i);
    if (subject) header.subject = tidyValue(subject[1]);

    var cls = joined.match(/class\s*[-:.–]*\s*([^|]*?)(?=\s*(?:\||time|m\.?m|sub|$))/i);
    if (cls) header.className = tidyValue(cls[1]);

    // The unit after the clock time has to be an actual unit. Matching any
    // letters here once produced "Time: 2:30 Class" from "Time- 2:30 Class:- 1st".
    var time = joined.match(/time\s*[-:.–]*\s*([0-9]{1,2}[:.][0-9]{2}(?:\s*(?:hrs?|hours?|h|am|pm))?|[0-9]+\s*(?:hrs?|hours?))/i);
    if (time) header.time = tidyValue(time[1]);

    var marks = joined.match(/m\.?\s*m\.?\s*[-:.–]*\s*(\d{1,3})/i);
    if (marks) header.maxMarks = marks[1];

    lines.forEach(function (line) {
      var text = PF.normalize.clean(line);
      if (!header.exam && /(examination|exam\b|परीक्षा)/i.test(text)) {
        header.exam = PF.text.collapseSpaces(text);
      } else if (!header.school && /(academy|school|vidyalaya|college|विद्यालय)/i.test(text)) {
        header.school = dotInitials(PF.normalize.clean(text));
      }
    });

    if (!header.school && lines.length) header.school = dotInitials(PF.normalize.clean(lines[0]));
    return header;
  }

  /*
   * "SS ACADEMY" -> "S.S. ACADEMY". A school's opening initials are an
   * abbreviation and read better with stops. Only a token of two or three
   * capitals standing on its own qualifies, so "SUNRISE ACADEMY" is left alone,
   * and titles that are abbreviated differently keep their usual spelling.
   */
  var NOT_INITIALS = ['ST', 'MT', 'DR', 'MR', 'MS', 'JR', 'SR', 'THE'];

  function dotInitials(name) {
    return String(name || '').replace(/^([A-Z]{2,3})(?=\s+[A-Za-z])/, function (initials) {
      if (NOT_INITIALS.indexOf(initials) >= 0) return initials;
      return initials.split('').join('.') + '.';
    });
  }

  function tidyValue(value) {
    return PF.normalize.clean(value)
      .replace(/^[-:.–\s]+/, '')
      .replace(/[-:.–\s]+$/, '');
  }

  /* -------------------------------------------------------------- question */

  /** Splits a body line that carries several short items ("1. Pen 2. Boat 3. Boy"). */
  function splitInlineItems(text) {
    var re = /(?:^|\s)\(?\s*([0-9]{1,2}|[A-Za-z]|[अ-ह])\s*[\)\.]\s+/g;
    var marks = [];
    var match;
    while ((match = re.exec(text)) !== null) {
      marks.push({ index: match.index + (match[0][0] === ' ' ? 1 : 0), label: match[1], length: match[0].trimStart().length });
      re.lastIndex = match.index + match[0].length - 1;
    }
    if (marks.length < 3) return null;

    return marks.map(function (mark, i) {
      var start = mark.index + mark.length;
      var end = i + 1 < marks.length ? marks[i + 1].index : text.length;
      return { label: mark.label, text: text.slice(start, end).trim() };
    }).filter(function (item) { return item.text !== ''; });
  }

  /** Parses "A. Bug ( ) B. Bird ( ) C. Tortoise ( )" into labelled options. */
  function parseOptions(line) {
    var boxes = line.match(EMPTY_BOX_RE);
    if (!boxes || boxes.length < 2) return null;

    var chunks = line.split(/\(\s*\)/);
    var options = [];
    for (var i = 0; i < chunks.length; i++) {
      var chunk = chunks[i].replace(PF.normalize.SEP_RE, ' ').trim();
      if (!chunk) continue;
      var stripped = stripLabel(chunk) || stripBareLabel(chunk);
      if (stripped && stripped.rest) {
        options.push({ label: stripped.label, text: stripped.rest });
      } else if (i < chunks.length - 1) {
        options.push({ label: '', text: chunk });
      }
    }
    return options.length >= 2 ? options : null;
  }

  function stripLabel(text) {
    var m = text.match(LABEL_RE);
    if (m) return { label: m[1], rest: text.slice(m[0].length).trim() };

    // "1__________ who asked the question" - the number runs straight into the
    // blank, with no dot between them.
    var blank = text.match(/^(\d{1,2})(?=_{3,})/);
    if (blank) return { label: blank[1], rest: text.slice(blank[0].length).trim() };

    return null;
  }

  /** "B bird" - an option label typed without its dot or bracket. */
  function stripBareLabel(text) {
    var m = text.match(/^([A-Da-d]|[अ-स])\s+(\S.*)$/);
    if (!m) return null;
    return { label: m[1], rest: m[2].trim() };
  }

  /** First pass: each body line becomes a raw node. */
  function toRawNodes(bodyLines) {
    var nodes = [];
    bodyLines.forEach(function (rawLine) {
      // A line Word numbered automatically carries a marker instead of a
      // visible number; the number itself is assigned later, per question.
      var line = rawLine;
      var autoFmt = '';
      var marker = line.match(PF.normalize.AUTO_LABEL_RE);
      if (marker) {
        autoFmt = marker[1];
        line = line.slice(marker[0].length);
      }

      var options = parseOptions(line);
      if (options) {
        nodes.push({ kind: 'options', options: options, autoFmt: autoFmt });
        return;
      }

      // A true/false box is stripped before anything else: left in place it
      // looks like a second column and turns the question into a match.
      var box = TF_BOX_RE.test(line);
      if (box) line = line.replace(TF_BOX_RE, '').replace(PF.normalize.SEP_RE, ' ').trim();

      var plain = line;
      var inlineItems = splitInlineItems(plain.replace(PF.normalize.SEP_RE, ' '));
      if (inlineItems) {
        inlineItems.forEach(function (item) {
          nodes.push({ kind: 'item', label: item.label, text: item.text, box: box, autoFmt: autoFmt });
        });
        return;
      }

      var stripped = stripLabel(plain);
      if (stripped) {
        nodes.push({ kind: 'item', label: stripped.label, text: stripped.rest, box: box, autoFmt: autoFmt });
      } else {
        nodes.push({ kind: 'item', label: '', text: plain.trim(), box: box, autoFmt: autoFmt });
      }
    });
    return nodes;
  }

  /* ------------------------------------------------------- column splitting
   *
   * Splitting a line in two is the most destructive thing this parser can do:
   * get it wrong and a plain sentence turns into a match-the-following row
   * ("Uncle | John lived in a city"). So a split has to earn itself.
   *
   * A tab is decent evidence. A run of spaces is not - people pad text with
   * spaces all the time - so a space-separated split is only allowed when the
   * heading says "match the following", or when every item in the question
   * splits into two halves that genuinely read like a matching pair.
   */

  var BLANK_OR_BOX_RE = /(_{3,}|\(\s*\)|\[\s*\])/;
  var SENTENCE_END_RE = /[?.!।]\s*$/;
  var MAX_PAIR_CHARS = 40;
  var MAX_PAIR_WORDS = 5;

  function splitParts(text, allowSpaceSep) {
    var separator = allowSpaceSep ? /[]/ : //;
    var parts = String(text || '').split(separator).map(function (part) {
      return PF.normalize.clean(part);
    }).filter(Boolean);
    if (parts.length < 2) return null;
    return { left: parts[0], right: parts.slice(1).join(' ') };
  }

  /** Both halves read like the two sides of a matching pair, not like prose. */
  function looksLikePair(parts) {
    return [parts.left, parts.right].every(function (side) {
      return side.length <= MAX_PAIR_CHARS
        && side.split(/\s+/).length <= MAX_PAIR_WORDS
        && !BLANK_OR_BOX_RE.test(side);
    });
  }

  /**
   * The split for one item, or null to leave the line whole.
   * `strict` applies the pair test; it is relaxed only when the question
   * heading has already declared itself a matching question.
   */
  function columnSplit(text, strict) {
    // A blank to fill or a box to tick means this is an answer line, whatever
    // the spacing looks like.
    if (BLANK_OR_BOX_RE.test(text)) return null;
    if (strict && SENTENCE_END_RE.test(text)) return null;

    var parts = splitParts(text, !strict || looksSpaced(text));
    if (!parts) return null;
    if (strict && !looksLikePair(parts)) return null;
    return parts;
  }

  /** True when the line uses space runs rather than tabs to separate columns. */
  function looksSpaced(text) {
    return text.indexOf(PF.normalize.TAB_SEP) === -1;
  }

  var LABEL_SEQUENCES = [
    '1234567890'.split(''),
    'abcdefghij'.split(''),
    'कखगघङ'.split('')
  ];

  function isSequenceStart(label) {
    var lower = String(label || '').toLowerCase();
    return lower === '1' || lower === 'a' || lower === 'क';
  }

  /**
   * Falls back to pairing when the two columns were typed as two stacked blocks
   * rather than side by side (labels restart halfway through).
   */
  function pairStackedItems(items) {
    if (items.length < 4 || items.length % 2 !== 0) return null;
    var half = items.length / 2;
    if (!isSequenceStart(items[half].label) || isSequenceStart(items[1].label)) return null;
    var pairs = [];
    for (var i = 0; i < half; i++) {
      pairs.push({ label: items[i].label, left: items[i].text, right: items[half + i].text });
    }
    return pairs;
  }

  function classify(heading, nodes) {
    if (nodes.some(function (n) { return n.kind === 'options'; })) return 'mcq';
    if (!nodes.length) return 'plain';
    if (MATCH_KEYWORDS.test(heading)) return 'match';
    if (nodes.length < 2) return 'list';

    // Without a "match the following" heading, every single item must read as a
    // matching pair. One sentence among them means the whole question is prose
    // that merely happens to be loosely spaced.
    var paired = nodes.filter(function (node) {
      return columnSplit(node.text, true);
    }).length;
    return paired === nodes.length ? 'match' : 'list';
  }

  /* ------------------------------------------------------------- numbering */

  var HINDI_ITEM_LETTERS = 'कखगघङचछज'.split(''); // क ख ग घ ...
  var HINDI_OPTION_LETTERS = 'अबसद'.split('');                       // अ ब स द

  function makeLabel(index, format, script) {
    if (format === 'a') return String.fromCharCode(97 + (index % 26));
    if (format === 'A') return String.fromCharCode(65 + (index % 26));
    if (format === 'r' || format === 'R') {
      var roman = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'][index] || String(index + 1);
      return format === 'R' ? roman.toUpperCase() : roman;
    }
    if (format === 'hindi-letter') return HINDI_ITEM_LETTERS[index] || String(index + 1);
    if (format === 'option') {
      return script === 'hi'
        ? (HINDI_OPTION_LETTERS[index] || String(index + 1))
        : String.fromCharCode(97 + (index % 26));
    }
    return String(index + 1);
  }

  /** The kind of sequence a label belongs to, or null if it is not one we count. */
  function labelFormat(label) {
    if (/^\d{1,2}$/.test(label)) return 'd';
    if (/^[a-z]$/.test(label)) return 'a';
    if (/^[A-Z]$/.test(label)) return 'A';
    if (HINDI_OPTION_LETTERS.indexOf(label) >= 0) return 'option-hi';
    if (HINDI_ITEM_LETTERS.indexOf(label) >= 0) return 'hindi-letter';
    return null;
  }

  /** Position of a label within its sequence: "1"/"a" -> 0, "2"/"b" -> 1, ... */
  function labelPosition(label, format) {
    if (format === 'd') return parseInt(label, 10) - 1;
    if (format === 'a') return label.charCodeAt(0) - 97;
    if (format === 'A') return label.charCodeAt(0) - 65;
    if (format === 'option-hi') return HINDI_OPTION_LETTERS.indexOf(label);
    if (format === 'hindi-letter') return HINDI_ITEM_LETTERS.indexOf(label);
    return -1;
  }

  /**
   * Fills the holes in a partly-labelled group: given "", "2." the first item
   * is plainly "1.", and given "", "(b)" the first option is "(a)".
   *
   * The labels that *are* present must agree on one sequence before anything is
   * filled in. That guard matters: in a question whose items are "1.", "", "2."
   * the blank line is the continuation of item 1, not a missing item 2, and the
   * mismatch is what tells the two cases apart.
   */
  function fillLabelGaps(entries) {
    var anchors = [];
    entries.forEach(function (entry, index) {
      if (!entry.label) return;
      var format = labelFormat(String(entry.label));
      if (format) anchors.push({ index: index, format: format, position: labelPosition(String(entry.label), format) });
    });
    if (!anchors.length) return false;

    var format = anchors[0].format;
    var offset = anchors[0].position - anchors[0].index;
    var consistent = anchors.every(function (anchor) {
      return anchor.format === format && anchor.position - anchor.index === offset;
    });
    if (!consistent || offset < 0) return false;

    entries.forEach(function (entry, index) {
      if (!entry.label) entry.label = makeLabel(index + offset, format);
    });
    return true;
  }

  /**
   * Guarantees every item carries a label.
   *
   * Word stores the numbers of an automatic list outside the text, so a paper
   * typed that way arrives with no visible numbering at all - and a number can
   * also simply be missing from one line. Existing labels are never overwritten;
   * only the gaps are filled.
   */
  function ensureLabels(entries, options) {
    options = options || {};
    if (entries.length < (options.minimum || 2)) return entries;

    var missing = entries.filter(function (entry) { return !entry.label; }).length;
    if (!missing) return entries;

    if (missing < entries.length) {
      fillLabelGaps(entries);
      return entries;
    }

    var format = options.format
      || entries[0].autoFmt
      || (options.script === 'hi' && options.hindiLetters ? 'hindi-letter' : 'd');

    entries.forEach(function (entry, index) {
      entry.label = makeLabel(index, format, options.script);
    });
    return entries;
  }

  /**
   * Short enough to sit beside its neighbours instead of owning a whole line.
   *
   * Letters are counted rather than words, because papers often space a word
   * out letter by letter ("C a t") for young classes - by word count that looks
   * like a sentence, by letter count it is plainly one short word. A blank to
   * write on does not count towards the length; the words do.
   */
  function isShortItem(text, fontPt) {
    var bare = String(text || '').replace(/_{2,}/g, ' ').replace(/[\.\?।]+$/, '').trim();
    var letters = bare.replace(/[^A-Za-zऀ-ॿ]/g, '').length;
    return letters <= 14
      && bare.length <= 30
      && PF.text.widthIn(bare, fontPt || 12) <= 2.4;
  }

  function scriptOf(question) {
    return PF.text.hasDevanagari(question.heading) ? 'hi' : 'en';
  }

  function buildQuestion(raw, ctx) {
    var heading = polishHeading(raw.heading, ctx);
    var nodes = toRawNodes(raw.bodyLines);
    var kind = classify(raw.heading, nodes);

    var question = {
      number: raw.number,
      heading: heading,
      marks: raw.marks,
      kind: kind,
      items: [],
      subs: [],
      pairs: [],
      columnHeaders: null
    };

    if (kind === 'mcq') {
      nodes.forEach(function (node) {
        if (node.kind === 'options') {
          if (!question.subs.length) question.subs.push({ label: '', stem: '', options: [] });
          var current = question.subs[question.subs.length - 1];
          current.options = current.options.concat(node.options.map(function (option) {
            return { label: option.label, text: polish(option.text, ctx) };
          }));
        } else {
          question.subs.push({
            label: node.label,
            autoFmt: node.autoFmt,
            stem: polish(node.text, ctx, { keepTrailingDash: true }),
            options: []
          });
        }
      });

      // A placeholder sub (options that arrived before any stem) is not a
      // sub-question and must not take a number in the sequence.
      ensureLabels(question.subs.filter(function (sub) { return sub.stem; }), { script: scriptOf(question) });
      question.subs.forEach(function (sub) {
        ensureLabels(sub.options, { format: 'option', script: scriptOf(question) });
      });
      return question;
    }

    if (kind === 'match') {
      var items = nodes.map(function (node) {
        return { label: node.label, text: node.text, autoFmt: node.autoFmt };
      });

      var headerNode = items[0];
      var headerCols = headerNode && COLUMN_HEADER_RE.test(headerNode.text)
        ? splitParts(headerNode.text, true)
        : null;
      if (headerCols) {
        question.columnHeaders = { left: polish(headerCols.left, ctx), right: polish(headerCols.right, ctx) };
        items = items.slice(1);
      }

      // Order is preserved: an item that could not be split into two columns
      // stays in place as a left-column-only row instead of being dropped.
      var pairs = [];
      var unsplit = [];
      var splitCount = 0;
      items.forEach(function (item) {
        // The heading already said "match", so the pair test is relaxed here -
        // but a line holding a blank or a tick box is still never split.
        var cols = columnSplit(item.text, false);
        if (cols) {
          splitCount++;
          pairs.push({ label: item.label, autoFmt: item.autoFmt, left: polish(cols.left, ctx), right: polish(cols.right, ctx) });
        } else {
          var plain = { label: item.label, autoFmt: item.autoFmt, text: polish(item.text, ctx) };
          unsplit.push(plain);
          pairs.push({ label: plain.label, autoFmt: plain.autoFmt, left: plain.text, right: '' });
        }
      });

      if (!splitCount) {
        pairs = [];
        var stacked = pairStackedItems(unsplit);
        if (stacked) {
          question.pairs = stacked;
          return question;
        }
        question.kind = 'list';
        question.items = unsplit;
        return question;
      }

      question.pairs = ensureLabels(pairs, { script: scriptOf(question), hindiLetters: true });
      return question;
    }

    question.items = ensureLabels(nodes.map(function (node) {
      var text = node.text.replace(PF.normalize.SEP_RE, ' ');
      return { label: node.label, autoFmt: node.autoFmt, text: polish(text, ctx), box: !!node.box };
    }), { script: scriptOf(question) });

    if (!question.items.length) {
      question.kind = 'plain';
    } else if (question.items.length >= 3 && question.items.every(function (item) {
      return !item.box && isShortItem(item.text, ctx.fontSizePt);
    })) {
      question.kind = 'inline';
    }
    return question;
  }

  /* ---------------------------------------------------------------- polish */

  function polish(text, ctx, options) {
    options = options || {};
    var out = PF.normalize.applySuggestions(text, ctx.acceptedSuggestions);
    var trailingDash = options.keepTrailingDash && /[-–]\s*$/.test(out);
    out = PF.normalize.polishFragment(out, {
      properNouns: ctx.properNouns,
      fixes: ctx.fixes,
      terminalQuestionMark: ctx.addQuestionMarks && !options.keepTrailingDash
    });
    if (trailingDash && !/[-–]$/.test(out)) out += '-';
    return out;
  }

  function polishHeading(text, ctx) {
    var out = PF.normalize.applySuggestions(text, ctx.acceptedSuggestions);
    out = PF.normalize.polishFragment(out, { properNouns: ctx.properNouns, fixes: ctx.fixes });
    out = out.replace(/\s*[-–—_:;,]+\s*$/, '');

    // "Write 8 line poems ?" is an instruction, not a question - drop the "?".
    if (ctx.fixImperativeMarks && /\?+\s*$/.test(out) && PF.rules.isImperative(out)) {
      out = out.replace(/\?+\s*$/, '');
      ctx.fixes.push({ rule: 'instruction punctuation', before: PF.text.collapseSpaces(text), after: out + ':' });
    }
    if (!/[?:।]$/.test(out)) out += ':';
    return out;
  }

  /* ----------------------------------------------------------------- entry */

  function parse(lines, options) {
    options = options || {};
    var ctx = {
      properNouns: options.properNouns || null,
      acceptedSuggestions: options.acceptedSuggestions || [],
      addQuestionMarks: options.addQuestionMarks !== false,
      fixImperativeMarks: options.fixImperativeMarks !== false,
      fontSizePt: options.fontSizePt || 12,
      fixes: []
    };

    var firstQuestion = -1;
    var rawQuestions = [];
    var current = null;

    lines.forEach(function (line, index) {
      var flat = PF.normalize.clean(line); // markers and separators are not part of a heading
      var match = flat.match(QUESTION_RE);
      if (match && (match[1] || match[2])) {
        if (firstQuestion < 0) firstQuestion = index;
        var rest = match[3] || '';
        var marks = '';
        var marksMatch = rest.match(MARKS_RE);
        if (marksMatch) {
          marks = marksMatch[1];
          rest = rest.slice(0, marksMatch.index);
        }
        current = { number: match[1] || match[2], heading: rest, marks: marks, bodyLines: [] };
        rawQuestions.push(current);
        return;
      }
      if (current) current.bodyLines.push(line);
    });

    rawQuestions.forEach(liftStrayMarks);

    var headerLines = lines.slice(0, firstQuestion < 0 ? lines.length : firstQuestion);
    var paper = {
      header: parseHeader(headerLines),
      questions: rawQuestions.map(function (raw) { return buildQuestion(raw, ctx); }),
      fixes: ctx.fixes
    };
    return paper;
  }

  /**
   * Marks typed on the line below the heading ("Tick the correct option" /
   * "1___ who asked the question? (5)") belong to the question, not to the
   * sub-question that happens to carry them.
   */
  function liftStrayMarks(raw) {
    if (raw.marks || !raw.bodyLines.length) return;
    var first = raw.bodyLines[0];
    var match = PF.normalize.clean(first).match(MARKS_RE);
    if (!match) return;
    raw.marks = match[1];
    raw.bodyLines[0] = first.replace(/[\(\[]\s*\d{1,2}\s*[\)\]]\s*[\.\?:]*\s*$/, '').trim();
    if (!raw.bodyLines[0]) raw.bodyLines.shift();
  }

  PF.parser = {
    parse: parse,
    parseOptions: parseOptions,
    splitInlineItems: splitInlineItems,
    stripLabel: stripLabel
  };
})(window.PF = window.PF || {});
