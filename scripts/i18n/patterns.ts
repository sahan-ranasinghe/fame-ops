// The Sinhala review export's helper (scripts/i18n/export-sinhala-review.py): which server sentences Office mode already
// says in the person's language. Reads a JSON list of English sentences (sample values in place of the placeholders) and
// answers, for each, the keys the app's own reader (apps/driver/src/office/statusWords.ts sentenceWords) maps it to.
import { readFileSync } from 'node:fs';
import { sentenceWords, type Words, type WordsVar } from '../../apps/driver/src/office/statusWords';

function keysOf(w: WordsVar | undefined, out: string[]): void {
  if (!w || typeof w !== 'object') return;
  if (w.key && !/^(days|months)\./.test(w.key)) out.push(w.key);
  for (const v of Object.values(w.vars ?? {})) keysOf(v, out);
  for (const p of w.parts ?? []) keysOf(p, out);
}

const sentences: string[] = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const answer = sentences.map((s) => {
  const w: Words | null = sentenceWords(s);
  const keys: string[] = [];
  if (w) keysOf(w, keys);
  return keys;
});
process.stdout.write(JSON.stringify(answer));
