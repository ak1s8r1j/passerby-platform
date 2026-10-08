/**
 * Spots someone saying they are under 18 ("im 14 f", "I'm only 16 and bored").
 * It must catch the real thing without flagging "I'm 15 minutes late", "im 100% sure" or "im 10 km away",
 * so the number has to be followed by the end of the sentence, punctuation, or a word that means "years old".
 */
const STATED_AGE =
  /\b(?:i\s*a?m|i['’]\s*m)\s+(?:only\s+)?(\d{1,2})(?=\s*(?:$|[.,!?)]|(?:m|f|male|female|boy|girl|yo|y\/o|years?|yrs?|and|btw)\b))/i;

/** Ages of 4 and under are ignored: "im 2 tired" is not a toddler. */
const SMALLEST_REAL_AGE = 5;

/** The age they claimed if it is under 18, otherwise null. */
export function statedMinorAge(text: string): number | null {
  const match = STATED_AGE.exec(text);
  if (!match) return null;
  const age = Number(match[1]);
  return age >= SMALLEST_REAL_AGE && age < 18 ? age : null;
}
