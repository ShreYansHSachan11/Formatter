/*
 * app.js - wires the UI to the formatting pipeline.
 *
 *   raw text -> normalize -> parse -> fit(density) -> preview / .docx / clipboard
 *
 * Everything runs in the browser; no file ever leaves the computer.
 */
(function (PF) {
  'use strict';

  var state = {
    raw: '',
    paper: null,
    result: null,
    suggestions: [],
    accepted: {},      // suggestion id -> boolean
    headerEdits: {},   // field -> value typed by the user
    edits: {},         // block key -> line retyped in the preview
    inserts: {},       // block key -> lines added after it
    editing: false,
    autoFixes: []
  };

  // Header lines are edited in the preview like any other line, but they are
  // not stored as overrides: they are put back into the boxes on the left, so
  // the two never end up showing different things.
  var HEADER_FIELDS = {
    'h.school': 'school', 'h.exam': 'exam', 'h.subject': 'subject',
    'h.time': 'time', 'h.class': 'className', 'h.marks': 'maxMarks'
  };
  var HEADER_INPUTS = {
    school: 'hdrSchool', exam: 'hdrExam', subject: 'hdrSubject',
    time: 'hdrTime', className: 'hdrClass', maxMarks: 'hdrMarks'
  };
  var HEADER_LABELS = { subject: 'subject', time: 'time', className: 'class', maxMarks: 'marks' };
  // The fields that are written with a label in front of them, and so can be
  // told apart by it. The school and the examination are lines, not fields.
  var LABELLED_FIELDS = ['subject', 'time', 'className', 'maxMarks'];

  var el = {};

  function $(id) { return document.getElementById(id); }

  function init() {
    [
      'statusLine', 'copyBtn', 'downloadBtn', 'dropZone', 'browseBtn', 'fileInput',
      'pasteArea', 'pasteBtn', 'preview', 'previewScale', 'previewNote', 'emptyState',
      'suggestions', 'autoFixSummary', 'autoFixDetails', 'autoFixList', 'toast',
      'editToggle', 'editStatus', 'resetEdits',
      'optPages', 'optDensity', 'optLatinFont', 'optHindiFont', 'optFontSize', 'optPrefix', 'optNoGap',
      'hdrSubject', 'hdrClass', 'hdrTime', 'hdrMarks', 'hdrSchool', 'hdrExam'
    ].forEach(function (id) { el[id] = $(id); });

    fillDensityOptions();
    syncNoGapState();
    bindEvents();
  }

  function fillDensityOptions() {
    PF.compose.DENSITIES.forEach(function (density) {
      var option = document.createElement('option');
      option.value = density.id;
      option.textContent = density.label;
      el.optDensity.appendChild(option);
    });
  }

  /* ----------------------------------------------------------------- input */

  function bindEvents() {
    el.browseBtn.addEventListener('click', function () { el.fileInput.click(); });
    el.fileInput.addEventListener('change', function (event) {
      if (event.target.files && event.target.files[0]) loadFile(event.target.files[0]);
      event.target.value = '';
    });

    ['dragenter', 'dragover'].forEach(function (type) {
      el.dropZone.addEventListener(type, function (event) {
        event.preventDefault();
        el.dropZone.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (type) {
      el.dropZone.addEventListener(type, function (event) {
        event.preventDefault();
        el.dropZone.classList.remove('over');
      });
    });
    el.dropZone.addEventListener('drop', function (event) {
      var file = event.dataTransfer && event.dataTransfer.files[0];
      if (file) loadFile(file);
    });
    document.addEventListener('dragover', function (event) { event.preventDefault(); });
    document.addEventListener('drop', function (event) { event.preventDefault(); });

    el.pasteBtn.addEventListener('click', function () {
      var text = el.pasteArea.value.trim();
      if (!text) return toast('Paste the paper text first');

      // Formatting again starts from the text, so anything corrected in the
      // preview is gone. Say so rather than let it vanish quietly.
      var hadEdits = Object.keys(state.edits).length + Object.keys(state.inserts).length;
      loadText(text, 'pasted text');
      if (hadEdits) toast('Formatted again from the text - the lines edited by hand are gone');
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-sample]'), function (button) {
      button.addEventListener('click', function () {
        loadText(PF.samples[button.getAttribute('data-sample')], 'sample paper');
      });
    });

    ['optPages', 'optDensity', 'optLatinFont', 'optHindiFont', 'optFontSize', 'optPrefix', 'optNoGap']
      .forEach(function (id) { el[id].addEventListener('change', refresh); });
    el.optDensity.addEventListener('change', syncNoGapState);

    [['hdrSubject', 'subject'], ['hdrClass', 'className'], ['hdrTime', 'time'],
      ['hdrMarks', 'maxMarks'], ['hdrSchool', 'school'], ['hdrExam', 'exam']]
      .forEach(function (pair) {
        el[pair[0]].addEventListener('input', function () {
          state.headerEdits[pair[1]] = el[pair[0]].value;
          refresh();
        });
      });

    el.copyBtn.addEventListener('click', copyText);
    el.downloadBtn.addEventListener('click', downloadDocx);
    window.addEventListener('resize', scalePreview);

    el.editToggle.addEventListener('click', function () { setEditing(!state.editing); });
    el.resetEdits.addEventListener('click', clearEdits);
    bindPreviewEditing();
  }

  function loadFile(file) {
    var name = (file.name || '').toLowerCase();
    if (name.slice(-5) === '.docx') {
      file.arrayBuffer()
        .then(PF.readDocx.read)
        .then(function (text) { loadText(text, file.name); })
        .catch(function (error) { toast(error.message || 'Could not read that file'); });
      return;
    }
    if (name.slice(-4) === '.txt' || name.slice(-5) === '.text' || file.type.indexOf('text') === 0) {
      file.text().then(function (text) { loadText(text, file.name); });
      return;
    }
    toast('Please choose a .docx or .txt file (.doc is not supported)');
  }

  function loadText(text, source) {
    state.raw = text || '';
    state.accepted = {};
    state.headerEdits = {};
    state.edits = {};
    state.inserts = {};
    state.sourceName = source || 'paper';

    // The paper as it was read, in the box it can be re-typed in. Editing in
    // the preview corrects the lines of the paper that was found; rewriting it
    // here is how a question is added, split apart or moved - the text goes
    // back through the parser from the beginning.
    el.pasteArea.value = state.raw;

    refresh({ resetHeaderInputs: true });
  }

  /* -------------------------------------------------------------- pipeline */

  function chosenDensity() {
    var id = el.optDensity.value;
    return PF.compose.DENSITIES.filter(function (d) { return d.id === id; })[0] || null;
  }

  /*
   * "Spacious" and "No gap between questions" ask for opposite things. Rather
   * than let one of them silently win, the checkbox is switched off while a
   * spacing chosen for its gap is in force - the spacing was picked by name,
   * the checkbox only ever says "less".
   */
  function syncNoGapState() {
    var density = chosenDensity();
    el.optNoGap.disabled = !!(density && density.gapQuestionLines);
    el.optNoGap.parentNode.classList.toggle('disabled', el.optNoGap.disabled);
  }

  function readOptions() {
    syncNoGapState();
    return {
      fontSizePt: parseInt(el.optFontSize.value, 10) || 12,
      latinFont: el.optLatinFont.value,
      hindiFont: el.optHindiFont.value,
      questionPrefix: el.optPrefix.value,
      maxPages: parseInt(el.optPages.value, 10) || 2,
      densityId: el.optDensity.value,
      noQuestionGap: el.optNoGap.checked && !el.optNoGap.disabled,
      edits: state.edits,
      inserts: state.inserts
    };
  }

  function refresh(flags) {
    flags = flags || {};
    if (!state.raw.trim()) return;

    var options = readOptions();
    var prepared = PF.normalize.prepare(state.raw);
    var properNouns = PF.normalize.buildProperNounMap(prepared.lines);

    state.suggestions = PF.normalize.suggest(prepared.lines);
    state.suggestions.forEach(function (suggestion) {
      if (!(suggestion.id in state.accepted)) {
        state.accepted[suggestion.id] = suggestion.confidence === 'high';
      }
    });

    var accepted = state.suggestions.filter(function (s) { return state.accepted[s.id]; });

    state.paper = PF.parser.parse(prepared.lines, {
      properNouns: properNouns,
      acceptedSuggestions: accepted,
      fontSizePt: options.fontSizePt
    });

    applyHeaderEdits(state.paper.header, flags.resetHeaderInputs);
    state.autoFixes = collectFixes(prepared.fixes, state.paper.fixes);
    state.result = PF.layout.fit(state.paper, options);

    renderSuggestions();
    renderFixes();
    renderPreview(options);
    renderStatus(options);
  }

  /** User edits win over whatever was detected in the source document. */
  function applyHeaderEdits(header, resetInputs) {
    var fields = [['hdrSubject', 'subject'], ['hdrClass', 'className'], ['hdrTime', 'time'],
      ['hdrMarks', 'maxMarks'], ['hdrSchool', 'school'], ['hdrExam', 'exam']];

    fields.forEach(function (pair) {
      var input = el[pair[0]];
      var field = pair[1];
      if (resetInputs) input.value = header[field] || '';
      if (field in state.headerEdits) header[field] = state.headerEdits[field];
      else header[field] = input.value || header[field] || '';
    });
  }

  /**
   * Keeps only fixes a person would care about.
   *
   * Spacing is tidied on every line and every blank is drawn to one length, so
   * listing those buries the handful of changes that are actually about the
   * words - "38 spelling/punctuation fixes" of which two were spelling.
   */
  function collectFixes(cleanupFixes, parserFixes) {
    var meaningful = cleanupFixes.filter(function (fix) {
      return wording(fix.before) !== wording(fix.after);
    });
    return meaningful.concat(parserFixes || []);
  }

  function wording(text) {
    return String(text).replace(/_+/g, '_').replace(/\s/g, '');
  }

  /* ---------------------------------------------------------------- render */

  function renderSuggestions() {
    el.suggestions.innerHTML = '';
    state.suggestions.forEach(function (suggestion) {
      var row = document.createElement('label');
      row.className = 'suggestion';

      var box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!state.accepted[suggestion.id];
      box.addEventListener('change', function () {
        state.accepted[suggestion.id] = box.checked;
        refresh();
      });

      var body = document.createElement('span');
      var del = document.createElement('del');
      del.textContent = suggestion.before;
      var ins = document.createElement('ins');
      ins.textContent = suggestion.after;
      body.appendChild(del);
      body.appendChild(document.createTextNode(' → '));
      body.appendChild(ins);

      if (suggestion.note) {
        var why = document.createElement('span');
        why.className = 'why';
        why.textContent = suggestion.note;
        body.appendChild(why);
      }

      row.appendChild(box);
      row.appendChild(body);
      el.suggestions.appendChild(row);
    });
  }

  function renderFixes() {
    var count = state.autoFixes.length;
    var suggested = state.suggestions.length;

    el.autoFixSummary.textContent = count
      ? count + ' spelling/punctuation fix' + (count === 1 ? '' : 'es') + ' applied automatically.'
        + (suggested ? ' Wording changes below need your approval.' : '')
      : (suggested ? 'Wording changes below need your approval.' : 'No language issues found.');

    el.autoFixDetails.hidden = !count;
    el.autoFixList.innerHTML = '';
    state.autoFixes.slice(0, 60).forEach(function (fix) {
      var item = document.createElement('li');
      item.textContent = fix.before + '  →  ' + fix.after;
      el.autoFixList.appendChild(item);
    });
  }

  function renderPreview(options) {
    el.emptyState.hidden = true;
    el.emptyState.style.display = 'none';
    PF.renderPreview.render(el.preview, state.result, options);
    applyEditing();
    renderEditStatus();
    scalePreview();
  }

  /** Scales the true-size A4 pages down to whatever width the column has. */
  function scalePreview() {
    var pageWidthPx = PF.compose.PAGE.widthIn * PF.renderPreview.PX_PER_IN;
    var available = el.previewScale.parentElement.clientWidth;
    // A width of zero means the column has not been laid out yet (or is
    // hidden). Scaling by zero would make the preview vanish, so full size is
    // the safe assumption until a resize brings a real measurement.
    var scale = available > 0 ? Math.min(1, available / pageWidthPx) : 1;
    el.previewScale.style.transform = 'scale(' + scale + ')';
    el.previewScale.style.height = (el.preview.scrollHeight * scale) + 'px';
    el.previewScale.style.width = pageWidthPx + 'px';
  }

  /* ------------------------------------------------------ editing by hand
   *
   * However good the rules are, one line in a paper will always need a human
   * to fix it. Rather than send the user to Word for that, every line in the
   * preview can be corrected in place.
   *
   * What they type is stored against the key of the block it came from, not
   * against a position on the page, and it is fed back into compose() - so the
   * columns are packed around the new words, the page count is measured from
   * them, and the Word file, the clipboard text and the preview cannot drift
   * apart.
   *
   * It behaves as a document, not as a row of boxes: Enter splits a line in
   * two, Backspace at the start of one joins it to the line above, an emptied
   * line disappears, and the arrow keys walk from line to line. Enter inside a
   * row of options adds another option; Shift+Enter adds a whole new line
   * after the row.
   */

  var INSERT_SEP = '~';
  var suppressCommit = false;  // set while the page is being rebuilt under us
  var pendingFocus = null;     // { key, caret } - where to put the cursor after

  function bindPreviewEditing() {
    el.preview.addEventListener('focusin', function (event) {
      var node = editableTarget(event.target);
      if (node) node.setAttribute('data-edit-before', node.textContent);
    });

    el.preview.addEventListener('focusout', function (event) {
      var node = editableTarget(event.target);
      if (!node) return;

      // Committing rebuilds the page, which throws away the line the user has
      // just clicked into. Where they were heading is known here, so the
      // cursor is put back there afterwards - otherwise every move from one
      // line to the next would need a second click.
      var next = editableTarget(event.relatedTarget);
      if (next) pendingFocus = { key: next.getAttribute('data-edit-key'), caret: caretOffset(next) };

      // Nothing was rebuilt, so the focus the browser has just moved is the
      // right one and must be left where it is.
      if (!commitEdit(node)) pendingFocus = null;
    });

    el.preview.addEventListener('keydown', onEditKey);

    // Pasting from Word carries fonts, colours and sometimes whole tables.
    // Only the words are wanted - and several pasted lines stay several lines.
    el.preview.addEventListener('paste', function (event) {
      var node = editableTarget(event.target);
      if (!node || !event.clipboardData) return;
      event.preventDefault();

      var lines = String(event.clipboardData.getData('text/plain') || '')
        .split(/\r?\n/).map(PF.normalize.clean).filter(function (line) { return line !== ''; });
      if (!lines.length) return;

      insertText(node, lines[0]);
      if (lines.length > 1) addLines(node.getAttribute('data-edit-key'), lines.slice(1), node);
    });
  }

  function onEditKey(event) {
    var node = editableTarget(event.target);
    if (!node) return;
    var key = node.getAttribute('data-edit-key');

    if (event.key === 'Enter') {
      event.preventDefault();
      // Splitting only works where a line can actually be inserted: a line of
      // its own, or an option in a row of them. The marks in the margin, a
      // header field and a column of a match cannot hold one, so there Enter
      // starts a new line after the whole row instead.
      if (!event.shiftKey && canHostInsert(node)) splitLine(node, key);
      else addLines(blockKeyOf(node), [''], node);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      node.textContent = node.getAttribute('data-edit-before') || '';
      node.blur();
      return;
    }

    if (event.key === 'Backspace' && caretOffset(node) === 0 && !hasSelection()) {
      var previous = lineNeighbour(node, -1);
      if (!previous) return;                  // the first line has nothing to join
      event.preventDefault();
      join(previous, node);
      return;
    }

    if (event.key === 'Delete' && caretOffset(node) === node.textContent.length && !hasSelection()) {
      var following = lineNeighbour(node, 1);
      if (!following) return;
      event.preventDefault();
      join(node, following);
      return;
    }

    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      var at = caretOffset(node);
      var up = event.key === 'ArrowUp';
      // A long line wraps, and the browser walks the cursor through its visual
      // rows. Only at the ends of the text does the cursor need to leave.
      if (at !== null && (up ? at > 0 : at < node.textContent.length)) return;

      var target = neighbour(node, up ? -1 : 1);
      if (!target) return;
      event.preventDefault();
      pendingFocus = { key: target.getAttribute('data-edit-key'), caret: up ? target.textContent.length : 0 };
      // Committing may rebuild the page and land the cursor itself; if it had
      // nothing to save, the move still has to happen.
      if (!commitEdit(node)) applyPendingFocus();
    }
  }

  /** Enter: what is left of the cursor stays, what is right becomes a new line. */
  function splitLine(node, key) {
    var text = PF.normalize.clean(node.textContent);
    var at = caretOffset(node);
    var head = at === null ? text : PF.normalize.clean(text.slice(0, at));
    var tail = at === null ? '' : PF.normalize.clean(text.slice(at));

    setText(key, head, true);
    addLines(key, [tail], null);
  }

  /** True where the key belongs to a whole line, or to one option of a row. */
  function canHostInsert(node) {
    var key = node.getAttribute('data-edit-key');
    if (key && key === blockKeyOf(node)) return true;
    var owner = node.parentNode;
    return !!(owner && owner.getAttribute && owner.getAttribute('data-cell-inserts'));
  }

  /**
   * Backspace at the start of a line, or Delete at the end of one: the two
   * lines become one, the same gesture as in any editor.
   */
  function join(first, second) {
    var firstKey = first.getAttribute('data-edit-key');
    var tail = PF.normalize.clean(second.textContent);
    var joined = PF.normalize.clean(first.textContent + (tail ? ' ' + tail : ''));

    removeLine(second.getAttribute('data-edit-key'));
    setText(firstKey, joined);
    pendingFocus = { key: firstKey, caret: first.textContent.length };
    rebuild();
  }

  /**
   * Adds lines (or options, inside a row) after `anchorKey`, keeping whatever
   * the user had already typed into the line they are standing on - the page
   * is about to be rebuilt, and the blur that would have saved it is suppressed.
   */
  function addLines(anchorKey, texts, node) {
    if (!anchorKey) return;
    if (node) setText(node.getAttribute('data-edit-key'), PF.normalize.clean(node.textContent), true);

    var key = anchorKey;
    texts.forEach(function (text) { key = insertAfter(key, text); });

    pendingFocus = { key: key, caret: 0 };
    rebuild();
  }

  function rebuild() {
    // The text has already been taken from every line on the page. Browsers
    // deliver the blur of a line that is being replaced after the fact, and
    // without this the stale text it still holds would be committed over the
    // change that replaced it - undoing a split the moment it happened.
    editableNodes().forEach(function (node) {
      node.setAttribute('data-edit-before', node.textContent);
    });

    if (pendingFocus) pendingFocus.key = pruneEmptyInserts(pendingFocus.key);
    else pruneEmptyInserts(null);

    suppressCommit = true;
    refresh();
    suppressCommit = false;
    applyPendingFocus();
  }

  /**
   * Drops added lines that were left empty - all but the one about to be typed
   * into. An empty line is what "I have changed my mind" looks like, and it
   * must not travel into the Word file as a blank paragraph.
   */
  function pruneEmptyInserts(keepKey) {
    var moved = keepKey;

    Object.keys(state.inserts).forEach(function (anchor) {
      var kept = [];
      state.inserts[anchor].forEach(function (text, index) {
        var key = anchor + INSERT_SEP + index;
        if (!text && key !== keepKey) return;
        if (key === keepKey) moved = anchor + INSERT_SEP + kept.length;
        kept.push(text);
      });
      if (kept.length) state.inserts[anchor] = kept;
      else delete state.inserts[anchor];
    });

    return moved;
  }

  /** Saves what is in a line. True when that rebuilt the page. */
  function commitEdit(node) {
    if (suppressCommit) return false;
    var key = node.getAttribute('data-edit-key');
    var text = PF.normalize.clean(node.textContent);

    // A line that was added and then left empty was a change of mind, not a
    // blank line: it goes away rather than being carried into the document.
    if (!text && splitKey(key).index >= 0) {
      removeLine(key);
      rebuild();
      return true;
    }

    if (text === PF.normalize.clean(node.getAttribute('data-edit-before') || '')) return false;

    setText(key, text);
    rebuild();
    return true;
  }

  /* --- where a line's text lives ---------------------------------------- */

  /** A composed line, or the nth line inserted after one. */
  function splitKey(key) {
    var at = String(key || '').lastIndexOf(INSERT_SEP);
    if (at < 0) return { anchor: key, index: -1 };
    return { anchor: key.slice(0, at), index: parseInt(key.slice(at + 1), 10) };
  }

  function setText(key, text, quiet) {
    var parts = splitKey(key);

    if (parts.index >= 0) {
      var list = state.inserts[parts.anchor];
      if (list) list[parts.index] = text;
    } else if (HEADER_FIELDS[key]) {
      applyHeaderLineEdit(HEADER_FIELDS[key], text);
    } else {
      state.edits[key] = text;
    }
    if (!quiet) renderEditStatus();
  }

  function insertAfter(key, text) {
    var parts = splitKey(key);
    var list = state.inserts[parts.anchor] || (state.inserts[parts.anchor] = []);
    var at = parts.index >= 0 ? parts.index + 1 : 0;
    list.splice(at, 0, text || '');
    return parts.anchor + INSERT_SEP + at;
  }

  function removeLine(key) {
    var parts = splitKey(key);
    if (parts.index < 0) return setText(key, '');

    var list = state.inserts[parts.anchor];
    if (!list) return;
    list.splice(parts.index, 1);
    if (!list.length) delete state.inserts[parts.anchor];
  }

  /* --- moving about ------------------------------------------------------ */

  function editableNodes() {
    return Array.prototype.slice.call(el.preview.querySelectorAll('[data-edit-key]'));
  }

  /** The editable line an event landed in, or null if it landed elsewhere. */
  function editableTarget(node) {
    while (node && node !== el.preview) {
      if (node.getAttribute && node.getAttribute('data-edit-key')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function neighbour(node, step) {
    var nodes = editableNodes();
    return nodes[nodes.indexOf(node) + step] || null;
  }

  /**
   * The next line in reading order, skipping the marks in the margin.
   *
   * The marks sit after the question in the page but beside it on the line, so
   * joining a line to "the one above" must not pour its words into "(5)".
   */
  function lineNeighbour(node, step) {
    var next = neighbour(node, step);
    while (next && next.classList.contains('pv-right')) next = neighbour(next, step);
    return next;
  }

  function blockKeyOf(node) {
    while (node && node !== el.preview) {
      if (node.getAttribute && node.getAttribute('data-block-key')) return node.getAttribute('data-block-key');
      node = node.parentNode;
    }
    return null;
  }

  /** How far into the line the cursor is, or null where there is no selection. */
  function caretOffset(node) {
    try {
      var selection = window.getSelection();
      if (!selection || !selection.rangeCount || !node.contains(selection.anchorNode)) return null;
      var range = selection.getRangeAt(0).cloneRange();
      var measure = document.createRange();
      measure.selectNodeContents(node);
      measure.setEnd(range.endContainer, range.endOffset);
      return measure.toString().length;
    } catch (error) {
      return null;
    }
  }

  function hasSelection() {
    try {
      var selection = window.getSelection();
      return !!selection && !selection.isCollapsed;
    } catch (error) {
      return false;
    }
  }

  function applyPendingFocus() {
    var target = pendingFocus;
    pendingFocus = null;
    if (!target || !target.key) return;

    var node = el.preview.querySelector('[data-edit-key="' + target.key + '"]');
    if (!node) return;
    node.focus();
    placeCaret(node, target.caret);
  }

  function placeCaret(node, offset) {
    try {
      var selection = window.getSelection();
      if (!selection) return;
      var range = document.createRange();
      if (node.firstChild) {
        var max = node.firstChild.textContent.length;
        range.setStart(node.firstChild, Math.min(offset === null || offset === undefined ? max : offset, max));
      } else {
        range.selectNodeContents(node);
      }
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (error) {
      /* a browser without a selection API still gets the focus, just not the spot */
    }
  }

  function insertText(node, text) {
    try {
      document.execCommand('insertText', false, text);
    } catch (error) {
      node.textContent = node.textContent + text;
    }
  }

  /** A header line edited in the preview goes back into its box on the left. */
  function applyHeaderLineEdit(field, text) {
    /*
     * Time, class and marks share the fourth line, and a person correcting it
     * types the line, not the cell: they select it and write "Time: 2 hrs
     * Class: 8th M.M. 50". That used to leave whichever cell they typed into
     * holding all three and the other two empty, so the line collapsed into a
     * single field. The labels in what was typed decide which field is which -
     * and a field whose label was typed away is a field that was removed.
     */
    var parsed = LABELLED_FIELDS.indexOf(field) >= 0 ? PF.parser.parseHeaderLine(text) : {};
    var found = Object.keys(parsed).filter(function (name) { return parsed[name]; });

    if (found.length) {
      found.forEach(function (name) { setHeaderField(name, parsed[name]); });
      if (found.indexOf(field) < 0) setHeaderField(field, '');
      return;
    }

    var labelName = HEADER_LABELS[field];
    var value = text;

    if (labelName && state.paper) {
      var label = PF.compose.labelFor(labelName, state.paper.header).trim();
      if (value.indexOf(label) === 0) value = value.slice(label.length).replace(/^[\s:.–-]+/, '');
    }

    setHeaderField(field, value);
  }

  function setHeaderField(field, value) {
    state.headerEdits[field] = value;
    var input = el[HEADER_INPUTS[field]];
    if (input) input.value = value;
  }

  function setEditing(on) {
    state.editing = !!on;
    el.editToggle.textContent = state.editing ? 'Done editing' : 'Edit the paper';
    el.editToggle.setAttribute('aria-pressed', state.editing ? 'true' : 'false');
    el.editToggle.classList.toggle('btn-primary', state.editing);
    el.editToggle.classList.toggle('btn-soft', !state.editing);
    applyEditing();
    renderEditStatus();
  }

  function applyEditing() {
    el.preview.classList.toggle('editing', state.editing);
    Array.prototype.forEach.call(el.preview.querySelectorAll('[data-edit-key]'), function (node) {
      setEditableFlag(node, state.editing);
      node.spellcheck = false;
      var key = node.getAttribute('data-edit-key');
      node.classList.toggle('edited',
        Object.prototype.hasOwnProperty.call(state.edits, key) || key.indexOf(INSERT_SEP) >= 0);
    });
  }

  /*
   * "plaintext-only" keeps pasted formatting out of the line, but not every
   * browser accepts it - Firefox rejects the value outright - so plain
   * editing is the fallback, with the paste handler cleaning up after it.
   */
  function setEditableFlag(node, on) {
    if (!on) {
      node.contentEditable = 'false';
      node.removeAttribute('tabindex');
      return;
    }
    // In the tab order while editing, so Tab walks from line to line.
    node.setAttribute('tabindex', '0');
    try {
      node.contentEditable = 'plaintext-only';
    } catch (error) {
      node.contentEditable = 'true';
    }
    if (node.contentEditable !== 'plaintext-only') node.contentEditable = 'true';
  }

  function renderEditStatus() {
    var count = Object.keys(state.edits).length
      + Object.keys(state.inserts).reduce(function (sum, key) {
        return sum + state.inserts[key].length;
      }, 0);

    el.resetEdits.hidden = count === 0;
    el.editStatus.textContent = state.editing
      ? 'Type anywhere. Enter splits a line (or adds an option), Backspace at the start joins it to the one above, Esc undoes the line.'
      : (count ? count + (count === 1 ? ' line' : ' lines') + ' changed by hand' : '');
  }

  function clearEdits() {
    state.edits = {};
    state.inserts = {};
    refresh();
    toast('Manual edits undone');
  }

  function renderStatus(options) {
    var result = state.result;
    var pages = result.pageCount;
    var limit = options.maxPages;
    var questions = state.paper.questions.length;

    el.statusLine.textContent = questions + ' question' + (questions === 1 ? '' : 's')
      + ' · ' + pages + ' page' + (pages === 1 ? '' : 's')
      + ' · spacing: ' + result.density.label
      + (result.auto ? ' (auto)' : '');
    el.statusLine.className = 'status ' + (result.overflow ? 'warn' : 'ok');

    el.previewNote.classList.add('show');
    if (!questions) {
      el.previewNote.classList.add('warn');
      el.previewNote.textContent = 'No questions were found. Each question should start with '
        + '"Que 1", "Q.1" or "प्रश्न 1" - check the source document.';
      el.statusLine.textContent = 'No questions found';
      el.statusLine.className = 'status warn';
    } else if (result.overflow) {
      // Whose fault the extra page is depends on who chose the spacing. Telling
      // someone who asked for a two-line gap that the paper is "at the tightest
      // spacing" sends them off to shorten a question they need not touch.
      el.previewNote.classList.add('warn');
      el.previewNote.textContent = result.auto
        ? 'This paper still needs ' + pages + ' pages at the tightest spacing. '
          + 'Shorten a question, or allow ' + pages + ' pages.'
        : 'This paper needs ' + pages + ' pages at "' + result.density.label + '" spacing. '
          + 'Choose Auto to fit it into ' + limit + ', or allow ' + pages + ' pages.';
    } else if (limit < 99) {
      el.previewNote.classList.remove('warn');
      el.previewNote.textContent = 'Fits in ' + pages + ' page' + (pages === 1 ? '' : 's')
        + ' of A4 at ' + options.fontSizePt + ' pt'
        + (result.auto ? ', using "' + result.density.label + '" spacing chosen automatically.' : '.');
    } else {
      el.previewNote.classList.remove('warn');
      el.previewNote.textContent = pages + ' page' + (pages === 1 ? '' : 's') + ' of A4 at ' + options.fontSizePt + ' pt.';
    }

    el.copyBtn.disabled = false;
    el.downloadBtn.disabled = false;
    el.editToggle.disabled = !questions;
    // Nothing to correct means nothing to be in editing mode for.
    if (!questions && state.editing) setEditing(false);
  }

  /* ---------------------------------------------------------------- output */

  function fileName() {
    var header = state.paper.header;
    var parts = [header.subject, header.className].filter(Boolean).join(' - ');
    var base = (parts || 'question paper').replace(/[\\/:*?"<>|]+/g, '').trim();
    return base + ' (formatted).docx';
  }

  function downloadDocx() {
    try {
      PF.renderDocx.toBlob(state.result, readOptions()).then(function (blob) {
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = fileName();
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
        toast('Word file downloaded');
      }).catch(function (error) {
        toast('Could not create the Word file: ' + error.message);
      });
    } catch (error) {
      toast('Could not create the Word file: ' + error.message);
    }
  }

  function copyText() {
    var text = PF.renderText.render(state.result);
    var done = function () { toast('Copied - paste into Word with Ctrl+V'); };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text, done); });
    } else {
      fallbackCopy(text, done);
    }
  }

  function fallbackCopy(text, done) {
    var area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
      done();
    } catch (error) {
      toast('Copy failed - select the text manually');
    }
    document.body.removeChild(area);
  }

  var toastTimer = null;

  function toast(message) {
    el.toast.textContent = message;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2600);
  }

  // Waiting for DOMContentLoaded only works if this script runs before it
  // fires. If the page is already parsed - a deferred or late-injected script,
  // a saved copy of the page - the event has been and gone, and waiting for it
  // would leave the interface dead.
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window.PF = window.PF || {});
