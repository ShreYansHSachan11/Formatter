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


  /*
   * Whitespace, as this file has to see it.
   *
   * By the time a line reaches the parser, prepare() has replaced its tabs and
   * its runs of two or more spaces with sentinels, so that the layout can tell
   * a column break from ordinary typing. A sentinel is not \s - so every
   * pattern here that expects a space has to be told about them, or a label
   * typed "(ग।  )" with two spaces inside the bracket stops being a label, a
   * tick box typed "(  )" stops being a tick box, and marks typed "(1x  5)"
   * are recognised and then left behind in the text they were lifted out of.
   */
  var WS = '[\\s' + PF.normalize.TAB_SEP + PF.normalize.SPACE_SEP + ']';

  /** The same pattern, with every \s widened to include the sentinels. */
  function ws(pattern, flags) {
    return new RegExp(pattern.split('\\s').join(WS), flags);
  }

  var QUESTION_RE = new RegExp(
    '^\\s*(?:' +
    '(?:Q|Que|Ques|Quest|Question|QUE)\\s*[-\\u2013\\u2014._:]*\\s*(\\d{1,2})' +
    '|(?:\\u092A\\u094D\\u0930\\u0936\\u094D\\u0928)\\s*[-\\u2013\\u2014._:]*\\s*(\\d{1,2})' +
    ')\\s*[-\\u2013\\u2014.:\\)]*\\s*(.*)$', 'i');

  /*
   * Up to three digits: a section can be worth 100. Four would start matching
   * years, which belong to the paper's title rather than to its marks.
   *
   * Marks are as often written as a sum as a total - "(1x 5)", "( 2x5 )" - and
   * reading only a bare number left that sum sitting in the middle of the
   * heading with no marks at all against the question.
   */
  var MARKS_RE = ws('[\\(\\[]\\s*(\\d{1,3}(?:\\s*[x×X]\\s*\\d{1,3})?)\\s*[\\)\\]]\\s*[\\.\\?:।]*\\s*$');
  // A tick box is a tick box whichever brackets it is typed with. Papers use
  // "( )" and "[ ]" interchangeably, and reading only one of them turned a row
  // of options into five separate questions.
  var EMPTY_BOX_RE = ws('(?:\\(\\s*\\)|\\[\\s*\\])', 'g');
  var TF_BOX_RE = ws('\\[\\s*\\]\\s*$');
  // Items typed two to a line are short by nature ("I. Talk-"); a long half is
  // prose that merely has a tab in it.
  var MAX_TABBED_ITEM_CHARS = 45;
  // Roman numerals come first so "(iii)" is read whole instead of as "i".
  var ROMAN = 'ii|iii|iv|vi|vii|viii|ix|xi|xii|II|III|IV|VI|VII|VIII|IX|XI|XII';
  /*
   * A label may carry a stray mark of its own inside the brackets - "(ग।  )",
   * "( क,)" - where a danda or a comma was typed before the bracket was
   * closed. It is still the label ग, and reading it as prose gave the item two
   * labels: the one it was typed with and the one the formatter then invented.
   * The closing bracket or stop is still required, so a sentence opening
   * "A, B and C" is not read as a label.
   */
  var LABEL_RE = ws('^\\(?\\s*(' + ROMAN + '|[0-9]{1,2}|[A-Za-z]|[\\u0905-\\u0939])'
    + '\\s*[\\u0964,]?\\s*[\\)\\.\\u2013\\u2014-]+\\s*');
  /*
   * Where a sentence stops.
   *
   * Hindi ends a line with the danda, and a keyboard without one is why the
   * same paper ends its lines with "।", with "॥" and with the vertical bar.
   * Knowing only the first of the three read four lines of verse as one
   * unfinished sentence and ran three of them into the question's heading.
   */
  var STOP = '[.?!:\\u0964\\u0965|]';

  var MATCH_KEYWORDS = /(match the following|match the|मिलान)/i;

  /*
   * A question that quotes something and asks about it: a couplet, a stanza, a
   * passage. What it quotes is not a list of items - it is not the paper's
   * business to number the lines of a poem, and the lines are left exactly as
   * they were typed, one per line.
   */
  var QUOTED_KEYWORDS = new RegExp(
    '\\u092A\\u0926\\u094D\\u092F\\u093E\\u0902\\u0936'                       // पद्यांश
    + '|\\u0917\\u0926\\u094D\\u092F\\u093E\\u0902\\u0936'                    // गद्यांश
    + '|\\u092A\\u0926\\u094B\\u0902?'                                        // पदो / पदों
    + '|\\u092A\\u0902\\u0915\\u094D\\u0924\\u093F'                           // पंक्ति
    + '|\\u0926\\u094B\\u0939[\\u093E\\u0947]'                                // दोहा / दोहे
    + '|\\u091A\\u094C\\u092A\\u093E\\u0908'                                  // चौपाई
    + '|\\u0936\\u094D\\u0932\\u094B\\u0915'                                  // श्लोक
    + '|\\u091B\\u0902\\u0926'                                                // छंद
    + '|verse|stanza|couplet|extract', 'i');

  // A heading that says the answers are to be ticked. Used as the licence to
  // stack options that were typed one per line back onto a single row.
  var MCQ_KEYWORDS = new RegExp(
    '(tick|choose|select|circle|pick|mark)[^.\\u0964]{0,30}(correct|right|best|suitable|appropriate|option|answer)'
    + '|correct (option|answer|one)'
    + '|multiple[- ]choice'
    + '|\\u0938\\u0939\\u0940\\s*(\\u0935\\u093F\\u0915\\u0932\\u094D\\u092A|\\u0909\\u0924\\u094D\\u0924\\u0930)'   // सही विकल्प / सही उत्तर
    + '|\\u092C\\u0939\\u0941\\u0935\\u093F\\u0915\\u0932\\u094D\\u092A\\u0940', 'i');                                // बहुविकल्पीय
  var COLUMN_HEADER_RE = /(column|कॉलम|कॉलम)/i;

  /* ---------------------------------------------------------------- header */

  /*
   * A header label is typed with whatever punctuation came to hand: "Sub-",
   * "Class :-", "Time_ 2:30", "Mark__50". So the separator between a label and
   * its value is any run of spaces, dashes, colons, dots or underscores -
   * reading only "-:." once lost the time and the marks of a whole paper,
   * because that teacher had drawn them with underscores.
   */
  var SEP = '[\\s\\-:.\\u2013\\u2014_]*';

  /*
   * And the label itself has as many spellings as there are teachers. The
   * marks line alone turns up as M.M., MM, Mark, Marks, Max Marks, Total Marks
   * and पूर्णांक, so each field is recognised by all of its names rather than
   * by the one this school happened to use last time.
   */
  var LABEL = {
    subject: '(?:sub(?:ject)?|\\u0935\\u093F\\u0937\\u092F)',                                   // विषय
    className: '(?:class|std|standard|\\u0915\\u0915\\u094D\\u0937\\u093E)',                    // कक्षा
    time: '(?:time|\\u0938\\u092E\\u092F)',                                                     // समय
    marks: '(?:m\\.?\\s*m\\.?|max(?:imum)?\\s*marks?|total\\s*marks?|marks?'
      + '|\\u092A\\u0942\\u0930\\u094D\\u0923\\u093E\\u0902\\u0915|\\u0905\\u0902\\u0915)'      // पूर्णांक / अंक
  };

  /*
   * Where one field's value ends: at a bar, at the start of another label, or
   * at the end. A marks label only counts when a number follows it, so that
   * "Sub: Marketing" is a subject and not an empty one ending at "Mark".
   * Devanagari labels take no \b - a Devanagari letter is not a word character
   * to a JavaScript regular expression, so the boundary would never match.
   */
  var NEXT_FIELD = '(?=\\s*(?:\\|'
    + '|(?:time|class|std|standard|sub(?:ject)?)\\b'
    + '|(?:\\u0938\\u092E\\u092F|\\u0915\\u0915\\u094D\\u0937\\u093E|\\u0935\\u093F\\u0937\\u092F'
    + '|\\u092A\\u0942\\u0930\\u094D\\u0923\\u093E\\u0902\\u0915|\\u0905\\u0902\\u0915)'
    + '|' + LABEL.marks + SEP + '\\d'
    + '|$))';

  /*
   * The first thing in the header that reads like this field and holds a
   * plausible value. Taking the first match outright is not enough: the words
   * a label is made of turn up in the title lines too, and "Standard
   * Examination 2026-27" would otherwise be read as class "Examination".
   */
  function field(joined, label, value, plausible) {
    var re = new RegExp(label + SEP + value, 'gi');
    var match;
    while ((match = re.exec(joined)) !== null) {
      var candidate = tidyValue(match[1]);
      if (candidate && (!plausible || plausible(candidate))) return candidate;
    }
    return '';
  }

  // The unit after the clock time has to be an actual unit. Matching any
  // letters here once produced "Time: 2:30 Class" from "Time- 2:30 Class:- 1st".
  var TIME_VALUE = '([0-9]{1,2}[:.][0-9]{2}(?:\\s*(?:hrs?|hours?|h|am|pm))?'
    + '|[0-9]+\\s*(?:hrs?|hours?|\\u0918\\u0902\\u091F\\u0947|\\u0918\\u0923\\u094D\\u091F\\u0947))';

  /**
   * The labelled fields in a single line, and nothing else - no school, no
   * examination, no falling back to the first line.
   *
   * This is what a person gets when they retype the header line in the
   * preview. Time, class and marks share that line, and typing over the whole
   * of it used to leave one field holding the lot and the other two empty, so
   * the line collapsed to a single field against the left margin. Whatever is
   * typed, the labels in it decide which field is which.
   */
  function parseHeaderLine(text) {
    var joined = PF.normalize.clean(text);
    return {
      subject: field(joined, LABEL.subject, '([^|]+?)' + NEXT_FIELD),
      className: field(joined, LABEL.className, '([^|]*?)' + NEXT_FIELD, looksLikeClass),
      time: field(joined, LABEL.time, TIME_VALUE),
      maxMarks: field(joined, LABEL.marks, '(\\d{1,3})')
    };
  }

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

    header.subject = field(joined, LABEL.subject, '([^|]+?)' + NEXT_FIELD);
    header.className = field(joined, LABEL.className, '([^|]*?)' + NEXT_FIELD, looksLikeClass);

    header.time = field(joined, LABEL.time, TIME_VALUE);
    header.maxMarks = field(joined, LABEL.marks, '(\\d{1,3})');

    lines.forEach(function (line) {
      var text = PF.normalize.clean(line);
      if (!header.exam && /(examination|exam\b|परीक्षा)/i.test(text)) {
        header.exam = examCase(text);
      } else if (!header.school && /(academy|school|vidyalaya|college|विद्यालय)/i.test(text)) {
        header.school = schoolName(text);
      }
    });

    if (!header.school && lines.length) header.school = schoolName(lines[0]);
    return header;
  }

  /*
   * The two title lines are typed a little differently on every paper -
   * "S.S Academy koirauna Bhadohi", "Half _ yearly Examination" - and those
   * underscores are a separator someone drew by hand, not part of the name.
   * Every paper from a school should look like the same paper, so the school
   * stands in capitals and the examination in title case however it arrived.
   * Both remain editable in the header boxes above the preview.
   */
  function withoutHandDrawnRules(text) {
    return PF.text.collapseSpaces(String(text || '')
      .replace(/_+/g, ' ')
      .replace(/[\s\-–—]+$/, ''));
  }

  var LOWER_IN_TITLES = ['of', 'the', 'and', 'for', 'in', 'to'];

  function examCase(text) {
    var line = withoutHandDrawnRules(PF.normalize.clean(text));
    // A line with no lower case in it anywhere is shouting, not abbreviating:
    // "ANNUAL EXAMINATION" is a title in capitals, while the CBSE in "Half
    // Yearly Examination CBSE" is a name that is spelled that way.
    var shouting = !/[a-z]/.test(line);

    return line.replace(/[A-Za-z][A-Za-z'.]*/g, function (word, offset) {
      if (/^[A-Z]\.(?:[A-Z]\.?)+$/.test(word)) return word;          // S.A., G.K.
      if (!shouting && /^[A-Z]{2,}$/.test(word)) return word;        // CBSE
      var lower = word.toLowerCase();
      if (offset > 0 && LOWER_IN_TITLES.indexOf(lower) >= 0) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    });
  }

  /*
   * A class is a number, a roman numeral or one of the classes below school:
   * "8th", "2nd (B)", "XII", "Nursery", "5". Asking for that much is what keeps
   * the wider set of labels safe - "Standard" is a class label in half the
   * papers in the country and an ordinary word in the other half, and without
   * this the exam line of a "STANDARD EXAMINATION" would be read as a class.
   */
  var INFANT_CLASSES = /^(nursery|prep|play\s*group|[lu]?\.?k\.?g\.?)\b/i;

  function looksLikeClass(value) {
    if (!value || value.length > 20) return false;
    // It has to *begin* like a class. "Examination 2026-27" has a number in it
    // too, and that is exactly the line this guard exists to turn down.
    if (/^[0-9०-९]/.test(value)) return true;
    if (INFANT_CLASSES.test(value)) return true;
    return /^(?:i{1,3}|iv|v|vi{1,3}|ix|x|xi{1,2})(?:th|st|nd|rd)?\b/i.test(value);
  }

  function schoolName(text) {
    return dotInitials(withoutHandDrawnRules(PF.normalize.clean(text)).toUpperCase());
  }

  /*
   * "SS ACADEMY" -> "S.S. ACADEMY". A school's opening initials are an
   * abbreviation and read better with stops. Only a token of two or three
   * capitals standing on its own qualifies, so "SUNRISE ACADEMY" is left alone,
   * and titles that are abbreviated differently keep their usual spelling.
   */
  var NOT_INITIALS = ['ST', 'MT', 'DR', 'MR', 'MS', 'JR', 'SR', 'THE'];

  function dotInitials(name) {
    return String(name || '')
      .replace(/^([A-Z]{2,3})(?=\s+[A-Za-z])/, function (initials) {
        if (NOT_INITIALS.indexOf(initials) >= 0) return initials;
        return initials.split('').join('.') + '.';
      })
      // "S.S Academy" - the stops were started and then abandoned.
      .replace(/^((?:[A-Z]\.){1,2}[A-Z])(?=\s+[A-Za-z])/, '$1.');
  }

  /*
   * The punctuation a label is typed with ("Sub:- English.") is trimmed off
   * the value - except the last dot of an abbreviation, which is part of the
   * subject's name: "G.K." must not come back as "G.K". An inner dot between
   * two letters is what tells the two apart.
   */
  /** "(1x 5)" and "( 2 X 5 )" are the same marks, written differently. */
  function tidyMarks(marks) {
    return String(marks || '').replace(/\s+/g, '').replace(/[X×]/g, 'x');
  }

  function tidyValue(value) {
    var text = PF.normalize.clean(value).replace(/^[-:.–\s]+/, '');
    var trimmed = text.replace(/[-:.–\s]+$/, '');
    if (/\.$/.test(text) && /[A-Za-z]\.[A-Za-z]/.test(text)) return trimmed + '.';
    return trimmed;
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

    var chunks = line.split(/(?:\(\s*\)|\[\s*\])/);
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

  /**
   * Two items typed side by side on one line:
   *
   *     I.  Talk-        IV. Face-
   *     II. Red-         V.  Fail-
   *
   * The gap is a tab, the same character that separates the two columns of a
   * matching question - so the split has to be earned. What earns it is the
   * second half starting a label of the same sequence as the first: a matching
   * question's right column is an answer, and answers are not numbered.
   */
  function splitTabbedItems(line, expectedFormat) {
    var parts = line.split(PF.normalize.SEP_RE)
      .map(function (part) { return part.trim(); })
      .filter(Boolean);
    if (parts.length < 2) return null;

    var items = [];
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].length > MAX_TABBED_ITEM_CHARS) return null;
      var stripped = stripLabel(parts[i]);

      if (i === 0) {
        // The first half may carry Word's automatic numbering instead of a
        // typed label, in which case the format is known from the marker.
        items.push(stripped || { label: '', rest: parts[i] });
        continue;
      }
      if (!stripped || !stripped.rest) return null;
      var format = labelFormat(String(stripped.label));
      if (!format || !sameSequence(format, expectedFormat, items)) return null;
      // The second column carries on where the first one ends, so its number
      // jumps ahead by a whole column: "I ... IV". Two labels that simply run
      // on ("a ... b") are a list, or the two halves of a matching pair.
      if (!continuesAcrossColumns(items[i - 1], stripped)) return null;
      items.push(stripped);
    }

    return items.length >= 2 ? items.map(function (item) {
      return { label: item.label, text: item.rest };
    }) : null;
  }

  var MIN_COLUMN_JUMP = 2;

  /**
   * True when the second label is far enough ahead of the first to be the next
   * column rather than the next item: a second column carries on where the
   * first one ended, so it starts a whole column further down the sequence. A
   * first half numbered by Word carries no label to compare with - the marker
   * on it is evidence enough on its own.
   */
  function continuesAcrossColumns(previous, current) {
    if (!previous || !previous.label) return true;
    var formats = formatPair(previous.label, current.label);
    if (!formats.first || !formats.second) return false;

    var from = labelPosition(String(previous.label), formats.first);
    var to = labelPosition(String(current.label), formats.second);
    return from >= 0 && to - from >= MIN_COLUMN_JUMP;
  }

  /** The label of a second item on the line belongs to the first one's series. */
  function sameSequence(format, expectedFormat, items) {
    var first = items[0] && items[0].label ? formatPair(items[0].label, '').first : '';
    var reference = expectedFormat || first;
    if (!reference) return false;
    if (reference === format) return true;
    // "I" is a letter and a roman numeral both; "IV" beside it settles it.
    return (reference === 'a' && format === 'r') || (reference === 'A' && format === 'R')
      || (reference === 'r' && format === 'a') || (reference === 'R' && format === 'A');
  }

  /** First pass: each body line becomes a raw node. */
  /* ----------------------------------------------- lines that ran out of room
   *
   * A paper typed by hand is full of lines that are one line of text and two
   * lines in the file: the teacher pressed Enter where the page ran out, or a
   * break was left behind by whoever typed it. Read literally, the second half
   * becomes an item of its own - which is how "...ठीक जगह बताते" and "थे ।"
   * became two questions, how eleven comma-separated words became a numbered
   * list of two, how half of the last option of a question turned into a
   * sub-question that never existed, and how the second half of a heading was
   * read as the body of its own question - in one case as two columns to match.
   *
   * Three things must be true before a line is read as the rest of the line
   * above it, and every one of them on its own is far too weak:
   *
   *   1. it carries no label and no number of Word's own - anything labelled
   *      is an item by its own declaration;
   *   2. it holds no blank to fill in - a line with a blank is an item of its
   *      own however it is punctuated;
   *   3. the line above it is unfinished - it ends in the middle of a
   *      sentence, with no stop, danda, question mark, tick box or blank - and
   *      it is long enough to have reached the edge of the page.
   *
   * Together they separate a wrap from a list. "The fox ____ the wolf to an
   * old house" is followed by another line with a blank in it, so neither is
   * folded; "Hot" followed by "Cold" is far too short to have run out of room.
   */

  // A line ends here, and whatever follows it is something new.
  var FINISHED_RE = ws('(?:' + STOP + '|\\(\\s*\\)|\\[\\s*\\]|_{2,}|\\)|\\])\\s*$');
  var BLANK_RE = /_{2,}/;
  // The text column of an A4 page, near enough: a line has to have reached a
  // good way across it to have been broken by it.
  var COLUMN_IN = 6.8;
  var WRAPPED_AT = 0.5;

  function ranToTheEdge(text, ctx) {
    return PF.text.widthIn(text, (ctx && ctx.fontSizePt) || 12) >= COLUMN_IN * WRAPPED_AT;
  }

  /** Conditions 1 and 2: could this line be the rest of the one above it? */
  function couldContinue(previousText, currentRaw) {
    if (!previousText || currentRaw === undefined || currentRaw === null) return false;
    if (FINISHED_RE.test(previousText)) return false;

    if (PF.normalize.AUTO_LABEL_RE.test(currentRaw)) return false;
    var current = PF.normalize.clean(currentRaw);
    if (!current || BLANK_RE.test(current)) return false;
    return !stripLabel(current);
  }

  /** Condition 3 as well: the line above ran to the edge of the page. */
  function continuesLine(previousText, currentRaw, ctx) {
    return couldContinue(previousText, currentRaw) && ranToTheEdge(previousText, ctx);
  }

  function joinWrappedLines(bodyLines, ctx) {
    var joined = [];

    bodyLines.forEach(function (line) {
      var previous = joined.length ? joined[joined.length - 1] : null;
      if (previous !== null && continuesLine(PF.normalize.clean(previous), line, ctx)) {
        joined[joined.length - 1] = previous.replace(/\s+$/, '') + ' '
          + String(line).replace(/^\s+/, '');
        return;
      }
      joined.push(line);
    });

    return joined;
  }

  /*
   * A heading has a second kind of evidence available to it: the marks. A
   * question whose marks are sitting at the end of the line below it, on a
   * line that carries no label of its own, is a heading that was broken in
   * two - however far across the page it happens to have reached.
   */
  function continuesHeading(heading, raw, ctx) {
    if (!couldContinue(heading, raw.bodyLines[0])) return false;
    if (ranToTheEdge(heading, ctx)) return true;
    return !raw.marks && MARKS_RE.test(PF.normalize.clean(raw.bodyLines[0]));
  }

  /**
   * The same rule for a question's heading: "...संधि विच्छेद कीजिए तथा संधि का"
   * is half a sentence, and the half below it is the rest of the heading - not
   * the first item of the question, and certainly not a column to match.
   *
   * One line, and one only. A heading that is broken is broken in two, and the
   * line after the second one belongs to the question however that second line
   * happens to end - question 7 asked for the sandhi of five words and took
   * the words into its heading as well, because the line carrying them read as
   * one more piece of the same sentence. The marks stop it too: they are the
   * end of an instruction, always, which is why this runs before they are
   * lifted off and not after.
   */
  function foldHeadingContinuation(raw, ctx) {
    if (!raw.bodyLines.length) return;

    var heading = PF.normalize.clean(raw.heading);
    if (!continuesHeading(heading, raw, ctx)) return;

    raw.heading = PF.text.collapseSpaces(heading + ' '
      + PF.normalize.clean(raw.bodyLines.shift()));

    // The marks were on the half that had been left behind.
    var marks = raw.heading.match(MARKS_RE);
    if (marks) {
      if (!raw.marks) raw.marks = tidyMarks(marks[1]);
      raw.heading = raw.heading.slice(0, marks.index);
    }
  }

  function toRawNodes(bodyLines, heading, ctx) {
    var nodes = [];
    var matching = MATCH_KEYWORDS.test(heading || '');
    // Whether Word is doing the numbering for this question. If it is, every
    // item it counts carries a marker, and the lines that do not are something
    // else - see foldUnnumberedLines.
    var numbering = bodyLines.some(function (line) {
      return PF.normalize.AUTO_LABEL_RE.test(line);
    });

    // Lines of verse are typed one per line on purpose, so in a question that
    // quotes them nothing is run together - a poem has no lines that ran out
    // of room, only lines that end where the poet ended them.
    var lines = QUOTED_KEYWORDS.test(heading || '')
      ? bodyLines
      : joinWrappedLines(bodyLines, ctx);

    lines.forEach(function (rawLine) {
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

      var tabbed = matching ? null : splitTabbedItems(plain, autoFmt);
      if (tabbed) {
        tabbed.forEach(function (item, index) {
          nodes.push({
            kind: 'item', label: item.label, text: item.text, box: box,
            autoFmt: index === 0 ? autoFmt : ''
          });
        });
        return;
      }

      var stripped = stripLabel(plain);
      if (stripped) {
        nodes.push({ kind: 'item', label: stripped.label, text: stripped.rest, box: box, autoFmt: autoFmt });
      } else {
        // No typed label and no marker, in a question Word is numbering: this
        // line is not one of the items. foldUnnumberedLines says what it is.
        nodes.push({
          kind: 'item', label: '', text: plain.trim(), box: box, autoFmt: autoFmt,
          unnumbered: numbering && !autoFmt
        });
      }
    });

    return numbering ? foldUnnumberedLines(nodes) : nodes;
  }

  /*
   * What Word's numbering says about a line that has none.
   *
   * A numbered list in Word carries its numbers outside the text, one per
   * paragraph. So inside a question whose lines are numbered that way, a line
   * arriving without a number is not an item that lost its number - it is
   * either a line broken with Shift+Enter, which is the rest of the item above
   * it, or something that was never part of the list at all, such as the box of
   * phrases above a "complete the sentences" question.
   *
   * Reading those as items is what turned one true/false statement into two and
   * numbered the box of phrases as question 1.
   */
  function foldUnnumberedLines(nodes) {
    var folded = [];

    nodes.forEach(function (node) {
      if (!node.unnumbered) {
        delete node.unnumbered;
        folded.push(node);
        return;
      }
      delete node.unnumbered;

      var previous = folded[folded.length - 1];
      if (previous && previous.kind === 'item' && !previous.lead) {
        previous.text = PF.text.collapseSpaces(previous.text + ' ' + node.text);
        previous.box = previous.box || node.box;
        return;
      }
      node.lead = true; // nothing above it to continue: a line of its own
      folded.push(node);
    });

    return folded;
  }

  /* ------------------------------------------------- options typed in a stack
   *
   * Options are just as often typed one below the other as side by side:
   *
   *     1. Which of these is the biggest?
   *        (a) Elephant
   *        (b) Ant
   *        (c) Dog
   *
   * Read line by line that is three more items, and the paper comes out with
   * one option per line - the opposite of what the layout is meant to do. So
   * consecutive lines are stacked back onto one row, but only on strong
   * evidence, because turning a list into options is not a reversible mistake:
   * either every line in the run carries its own tick box, or the heading says
   * the paper is to be ticked and the labels are a letter sequence starting at
   * its first letter. Numbers are never enough on their own - "1. 2. 3." under
   * a tick-the-option heading are the questions, not the choices.
   */

  var TRAILING_BOX_RE = ws('\\s*\\(\\s*\\)\\s*$');
  var MAX_OPTION_CHARS = 45;
  var MAX_OPTION_RUN = 8;
  // Without a label to go on, a tick box is the only evidence there is, and a
  // true/false statement carries one too. A choice is a few words; a statement
  // is a sentence, so the unlabelled case is held to a much shorter line.
  var MAX_BARE_OPTION_CHARS = 25;
  var MAX_BARE_OPTION_WORDS = 4;

  /*
   * Headings that look like a tick-the-option instruction but are not. "Write
   * true or false" and "Choose the correct word and fill in the blanks" both
   * match the keywords, and in both every line is an answer to be written
   * rather than a choice to be ticked, so nothing in them is ever stacked.
   */
  var NOT_OPTION_HEADINGS = new RegExp(
    'true\\s*(or|and|\\/|,)\\s*false|false\\s*(or|\\/)\\s*true'
    + '|fill in the blank|fill up the blank'
    + '|\\u0938\\u0924\\u094D\\u092F|\\u0905\\u0938\\u0924\\u094D\\u092F'                               // सत्य / असत्य
    + '|\\u0930\\u093F\\u0915\\u094D\\u0924\\s*\\u0938\\u094D\\u0925\\u093E\\u0928'                     // रिक्त स्थान
    + '|\\u0916\\u093E\\u0932\\u0940\\s*\\u0938\\u094D\\u0925\\u093E\\u0928', 'i');                     // खाली स्थान

  // A choice is a few words, not a sentence, and never has a blank in it: a
  // line with a blank is a line to be written on.
  var BLANK_IN_LINE_RE = ws('(_{3,}|\\[\\s*\\])');
  var SENTENCE_TAIL_RE = ws('[?\\u0964\\u0965|]\\s*$');

  function looksLikeOption(node, bare) {
    if (!node || node.kind !== 'item' || node.box) return false;
    var text = String(node.text || '').replace(TRAILING_BOX_RE, '').trim();
    if (!text) return false;
    // A line still carrying a separator is two columns, not one choice.
    if (text.indexOf(PF.normalize.TAB_SEP) >= 0 || text.indexOf(PF.normalize.SPACE_SEP) >= 0) return false;
    if (BLANK_IN_LINE_RE.test(text)) return false;
    if (SENTENCE_TAIL_RE.test(text)) return false;
    if (/\.\s*$/.test(text) && text.split(/\s+/).length > 3) return false;
    if (!bare) return text.length <= MAX_OPTION_CHARS;
    return text.length <= MAX_BARE_OPTION_CHARS && text.split(/\s+/).length <= MAX_BARE_OPTION_WORDS;
  }

  function isBoxed(node) {
    return TRAILING_BOX_RE.test(String(node.text || ''));
  }

  /**
   * The sequence a run of labels belongs to.
   *
   * "i" is both the ninth letter and the first roman numeral, and the label
   * alone cannot say which; the line below it can, so "(i) (ii) (iii)" is read
   * as roman rather than as a letter list that starts at the wrong place.
   */
  function sequenceFormat(first, second) {
    return formatPair(first, second).first;
  }

  /**
   * Reads two labels together, because one of them may not be readable alone.
   *
   * "I", "V" and "X" are letters and roman numerals both. Beside a label that
   * can only be roman - "IV", "ii" - they are roman too, and every place that
   * compares two labels has to agree about that, or one of them quietly counts
   * "I" as the ninth letter and the sequence falls apart.
   */
  function formatPair(first, second) {
    var a = labelFormat(String(first || ''));
    var b = labelFormat(String(second || ''));
    if (isRomanFormat(b) && isAmbiguousLetter(first)) a = b;
    else if (isRomanFormat(a) && isAmbiguousLetter(second)) b = a;
    return { first: a, second: b };
  }

  function isRomanFormat(format) {
    return format === 'r' || format === 'R';
  }

  function isAmbiguousLetter(label) {
    var text = String(label || '');
    return text.length === 1 && ROMAN_SEQUENCE.indexOf(text.toLowerCase()) >= 0;
  }

  /** How many nodes from `start` are the stacked options of one question. */
  function optionRunLength(nodes, start, mcqHeading) {
    if (!nodes[start] || nodes[start].kind !== 'item') return 0;

    var boxed = isBoxed(nodes[start]);
    var format = sequenceFormat(
      nodes[start].label,
      nodes[start + 1] && nodes[start + 1].kind === 'item' ? nodes[start + 1].label : ''
    );
    var lettered = format === 'a' || format === 'A' || format === 'r' || format === 'R'
      || format === 'option-hi' || format === 'hindi-letter';

    // A number is never evidence of a choice: "1. 2. 3." under a tick-the-
    // option heading are the questions, and numbered lines with a box beside
    // them are statements to be marked true or false.
    if (format === 'd') return 0;
    // Options with no label at all are only recognised by their boxes, and are
    // held to a much shorter line to keep statements out.
    var bare = !lettered;
    if (!looksLikeOption(nodes[start], bare)) return 0;
    if (!boxed && !(mcqHeading && lettered && labelPosition(String(nodes[start].label), format) === 0)) return 0;

    var length = 1;
    while (start + length < nodes.length && length < MAX_OPTION_RUN) {
      var node = nodes[start + length];
      if (!looksLikeOption(node, bare) || isBoxed(node) !== boxed) break;
      if (lettered) {
        if (labelFormat(String(node.label || '')) !== format) break;
        if (labelPosition(String(node.label), format) !== length) break;
      } else if (node.label && labelFormat(String(node.label))) {
        break; // a labelled line among unlabelled ones is a different group
      }
      length++;
    }
    return length >= 2 ? length : 0;
  }

  function groupStackedOptions(nodes, heading) {
    if (NOT_OPTION_HEADINGS.test(heading || '')) return nodes;
    // A matching question's lines are pairs, never choices, whatever else the
    // heading happens to say.
    if (MATCH_KEYWORDS.test(heading || '')) return nodes;

    var mcqHeading = MCQ_KEYWORDS.test(heading || '');
    var grouped = [];
    var index = 0;

    while (index < nodes.length) {
      var run = optionRunLength(nodes, index, mcqHeading);
      if (!run) {
        grouped.push(nodes[index]);
        index++;
        continue;
      }
      grouped.push({
        kind: 'options',
        autoFmt: nodes[index].autoFmt,
        options: nodes.slice(index, index + run).map(function (node) {
          return { label: node.label, text: String(node.text).replace(TRAILING_BOX_RE, '').trim() };
        })
      });
      index += run;
    }
    return grouped;
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

  var BLANK_OR_BOX_RE = ws('(_{3,}|\\(\\s*\\)|\\[\\s*\\])');
  var SENTENCE_END_RE = ws(STOP + '\\s*$');
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

  var ROMAN_SEQUENCE = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

  /** The kind of sequence a label belongs to, or null if it is not one we count. */
  function labelFormat(label) {
    if (/^\d{1,2}$/.test(label)) return 'd';
    // A multi-letter roman numeral can only be roman; a lone "i" or "v" is
    // ambiguous and stays with the letter sequence it also belongs to.
    if (ROMAN_SEQUENCE.indexOf(String(label)) > 0) return 'r';
    if (ROMAN_SEQUENCE.indexOf(String(label).toLowerCase()) > 0) return 'R';
    if (/^[a-z]$/.test(label)) return 'a';
    if (/^[A-Z]$/.test(label)) return 'A';
    if (HINDI_OPTION_LETTERS.indexOf(label) >= 0) return 'option-hi';
    if (HINDI_ITEM_LETTERS.indexOf(label) >= 0) return 'hindi-letter';
    return null;
  }

  /** Position of a label within its sequence: "1"/"a" -> 0, "2"/"b" -> 1, ... */
  function labelPosition(label, format) {
    if (format === 'd') return parseInt(label, 10) - 1;
    if (format === 'r') return ROMAN_SEQUENCE.indexOf(String(label));
    if (format === 'R') return ROMAN_SEQUENCE.indexOf(String(label).toLowerCase());
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
  /*
   * "I", "V" and "X" are letters and roman numerals both, and which one they
   * are cannot be read off the label itself - only off the company it keeps.
   * A list running I, II, III, IV, V is roman throughout; read letter by letter
   * it claims to jump from position 8 to position 3, the sequence looks broken,
   * and the numbering of the whole question is abandoned. Where any label is
   * unmistakably roman, the ambiguous ones are read as roman too.
   */
  function unifyRomanAnchors(anchors) {
    var roman = anchors.filter(function (anchor) {
      return anchor.format === 'r' || anchor.format === 'R';
    })[0];
    if (!roman) return;

    anchors.forEach(function (anchor) {
      if (anchor.format !== 'a' && anchor.format !== 'A') return;
      if (ROMAN_SEQUENCE.indexOf(anchor.label.toLowerCase()) < 0) return;
      anchor.format = roman.format;
      anchor.position = labelPosition(anchor.label, anchor.format);
    });
  }

  /*
   * Numbers straight from Word's own counting.
   *
   * Word numbers the paragraphs it numbers, in document order - nothing else on
   * the page affects the count. So where some items carry a marker and others
   * were typed with a number of their own, the marked ones take the sequence
   * positions 1, 2, 3... in the order they appear, and the typed ones keep what
   * they say. Two items typed side by side on one line are read down the left
   * column and then the right, which is how the numbers come out in the paper:
   *
   *     I.  Talk-    IV. Face-        I, II, III down the left,
   *     II. Red-     V.  Fail-        IV and V down the right.
   *     III. See-
   *
   * Counting by position in the list instead would give those five items the
   * numbers I, IV, II, V, III.
   */
  function labelFromMarkers(entries) {
    var marked = entries.filter(function (entry) { return !entry.label && entry.autoFmt; });
    if (!marked.length) return false;

    var format = marked[0].autoFmt;
    if (!marked.every(function (entry) { return entry.autoFmt === format; })) return false;

    var taken = {};
    var typed = entries.filter(function (entry) { return entry.label; });
    for (var i = 0; i < typed.length; i++) {
      var typedFormat = labelFormat(String(typed[i].label));
      if (!typedFormat || !sameSequence(typedFormat, format, [])) return false;
      taken[labelPosition(String(typed[i].label), typedFormat)] = true;
    }

    // Every position has to be free, or the two ways of counting disagree and
    // neither can be trusted.
    for (var n = 0; n < marked.length; n++) if (taken[n]) return false;

    marked.forEach(function (entry, index) {
      entry.label = makeLabel(index, format);
    });
    return true;
  }

  /**
   * Puts items back into the order their numbers claim.
   *
   * Items typed two to a line arrive down the page (I, IV, II, V, III); the
   * numbers say what the order is. Only a complete, unbroken sequence is
   * trusted - anything else is left exactly as it was found.
   */
  function orderByLabel(items) {
    var counted = items.filter(function (item) { return !item.lead; });
    if (counted.length < 2) return items;

    var anchors = [];
    for (var i = 0; i < counted.length; i++) {
      var format = labelFormat(String(counted[i].label || ''));
      if (!format) return items;
      anchors.push({ index: i, format: format, label: String(counted[i].label), position: 0 });
      anchors[i].position = labelPosition(anchors[i].label, format);
    }

    unifyRomanAnchors(anchors);
    var first = anchors[0].format;
    var seen = {};
    var ordered = true;

    for (var a = 0; a < anchors.length; a++) {
      if (anchors[a].format !== first) return items;
      if (anchors[a].position < 0 || seen[anchors[a].position]) return items;
      seen[anchors[a].position] = true;
      if (a > 0 && anchors[a].position < anchors[a - 1].position) ordered = false;
    }
    if (ordered) return items;

    // A gap in the sequence means something is missing; moving what is left
    // around would only make that harder to see.
    var positions = anchors.map(function (anchor) { return anchor.position; }).sort(function (x, y) { return x - y; });
    for (var p = 1; p < positions.length; p++) if (positions[p] !== positions[p - 1] + 1) return items;

    var sorted = anchors.slice().sort(function (x, y) { return x.position - y.position; })
      .map(function (anchor) { return counted[anchor.index]; });

    var next = 0;
    return items.map(function (item) { return item.lead ? item : sorted[next++]; });
  }

  function fillLabelGaps(entries) {
    var anchors = [];
    entries.forEach(function (entry, index) {
      if (!entry.label) return;
      var format = labelFormat(String(entry.label));
      if (format) anchors.push({ index: index, format: format, label: String(entry.label), position: labelPosition(String(entry.label), format) });
    });
    if (!anchors.length) return false;

    unifyRomanAnchors(anchors);
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
      // Word's own count first, where it is available and agrees with the
      // numbers already typed; the neighbours of a gap otherwise.
      if (!labelFromMarkers(entries)) fillLabelGaps(entries);
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
    // Counted as a reader counts them: the marks stacked on a Devanagari
    // letter are part of it, and counting them separately made every Hindi
    // item look twice as long as it is.
    var letters = PF.text.letterCount(bare);
    return letters <= 14
      && bare.length <= 30
      && PF.text.widthIn(bare, fontPt || 12) <= 2.4;
  }

  function scriptOf(question) {
    return PF.text.hasDevanagari(question.heading) ? 'hi' : 'en';
  }

  function buildQuestion(raw, ctx) {
    var heading = polishHeading(raw.heading, ctx);
    var nodes = groupStackedOptions(toRawNodes(raw.bodyLines, raw.heading, ctx), raw.heading);
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
          // The right column carries a label of its own ("b. Meow"), which is
          // a label and not a word: polished as prose it came out capitalised,
          // as "B. Meow". It is lifted off and put back by the same rule that
          // formats every other label in the paper.
          var answer = stripLabel(cols.right);
          pairs.push({
            label: item.label,
            autoFmt: item.autoFmt,
            left: polish(cols.left, ctx),
            rightLabel: answer && answer.rest ? answer.label : '',
            right: polish(answer && answer.rest ? answer.rest : cols.right, ctx)
          });
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

    /*
     * The lines of the poem a question is asking about are quoted, not listed.
     * "निम्नलिखित पदो का संदर्भ सहित व्याख्या कीजिए" is followed by four lines of
     * verse, and numbering them 1 to 4 turns a couplet into a list of tasks.
     * They are marked as lead-in lines: kept exactly where they are, and left
     * out of the counting. Only where nothing in the question was labelled -
     * a typed label is the teacher saying these are items after all.
     */
    var quoted = QUOTED_KEYWORDS.test(raw.heading || '')
      && nodes.length > 1
      && nodes.every(function (node) { return !node.label && !node.autoFmt; });

    question.items = nodes.map(function (node) {
      var text = node.text.replace(PF.normalize.SEP_RE, ' ');
      return {
        label: node.label, autoFmt: node.autoFmt, lead: quoted || !!node.lead,
        text: polish(text, ctx), box: !!node.box
      };
    });

    // A lead-in line - the box of phrases above "complete the sentences" - is
    // not an item and must not take a number, or every item below it is out by
    // one. It keeps its place in the list; it is only left out of the counting.
    var counted = question.items.filter(function (item) { return !item.lead; });
    ensureLabels(counted, { script: scriptOf(question) });
    question.items = orderByLabel(question.items);

    if (!question.items.length) {
      question.kind = 'plain';
    } else if (counted.length === question.items.length
      && question.items.length >= 3 && question.items.every(function (item) {
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
    // An instruction has nothing to fill in, so a run of underscores in it is a
    // line someone drew rather than a blank: "मुहावरा लिखिए,,___(1x3)" is an
    // instruction with a rule after it and the marks at the end.
    out = PF.text.collapseSpaces(out.replace(/_{2,}/g, ' ').replace(/\s*,(\s*,)+/g, ','));
    out = out.replace(/\s*[-–—_:;,]+\s*$/, '');

    // "Write 8 line poems ?" is an instruction, not a question - drop the "?".
    if (ctx.fixImperativeMarks && /\?+\s*$/.test(out) && PF.rules.isImperative(out)) {
      out = out.replace(/\?+\s*$/, '');
      ctx.fixes.push({ rule: 'instruction punctuation', before: PF.text.collapseSpaces(text), after: out + ':' });
    }
    // A full stop at the end of an instruction is doing the job the colon is
    // about to do, so it gives way to it: "Choose the correct option." becomes
    // "Choose the correct option:", never "option.:". An abbreviation keeps its
    // dot - the inner dot between two letters is what tells the two apart.
    if (/\.\s*$/.test(out) && !/[A-Za-z]\.[A-Za-z]/.test(out)) out = out.replace(/\s*\.\s*$/, '');

    /*
     * A colon is the English convention for an instruction followed by the
     * thing it instructs. Hindi has its own - the danda - so a Devanagari
     * heading keeps the stop it was typed with and is given none it was not.
     * "व्याख्या कीजिए ।:" is a colon added to a sentence that had already ended.
     */
    if (PF.text.hasDevanagari(out)) return out;
    if (!/[?:।॥|]$/.test(out)) out += ':';
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
          marks = tidyMarks(marksMatch[1]);
          rest = rest.slice(0, marksMatch.index);
        }
        current = { number: match[1] || match[2], heading: rest, marks: marks, bodyLines: [] };
        rawQuestions.push(current);
        return;
      }
      if (current) current.bodyLines.push(line);
    });

    // Putting a broken heading back together comes first: the marks sit at the
    // end of the instruction, so the heading has to be whole before they are
    // looked for, and finding them is what tells the heading it is complete.
    rawQuestions.forEach(function (raw) { foldHeadingContinuation(raw, ctx); });
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

    // Anywhere in the question, not only on the line below the heading: in a
    // question that quotes four lines of verse, the marks were typed at the
    // end of the third of them.
    for (var i = 0; i < raw.bodyLines.length; i++) {
      var line = raw.bodyLines[i];
      var match = PF.normalize.clean(line).match(MARKS_RE);
      if (!match) continue;

      raw.marks = tidyMarks(match[1]);
      raw.bodyLines[i] = line.replace(MARKS_RE, '').trim(); // the same pattern, not a copy
      if (!raw.bodyLines[i]) raw.bodyLines.splice(i, 1);
      return;
    }
  }

  PF.parser = {
    parse: parse,
    parseHeaderLine: parseHeaderLine,
    parseOptions: parseOptions,
    splitInlineItems: splitInlineItems,
    stripLabel: stripLabel
  };
})(window.PF = window.PF || {});
