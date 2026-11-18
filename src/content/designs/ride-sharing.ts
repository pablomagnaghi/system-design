import type { Design } from '../types';

export const rideSharing: Design = {
  slug: 'ride-sharing',
  title: 'Ride sharing',
  summary:
    'Match a rider with a nearby driver in seconds: drivers stream their position into an in-memory geo index, requests wait in a durable queue, and a short lock makes sure each driver sees one offer at a time and each ride gets one driver.',
  difficulty: 'Hard',
  minutes: 10,
  requirements: {
    functional: [
      'Riders enter a pickup and destination and get a fare estimate.',
      'Riders request a ride and are matched with a nearby available driver.',
      'Drivers send their location while online and accept or decline ride offers.',
      'Rider and driver both see the state of the ride: requested, accepted, in progress, completed.',
    ],
    nonFunctional: [
      'Match within seconds when a driver is nearby; after about a minute without a match, tell the rider no driver was found.',
      'A driver sees one offer at a time, and a ride is never assigned to two drivers or a driver to two rides.',
      'Absorb hundreds of thousands of location updates per second from online drivers.',
      'Survive demand spikes in one city, such as the end of a concert, without dropping requests.',
    ],
    outOfScope: [
      'Payments, ratings and driver onboarding.',
      'Shared rides with several riders and route optimization.',
    ],
  },
  entities: [
    {
      name: 'Rider and driver',
      description: 'The two kinds of user; a driver also has a status: offline, available or busy.',
    },
    {
      name: 'Fare',
      description: 'An estimate for one pickup and destination, with a price and a short expiry.',
    },
    {
      name: 'Ride',
      description:
        'Rider, driver, fare, pickup, destination and state: requested, accepted, in progress, completed or cancelled.',
    },
    {
      name: 'Driver location',
      description: 'The latest known position of an online driver, overwritten every few seconds.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/fares',
      description: 'Body: pickup, destination. Returns a fare with a price and an expiry.',
    },
    {
      method: 'POST',
      path: '/rides',
      description:
        'Body: fareId, idempotencyKey. Creates a requested ride and starts matching; returns the ride id.',
    },
    {
      method: 'POST',
      path: '/drivers/location',
      description: 'Body: lat, lng. Sent by the driver app every few seconds while online.',
    },
    {
      method: 'PATCH',
      path: '/rides/{id}',
      description: 'Driver accepts or declines an offer, then marks pickup and drop-off.',
    },
  ],
  dataFlow: [
    'Online drivers send their position every few seconds; the latest one is kept in a geo index.',
    'The rider asks for a fare, then requests the ride; the request goes into a queue for its city.',
    'The matcher finds nearby available drivers, locks the best one and sends an offer.',
    'The driver accepts and the ride is assigned; a decline or a timeout moves on to the next driver.',
  ],
  highLevel: {
    label: 'Match a rider with a driver',
    intro:
      'Start with a fare estimate and drivers reporting where they are, then watch a crowd overwhelm matching done inside the request, and see the queue, the matcher, the driver lock and the ride store join as the design grows. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      { id: 'rider', title: 'Rider app', detail: 'Estimate, request', column: 0, row: 'middle' },
      {
        id: 'driver',
        title: 'Driver app',
        detail: 'Location every 5 s',
        column: 0,
        row: 'bottom',
        appearsAt: 1,
      },
      { id: 'pricing', title: 'Pricing', detail: 'Fare and surge', column: 1, row: 'top' },
      { id: 'api', title: 'Ride API', detail: 'Idempotency key', column: 1, row: 'middle' },
      {
        id: 'locations',
        title: 'Location service',
        detail: 'Ingests pings',
        column: 1,
        row: 'bottom',
        appearsAt: 1,
      },
      {
        id: 'queue',
        title: 'Ride requests',
        detail: 'Queue per city',
        column: 2,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'matcher',
        title: 'Matcher',
        detail: 'Ranks drivers',
        column: 2,
        row: 'middle',
        appearsAt: 4,
      },
      {
        id: 'geo',
        title: 'Geo index',
        detail: 'In-memory cells',
        column: 2,
        row: 'bottom',
        appearsAt: 2,
      },
      {
        id: 'lock',
        title: 'Driver lock',
        detail: 'One offer, with TTL',
        column: 3,
        row: 'middle',
        appearsAt: 6,
      },
      {
        id: 'offer',
        title: 'Offer',
        detail: 'Push, 10 s to answer',
        column: 4,
        row: 'middle',
        appearsAt: 7,
      },
      {
        id: 'rides',
        title: 'Ride store',
        detail: 'requested → accepted',
        column: 5,
        row: 'middle',
        appearsAt: 8,
      },
    ],
    edges: [
      ['rider', 'api'],
      ['api', 'pricing', 'estimate'],
      ['api', 'queue', 'request'],
      ['queue', 'matcher'],
      ['driver', 'locations'],
      ['locations', 'geo', 'latest position'],
      ['matcher', 'geo', 'nearby'],
      ['matcher', 'lock'],
      ['lock', 'offer'],
      ['offer', 'rides', 'accepted'],
    ],
    stages: [
      {
        title: 'Estimate the fare',
        narration:
          'The rider enters pickup and destination. Pricing computes a fare from the route and the current demand in the area, and stores it with a short expiry so the request can refer to it.',
        tradeoff:
          'Pricing on the client would be faster but trivial to tamper with. Storing the fare on the server and passing its id costs one extra write, and guarantees the rider pays the price they saw, as long as they request before it expires.',
        nodes: ['rider', 'api', 'pricing'],
        travel: [
          ['rider', 'api'],
          ['api', 'pricing', 'estimate'],
        ],
        short: 'Estimate',
        metrics: { users: '5M', requestsPerSecond: '2K', p95Latency: '120 ms', errorRate: '0%' },
        load: { api: 10, pricing: 15 },
      },
      {
        title: 'Drivers report where they are',
        narration:
          'Every online driver sends a position every few seconds. The location service validates it and keeps only the latest one; nothing about the history is needed for matching.',
        tradeoff:
          'Writing every ping to a durable database would be safe but expensive at hundreds of thousands of writes per second, all of which are overwritten moments later. Treating locations as disposable trades durability for throughput: if a node is lost, the next ping rebuilds it within seconds.',
        nodes: ['driver', 'locations'],
        travel: [['driver', 'locations']],
        short: 'Driver pings',
        metrics: { users: '5M', requestsPerSecond: '200K', p95Latency: '50 ms', errorRate: '0%' },
        load: { locations: 55 },
      },
      {
        title: 'Index positions in memory',
        narration:
          'Each position is filed under a small grid cell, such as a geohash of a few hundred meters, in an in-memory index sharded by region. Entries expire if a driver stops reporting.',
        tradeoff:
          'A spatial index in a relational database answers the same question, but struggles with this write rate. An in-memory cell index handles the volume and answers "who is near here" quickly, and the price is a separate store to run, with no history and no durability.',
        nodes: ['locations', 'geo'],
        travel: [['locations', 'geo', 'latest position']],
        short: 'Geo index',
        metrics: { users: '5M', requestsPerSecond: '200K', p95Latency: '50 ms', errorRate: '0%' },
        load: { locations: 55, geo: 45 },
      },
      {
        title: 'A stadium empties at once',
        narration:
          'A concert ends and tens of thousands of riders request at the same moment. Matching still runs inside the request: each one holds an API worker while it searches for drivers and waits for an answer, the workers run out and new requests time out.',
        tradeoff:
          'Adding API servers helps until the next, bigger crowd, and every server still waits on slow matching instead of answering. Accepting the request quickly and matching it in the background separates how fast riders can ask from how fast drivers can be found.',
        nodes: ['rider', 'api'],
        travel: [['rider', 'api']],
        short: 'Demand spike',
        metrics: {
          users: '5M',
          requestsPerSecond: '250K',
          p95Latency: '6 s',
          errorRate: '7%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { api: 98, geo: 70 },
        traffic: [{ edge: ['rider', 'api'], kind: 'failed' }],
      },
      {
        title: 'Request a ride through a queue',
        narration:
          'A queue joins the request path. The rider requests the ride with the fare id and an idempotency key, and the API writes a requested ride and an outbox row in one transaction, then returns at once; a relay moves the row to a queue partitioned by city, and the app waits for updates. A sweeper puts back on the queue any ride that stays requested with no offer past a deadline.',
        tradeoff:
          'Matching inside the request would be simpler, but a spike in one city would exhaust the API and drop requests. A durable queue absorbs the spike and lets matchers scale per city, at the cost of a few hundred milliseconds of delay and an asynchronous flow for the app. The relay and the queue deliver at least once, which is harmless because a matcher skips a ride that already has a driver or an open offer.',
        nodes: ['rider', 'api', 'queue', 'matcher'],
        travel: [
          ['rider', 'api'],
          ['api', 'queue', 'request'],
          ['queue', 'matcher'],
        ],
        short: 'Ride queue',
        metrics: {
          users: '5M',
          requestsPerSecond: '250K',
          p95Latency: '300 ms',
          errorRate: '0.1%',
        },
        load: { api: 30, queue: 50, matcher: 40 },
      },
      {
        title: 'Find nearby drivers',
        narration:
          'The matcher reads the cell of the pickup and its neighbors, keeps available drivers, and ranks them by estimated time to pickup rather than straight-line distance.',
        tradeoff:
          'Straight-line distance is cheap but wrong across rivers and highways. Estimating travel time is better for riders and costs a routing call per candidate, so the matcher only does it for the closest handful.',
        nodes: ['matcher', 'geo'],
        travel: [['matcher', 'geo', 'nearby']],
        short: 'Nearby',
        metrics: {
          users: '5M',
          requestsPerSecond: '250K',
          p95Latency: '300 ms',
          errorRate: '0.1%',
        },
        load: { matcher: 45, geo: 50 },
      },
      {
        title: 'Lock one driver',
        narration:
          'Before offering, the matcher takes a lock on the best driver with a time to live of about ten seconds. If another matcher already holds that driver, it moves to the next candidate.',
        tradeoff:
          'Without a lock, two matchers could offer the same driver two rides at once. A lock in a shared cache adds a dependency, and its time to live means a crashed matcher frees the driver on its own instead of blocking them forever. The lock is not a guarantee: if the cache fails over and drops it, a driver can briefly get a second offer, and the conditional update at accept is what keeps the outcome correct.',
        nodes: ['matcher', 'lock'],
        travel: [['matcher', 'lock']],
        short: 'Lock driver',
        metrics: {
          users: '5M',
          requestsPerSecond: '250K',
          p95Latency: '300 ms',
          errorRate: '0.1%',
        },
        load: { matcher: 45, lock: 20 },
      },
      {
        title: 'Offer with a deadline',
        narration:
          'The driver gets a push notification with the pickup and the fare, and has about ten seconds to accept. The lock expires at the same time as the offer.',
        tradeoff:
          'Offering to one driver at a time is fair and avoids races, but a slow decline delays the rider. Offering to several at once is faster and leaves drivers who accepted with nothing; a short deadline keeps the sequential approach fast enough: most rides match on the first offer, and each decline or timeout adds up to ten seconds.',
        nodes: ['lock', 'offer'],
        travel: [['lock', 'offer']],
        short: 'Offer',
        metrics: {
          users: '5M',
          requestsPerSecond: '250K',
          p95Latency: '300 ms',
          errorRate: '0.1%',
        },
        load: { lock: 20, offer: 30 },
      },
      {
        title: 'Accept and assign',
        narration:
          'When the driver accepts, the ride moves from requested to accepted in one conditional transaction: the ride is updated only if it has no driver yet, and the driver is marked busy only if still available for this offer. The rider app then shows them on the map.',
        tradeoff:
          'The conditional update is the final guard: even if a lock expired early or a retry arrived late, only one driver can be written on the ride, and a driver can only be attached to one ride. It costs one more check on a hot path, and it is what makes the lock an optimization rather than the only defense.',
        nodes: ['offer', 'rides'],
        travel: [['offer', 'rides', 'accepted']],
        short: 'Accept',
        metrics: {
          users: '5M',
          requestsPerSecond: '250K',
          p95Latency: '300 ms',
          errorRate: '0.1%',
        },
        load: { offer: 30, rides: 25 },
      },
      {
        title: 'Decline or timeout moves on',
        narration:
          'If the driver declines or the deadline passes, the lock is released and the matcher takes the next candidate. After a few rounds, or about a minute, the ride is cancelled and the rider is told no driver was found.',
        tradeoff:
          'Retrying forever would keep riders waiting with no answer. A clear limit gives a fast, honest failure, at the cost of losing some rides that a longer search might have matched.',
        nodes: ['matcher', 'lock', 'offer'],
        travel: [
          ['matcher', 'lock'],
          ['lock', 'offer'],
        ],
        short: 'Decline',
        metrics: {
          users: '5M',
          requestsPerSecond: '250K',
          p95Latency: '300 ms',
          errorRate: '0.1%',
        },
        load: { matcher: 50, lock: 25, offer: 30 },
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we store and query frequent driver locations?',
      options: [
        {
          name: 'Latitude and longitude columns with an index',
          pros: 'No new technology; easy to query.',
          cons: 'A range on two columns scans a wide band, and the write rate overwhelms the database.',
        },
        {
          name: 'Spatial extension of a relational database',
          pros: 'Real spatial queries with a proper index.',
          cons: 'Still a durable write per ping, which is wasted work at this volume.',
        },
        {
          name: 'In-memory geohash index with expiry',
          pros: 'Handles very high write rates; nearby queries read a few cells.',
          cons: 'Not durable, and cell size must be tuned for dense and sparse areas.',
        },
      ],
      choice:
        'An in-memory geohash index sharded by region, with entries that expire. Locations are disposable, so speed matters more than durability here.',
    },
    {
      question:
        'How do we keep a driver from getting two offers and a ride from getting two drivers?',
      options: [
        {
          name: 'Check driver status in the application',
          pros: 'Simple.',
          cons: 'Two matchers can read "available" at the same moment.',
        },
        {
          name: 'Database transaction on the driver row',
          pros: 'Correct and durable.',
          cons: 'Every offer becomes a database write, and a crashed matcher can leave the driver stuck as busy.',
        },
        {
          name: 'Lock with a time to live, plus a conditional update on the ride',
          pros: 'Cheap, frees itself on crash, and the ride write is still exact.',
          cons: 'Two mechanisms to understand instead of one.',
        },
      ],
      choice:
        'A lock with a time to live on the driver for the offer, and a conditional update on the ride when it is accepted. The lock prevents most conflicts cheaply; the update makes the rare one harmless.',
    },
    {
      question: 'How do we handle a sudden spike of requests in one city?',
      options: [
        {
          name: 'Match synchronously in the API',
          pros: 'Simple; the rider gets a direct answer.',
          cons: 'Requests time out and are lost under load.',
        },
        {
          name: 'Durable queue partitioned by city',
          pros: 'An accepted request is not dropped; matchers scale where demand is.',
          cons: 'Asynchronous flow, and a backlog means longer waits that must be shown honestly.',
        },
      ],
      choice:
        'A durable queue per city, fed from an outbox so a stored ride always reaches it, with surge pricing as the economic pressure valve: higher fares reduce demand and bring more drivers online while the backlog drains.',
    },
  ],
  wrapUp:
    'Positions are disposable and live in memory; ride requests are durable and wait in a queue; a short lock gives each driver one offer at a time, and a conditional update makes sure each ride ends up with exactly one driver.',
};
