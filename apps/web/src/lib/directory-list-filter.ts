/** Shared A–Z / search helpers for People directories (clients, suppliers, etc.). */

export const DIRECTORY_ALPHABET_LETTERS = [
  "All",
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""),
  "#",
] as const;

export type DirectoryAlphabetLetter = (typeof DIRECTORY_ALPHABET_LETTERS)[number];

/** First name token — prefers text after a comma ("Smith, John" → John). */
export function directoryFirstName(name: string): string {
  const trimmed = (name || "").trim();
  if (!trimmed) return "";
  if (trimmed.includes(",")) {
    const after = trimmed.split(",")[1]?.trim();
    if (after) return after.split(/\s+/)[0] || after;
  }
  return trimmed.split(/\s+/)[0] || trimmed;
}

export function directorySortKey(name: string): string {
  const first = directoryFirstName(name).toLowerCase();
  const rest = (name || "").trim().toLowerCase();
  return `${first}\u0000${rest}`;
}

export function directoryLetterOf(name: string): string {
  const ch = directoryFirstName(name).charAt(0).toUpperCase();
  if (ch >= "A" && ch <= "Z") return ch;
  return "#";
}

export function matchesDirectoryLetter(name: string, letter: string): boolean {
  if (!letter || letter === "All") return true;
  return directoryLetterOf(name) === letter;
}

export function matchesDirectoryQuery(values: Array<string | undefined | null>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return values.some((value) => (value || "").toLowerCase().includes(q));
}

export function sortByDirectoryFirstName<T>(items: T[], getName: (item: T) => string): T[] {
  return [...items].sort((left, right) =>
    directorySortKey(getName(left)).localeCompare(directorySortKey(getName(right)), undefined, {
      sensitivity: "base",
    }),
  );
}

export function filterDirectoryList<T>(
  items: T[],
  options: {
    getName: (item: T) => string;
    getSearchValues?: (item: T) => Array<string | undefined | null>;
    query?: string;
    letter?: string;
  },
): T[] {
  const query = options.query || "";
  const letter = options.letter || "All";
  const filtered = items.filter((item) => {
    const name = options.getName(item);
    if (!matchesDirectoryLetter(name, letter)) return false;
    const values = options.getSearchValues?.(item) ?? [name];
    return matchesDirectoryQuery(values, query);
  });
  return sortByDirectoryFirstName(filtered, options.getName);
}
