export function cleanForSpeech(text: string) {
  return text
    .replace(/^[\s*-]+/gm, "")
    .replace(/\n{2,}/g, ". ")
    .replace(/\n/g, ". ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
