import type { Design } from '../types';

export const flashSale: Design = {
  slug: 'flash-sale',
  title: 'Flash sale',
  summary:
    'Sell 20,000 units to a million people who all click in the same second: absorb the burst at the edge, admit buyers at a pace the backend can take, decrement stock in memory without overselling, and turn every reservation into a paid order or give the unit back.',
  difficulty: 'Hard',
  minutes: 12,
  requirements: {
    functional: [
      'A sale opens at a set time for one item with limited stock: 20,000 units in the running example.',
      'Buyers can join a waiting room up to 15 minutes before the start and see their place in line.',
      'An admitted buyer reserves up to 2 units and then has 5 minutes to pay.',
      'Unpaid reservations go back on sale, and buyers still in line get a chance at them.',
      'A buyer can see their own reservations, so a lost answer is never a lost unit.',
    ],
    nonFunctional: [
      'Never sell more units than the stock, even with a million requests in the first second: units reserved or paid stay within it, and an excess caused by a fault is found within minutes and cancelled before anything ships.',
      'Fair: everyone waiting at the start gets a random place, so a faster script gains nothing.',
      'Buyers get a clear answer quickly: a place in line within seconds, and reserved or "all units held" within about a minute of the start.',
      '99% of reserve calls from admitted buyers are answered within 300 ms.',
      'The rest of the store keeps working while the sale runs: the sale has its own fleet, stores and payment budget.',
    ],
    outOfScope: [
      'Shipping and fulfillment.',
      'Pricing, the catalog and the cart of the rest of the store.',
      'Buyer accounts and sign-in; the sale only requires a signed-in account.',
      'Card handling: the payment provider collects the card and gives the store a token.',
      'Fraud review after the sale, beyond the audit that cancels orders before shipping.',
      'Refunds and returns after delivery.',
      'Order confirmation emails and push notifications.',
      'Several regions sharing one stock.',
      'Taxes, currencies and invoices.',
    ],
  },
  entities: [
    {
      name: 'Sale',
      description:
        'Item, opening time, total stock (20,000), limit per buyer (2), hold time (5 minutes), admission rate (1,000 buyers a second) and a hold extension of 5 minutes that can be switched on. Stored as one item in the reservations table.',
    },
    {
      name: 'Ticket',
      description:
        'A signed place in line for one account in one sale: a random draw for early arrivals, a sequence number for later ones. One per account.',
    },
    {
      name: 'Admission pass',
      description:
        'A signed token, valid for 5 minutes, that lets one account reach checkout for one sale.',
    },
    {
      name: 'Hold',
      description:
        'The record in the stock counter for one reservation: buyer, quantity, deadline and whether it is still held or released. Looked up by idempotency key.',
    },
    {
      name: 'Reservation',
      description:
        'The durable record of a hold: id, sale, account, quantity, idempotency key, deadline and a status of reserved, paid, expired or cancelled, plus its payment attempts with their keys and the times it was paid, captured and released.',
    },
    {
      name: 'Order',
      description:
        'The record of a captured payment in the orders database of the store, unique per reservation.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/sales/{id}/queue',
      description:
        'Joins the waiting room and returns a signed ticket. Idempotent per account: a repeated join returns the same ticket.',
    },
    {
      method: 'GET',
      path: '/sales/{id}/status',
      description:
        'Served from the edge and cached for one second. Returns the state of the sale, how far the line has been admitted, the number of early arrivals and the time of the update.',
    },
    {
      method: 'POST',
      path: '/sales/{id}/pass',
      description:
        'Body: ticket. Returns an admission pass once the line has reached the ticket. One live pass per ticket: a new one is issued only when the last has expired.',
    },
    {
      method: 'POST',
      path: '/sales/{id}/reservations',
      description:
        'Header: admission pass. Body: quantity, idempotencyKey. Returns 201 with a reservation and its deadline; the same key returns the same reservation. 409 when all units are held, 410 when sold out, 422 over the limit per buyer, 503 while the sale is paused.',
    },
    {
      method: 'GET',
      path: '/sales/{id}/reservations',
      description:
        'Lists the reservations of the signed-in buyer, including a hold whose reservation is still being written, for an app that lost an answer.',
    },
    {
      method: 'POST',
      path: '/reservations/{id}/pay',
      description:
        'Body: payment token, paymentKey (one per press of pay). Pays for a reservation before its deadline. Returns 200 when paid, also on a repeat for a reservation that is already paid; 402 when the card is declined (up to three declines); 410 when the reservation has expired or was cancelled; 503 when the payment could not be tried, with the hold kept.',
    },
  ],
  dataFlow: [
    'Buyers load a static sale page from the edge and join a waiting room before the start; each gets a signed ticket.',
    'At the start the room gives early arrivals a random order and admits 1,000 buyers a second, each with a signed pass.',
    'Checkout decrements an in-memory stock counter in one atomic step and writes the reservation durably before it answers.',
    'The buyer pays before the deadline; one conditional write decides between paid and expired, and expired units return to the counter.',
    'Captured payments become orders in the store, and the counter can always be rebuilt from the reservations.',
  ],
  highLevel: {
    label: 'Run the first seconds of a sale',
    intro:
      'Follow one buyer through the rush at the moment a sale opens, from the waiting room to a paid order, and see what keeps stock exact when units are reserved and released. The design grows as it needs to: watch the opening rush crush checkout until a waiting room joins, then the counter, the durable reservations and the sweeper. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      { id: 'buyers', title: 'Buyers', detail: 'A million at once', column: 0, row: 'middle' },
      {
        id: 'edge',
        title: 'Edge + CDN',
        detail: 'Page, status, bot checks',
        column: 1,
        row: 'middle',
      },
      {
        id: 'room',
        title: 'Waiting room',
        detail: 'Admits at a fixed rate',
        column: 2,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'checkout',
        title: 'Checkout API',
        detail: 'Needs a pass',
        column: 3,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'counter',
        title: 'Stock counter',
        detail: 'Atomic, in memory',
        column: 3,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'payments',
        title: 'Payments',
        detail: 'Authorize, then capture',
        column: 3,
        row: 'bottom',
        appearsAt: 7,
      },
      {
        id: 'log',
        title: 'Reservations',
        detail: 'Durable, one per hold',
        column: 4,
        row: 'middle',
        appearsAt: 5,
      },
      {
        id: 'sweeper',
        title: 'Hold sweeper',
        detail: 'Expires and repairs',
        column: 4,
        row: 'top',
        appearsAt: 8,
      },
      {
        id: 'writer',
        title: 'Order writer',
        detail: 'Idempotent',
        column: 5,
        row: 'middle',
        appearsAt: 7,
      },
      {
        id: 'db',
        title: 'Orders DB',
        detail: 'One per reservation',
        column: 5,
        row: 'bottom',
        appearsAt: 7,
      },
    ],
    edges: [
      ['buyers', 'edge'],
      ['edge', 'checkout'],
      ['edge', 'room'],
      ['room', 'checkout'],
      ['checkout', 'counter', 'reserve'],
      ['checkout', 'log'],
      ['room', 'counter'],
      ['checkout', 'payments'],
      ['log', 'writer'],
      ['writer', 'db'],
      ['sweeper', 'log', 'sweep'],
      ['sweeper', 'counter'],
    ],
    edgeStages: [
      { edge: ['edge', 'checkout'], stages: [1] },
      { edge: ['room', 'counter'], stages: [6, 8] },
    ],
    stages: [
      {
        title: 'Serve the page from the edge',
        narration:
          'The sale page is static and cached at the edge, with a countdown driven by the server clock. In the last minute a million buyers refresh it every couple of seconds. Basic bot checks run there too: rate limits per address, and a challenge for traffic that looks automated.',
        tradeoff:
          'Rendering the page from origin would melt it minutes before the sale even starts. A static page costs some flexibility, such as showing live stock on it, and in exchange the edge absorbs the refresh traffic at no cost to the backend.',
        nodes: ['buyers', 'edge'],
        travel: [['buyers', 'edge']],
        short: 'Edge page',
        metrics: { users: '1M', requestsPerSecond: '500K', p95Latency: '30 ms', errorRate: '0%' },
        load: { edge: 40 },
      },
      {
        title: 'Everyone hits checkout at once',
        narration:
          'At first the page links straight to checkout. When the countdown hits zero, a million buyers and their scripts press buy in the same second. Checkout servers run out of connections, about a third of the requests fail outright and the rest wait for seconds, and buyers retry in a loop that only adds load.',
        tradeoff:
          'Adding checkout servers would not help much: the demand is a spike of one second, far above any fleet worth paying for, and the winners are whoever retries fastest. The backend needs a steady, fair flow of buyers, not more capacity for the spike.',
        nodes: ['buyers', 'edge', 'checkout'],
        travel: [
          ['buyers', 'edge'],
          ['edge', 'checkout'],
        ],
        short: 'Opening rush',
        metrics: {
          users: '1M',
          requestsPerSecond: '1M',
          p95Latency: '6 s',
          errorRate: '35%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { edge: 70, checkout: 99 },
        traffic: [{ edge: ['edge', 'checkout'], kind: 'failed' }],
      },
      {
        title: 'Line up in a waiting room',
        narration:
          'A waiting room joins. Buyers who arrive before the start join it and get a signed ticket with a random draw; at opening time the draws become the order of the line. Later arrivals get the next number at the back. While they wait, buyers poll a small status object at the edge every 5 seconds.',
        tradeoff:
          'Letting everyone hit checkout at once and rejecting the overflow rewards whoever retries fastest, which means scripts. A waiting room costs an extra hop and a page that buyers watch, and in exchange the load behind it is flat and the order is fair.',
        nodes: ['edge', 'room'],
        travel: [['edge', 'room']],
        short: 'Waiting room',
        metrics: {
          users: '1M',
          requestsPerSecond: '200K',
          p95Latency: '40 ms',
          errorRate: '0.02%',
          custom: [{ label: 'Joins / s at peak', value: '20K' }],
        },
        load: { edge: 45, room: 50 },
      },
      {
        title: 'Admit with a signed pass',
        narration:
          'Every second the room moves the line forward by up to 1,000 places and publishes how far it has reached. A buyer whose place has been reached trades the ticket for a pass signed by the room, bound to the account and the sale and valid for 5 minutes. Checkout verifies the signature without calling anything else.',
        tradeoff:
          'A pass that checkout must look up in a shared store would turn the store into a new hot spot. A signed, self-contained pass is checked locally on every checkout server; the cost is that a pass cannot be revoked early, which a short validity makes acceptable.',
        nodes: ['room', 'checkout'],
        travel: [['room', 'checkout']],
        short: 'Signed pass',
        metrics: {
          users: '1M',
          requestsPerSecond: '200K',
          p95Latency: '40 ms',
          errorRate: '0.02%',
          custom: [{ label: 'Admitted / s', value: '1,000' }],
        },
        load: { room: 50, checkout: 45 },
      },
      {
        title: 'Reserve in memory, atomically',
        narration:
          'Checkout runs one atomic step on an in-memory store: check that the buyer is under the limit of 2 and stock covers the quantity, then decrement stock, count the units against the buyer and record the hold under the idempotency key of the request. Either all of it happens or none of it does, and the same key returns the same hold.',
        tradeoff:
          'Decrementing a row in the database with a conditional update is correct, but every request queues on the same row and the database becomes the bottleneck. An in-memory counter handles orders of magnitude more operations per second. The cost is a second store that must agree with the durable record, so the next step writes that record before the buyer is answered.',
        nodes: ['checkout', 'counter'],
        travel: [['checkout', 'counter', 'reserve']],
        short: 'Reserve',
        metrics: {
          users: '1M',
          requestsPerSecond: '200K',
          p95Latency: '40 ms',
          errorRate: '0.02%',
          custom: [{ label: 'Reserves / s', value: '1,000' }],
        },
        load: { checkout: 50, counter: 60 },
      },
      {
        title: 'Write the reservation before answering',
        narration:
          'Checkout writes the reservation to a durable table before the buyer hears "reserved": its id, the buyer, the quantity, a deadline 5 minutes away and the status "reserved". The write only succeeds if no reservation with that id exists, so a repeat changes nothing.',
        tradeoff:
          'Answering from the counter alone is fastest, but a reservation needs a life of its own: it is paid or it expires, and the counter must be rebuildable from it. The decrement and the write are two steps. A crash between them leaves a hold with no reservation, which undersells and never oversells; the buyer’s retry with the same key finishes the write, and if no retry comes a background sweeper, which joins in a later stage, finishes it within 30 to 90 seconds, so the hold expires like any unpaid one.',
        nodes: ['checkout', 'log'],
        travel: [['checkout', 'log']],
        short: 'Durable write',
        metrics: {
          users: '1M',
          requestsPerSecond: '200K',
          p95Latency: '45 ms',
          errorRate: '0.02%',
          custom: [{ label: 'Durable writes / s', value: '1,000' }],
        },
        load: { checkout: 50, counter: 60, log: 45 },
      },
      {
        title: 'All units held stops the line',
        narration:
          'The room now also reads the counter: each second it reads the units still available and, in that second, admits no more buyers than that. About 25 seconds after the start the counter reaches zero: the line stops, and the status at the edge tells everyone that all units are held and some may return. Buyers then poll every 30 seconds.',
        tradeoff:
          'Without this, a million buyers would each walk through checkout just to hear no. Admitted buyers take about 10 seconds to press buy, so the room keeps admitting while the counter still shows stock: about 25,000 buyers are admitted for 15,400 reservations, and the counter turns the rest away correctly. "Sold out" is only announced when every unit is paid.',
        nodes: ['counter', 'room', 'edge'],
        travel: [['room', 'counter']],
        short: 'All held',
        metrics: {
          users: '1M',
          requestsPerSecond: '33K',
          p95Latency: '30 ms',
          errorRate: '0.02%',
          custom: [{ label: 'Time to all held', value: '~25 s' }],
        },
        load: { edge: 30, room: 20, counter: 15 },
      },
      {
        title: 'Pay before the deadline',
        narration:
          'The buyer pays within 5 minutes. Checkout has the payment provider authorize the amount, then moves the reservation from reserved to paid with a conditional write, and only then captures the charge. A captured reservation flows to the order writer, which creates one order in the store, keyed by the reservation id.',
        tradeoff:
          'Charging inside the reserve call would hold a scarce unit hostage to a slow payment provider during the busiest second. Splitting reserve and pay keeps the hot path short; the cost is a deadline to enforce and units held for a while by people who may never pay.',
        nodes: ['checkout', 'payments', 'log', 'writer', 'db'],
        travel: [
          ['checkout', 'payments'],
          ['checkout', 'log'],
          ['log', 'writer'],
          ['writer', 'db'],
        ],
        short: 'Pay',
        metrics: {
          users: '1M',
          requestsPerSecond: '33K',
          p95Latency: '300 ms',
          errorRate: '0.2%',
          custom: [{ label: 'Payments / s at peak', value: '200' }],
        },
        load: { checkout: 30, payments: 45, log: 30, writer: 25, db: 20 },
      },
      {
        title: 'Unpaid units go back',
        narration:
          'A sweeper joins. Every minute it finds reservations whose deadline passed more than 60 seconds ago, marks each one expired with the same kind of conditional write that pay uses, and then returns its units to the counter. The waiting room sees stock again on its next read and admits more buyers: about 4,000 units come back from the first wave.',
        tradeoff:
          'Without a release the sale ends "sold out" with unpaid units sitting idle. Releasing needs care: pay and expiry both write "only if still reserved", so a unit is either paid or returned, never both. Because the charge is captured only after pay wins, a buyer who loses the race is not charged. The cost is that units return 6 to 7 minutes after they were reserved, not at once.',
        nodes: ['sweeper', 'log', 'counter', 'room'],
        travel: [
          ['sweeper', 'log', 'sweep'],
          ['sweeper', 'counter'],
          ['room', 'counter'],
        ],
        short: 'Release',
        metrics: {
          users: '1M',
          requestsPerSecond: '33K',
          p95Latency: '300 ms',
          errorRate: '0.2%',
          custom: [{ label: 'Units returned', value: '~4,000' }],
        },
        load: { sweeper: 30, log: 25, counter: 20, room: 25 },
      },
      {
        title: 'The reservations have the last word',
        narration:
          'The reservations table is the source of truth. Every minute the sweeper compares it with the counter. If the counter is lost or drifts, the sale pauses, the sweeper reads every reservation with a consistent read and sets the counter to stock minus the units reserved or paid, with every open hold and its idempotency key, and the sale resumes. The same rebuild sets the counter before every sale.',
        tradeoff:
          'Trusting the in-memory counter forever would be simpler, and a bug or a lost store could then oversell silently. Checking it against durable records costs a query every minute and a pause of up to about two minutes when a rebuild is needed, and makes any drift visible and fixable.',
        nodes: ['sweeper', 'log', 'counter'],
        travel: [
          ['sweeper', 'log', 'sweep'],
          ['sweeper', 'counter'],
        ],
        short: 'Reconcile',
        metrics: {
          users: '1M',
          requestsPerSecond: '33K',
          p95Latency: '300 ms',
          errorRate: '0.2%',
          custom: [{ label: 'Stock drift', value: '0' }],
        },
        load: { sweeper: 40, log: 35, counter: 15 },
        traffic: [{ edge: ['sweeper', 'log'], kind: 'heavy' }],
      },
    ],
  },
  flows: [
    {
      id: 'join',
      title: 'Join the waiting room',
      kind: 'sync',
      summary:
        'Dee opens the sale page ten minutes early and joins the line. She gets a signed ticket with a random draw, one per account, and then only polls the edge.',
      runsOn: 'CloudFront + AWS WAF → waiting room on ECS → ElastiCache',
      participants: [
        { id: 'app', label: 'Dee’s app', service: 'Client' },
        { id: 'edge', label: 'Edge', service: 'CloudFront + AWS WAF' },
        { id: 'room', label: 'Waiting room', service: 'ECS Fargate' },
        { id: 'store', label: 'Room store', service: 'ElastiCache for Valkey' },
      ],
      steps: [
        {
          from: 'app',
          to: 'edge',
          label: 'GET sale page',
          note: 'A static page with a countdown, served from the edge cache. A million buyers refreshing it never reach the origin.',
        },
        {
          from: 'app',
          to: 'edge',
          label: 'POST /sales/s42/queue',
          note: 'Dee must be signed in. A rate-based rule limits joins per address, and traffic that looks automated gets a challenge before it goes any further.',
        },
        {
          from: 'edge',
          to: 'room',
          label: 'join, account a7',
          note: 'Joins peak at about 20,000 a second in the last seconds before the start, which a fleet of small stateless tasks absorbs.',
        },
        {
          from: 'room',
          to: 'store',
          label: 'script: ticket for a7, or create one',
          note: 'The room task makes a random draw between 0 and 1 with a secure generator and passes it to one atomic script. If the account already has a draw or a number stored, that one is returned and the new draw is dropped. If not, before the start the script stores the draw and the count of early arrivals goes up by one; after the start it stores the next sequence number.',
        },
        {
          from: 'room',
          to: 'app',
          label: 'ticket {s42, a7, draw 0.0042}, signed',
          style: 'reply',
          note: 'The app keeps the ticket. The room store keeps the draw of a7, so joining again, from another device or a thousand times, returns the same ticket and cannot improve the draw.',
        },
        {
          from: 'app',
          to: 'edge',
          label: 'GET /sales/s42/status every 5 s',
          note: 'A small object cached at the edge for one second. A million buyers polling is 200,000 requests a second at the edge. Concurrent misses for the same object at an edge location are collapsed into one origin request, so the origin sees roughly one request a second per edge location, a few hundred to a few thousand in total.',
        },
      ],
    },
    {
      id: 'admit',
      title: 'Get admitted',
      kind: 'sync',
      summary:
        'At the start the draws become the order of the line. The room moves the line 1,000 places a second, and Dee trades her ticket for a pass when her place is reached.',
      runsOn: 'Waiting room on ECS → ElastiCache → status object on S3 behind CloudFront',
      participants: [
        { id: 'app', label: 'Dee’s app', service: 'Client' },
        { id: 'edge', label: 'Status at the edge', service: 'CloudFront + S3' },
        { id: 'room', label: 'Waiting room', service: 'ECS Fargate' },
        { id: 'store', label: 'Room store', service: 'ElastiCache for Valkey' },
        { id: 'counter', label: 'Stock counter', service: 'MemoryDB' },
      ],
      steps: [
        {
          from: 'room',
          to: 'store',
          label: 'script: open s42, freeze early count',
          note: 'At the opening time one script sets the "opened" flag and freezes the number of early arrivals: 1,000,000. Every task tries; the flag makes it happen once. A join after this is a late arrival.',
        },
        {
          from: 'room',
          to: 'counter',
          label: 'read available units',
          note: 'Once a second. Also tells the room whether the sale is paused or sold out, which goes into the status.',
        },
        {
          from: 'room',
          to: 'store',
          label: 'script: advance the line',
          note: 'Adds the smaller of 1,000 and the units available to "admitted through", at most once per second: the script records the second it ran for, so any number of tasks can call it.',
        },
        {
          from: 'room',
          to: 'edge',
          label: 'PUT status {open, through 5,000, early 1M}',
          note: 'Written once a second with the time of the update. It also carries what the room needs to start again: the opened flag, the early count, the last sequence number given to a late arrival and "admitted through". An app that sees a status older than 10 seconds shows "paused", so a stopped room is visible and admits nobody.',
        },
        {
          from: 'app',
          to: 'edge',
          label: 'GET status',
          note: 'The app computes its place from its own ticket: 0.0042 × 1,000,000 = 4,200. Late arrivals are 1,000,000 plus their sequence number. Dee is reached in the fifth second.',
        },
        {
          from: 'app',
          to: 'room',
          label: 'POST /sales/s42/pass {ticket}',
          note: 'Only buyers whose place has been reached call the room, so it sees about 1,000 pass requests a second, not a million polls.',
        },
        {
          from: 'room',
          to: 'store',
          label: 'check place 4,200 ≤ 5,000, record the pass',
          note: 'The room verifies the signature of the ticket and that it belongs to the signed-in account, computes the place again on its side, and records when the pass expires. A ticket has one live pass at a time: a new one is issued only when the last has expired, so a pass can be renewed after a pause or for a later wave and never multiplied.',
        },
        {
          from: 'room',
          to: 'app',
          label: 'pass {s42, a7, expires in 5 min}, signed',
          style: 'reply',
          note: 'Signed with a private key only the room can read. Checkout holds the public key and verifies the pass without calling the room.',
        },
      ],
    },
    {
      id: 'reserve',
      title: 'Reserve a unit',
      kind: 'sync',
      summary:
        'Dee asks for 2 units. One atomic script takes them from the counter, and checkout writes the reservation durably before it answers.',
      runsOn: 'Checkout on ECS → MemoryDB script → DynamoDB',
      participants: [
        { id: 'app', label: 'Dee’s app', service: 'Client' },
        { id: 'checkout', label: 'Checkout API', service: 'ECS Fargate' },
        { id: 'counter', label: 'Stock counter', service: 'MemoryDB' },
        { id: 'table', label: 'Reservations', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'checkout',
          label: 'POST /sales/s42/reservations {2, key k-91}',
          note: 'Checkout verifies the pass on its own: signature, sale, expiry, and that the account in the pass is the signed-in account. A request without a valid pass ends here.',
        },
        {
          from: 'checkout',
          to: 'counter',
          label: 'script: reserve 2 for a7, key k-91',
          note: 'One atomic script: the sale must be armed, the key must be new, a7 must stay within 2 units and stock must cover 2. Then stock goes from 13,480 to 13,478, a7 is at 2, and hold r-5521 is recorded with its deadline and listed as not yet written.',
        },
        {
          from: 'counter',
          to: 'checkout',
          label: 'OK r-5521',
          style: 'reply',
          note: 'The store answers only after the write is in its log in several zones, so a failover keeps this decrement. A repeated call with k-91 returns r-5521 again without touching stock.',
        },
        {
          from: 'checkout',
          to: 'table',
          label: 'PUT r-5521 reserved, if absent',
          note: 'Status reserved, 2 units, the key k-91 and a deadline in 5 minutes. The condition makes a repeat harmless: if the item is already there, by a retry or by the sweeper, checkout reads it and answers with its current state.',
        },
        {
          from: 'checkout',
          to: 'counter',
          label: 'mark r-5521 written',
          note: 'Removes the hold from the "not yet written" list. If this step is missed the sweeper finds the reservation in the table and removes it.',
        },
        {
          from: 'checkout',
          to: 'app',
          label: '201 {r-5521, pay by 12:05:14}',
          style: 'reply',
          note: 'Only now does Dee hear "reserved": the unit is out of the counter and the reservation is durable. Reserve calls have a budget of 2 seconds end to end.',
        },
      ],
    },
    {
      id: 'reserve-retry',
      title: 'A reserve call dies halfway',
      kind: 'sync',
      summary:
        'Checkout crashes after the counter took the unit and before the reservation was written. The retry with the same key finishes the job; without a retry the sweeper does.',
      runsOn: 'Checkout on ECS → MemoryDB script → DynamoDB; sweeper as the backstop',
      participants: [
        { id: 'app', label: 'Sam’s app', service: 'Client' },
        { id: 'checkout', label: 'Checkout API', service: 'ECS Fargate' },
        { id: 'counter', label: 'Stock counter', service: 'MemoryDB' },
        { id: 'table', label: 'Reservations', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'checkout',
          label: 'POST reservations {1, key k-17}',
          note: 'The key is made by the app once per press of the buy button and kept until the app has an answer.',
        },
        {
          from: 'checkout',
          to: 'counter',
          label: 'script: reserve 1, key k-17 → r-7002',
          note: 'Stock goes down by one and hold r-7002 is recorded and listed as not yet written.',
        },
        {
          from: 'checkout',
          to: 'checkout',
          label: 'task killed before the write',
          note: 'The unit is out of the counter and no reservation exists. This is the gap between the two stores: it undersells by one and can never oversell.',
        },
        {
          from: 'app',
          to: 'checkout',
          label: 'retry with key k-17',
          note: 'The app times out after 3 seconds and retries with the same key, up to three times with a growing pause. After that it shows "check your reservations" and reads the list, which also asks the counter for the holds of the account, so a hold that is not written yet still shows.',
        },
        {
          from: 'checkout',
          to: 'counter',
          label: 'script: reserve 1, key k-17',
          note: 'The script finds k-17 and returns r-7002 with its original deadline. Nothing is decremented a second time.',
        },
        {
          from: 'checkout',
          to: 'table',
          label: 'PUT r-7002 reserved, if absent',
          note: 'Finishes the write. If Sam had never retried, the sweeper would write this same item on its first run after the hold had been unwritten for 30 seconds, so within 30 to 90 seconds. A hold is only ever completed forward, never undone here, so a slow first call that writes late finds the item already there. Undoing the hold could race that late write and leave a reservation for a unit already returned.',
        },
        {
          from: 'checkout',
          to: 'app',
          label: '201 {r-7002, same deadline}',
          style: 'reply',
          note: 'One unit, one reservation, however many times the call was made.',
        },
      ],
    },
    {
      id: 'pay',
      title: 'Pay for a reservation',
      kind: 'sync',
      summary:
        'Dee pays with two minutes left. The amount is authorized first, one conditional write turns the reservation into a sale, and only then is the charge captured and the order created.',
      runsOn: 'Checkout on ECS → payment provider → DynamoDB → Streams → Lambda → Aurora',
      participants: [
        { id: 'app', label: 'Dee’s app', service: 'Client' },
        { id: 'checkout', label: 'Checkout API', service: 'ECS Fargate' },
        { id: 'table', label: 'Reservations', service: 'DynamoDB' },
        { id: 'psp', label: 'Payment provider', service: 'External API' },
        { id: 'writer', label: 'Order writer', service: 'DynamoDB Streams + Lambda' },
        { id: 'orders', label: 'Orders DB', service: 'Aurora PostgreSQL' },
      ],
      steps: [
        {
          from: 'app',
          to: 'checkout',
          label: 'POST /reservations/r-5521/pay {token, key p-3}',
          note: 'The card was collected by the payment provider; the store only sees a token. The app makes a payment key once per press of pay and sends it again on a retry. No pass is needed: the reservation belongs to the signed-in account.',
        },
        {
          from: 'checkout',
          to: 'table',
          label: 'UPDATE add attempt p-3 WHERE reserved',
          note: 'Records that a payment started under key p-3, only while the status is reserved. A repeat with p-3 finds the attempt and reuses it, so one press of pay is one attempt however often it is sent. The answer carries the deadline; if it has passed, checkout stops here with 410. If the reservation is already paid, checkout answers 200 paid and starts nothing; if it has expired or was cancelled, 410.',
        },
        {
          from: 'checkout',
          to: 'psp',
          label: 'authorize, key r-5521-p-3',
          note: 'The key is the reservation id and the payment key, so a repeated call never authorizes twice. The call times out after 10 seconds, and at most 300 are in flight at once, a fixed share per checkout task, so the rest of the store keeps its share of the provider. Only a decline counts toward the three allowed; a timeout, a provider error or a call refused by the cap does not.',
        },
        {
          from: 'checkout',
          to: 'table',
          label: 'UPDATE status=paid by p-3 WHERE status=reserved',
          note: 'The one write that turns a hold into a sale, and it records which attempt paid. The sweeper expires with the same condition, so exactly one of them succeeds. If the condition fails because the reservation expired, checkout voids the authorization and answers 410. If it is already paid, checkout answers 200 paid and voids its authorization unless it is the one that paid. On an error or a timeout checkout reads the reservation back with a consistent read; if it still cannot tell, it voids nothing and the sweeper resolves it.',
        },
        {
          from: 'checkout',
          to: 'psp',
          label: 'capture, key r-5521-p-3',
          note: 'Money moves only after the reservation is paid. If checkout crashes here, the sweeper captures paid reservations that are still not captured after a minute, with the same key.',
        },
        {
          from: 'checkout',
          to: 'table',
          label: 'SET capturedAt WHERE paid, leave the open list',
          note: 'Written only while the status is still paid, so a capture that lands after a cancellation creates no order and is refunded. Checkout then answers Dee: paid. A reservation with a single attempt no longer needs the sweeper; one with other attempts stays in the open list until the sweeper has voided them.',
        },
        {
          from: 'table',
          to: 'writer',
          label: 'stream: r-5521 captured',
          style: 'async',
          note: 'The change stream delivers at least once, in order per reservation. The writer handles one batch per shard at a time, so the store’s database sees a trickle, not the sale.',
        },
        {
          from: 'writer',
          to: 'orders',
          label: 'INSERT order, unique on r-5521',
          note: 'A repeated record hits the unique reservation id and changes nothing. The order is in the store about a second after the capture. A reservation that is cancelled after its capture reaches the writer the same way, and its order is marked cancelled: the order always follows the current status of the reservation.',
        },
      ],
    },
    {
      id: 'expire',
      title: 'An unpaid hold expires',
      kind: 'scheduled',
      summary:
        'Lin reserved a unit and closed the tab. A minute after the deadline the sweeper expires the reservation, returns the unit and the line moves again.',
      runsOn: 'EventBridge Scheduler → Lambda → DynamoDB → MemoryDB',
      participants: [
        { id: 'sched', label: 'Schedule', service: 'EventBridge Scheduler' },
        { id: 'sweeper', label: 'Hold sweeper', service: 'Lambda' },
        { id: 'table', label: 'Reservations', service: 'DynamoDB' },
        { id: 'counter', label: 'Stock counter', service: 'MemoryDB' },
        { id: 'room', label: 'Waiting room', service: 'ECS Fargate' },
      ],
      steps: [
        {
          from: 'sched',
          to: 'sweeper',
          label: 'every minute',
          note: 'One run per minute per sale. A run that overlaps the next is harmless: every write below is conditional or safe to repeat.',
        },
        {
          from: 'sweeper',
          to: 'table',
          label: 'query open reservations, 16 buckets',
          note: 'An index lists reservations that still need work: reserved, expired or cancelled but not released, paid but not captured, and ended with an attempt still to void. It is sorted by deadline and split in 16 buckets so no single key takes all the writes.',
        },
        {
          from: 'sweeper',
          to: 'table',
          label: 'UPDATE r-6100 expired WHERE reserved',
          note: 'Only for deadlines that passed more than 60 seconds ago, counting the hold extension when it is on, so a payment that started in time has finished. If Lin paid in the meantime the write fails and the sweeper moves on.',
        },
        {
          from: 'sweeper',
          to: 'counter',
          label: 'script: release r-6100',
          note: 'Stock goes up by one, Lin’s count goes down by one and the hold is marked released. A second call for the same hold does nothing.',
        },
        {
          from: 'sweeper',
          to: 'table',
          label: 'SET releasedAt, leave the open list',
          note: 'If the sweeper dies between the expire and the release, the reservation stays in the open list as expired and not released, and the next run finishes it.',
        },
        {
          from: 'room',
          to: 'counter',
          label: 'read available: 4,000',
          note: 'About 4,000 units come back between about 6 and 7.5 minutes after the start, since the first holds were taken in the first 25 seconds. The room admits 1,000 buyers a second again until none are available.',
        },
      ],
    },
    {
      id: 'late-payment',
      title: 'A payment finishes too late',
      kind: 'scheduled',
      summary:
        'Noor pays five seconds before the deadline and the bank does not answer. Expiry wins the reservation, the authorization is voided and the unit goes back.',
      runsOn: 'Checkout on ECS → payment provider; sweeper Lambda → DynamoDB → MemoryDB',
      participants: [
        { id: 'app', label: 'Noor’s app', service: 'Client' },
        { id: 'checkout', label: 'Checkout API', service: 'ECS Fargate' },
        { id: 'psp', label: 'Payment provider', service: 'External API' },
        { id: 'table', label: 'Reservations', service: 'DynamoDB' },
        { id: 'sweeper', label: 'Hold sweeper', service: 'Lambda' },
        { id: 'counter', label: 'Stock counter', service: 'MemoryDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'checkout',
          label: 'POST /reservations/r-7044/pay',
          note: 'Five seconds before the deadline. A payment only has to start before the deadline to be accepted.',
        },
        {
          from: 'checkout',
          to: 'table',
          label: 'UPDATE add attempt p-8 WHERE reserved',
          note: 'The reservation now lists a payment attempt, which tells the sweeper there may be an authorization to cancel.',
        },
        {
          from: 'checkout',
          to: 'psp',
          label: 'authorize, key r-7044-p-8',
          note: 'The bank is slow. Checkout gives up after 10 seconds and answers Noor that the payment is not confirmed. It does not know whether the authorization went through.',
        },
        {
          from: 'sweeper',
          to: 'table',
          label: 'UPDATE r-7044 expired WHERE reserved',
          note: 'Sixty seconds after the deadline, with no "paid" written, the sweeper wins the reservation. From here a pay call can only fail its conditional write.',
        },
        {
          from: 'sweeper',
          to: 'counter',
          label: 'script: release r-7044',
          note: 'The unit goes back on sale first; the release does not wait for the payment provider. Nothing was captured, so nothing has to be refunded.',
        },
        {
          from: 'sweeper',
          to: 'psp',
          label: 'void, key r-7044-p-8',
          note: 'Because a payment was started, the sweeper voids every attempt of the reservation by its key, whether it went through or not, and records the outcome on the attempt. A provider answer that there is nothing to void counts as voided. It tries on up to five runs; an authorization that is never captured lapses on its own, and one still not voided after 15 minutes raises an alarm.',
        },
        {
          from: 'app',
          to: 'checkout',
          label: 'retry pay → 410 expired',
          note: 'The reservation is no longer reserved, so no second authorization is started. With a payment method that charges in one step, a charge that lands after expiry is refunded by its payment id.',
        },
      ],
    },
    {
      id: 'rebuild',
      title: 'The counter is rebuilt',
      kind: 'scheduled',
      summary:
        'The drift check finds the counter and the reservations disagree, or the counter store comes back empty. The sale pauses, the counter is recomputed from the reservations, and the sale resumes.',
      runsOn: 'Sweeper Lambda → MemoryDB → DynamoDB consistent queries',
      participants: [
        { id: 'ops', label: 'Trigger', service: 'Sweeper, room or alarm' },
        { id: 'sweeper', label: 'Rebuild job', service: 'Lambda' },
        { id: 'counter', label: 'Stock counter', service: 'MemoryDB' },
        { id: 'table', label: 'Reservations', service: 'DynamoDB' },
        { id: 'checkout', label: 'Checkout API', service: 'ECS Fargate' },
      ],
      steps: [
        {
          from: 'ops',
          to: 'sweeper',
          label: 'rebuild s42',
          note: 'Started by the sweeper or the waiting room the moment either finds no armed mark on an open sale, by the drift alarm, by the on-call, or by the setup of every sale: the first "rebuild" of a sale finds no reservations and sets the counter to the full stock. A conditional write on the sale record starts each rebuild under a new generation number and lets one run at a time; a rebuild that has not finished after five minutes can be replaced, and the script that arms the counter refuses an older generation, so a slow first job cannot overwrite a newer counter. After three automatic rebuilds in an hour the sale stays paused and the on-call is paged.',
        },
        {
          from: 'sweeper',
          to: 'counter',
          label: 'remove the armed mark',
          note: 'Every script checks this mark first. A store that comes back empty has no mark either, so a counter is never used before a rebuild has set it.',
        },
        {
          from: 'checkout',
          to: 'counter',
          label: 'reserve → paused',
          note: 'Buyers get 503 with "the sale is paused, your place is kept". A pass that runs out during the pause is renewed when the sale resumes.',
        },
        {
          from: 'sweeper',
          to: 'table',
          label: 'write every unwritten hold',
          note: 'Holds the counter still lists as not written are written as reservations first, so a late write from a slow checkout call finds its item already there. If the counter store was lost, that list is gone; the job waits 60 seconds, far beyond the 2-second budget of a reserve call, which makes the pause about two minutes.',
        },
        {
          from: 'sweeper',
          to: 'table',
          label: 'consistent query, 16 buckets',
          note: 'Strongly consistent reads of the table itself, not of an index. The job adds up the units of every reservation that is reserved or paid, and the units per buyer, and collects the idempotency key of every open hold: 16,300 units.',
        },
        {
          from: 'sweeper',
          to: 'counter',
          label: 'script: stock 3,700, holds, armed',
          note: 'One script sets stock to 20,000 − 16,300 = 3,700, the count per buyer and the open holds with their idempotency keys, and sets the armed mark, only if its generation is still the current one, so a retry with an old key still finds its hold. Reservations that this query read as expired or cancelled and not released are marked released: their units are already back in the new stock. One that the sweeper expires after the query is released by the sweeper, against the hold the rebuild just restored.',
        },
        {
          from: 'checkout',
          to: 'counter',
          label: 'reserve works again',
          note: 'The next drift check runs within a minute. If the table alone shows more units reserved or paid than the stock, because a reservation was written after the query, the sweeper pauses the sale at once by removing the armed mark, cancels the newest reservations beyond the stock with a conditional write, and voids or refunds their payments. A rebuild follows and counts the cancelled ones as released, so their units are not returned twice.',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'Where do we decrement stock?',
      options: [
        {
          name: 'Conditional update on one database row',
          pros: 'Durable and simple; the database guarantees no oversell.',
          cons: 'Every buyer waits on the same row; throughput is capped around a thousand writes a second, which is the admission rate with no headroom, and every rejection hits the row too.',
        },
        {
          name: 'Atomic counter in an in-memory store',
          pros: 'Very high throughput with a single atomic script per request, which also holds the limit per buyer and the idempotency key.',
          cons: 'A second store that must agree with the durable record, and a way to rebuild it.',
        },
        {
          name: 'Split stock into buckets across nodes',
          pros: 'Scales past one node by spreading the counter.',
          cons: 'Buyers may hit an empty bucket while others still have stock, so it needs rebalancing.',
        },
      ],
      choice:
        'An atomic in-memory counter, with every reservation written durably before the buyer is told yes. With a waiting room in front, one counter per sale is enough; buckets are kept for much larger sales.',
    },
    {
      question: 'How do we admit a million buyers fairly?',
      options: [
        {
          name: 'No line: rate limit and reject',
          pros: 'Nothing new to build.',
          cons: 'Rewards retries and scripts, and buyers see errors instead of progress.',
        },
        {
          name: 'First in, first out waiting room',
          pros: 'Predictable and easy to explain.',
          cons: 'Rewards whoever connects a few milliseconds earlier, which again favors scripts.',
        },
        {
          name: 'Random order for early arrivals, then first in, first out',
          pros: 'Being online at the start is enough; shaving milliseconds gains nothing. A random draw in each signed ticket needs no sort of a million entries.',
          cons: 'Buyers who arrived early may still be near the back, which needs a clear message, and places are estimates until the count of early arrivals is frozen.',
        },
      ],
      choice:
        'A random draw for everyone who joins before the start, then sequence numbers for later arrivals. A place is the draw times the number of early arrivals, computed by the app from the status at the edge, so nobody asks a server for a place. The admission rate is set from a rehearsal at twice the expected load, and the on-call can lower it during the sale.',
    },
    {
      question: 'How do we keep bots from buying everything?',
      options: [
        {
          name: 'Challenges at the edge',
          pros: 'Stops the cheapest automation before it costs anything.',
          cons: 'Determined buyers solve or outsource them, and they add friction for everyone.',
        },
        {
          name: 'Accounts and limits',
          pros: 'Verified, older accounts with a per-buyer limit make each extra unit costly to grab.',
          cons: 'Real buyers with new accounts get caught, and stolen accounts slip through.',
        },
        {
          name: 'Audit after the sale',
          pros: 'Cancels orders that share cards, addresses or devices before anything ships.',
          cons: 'Happens late, and the cancelled units must be resold.',
        },
      ],
      choice:
        'All three in layers: challenges at the edge, one ticket per account with a limit of 2 units enforced in the counter, and an audit before shipping. The random line removes the main reward for speed.',
    },
    {
      question: 'What happens when the counter store fails?',
      options: [
        {
          name: 'A cache with asynchronous replicas',
          pros: 'The fastest writes and the most common setup.',
          cons: 'A failover can drop the last decrements, and the promoted replica then shows more stock than exists. Every failover would have to pause the sale and rebuild.',
        },
        {
          name: 'An in-memory store that logs each write in several zones before answering',
          pros: 'A failover keeps every decrement that was answered, so the sale continues once a replica is promoted, typically in under 20 seconds.',
          cons: 'Writes take a few milliseconds instead of a fraction of one, and throughput per node is lower.',
        },
        {
          name: 'No in-memory store: the database only',
          pros: 'One store and no rebuild.',
          cons: 'Back to one hot row at the busiest second.',
        },
      ],
      choice:
        'The store that logs before answering. A few milliseconds per write is nothing at 1,000 reserves a second, and it removes the oversell risk from the common failure. The rebuild from the reservations table stays as the backstop for a lost store or a bug, guarded by an armed mark that only the rebuild sets.',
    },
    {
      question: 'How do pay and expiry race safely?',
      options: [
        {
          name: 'Check the deadline, then update',
          pros: 'The obvious code.',
          cons: 'Between the check and the update the other side can act: a unit is both paid and returned.',
        },
        {
          name: 'A lock on the reservation',
          pros: 'Serializes the two sides.',
          cons: 'A lock with a timeout can expire under a slow payment call and let both in; it needs a fencing check in the store anyway.',
        },
        {
          name: 'One conditional write on the status',
          pros: 'Pay writes "paid" and expiry writes "expired", both only if the status is still "reserved". The store lets one win.',
          cons: 'The loser has to clean up: a lost payment must be voided or refunded.',
        },
      ],
      choice:
        'The conditional write, with the payment split around it: authorize first, write "paid", then capture. A buyer who loses the race only has an authorization, which is voided. Expiry waits 60 seconds past the deadline, longer than the 10-second timeout of a payment call, so a payment that started in time is not beaten by a clock. Each press of pay carries its own payment key, a repeat for a reservation that is already paid is answered "paid", and when a reservation ends every attempt that did not pay is voided.',
    },
    {
      question: 'Can a pass be forged, shared or replayed?',
      options: [
        {
          name: 'An opaque pass looked up in a shared store',
          pros: 'Can be revoked at any moment and marked as used.',
          cons: 'Every reserve call reads the store, which becomes a hot spot and a dependency of checkout.',
        },
        {
          name: 'A signed pass bound to the account, the sale and an expiry',
          pros: 'Verified locally with a public key. A pass sent to another account fails the account check, and forging one needs the private key.',
          cons: 'Cannot be revoked before it expires, and the same account can present it many times.',
        },
        {
          name: 'A signed pass plus a single-use registry',
          pros: 'Each pass works once.',
          cons: 'Brings back the shared lookup, and a retry after a timeout would be refused.',
        },
      ],
      choice:
        'The signed pass, valid for 5 minutes. Replay by the same account gains nothing, because the counter enforces the limit of 2 units per account whatever the number of calls, and the idempotency key makes a repeat return the same reservation. The private key exists per sale and only the waiting room can read it.',
    },
    {
      question: 'How do we keep the sale from taking the store down?',
      options: [
        {
          name: 'Share the store’s services and rate limit the sale',
          pros: 'Nothing new to run.',
          cons: 'One wrong limit and the sale starves normal checkout, the orders database or the payment quota.',
        },
        {
          name: 'A separate cell for the sale',
          pros: 'Its own fleets, stores and limits; the store only receives finished orders at a bounded rate.',
          cons: 'More infrastructure to set up before each sale and to pay for during it.',
        },
        {
          name: 'Run the sale on a separate site',
          pros: 'Total isolation.',
          cons: 'Accounts, orders and stock have to be copied in and out.',
        },
      ],
      choice:
        'A separate cell: the waiting room and sale checkout run on their own fleets with their own stores, the stock of the sale is moved out of normal inventory beforehand, payment calls are capped at 300 in flight, a fixed share per checkout task, and the order writer inserts into the store’s database one batch per stream shard at a time.',
    },
  ],
  wrapUp:
    'Serve the page from the edge, line buyers up with a random draw in a signed ticket, admit them with signed passes at the pace checkout can take, decrement an atomic in-memory counter, write every reservation durably before answering, let one conditional write decide between paid and expired, and keep the reservations as the source of truth the counter is rebuilt from.',
  guarantees: {
    provides: [
      {
        property: 'No oversell',
        promise:
          'Units in reservations that are reserved or paid stay within the stock as long as the counter and the table agree: the counter decrements in one atomic script and acknowledges only after the write is in a log in several zones, and a counter is used only after a rebuild has armed it. A check every minute compares the two. If the table ever shows more units than the stock, the sale pauses at once and the newest reservations beyond it are cancelled, voided or refunded, and their orders marked cancelled; a counter that drifts without that is rebuilt within 5 minutes.',
      },
      {
        property: 'Reservation',
        promise:
          'A buyer who is told "reserved" has a durable reservation: the answer is sent only after the reservations table, which stores every write in several zones, has accepted it. A hold whose write was interrupted is completed by the retry or by the sweeper, and then is paid or expires like any other.',
      },
      {
        property: 'Idempotent reserve',
        promise:
          'A reserve call repeated with the same idempotency key returns the same reservation and takes no extra unit. Delivery of retries is at least once, made harmless by that key in the counter and by the reservation id in the table. The key is stored on the reservation, so a rebuilt counter still knows it.',
      },
      {
        property: 'Paid or returned, never both',
        promise:
          'Pay and expiry each write only if the status is still "reserved", so one of them wins. Money is captured only after pay wins; an authorization that lost is voided, and a one-step charge that lands late is refunded. A repeated pay for a reservation that is already paid is answered "paid", and every attempt that did not pay is voided when the reservation ends.',
      },
      {
        property: 'Limit per buyer',
        promise:
          'An account never holds or buys more than 2 units in a sale. The count lives in the counter, changes in the same atomic step as the stock, and goes down again when a hold is released. After a rebuild of a lost store it rests on the assumption below about reserve calls in flight.',
      },
      {
        property: 'Fair order',
        promise:
          'Everyone who joins before the start has the same chance at every place in line. A ticket is one per account, and joining again returns the same ticket.',
      },
      {
        property: 'Orders',
        promise:
          'Every captured reservation becomes one order in the store, and one cancelled after capture has its order marked cancelled. The change stream delivers at least once, made harmless by the unique reservation id on the order, and a daily comparison of captured reservations with orders catches anything the stream dropped.',
      },
    ],
    assumes: [
      'The counter store acknowledges a write only after it is stored in a log across zones, and reads on its primary see every acknowledged write, also after a failover.',
      'The reservations table applies a conditional write to one item atomically, and a consistent read sees every write acknowledged before it.',
      'A reserve call that passed the counter writes its reservation within its 2-second budget or leaves it to the sweeper. The rebuild of a lost counter store relies on this with a 60-second wait; the drift check is the backstop.',
      'Server clocks agree within a second. The 60 seconds between a deadline and its expiry absorb that and the 10-second payment timeout.',
      'The payment provider honors idempotency keys, can void an authorization by the key it was made with, and answers clearly when a key has nothing to void.',
      'The app keeps its ticket and its idempotency key until it has an answer, and retries with the same key.',
      'The edge honors the one-second cache time of the status object.',
    ],
    doesNotGuarantee: [
      'A unit for every admitted buyer. About 25,000 buyers are admitted for the first 15,400 reservations; the counter decides, and the rest hear "all units are held".',
      'Strict first come, first served. Early arrivals are in random order on purpose, and a returned unit goes to whoever reserves it first among admitted buyers.',
      'An exact place in line. The place is computed by the app from a status up to a second old, and early places are estimates until the start.',
      'That returned units are available at once. An unpaid unit is back on sale 6 to 7 minutes after it was reserved.',
      'One ticket per person. It is one per account; a person with many real accounts gets many draws, which the account rules and the audit limit but do not remove.',
      'A second chance for a payment that started in time and was answered too late: the hold expires and the buyer is not charged.',
      'A hold through every payment outage. The 5-minute extension starts when the alarm fires, about two minutes into an outage; a hold whose deadline fell in the first minute or so can expire before that, and an outage longer than the extension expires holds too. Nobody is charged for an expired hold.',
      'Protection of draws if the room store fails before the start. After a failover a few accounts that joined in the last instant may draw again, and after a full loss every account can; once the sale is open a new join only gets a place at the back. The limit per buyer still holds, because it is enforced by account in the counter.',
    ],
  },
  failures: [
    {
      scenario:
        'Checkout crashes or times out after the counter took the unit and before the reservation was written.',
      impact:
        'One hold exists with no reservation. The buyer has no answer, and the unit is unavailable to others.',
      detection:
        'The counter lists the hold as not yet written. A custom metric tracks the age of the oldest such hold, with an alarm at 2 minutes.',
      recovery:
        'The retry with the same idempotency key returns the same hold and writes the reservation. Without a retry, the sweeper writes it on its first run after the hold is 30 seconds old, so within 30 to 90 seconds; the buyer can find it in their reservations, and unpaid it expires and returns the unit like any other.',
    },
    {
      scenario: 'The primary node of the counter store fails.',
      impact:
        'Reserve calls fail while a replica is promoted, typically under 20 seconds. Buyers see "paused, your place is kept"; the room reads no stock, so it admits nobody.',
      detection: 'Server errors on reserve, and the failover event of the store.',
      recovery:
        'A replica is promoted with every acknowledged write, because writes are logged in several zones before they are answered, so no rebuild is needed. Apps retry with the same key, and a pass that ran out is renewed.',
    },
    {
      scenario:
        'The counter store is lost entirely, or the drift check finds the counter and the reservations disagree.',
      impact:
        'The sale pauses: well under a minute for a drift rebuild with the counter alive, about two minutes for a lost store. No reservation is lost, because every reservation a buyer was told about is in the table.',
      detection:
        'Scripts find no armed mark and answer "paused", and the sweeper or the waiting room starts the rebuild as soon as either sees that on an open sale; or the stock drift metric is not zero for three checks in a row.',
      recovery:
        'The rebuild job removes the armed mark, completes or waits out unwritten holds, reads every reservation with consistent reads, sets stock to the total minus the units reserved or paid, restores the open holds with their idempotency keys, and arms the counter. If the table then shows more units than the stock, the armed mark is removed again, the newest reservations beyond it are cancelled and another rebuild follows. After three automatic rebuilds in an hour the sale stays paused and the on-call is paged.',
    },
    {
      scenario: 'The waiting room stops, or its status object goes stale.',
      impact:
        'Nobody new is admitted. Buyers already admitted can still reserve and pay; buyers in line see "paused" once the status is 10 seconds old.',
      detection:
        'A probe outside the room reads the status object and publishes its age as a high-resolution custom metric, with an alarm at 3 seconds; a stopped room cannot hide it.',
      recovery:
        'Tasks are replaced and the line continues from the stored "admitted through" value. If the room store itself is lost, the room restores the opened flag, the early count, "admitted through" and the last sequence number from the last status object, and adds a margin to the sequence so a late arrival never repeats a place already given. A signed ticket carries its own draw, so a buyer keeps their place, and the room stores the draw again when the ticket is next shown.',
    },
    {
      scenario: 'The payment provider is slow or down while holds are running out.',
      impact:
        'Buyers cannot pay through no fault of their own, and their holds approach the deadline.',
      detection:
        'Authorization errors above 5%, latency above 5 seconds, or pay calls ending in a server error above 5%, for 2 minutes, measured at checkout.',
      recovery:
        'The alarm calls the sweeper function, which switches on the 5-minute hold extension on the sale record; it is switched off when the alarm clears, or by the on-call, and holds it was protecting are not expired until 60 seconds after that, so a payment that started under the extension can finish. While it is on, the sweeper adds it to every deadline before expiring and checkout adds it before refusing a payment. A hold whose deadline fell in the first minute or so of the outage can expire before the alarm fires, which is the accepted loss. Errors, timeouts and calls beyond 300 in flight get "try again in a moment", are not counted as declines, and the hold stays.',
    },
    {
      scenario: 'A reservation is paid and the capture fails, or checkout crashes between the two.',
      impact: 'The buyer owns the unit and no money has moved. No order exists yet.',
      detection:
        'The reservation stays in the open list as paid and not captured; the sweeper sees it after a minute.',
      recovery:
        'The sweeper captures with the same key on every run; a capture that timed out and is repeated is the same capture to the provider. Only a definitive refusal counts toward a limit of three; errors and timeouts are retried each run until the authorization lapses. After three refusals or a lapsed authorization, the sweeper writes "cancelled" with a condition on "paid and not captured", releases the units, and voids the authorization, or refunds it if a capture turns out to have gone through. The buyer sees the reservation as cancelled in their list, and it stays in the open list until it is released and voided.',
    },
    {
      scenario: 'The order writer falls behind, or the store’s orders database is down.',
      impact:
        'Buyers have paid and see their reservation as paid, but the order is missing from the store for a while.',
      detection:
        'The age of the oldest record the writer has not processed (IteratorAge), with an alarm at 60 seconds.',
      recovery:
        'The stream keeps records for 24 hours and the writer retries. Batches that still fail after the retry limit are reported to a queue, and the daily comparison of captured reservations with orders writes any order still missing.',
    },
    {
      scenario: 'The sweeper stops running.',
      impact:
        'Unpaid holds are not released, unwritten holds are not completed and the drift check does not run. Units stay held; nothing is oversold.',
      detection:
        'A custom metric for the oldest reservation still reserved, or ended and not released, past its deadline, published by a probe and not by the sweeper itself, with an alarm at 2.5 minutes; and errors of the function.',
      recovery:
        'The next successful run handles everything that piled up. Every step is conditional or safe to repeat, so a run that overlaps another or repeats work does no harm.',
    },
    {
      scenario: 'The opening spike is larger than planned, or a botnet floods the join endpoint.',
      impact:
        'Join requests are slow or refused for some buyers before the start. Checkout is not affected: only the line reaches it.',
      detection: 'Requests blocked at the edge, and errors and latency of the room.',
      recovery:
        'Rate rules and challenges at the edge drop most automated joins. A buyer who joins late still gets a ticket, at the back of the line. The request limit of the edge is raised before the sale, not during it.',
    },
  ],
  capacity: {
    assumptions: [
      'One sale of 20,000 units with a limit of 2 per buyer and 1.3 units per reservation on average.',
      '1 million buyers on the sale page at the start. A buyer who has not joined the line refreshes the page about every 2 seconds in the last minute, and joins peak at 20,000 a second.',
      'Buyers in line poll the status every 5 seconds, and every 30 seconds once all units are held.',
      'The room admits 1,000 buyers a second, and an admitted buyer takes about 10 seconds to choose and press buy.',
      'A hold lasts 5 minutes, and 20% of holds are never paid.',
      'The sweeper runs every minute and expires a hold 60 seconds after its deadline.',
    ],
    estimates: [
      {
        label: 'Edge requests',
        value: 'up to 500K/s before the start, 1M/s with no line, 200K/s in line',
        math: '1M buyers ÷ 2 s = 500K page requests/s if nobody had joined early, the upper bound the edge is sized for. One click each in the first second = 1M/s. 1M ÷ 5 s = 200K status polls/s, dropping to 1M ÷ 30 s ≈ 33K/s once all units are held',
      },
      {
        label: 'Reservations to hold everything',
        value: '~15,400',
        math: '20,000 units ÷ 1.3 units per reservation ≈ 15,400',
      },
      {
        label: 'Time until all units are held',
        value: '~25 s',
        math: '10 s for the first buyers to press buy + 15,400 reservations ÷ 1,000/s ≈ 25 s. Buyers admitted by then: 25 s × 1,000/s = 25,000, so about 10,000 admitted buyers find nothing',
      },
      {
        label: 'Reserve calls and durable writes',
        value: '1,000/s, about 63/s per bucket',
        math: 'The admission rate caps successful reserves at 1,000/s, one write each. 1,000 ÷ 16 buckets ≈ 63 writes/s per bucket. Checkout is sized for 2,000 calls/s to cover retries and refusals',
      },
      {
        label: 'Payments',
        value: '~12,300 in the first wave, ~200/s at peak',
        math: '15,400 × 80% ≈ 12,300 payments within 5 minutes, 41/s on average. If they all pay in the first minute: 12,300 ÷ 60 ≈ 200/s',
      },
      {
        label: 'Units returned',
        value: '~4,000, 6 to 7 minutes after each was reserved',
        math: '15,400 × 20% ≈ 3,100 unpaid reservations × 1.3 ≈ 4,000 units. 5 min hold + 60 s wait + up to 60 s until the next run',
      },
      {
        label: 'Reservations in the whole sale',
        value: '~19,000',
        math: 'Each wave pays 80%, so 15,400 ÷ 0.8 ≈ 19,250 reservations until every unit is paid. Each wave leaves 20% unpaid, so after three waves 1 − 0.2³ ≈ 99% of the units are paid',
      },
      {
        label: 'Stored data',
        value: '~200 MB in the room, ~10 MB of reservations',
        math: '1M tickets × ~200 bytes ≈ 200 MB. 19,000 reservations × ~0.5 KB ≈ 10 MB. The counter holds 19,000 holds and a count per buyer: a few megabytes',
      },
    ],
    implications: [
      'The page and the status are the only things a million buyers touch, so both are static objects at the edge. The origin sees joins once per buyer and about 1,000 pass requests a second.',
      'A million clicks in one second against 20,000 units means 98% of buyers cannot win. The waiting room turns that into 1,000 buyers a second, which a small fleet handles, and tells the rest where they stand.',
      'At 1,000 reserves a second one database row would be at its limit with every rejection added on top. The counter is in memory, and the durable writes spread over 16 buckets at about 63 a second each.',
      'The whole first wave is over in about 25 seconds, faster than any autoscaling or alarm reacts. Fleets are sized and started before the sale, the admission rate comes from a rehearsal, and alarms protect the minutes after.',
      'Payments are the slow part: 12,300 in 5 minutes, bursting to 200 a second. That is why reserve and pay are separate calls and payment calls are capped in flight.',
      'The data is tiny. Nothing here needs sharding; it needs correctness under a burst and isolation from the rest of the store.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one region, as a cell of its own next to the store. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Edge: sale page, status and bot checks',
        service:
          'Amazon CloudFront in front of Amazon S3 (page and status object) and of the load balancer; AWS WAF on the distribution',
        why: 'The page and the one-second status object are served from the edge cache, so a million buyers polling never reach the origin. WAF rate-based rules and the Challenge and CAPTCHA actions run before a join reaches the room.',
        watch:
          'CloudFront Requests, 4xxErrorRate and 5xxErrorRate; CacheHitRate, an additional metric turned on per distribution; WAF BlockedRequests and ChallengeRequests.',
      },
      {
        part: 'Waiting room',
        service:
          'Application Load Balancer and Amazon ECS on AWS Fargate; Amazon ElastiCache for Valkey for tickets, the sequence and the line; a signing key per sale in AWS Secrets Manager',
        why: 'Stateless tasks handle 20,000 joins a second and 1,000 pass requests a second; the store holds one small record per account, about 200 MB for a million buyers. Losing it costs a few repeated draws, not stock, and the state of the line is also in the status object, so a cache with replicas is enough here.',
        watch:
          'ALB RequestCount, TargetResponseTime and HTTPCode_Target_5XX_Count; ElastiCache EngineCPUUtilization and CurrConnections; custom metrics for buyers admitted per second and, from the probe, for the age of the status object.',
      },
      {
        part: 'Checkout API',
        service:
          'Amazon ECS on AWS Fargate behind the load balancer, started at full size before the sale, with one target group for reserve and one for pay; Amazon Cognito for the signed-in account',
        why: 'Verifies passes locally and runs reserve and pay. The two routes have their own target groups, so a slow payment provider does not show up as slow reserves. Sized for 2,000 calls a second ahead of time, because the first wave ends before autoscaling could add a task.',
        watch:
          'Per target group: TargetResponseTime at p99 and HTTPCode_Target_5XX_Count; RejectedConnectionCount on the load balancer; CPUUtilization of the services.',
      },
      {
        part: 'Stock counter',
        service:
          'Amazon MemoryDB, one shard with a primary and two replicas in three Availability Zones; Lua scripts; one access-control user per service',
        why: 'An in-memory store that writes to a Multi-AZ transaction log before it answers, so a failover keeps every acknowledged decrement. All keys of a sale share a hash tag, so one script can touch them together.',
        watch:
          'EngineCPUUtilization, CurrConnections and, where the engine version provides it, SuccessfulWriteRequestLatency; ReplicationLag on the replicas.',
      },
      {
        part: 'Reservations',
        service:
          'Amazon DynamoDB, on-demand, keyed by sale and bucket with the reservation id as sort key; a sparse global secondary index of open reservations by deadline and a second index by account; DynamoDB Streams',
        why: 'Conditional writes decide every state change, and strongly consistent queries of the table rebuild the counter. Sixteen buckets keep each key far below the write limit of a partition. The index by account serves the list of a buyer, and the sale record is one more item in the table.',
        watch:
          'ThrottledRequests and WriteKeyRangeThroughputThrottleEvents, ConditionalCheckFailedRequests, SuccessfulRequestLatency and SystemErrors.',
      },
      {
        part: 'Payments',
        service:
          'An external payment provider called from checkout, with idempotency keys and at most 300 calls in flight, a fixed share per checkout task',
        why: 'Authorize, capture and void are separate calls, which lets the conditional write sit between them. The cap leaves the rest of the store its share of the provider’s rate limit.',
        watch:
          'Custom metrics at checkout: authorization latency and error rate, calls refused by the cap, authorizations waiting to be voided.',
      },
      {
        part: 'Order writer and orders',
        service:
          'DynamoDB Streams to an AWS Lambda function that handles one batch per shard at a time, with a retry limit and an Amazon SQS queue as its on-failure destination; Amazon Aurora PostgreSQL, the orders database of the store',
        why: 'The store receives only captured orders, a few hundred a second at most, however large the rush was. A unique reservation id on the order makes repeated records harmless, and a reservation cancelled after capture marks its order cancelled.',
        watch:
          'Lambda IteratorAge and Errors; messages in the on-failure queue; Aurora CommitLatency and DatabaseConnections.',
      },
      {
        part: 'Hold sweeper and rebuild',
        service:
          'Amazon EventBridge Scheduler and AWS Lambda; a small probe task on Amazon ECS that publishes the liveness metrics',
        why: 'One run a minute per sale: complete unwritten holds, expire and release, capture what was left uncaptured, void attempts that did not pay, compare the counter with the table. When stock is zero and no reservation is open, it sets the sold-out mark that the room publishes. The rebuild is the same function, started when the armed mark is missing, by an alarm or by hand; the same function switches the hold extension on and off for the payments alarm, and a daily run compares captured reservations with orders. The probe is separate from the room and the sweeper, so a worker that stops shows as a growing value and not as silence.',
        watch:
          'Lambda Errors and Duration; stock drift, published by the sweeper, with missing data paging the on-call; from the probe: oldest reservation still reserved, or ended and not released, past its deadline, oldest unwritten hold, age of the status object.',
      },
      {
        part: 'Security and cost',
        service:
          'IAM roles per service, AWS Secrets Manager, encryption at rest in every store, AWS CloudTrail, AWS Cost Explorer',
        why: 'Only the waiting room can read the signing key, only checkout and the sweeper can run counter scripts, and card data never reaches the store. The cell costs fleets started for about an hour per sale, not standing capacity.',
        watch:
          'Reads of the signing secret in CloudTrail; the sale cell as its own cost tag in Cost Explorer.',
      },
    ],
    limits: [
      'A CloudFront distribution serves 250,000 requests a second by default. The page can take up to 500,000 a second before the start, so a higher quota is requested ahead of the sale.',
      'The status object is cached at the edge for one second. Concurrent misses for the same object at an edge location are collapsed into one origin request.',
      'An AWS WAF rate-based rule counts over a window of 1, 2, 5 or 10 minutes, its limit can be as low as 10 requests, and it takes effect with a delay, usually under 30 seconds. It slows a script but does not stop the opening burst. The challenge and the line do that.',
      'An Application Load Balancer grows with traffic but not instantly; for a sharp increase known in advance, capacity is reserved ahead with a load balancer capacity unit reservation.',
      'Replication in ElastiCache is asynchronous, so a failover can drop the most recent writes. That is acceptable for tickets and is the reason the stock counter is not kept there.',
      'MemoryDB answers a write after it is in its transaction log across zones, and its primary reads are strongly consistent, also after a failover. Reads from replicas can lag, so scripts and the room read the primary.',
      'A DynamoDB partition serves at most 1,000 write units and 3,000 read units a second. A single item for the stock, or one index key for all open reservations, would sit at that limit at 1,000 reserves a second; 16 buckets put each key at about 63.',
      'A new on-demand DynamoDB table accepts 4,000 write units a second at once, and warm throughput can be set higher before a larger sale. A throttled global secondary index throttles writes to its table.',
      'A global secondary index is eventually consistent, so the rebuild reads the table itself with consistent reads; the indexes are only used to find work and to list a buyer’s reservations, and every write they lead to is conditional.',
      'DynamoDB Streams keeps records for 24 hours. With the default settings a bad record is retried until it expires, which can block a shard for a day, so the writer has a retry limit and an on-failure destination.',
      'EventBridge Scheduler runs at most once a minute, which sets the pace of the sweeper: a unit returns 6 to 7 minutes after it was reserved.',
      'A sweep of a few thousand reservations takes seconds, far below the timeout of a Lambda function.',
      'A DynamoDB stream is read one batch per shard at a time unless a parallelization factor is set, which is what bounds the order writer.',
    ],
  },
  slos: [
    {
      objective: 'Stock correctness',
      target:
        'Paid units never exceed the stock in any sale; drift between the counter and the reservations is corrected within 5 minutes',
      measure:
        'The comparison the sweeper runs every minute, published as a stock drift metric, and a count of paid units per sale at closing.',
    },
    {
      objective: 'Reserve',
      target:
        '99% of reserve calls from admitted buyers answered within 300 ms, and 99.9% without a server error',
      measure:
        'TargetResponseTime at p99 and HTTPCode_Target_5XX_Count over RequestCount on the reserve target group, which pay calls do not touch, outside the time a sale is paused. Refusals such as "all units held" are answers, not errors.',
    },
    {
      objective: 'Line status',
      target: 'The status at the edge is at most 5 seconds old for 99% of the time a sale is open',
      measure:
        'A high-resolution custom metric from a probe outside the room: now minus the update time in the status object.',
    },
    {
      objective: 'Units return',
      target:
        '99% of unpaid holds are back on sale within 9 minutes of being reserved, or 14 minutes while the hold extension is on',
      measure: 'Release time minus creation time of expired reservations, from the table.',
    },
    {
      objective: 'Orders',
      target: '99% of captured payments have an order in the store within 5 minutes',
      measure:
        'Order creation time minus capture time, and the daily comparison of captured reservations with orders.',
    },
  ],
  alarms: [
    {
      name: 'Stock drift',
      metric:
        'Custom: stock drift not zero for 3 checks in a row (3 minutes); missing data pages the on-call and starts no rebuild',
      meaning:
        'The counter and the reservations disagree beyond what in-flight calls explain. No data means the sweeper is not checking, which a rebuild by the same function would not fix, so that case goes to the on-call. A drift that is not zero starts the rebuild, which finishes inside the 5-minute target. More units in the table than the stock does not wait for this: the sweeper pauses the sale at once.',
    },
    {
      name: 'Reserve slow',
      metric: 'TargetResponseTime p99 on the reserve target group above 200 ms for 1 minute',
      meaning:
        'The counter or the reservations table is slow, below the 300 ms target. The first wave is over before this can fire, so it protects the later waves and the rehearsal; lower the admission rate.',
    },
    {
      name: 'Reserve errors',
      metric:
        'HTTPCode_Target_5XX_Count above 0.05% of RequestCount on the reserve target group for 1 minute',
      meaning:
        'Half the error rate the reserve target allows. Usually the counter store failing over, or the table throttling. It also fires during a pause, on purpose.',
    },
    {
      name: 'Line stopped',
      metric:
        'Custom, high resolution, from the probe: age of the status object above 3 s over one 10-second period; missing data counts as breaching',
      meaning:
        'The waiting room is not publishing. Nobody new is admitted and buyers are about to see "paused". It fires about 13 seconds into a stop. Several room tasks prevent a stop; the alarm limits how long one lasts and cannot prevent the first seconds of stale status.',
    },
    {
      name: 'Holds not released',
      metric:
        'Custom, high resolution, from the probe: oldest reservation still reserved, or ended and not released, more than 2.5 minutes past its deadline over one 30-second period, counting the hold extension when it is on; missing data counts as breaching',
      meaning:
        'The sweeper is failing or behind. Normal is at most 2 minutes, the alarm fires at about 3, and the 9-minute target for returned units is missed at 4. Reservations that only wait for a void are not counted: their units are already back.',
    },
    {
      name: 'Unwritten holds',
      metric:
        'Custom, from the probe: oldest hold in the counter with no reservation, above 2 minutes; missing data counts as breaching',
      meaning:
        'The table is refusing writes or the sweeper is not completing holds. Units are held for buyers who may not know it.',
    },
    {
      name: 'Table throttling',
      metric:
        'DynamoDB ThrottledRequests above 0 for 1 minute, summed over the write operations of the reservations table',
      meaning:
        'A hot key or too little warm throughput; WriteKeyRangeThroughputThrottleEvents above 0 says it is a hot partition. Reserve answers slow down and unwritten holds pile up.',
    },
    {
      name: 'Counter store busy',
      metric: 'MemoryDB EngineCPUUtilization above 60% for 1 minute',
      meaning:
        'Scripts run on one thread; past this the reserve latency climbs. Lower the admission rate.',
    },
    {
      name: 'Payments failing',
      metric:
        'Custom: authorization errors above 5%, p95 latency above 5 s, or pay calls ending in a server error above 5%, for 2 minutes',
      meaning:
        'The payment provider or our own pay path is in trouble. The alarm switches on the 5-minute hold extension, so holds stop expiring while buyers cannot pay; those whose deadline fell in the first minute or so may already have expired.',
    },
    {
      name: 'Orders behind',
      metric: 'Lambda IteratorAge of the order writer above 60 s for one 1-minute period',
      meaning:
        'Paid buyers do not see their order in the store yet. It fires about two minutes after the writer stops, well inside the 5-minute target. Check the orders database and the on-failure queue.',
    },
    {
      name: 'Voids stuck',
      metric: 'Custom: authorizations waiting to be voided for more than 15 minutes',
      meaning:
        'Buyers who lost a race still have money held on their card. Void by hand or with the provider.',
    },
  ],
  evolution: {
    mvp: 'One database and no in-memory store. Stock is a row decremented with a conditional update, the reservation is a row with a deadline in the same transaction, and a job every minute expires unpaid rows. A rate limit at the edge is the only protection. This holds for sales of a few hundred units and a few thousand buyers, a few hundred reserves a second. The first thing to add is the waiting room, because it is what keeps a larger crowd from reaching the database at all.',
    atScale: [
      'At 10x buyers, 10 million in line, the edge takes 2 million polls a second, which is only a quota. The room store grows to about 2 GB and joins to 200,000 a second, so tickets are split across shards by account.',
      'At 10x stock, 200,000 units, the admission rate goes to 10,000 a second. The reservations table gets more buckets and warm throughput set ahead, and one counter shard still keeps up.',
      'At 10x stock, payments become the limit: about 123,000 in 5 minutes. The hold gets longer, deadlines are staggered, and a second payment provider takes part of the load.',
      'With many sales at once, each sale keeps its own keys under its own hash tag and sales spread across the shards of the counter store.',
      'At 100x, one item with millions of units, the stock is split into buckets on several shards, with a job that moves units from full buckets to empty ones.',
      'At 100x and worldwide, each region gets a share of the stock and its own cell, and unsold shares are moved between regions.',
    ],
    firstBottleneck:
      'The payment provider. Everything before it is flattened by the waiting room to a rate the fleet was sized for, but payments arrive in a burst after the first wave, about 200 a second for 12,300 payments, and the provider’s rate limit is shared with the rest of the store. The fix is the cap on calls in flight, a hold long enough to spread them, and, for larger sales, a second provider.',
    avoided: [
      'A queue between reserve and the durable write, with orders created later. It hides the write from the buyer and adds lag between "reserved" and a record that can be paid. Worth it when the admission rate goes past what a direct write can take.',
      'Stock split into buckets across nodes. One counter is enough behind a waiting room; worth it at millions of units.',
      'A live connection per buyer to push the place in line. Polling a cached object costs the origin nothing; worth it only if the place must move in real time.',
      'An admission rate that adjusts itself from checkout latency. A fixed rate from a rehearsal is predictable in a wave that lasts 25 seconds; worth it for sales that run for hours.',
      'A single-use registry for passes. The limit per buyer in the counter already makes a replay useless.',
      'One stock shared by several regions with synchronous writes. The latency and the failure modes are not worth it for a sale; a share of stock per region is simpler.',
    ],
  },
};
