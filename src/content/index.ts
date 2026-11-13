import { adClickAggregator } from './designs/ad-click-aggregator';
import { bookingSystem } from './designs/booking-system';
import { chatMessaging } from './designs/chat-messaging';
import { collaborativeEditor } from './designs/collaborative-editor';
import { distributedCache } from './designs/distributed-cache';
import { fileSync } from './designs/file-sync';
import { flashSale } from './designs/flash-sale';
import { jobScheduler } from './designs/job-scheduler';
import { liveComments } from './designs/live-comments';
import { metricsMonitoring } from './designs/metrics-monitoring';
import { newsFeed } from './designs/news-feed';
import { notificationSystem } from './designs/notification-system';
import { onlineAuction } from './designs/online-auction';
import { paymentWebhooks } from './designs/payment-webhooks';
import { postSearch } from './designs/post-search';
import { proximitySearch } from './designs/proximity-search';
import { rateLimiter } from './designs/rate-limiter';
import { rideSharing } from './designs/ride-sharing';
import { topK } from './designs/top-k';
import { urlShortener } from './designs/url-shortener';
import { videoStreaming } from './designs/video-streaming';
import { webCrawler } from './designs/web-crawler';
import type { Design } from './types';

export type * from './types';

/** Every published design, in the order they appear on the cover. */
export const designs: readonly Design[] = [
  rateLimiter,
  notificationSystem,
  paymentWebhooks,
  bookingSystem,
  distributedCache,
  jobScheduler,
  urlShortener,
  chatMessaging,
  newsFeed,
  videoStreaming,
  rideSharing,
  liveComments,
  proximitySearch,
  onlineAuction,
  topK,
  webCrawler,
  adClickAggregator,
  metricsMonitoring,
  fileSync,
  collaborativeEditor,
  postSearch,
  flashSale,
];

export function getDesign(slug: string): Design | undefined {
  return designs.find((design) => design.slug === slug);
}

/** The interview framework every design follows, in order. */
export const framework = [
  {
    step: 'Requirements',
    detail:
      'Agree on what the system must do and the few qualities that shape it: scale, latency, consistency.',
  },
  { step: 'Core entities', detail: 'Name the main things the system stores and moves.' },
  { step: 'API', detail: 'Define the contract with callers before drawing boxes.' },
  { step: 'Data flow', detail: 'Walk one request through the system in a few steps.' },
  {
    step: 'High-level design',
    detail: 'Draw the components that satisfy the API, and explain each choice and its cost.',
  },
  {
    step: 'Deep dives',
    detail: 'Stress the design where it is weakest: scale, failure, consistency, edge cases.',
  },
] as const;
