import type { FieldNote } from '../types';
import { spotifyDataLake } from './spotify-data-lake';

/** Every published field note, in the order they appear on the index. */
export const fieldNotes: readonly FieldNote[] = [spotifyDataLake];

export function getFieldNote(slug: string): FieldNote | undefined {
  return fieldNotes.find((note) => note.slug === slug);
}
