// A driver's name in a short phrase (hotfix, 17 October 2026): the first name ("Kamal's vehicle today"), or the
// full name when another driver in the same list has that first name ("Test Driver's" beside "Test Driver 2's").
// Shared with the office web app (@fleet/names): both say it the same way.

/** The first word of a name. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

/** The first name, or the full name when one of `names` (the others in the list, the person may be in it) shares it. */
export function shortName(name: string, names: readonly string[]): string {
  const full = name.trim();
  const first = firstName(full);
  const key = first.toLocaleLowerCase();
  return names.some((n) => n.trim() !== full && firstName(n).toLocaleLowerCase() === key) ? full : first;
}
