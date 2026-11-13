import type { Design } from '../types';

export const bookingSystem: Design = {
  slug: 'booking-system',
  title: 'Booking system for stays',
  summary:
    'Let guests search and book stays without ever selling the same night twice: fast, slightly stale search; a strictly consistent claim at the moment of booking; and payments, holds and outside calendars that never leave the inventory wrong.',
  difficulty: 'Hard',
  requirements: {
    functional: [
      'Guests search available stays by place and dates.',
      'Guests book a stay for a range of nights and pay for it.',
      'A booking is held while the guest pays, then confirmed or released.',
      'Hosts who also list elsewhere keep a single, correct calendar.',
    ],
    nonFunctional: [
      'Never double-book a night: correctness over availability at the moment of booking.',
      'Search is fast and can be a few seconds stale.',
      'Retries from clients or payment providers never create a second booking or a second charge.',
      'Scale to millions of searches a day and thousands of bookings a minute at peak.',
    ],
    outOfScope: [
      'Ranking and personalization of search results.',
      'Reviews, messaging and host payouts.',
    ],
  },
  entities: [
    { name: 'Listing', description: 'A bookable place, with its time zone and house rules.' },
    {
      name: 'Night claim',
      description: 'One row per listing and night: the unit that can only be sold once.',
    },
    {
      name: 'Booking',
      description:
        'Guest, listing, nights, pinned price and state: held, confirmed, cancelled or expired.',
    },
    {
      name: 'Quote',
      description: 'The price the guest saw, with an expiry, frozen at booking time.',
    },
  ],
  api: [
    {
      method: 'GET',
      path: '/listings?place=…&checkIn=…&checkOut=…',
      description: 'Search, served from an availability index that may be slightly stale.',
    },
    {
      method: 'POST',
      path: '/bookings',
      description:
        'Body: listingId, nights, quoteId, idempotencyKey. Returns 201 with a held booking, or 409 if a night is taken.',
    },
    {
      method: 'POST',
      path: '/bookings/{id}/confirm',
      description: 'Called after payment authorization; moves the booking from held to confirmed.',
    },
  ],
  dataFlow: [
    'The guest searches; the index returns listings that look available.',
    'The guest books; the service claims every night atomically and creates a held booking.',
    'The payment is authorized; the booking moves to confirmed and events go out.',
    'Unpaid holds expire and release their nights; outside calendars are synced into the same claims.',
  ],
  highLevel: {
    label: 'Run a booking through the system',
    intro:
      'Follow one guest from search to a confirmed stay, and see how the same nights stay correct when holds expire and calendars change elsewhere. Press play, or step through the stages.',
    nodes: [
      { id: 'guest', title: 'Guest', detail: 'Search, then book', column: 0, row: 'middle' },
      { id: 'search', title: 'Search index', detail: 'Availability cache', column: 1, row: 'top' },
      { id: 'api', title: 'Booking API', detail: 'Idempotency key', column: 1, row: 'middle' },
      {
        id: 'channels',
        title: 'Channel sync',
        detail: 'Other calendars',
        column: 1,
        row: 'bottom',
      },
      { id: 'claims', title: 'Night claims', detail: 'Unique per night', column: 2, row: 'middle' },
      {
        id: 'sweeper',
        title: 'Hold expiry',
        detail: 'Releases stale holds',
        column: 2,
        row: 'bottom',
      },
      { id: 'payments', title: 'Payments', detail: 'Authorize first', column: 3, row: 'middle' },
      {
        id: 'booking',
        title: 'Booking state',
        detail: 'held → confirmed',
        column: 4,
        row: 'middle',
      },
      { id: 'events', title: 'Events', detail: 'Via an outbox', column: 5, row: 'middle' },
    ],
    edges: [
      ['guest', 'search'],
      ['guest', 'api'],
      ['api', 'claims'],
      ['claims', 'payments'],
      ['payments', 'booking'],
      ['booking', 'events'],
      ['claims', 'search', 'async update'],
      ['sweeper', 'claims'],
      ['channels', 'claims'],
    ],
    stages: [
      {
        title: 'Search from a cache',
        narration:
          'The guest searches by place and dates. A search index answers from an availability cache that is updated asynchronously, so it can be a few seconds behind.',
        tradeoff:
          'Searching the source of truth on every query would be exact but slow and expensive at search volume. A cache is fast and scales, at the cost of sometimes showing a stay that was just taken. That is acceptable only because the booking step checks again.',
        nodes: ['guest', 'search'],
        travel: [['guest', 'search']],
      },
      {
        title: 'Book with a key and a pinned price',
        narration:
          'The guest clicks Book. The request carries an idempotency key and the quote the guest saw, so the price is frozen and a retried click returns the same booking.',
        tradeoff:
          'Pinning the price at booking time means the guest pays what they saw, even if dynamic pricing moved a minute later; re-pricing at confirmation would protect revenue but surprise the guest. Quotes get a short expiry so a stale price cannot be held forever.',
        nodes: ['guest', 'api'],
        travel: [['guest', 'api']],
      },
      {
        title: 'Claim every night atomically',
        narration:
          'The service inserts one claim per listing and night in a single transaction. A unique constraint on listing and night means that if any night is already taken, the whole insert fails and the guest gets a clear "no longer available".',
        tradeoff:
          'Checking availability and then writing has a race between the two steps. Locking the listing works but serializes every booking for it. A unique constraint lets the database be the single judge of contention, with no extra lock service, and only the losing request pays the cost.',
        nodes: ['api', 'claims'],
        travel: [['api', 'claims']],
      },
      {
        title: 'A hold, not a lock',
        narration:
          'The claims are created as a hold with an expiry, around ten minutes, while the guest pays. The nights are off the market, but only for that window.',
        tradeoff:
          'A hold protects the guest from losing the stay halfway through paying, and in exchange takes inventory off the market. A short expiry balances both: long enough to pay, short enough that abandoned checkouts give the nights back quickly.',
        nodes: ['claims'],
        travel: [],
      },
      {
        title: 'Authorize the payment',
        narration:
          'The card is authorized, not charged, with an idempotency key derived from the booking id. The capture happens later, according to the cancellation policy.',
        tradeoff:
          'Authorizing first means a failed or abandoned booking never needs a refund. Capturing immediately is simpler, but every cancellation then becomes a refund, which is slower for the guest and costs fees.',
        nodes: ['claims', 'payments'],
        travel: [['claims', 'payments']],
      },
      {
        title: 'Confirm through a state machine',
        narration:
          'When the authorization succeeds, the booking moves from held to confirmed. The same transition can arrive from the API response or from a payment webhook, and applying it twice changes nothing.',
        tradeoff:
          'Modeling the booking as a state machine with allowed transitions costs some upfront design, and it makes retries, late webhooks and timeouts harmless: a confirmed booking can never go back to held, and an expired one cannot be confirmed.',
        nodes: ['payments', 'booking'],
        travel: [['payments', 'booking']],
      },
      {
        title: 'Every change emits an event',
        narration:
          'The state change and an outbox row are written in the same transaction. A worker publishes the event: confirmation email, host notification, analytics.',
        tradeoff:
          'Sending emails inside the transaction risks notifying about a booking that was rolled back. The outbox adds a table and a worker, and guarantees every committed change is announced exactly once in effect.',
        nodes: ['booking', 'events'],
        travel: [['booking', 'events']],
      },
      {
        title: 'Refresh search asynchronously',
        narration:
          'Claim changes are streamed to the search index, so the stay disappears from results within seconds.',
        tradeoff:
          'Updating the index synchronously would make every booking slower and fail when search is down. Asynchronous updates keep booking fast and independent; the few seconds of staleness are covered by the atomic claim.',
        nodes: ['claims', 'search'],
        travel: [['claims', 'search', 'async update']],
      },
      {
        title: 'Expired holds give nights back',
        narration:
          'A sweeper finds holds past their expiry, marks the bookings expired and deletes their claims, so the nights become bookable again. Reads also treat an expired hold as free, even before the sweeper runs.',
        tradeoff:
          'A sweeper alone leaves nights blocked until it runs; checking expiry on every read alone leaves old rows behind. Doing both keeps inventory correct immediately and the table clean over time.',
        nodes: ['sweeper', 'claims'],
        travel: [['sweeper', 'claims']],
      },
      {
        title: 'Calendars changed elsewhere',
        narration:
          'Many hosts also list on other platforms. A channel sync job imports their outside bookings and writes them as claims through the same unique constraint, and pushes our bookings out.',
        tradeoff:
          'When you do not own all the inventory, a short window where two platforms sell the same night is unavoidable. Syncing often narrows the window, and a written policy (who keeps the stay, how the other guest is rebooked and compensated) handles the rare conflict instead of pretending it cannot happen.',
        nodes: ['channels', 'claims'],
        travel: [['channels', 'claims']],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we guarantee a night is never sold twice?',
      options: [
        {
          name: 'Check, then insert in the application',
          pros: 'Easy to write and read.',
          cons: 'Two requests can both pass the check before either writes.',
        },
        {
          name: 'Lock the listing row during booking',
          pros: 'Correct, and simple to reason about.',
          cons: 'Every booking for a listing waits in line, even for different dates.',
        },
        {
          name: 'Distributed lock in a cache',
          pros: 'Works across services and databases.',
          cons: 'Another system to run, and an expired lease can let two writers through.',
        },
        {
          name: 'Unique constraint on listing and night',
          pros: 'The database decides atomically; different dates never block each other.',
          cons: 'One row per night, and multi-night stays need all rows in one transaction.',
        },
      ],
      choice:
        'A unique constraint on listing and night, written in one transaction per booking. It is the simplest thing that is correct under concurrency.',
    },
    {
      question: 'Instant booking or request to book?',
      options: [
        {
          name: 'Instant booking',
          pros: 'Best for guests and conversion: the stay is confirmed in seconds.',
          cons: 'Hosts give up the chance to review each guest.',
        },
        {
          name: 'Request to book',
          pros: 'Hosts approve each guest.',
          cons: 'The hold has to last hours instead of minutes, keeping nights off the market and guests waiting.',
        },
      ],
      choice:
        'Support both as a listing setting. The state machine gains a "pending host approval" state with its own, longer expiry, and nothing else changes.',
    },
    {
      question: 'How do we store dates so stays are correct everywhere?',
      options: [
        {
          name: 'UTC timestamps for check-in and check-out',
          pros: 'Standard for events and logs.',
          cons: 'A night belongs to a local calendar day; time zones and daylight saving shift it.',
        },
        {
          name: 'Local dates of the listing, plus its time zone',
          pros: 'A night is a calendar date where the property is, which is what guests and hosts mean.',
          cons: 'Every comparison must use the listing time zone, never the server one.',
        },
      ],
      choice:
        'Nights are stored as local dates of the listing, with its time zone on the listing. Timestamps are kept only for events such as when a booking was made.',
    },
  ],
  wrapUp:
    'Search can be stale, but the claim cannot: one row per night under a unique constraint, held briefly while the card is authorized, confirmed through a state machine, announced through an outbox, and reconciled with every outside calendar.',
};
