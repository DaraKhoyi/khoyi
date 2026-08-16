// languages — the languages a contact might speak on the phone.
//
// Setting one forces call transcription into that language instead of guessing.
// This exists because automatic audio detection FAILS on code-switched speech: a
// mostly-Farsi call with English mixed in came back as English at 0.67 confidence
// and rendered the Farsi in Arabic script, so the summary and action items were
// built from nonsense. Who is on the call is information the audio detector does
// not have and we do.
//
// ISO-639-1 codes, matching what AssemblyAI expects for language_code.
export const CALL_LANGUAGES = [
  ['', 'Detect automatically'],
  ['fa', 'Farsi / Persian'],
  ['es', 'Spanish'],
  ['ar', 'Arabic'],
  ['fr', 'French'],
  ['de', 'German'],
  ['it', 'Italian'],
  ['pt', 'Portuguese'],
  ['ru', 'Russian'],
  ['hi', 'Hindi'],
  ['zh', 'Chinese'],
  ['en', 'English'],
];

export const languageLabel = (code) =>
  (CALL_LANGUAGES.find(([c]) => c === (code || '')) || [, ''])[1];
