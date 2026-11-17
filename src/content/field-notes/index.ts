import type { FieldNote } from '../types';
import { discordMessageStorage } from './discord-message-storage';
import { slackJobQueue } from './slack-job-queue';
import { shopifyInventoryReservations } from './shopify-inventory-reservations';

/** Every published field note, in the order they appear on the index. */
export const fieldNotes: readonly FieldNote[] = [
  shopifyInventoryReservations,
  slackJobQueue,
  discordMessageStorage,
];

export function getFieldNote(slug: string): FieldNote | undefined {
  return fieldNotes.find((note) => note.slug === slug);
}
