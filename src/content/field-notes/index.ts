import type { FieldNote } from '../types';
import { figmaMultiplayer } from './figma-multiplayer';

/** Every published field note, in the order they appear on the index. */
export const fieldNotes: readonly FieldNote[] = [figmaMultiplayer];

export function getFieldNote(slug: string): FieldNote | undefined {
  return fieldNotes.find((note) => note.slug === slug);
}
