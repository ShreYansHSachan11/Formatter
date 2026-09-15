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
      loadText(text, 'pasted text');
    });

    Array.prototype.forEach.call(document.querySelectorAll('[data-sample]'), function (button) {
      button.addEventListener('click', function () {
        loadText(PF.samples[button.getAttribute('data-sample')], 'sample paper');
      });
    });

    ['optPages', 'optDensity', 'optLatinFont', 'optHindiFont', 'optFontSize', 'optPrefix', 'optNoGap']
      .forEach(function (id) { el[id].addEventListener('change', refresh); });

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
    state.sourceName = source || 'paper';
    refresh({ resetHeaderInputs: true });
  }

  /* -------------------------------------------------------------- pipeline */

  function readOptions() {
    return {
      fontSizePt: parseInt(el.optFontSize.value, 10) || 12,
      latinFont: el.optLatinFont.value,
      hindiFont: el.optHindiFont.value,
      questionPrefix: el.optPrefix.value,
      maxPages: parseInt(el.optPages.value, 10) || 2,
      densityId: el.optDensity.value,
      noQuestionGap: el.optNoGap.checked,
      edits: state.edits
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

  /** Keeps only fixes a person would care about; pure whitespace tidying is noise. */
  function collectFixes(cleanupFixes, parserFixes) {
    var meaningful = cleanupFixes.filter(function (fix) {
      return fix.before.replace(/\s/g, '') !== fix.after.replace(/\s/g, '');
    });
    return meaningful.concat(parserFixes || []);
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
   * apart. Emptying a line deletes it.
   */

  function bindPreviewEditing() {
    el.preview.addEventListener('focusin', function (event) {
      var node = editableTarget(event.target);
      if (node) node.setAttribute('data-edit-before', node.textContent);
    });

    el.preview.addEventListener('focusout', function (event) {
      var node = editableTarget(event.target);
      if (node) commitEdit(node);
    });

    el.preview.addEventListener('keydown', function (event) {
      var node = editableTarget(event.target);
      if (!node) return;
      if (event.key === 'Enter') {
        event.preventDefault(); // one block is one line; Enter means "done"
        node.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        node.textContent = node.getAttribute('data-edit-before') || '';
        node.blur();
      }
    });

    // Pasting from Word carries fonts, colours and sometimes whole tables.
    // Only the words are wanted.
    el.preview.addEventListener('paste', function (event) {
      var node = editableTarget(event.target);
      if (!node || !event.clipboardData) return;
      event.preventDefault();
      var text = PF.normalize.clean(event.clipboardData.getData('text/plain'));
      try {
        document.execCommand('insertText', false, text);
      } catch (error) {
        node.textContent = node.textContent + text; // older browsers
      }
    });
  }

  function editableTarget(node) {
    while (node && node !== el.preview) {
      if (node.getAttribute && node.getAttribute('data-edit-key')) return node;
      node = node.parentNode;
    }
    return null;
  }

  function commitEdit(node) {
    var key = node.getAttribute('data-edit-key');
    var text = PF.normalize.clean(node.textContent);
    if (text === PF.normalize.clean(node.getAttribute('data-edit-before') || '')) return;

    if (HEADER_FIELDS[key]) applyHeaderLineEdit(HEADER_FIELDS[key], text);
    else state.edits[key] = text;

    refresh();
  }

  /** A header line edited in the preview goes back into its box on the left. */
  function applyHeaderLineEdit(field, text) {
    var labelName = HEADER_LABELS[field];
    var value = text;

    if (labelName && state.paper) {
      var label = PF.compose.labelFor(labelName, state.paper.header).trim();
      if (value.indexOf(label) === 0) value = value.slice(label.length).replace(/^[\s:.–-]+/, '');
    }

    state.headerEdits[field] = value;
    var input = el[HEADER_INPUTS[field]];
    if (input) input.value = value;
  }

  function setEditing(on) {
    state.editing = !!on;
    el.editToggle.textContent = state.editing ? 'Done editing' : 'Edit the paper';
    el.editToggle.setAttribute('aria-pressed', state.editing ? 'true' : 'false');
    el.editToggle.classList.toggle('btn-primary', state.editing);
    applyEditing();
    renderEditStatus();
  }

  function applyEditing() {
    el.preview.classList.toggle('editing', state.editing);
    Array.prototype.forEach.call(el.preview.querySelectorAll('[data-edit-key]'), function (node) {
      setEditableFlag(node, state.editing);
      node.spellcheck = false;
      node.classList.toggle('edited',
        Object.prototype.hasOwnProperty.call(state.edits, node.getAttribute('data-edit-key')));
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
      return;
    }
    try {
      node.contentEditable = 'plaintext-only';
    } catch (error) {
      node.contentEditable = 'true';
    }
    if (node.contentEditable !== 'plaintext-only') node.contentEditable = 'true';
  }

  function renderEditStatus() {
    var count = Object.keys(state.edits).length;
    el.resetEdits.hidden = count === 0;
    el.editStatus.textContent = state.editing
      ? 'Click any line to correct it. Enter keeps the change, Esc cancels, an empty line is deleted.'
      : (count ? count + (count === 1 ? ' line' : ' lines') + ' edited by hand' : '');
  }

  function clearEdits() {
    state.edits = {};
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
      el.previewNote.classList.add('warn');
      el.previewNote.textContent = 'This paper still needs ' + pages + ' pages at the tightest spacing. '
        + 'Shorten a question, or allow ' + pages + ' pages.';
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
