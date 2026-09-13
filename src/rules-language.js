/*
 * rules-language.js - data-driven language rules.
 *
 * Two tiers, deliberately separated:
 *   MECHANICAL - formatting/typography only, applied silently but logged.
 *   SUGGESTED  - wording changes. These can never be applied without the user
 *                ticking them, because only a human can confirm the meaning is
 *                unchanged. Add your own entries here; nothing else needs editing.
 */
(function (PF) {
  'use strict';

  // Words that are capitalised for grammatical reasons, never because they are names.
  var FUNCTION_WORDS = ('the a an and or but if then than that this these those of in on at to for from with '
    + 'is are was were be been being do does did have has had will would shall should can could may might must '
    + 'who what when where why how which whose whom not no yes it its he she they them his her their our your my '
    + 'write answer tick fill match complete give choose question class time sub subject academy examination half '
    + 'yearly correct option following blanks true false word words meaning meanings opposite opposites plural '
    + 'plurals spellings poem poems statement statements '
    + 'too many much more most very little less few some any all both each every other another same such '
    + 'here there now then also only just still even well back down out up off over under again once '
    + 'first second third next last new old good bad big small long short high low right left '
    + 'day days time times year years thing things people man men woman women boy boys girl girls '
    + 'said say says tell tells told make makes made take takes went gone come comes came get gets got '
    + 'know knows knew think thinks like likes want wants see sees look looks feel feels felt find finds '
    + 'about after before between during under above because while until since though although however '
    + 'meaning meanings sentence sentences paragraph essay letter application picture story stories '
    + 'name names complete choose underline correct incorrect blank blanks column columns following').split(' ');

  // "a" -> "an" exceptions: spelled with a vowel but sounded as a consonant, and vice versa.
  var AN_EXCEPTIONS = ['university', 'unit', 'uniform', 'union', 'european', 'one', 'once', 'useful', 'user'];
  var A_EXCEPTIONS = ['hour', 'honest', 'honour', 'honor', 'heir'];

  /*
   * Wording suggestions. `find` must be a global regex; `replace` may use $1 etc.
   * confidence: 'high' -> pre-ticked in the UI, 'low' -> shown unticked.
   */
  var SUGGESTED = [
    { id: 'felt-tired', find: /\bfelt\s+tried\b/gi, replace: 'felt tired', note: '"tried" looks like a typo for "tired"', confidence: 'high' },
    { id: 'doctor-advises', find: /\b(doctor|teacher)\s+advice\s+/gi, replace: '$1 advises ', note: '"advice" is a noun; the verb is "advises"', confidence: 'high' },
    { id: 'brush-his-teeth', find: /\bbrush\s+is\s+teeth\b/gi, replace: 'brush his teeth', note: '"is" looks like a typo for "his"', confidence: 'high' },
    { id: 'every-day', find: /\beveryday\b(?=\s*[\.\?\[]|\s*$)/gi, replace: 'every day', note: '"everyday" (adjective) vs "every day" (frequency)', confidence: 'high' },
    { id: 'did-have', find: /\bdid\s+(he|she|they|it|you|we|i)\s+had\b/gi, replace: 'did $1 have', note: 'after "did", the verb stays in base form', confidence: 'high' },
    { id: 'live-under', find: /\bto\s+leave\s+under\b/gi, replace: 'to live under', note: '"leave" looks like a typo for "live"', confidence: 'low' },
    { id: 'true-or-false', find: /\btrue\s+and\s+false\b/gi, replace: 'true or false', note: 'a statement is true OR false', confidence: 'high' },
    { id: 'egrets', find: /\btwo\s+greats\s+as\s+friends\b/gi, replace: 'two egrets as friends', note: '"greats" looks like a typo for "egrets"', confidence: 'low' },
    { id: 'tortoise-was', find: /\bToto\s+was\s+a\s+little\s*$/gi, replace: 'Toto was a little', note: '', confidence: 'low' }
  ];

  /*
   * Instruction headings that end in "?" although they are commands, not questions
   * ("Write 8 line poems ?", "प्रार्थना पत्र लिखिए?").
   * English imperatives open with the verb; Hindi ones close with it.
   */
  var IMPERATIVE_LATIN_START = /^(write|complete|match|fill|tick|draw|make|answer|give|state|underline|choose|arrange|rearrange|change|correct|read|frame|form|use|put|name|solve|define|explain|describe|translate|convert|do)\b/i;
  var IMPERATIVE_HINDI_END = /(लिखिए|लिखो|कीजिए|कीजिये|करो|लगाइए|बनाइए|दीजिए|भरिए|भरो|बताइए|चुनिए|मिलाइए|समझाइए)\s*[\?।]*\s*$/;

  function isImperative(text) {
    return IMPERATIVE_LATIN_START.test(text) || IMPERATIVE_HINDI_END.test(text);
  }

  PF.rules = {
    FUNCTION_WORDS: FUNCTION_WORDS,
    AN_EXCEPTIONS: AN_EXCEPTIONS,
    A_EXCEPTIONS: A_EXCEPTIONS,
    SUGGESTED: SUGGESTED,
    isImperative: isImperative
  };
})(window.PF = window.PF || {});
