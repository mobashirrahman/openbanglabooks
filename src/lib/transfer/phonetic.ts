/**
 * A phonetic skeleton for matching Bengali titles and names across scripts
 * and spellings: দেবদাস, Devdas, Debdas and Debdash all become "dbds".
 *
 * Bengali is romanised in many ways (শরৎ: Sarat, Sharat, Saroth; গল্পগুচ্ছ:
 * Galpaguchchha, Golpoguccho). Vowels are where spellings differ most, so
 * the skeleton keeps consonants only, folds the letters romanisations mix up
 * (v/b, sh/s, th/t, chh/ch …), and marks a word that starts with a vowel.
 * It is a matching key, not a transliteration: two skeletons are compared
 * with a little tolerance (see similarity) rather than for equality.
 */

const BN_CONSONANT: Record<string, string> = {
  ক: "k", খ: "k", গ: "g", ঘ: "g", ঙ: "n",
  চ: "c", ছ: "c", জ: "j", ঝ: "j", ঞ: "n",
  ট: "t", ঠ: "t", ড: "d", ঢ: "d", ণ: "n",
  ত: "t", থ: "t", দ: "d", ধ: "d", ন: "n",
  প: "p", ফ: "f", ব: "b", ভ: "b", ম: "m",
  য: "j", র: "r", ল: "l", শ: "s", ষ: "s", স: "s", হ: "h",
  "\u09DC": "r", // ড়
  "\u09DD": "r", // ঢ়
  "\u09DF": "", // য়
  "\u09CE": "t", // ৎ
};
// NFC keeps ড়, ঢ় and য় as letter + nukta (they are composition exclusions)
const WITH_NUKTA: Record<string, string> = { "\u09AF": "\u09DF", "\u09A1": "\u09DC", "\u09A2": "\u09DD" };
const BN_VOWEL_LETTER = /[অআইঈউঊএঐওঔ]/;
const BN_VOWEL_SIGN = /[\u09BE-\u09C4\u09C7\u09C8\u09CB\u09CC\u09D7]/;
const HASANTA = "\u09CD";
const NUKTA = "\u09BC";

function bengaliWord(word: string): string {
  const w = word.normalize("NFC");
  let out = "";
  for (let i = 0; i < w.length; i++) {
    let ch = w[i];
    if (w[i + 1] === NUKTA) {
      ch = WITH_NUKTA[ch] ?? ch;
      i++;
    }
    const afterHasanta = w[i - 1] === HASANTA;
    if (ch in BN_CONSONANT) {
      // ্য (ya-phala) and ্ব (ba-phala) lengthen the consonant before; romanisations drop them
      if (afterHasanta && (ch === "য" || ch === "ব")) continue;
      // য says j only at the start of a word
      if (ch === "য" && out !== "" && out !== "@") continue;
      out += BN_CONSONANT[ch];
    } else if (ch === "ং") out += "ng";
    else if (ch === "ঁ") out += "n";
    else if (ch === "ঋ" || ch === "\u09C3") out += "r";
    else if (BN_VOWEL_LETTER.test(ch)) {
      if (i === 0) out += "@";
    } else if (BN_VOWEL_SIGN.test(ch) || ch === HASANTA || ch === "ঃ") continue;
  }
  return out;
}

// Spellings of the same surname that share no skeleton
const SURNAMES: Record<string, string> = {
  chatterjee: "chattopadhyay", chatterji: "chattopadhyay", chaterjee: "chattopadhyay", chattopadhyaya: "chattopadhyay",
  banerjee: "bandyopadhyay", banerji: "bandyopadhyay", bannerjee: "bandyopadhyay", bandopadhyaya: "bandyopadhyay",
  mukherjee: "mukhopadhyay", mukherji: "mukhopadhyay", mukerji: "mukhopadhyay", mookerjee: "mukhopadhyay",
  ganguly: "gangopadhyay", ganguli: "gangopadhyay",
  tagore: "thakur",
};

function latinWord(word: string): string {
  let w = word
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (!w) return "";
  w = SURNAMES[w] ?? w;
  const start = /^[aeiouw]/.test(w) ? "@" : /^y[aeiou]/.test(w) ? "j" : "";
  if (start === "j") w = w.slice(1);
  w = w
    .replace(/chh|ch/g, "c")
    .replace(/sh/g, "s")
    .replace(/th/g, "t")
    .replace(/dh/g, "d")
    .replace(/bh/g, "b")
    .replace(/ph/g, "f")
    .replace(/kh/g, "k")
    .replace(/gh/g, "g")
    .replace(/jh/g, "j")
    .replace(/v/g, "b")
    .replace(/x/g, "ks")
    .replace(/q/g, "k")
    .replace(/z/g, "j")
    .replace(/[aeiouyw]/g, "");
  return start + w;
}

const BENGALI = /[ঀ-৿]/;
const collapse = (s: string) => s.replace(/(.)\1+/g, "$1");

/** The skeleton of one word, in either script. */
export function skeleton(word: string): string {
  return collapse(BENGALI.test(word) ? bengaliWord(word) : latinWord(word));
}

/** Words of a title or name, split on spaces, punctuation and hyphens (both scripts). */
export function words(text: string): string[] {
  return text
    .normalize("NFC")
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean);
}

/** Skeletons of each word, without words that leave nothing (a, I, ও …) and without stop words. */
export function skeletons(text: string, stop?: Set<string>): string[] {
  const out: string[] = [];
  for (const w of words(text)) {
    if (stop?.has(w.toLowerCase())) continue;
    if (/^\p{N}+$/u.test(w)) continue;
    const s = skeleton(w);
    if (s && s !== "@") out.push(s);
  }
  return out;
}

/** Levenshtein distance, for short strings. */
export function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** 0–1: how alike two skeletons are. */
export function similarity(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - distance(a, b) / longest : 0;
}

/** Two words agree: the same skeleton, or one letter apart in longer words. */
export const sameWord = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 4 && distance(a, b) <= 1);

/**
 * 0–1: how alike two lists of word skeletons are, as words (Dice, with a
 * little tolerance per word) or run together ("Saratchandra" against
 * "Sarat Chandra"), whichever is closer.
 */
export function likeness(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const left = [...b];
  let shared = 0;
  for (const w of a) {
    const i = left.findIndex((x) => sameWord(w, x));
    if (i >= 0) {
      shared++;
      left.splice(i, 1);
    }
  }
  const dice = (2 * shared) / (a.length + b.length);
  const joinedA = a.join("");
  const joinedB = b.join("");
  // run together, only near-identical counts: one letter in five is another word (srknt, srkbt)
  const joined = joinedA.length >= 3 && joinedB.length >= 3 ? similarity(joinedA, joinedB) : 0;
  return Math.max(dice, joined >= 0.85 ? joined : 0);
}

/** 0–1: how many of the words in `a` appear among `bag`. */
export function coverage(a: string[], bag: Set<string> | string[]): number {
  if (!a.length) return 0;
  const list = [...bag];
  return a.filter((w) => list.some((x) => sameWord(w, x))).length / a.length;
}
