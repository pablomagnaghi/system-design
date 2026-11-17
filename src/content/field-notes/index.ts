import type { FieldNote } from '../types';
import { spotifyDataLake } from './spotify-data-lake';
import { figmaMultiplayer } from './figma-multiplayer';
import { discordMessageStorage } from './discord-message-storage';
import { slackJobQueue } from './slack-job-queue';
import { shopifyInventoryReservations } from './shopify-inventory-reservations';

/** Every published field note, in the order they appear on the index. */
export const fieldNotes: readonly FieldNote[] = [
  shopifyInventoryReservations,
  slackJobQueue,
  discordMessageStorage,
  figmaMultiplayer,
  spotifyDataLake,
];

export function getFieldNote(slug: string): FieldNote | undefined {
  return fieldNotes.find((note) => note.slug === slug);
}
