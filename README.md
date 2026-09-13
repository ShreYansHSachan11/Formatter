# Exam Paper Formatter

Turns a roughly-typed question paper into a clean, consistent, two-page A4 Word
document. Built for S.S. Academy Koirauna Bhadohi half-yearly papers, in Hindi
and English.

Everything runs on your own computer. No file is uploaded anywhere, and there is
nothing to install.

## How to use it

1. Double-click **index.html** (it opens in Chrome/Edge — no internet needed).
2. Drop in a `.docx` or `.txt` file, or paste the paper as text.
3. Check the subject/class boxes on the left, and tick any wording suggestions.
4. Click **Download Word file**, or **Copy text** to paste into your own document.

The preview on the right is a true-to-size A4 page, so what you see is what the
Word file will look like.

## What it does to the paper

| Rule | How it is applied |
| --- | --- |
| One font size | 12 pt everywhere, including the header (changeable in *Layout*). |
| Consistent header | Four centred lines: school, examination, subject, then Time / Class / M.M. spread across the width, with a rule underneath. Only subject and class change between papers. |
| Bold questions | The question line is bold; everything inside it is normal weight. |
| No blank lines | Questions are separated by a small typographic gap (2–7 pt) instead of empty lines. Tick **No gap between questions** for none at all. |
| Two pages | The paper is measured and the spacing is tightened automatically until it fits. If even the tightest setting needs three pages, you are told rather than silently given a third page. |
| Options in a row | Tick-box options are laid out horizontally on one line at equal tab stops. If they are too wide for one line, they wrap to evenly spaced rows. |
| Short answers in a row | One-word items (word meanings, opposites, plurals, spellings, word pairs) are packed several per line instead of one line each. How many fit is measured from the widest item, so bare words sit five across and items with a blank to fill sit two or three across. |
| Match the following | Two columns at a fixed tab stop, at least a third of the page wide, so they never look cramped. A question only becomes a match when it really is one — see below. |
| Language fixes | Mechanical fixes are applied automatically; anything that could change meaning is offered as a tick-box suggestion. |

## Item numbering

Word can number a list in two ways, and only one of them is visible in the text:

- **typed by hand** — "1." is really there in the document; or
- **automatic numbering** — the numbers live in `numbering.xml` and Word draws
  them. Read the text alone and every item number silently disappears.

Both are handled, in two layers. The reader resolves automatic numbering and
keeps its format, so a lettered list stays lettered (a, b, c) and a numbered one
stays numbered. On top of that the numbering of every group is completed: if no
item has a label they are numbered 1…n, and if only some do, the gaps are filled
from their neighbours — given "", "2." the first item is plainly "1.", and given
"", "(b)" the first option is "(a)". Existing labels are never overwritten.

The labels that are present must agree on one sequence before any gap is filled.
That guard separates a missing number from a wrapped line: in "1.", "", "2." the
blank is the continuation of item 1, not a missing item, so nothing is inserted.

## The paper is restyled, never rewritten

Papers are often typed with extra spaces between words, so gaps cannot be taken
at face value. Reading a gap as a column separator is the most destructive thing
the parser can do — it once turned "Uncle John lived in a city ( )" into a
two-column row, "Uncle | John lived in a city", and dropped four items from a
"Fill in the blanks" question.

So a line is only split into two columns when the evidence is strong:

- a line holding a **blank** (`_____`) or a **tick box** (`( )`, `[ ]`) is an
  answer line and is never split, whatever the spacing;
- if the heading says **"match the following"** (or *मिलान*), splitting is
  allowed;
- otherwise **every** item in the question must split into two halves that read
  like a matching pair — both short, neither ending in a full stop or question
  mark. One ordinary sentence among them and the whole question stays prose.

`tests/check-integrity.js` enforces this, plus the rule that no word may be lost
and no control character may reach the Word file.

## Language fixes

Two tiers, deliberately kept apart:

**Applied automatically** — formatting and typography only, and they never
delete or substitute a word (listed under *Show what was cleaned up
automatically*): spacing around punctuation, `a`/`an`, blanks of a consistent
length, tick boxes normalised to `( )`, year ranges like `2026 -27`, question
numbering, `?` removed from instructions that are commands ("Write 8 line
poems ?" → "Write 8 line poems:"), and names spelled inconsistently in the same
paper (`ella` → `Ella`, but only when both spellings appear).

**Suggested, never automatic** (each with a tick box and a reason):
wording changes such as `felt tried` → `felt tired`, `doctor advice` →
`doctor advises`, `brush is teeth` → `brush his teeth`, `did he had` →
`did he have`, and a word written twice in a row. Only a person can confirm these keep the meaning intact, so
nothing is changed until you tick it. Low-confidence ones start unticked.

To add your own rules, edit `SUGGESTED` in [src/rules-language.js](src/rules-language.js).
Nothing else needs to change.

**Why the line is drawn there.** Prose rules assume prose, and a paper for young
classes often is not: a word may be spaced out letter by letter, `C h a i r`.
Two rules that read perfectly well on sentences quietly damaged those words —
`a` before a vowel turned `C h a i r` into `C h an i r`, and doubled-word
removal turned `B o o k` into `B o k`. So an automatic fix now never deletes or
substitutes a word: the article rule requires a following word of at least two
letters, and removing a repeated word became a suggestion you tick.
`tests/fixtures/letter-spaced.txt` keeps that honest.

## How it fits two pages

Word cannot be asked how tall a paragraph will be, so the text is measured from
per-character widths and flowed into pages. The paper is then composed at
progressively tighter settings — margins, line spacing and question gaps — and
the first one that fits is used:

    roomy → normal → tight → tighter → compact → ultra compact

The estimate is slightly pessimistic on purpose: a paper that spills onto a
third page is a worse failure than one that comes out a little tighter than it
needed to be.

## Project layout

    index.html              the whole interface
    assets/styles.css
    src/
      text-utils.js         script detection and width estimation
      rules-language.js     word lists and language rules (edit this one)
      normalize.js          mechanical clean-up and suggestions
      parser.js             lines -> Paper model (mcq / match / inline / list)
      compose.js            Paper + density -> layout blocks
      layout.js             measurement, pagination, density selection
      render-docx.js        blocks -> .docx
      render-text.js        blocks -> plain text for the clipboard
      render-preview.js     blocks -> on-screen A4 pages
      read-docx.js          .docx -> lines (reads the XML directly)
      samples.js            the two reference papers
      app.js                UI wiring
    vendor/                 docx.js and JSZip, bundled so it works offline
    tests/                  see below

The pipeline is one direction, with a single intermediate representation:

    raw text → normalize → parse → compose(density) → blocks → docx / text / preview

`blocks` is shared by the Word writer, the text writer, the preview and the
page-fitting engine, so all four always agree.

## Tests

    npm install                     # once - a Node XML parser, for the tests only
    npm test                        # integrity, header, ui and numbering

or individually:

    node tests/check-integrity.js   # nothing lost, nothing split, nothing corrupted
    node tests/check-header.js      # the four header lines, however they were typed
    node tests/check-numbering.js   # Word's automatic numbering survives
    node tests/check-ui.js          # ids, assets and modules all line up
    node tests/run-pipeline.js      # parse + fit a sample, print the structure
    node tests/run-pipeline.js hindi
    node tests/run-pipeline.js tests/fixtures/loose-spacing.txt
    node tests/build-docx.js        # write real .docx files to out/ and check the XML
    node tests/build-docx.js tests/fixtures/loose-spacing.txt

`tests/fixtures/loose-spacing.txt` is a paper typed with double spaces
everywhere — the case that used to break the parser. Keep it in the suite.

`tests/build-docx.js` leaves `out/english.docx` and `out/hindi.docx` behind —
open them in Word to see the result.

## Limitations

- **`.doc`** (the old format) is not supported — open it in Word and save as
  `.docx` first.
- The Hindi font defaults to **Nirmala UI**, which ships with Windows. If you
  pick a font that is not installed, Word will substitute another one.
- Page fitting is an estimate, not a Word rendering. It is deliberately
  cautious, but check the last page before printing a large batch.
- A question must start with `Que 1`, `Q.1`, `Question 1` or `प्रश्न 1` to be
  recognised. If nothing is detected, the app says so.
