import type { Design } from '../types';

export const bookingSystem: Design = {
  slug: 'booking-system',
  title: 'Booking system for stays',
  summary:
    'Let guests search and book stays without selling the same night twice: search from an index that may be seconds stale, one unique key per listing and night that decides every claim, a ten-minute hold while the card is authorized, and a booking that always ends confirmed and paid or released with nothing charged.',
  difficulty: 'Hard',
  minutes: 14,
  requirements: {
    functional: [
      'Guests search listings by place, dates and number of guests, and see only stays that look free for every night of the range.',
      'A guest gets a quote for a listing and dates: a total that is honored for 15 minutes.',
      'A guest holds a stay of 1 to 30 nights for 10 minutes while paying. The hold ends as a confirmed, paid booking or is released, by the guest or by the deadline.',
      'A guest cancels a confirmed booking before check-in and is refunded according to the cancellation policy that was shown with the quote.',
      'A host changes the price of nights and blocks or reopens nights. Nights that a guest holds or has booked cannot be blocked.',
      'A guest can read their booking at any time, so a lost answer is never a lost stay.',
    ],
    nonFunctional: [
      'A night of a listing is never sold twice: correctness wins over availability at the moment of booking.',
      'Search is fast and may be stale: 99% of searches answer within 400 ms, and 99% of calendar changes are searchable within 10 seconds.',
      'Repeated requests, from the app or from our own retries toward the payment provider, never create a second booking or a second charge.',
      'Every card authorization ends captured on a confirmed booking or voided, and 99% of unpaid holds give their nights back within 15 minutes of being placed.',
      'Scale: 2 million listings, 4,000 searches a second at peak, 30 holds a second at peak (1,800 a minute).',
      'An outage of search, of the payment provider or of the background worker does not stop the parts that do not need it.',
    ],
    outOfScope: [
      'Ranking and personalization of search results.',
      'Reviews, messaging between guest and host, and host payouts.',
      'Guest and host accounts and sign-in; the design only requires a signed-in account.',
      'Card handling: the payment provider collects the card in its own form and gives the app a payment token.',
      'Payment methods that finish outside the request, such as redirects and bank transfers. A card authorization answers in the call.',
      'Request to book, where the host approves each guest. Every listing here is booked instantly.',
      'Calendars shared with other platforms. An outside booking would be written as a block through the same unique key; the import is not designed here.',
      'Room types with a pooled count. Each listing is one bookable unit.',
      'Minimum stays, check-in day rules, taxes, currencies and invoices.',
      'Changes to the dates of a confirmed booking, and cancellations after check-in.',
      'Delivery of confirmation emails and push notifications; the design publishes booking events and another service sends them.',
    ],
  },
  entities: [
    {
      name: 'Listing',
      description:
        'One bookable unit: id, host, place, capacity, time zone, base nightly price, cleaning fee, cancellation policy, status (active or paused) and a calendar version, a counter that goes up by one in every transaction that changes its nights or prices.',
    },
    {
      name: 'Rate',
      description:
        'A nightly price set by the host for one listing and night, overriding the base price. Key: listing id and night.',
    },
    {
      name: 'Night claim',
      description:
        'One row per listing and night that is taken: listing id, night (a local date of the listing) and either the booking that holds it or the mark "blocked by host". The primary key is listing id plus night, so a night can have one claim at most. A free night has no row.',
    },
    {
      name: 'Booking',
      description:
        'Id, guest, listing, check-in and check-out dates, total and currency copied from the quote, the cancellation policy copied from the quote, the idempotency key of the request (unique per guest), the hold deadline, the payment attempt that confirmed it, and a state: held, confirmed, released or cancelled. A cancelled booking also carries the refund due, the time its last call to the provider began, and whether it is pending, done or in review.',
    },
    {
      name: 'Quote',
      description:
        'A signed token, not a row: listing, nights, guests, total, currency, cancellation policy and an expiry 15 minutes ahead, signed with a key that only the booking service reads.',
    },
    {
      name: 'Payment attempt',
      description:
        'One press of pay: booking id plus the payment key sent by the app, the amount, and a state: started, authorized, declined, failed, captured or voided, with the time of each change, the time its last call to the provider began, a count of refusals and a mark "in review" that takes a capture or a void out of the worker’s hands after three refusals or 12 hours. Its id is the reference of every call to the payment provider, and each call that changes something carries its own idempotency key, made of that id and the operation: authorize, capture or void.',
    },
    {
      name: 'Outbox row',
      description:
        'Work that must follow a commit, written in the same transaction: either "index listing L", with no version in it because the relay reads the current one, or a booking event (confirmed, cancelled). Columns: id, destination (index or events), payload, created at, the time a relay task last took it, refusals, and a state of pending or parked.',
    },
  ],
  api: [
    {
      method: 'GET',
      path: '/search?place=…&checkIn=…&checkOut=…&guests=…',
      description:
        'Served from the search index, which may be seconds behind the calendar. Returns a page of 20 listings with their base nightly price. Reads only.',
    },
    {
      method: 'POST',
      path: '/quotes',
      description:
        'Body: listingId, checkIn, checkOut, guests. Reads prices and claims from a database reader and returns a signed quote with the total and the cancellation policy, valid for 15 minutes. 409 when a night already looks taken. It changes nothing, so it is safe to repeat.',
    },
    {
      method: 'POST',
      path: '/bookings',
      description:
        'Body: quote, idempotencyKey. Claims every night and returns 201 with a held booking and its deadline, 10 minutes ahead. The same key from the same guest returns the same booking. 409 when a night is taken or the listing is paused, 410 when the quote has expired, 422 when the quote is not valid or covers more than 30 nights, and 503 with Retry-After when the transaction gave up after waiting 2 seconds for the listing row; the app repeats that one with the same key.',
    },
    {
      method: 'POST',
      path: '/bookings/{id}/pay',
      description:
        'Body: paymentToken, paymentKey (one per press of pay). 200 when the booking is confirmed, also on a repeat for a booking that is already confirmed. 402 when the card is declined, and on every call after a third decline, which starts no new authorization. 410 when the hold was released, or when a new attempt arrives after the deadline. 202 "pending" when the provider gave no answer: the app calls again with the same paymentKey. 409 when this attempt ended as failed because the provider never received it: nothing is held on the card, and the app starts a new attempt with a new paymentKey.',
    },
    {
      method: 'POST',
      path: '/bookings/{id}/release',
      description:
        'Gives up a hold before it runs out. Moves the booking from held to released and frees its nights. 200 also on a repeat; 409 when the booking is confirmed.',
    },
    {
      method: 'POST',
      path: '/bookings/{id}/cancel',
      description:
        'Cancels a confirmed booking before check-in, by the guest or by the host. Returns the refund due: by policy for a guest, the full total for a host. 200 also on a repeat, with the same refund; 409 when the booking is not confirmed or check-in has passed.',
    },
    {
      method: 'GET',
      path: '/bookings/{id}',
      description:
        'The booking with its state, deadline, payment state and refund, read from the database writer. For an app that lost an answer.',
    },
    {
      method: 'PUT',
      path: '/listings/{id}/calendar',
      description:
        'Host only. Body: nights, and a price, "blocked" or "open" for them. Sets values, so a repeat changes nothing: a block skips the nights this host has already blocked, and "open" removes only blocks set by the host. Apart from that, blocking is all or nothing: 409 with the list of nights that a guest holds or has booked.',
    },
  ],
  dataFlow: [
    'The guest searches; the index returns listings with no taken night in the range, from data that may be seconds old.',
    'The guest opens a listing and gets a signed quote: the total, the policy and 15 minutes to use it.',
    'The guest books; one transaction inserts a claim per night under a unique key and creates a held booking with a 10-minute deadline, or fails as a whole with "no longer available".',
    'The guest pays; the card is authorized, one conditional write moves the booking from held to confirmed, and then the money is captured.',
    'A background worker releases unpaid holds 60 seconds after their deadline, finishes any money step a crash left half done, and carries calendar changes to the search index and booking events to a topic through an outbox.',
    'A cancellation frees the nights and records the refund due in one transaction; the refund then goes to the provider under a key that makes a repeat harmless.',
  ],
  highLevel: {
    label: 'Run a booking through the system',
    intro:
      'Follow one guest from search to a confirmed stay. The design grows as it needs to: watch two guests get the same night, then see the unique key per night, the hold, the payment, the worker that releases and repairs, the outbox that feeds search, a cancellation and a host who edits the calendar in the middle of a checkout. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      { id: 'guest', title: 'Guest', detail: 'Search, quote, book', column: 0, row: 'middle' },
      {
        id: 'host',
        title: 'Host',
        detail: 'Prices and blocks',
        column: 0,
        row: 'bottom',
        appearsAt: 10,
      },
      { id: 'search', title: 'Search API', detail: 'Place and dates', column: 1, row: 'top' },
      { id: 'api', title: 'Booking API', detail: 'Quote, hold, pay', column: 1, row: 'middle' },
      { id: 'index', title: 'Search index', detail: 'Seconds stale', column: 2, row: 'top' },
      {
        id: 'db',
        title: 'Bookings DB',
        detail: 'Claims, bookings, outbox',
        column: 2,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'payments',
        title: 'Payments',
        detail: 'Authorize, capture',
        column: 2,
        row: 'bottom',
        appearsAt: 4,
      },
      {
        id: 'worker',
        title: 'Worker',
        detail: 'Release, repair, relay',
        column: 3,
        row: 'middle',
        appearsAt: 6,
      },
      {
        id: 'events',
        title: 'Events topic',
        detail: 'Confirmed, cancelled',
        column: 4,
        row: 'middle',
        appearsAt: 8,
      },
    ],
    edges: [
      ['guest', 'search'],
      ['search', 'index'],
      ['guest', 'api'],
      ['api', 'db'],
      ['api', 'payments'],
      ['worker', 'db'],
      ['worker', 'payments'],
      ['worker', 'index'],
      ['worker', 'events'],
      ['host', 'api'],
    ],
    // The worker joins to release holds; its paths to the provider and to the index are drawn
    // from the stage that explains each one.
    edgeStages: [
      { edge: ['worker', 'payments'], stages: [7, 8, 9, 10] },
      { edge: ['worker', 'index'], stages: [8, 9, 10] },
    ],
    stages: [
      {
        title: 'Search from an index',
        narration:
          'Maya searches for a place by the sea from 12 to 16 March for two guests. The search API asks a search index for listings in the area that fit two guests and have no taken night from 12 to 15 March, the four nights of the stay. Each listing is one document that carries its taken nights. The index is filled in the background, a few seconds behind the calendar; a later stage shows how.',
        tradeoff:
          'Searching the source of truth on every query would be exact, but 4,000 searches a second with a place filter and a date filter would land on the database that also has to book. An index scales on its own and answers fast, at the cost of sometimes showing a stay that was taken seconds ago. That is acceptable only because the booking step decides again.',
        nodes: ['guest', 'search', 'index'],
        travel: [
          ['guest', 'search'],
          ['search', 'index'],
        ],
        short: 'Search',
        metrics: {
          users: '10M',
          requestsPerSecond: '4K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Listings', value: '2M' }],
        },
        load: { search: 40, index: 50 },
      },
      {
        title: 'A quote pins the price',
        narration:
          'Maya opens listing L7. The booking API reads the prices of the four nights and the claims on them from a database reader: 4 nights at 110 plus a cleaning fee of 40, a total of 480. It answers with a quote: listing, nights, total, cancellation policy and an expiry 15 minutes ahead, signed by the service. Nothing is stored. If a night already had a claim, the answer would be "no longer available" here, before any checkout.',
        tradeoff:
          'Pricing again at payment protects the host from an old price and surprises the guest in the middle of a checkout. A quote row in the database is revocable but costs a write for every listing page, 400 a second at peak, for data that is thrown away. A signed quote costs no write and is checked locally; it cannot be revoked, so a price change by the host only reaches quotes issued after it, at most 15 minutes later.',
        nodes: ['guest', 'api', 'db'],
        travel: [
          ['guest', 'api'],
          ['api', 'db'],
        ],
        short: 'Quote',
        metrics: {
          users: '10M',
          requestsPerSecond: '4K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Quotes / s at peak', value: '400' }],
        },
        load: { search: 40, index: 50, api: 25, db: 15 },
      },
      {
        title: 'Two guests, one night',
        narration:
          'The first version of booking reads the calendar, sees the nights free and then writes the booking. Maya asks for 12 to 16 March and Noor for 14 to 18 March on the same listing at the same moment. Both reads see the nights of 14 and 15 March free, both writes succeed, and both guests get a confirmation. One of them arrives at a stay that is already taken.',
        tradeoff:
          'Check then write is simple and passes every test, because the race needs two requests inside a few milliseconds. With 30 holds a second at peak and popular listings it happens, and adding servers makes it more likely, not less. The guard has to live where the data is written, not in the code that runs before the write.',
        nodes: ['guest', 'api', 'db'],
        travel: [
          ['guest', 'api'],
          ['api', 'db'],
        ],
        short: 'Double booked',
        metrics: {
          users: '10M',
          requestsPerSecond: '4K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Double bookings', value: 'A few a week', alert: true }],
        },
        load: { api: 30, db: 25 },
        traffic: [{ edge: ['api', 'db'], kind: 'failed' }],
      },
      {
        title: 'Claim every night under one key, as a hold',
        narration:
          'Booking now runs one transaction. It adds one to the calendar version of the listing, which also makes writers of that listing take turns, inserts one claim row per night in date order, inserts the booking as held with a deadline 10 minutes ahead and the total from the quote, and adds an outbox row for the search index. The primary key of a claim is listing plus night. Noor’s insert hits Maya’s row for 14 March, the whole transaction rolls back and Noor reads "no longer available". The same idempotency key from the same guest returns the same booking.',
        tradeoff:
          'A lock on the listing taken by the application is also correct, but only while every writer remembers to take it: booking, host blocks, release. A unique key is enforced by the database whatever code path writes, and all nights of a stay commit together or not at all. The cost is one row per taken night, and a hold that takes nights off the market for up to 10 minutes whether or not the guest pays; a third of holds are never paid.',
        nodes: ['api', 'db'],
        travel: [['api', 'db']],
        short: 'Claim and hold',
        metrics: {
          users: '10M',
          requestsPerSecond: '4K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Holds / s at peak', value: '30' },
            { label: 'Hold p95', value: '80 ms' },
            { label: 'Double bookings', value: '0' },
          ],
        },
        load: { api: 30, db: 30 },
      },
      {
        title: 'Authorize the card',
        narration:
          'Maya presses pay. The API first writes a payment attempt row in the state "started", keyed by the booking and the payment key of this press, and only then calls the payment provider to authorize 480, with the attempt id as reference, an idempotency key made of that id and the operation, and a timeout of 10 seconds. No database transaction is open during the call. An authorization holds the money on the card and moves none. A decline is recorded and answered 402; after three declines no new authorization starts.',
        tradeoff:
          'Charging in one step is one call fewer, but then a booking that loses its hold in the middle of a payment needs a refund, which takes days to reach the guest. Authorizing first costs a second call later, and in exchange a lost hold only needs a void and no money moves. Writing the attempt before the call costs one more write, and it is what lets anyone find a payment whose answer was lost.',
        nodes: ['api', 'db', 'payments'],
        travel: [
          ['api', 'db'],
          ['api', 'payments'],
        ],
        short: 'Authorize',
        metrics: {
          users: '10M',
          requestsPerSecond: '4K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Authorizations / s', value: '20' },
            { label: 'Authorize p95', value: '1.5 s' },
          ],
        },
        load: { api: 30, db: 30, payments: 35 },
      },
      {
        title: 'One write confirms, then capture',
        narration:
          'With the authorization in hand, one transaction updates the booking from held to confirmed, with the condition that it is still held, records the attempt as authorized and as the one that confirmed, and adds an outbox row for the "confirmed" event. Then the API captures the money under the same attempt id, with the key of the capture, and marks the attempt captured. If the conditional write finds the booking no longer held, because it was released or because another press of pay confirmed it first, this authorization captures nothing and is voided. Maya reads "confirmed".',
        tradeoff:
          'Capturing before the booking is confirmed would make sure of the money first, and would turn every lost hold into a refund. Confirming first means that for a moment the guest owns a stay whose money is authorized but not yet captured, so a crash between the two steps must be finished by someone else. The next stages add that someone.',
        nodes: ['api', 'db', 'payments'],
        travel: [
          ['api', 'db'],
          ['api', 'payments'],
        ],
        short: 'Confirm',
        metrics: {
          users: '10M',
          requestsPerSecond: '4K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Confirmed / s at peak', value: '20' }],
        },
        load: { api: 30, db: 30, payments: 35 },
      },
      {
        title: 'Unpaid holds give their nights back',
        narration:
          'A worker joins. Every 30 seconds it looks for bookings that are still held more than 60 seconds after their deadline. For each one it runs the release transaction: add one to the calendar version of the listing, update the booking from held to released with the condition that it is still held, delete its claims and add an outbox row for the index. If the booking is no longer held, the transaction rolls back and changes nothing. A guest who gives up a hold early runs the same transaction through the API. The nights of an unpaid hold are free again 11 to 11.5 minutes after it was placed.',
        tradeoff:
          'Letting the next guest take over an expired hold inside their own booking frees the night at the very second of the deadline, and gives the same state change two owners, one of them racing a payment in flight. One release transaction with one condition is easier to prove right: release and confirm both require "held", so one of them wins. The cost is a night that stays blocked for up to 90 seconds past the deadline, which also gives a payment that started in time 60 seconds to finish.',
        nodes: ['worker', 'db'],
        travel: [['worker', 'db']],
        short: 'Release',
        metrics: {
          users: '10M',
          requestsPerSecond: '4K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Releases / s at peak', value: '10' },
            { label: 'Night back after', value: '11 to 11.5 min' },
          ],
        },
        load: { worker: 25, db: 30 },
      },
      {
        title: 'Finish what a crash left half done',
        narration:
          'The API can die between any two steps. On a second loop, also every 30 seconds and separate from the releases so that a slow provider cannot delay them, the worker reads the unfinished payment attempts whose last call to the provider began more than 60 seconds ago; the API stamps that time on the attempt before every call. The worker takes an attempt with the same stamp: a short update, committed before any call, that sets the time to now only if it is still more than 60 seconds old, so one of the two worker tasks gets it and no database lock is held while the provider answers. An attempt still "started" is looked up at the provider by its id: if it was authorized and the booking is still held, the worker runs the same conditional confirm; if the provider has no such payment, the attempt is marked failed, with the condition that no newer call was stamped meanwhile. The authorized attempt that confirmed a booking is captured. Any other authorized attempt, one whose booking was released or was confirmed by a different attempt, is voided. Every call carries the attempt id and the key of its operation, so a repeat is the same operation to the provider.',
        tradeoff:
          'A webhook from the provider would bring the result without polling, and adds a public endpoint, signature checks and a second path into the same state change. Asking the provider about our own unfinished rows needs nothing new and works when our side was the one that failed. The cost is a delay: a payment whose answer was lost is settled 60 to 90 seconds later, unless the app repeats the call first.',
        nodes: ['worker', 'db', 'payments'],
        travel: [
          ['worker', 'db'],
          ['worker', 'payments'],
        ],
        short: 'Repair',
        metrics: {
          users: '10M',
          requestsPerSecond: '4K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Repair after', value: '60 to 90 s' }],
        },
        load: { worker: 30, db: 30, payments: 35 },
      },
      {
        title: 'Search and events follow through an outbox',
        narration:
          'Every transaction that changes a calendar left an outbox row. Once a second the worker takes a batch of pending rows: one short transaction stamps them as taken, which makes the other task pass over them for 10 seconds, and commits before anything is sent. For an index row it reads the listing with its current calendar version and taken nights from the writer and writes the document with that version as an external version, so the index refuses anything that is not newer than what it has. Such a refusal, a version conflict, means the index already holds this version or a later one, and the relay counts the row as delivered. For an event row it publishes "confirmed" or "cancelled" to a topic. Then it deletes the row; a row that was sent and not deleted, because the task died in between, is taken and sent again. A night that was taken leaves search results about 2 seconds later.',
        tradeoff:
          'Updating the index inside the booking request is a dual write: a crash after the commit leaves search wrong until the next change, and an index outage would fail bookings. The outbox commits with the change and is delivered at least once, made harmless by the calendar version for the index and by the event id for consumers. The cost is a table, a relay and a few seconds of staleness, which the unique key already covers.',
        nodes: ['worker', 'db', 'index', 'events'],
        travel: [
          ['worker', 'db'],
          ['worker', 'index'],
          ['worker', 'events'],
        ],
        short: 'Outbox',
        metrics: {
          users: '10M',
          requestsPerSecond: '4K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Index updates / s', value: '57' },
            { label: 'Index lag', value: '~2 s' },
          ],
        },
        load: { worker: 35, db: 30, index: 50, events: 15 },
      },
      {
        title: 'Cancel: nights back, refund due',
        narration:
          'On 3 March Maya cancels. One transaction adds one to the calendar version, updates the booking from confirmed to cancelled, with the condition that it is still confirmed and check-in has not passed, computes the refund from the policy copied onto the booking (full until 5 days before check-in, so 480), stores it as pending, deletes the claims and adds outbox rows for the index and for the "cancelled" event. After the commit the API asks the provider for the refund with a key derived from the booking id and marks it done. If that call is lost, the worker repeats it with the same key. If the payment is not captured yet, the API sends no refund and leaves it to the worker, which captures first.',
        tradeoff:
          'Refunding first and freeing the nights after keeps money and state in step only until a crash between them, and makes a slow provider slow down the calendar. Recording the refund as due in the same commit that frees the nights makes the cancellation final at once, and leaves the money as a step that can be repeated safely. The cost is a guest who reads "cancelled, refund on its way" before the provider has it.',
        nodes: ['guest', 'api', 'db', 'payments'],
        travel: [
          ['guest', 'api'],
          ['api', 'db'],
          ['api', 'payments'],
        ],
        short: 'Cancel',
        metrics: {
          users: '10M',
          requestsPerSecond: '4K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Cancellations / s', value: '2' }],
        },
        load: { api: 30, db: 30, payments: 35 },
      },
      {
        title: 'A host edits the calendar mid-checkout',
        narration:
          'While another guest is paying for a hold on listing L7, its host raises the price of those nights and then tries to block two of them. The price change commits: rates are separate rows, and the hold keeps the total of its quote. The block is an insert of claim rows marked "blocked by host" under the same unique key, so it fails as a whole and the host is told which nights a guest holds. If the block had come first, the guest’s booking would have failed the same way.',
        tradeoff:
          'Letting the host win would cancel a guest in the middle of a payment; applying the new price to the open checkout would change a total the guest already accepted. Treating a block as one more claim means there is one rule for everyone who wants a night. The cost falls on the host: an old price is honored for up to 15 minutes of quote plus 10 of hold, and a held night can be blocked only after the hold ends.',
        nodes: ['host', 'api', 'db'],
        travel: [
          ['host', 'api'],
          ['api', 'db'],
        ],
        short: 'Host edit',
        metrics: {
          users: '10M',
          requestsPerSecond: '4K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Host changes / s', value: '15' }],
        },
        load: { api: 30, db: 30 },
      },
    ],
  },
  flows: [
    {
      id: 'search',
      title: 'Search a date range and get a quote',
      kind: 'sync',
      summary:
        'Maya searches for 12 to 16 March and opens a listing. Search answers from the index, which may be seconds stale; the quote reads the database and pins the total for 15 minutes.',
      runsOn: 'ALB → search API on ECS → OpenSearch; ALB → booking API on ECS → Aurora reader',
      participants: [
        { id: 'app', label: 'Maya’s app', service: 'Client' },
        { id: 'search', label: 'Search API', service: 'ECS Fargate' },
        { id: 'index', label: 'Search index', service: 'OpenSearch Service' },
        { id: 'api', label: 'Booking API', service: 'ECS Fargate' },
        { id: 'reader', label: 'Bookings DB reader', service: 'Aurora PostgreSQL' },
      ],
      steps: [
        {
          from: 'app',
          to: 'search',
          label: 'GET /search?place=…&checkIn=03-12&checkOut=03-16&guests=2',
          note: 'A stay from 12 to 16 March is four nights: 12, 13, 14 and 15. The night of the check-out date is not part of it, so another guest can check in on the 16th.',
        },
        {
          from: 'search',
          to: 'index',
          label: 'query: area, capacity ≥ 2, no taken night in 03-12..03-15',
          note: 'Each listing is one document with a location, a capacity, a base price and the list of its taken nights. The query keeps listings in the area and excludes any document with a taken night inside the range. Searches peak at 4,000 a second.',
        },
        {
          from: 'index',
          to: 'search',
          label: '20 listings, L7 among them',
          style: 'reply',
          note: 'The index is normally about 2 seconds behind the calendar. A listing whose night was claimed in that window can still appear here; the next steps catch it.',
        },
        {
          from: 'search',
          to: 'app',
          label: '200, page of 20 with base prices',
          style: 'reply',
          note: 'The price in a result is the base nightly price of the listing, an indication. The total for these dates comes from the quote.',
        },
        {
          from: 'app',
          to: 'api',
          label: 'POST /quotes {L7, 03-12, 03-16, 2 guests}',
          note: 'Sent when Maya opens the listing with her dates. About one search in ten leads here: 400 quotes a second at peak.',
        },
        {
          from: 'api',
          to: 'reader',
          label: 'read rates and claims of L7, 03-12..03-15',
          note: 'One read on a reader instance, usually well under 100 ms behind the writer. If any of the four nights has a claim, the answer is 409 "no longer available": the stale search result stops here, before a checkout starts. This check is advisory; only the booking transaction decides.',
        },
        {
          from: 'api',
          to: 'app',
          label: 'quote {L7, 4 nights, 480, policy, expires in 15 min}, signed',
          style: 'reply',
          note: '4 nights at 110 plus a cleaning fee of 40. The quote is signed with a key only the booking service reads and is not stored, so 400 quotes a second cost the writer nothing.',
        },
      ],
    },
    {
      id: 'hold-and-pay',
      title: 'Hold a stay and pay',
      kind: 'sync',
      summary:
        'Maya books the four nights and pays. One transaction claims every night as a hold; the card is authorized, one conditional write confirms the booking, and then the money is captured.',
      runsOn: 'ALB → booking API on ECS → Aurora writer → payment provider',
      participants: [
        { id: 'app', label: 'Maya’s app', service: 'Client' },
        { id: 'api', label: 'Booking API', service: 'ECS Fargate' },
        { id: 'db', label: 'Bookings DB', service: 'Aurora PostgreSQL writer' },
        { id: 'pay', label: 'Payments', service: 'External provider' },
      ],
      steps: [
        {
          from: 'app',
          to: 'api',
          label: 'POST /bookings {quote, idempotencyKey k1}',
          note: 'A repeat is recognized by its key before anything else, in the next step. For a new request the API verifies the signature and the expiry of the quote without calling anything; an expired quote is answered 410 and the app asks for a new one.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'read booking by (Maya, k1), then claims of L7 03-12..03-15',
          note: 'If a booking with this key exists it is returned as it is, so a repeat after a lost answer changes nothing. If any night already has a claim the answer is 409 without opening a transaction; this read sheds most losers on a popular listing, and it is not what guarantees anything.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'transaction: version + 1, 4 claims, booking b81 held, outbox row',
          note: 'Update the listing, only if it is active, adding one to its calendar version; insert the claims for 12, 13, 14 and 15 March in date order; insert booking b81 as held with a deadline 10 minutes ahead by the database clock, the total 480 and the policy from the quote; insert an outbox row "index L7". A unique violation rolls everything back. The API then reads by (Maya, k1) again: if the violation came from a concurrent repeat of this same request, that booking is returned; if not, the answer is 409. A paused listing matches no row in the first update: the transaction rolls back and the answer is 409 as well.',
        },
        {
          from: 'api',
          to: 'app',
          label: '201 {b81, held until 10:10}',
          style: 'reply',
          note: 'The nights are off the market for everyone else from this commit. The app shows the provider’s card form and a countdown.',
        },
        {
          from: 'app',
          to: 'api',
          label: 'POST /bookings/b81/pay {token, paymentKey p1}',
          note: 'The API checks that b81 belongs to Maya, is still held and that its deadline has not passed. A new attempt after the deadline is answered 410; a repeat of an attempt that started in time is still served.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'insert attempt (b81, p1) started',
          note: 'Written before the provider is called, so a payment whose answer is lost can be found by its id. The same paymentKey maps to the same row: a repeat stamps the row with the time of the new call if it is still started, and an attempt that already ended calls nobody. Declined answers 402 again. Failed, which means the provider never received it, answers 409 and the app starts a new attempt with a new key. A voided attempt belongs to a booking that is no longer held, which the previous step already answered: 410 if it was released, 200 if another attempt confirmed it. A booking with three declined attempts gets 402 here and no new authorization.',
        },
        {
          from: 'api',
          to: 'pay',
          label: 'authorize 480, reference = attempt id, key = attempt id:authorize',
          note: 'Timeout 10 seconds, no database transaction open. Authorized: continue. Declined: mark the attempt declined and answer 402. No answer: answer 202 "pending" and leave the attempt started; the app calls again with p1, and the provider returns the result of the first call for that key.',
        },
        {
          from: 'api',
          to: 'db',
          label:
            'transaction: b81 held → confirmed if still held, attempt authorized, outbox event',
          note: 'The one write that decides. It updates the booking only if its state is still held and records which attempt confirmed it; the attempt becomes authorized and takes the time of the capture call that comes next, so that stamp costs no write of its own. If no row changes, the API reads the booking to see why. Confirmed by this same attempt, through a concurrent repeat or the worker: it goes on to the capture and answers 200. Confirmed by another attempt, a second press of pay: it voids this authorization and answers 200 with the booking. Released: it voids this authorization and answers 410. An authorization that is voided moves no money.',
        },
        {
          from: 'api',
          to: 'pay',
          label: 'capture, key = attempt id:capture',
          note: 'Money moves only after the booking is confirmed. If this call fails or the API dies here, the booking stays confirmed and the worker captures on a later pass.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'attempt captured',
          note: 'A conditional update from authorized to captured. A repeat finds it done.',
        },
        {
          from: 'api',
          to: 'app',
          label: '200 {b81, confirmed}',
          style: 'reply',
          note: 'A repeat of this call, from a retry or a second tap, reads the booking as confirmed and answers 200 without touching the provider.',
        },
      ],
    },
    {
      id: 'race',
      title: 'Two guests, overlapping nights, same instant',
      kind: 'sync',
      summary:
        'Maya asks for 12 to 16 March and Noor for 14 to 18 March on listing L7 in the same millisecond. Both pass the early read. The unique key lets one transaction commit and makes the other fail as a whole.',
      runsOn: 'Booking API on ECS → Aurora writer',
      participants: [
        { id: 'maya', label: 'Maya’s app', service: 'Client' },
        { id: 'noor', label: 'Noor’s app', service: 'Client' },
        { id: 'api', label: 'Booking API', service: 'ECS Fargate' },
        { id: 'db', label: 'Bookings DB', service: 'Aurora PostgreSQL writer' },
      ],
      steps: [
        {
          from: 'maya',
          to: 'api',
          label: 'POST /bookings {quote 03-12..03-16, key k1}',
          note: 'Nights 12, 13, 14 and 15 March. Handled by one API task.',
        },
        {
          from: 'noor',
          to: 'api',
          label: 'POST /bookings {quote 03-14..03-18, key k7}',
          note: 'Nights 14, 15, 16 and 17 March, on another task at the same instant. The two stays share the nights of 14 and 15.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'both: read claims of their nights → none',
          note: 'Neither has committed, so both early reads find the nights free. This is the gap that check then write cannot close.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'Maya: version + 1 on L7, insert 4 claims, booking held, commit',
          note: 'The update of the listing row takes its row lock. Maya’s transaction gets it first, inserts its rows and commits in a few milliseconds.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'Noor: waits for the row of L7, then insert 4 claims',
          note: 'Noor’s update of the same listing row waits for Maya’s commit, for at most 2 seconds; past that it would give up and be answered 503 with Retry-After, which the app repeats with the same key. Here the wait is a few milliseconds. Then it inserts 14 March, which already has a row.',
        },
        {
          from: 'db',
          to: 'api',
          label: 'unique violation on (L7, 03-14)',
          style: 'reply',
          note: 'The database refuses the row, and the whole transaction rolls back: no claim for 16 or 17 March is left behind, no booking, no version change. Without the wait on the listing row the result would be the same, because the key decides; the wait only puts the two in order.',
        },
        {
          from: 'api',
          to: 'maya',
          label: '201 {b81, held}',
          style: 'reply',
          note: 'Maya holds all four nights.',
        },
        {
          from: 'api',
          to: 'noor',
          label: '409 {no longer available}',
          style: 'reply',
          note: 'The API finds no booking under (Noor, k7), so this was a real conflict and not a repeat. Noor is charged nothing: payment starts only after a hold exists.',
        },
      ],
    },
    {
      id: 'confirm-crash',
      title: 'The card is authorized and the API dies before confirming',
      kind: 'async',
      summary:
        'The provider authorized 480 for Maya, and the API task crashed before the confirming write. The attempt row written before the call lets a repeat from the app, or the worker, finish the booking.',
      runsOn: 'Booking API on ECS → payment provider; worker on ECS → provider → Aurora writer',
      participants: [
        { id: 'app', label: 'Maya’s app', service: 'Client' },
        { id: 'api', label: 'Booking API', service: 'ECS Fargate' },
        { id: 'db', label: 'Bookings DB', service: 'Aurora PostgreSQL writer' },
        { id: 'pay', label: 'Payments', service: 'External provider' },
        { id: 'worker', label: 'Worker', service: 'ECS Fargate' },
      ],
      steps: [
        {
          from: 'api',
          to: 'db',
          label: 'insert attempt (b81, p1) started',
          note: 'Committed before the provider is called. From here on there is a durable record that a payment may exist.',
        },
        {
          from: 'api',
          to: 'pay',
          label: 'authorize 480, key = attempt id:authorize → authorized',
          note: 'The provider holds 480 on the card. The API task is killed before it writes anything else. Booking b81 is still held and the attempt still says started.',
        },
        {
          from: 'app',
          to: 'api',
          label: 'POST /bookings/b81/pay {token, p1} again',
          note: 'The app got a connection error and repeats with the same paymentKey. Another task finds the attempt row, calls authorize with the same key and gets the first authorization back, not a second one. It then confirms and captures as usual. This is the common ending, seconds after the crash.',
        },
        {
          from: 'worker',
          to: 'db',
          label: 'stamp attempt (b81, p1) if its last call began over 60 s ago',
          note: 'If the app never comes back, the worker finds the attempt on its first pass after its last call is 60 seconds old, so 60 to 90 seconds after the press; the API call timed out long before. The worker takes the attempt as the API does before a call: one update sets the time of the last call to now, only if it is still more than 60 seconds old, and commits at once. If both worker tasks try, the second finds the time fresh, changes no row and moves on. No lock is held from here on. A task that dies after this stamp, before its call or after it, leaves an unfinished attempt whose time grows old again, so it is taken 60 to 90 seconds later and the calls are repeated under the same keys.',
        },
        {
          from: 'worker',
          to: 'pay',
          label: 'look up payment by attempt id → authorized',
          note: 'The provider answers with the state of the payment for that reference. "No such payment" marks the attempt failed, unless the API stamped a newer call on it meanwhile; "declined" marks it declined. A repeat from the app that arrives right now is not held back: the API stamps without that 60-second condition, because a guest is waiting, and authorizes under the same key, so both reach the next step with the same authorization. A provider that does not answer leaves the attempt for a later pass, once the stamp is 60 seconds old again.',
        },
        {
          from: 'worker',
          to: 'db',
          label:
            'transaction: b81 held → confirmed if still held, attempt authorized, outbox event',
          note: 'The same transaction the API would have run, in the same order: the booking first, then the attempt. The worker starts it holding no lock, because its claim was a committed stamp. If the app’s repeat got there first, the booking is already confirmed by this same attempt and the worker has nothing to change. If the hold was released first, no row changes and the worker voids the authorization.',
        },
        {
          from: 'worker',
          to: 'pay',
          label: 'capture, key = attempt id:capture',
          note: 'A capture repeated with the same key is the same capture to the provider, so the worker and a late API retry cannot charge twice.',
        },
        {
          from: 'worker',
          to: 'db',
          label: 'attempt captured',
          note: 'Maya finds the booking confirmed in her bookings, and the "confirmed" event reaches the service that emails her.',
        },
      ],
    },
    {
      id: 'hold-expires',
      title: 'A hold runs out unpaid',
      kind: 'scheduled',
      summary:
        'Noor holds a stay and closes the tab. The worker releases the booking 60 seconds after its deadline in one conditional transaction, and the nights return to search a moment later.',
      runsOn: 'Worker on ECS, every 30 s → Aurora writer → OpenSearch',
      participants: [
        { id: 'worker', label: 'Worker', service: 'ECS Fargate' },
        { id: 'db', label: 'Bookings DB', service: 'Aurora PostgreSQL writer' },
        { id: 'pay', label: 'Payments', service: 'External provider' },
        { id: 'index', label: 'Search index', service: 'OpenSearch Service' },
      ],
      steps: [
        {
          from: 'worker',
          to: 'db',
          label: 'bookings held, deadline more than 60 s ago',
          note: 'Every 30 seconds, on each of the two worker tasks, by the database clock. A plain read that locks nothing: if both tasks pick the same hold, the condition in the next step lets one of them release it and the other changes nothing.',
        },
        {
          from: 'worker',
          to: 'db',
          label:
            'transaction: version + 1, b90 held → released if still held, delete claims, outbox row',
          note: 'The condition is what makes this safe against a payment finishing at the same moment: confirm and release both need "held", and the row lock lets one of them see it. The listing row is updated first, as in every transaction that changes a calendar. If the booking was confirmed meanwhile, or the other task released it, no row changes, the transaction rolls back and the claims of a confirmed booking stay.',
        },
        {
          from: 'worker',
          to: 'db',
          label: 'attempts of b90 that are started or authorized',
          note: 'Usually none: the guest never pressed pay. An attempt that was authorized and lost this race is found by the money loop of the worker, which runs apart from the releases.',
        },
        {
          from: 'worker',
          to: 'pay',
          label: 'void, key = attempt id:void, if there was one',
          note: 'An attempt still started is looked up first; an authorized one is voided under the key of its void, and "nothing to void" is a final answer too. No money moved, so there is nothing to refund.',
        },
        {
          from: 'worker',
          to: 'db',
          label: 'take pending outbox rows, read L9 with version and taken nights',
          note: 'The outbox pass runs every second. A short transaction stamps a batch of pending rows as taken and commits, so no lock is held while the index is called. Then the worker reads the listing from the writer, so the version and the nights come from one consistent read.',
        },
        {
          from: 'worker',
          to: 'index',
          label: 'index document L9, external version = calendar version',
          note: 'The index accepts the document only if this version is higher than the one it has. Two tasks or a late retry cannot put an older calendar over a newer one. When the index answers with a version conflict it already has this calendar or a newer one, so the relay treats that answer as delivered. The nights show up in search after the next refresh of the index, one second by default.',
        },
        {
          from: 'worker',
          to: 'db',
          label: 'delete the outbox row',
          note: 'If the worker dies before this, the row is still pending, and once its stamp is 10 seconds old a task takes it and delivers it again. The index answers that repeat with a version conflict, which counts as delivered, so the row is deleted then. Noor’s nights are bookable again 11 to 11.5 minutes after she held them.',
        },
      ],
    },
    {
      id: 'cancel',
      title: 'Cancel and refund under the policy',
      kind: 'sync',
      summary:
        'Maya cancels nine days before check-in. One transaction cancels the booking, frees the nights and records the refund due; the refund is then sent under a key that makes repeats harmless.',
      runsOn: 'Booking API on ECS → Aurora writer → payment provider; worker as the repair',
      participants: [
        { id: 'app', label: 'Maya’s app', service: 'Client' },
        { id: 'api', label: 'Booking API', service: 'ECS Fargate' },
        { id: 'db', label: 'Bookings DB', service: 'Aurora PostgreSQL writer' },
        { id: 'pay', label: 'Payments', service: 'External provider' },
        { id: 'worker', label: 'Worker', service: 'ECS Fargate' },
      ],
      steps: [
        {
          from: 'app',
          to: 'api',
          label: 'POST /bookings/b81/cancel',
          note: 'On 3 March, for a check-in on 12 March. The API checks that the caller is the guest of b81 or the host of its listing.',
        },
        {
          from: 'api',
          to: 'db',
          label:
            'transaction: version + 1, b81 confirmed → cancelled if still confirmed, refund 480 pending, delete claims, 2 outbox rows',
          note: 'The refund comes from the policy copied onto the booking when it was held: full until 5 days before check-in, half after that, counted in the time zone of the listing. A host cancelling refunds the full total. The refund is stored with the time of the call that follows, as an attempt is. The outbox rows are "index L7" and the "cancelled" event. If no row changes because the booking is already cancelled, the transaction rolls back, the stored refund is returned and nothing is computed again.',
        },
        {
          from: 'api',
          to: 'app',
          label: '200 {cancelled, refund 480 on its way}',
          style: 'reply',
          note: 'The cancellation is final at the commit and the nights are free for other guests. The money is one more step, already recorded as due.',
        },
        {
          from: 'api',
          to: 'pay',
          label: 'refund 480 of the captured attempt, key = b81:refund',
          note: 'Sent right after the commit, and only because the attempt of b81 is already marked captured. A cancellation that lands in the seconds between the confirmation and the capture skips this call and the next step, and leaves the refund pending for the worker. One refund per booking: the key is derived from the booking id, so sending it again is the same refund to the provider.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'refund pending → done',
          note: 'A conditional update. If the API died before the refund call or before this write, the refund stays pending.',
        },
        {
          from: 'worker',
          to: 'db',
          label: 'stamp refunds pending, last call over 60 s ago',
          note: 'On its pass every 30 seconds, taken like an attempt: a committed update of the time of its last call, only if that time is still more than 60 seconds old. If the attempt of the booking is not captured yet, the worker captures it first and refunds after, so a refund always has a captured payment under it. If that capture is in review, no money was collected: the worker moves the refund to review with it, and the person who has the capture voids the authorization.',
        },
        {
          from: 'worker',
          to: 'pay',
          label: 'refund 480, key = b81:refund',
          note: 'The same key, so a refund the API already sent is not sent twice. Errors and timeouts are tried again every 60 to 90 seconds for up to 12 hours; three refusals by the provider, or 12 hours without success, put the refund in review and page a person.',
        },
        {
          from: 'worker',
          to: 'db',
          label: 'refund pending → done',
          note: 'Normally 60 to 90 seconds after the cancellation at the latest. How long the bank takes to show the money on the card is outside the design.',
        },
      ],
    },
    {
      id: 'host-edit',
      title: 'A host changes price and availability during a checkout',
      kind: 'sync',
      summary:
        'Maya holds four nights of listing L7 and is paying. The host raises the price of those nights and then tries to block two of them. The price change commits and does not touch the hold; the block is refused by the unique key.',
      runsOn: 'Booking API on ECS → Aurora writer',
      participants: [
        { id: 'maya', label: 'Maya’s app', service: 'Client' },
        { id: 'host', label: 'Host’s app', service: 'Client' },
        { id: 'api', label: 'Booking API', service: 'ECS Fargate' },
        { id: 'db', label: 'Bookings DB', service: 'Aurora PostgreSQL writer' },
      ],
      steps: [
        {
          from: 'maya',
          to: 'api',
          label: 'POST /bookings {quote 480, key k1} → 201 held',
          note: 'Booking b81 holds 12 to 15 March with the total of the quote, 480, copied onto it.',
        },
        {
          from: 'host',
          to: 'api',
          label: 'PUT /listings/L7/calendar {03-12..03-15, price 150}',
          note: 'The API checks that the caller is the host of L7.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'transaction: version + 1, upsert 4 rates, outbox row',
          note: 'Rates and claims are different rows, so a price change never conflicts with a hold. It commits, and the next quote for those nights uses 150.',
        },
        {
          from: 'api',
          to: 'host',
          label: '200 {price set}',
          style: 'reply',
          note: 'The host is told that the nights are held by a guest at the earlier price. Quotes signed before the change stay valid until they expire, at most 15 minutes later.',
        },
        {
          from: 'host',
          to: 'api',
          label: 'PUT /listings/L7/calendar {03-14, 03-15, blocked}',
          note: 'The host now wants two of the nights back.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'transaction: version + 1, insert 2 claims "blocked by host"',
          note: 'A block is a claim like any other, inserted for each night that this host has not blocked already, which is why a repeat of a block inserts nothing. Both nights already have a row that belongs to b81, so the insert violates the unique key and the transaction rolls back. The API then reads which of the nights a guest has, for the answer.',
        },
        {
          from: 'api',
          to: 'host',
          label: '409 {held by a guest: 03-14, 03-15}',
          style: 'reply',
          note: 'Nothing was blocked, not even a part. If Maya’s hold is released the host can block the nights then; if she pays, the host can only cancel the booking, with a full refund.',
        },
        {
          from: 'maya',
          to: 'api',
          label: 'POST /bookings/b81/pay {token, p1} → 200 confirmed',
          note: 'The authorization is for 480, the total on the booking. The price of 150 applies to nobody who already holds a quote or a hold.',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'How do we guarantee a night is never sold twice?',
      options: [
        {
          name: 'Check, then insert in the application',
          pros: 'Easy to write and read.',
          cons: 'Two requests can both pass the check before either writes, and more servers make that more likely.',
        },
        {
          name: 'Lock the listing row, then check for overlaps',
          pros: 'Correct, and simple to reason about for one code path.',
          cons: 'Correct only while every writer takes the lock: booking, host blocks, release. One path that forgets it sells a night twice, and nothing in the data stops it.',
        },
        {
          name: 'Distributed lock in a cache',
          pros: 'Works across services and databases.',
          cons: 'Another system to run, and a lease that expires during a pause lets two writers through unless the database checks a fencing token anyway.',
        },
        {
          name: 'Unique key on listing and night',
          pros: 'The database refuses the second row whatever code wrote it, and different dates of one listing never conflict.',
          cons: 'One row per taken night, and a stay of several nights needs all its rows in one transaction.',
        },
      ],
      choice:
        'The unique key on listing and night, with all the rows of a stay inserted in one transaction. The transaction also adds one to the calendar version on the listing row, which makes writers of one listing take turns for a few milliseconds; that orders them and gives the index a version, but the guarantee is the key. A read of the claims before the transaction sheds most losers early and guarantees nothing.',
    },
    {
      question: 'What is the unit of inventory: how is a calendar stored?',
      options: [
        {
          name: 'A date range on each booking, with an exclusion constraint against overlaps',
          pros: 'One row per booking, however long the stay, and the database still refuses overlaps.',
          cons: 'Tied to one database’s range types and index. Host blocks and holds need the same constraint, and "which nights of this listing are taken" becomes a range computation for search.',
        },
        {
          name: 'A row for every listing and night, free or not, with a status and a price',
          pros: 'A booking is a conditional update of existing rows, and the price lives next to the night.',
          cons: '2 million listings times 365 nights is 730 million rows, most of them saying "free", rewritten as the calendar moves forward.',
        },
        {
          name: 'A row only for a taken night, keyed by listing and night',
          pros: 'A free night costs nothing, the primary key is the guarantee, and holds, bookings and host blocks are the same kind of row.',
          cons: 'Availability is the absence of a row, so a range check reads the rows of the range, and prices need their own table.',
        },
      ],
      choice:
        'A claim row only for a taken night. A night is a local date of the listing, and a stay from 12 to 16 March claims the nights of 12, 13, 14 and 15. The row points at the booking that took it or says "blocked by host"; whether it is a hold or a confirmed stay is read from the booking, so there is one place where state changes. Prices are rate rows that override the base price of the listing.',
    },
    {
      question: 'How is a stay of several nights booked so that it is all or nothing?',
      options: [
        {
          name: 'Claim night by night, and undo on the first failure',
          pros: 'Each step is a small write.',
          cons: 'A crash in the middle leaves some nights claimed with no booking, and two overlapping guests can each take half and both fail.',
        },
        {
          name: 'One transaction that inserts every night in date order',
          pros: 'All nights commit together or none does. Inserting in date order means two overlapping stays meet at the same first night and cannot deadlock.',
          cons: 'All the nights of a listing must live in one database, which later fixes the shard key.',
        },
        {
          name: 'A two-phase commit across stores',
          pros: 'Works when nights live in different databases.',
          cons: 'Slow, and a coordinator that dies between the phases leaves nights locked. Nothing here needs it.',
        },
      ],
      choice:
        'One transaction per stay: add one to the calendar version, insert up to 30 claim rows in date order, insert the booking and the outbox row. A unique violation on any night rolls back all of it, so no partial stay exists at any moment. The limit of 30 nights keeps the transaction small.',
    },
    {
      question: 'How does a hold end, and who releases it?',
      options: [
        {
          name: 'A lock with a time to live in a cache',
          pros: 'Expires by itself, with no job to run.',
          cons: 'The cache and the database can disagree, and the lock can expire while a payment is in flight with nothing to stop the confirmation.',
        },
        {
          name: 'A deadline on the booking, and the next guest takes over an expired hold',
          pros: 'A night is bookable at the very second its hold expires.',
          cons: 'Two owners for the same state change, the worker and any booking request, and the takeover races the payment of the first guest.',
        },
        {
          name: 'A delayed message per hold',
          pros: 'Each hold is released close to its own deadline.',
          cons: 'A message to keep in step with the row: lost, late or duplicated, it has to be checked against the booking anyway.',
        },
        {
          name: 'A deadline on the booking and one release transaction run by a worker',
          pros: 'One state change with one condition. The row is the only source of truth, and a worker that stops only delays releases.',
          cons: 'A night stays blocked for up to 90 seconds past the deadline.',
        },
      ],
      choice:
        'The deadline on the booking and one release transaction: add one to the calendar version, held to released if still held, delete the claims, add the outbox row. The worker runs it for holds more than 60 seconds past their deadline, on a pass every 30 seconds; the guest can run it early through the API. Confirm requires "held" too, so a hold ends confirmed or released and not both. The 60 seconds give a payment that started before the deadline time to finish: the provider timeout is 10 seconds.',
    },
    {
      question: 'How do we take the money with a third-party provider and no double charge?',
      options: [
        {
          name: 'Charge in one step, then write the booking',
          pros: 'One call to the provider.',
          cons: 'A crash after the charge leaves money taken and no booking, with no record on our side of which payment to refund.',
        },
        {
          name: 'Wait for the provider’s webhook to confirm',
          pros: 'The provider tells us the result even when our call timed out.',
          cons: 'A public endpoint, signature checks, and events that arrive late, twice or out of order. Still needs a repair for the case where our side failed.',
        },
        {
          name: 'Attempt row first, authorize, one conditional confirm, then capture',
          pros: 'Every provider call has a durable row and an idempotency key behind it. The authorization is reversible until the conditional write has decided, and money moves only after it.',
          cons: 'Two provider calls per booking, and a worker has to finish a capture or a void that a crash left open.',
        },
      ],
      choice:
        'Attempt first, authorize, confirm, capture. The attempt id is the reference of the authorization, the lookup, the capture and the void, and each of the three that change something carries its own idempotency key, made of the attempt id and the operation, so a repeat of any of them is the same operation to the provider. Only the attempt recorded on the confirmed booking is ever captured, so two presses of pay cannot charge twice; every other authorization is voided. The API stamps the attempt with the time of each call before making it. On its pass every 30 seconds the worker takes any unfinished attempt whose last call began more than 60 seconds ago with the same stamp: a committed update that changes the row only if the time is still that old, so one worker task has the step and no lock or transaction is open while the provider is called. The stamp only avoids doing the work twice. What makes a repeat safe, by the other task after a crash or by the app in the middle of a worker call, is the key on every call and the condition on every write. A refusal by the provider counts toward a limit of three and then puts the step in review for a person; errors and timeouts are tried again every 60 to 90 seconds for up to 12 hours and then go to review too.',
    },
    {
      question: 'How does the search index stay in step with the calendar?',
      options: [
        {
          name: 'Search the database directly',
          pros: 'Always exact, nothing to keep in step.',
          cons: '4,000 searches a second with a place filter and a date filter on the database that takes the bookings. Fine for a first version, not at this size.',
        },
        {
          name: 'Update the index inside the booking request',
          pros: 'The index changes as soon as the booking does.',
          cons: 'A dual write: a crash after the commit leaves the index wrong, and an index outage fails bookings.',
        },
        {
          name: 'A change stream from the database log',
          pros: 'Nothing to write in the transaction, and no polling.',
          cons: 'A connector and a stream to run and monitor, for about 57 index updates a second at peak.',
        },
        {
          name: 'An outbox row in the transaction, and a relay that writes versioned documents',
          pros: 'The row commits with the change, so no change is missed. The relay reads the current calendar and writes it with the calendar version, so repeats and reordering cannot put old over new.',
          cons: 'A table to drain and a worker to run, and the index is a second or two behind.',
        },
      ],
      choice:
        'The outbox with versioned documents. The row only says "index listing L"; a relay task takes a batch of rows by stamping them in a short transaction that commits before anything is sent, reads the listing from the writer and writes the whole document, taken nights included, with the calendar version as external version. Delivery is at least once, made harmless by that version: when the index answers a write with a version conflict it already holds that version or a newer one, and the relay counts the row as delivered and deletes it. A task that dies between the send and the delete leaves the row pending, and it is sent again 10 seconds after its stamp. A document the index rejects for any other reason is tried five times and then parked for a person; an index that is down or throttling counts against nothing, and its rows are taken again every 10 seconds until it answers. The database stays the source of truth, and a rebuild command can refill the whole index from it.',
    },
    {
      question: 'What happens when search shows a stay that is already gone?',
      options: [
        {
          name: 'Check every search result against the database before returning it',
          pros: 'Results are exact at the moment they are returned.',
          cons: '20 results per page at 4,000 searches a second is 80,000 lookups a second on the database, and the result can still be gone a second later.',
        },
        {
          name: 'Hide a listing from search as soon as someone opens its checkout',
          pros: 'Fewer guests walk into a conflict.',
          cons: 'Takes listings off the market for guests who are only looking, and it is one more signal to keep in step.',
        },
        {
          name: 'Accept stale results, warn at the quote, decide at the hold',
          pros: 'Search stays cheap. The quote reads the database and stops most stale clicks before a checkout; the booking transaction is exact.',
          cons: 'Now and then a guest clicks a result and reads "no longer available".',
        },
      ],
      choice:
        'Accept, warn, decide. The index is about 2 seconds behind, so few clicks land on a taken night, and the quote catches most of those with a read. The booking transaction answers 409 for the rest. The share of 409 answers among quote requests is watched, because the quote is where a stale result shows: when it rises for minutes on end, the index is behind or one listing is very popular.',
    },
    {
      question: 'How do we handle a hot listing or a date everyone wants?',
      options: [
        {
          name: 'A waiting room in front of the listing',
          pros: 'Flat load however many guests arrive.',
          cons: 'Built for thousands of units behind one door. A listing has one unit per night: the first commit ends the contest, and a line would only delay the answer for everyone else.',
        },
        {
          name: 'A lock per listing in a cache, taken before the database',
          pros: 'Keeps the crowd away from the database.',
          cons: 'A second authority to keep honest, for a contest the database settles in a few milliseconds.',
        },
        {
          name: 'Let the unique key decide, and shed the losers before the transaction',
          pros: 'Nothing new to run. After the first commit every other request reads the claim and gets 409 without a transaction.',
          cons: 'The requests that arrive before the first commit wait on the listing row, each holding a database connection for a moment.',
        },
      ],
      choice:
        'The unique key, with the early read in front. If 5,000 guests press book on one listing in the same second, about 25 arrive in the 5 milliseconds before the winner commits; those wait on the listing row for at most 2 seconds and then fail on the key, and the other 4,975 read the claim and get 409 at once. A rate rule at the edge limits requests per address. A date everyone wants is a different case: the load spreads over many listings, which is just the peak the system is sized for.',
    },
    {
      question: 'How does a cancellation free the nights and return the money?',
      options: [
        {
          name: 'Refund at the provider first, then cancel the booking',
          pros: 'The guest has the money before the stay is gone.',
          cons: 'A crash between the two leaves a refunded guest who still owns the nights, and a slow provider keeps the calendar blocked.',
        },
        {
          name: 'Capture only when free cancellation ends',
          pros: 'An early cancellation needs no refund at all, only a void.',
          cons: 'An authorization lapses after some days, so a stay booked months ahead needs a scheduled capture, a new authorization or a deposit, each a job that can fail.',
        },
        {
          name: 'Cancel, free the nights and record the refund due in one transaction, then refund',
          pros: 'The cancellation is final at one commit, and the refund is a repeatable step with its own key.',
          cons: 'Every cancellation is a refund, which costs fees and takes days to show on the card.',
        },
      ],
      choice:
        'One transaction, then the refund. The refund amount comes from the policy copied onto the booking when it was held, so a later change of policy by the host does not reach it, and it is computed with dates in the time zone of the listing. The key of the refund is derived from the booking id, so there is one refund per booking however many times it is sent. The API sends the refund only when the payment is already captured; if it is not, the refund stays pending and the worker captures first and refunds after. If that capture is in review, no money was collected and there is nothing to return: on its next pass the worker moves the refund to review with it instead of waiting behind it, and the person who has the capture voids the authorization.',
    },
    {
      question: 'Which price does the guest pay: the one shown or the one in force at payment?',
      options: [
        {
          name: 'Price again at payment',
          pros: 'The host always gets the current price.',
          cons: 'The total can change between the page and the charge, in the middle of a checkout.',
        },
        {
          name: 'A quote row in the database, referenced by id',
          pros: 'Can be revoked, and the service can list open quotes.',
          cons: 'A write on the database for every listing page, 400 a second at peak, most of them never used.',
        },
        {
          name: 'A signed quote with an expiry',
          pros: 'No storage and no lookup: the service checks its own signature. The guest pays the total they saw.',
          cons: 'Cannot be revoked, so a price change waits out the quotes already issued.',
        },
      ],
      choice:
        'The signed quote, valid for 15 minutes. The booking copies the total and the cancellation policy from it, and the authorization is for that total. Search results show the base price of the listing as an indication; the quote is the first number that binds. A host who changes a price changes it for quotes issued from then on.',
    },
    {
      question: 'Instant booking or request to book?',
      options: [
        {
          name: 'Instant booking',
          pros: 'The stay is confirmed in seconds, with a hold of 10 minutes.',
          cons: 'Hosts give up the chance to review each guest.',
        },
        {
          name: 'Request to book',
          pros: 'Hosts approve each guest.',
          cons: 'The hold has to last hours instead of minutes, keeping nights off the market, and the card authorization has to outlive the wait.',
        },
      ],
      choice:
        'Instant booking only. Request to book is left out on purpose: it would add a state between held and confirmed with its own, much longer deadline, and the release transaction would stay the same. It is worth adding when hosts ask for it more than guests leave because of the wait.',
    },
    {
      question: 'How do we store dates so stays are correct everywhere?',
      options: [
        {
          name: 'UTC timestamps for check-in and check-out',
          pros: 'Standard for events and logs.',
          cons: 'A night belongs to a calendar day where the property is; time zones and daylight saving shift a timestamp across midnight.',
        },
        {
          name: 'Local dates of the listing, plus its time zone',
          pros: 'A night is a calendar date where the property is, which is what guests and hosts mean.',
          cons: 'Every comparison with "now" must use the time zone of the listing, not the one of the server or of the guest.',
        },
      ],
      choice:
        'Nights are local dates of the listing, and the time zone is on the listing. "Has check-in passed" and "is this still 5 days before check-in" are computed in that zone. Timestamps are kept for events such as when a hold was placed, and deadlines are compared with the clock of the database, the one clock every writer shares.',
    },
  ],
  wrapUp:
    'Search can be stale, but the claim cannot: one row per taken night under a unique key, all nights of a stay in one transaction, a 10-minute hold that one conditional write turns into confirmed or released, an authorization that is captured only after that write and voided if it lost, a worker that releases and repairs from rows written before every provider call, and an outbox that carries each calendar version to the index.',
  guarantees: {
    provides: [
      {
        property: 'No double sale',
        promise:
          'A night of a listing has at most one claim, because listing plus night is the primary key of the claims table and the database refuses a second row whatever code path writes it. Holds, confirmed bookings and host blocks are all claims. An audit every 5 minutes checks that every live booking still has all its claims and that no claim points at a booking that has ended.',
      },
      {
        property: 'All nights or none',
        promise:
          'The claims of a stay, its booking and its outbox row commit in one transaction. A conflict on any night rolls back all of it, so a partial stay does not exist at any moment.',
      },
      {
        property: 'Idempotent booking',
        promise:
          'A booking request repeated by the same guest with the same idempotency key returns the same booking and claims nothing more. Retries are delivered at least once and made harmless by the unique key on guest and idempotency key, for as long as the booking row exists.',
      },
      {
        property: 'Every hold ends',
        promise:
          'A held booking becomes confirmed or released, never both: both changes are conditional on "held" and the database applies one of them. An unpaid hold is released 60 seconds after its deadline on the next pass of the worker, so its nights are free again 11 to 11.5 minutes after it was placed while the worker runs.',
      },
      {
        property: 'Money follows the booking',
        promise:
          'Every authorization ends captured on the booking it confirmed, or voided. Money is captured only for the attempt recorded on a confirmed booking, so a guest is not charged twice for a booking and is not charged for a hold that was released. Provider calls are repeated at least once after a crash and made harmless by idempotency keys derived from the attempt id, one per operation.',
      },
      {
        property: 'One refund per cancellation',
        promise:
          'A cancelled booking carries one refund amount, computed once from the policy copied onto it and committed with the cancellation. It is sent with a key derived from the booking id, so repeats by the API and the worker are the same refund to the provider.',
      },
      {
        property: 'Price',
        promise:
          'The guest is charged the total of the quote they booked with, whatever the host changed afterwards, provided the booking was made before the quote expired.',
      },
      {
        property: 'Search follows the calendar',
        promise:
          'Every committed change to a calendar reaches the index: its outbox row commits in the same transaction and is delivered at least once, made harmless by the calendar version, which the index uses to refuse anything not newer. Normally about 2 seconds behind.',
      },
      {
        property: 'Booking events',
        promise:
          'Every confirmation and cancellation is published to the events topic at least once, with the outbox row id as event id so consumers can drop repeats.',
      },
    ],
    assumes: [
      'The database enforces the primary key and applies a conditional update to one row atomically, acknowledges a commit only after it is stored across Availability Zones, and keeps every acknowledged commit through a failover.',
      'Every deadline is compared with the clock of the database writer, so API tasks and workers do not need synchronized clocks. Only the expiry of a quote is checked on a task’s own clock, where a second of error does not matter.',
      'The payment provider honors an idempotency key for at least 24 hours, lets us look up, capture, void and refund a payment by the reference we gave it, and answers clearly when a reference has no payment.',
      'A provider call that timed out on our side after 10 seconds has been applied or dropped by the provider 50 seconds later, when the worker first asks about it.',
      'The app keeps its idempotency key and its paymentKey until it has an answer, and repeats with the same ones.',
      'The search index applies external versions: it keeps the document with the highest version it was given, and answers a write that is not newer with a version conflict.',
      'The key that signs quotes is readable only by the booking service.',
    ],
    doesNotGuarantee: [
      'That every stay in the search results is still free. The index is seconds behind; the quote catches most stale results and the booking transaction decides.',
      'That a night is bookable the second its hold runs out. It returns 60 to 90 seconds after the deadline, and later if the worker is down.',
      'First click wins on a contested night. The first transaction to commit wins, which is close to arrival order and not exactly it.',
      'A hold through a payment provider outage. Holds are not extended: a guest who cannot pay loses the hold at its deadline and is charged nothing.',
      'A booking for a payment that was authorized in the last minute of a hold while our API crashed. If neither the app nor the worker confirms before the release, the authorization is voided and the nights go back on sale.',
      'That a price change by the host applies at once. Quotes already signed are honored for up to 15 minutes, and a hold made from one for 10 more.',
      'When refunded money shows on the card. The design sends the refund within minutes; the bank decides the rest.',
      'That a confirmed booking is always collected. A capture the provider refuses three times after authorizing goes to a person, who collects another way or cancels the booking.',
      'The order of booking events, or one copy of each. Consumers get them at least once and use the event id.',
    ],
  },
  failures: [
    {
      scenario:
        'The API crashes after the provider authorized the card and before the booking is confirmed.',
      impact:
        'The guest has money held on the card and a booking that still says held. The app shows an error or a spinner.',
      detection:
        'The attempt row stays "started". The worker publishes the age of the oldest unfinished money step, with an alarm at 2 minutes.',
      recovery:
        'The app’s repeat with the same paymentKey gets the first authorization back and confirms, usually within seconds. Without a repeat, the worker looks the attempt up 60 to 90 seconds after its last call began and runs the same conditional confirm, then captures. If the hold was released first, it voids instead and nothing is charged.',
    },
    {
      scenario: 'The API crashes after the booking is confirmed and before the capture.',
      impact:
        'The guest owns the stay and the money is authorized but has not moved. Nothing is visible to the guest.',
      detection:
        'An authorized attempt on a confirmed booking, counted in the same oldest unfinished money step metric.',
      recovery:
        'The worker captures with the attempt id 60 to 90 seconds after the confirmation; a capture the API did send is not repeated by the provider. Three refusals put the attempt in review and page a person.',
    },
    {
      scenario: 'A hold is released while its payment is still in flight.',
      impact:
        'The guest pressed pay in the last seconds, the provider answered slowly or the API died, and the worker released the booking first.',
      detection:
        'The conditional confirm changes no row. The count of authorizations voided after a lost hold is published by the API and the worker.',
      recovery:
        'Whoever holds the authorization voids it: the API at once, or the worker on its next pass. The guest reads "the hold ran out, nothing was charged". A payment that starts before the deadline has 60 seconds to finish against a provider timeout of 10, so this needs a crash or a long stall.',
    },
    {
      scenario: 'The payment provider is slow or down.',
      impact:
        'Guests cannot pay, and holds reach their deadline and are released. Search, quotes, holds, releases and cancellations keep working; refunds wait.',
      detection:
        'The share of authorize calls that end in an error or no answer, published by the API every minute, with an alarm at 10% for 3 minutes; the oldest unfinished money step grows as well.',
      recovery:
        'Pay calls answer 202 "pending" and are not counted as declines. Releases run on their own loop and need only the database, so they keep their pace. After 5 failures in a row the money loop stops calling the provider until its next pass, 30 seconds later, so a dead provider gets a handful of calls per pass and not a storm. When the provider returns, the worker settles what is open: captures, voids and refunds, each with its own key. A step still open after 12 hours goes to review.',
    },
    {
      scenario: 'Both worker tasks stop.',
      impact:
        'Unpaid holds keep their nights, the index and the events topic stop following, and half-done money steps wait. Booking and paying still work, and no night is sold twice.',
      detection:
        'The worker publishes the oldest hold past its deadline, the oldest outbox row and the oldest money step every minute. Those alarms treat missing data as breaching, so silence pages too, a few minutes after the last datapoint.',
      recovery:
        'The container service starts new tasks. The first passes handle everything that piled up: every step is a conditional write or a call with an idempotency key, so work repeated by two tasks does no harm.',
    },
    {
      scenario: 'The database writer fails.',
      impact:
        'Holds, payments, cancellations and host changes fail for typically less than a minute while a reader is promoted. Search keeps answering from the index. Quotes read a reader and can fail for the same moments.',
      detection: '5xx on the booking load balancer, and the failover event of the cluster.',
      recovery:
        'A reader in another zone becomes the writer with every acknowledged commit, because storage is shared and written across zones before the acknowledgment. A request cut off in the middle of a commit does not know its outcome: the app repeats it with the same key and gets the booking if it committed. Deadlines kept running during the failover, so the worker releases what expired.',
    },
    {
      scenario: 'The search index is unreachable, or loses its data.',
      impact:
        'Search fails or returns fewer listings. Booking a listing the guest already has open still works, because quotes and bookings do not touch the index. Booking events keep flowing, because the relay takes rows per destination.',
      detection:
        '5xx and latency on the search load balancer, the red status of the cluster, and the age of the oldest index row in the outbox.',
      recovery:
        'Index rows stay pending in the outbox and are delivered when the index answers; the version on each document makes the catch-up safe in any order. After a loss of data, a person starts the rebuild command of the worker: it reads every listing from the writer and writes its document with its version, 1,000 a second, about 33 minutes for 2 million listings, while live changes keep flowing through the outbox.',
    },
    {
      scenario:
        'One outbox row cannot be delivered: the index rejects its document, or the topic rejects the event.',
      impact:
        'One listing is stale in search, or one event is missing for consumers. Other rows are not held back, because rows are taken independently.',
      detection: 'The count of parked outbox rows, with an alarm above zero.',
      recovery:
        'A version conflict from the index is not a rejection: the index is already at that version or beyond, and the row is deleted as delivered. Any other rejection is tried again up to five times, then the row is parked and the relay leaves it alone. A person fixes the cause, such as a mapping or an oversized payload, and sets the row back to pending; the alarm returns to OK when no row is parked. For an index row any later change to the same listing writes a newer document anyway.',
    },
    {
      scenario: 'The answer to a booking request is lost, and the app sends it again.',
      impact: 'Without care the repeat would conflict with the guest’s own hold and read "taken".',
      detection: 'Not an incident: the API finds the booking by guest and idempotency key.',
      recovery:
        'The repeat returns the same held booking with the same deadline. If two copies run at the same instant, one commits and the other hits the unique key, then reads the booking by its key and returns it too.',
    },
    {
      scenario:
        'Thousands of guests try to book the same nights of one listing in the same second.',
      impact:
        'One guest gets the hold. A few dozen requests wait briefly on the listing row; the rest are answered 409 from a read.',
      detection:
        'The share of 409 answers on booking requests, on the dashboard, and the number of database connections in use, which Database busy watches.',
      recovery:
        'Nothing to recover: the first commit ends the contest. Waiting requests give up after 2 seconds with a 503 that the app repeats and that counts against the error objective like any 5xx, so a slow transaction cannot pile requests up without limit, and a rate rule at the edge caps requests per address.',
    },
    {
      scenario: 'The provider refuses a capture or a refund three times.',
      impact:
        'A confirmed booking has no money behind it, or a cancelled guest is waiting for a refund.',
      detection: 'The count of money steps in review, with an alarm above zero.',
      recovery:
        'The step stops being retried and a person takes it: collect or refund through the provider’s console and mark the step done. A capture that cannot be collected is closed the other way: cancel the booking through the cancel call, mark its refund done, since no money was taken, then void the authorization at the provider and mark the attempt voided. The alarm returns to OK when no step is in review.',
    },
  ],
  capacity: {
    assumptions: [
      '2 million listings, one bookable unit each, with calendars open 365 nights ahead.',
      '10 million guests a day make 86.4 million searches a day. The peak is 4 times the average.',
      'One search in ten leads to a listing page that asks for a quote.',
      '259,200 holds a day, with a peak of 10 times the average when a holiday period opens. Two thirds of holds are paid; one third is released.',
      'An average stay is 4 nights. One confirmed booking in ten is cancelled later.',
      'Hosts make 432,000 calendar changes a day, 3 times that rate at peak.',
      'A hold lasts 10 minutes, a quote 15. The worker passes every 30 seconds and releases a hold 60 seconds after its deadline; the outbox is read every second.',
    ],
    estimates: [
      {
        label: 'Searches',
        value: '1,000/s on average, 4,000/s at peak',
        math: '86.4M ÷ 86,400 s = 1,000/s. × 4 = 4,000/s',
      },
      {
        label: 'Quotes',
        value: '100/s on average, 400/s at peak',
        math: '1,000/s ÷ 10 = 100/s. 4,000/s ÷ 10 = 400/s, all reads on database readers',
      },
      {
        label: 'Holds',
        value: '3/s on average, 30/s at peak',
        math: '259,200 ÷ 86,400 s = 3/s. × 10 = 30/s, which is 1,800 a minute',
      },
      {
        label: 'Confirmed bookings and releases',
        value: '20/s and 10/s at peak; 172,800 and 86,400 a day',
        math: '259,200 × 2/3 = 172,800 confirmed a day, 2/s on average, 20/s at peak. 259,200 × 1/3 = 86,400 released a day, 1/s on average, 10/s at peak',
      },
      {
        label: 'Searches per booking',
        value: '500',
        math: '86.4M searches ÷ 172,800 confirmed bookings = 500',
      },
      {
        label: 'Write transactions on the database at peak',
        value: '~120/s',
        math: '30 holds + 20 confirmations × 3 writes (the attempt, which carries its first stamp; the confirm, which carries the stamp of the capture; captured) + 10 releases + 2 cancellations × 2 writes + 15 host changes = 30 + 60 + 10 + 4 + 15 = 119/s, plus the outbox stamps and deletes, batched once a second',
      },
      {
        label: 'Outbox rows at peak',
        value: '57/s for the index, 22/s for events',
        math: 'Index: 30 holds + 10 releases + 2 cancellations + 15 host changes = 57/s. Events: 20 confirmed + 2 cancelled = 22/s. Cancellations: 172,800 ÷ 10 = 17,280 a day = 0.2/s, × 10 = 2/s. Host changes: 432,000 ÷ 86,400 = 5/s, × 3 = 15/s',
      },
      {
        label: 'Claim rows',
        value: '120 inserted a second at peak; ~227M more a year',
        math: '30 holds/s × 4 nights = 120 rows/s. Per day: 259,200 × 4 = 1,036,800 inserted, 86,400 × 4 = 345,600 deleted by releases, 17,280 × 4 = 69,120 deleted by cancellations: 622,080 kept. × 365 ≈ 227M a year, about 23 GB at ~100 bytes with the index',
      },
      {
        label: 'Nights off the market in holds',
        value: '72,000 of 730M at peak',
        math: '30 holds/s × 600 s = 18,000 holds open × 4 nights = 72,000 nights. 2M listings × 365 = 730M nights, so about 0.01%',
      },
      {
        label: 'Time until an unpaid night returns',
        value: '11 to 11.5 minutes after the hold',
        math: '10 min hold + 60 s wait + 0 to 30 s until the next pass',
      },
      {
        label: 'Search index',
        value: '~6 GB, one primary shard',
        math: '2M documents × ~3 KB (place, attributes, up to 365 taken nights) = 6 GB. A full rebuild at 1,000 listings/s takes 2M ÷ 1,000 = 2,000 s ≈ 33 minutes',
      },
      {
        label: 'Provider calls in flight',
        value: '~30 at peak',
        math: '20 authorizations/s × 1.5 s at p95 = 30 calls open at once, each followed by a short capture',
      },
      {
        label: 'A hot listing',
        value: '~25 of 5,000 requests reach the lock',
        math: '5,000 requests in one second × 5 ms until the first commit = 25 waiting on the listing row; the other 4,975 read the claim and get 409',
      },
    ],
    implications: [
      'Reads outnumber bookings 500 to 1, and at peak 4,000 searches run against 30 holds a second. Search gets its own store and its own fleet, and may be stale; the booking path stays small and exact.',
      'About 120 write transactions a second is light work for one relational writer. There is no reason to shard, and so no reason to give up transactions, unique keys or an outbox in the same commit.',
      'The data is small: 6 GB of index and tens of gigabytes of rows a year. The problem is correctness under concurrency and across a provider we do not control, not volume.',
      'Holds take about 0.01% of the nights off the market, so a 10-minute hold with a 60-second wait after it costs hosts almost nothing, and there is no need to free a night at the exact second.',
      'The index is sized by query rate, not by data: one shard with a copy on every data node, and the number of nodes comes from a load test at 4,000 searches a second.',
      'Payments are the slow step, 1.5 seconds against 80 ms for a hold, which is why hold and pay are separate calls and no database transaction stays open across a provider call, from the API or from the worker.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one Region across three Availability Zones. The payment provider is outside AWS. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Search API',
        service:
          'An Application Load Balancer that serves only search, AWS WAF on it, Amazon ECS on AWS Fargate',
        why: 'A stateless service that turns place, dates and guests into one index query. It has its own load balancer, so its error ratio and latency are not mixed with booking traffic, and its own fleet, so a search peak cannot take capacity from checkout.',
        watch:
          'ALB RequestCount, TargetResponseTime at p99, HTTPCode_Target_5XX_Count and HTTPCode_ELB_5XX_Count; ECS CPUUtilization and MemoryUtilization.',
      },
      {
        part: 'Search index',
        service:
          'Amazon OpenSearch Service, Multi-AZ with Standby: three dedicated master nodes and data nodes in a multiple of three, one index with one primary shard and a copy on every data node',
        why: 'A place filter combined with "no taken night in this range" over 2 million small documents is what a search engine is good at. External versions let the relay write documents in any order. Losing the index loses no booking: it is rebuilt from the database.',
        watch:
          'ClusterStatus.red and ClusterStatus.yellow, CPUUtilization and JVMMemoryPressure of the data nodes, SearchLatency, SearchRate, ThreadpoolSearchRejected, FreeStorageSpace and ClusterIndexWritesBlocked.',
      },
      {
        part: 'Booking API',
        service:
          'An Application Load Balancer that serves only booking, AWS WAF on it, Amazon ECS on AWS Fargate with two target groups: one for pay and one for every other route',
        why: 'Quotes, holds, releases, cancellations and host changes are short database calls; pay waits on the provider for seconds. Two target groups keep a slow provider out of the latency of the other routes. Tasks are stateless and hold a fixed pool of database connections each.',
        watch:
          'Per target group: TargetResponseTime at p99. On the load balancer: RequestCount, HTTPCode_Target_5XX_Count and HTTPCode_ELB_5XX_Count. Custom, from the API: share of 409 answers on quotes and on booking requests, and authorize calls by result.',
      },
      {
        part: 'Bookings DB',
        service: 'Amazon Aurora PostgreSQL: one writer and two readers in three Availability Zones',
        why: 'Listings, rates, claims, bookings, payment attempts and the outbox live in one database, so a stay and everything that must follow it commit in one transaction. The primary key of the claims table is the guarantee against a double sale. Readers serve quotes and the audit; everything that decides reads the writer.',
        watch:
          'On the writer: CPUUtilization, DatabaseConnections, CommitLatency, Deadlocks and FreeableMemory. On the readers: AuroraReplicaLag.',
      },
      {
        part: 'Payments',
        service:
          'An external payment provider, called from the booking API and from the worker with the attempt id as reference and an idempotency key per operation derived from it',
        why: 'Authorize, capture, void, refund and lookup are separate calls, which lets the conditional confirm sit between authorize and capture. The card never reaches our servers: the provider’s form gives the app a token.',
        watch:
          'Custom, from the API: authorize calls by result (authorized, declined, error, no answer) and their latency. From the worker: oldest unfinished money step, steps in review, authorizations voided after a lost hold.',
      },
      {
        part: 'Worker',
        service:
          'One Amazon ECS service on AWS Fargate with two tasks in different Availability Zones',
        why: 'Four loops in one small service. Every second: relay outbox rows to the index and to the events topic; rows are taken per destination, each with its own batch and its own timeout of 2 seconds, so an index that is down adds at most that wait to a pass and never holds events back. Every 30 seconds: release holds more than 60 seconds past their deadline, which needs only the database. Every 30 seconds, on a loop of its own so that a slow provider cannot delay a release: settle payment attempts whose last call began more than 60 seconds ago and pending refunds whose last call is that old. Every 5 minutes: the calendar audit, on a reader. The two tasks share work with no leader and hold no database lock during a call to the provider, the index or the topic. A money step is taken by a committed update of the time of its last call, which changes the row only if that time is still more than 60 seconds old. A batch of outbox rows is taken by one short transaction that stamps them and commits, and a row taken and not deleted is taken again 10 seconds later. A task that dies leaves stamps that grow old, so its work is taken again and repeated under the same keys and versions. A release locks nothing in advance: if both tasks try the same hold, the condition lets one of them change it. After 5 provider failures in a row the money loop stops calling the provider and leaves the rest for its next pass. The service also carries the rebuild command for the index.',
        watch:
          'ECS CPUUtilization and MemoryUtilization. Custom, published every minute, also at zero: oldest hold past its deadline, oldest pending outbox row per destination, parked rows, oldest unfinished money step and steps in review. Every 5 minutes: the two counts of the audit.',
      },
      {
        part: 'Events topic',
        service: 'An Amazon SNS standard topic',
        why: 'One place where "confirmed" and "cancelled" are published for the services that send emails, notify hosts and feed analytics. Each subscriber gets its own copy and may see an event more than once, which the event id covers.',
        watch: 'NumberOfMessagesPublished and NumberOfNotificationsFailed.',
      },
      {
        part: 'Security',
        service:
          'AWS WAF rate-based rules on both load balancers, IAM roles per service, AWS Secrets Manager, AWS KMS, AWS CloudTrail',
        why: 'The API checks on every call that the booking belongs to the guest, or the listing to the host. Only the booking service reads the key that signs quotes; only the booking service and the worker read the provider’s API key and the database credentials. Stores are encrypted, card numbers never reach us, and reads of secrets leave a trail.',
        watch: 'WAF BlockedRequests; CloudTrail events for reads of the secrets.',
      },
      {
        part: 'Observability',
        service: 'Amazon CloudWatch dashboards and alarms',
        why: 'One dashboard with the objectives. Latency and error alarms read load balancer metrics, which do not depend on the tasks they watch. The alarms on the ages and on the audit that the worker publishes about itself treat missing data as breaching, because silence there means the worker is down. The two counts that wait for a person do not, since those alarms already cover a silent worker.',
        watch:
          'The objectives, and the three counts that should be zero: audit findings, parked rows and steps in review.',
      },
    ],
    limits: [
      'An Aurora cluster volume keeps copies of the data across three Availability Zones, and a write is replicated synchronously to six storage nodes, so a reader promoted in another zone has every acknowledged commit.',
      'With a reader to promote, an Aurora failover typically restores service in less than 60 seconds and often in less than 30; with no reader, recovering the writer typically takes less than 10 minutes. That is why the cluster has readers in two other zones.',
      'Aurora Replicas are asynchronous and usually much less than 100 ms behind, and a cluster can have up to 15. A quote read from a reader can miss a claim that is milliseconds old, so nothing that decides reads a reader.',
      'In PostgreSQL a second row with the same primary key fails with a unique violation (SQLSTATE 23505) and aborts the transaction it is in, which is what makes a stay all or nothing.',
      'PostgreSQL waits one second (deadlock_timeout, by default) before it checks for a deadlock, and then aborts one of the transactions. Every transaction that changes a calendar (booking, release, cancellation, host change) updates the listing row first and only then touches the booking and the claims, claims in date order. Two of them on one listing therefore run one after the other and cannot wait on each other in a circle. The confirm, run by the API or by the worker, updates the booking first and the attempt second; the worker takes its step with a committed stamp and not with a held lock, so it enters that transaction holding nothing and takes the rows in the same order as the API. A code path that broke this order would risk an aborted transaction, not a double sale: the unique key does not depend on it.',
      'FOR UPDATE SKIP LOCKED skips rows that another transaction has locked. It is used in one place, the short transaction in which a relay task stamps a batch of outbox rows, so the two tasks stamp different rows without waiting for each other, and that transaction commits before anything is sent. A money step is one row: in Read Committed, the default isolation level of PostgreSQL, an update that waited for another one checks its condition again on the new version of the row, so the second of two tasks that stamp the same step changes nothing.',
      'Aurora PostgreSQL publishes CommitLatency, Deadlocks, DatabaseConnections and AuroraReplicaLag; the DML latency metrics exist only for Aurora MySQL.',
      'OpenSearch makes an indexed document searchable at the next refresh of the index, one second by default, which adds to the lag of the relay.',
      'For search workloads the guidance is a shard count that keeps each shard between 10 and 30 GiB, and still a single shard for about 5 GiB of data; the 6 GB index here is one shard.',
      'Multi-AZ with Standby places an OpenSearch Service domain in three Availability Zones with the nodes of one zone on standby, and requires three dedicated master nodes, data nodes in a multiple of three and at least two replicas per index. Standby nodes serve no searches, so the load test counts the nodes of two zones.',
      'OpenSearch Service takes an automated snapshot every hour and keeps up to 336 of them for 14 days. This design does not depend on them, because the index can be rebuilt from the database.',
      'OpenSearch Service sends most metrics to CloudWatch once a minute, and counters such as ThreadpoolSearchRejected restart from zero when a node is replaced.',
      'HTTPCode_Target_5XX_Count leaves out the 5xx that the load balancer generates itself, and HTTPCode_ELB_5XX_Count exists per load balancer and is reported only in minutes that have one. So search and booking each have their own load balancer, and the error ratio adds both counts with an absent count read as zero. RequestCount counts only requests for which a target was chosen, so the ratio is missing only when RequestCount is, and that case counts as breaching.',
      'An Application Load Balancer closes an idle connection after 60 seconds by default. A pay call makes at most two provider calls, an authorization and then a capture or a void, each with a timeout of 10 seconds, so it waits at most 20 seconds on the provider, far inside it.',
      'An Amazon ECS service can be attached to at most five target groups; the booking service uses two.',
      'An AWS WAF rate-based rule counts over a window of 1, 2, 5 or 10 minutes and its limit can be as low as 10 requests. It slows a script on one address; it does not decide who gets a night.',
      'An Amazon SNS message is at most 256 KiB by default, and PublishBatch takes up to 10 messages. Booking events are a few hundred bytes: ids, the state and the time.',
      'Amazon SNS reports its metrics once a minute for topics that had activity in the last six hours.',
      'A CloudWatch alarm treats missing data as missing, not breaching, breaching or ignored; the default is missing. Every alarm here states which one it uses. An alarm retrieves more datapoints than its evaluation periods and uses the real ones it still finds there, so with missing data counted as breaching a metric that goes silent pages a few periods after its last datapoint, not at the first gap.',
    ],
  },
  slos: [
    {
      objective: 'No double sale',
      target:
        'Zero live bookings without all their claims, and zero claims that point at an ended booking, on every audit over 28 days',
      measure:
        'Two counts from the audit query the worker runs on a reader every 5 minutes, published as custom metrics. One statement reads one snapshot, so a booking in the middle of a transaction is not miscounted.',
    },
    {
      objective: 'Search',
      target: '99% of searches answered within 400 ms and 99.9% without a 5xx, over 28 days',
      measure:
        'On the search load balancer: TargetResponseTime at p99, and (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount. An absent 5XX count is read as zero. The ratio is missing only when RequestCount is, and such a minute counts as failed.',
    },
    {
      objective: 'Search freshness',
      target: '99% of calendar changes searchable within 10 s of their commit, over 28 days',
      measure:
        'Delivery time minus creation time of each index row in the outbox, plus the one-second refresh of the index, published by the worker as a percentile. The age of the oldest pending index row is the live signal.',
    },
    {
      objective: 'Booking calls',
      target:
        '99% of quote, hold, release, cancel and calendar calls answered within 300 ms, and 99.9% of all booking API calls without a 5xx, over 28 days',
      measure:
        'TargetResponseTime at p99 on the target group that serves every route except pay, and (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount on the booking load balancer, with the same reading of absent and missing data as for search. A 409 is an answer, not an error, and a pay call that got no answer from the provider is a 202. A request that gave up after 2 seconds of waiting for a listing row is a 503 and counts as an error.',
    },
    {
      objective: 'Holds released',
      target: '99% of unpaid holds released within 15 minutes of being placed, over 28 days',
      measure:
        'Release time minus creation time on bookings released by the deadline, from the database. The expected time is 11 to 11.5 minutes. The live signal is the age past its deadline of the oldest booking still held.',
    },
    {
      objective: 'Money follows the booking',
      target:
        '99.9% of captures, voids and refunds reach the provider within 5 minutes of becoming due, over 28 days',
      measure:
        'Done time minus due time on payment attempts and refunds, from the database: a capture is due at the confirmation, a void when an authorization lost its booking, a refund at the cancellation. The expected worst case is about 90 seconds. The live signal is the age of the oldest unfinished step, which also counts attempts still "started".',
    },
    {
      objective: 'Booking events',
      target: '99% of confirmations and cancellations published within 1 minute, over 28 days',
      measure:
        'Publish time minus creation time of each event row in the outbox, and the age of the oldest pending event row.',
    },
  ],
  alarms: [
    {
      name: 'Calendar audit',
      metric:
        'Custom, from the worker every 5 minutes: live bookings missing a claim plus claims of ended bookings, above 0 on any audit; missing data counts as breaching',
      meaning:
        'A night could be sold twice, or is blocked by nobody. The unique key should make the first impossible, so this means a bug or a manual change, and it pages on the first finding. It returns to OK on the first audit that counts zero after a person has repaired the rows. An audit that stops running pages too, a few 5-minute periods after its last datapoint.',
    },
    {
      name: 'Search slow or failing',
      metric:
        'On the search ALB, each over one 5-minute window: TargetResponseTime p99 above 300 ms, or (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount above 0.05%, with an absent 5XX count read as zero and a missing ratio counted as breaching',
      meaning:
        'Guests are waiting or getting errors on search: the index is overloaded, a node is gone or search tasks are down. 300 ms is below the 400 ms target and 0.05% is half the error rate the target allows. The load balancer publishes these, so they work with every search task dead; the ratio is missing only when no request reached a target, and that fires too, a few windows later than a breach with data, because the alarm first uses the real datapoints it still has. If that takes three windows, a total outage runs 15 minutes before the page, more than a third of the 40.3 minutes of total outage that the error target allows in 28 days (0.1% of 40,320 minutes, at an even request rate).',
    },
    {
      name: 'Search cluster unhealthy',
      metric:
        'OpenSearch ClusterStatus.red (maximum) at 1 or more for 1 minute, or ThreadpoolSearchRejected (sum) increasing in a 1-minute period; missing data is not breaching',
      meaning:
        'A shard has no copy assigned, or data nodes are turning searches away. Add nodes if it is load; if data was lost, run the rebuild after the cluster is green. A domain that stops reporting does not page here: Search slow or failing sees it from the load balancer.',
    },
    {
      name: 'Index behind',
      metric:
        'Custom, from the worker every minute: age of the oldest pending index row in the outbox above 5 s for 2 periods in a row; missing data counts as breaching',
      meaning:
        'Search is falling behind the calendar. The threshold is half the 10-second target, but the metric comes once a minute and the alarm needs two periods, so it pages within about 2 minutes of the lag starting, and the changes of that window have already missed 10 seconds. That spends a small part of the budget: at an even rate, 1% of the changes of 28 days is about 6.7 hours of them. The index is refusing or slow, or the relay is down; a dead relay publishes nothing, which pages a few minutes after its last datapoint. Guests see more "no longer available" at the quote; no booking is wrong.',
    },
    {
      name: 'Events behind',
      metric:
        'Custom, from the worker every minute: age of the oldest pending event row in the outbox above 30 s for 2 periods in a row; missing data counts as breaching',
      meaning:
        'Confirmation emails and host notifications are late. The threshold is half the 1-minute target; with a metric once a minute and two periods it pages within about 3 minutes of the lag starting, so the events of that window are already late, out of a budget of about 6.7 hours of events in 28 days. Usually the topic is rejecting publishes or the worker is down; a silent worker pages a few minutes after its last datapoint.',
    },
    {
      name: 'Outbox rows parked',
      metric:
        'Custom, from the worker every minute: parked outbox rows above 0; missing data is not breaching',
      meaning:
        'The index or the topic rejected a row five times, for a reason other than a version conflict. One listing is stale in search or one event is missing. It returns to OK when a person has fixed the cause and set the row back to pending, or deleted it. A silent worker does not page here; Index behind and Events behind do.',
    },
    {
      name: 'Booking slow or failing',
      metric:
        'On the booking ALB, each over one 5-minute window: TargetResponseTime p99 above 200 ms on the target group without pay, or (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount of the load balancer above 0.05%, with an absent 5XX count read as zero and a missing ratio counted as breaching',
      meaning:
        'Quotes, holds or cancellations are slow or failing: the database is busy or failing over, or API tasks are down. 200 ms is below the 300 ms target and 0.05% is half the allowed error rate. A provider outage does not fire this one, because pay answers 202 "pending" then; Payments failing covers it. A missing ratio pages a few windows later than a breach with data, as on search, and three windows cost the same 15 of 40.3 minutes.',
    },
    {
      name: 'Database busy',
      metric:
        'Aurora writer CPUUtilization above 70% for 5 minutes, or DatabaseConnections above 80% of the sum of the connection pools, or AuroraReplicaLag (maximum) above 1,000 ms for 5 minutes; missing data is not breaching',
      meaning:
        'The writer is close to slowing every booking call, tasks are running out of connections, which is how a contested listing shows first, or quotes are being priced from an old copy. A database that stops reporting does not page here: it shows as 5xx on Booking slow or failing.',
    },
    {
      name: 'Holds not released',
      metric:
        'Custom, from the worker every minute: oldest booking still held, more than 2 minutes past its deadline on one datapoint; missing data counts as breaching',
      meaning:
        'The worker is failing or down. Normal is at most 90 seconds past the deadline. While the worker publishes, the alarm fires 12 to 13 minutes after the oldest hold was placed, because the metric comes once a minute, and the target is missed at 15, so there are about 2 minutes to act. A dead worker publishes nothing, which pages a few minutes after its last datapoint; the first holds it left behind pass 15 minutes about 3.5 minutes after it stopped (placed up to 11.5 minutes before), so that page can come as those first holds miss. The 28-day target has room for it: 1% of the 86,400 × 28 = 2.4 million releases is about 24,000 holds, 40 minutes of releases at the peak of 10 a second. Nights stay blocked; nothing is double sold.',
    },
    {
      name: 'Money steps stuck',
      metric:
        'Custom, from the worker every minute: oldest capture, void, refund or unresolved attempt that is due and not done, above 2 minutes, steps in review left out; missing data counts as breaching',
      meaning:
        'A guest has money held or owed and the step that settles it is not going through. Normal is at most about 90 seconds. While the worker publishes, the alarm fires 2 to 3 minutes after the step became due, because the metric comes once a minute, and the target is missed at 5, at least 2 minutes later. A dead worker publishes nothing, which pages a few minutes after its last datapoint; in that time only the steps the API left unfinished are waiting. Usually the provider is failing, and Payments failing is on as well; if it is not, look at the worker.',
    },
    {
      name: 'Money steps in review',
      metric:
        'Custom, from the worker every minute: captures, voids and refunds in review, above 0; missing data is not breaching',
      meaning:
        'The provider refused a step three times, or a step stayed open for 12 hours, or a refund sits behind a capture that is in review. A person collects, refunds or cancels by hand. It returns to OK when no step is in review. A silent worker does not page here; Money steps stuck does.',
    },
    {
      name: 'Payments failing',
      metric:
        'Custom, from the API every minute, also at zero: authorize calls ending in an error or no answer above 10% for 3 minutes; missing data counts as breaching',
      meaning:
        'The provider is down, slow or rejecting our credentials. Guests cannot pay and their holds will be released at the deadline, with nothing charged. Declines by the card are answers and are not counted. No data means the API itself is not publishing: that pages a few minutes after the last datapoint, and Booking slow or failing says whether the API is down.',
    },
    {
      name: 'Quote conflicts high',
      metric:
        'Custom, from the API every minute: share of POST /quotes answered 409 above 5% for 10 minutes in a row; missing data is not breaching',
      meaning:
        'Guests keep opening stays that are gone. A stale search result is stopped at the quote, which reads the database, so this is where a stale index shows. The metric does not depend on the worker, so it catches a stale index even when the outbox metric is wrong. One very popular listing can spike it for a minute, which is why it needs ten. Silence does not page here; Booking slow or failing covers an API that is down.',
    },
  ],
  evolution: {
    mvp: 'One relational database and no search engine. Search is a query over listings in an area that have no claim in the range, the outbox carries only booking events, and a small worker releases holds and settles payments. The unique key on listing and night, the hold with a deadline and one release transaction, the idempotency key on bookings and the attempt row written before every provider call are there from the first version, because each one prevents something that cannot be undone afterwards: a guest at a door that someone else has the key to, or a card charged twice. This holds for some tens of thousands of listings and tens of searches a second. The first thing to add is the search index.',
    atScale: [
      'At 10x searches, 40,000 a second, the index gets more data nodes with a copy each, and results for the most common place and date combinations are cached for a few seconds in front of it, bounded by that time to live.',
      'At 10x bookings, 300 holds a second and about 1,200 write transactions a second, one writer still keeps up on a larger instance. The claims table, by then billions of rows, is partitioned by month so past months are dropped instead of deleted row by row.',
      'At 10x, quotes reach 4,000 a second and get more readers, up to the 15 a cluster allows, and the outbox relay, at about 570 index updates a second, writes to the index in bulk requests.',
      'At 100x bookings the single writer is the limit. Data is split across several clusters by listing id, so all the nights, bookings and outbox rows of a listing stay in one database and the booking transaction does not change. A guest’s list of bookings, which now spans clusters, is served from a view fed by the booking events.',
      'At 100x and worldwide, each listing has a home Region that owns its calendar, and a guest far away books through that Region. Search can be served from a copy of the index in every Region, because it was allowed to be stale from the start.',
    ],
    firstBottleneck:
      'The search cluster. Everything on the booking path is sized by 30 holds a second, and the index by 4,000 queries a second that each combine a place filter with a date filter, so data node CPU runs out long before the database notices its load. The fix is more nodes with a copy each, then a short cache for the most common searches. The second is the writer’s connections on a contested listing, where requests wait on one row; the early read and the 2-second wait limit keep that bounded.',
    avoided: [
      'A webhook from the payment provider as a second path to confirm. Looking up our own unfinished attempts covers lost answers with nothing public to protect. Worth adding with payment methods that finish outside the request.',
      'Capturing later, when free cancellation ends. It saves refunds and needs scheduled captures and new authorizations for stays booked months ahead. Worth adding when refund fees become a real cost.',
      'Extending holds during a provider outage. Holds simply run out and nobody is charged. Worth adding if outages cost enough bookings to justify one more switch to operate.',
      'Taking over an expired hold inside the next booking. It frees a night up to 90 seconds sooner and gives the release two owners. Worth adding only if holds ever take a visible share of the nights.',
      'A waiting room for popular listings. One unit per night means the first commit ends the contest. Worth adding for listings with many identical units released at one time, which is a different design.',
      'A change stream from the database log in place of the outbox. Worth adding when several teams need every change, not only the index and a topic.',
      'A key-value store with transactional conditional writes for the claims. It scales writes further, with up to 100 items in one transaction, but the outbox, the booking and the queries by guest and by listing are simpler in one relational database at 120 transactions a second.',
      'Request to book and shared calendars with other platforms. Both fit the same claims and the same release transaction, and both bring a slow outside party into the hold. Left out until the product needs them.',
    ],
  },
};
