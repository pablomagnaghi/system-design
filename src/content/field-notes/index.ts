import type { FieldNote } from '../types';
import { slackJobQueue } from './slack-job-queue';

/** Every published field note, in the order they appear on the index. */
export const fieldNotes: readonly FieldNote[] = [slackJobQueue];

export function getFieldNote(slug: string): FieldNote | undefined {
  return fieldNotes.find((note) => note.slug === slug);
}
