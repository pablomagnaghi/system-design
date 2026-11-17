import type { FieldNote } from '../types';
import { discordMessageStorage } from './discord-message-storage';

/** Every published field note, in the order they appear on the index. */
export const fieldNotes: readonly FieldNote[] = [discordMessageStorage];

export function getFieldNote(slug: string): FieldNote | undefined {
  return fieldNotes.find((note) => note.slug === slug);
}
