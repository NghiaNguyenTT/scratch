import type { NoteMetadata } from "../types/note";

// Resolve a [[wikilink]] target to a note by case-insensitive title match.
// First match wins — this mirrors the editor's click resolution exactly.
export function resolveNoteByTitle(
  title: string,
  notes: NoteMetadata[],
): NoteMetadata | undefined {
  const lower = title.toLowerCase();
  return notes.find((n) => n.title.toLowerCase() === lower);
}
