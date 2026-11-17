import type { FieldNote } from '../types';
import { shopifyInventoryReservations } from './shopify-inventory-reservations';

/** Every published field note, in the order they appear on the index. */
export const fieldNotes: readonly FieldNote[] = [shopifyInventoryReservations];

export function getFieldNote(slug: string): FieldNote | undefined {
  return fieldNotes.find((note) => note.slug === slug);
}
