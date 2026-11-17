import type { FieldNote } from '../types';
import { metaZgateway } from './meta-zgateway';

/** Every published field note, in the order they appear on the index. */
export const fieldNotes: readonly FieldNote[] = [metaZgateway];

export function getFieldNote(slug: string): FieldNote | undefined {
  return fieldNotes.find((note) => note.slug === slug);
}
