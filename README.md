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
4. Correct anything that still needs a human eye: **Edit the paper**, then click
   the line and retype it.
5. Click **Download Word file**, or **Copy text** to paste into your own document.

The preview on the right is a true-to-size A4 page, so what you see is what the
Word file will look like.

## Correcting a line by hand

However good the rules are, one line in a paper will always need a person to
fix it. **Edit the paper** turns the preview into a document you can type in:
click any line — a question, an option, a column of a match, a header field —
and correct it.

| Key | What it does |
| --- | --- |
| Enter | splits the line at the cursor, or — inside a row of options — adds another option |
| Shift+Enter | starts a new line under the whole row |
| Backspace at the start of a line | joins it to the line above |
| Esc | puts the line back as it was |
| Tab / ↑ ↓ | move to the next line |

Emptying a line deletes it, Delete at the end of one pulls the line below up
into it, and a line you add and then leave empty goes away by itself. **Undo
all edits** puts the whole paper back.

Editing in the preview corrects the paper that was read. To change its
structure — add a question, split one in two, move one — rewrite the text
itself: the paper is left in **Paste or rewrite the paper as text** on the
left, and formatting it again runs the whole thing through the parser from the
beginning. That also clears the lines corrected in the preview, and says so
when it does.

What you type is not pasted over the finished page. It is stored against the
line it belongs to and fed back through the formatter, so the options are
re-packed around the new words and the page count is measured from them — and
the Word file, the copied text and the preview cannot drift apart. A header
line you edit goes back into its box on the left rather than becoming an
override, so the two never disagree.

Edits are keyed to the question and item they came from, not to a position on
the page, so they survive a change of spacing, font or page limit. A line you
add is keyed to the line it follows, for the same reason, and its text lives in
that list — so inserting in the middle simply moves the ones after it along.
Loading a different paper clears the lot.

## Options typed one below the other

Options are just as often typed in a stack as side by side:

    1. Which of these is the biggest animal?
    (a) Elephant
    (b) Ant
    (c) Dog

Read line by line that is three more items, and the paper comes back with one
option per line. They are stacked back onto a single row, but only on strong
evidence, because turning a list into options is not a harmless mistake:
either every line in the run carries its own tick box, or the heading says the
paper is to be ticked *and* the labels are a letter sequence starting at its
first letter. Numbers never count on their own — "1. 2. 3." under a
tick-the-option heading are the questions, not the choices. A lettered list
under "Answer the following questions" stays one answer per line, and so do the
statements of a "Write true or false" question, which carry a box each without
any of them being a choice. `tests/fixtures/stacked-options.txt` holds every
one of those cases; take the guards out and it fails.

## What it does to the paper

| Rule | How it is applied |
| --- | --- |
| One font size | 12 pt everywhere, including the header (changeable in *Layout*). |
| Consistent header | Four centred lines: school, examination, subject, then Time / Class / M.M. spread across the width, with a rule underneath. Only subject and class change between papers. |
| Bold questions | The question line is bold; everything inside it is normal weight. |
| No blank lines | Questions are separated by a small typographic gap (2–7 pt) instead of empty lines. Tick **No gap between questions** for none at all, or choose **Spacious (2-line gap)** for two blank lines to write between. |
| Two pages | The paper is measured and the spacing is tightened automatically until it fits. If even the tightest setting needs three pages, you are told rather than silently given a third page. |
| Options in a row | Tick-box options are laid out horizontally on one line, whether they were typed side by side or one below the other. Each column is measured separately, so one long choice no longer pushes the rest onto their own lines. If they genuinely will not fit, they wrap to evenly filled rows. |
| Short answers in a row | One-word items (word meanings, opposites, plurals, spellings, word pairs) are packed several per line instead of one line each. How many fit is measured from the widest item, so bare words sit five across and items with a blank to fill sit two or three across. |
| Match the following | Two columns at a fixed tab stop, at least a third of the page wide, so they never look cramped. A question only becomes a match when it really is one — see below. |
| Language fixes | Mechanical fixes are applied automatically; anything that could change meaning is offered as a tick-box suggestion. |

### Reading the header however it was typed

The four header lines are the one part of a paper that is the same every time,
and the one part typed differently every time. A class-8 Hindi paper arrived
like this:

    S.S Academy koirauna Bhadohi
    Half _ yearly Examination
    Class - 8th
    Sub- Hindi
    Time_ 2:30                    Mark__50

and came back without its time and without its marks, because the separator
between a label and its value was read as `-`, `:` or `.` and this teacher had
drawn it with underscores — and because the maximum marks were only ever
looked for under the name `M.M.`

So a separator is now any run of spaces, dashes, colons, dots or underscores,
and every field is recognised by all of its names: `M.M.`, `MM`, `Mark`,
`Marks`, `Max Marks`, `Total Marks`, `पूर्णांक`; `Class`, `Std`, `Standard`,
`कक्षा`; `Sub`, `Subject`, `विषय`; `Time`, `समय`.

Widening the labels needs two guards, and both earn their place:

- a field ends at the *next* label, so `Class: 11th Total Marks: 70` is a class
  of 11th — but `Sub: Marketing` is Marketing, not an empty subject ending at
  "Mark", because a marks label only counts when a number follows it;
- a class has to look like a class (a number, a roman numeral, or Nursery/KG),
  and the header is searched for the first field that does. Otherwise the
  `Standard` in `Standard Examination 2026-27` reads as a class of
  "Examination".

The two title lines are then put into the house style — the school in capitals,
the examination in title case, the hand-drawn underscores dropped, and initials
that were started and abandoned finished off, so `S.S Academy koirauna Bhadohi`
becomes `S.S. ACADEMY KOIRAUNA BHADOHI`. A line in capitals is shouting and is
title-cased; an abbreviation inside a mixed-case line (`CBSE`, `G.K.`) is left
alone. Both lines stay editable in the boxes above the preview.

`tests/check-header.js` holds eleven header styles, including that paper
exactly as it was typed.

## Item numbering

Word can number a list in two ways, and only one of them is visible in the text:

- **typed by hand** — "1." is really there in the document; or
- **automatic numbering** — the numbers live in `numbering.xml` and Word draws
  them. Read the text alone and every item number silently disappears.

**What Word numbers is what the items are.** A numbered list carries one number
per paragraph, so inside a question numbered that way, a line that arrives
*without* a number is not an item that lost one. It is either the rest of the
line above it — a line broken with Shift+Enter — or something that was never in
the list at all, like the box of phrases above a "complete the sentences"
question. Reading those as items is what turned one true/false statement into
two, and numbered a box of phrases as question 1.

The counting follows from the same fact: Word numbers the paragraphs it numbers,
in document order, and nothing else on the page affects the count. So where some
items carry Word's numbering and others were typed with a number of their own,
the first group takes the positions 1, 2, 3… in order and the second keeps what
it says.

**Items typed two to a line** are read down the columns, the way they are meant
to be read:

    I.   Talk-        IV. Face-              becomes  I  Talk-    IV Face-
    II.  Red-         V.  Fail-                       II Red-     V  Fail-
    III. See-                                         III See-

The gap between the two is a tab — the same character that separates the two
columns of a matching question — so the split has to be earned: the second half
must start a label of the same sequence, jumping a whole column ahead of the
first ("I … IV", never "a … b"), and neither half may be long. A matching
question is never split this way.

**"I" is a letter and a roman numeral both.** Which one it is cannot be read off
the label; it is read off the labels beside it. Where any label in the group is
unmistakably roman — "IV", "ii" — the ambiguous ones are roman too. Getting this
wrong makes a list of I, II, III, IV, V look like a jump from the ninth letter
to the fourth numeral, and the numbering of the whole question is abandoned as
inconsistent — which is exactly how a question came back with its first three
numbers missing.

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

A tick box counts as a tick box whichever brackets it is typed with, `( )` or
`[ ]`. Reading only the round ones once turned a row of five options into five
separate questions, one per option.

**Suggested, never automatic** (each with a tick box and a reason):
wording changes such as `felt tried` → `felt tired`, `doctor advice` →
`doctor advises`, `brush is teeth` → `brush his teeth`, `did he had` →
`did he have`, and a word written twice in a row. Only a person can confirm these keep the meaning intact, so
nothing is changed until you tick it. Low-confidence ones start unticked.

To add your own rules, edit `SUGGESTED` in [src/rules-language.js](src/rules-language.js).
Nothing else needs to change.

**A suggestion that arrives ticked is, in effect, an automatic change**, so how
sure it is matters as much as what it says. The capital offered for a name is
the case in point: "Who was inky?" makes *inky* a name, but the same rule read
*trees* as one from "the name of trees planted in the school" and capitalised it
across the whole paper — "The Princess was allowed to climb Trees". The paper
decides: a word used anywhere else with nothing naming about it is an ordinary
word, and its capital is offered unticked rather than applied.
`tests/check-language.js` holds both cases.

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

(Spacious sits above roomy in the menu, but not on this ladder — see below.)

The estimate is slightly pessimistic on purpose: a paper that spills onto a
third page is a worse failure than one that comes out a little tighter than it
needed to be.

### A spacing you ask for by name

Above that ladder sits **Spacious (2-line gap)**: two blank lines between
questions, for a paper meant to be written on between them. It is different
from the others in two ways.

It states its gap in *lines*, not in points, and the gap is measured against
the font actually in use — so two lines stays two lines at 14pt, and stays two
lines in a Hindi paper, where a line is a good deal taller than in an English
one. `compose.js` owns that measurement and `layout.js` estimates page heights
with the same ruler, so the two can never drift apart.

And the automatic ladder skips it (`manualOnly`). Automatic picks the loosest
setting that still fits, and a short paper would otherwise spread itself out
because it happened to have room — a two-line gap is a decision about the
paper, not a fallback. For the same reason "No gap between questions" is
switched off while it is chosen: the two ask for opposite things, and the
spacing was picked by name.

Three things had to follow the gap out to the edges: the plain-text version
turns it into two blank lines rather than the one it always used to allow; the
`.docx` sets Word's `suppressSpBfAfterPgBrk`, so a question landing at the top
of a page sits at the top, as the preview and the page estimate both assume;
and the overflow note names the spacing you chose instead of blaming the
length of the paper.

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

## Deploying

It is a static site with no build step, so any static host will do. On Vercel,
import the repository and pick the **Other** preset; `vercel.json` already sets
the rest (no build, no install, serve the repository root). Served over https
the page also gets a working Clipboard API, which a local `file://` copy does
not.

Nothing is uploaded by the page itself either way: the formatting all happens
in the browser.

## Tests

    npm install                     # once - an XML parser and a headless browser, for the tests only
    npm test                        # integrity, header, wiring, reader and the page itself

or individually:

    node tests/check-integrity.js   # nothing lost, nothing split, nothing corrupted
    node tests/check-header.js      # the four header lines, however they were typed
    node tests/check-numbering.js   # .docx reading: numbering, content controls, tables
    node tests/check-language.js    # what is fixed without asking, and what is only offered
    node tests/check-app.js         # drives the real page: load, preview, edit, copy, download
    node tests/check-ui.js          # ids, assets and modules all line up
    node tests/run-pipeline.js      # parse + fit a sample, print the structure
    node tests/run-pipeline.js hindi
    node tests/run-pipeline.js tests/fixtures/loose-spacing.txt
    node tests/build-docx.js        # write real .docx files to out/ and check the XML
    node tests/build-docx.js tests/fixtures/loose-spacing.txt

`tests/check-numbering.js` also formats a whole paper built the way Word
stores one - automatic numbering, a line broken with Shift+Enter, options in
square boxes, items two to a line - because that combination is where four
separate faults came from at once.

`tests/fixtures/loose-spacing.txt` is a paper typed with double spaces
everywhere — the case that used to break the parser. Keep it in the suite.

`tests/check-app.js` also drives the editing: it retypes a question in the
preview, moves a header line into its box, deletes a line by emptying it, and
checks that all three come out in the copied text.

`tests/build-docx.js` leaves `out/english.docx` and `out/hindi.docx` behind —
open them in Word to see the result.

## Limitations

- **`.doc`** (the old format) is not supported — open it in Word and save as
  `.docx` first.
- A `.txt` file is read as UTF-8. Hindi saved in an older encoding will come
  through as nonsense; save it as UTF-8, or use the `.docx` instead.
- A header placed in Word's own page-header area (rather than in the body of the
  document) is not read. Type those four fields in the Header box instead.
- The Hindi font defaults to **Nirmala UI**, which ships with Windows. If you
  pick a font that is not installed, Word will substitute another one.
- Page fitting is an estimate, not a Word rendering. It is deliberately
  cautious, but check the last page before printing a large batch.
- A question must start with `Que 1`, `Q.1`, `Question 1` or `प्रश्न 1` to be
  recognised. If nothing is detected, the app says so.
