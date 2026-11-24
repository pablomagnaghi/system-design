import type { Design } from '../types';

export const rideSharing: Design = {
  slug: 'ride-sharing',
  title: 'Ride sharing',
  summary:
    'Match a rider with a nearby driver in seconds: drivers stream their position into in-memory cells that expire on their own, a ride request is a row and a queue message that survives a crash, one transaction decides which driver gets which ride, and every open ride has a due time that a sweeper applies, up to the payment after the trip.',
  difficulty: 'Hard',
  minutes: 14,
  requirements: {
    functional: [
      'Riders enter a pickup and a destination and get a fare that stays valid for 5 minutes.',
      'Riders request a ride with that fare and are matched with a nearby available driver, or told that no driver was found.',
      'Drivers go online, send their position every 5 seconds, and accept or decline one offer at a time.',
      'Rider and driver both see the state of the ride: matching, accepted, in progress, completed, cancelled, expired or review.',
      'The driver marks the pickup and the drop-off. After the drop-off the rider is charged the fare that was quoted.',
      'The rider can cancel until the pickup, and the driver can cancel a ride they accepted until the pickup.',
    ],
    nonFunctional: [
      '1 million drivers online at peak, each sending a position every 5 seconds: 200,000 location updates a second.',
      'About 8.6 million ride requests a day: 100 a second on average and 400 at peak.',
      'The first offer goes out within 2 seconds of the request for 99% of requests, and a typical match takes about 8 seconds. After 60 seconds of search, plus any offer still out, the rider is told that no driver was found.',
      'A driver holds one offer at a time and is never on two rides; a ride never has two drivers. Both rest on conditional writes in the store, not on timing.',
      'An accepted request is not dropped silently: every ride ends completed, cancelled, expired or in review with a reason, and every completed ride ends charged or failed with a reason.',
      'A rider is charged at most once per ride, the amount that was quoted.',
      'A position used for matching is at most 20 seconds old. Positions are not durable: losing them costs a few seconds of matching, not data.',
      'A crowd in one area, such as a stadium emptying, must not make the API fail for everyone else.',
      'Riders and drivers are authenticated, a driver can act only on a ride that was offered or assigned to them, and card numbers never enter the system: the payment provider holds them behind a token.',
    ],
    outOfScope: [
      'Surge pricing and the pricing model. A fare is quoted from the route at fixed rates.',
      'Shared rides with several riders, scheduled rides and route optimization across trips.',
      'The live map of the car on the rider’s phone and turn-by-turn navigation.',
      'Driver onboarding, ratings, tips, cancellation fees and driver payouts.',
      'Holding an amount on the card before the trip, refunds, collecting a payment that failed, and reconciling payments against the provider’s own reports.',
      'The support tools that resolve a ride left in review.',
      'Push notifications that wake a closed app. A driver is online only while the app is open and sending positions.',
      'Detecting forged positions and other fraud.',
      'Trip history, receipts and analytics over old rides and positions.',
    ],
  },
  entities: [
    {
      name: 'Fare',
      description:
        'A quote for one pickup and destination: fare id, rider, both points, distance, trip time, price and an expiry 5 minutes after it was made. A fare buys one ride.',
    },
    {
      name: 'Ride',
      description:
        'Its id is the fare id. Rider, pickup, destination, price, quoted trip time, status (matching, accepted, in progress, completed, cancelled, expired, review), end reason, search deadline, the current offer (offer id, driver, expiry), the drivers already offered, the driver, timestamps, payment (pending, queued, charged, failed) with a reason, and a due time with a sweep shard while anything is still open.',
    },
    {
      name: 'Driver',
      description:
        'Driver id, status (offline, available, busy), the ride they are on, and one offer slot: offer id, ride and expiry.',
    },
    {
      name: 'Driver position',
      description:
        'The latest longitude and latitude of an available driver, filed under a map cell and a 10-second bucket in memory. It expires on its own 30 seconds after the bucket was last written.',
    },
    {
      name: 'Offer hint',
      description:
        'A copy of a driver’s current offer in the in-memory store, kept for the 15 seconds the offer lasts, so the answer to the next position update can carry it. A hint, not the truth: the truth is on the ride and driver rows.',
    },
    {
      name: 'Match message',
      description:
        'One queue message per ride request, holding the ride id. It stays in the queue while the ride is matching, wakes a matcher whenever something is due, and is deleted on the first wake-up that finds the ride no longer matching.',
    },
    {
      name: 'Payment message',
      description: 'One queue message per completed ride, holding the ride id.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/fares',
      description:
        'Body: pickup, destination. Returns a fare id, the price, the distance, the trip time and an expiry 5 minutes ahead.',
    },
    {
      method: 'POST',
      path: '/rides',
      description:
        'Body: fareId. The fare id is the idempotency key and becomes the ride id, so a repeat returns the same ride. Answers 202 after the ride row is stored and its message is in the match queue.',
    },
    {
      method: 'GET',
      path: '/rides/{id}',
      description:
        'The ride as rider or driver may see it: status, driver, fare, timestamps, payment. The apps poll it every 2 seconds while the ride is matching and every 15 seconds afterwards.',
    },
    {
      method: 'POST',
      path: '/rides/{id}/cancel',
      description:
        'By the rider until the pickup, or by the driver who accepted until the pickup. One conditional write while the ride is matching, and one transaction that also frees the driver once it is accepted; either removes the due time. A cancel while an offer is out changes only the ride: that driver’s slot and hint run out by themselves within 15 seconds, and an accept of that offer gets 409. A repeat answers with the current state.',
    },
    {
      method: 'POST',
      path: '/drivers/me/status',
      description:
        'Body: online or offline. Moves the driver between offline and available. A driver on a ride cannot go offline.',
    },
    {
      method: 'POST',
      path: '/drivers/me/location',
      description:
        'Body: lat, lng, status. Sent every 5 seconds while online, to the location service. The answer carries the driver’s current offer, if there is one.',
    },
    {
      method: 'POST',
      path: '/rides/{id}/offers/{offerId}/accept',
      description:
        'One transaction on the ride and the driver. 200 with the ride if this driver now has it, also on a repeat; 409 if the offer is gone.',
    },
    {
      method: 'POST',
      path: '/rides/{id}/offers/{offerId}/decline',
      description:
        'Frees the offer slot at once so the matcher can try the next driver. A repeat changes nothing.',
    },
    {
      method: 'POST',
      path: '/rides/{id}/pickup',
      description:
        'By the assigned driver: accepted becomes in progress. A repeat answers with the current state.',
    },
    {
      method: 'POST',
      path: '/rides/{id}/dropoff',
      description:
        'By the assigned driver: in progress becomes completed, the driver becomes available and the payment becomes pending, in one transaction. The app repeats it until it is answered.',
    },
  ],
  dataFlow: [
    'Online drivers send a position every 5 seconds. The location service files each one under a map cell and a 10-second bucket in memory, and old buckets expire on their own.',
    'The rider asks for a fare, which is stored, and then requests the ride with the fare id. The Ride API writes the ride row, puts one message on the match queue and answers 202.',
    'A matcher takes the message, reads the nearest fresh positions, and reserves one driver and writes the offer on the ride in one transaction. The message stays in the queue, hidden until the offer expires.',
    'The driver’s next position update is answered with the offer. Accept is one transaction that gives the ride its driver and the driver the ride; a decline or 15 seconds of silence lets the matcher move on, for up to 60 seconds of search.',
    'The driver marks the pickup and the drop-off. The drop-off completes the ride, frees the driver and marks the payment pending.',
    'A sweeper applies every due time: it queues pending payments and closes rides that nobody ended. A payment worker charges the quoted fare with the ride id as the idempotency key.',
  ],
  highLevel: {
    label: 'Match a rider with a driver',
    intro:
      'Start with a fare and with drivers reporting where they are, watch a crowd overwhelm matching done inside the request, and then see the queue, the matcher, the offer transaction, the trip, the sweeper and the payment join one at a time. Numbers are illustrative. Press play, or step through the stages to see what happens and what each choice costs.',
    nodes: [
      { id: 'rider', title: 'Rider app', detail: 'Quote, request, poll', column: 0, row: 'middle' },
      {
        id: 'driver',
        title: 'Driver app',
        detail: 'Position every 5 s',
        column: 0,
        row: 'bottom',
        appearsAt: 1,
      },
      { id: 'routes', title: 'Route service', detail: 'Distance and time', column: 1, row: 'top' },
      { id: 'api', title: 'Ride API', detail: 'Quotes, rides, trips', column: 1, row: 'middle' },
      {
        id: 'locations',
        title: 'Location service',
        detail: 'Takes positions',
        column: 1,
        row: 'bottom',
        appearsAt: 1,
      },
      {
        id: 'store',
        title: 'Rides and drivers',
        detail: 'Conditional writes',
        column: 2,
        row: 'top',
      },
      {
        id: 'matchq',
        title: 'Match queue',
        detail: 'One message per ride',
        column: 2,
        row: 'middle',
        appearsAt: 4,
      },
      {
        id: 'geo',
        title: 'Geo index',
        detail: 'Cells that expire',
        column: 2,
        row: 'bottom',
        appearsAt: 2,
      },
      {
        id: 'matcher',
        title: 'Matcher',
        detail: 'One offer at a time',
        column: 3,
        row: 'middle',
        appearsAt: 4,
      },
      {
        id: 'sweeper',
        title: 'Sweeper',
        detail: 'Applies due times',
        column: 4,
        row: 'top',
        appearsAt: 9,
      },
      {
        id: 'payq',
        title: 'Payment queue',
        detail: 'Completed rides',
        column: 4,
        row: 'middle',
        appearsAt: 10,
      },
      {
        id: 'pay',
        title: 'Payment worker',
        detail: 'Charge by ride id',
        column: 5,
        row: 'middle',
        appearsAt: 10,
      },
      {
        id: 'provider',
        title: 'Payment provider',
        detail: 'Outside the system',
        column: 5,
        row: 'bottom',
        appearsAt: 10,
      },
    ],
    edges: [
      ['rider', 'api'],
      ['api', 'routes'],
      ['api', 'store'],
      ['driver', 'locations'],
      ['locations', 'geo'],
      ['api', 'geo'],
      ['api', 'matchq'],
      ['matchq', 'matcher'],
      ['matcher', 'geo'],
      ['matcher', 'store'],
      ['driver', 'api'],
      ['sweeper', 'store', 'due'],
      ['sweeper', 'payq'],
      ['payq', 'pay'],
      ['pay', 'provider'],
    ],
    // Only the first design searches the index from inside the request.
    edgeStages: [{ edge: ['api', 'geo'], stages: [3] }],
    stages: [
      {
        title: 'Quote a fare and store it',
        narration:
          'The rider enters a pickup and a destination. The Ride API asks the route service for the distance and the trip time, prices them at fixed rates and stores the fare with an expiry 5 minutes ahead. The rider gets the fare id and the price. If the route service does not answer in 300 ms, the quote uses the straight-line distance times 1.3 and an average speed.',
        tradeoff:
          'A price computed on the phone would save a call and could be changed by the rider. Storing the fare and passing only its id costs one write per quote, about five quotes for every ride, and means the rider is charged the price they saw. The price is fixed before the trip, so nothing later depends on tracking the car; the cost is that a detour or a traffic jam changes the trip and not the fare.',
        nodes: ['rider', 'api', 'routes', 'store'],
        travel: [
          ['rider', 'api'],
          ['api', 'routes'],
          ['api', 'store'],
        ],
        short: 'Quote',
        metrics: {
          requestsPerSecond: '2K',
          p95Latency: '120 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Fare valid for', value: '5 min' }],
        },
        load: { api: 15, routes: 30, store: 10 },
      },
      {
        title: 'Drivers report where they are',
        narration:
          'Every online driver sends a position every 5 seconds, with a status the app sets itself: available or busy. The location service takes the driver id from the token, checks the coordinates and keeps the positions of available drivers only. It answers at once. A position that fails for any reason is dropped, and the app does not send it again: the next one is 5 seconds away.',
        tradeoff:
          'Writing 200,000 positions a second to a durable database would be safe and wasteful, because each one is replaced 5 seconds later. Treating positions as disposable buys throughput and a simple failure rule; the cost is that there is no history of where a car was, and that the status in the update is the app’s word, which is why it is only a filter and the driver row decides who can take a ride.',
        nodes: ['driver', 'locations'],
        travel: [['driver', 'locations']],
        short: 'Positions',
        metrics: {
          requestsPerSecond: '200K',
          p95Latency: '50 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Drivers online', value: '1M' }],
        },
        load: { locations: 55 },
      },
      {
        title: 'Index positions in cells that expire',
        narration:
          'Each position goes into an in-memory geospatial set whose key names a map cell about 5 km wide and a 10-second bucket of time. The same step sets the key to expire in 30 seconds. A reader looks at the current and the previous bucket, so a position it uses is at most 20 seconds old, and a driver who stops reporting is gone from the answers within 20 seconds with no cleanup job. The keys spread over 8 shards.',
        tradeoff:
          'One key per city would be simpler to query and would put a whole city’s writes on one shard. The store can expire a key but not one member of a set, so a single long-lived key per cell would need a job that removes drivers who went quiet. Buckets cost about four copies of every position in memory, about 260 MB in all, and two reads per cell; in return stale positions leave without any job, and a position 20 seconds old can be about 280 m off at 50 km/h.',
        nodes: ['locations', 'geo'],
        travel: [['locations', 'geo']],
        short: 'Geo index',
        metrics: {
          requestsPerSecond: '200K',
          p95Latency: '50 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Oldest position used', value: '20 s' },
            { label: 'Commands per shard', value: '80K/s' },
          ],
        },
        load: { locations: 55, geo: 53 },
      },
      {
        title: 'A stadium empties at once',
        narration:
          'A concert ends and 20,000 riders request a ride within 5 minutes, 67 a second in one small area with about 300 drivers nearby. In this first version the Ride API matches inside the request: it searches the index, offers the ride to a driver and holds the connection while it waits for an answer. Most of these searches find nobody and keep trying. Thousands of requests hold a worker each, the workers run out, and quotes and status calls from every other city time out too.',
        tradeoff:
          'More API servers move the limit and do not remove it: each request still occupies a worker for as long as a driver takes to answer, up to a minute. How fast riders can ask and how fast drivers can be found are two different rates, and one request cannot be both.',
        nodes: ['rider', 'api', 'geo', 'store'],
        travel: [
          ['rider', 'api'],
          ['api', 'geo'],
          ['api', 'store'],
        ],
        short: 'Crowd',
        metrics: {
          requestsPerSecond: '54K',
          p95Latency: '20 s',
          errorRate: '30%',
          alerts: ['p95Latency', 'errorRate'],
          custom: [
            { label: 'Requests in the area', value: '67/s' },
            { label: 'Drivers nearby', value: '300' },
          ],
        },
        load: { api: 98, geo: 60, store: 40 },
        traffic: [{ edge: ['rider', 'api'], kind: 'failed' }],
      },
      {
        title: 'Request a ride through a queue',
        narration:
          'A queue and a pool of matchers join. The rider posts the fare id. The Ride API reads the fare, writes the ride row with the status matching, on the condition that no ride with that id exists, puts one message with the ride id on the match queue and answers 202. The fare id is the ride id, so a repeated request finds the row and returns the same ride. The app then polls the ride every 2 seconds.',
        tradeoff:
          'The request now takes about 60 ms whatever the drivers do, and a crowd becomes a longer queue, not a dead API. The costs are an asynchronous flow in the app and two writes that are not one: a crash between the row and the message leaves a ride with nothing working on it. The app’s retry repairs it, because a repeat sends the message again, and if no retry comes the sweeper ends the ride as expired 90 seconds after the request. A duplicate message is harmless, since every step a matcher takes is a conditional write.',
        nodes: ['rider', 'api', 'store', 'matchq', 'matcher'],
        travel: [
          ['rider', 'api'],
          ['api', 'store'],
          ['api', 'matchq'],
          ['matchq', 'matcher'],
        ],
        short: 'Ride queue',
        metrics: {
          requestsPerSecond: '54K',
          p95Latency: '60 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Ride requests', value: '400/s' },
            { label: 'Status polls', value: '50K/s' },
          ],
        },
        load: { api: 45, store: 35, matchq: 20, matcher: 40 },
      },
      {
        title: 'Find nearby drivers',
        narration:
          'A matcher receives the message and reads the ride. It searches the pickup’s cell and its eight neighbours, in the current and the previous bucket, for drivers within 2 km: 18 small searches sent together. It drops drivers this ride already tried and drivers who hold an offer hint, keeps the 5 nearest, and asks the route service for their travel time to the pickup, a call the diagram does not draw. If that takes more than 300 ms it keeps the straight-line order.',
        tradeoff:
          'Straight-line distance is free and wrong across a river or a motorway; travel time is what the rider feels, and it costs one route call per search, so only the nearest 5 are ranked. The search uses positions up to 20 seconds old and looks at one ride at a time, so it finds a good driver and not always the best one, and it never finds a driver 3 km away even when nobody is nearer.',
        nodes: ['matcher', 'geo'],
        travel: [['matcher', 'geo']],
        short: 'Nearby',
        metrics: {
          requestsPerSecond: '54K',
          p95Latency: '60 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Matcher passes', value: '1K/s' },
            { label: 'Searches per pass', value: '18' },
          ],
        },
        load: { matcher: 45, geo: 55 },
      },
      {
        title: 'One offer per driver, decided in the store',
        narration:
          'The matcher makes the offer in one transaction on two rows. The ride gets the offer, on the condition that it is still matching and that nobody changed its offer since the matcher read it. The driver’s single offer slot is filled, on the condition that the driver is available and the slot is empty or expired. If the driver’s condition fails, the matcher tries the next candidate, up to 3 in a pass. Then it writes a hint in the in-memory store, and the answer to the driver’s next position update carries the offer. Last, it hides the queue message until the offer expires, 15 seconds after it was made.',
        tradeoff:
          'A lock in the in-memory store would be cheaper and can vanish in a failover, so it cannot be the thing that keeps a driver from two offers. Reserving on the driver row costs a transaction per offer, about 500 a second, and holds without any timing assumption. The hint is written after the commit and can be lost: then the driver never sees that offer and it runs out like one nobody answered. The offer also waits for the next position update, 2.5 seconds on average and 5 at worst, which is the price of having no connection to push it through.',
        nodes: ['matcher', 'store', 'geo', 'locations', 'driver'],
        travel: [
          ['matcher', 'store'],
          ['matcher', 'geo'],
          ['driver', 'locations'],
          ['locations', 'geo'],
        ],
        short: 'Offer',
        metrics: {
          requestsPerSecond: '54K',
          p95Latency: '60 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'First offer p99', value: '1 s' },
            { label: 'Offers', value: '500/s' },
          ],
        },
        load: { matcher: 45, store: 40, geo: 55, locations: 55 },
      },
      {
        title: 'Accept, decline or no answer',
        narration:
          'The driver accepts through the Ride API. One transaction sets the ride to accepted with this driver, if the ride is still matching with this offer, and sets the driver to busy with this ride, if the driver is available and still holds this offer. A decline clears the offer on both rows and puts a second message on the queue so a matcher runs at once. No answer needs no code: the hidden message returns when the offer expires and the matcher tries the next driver. After 60 seconds of search with no offer out, the matcher ends the ride as expired with the reason no driver.',
        tradeoff:
          'Offering to one driver at a time is fair to drivers and slower for the rider: every offer that gets no answer costs up to 15 seconds, while a decline moves on at once, and 4 in 5 offers are accepted. Offering to several at once would be faster and would leave drivers who said yes with nothing. Using the queue message as the timer means a matcher that crashes loses nothing, because the message returns by itself; the cost is a message that is received many times by design, so the queue’s count of receives cannot be a tight guard against a poisoned message.',
        nodes: ['driver', 'api', 'store', 'matchq', 'matcher'],
        travel: [
          ['driver', 'api'],
          ['api', 'store'],
          ['api', 'matchq'],
          ['matchq', 'matcher'],
        ],
        short: 'Accept',
        metrics: {
          requestsPerSecond: '54K',
          p95Latency: '60 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Typical match', value: '8 s' },
            { label: 'Offers accepted', value: '80%' },
          ],
        },
        load: { api: 45, store: 40, matchq: 20, matcher: 45 },
      },
      {
        title: 'Pickup to drop-off',
        narration:
          'The driver marks the pickup, and the ride moves from accepted to in progress with a conditional write. At the destination the driver marks the drop-off: one transaction completes the ride, sets its payment to pending and makes the driver available again. Both apps read the ride every 15 seconds. If the driver’s phone has no signal at the destination, the app keeps the drop-off and repeats it until the Ride API answers; a repeat of a call that already took effect is answered from the row.',
        tradeoff:
          'Every change names the state it expects, so a late or repeated call cannot move a ride backwards, and the cost is a state machine to maintain. Because the fare was fixed at the quote, a phone without signal delays the end of the trip and changes no price. Polling is the simplest way to show the state and it is the largest load on the API, 50,000 reads a second, and a change can take up to 15 seconds to show.',
        nodes: ['driver', 'rider', 'api', 'store'],
        travel: [
          ['driver', 'api'],
          ['rider', 'api'],
          ['api', 'store'],
        ],
        short: 'Trip',
        metrics: {
          requestsPerSecond: '54K',
          p95Latency: '60 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Open rides', value: '360K' },
            { label: 'Status polls', value: '50K/s' },
          ],
        },
        load: { api: 45, store: 45 },
      },
      {
        title: 'A due time on every open ride',
        narration:
          'A sweeper joins. Every ride that is not finished carries a due time, and an index lists rides by it. Every 15 seconds the sweeper reads what is overdue and applies it with a conditional write. A ride still matching 90 seconds after the request ends as expired. A ride accepted 30 minutes ago with no pickup is cancelled and its driver freed. A ride in progress long past its quoted time, four times the trip time plus an hour, moves to review for a person, and its driver is freed.',
        tradeoff:
          'Without due times a ride whose driver’s phone died would stay open for good, and that driver would stay busy. One sweeper for every deadline is one more thing that must be running, and its checks are late by up to its 15-second period plus the index’s short lag. It only ever writes if the ride is still in the state and at the due time it read, so it cannot undo a change that arrived first.',
        nodes: ['sweeper', 'store'],
        travel: [['sweeper', 'store', 'due']],
        short: 'Due times',
        metrics: {
          requestsPerSecond: '54K',
          p95Latency: '60 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Sweep every', value: '15 s' },
            { label: 'Closed by sweeper', value: 'under 0.01%' },
          ],
        },
        load: { sweeper: 30, store: 45 },
      },
      {
        title: 'Charge after the trip',
        narration:
          'A completed ride with a pending payment is due at once. The sweeper puts its ride id on the payment queue and then marks the payment queued. A payment worker reads the ride and charges the quoted fare at the payment provider with the ride id as the idempotency key, then records charged on the ride row, or failed with the reason when the card is declined; the diagram does not draw the worker’s read and write of the ride. If the provider does not answer, the worker puts a delayed copy of the message on the queue and deletes the original, until 24 hours after the drop-off, when the payment fails with the reason provider unavailable.',
        tradeoff:
          'Queueing the payment from the drop-off request would be a few seconds faster and would need the sweeper anyway, for the crash between the commit and the send. Making the repair path the only path means it runs 400 times a second and not once a month; the costs are up to 15 seconds before a charge starts and no charges while the sweeper is down. Charging after the trip means a card can be declined when the ride is already over, a loss this design accepts.',
        nodes: ['sweeper', 'store', 'payq', 'pay', 'provider'],
        travel: [
          ['sweeper', 'store', 'due'],
          ['sweeper', 'payq'],
          ['payq', 'pay'],
          ['pay', 'provider'],
        ],
        short: 'Payment',
        metrics: {
          requestsPerSecond: '54K',
          p95Latency: '60 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Charges', value: '400/s' },
            { label: 'Drop-off to charge', value: '20 s' },
          ],
        },
        load: { sweeper: 40, store: 45, payq: 20, pay: 35, provider: 35 },
      },
    ],
  },
  flows: [
    {
      id: 'ping',
      title: 'A driver sends a position',
      kind: 'sync',
      summary:
        'Dana is online and available. Her app sends a position every 5 seconds; the location service files it under a cell and a 10-second bucket and answers in about 20 ms, with her current offer if she has one.',
      runsOn: 'Location ALB → Location service on ECS Fargate → Amazon ElastiCache for Valkey',
      participants: [
        { id: 'app', label: 'Driver app', service: 'Phone' },
        { id: 'alb', label: 'Load balancer', service: 'ALB with AWS WAF' },
        { id: 'loc', label: 'Location service', service: 'ECS Fargate' },
        { id: 'geo', label: 'Geo index', service: 'ElastiCache for Valkey' },
      ],
      steps: [
        {
          from: 'app',
          to: 'alb',
          label: 'POST /drivers/me/location {lat, lng, status: available}',
          note: 'Over TLS, with the driver’s token. This load balancer serves only the location service, so 200,000 disposable requests a second share nothing with ride requests.',
        },
        {
          from: 'alb',
          to: 'loc',
          label: 'forward',
          note: 'Tasks are stateless and spread over three Availability Zones. The driver id comes from the token, never from the body. An update with the status busy is answered here without a call to the index, so nothing is stored.',
        },
        {
          from: 'loc',
          to: 'geo',
          label: 'MULTI, GEOADD cell:bucket lng lat driverId, EXPIRE cell:bucket 30, EXEC',
          note: 'The key names the 5-character geohash cell of the position and the 10-second bucket of the current time. Both commands touch one key, so they run as one transaction on one shard, and a key is never left without an expiry.',
        },
        {
          from: 'loc',
          to: 'geo',
          label: 'GET hint:driverId',
          note: 'Sent at the same time as the write, to whichever shard holds the hint. Usually there is none.',
        },
        {
          from: 'geo',
          to: 'loc',
          label: 'OK, no hint',
          note: 'If either command fails or takes more than 100 ms, the service gives up on it and still answers. A lost position is replaced by the next one; a lost hint read is retried by the next update.',
          style: 'reply',
        },
        {
          from: 'loc',
          to: 'app',
          label: '200 {}',
          note: 'The app does not retry a failed update. It sends the next position 5 seconds later.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'request',
      title: 'A rider requests a ride',
      kind: 'sync',
      summary:
        'Ana has a fare and taps request. The Ride API stores the ride, queues one message and answers 202 in about 60 ms. No driver has been contacted yet.',
      runsOn: 'Ride ALB → Ride API on ECS Fargate → Amazon DynamoDB → Amazon SQS',
      participants: [
        { id: 'app', label: 'Rider app', service: 'Phone' },
        { id: 'api', label: 'Ride API', service: 'ALB + ECS Fargate' },
        { id: 'fares', label: 'Fares table', service: 'DynamoDB' },
        { id: 'rides', label: 'Rides table', service: 'DynamoDB' },
        { id: 'q', label: 'Match queue', service: 'SQS standard' },
      ],
      steps: [
        {
          from: 'app',
          to: 'api',
          label: 'POST /rides {fareId: F42}',
          note: 'The fare id is the only input, and it is the idempotency key: the app sends the same call again if it gets no answer.',
        },
        {
          from: 'api',
          to: 'rides',
          label: 'GetItem F42, consistent',
          note: 'No ride with this id yet. Had there been one, the API would answer with it, after sending its message again if it is still matching.',
        },
        {
          from: 'api',
          to: 'fares',
          label: 'GetItem F42',
          note: 'The fare belongs to Ana and has 3 minutes left. An expired fare, or someone else’s, is refused and the rider asks for a new quote.',
        },
        {
          from: 'api',
          to: 'rides',
          label:
            'PutItem status=matching, searchDeadline=now+60 s, dueAt=now+90 s IF attribute_not_exists',
          note: 'The ride copies the pickup, the destination, the price and the trip time from the fare. The condition makes two requests at the same instant produce one ride. The due time is the sweeper’s backstop in case nothing ever works on this ride.',
        },
        {
          from: 'api',
          to: 'q',
          label: 'SendMessage {rideId: F42}',
          note: 'If this send fails, the answer is 503 and the app repeats the request, which finds the row and sends again. If the task dies here and no retry comes, the sweeper ends the ride as expired at its due time.',
          style: 'async',
        },
        {
          from: 'api',
          to: 'app',
          label: '202 {rideId: F42, status: matching}',
          note: 'The app now reads GET /rides/F42 every 2 seconds until the status changes.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'match',
      title: 'The matcher makes one offer',
      kind: 'queue',
      summary:
        'A matcher takes Ana’s ride from the queue, finds the nearest fresh drivers, reserves Dana and writes the offer on the ride in one transaction, then leaves the message hidden until the offer expires.',
      runsOn:
        'Amazon SQS → Matcher on ECS Fargate → ElastiCache for Valkey → Route service → Amazon DynamoDB',
      participants: [
        { id: 'q', label: 'Match queue', service: 'SQS standard' },
        { id: 'm', label: 'Matcher', service: 'ECS Fargate' },
        { id: 'ddb', label: 'Rides and drivers', service: 'DynamoDB' },
        { id: 'geo', label: 'Geo index', service: 'ElastiCache for Valkey' },
        { id: 'routes', label: 'Route service', service: 'ECS Fargate' },
      ],
      steps: [
        {
          from: 'q',
          to: 'm',
          label: 'ReceiveMessage {rideId: F42}',
          note: 'The message becomes invisible for 30 seconds, the queue’s default. If the matcher dies at any point below, the message comes back by itself.',
          style: 'async',
        },
        {
          from: 'm',
          to: 'ddb',
          label: 'GetItem ride F42, consistent',
          note: 'Matching, round 0, no offer. A ride that is no longer matching means the message has done its job and is deleted. A ride with a live offer means there is nothing to do yet, and the message is hidden until that offer expires.',
        },
        {
          from: 'm',
          to: 'geo',
          label: 'GEOSEARCH × 18: 9 cells × 2 buckets, BYRADIUS 2 km ASC COUNT 10',
          note: 'The pickup’s cell and its eight neighbours cover a 2 km circle wherever a cell is at least 2 km wide. A driver found in both buckets counts once, at the newer position. An EXISTS on each candidate’s hint drops the drivers who already hold an offer.',
        },
        {
          from: 'm',
          to: 'routes',
          label: 'travel time from 5 drivers to the pickup',
          note: 'One call with the five nearest candidates. Dana is 600 m away and 2 minutes by road; a driver 400 m away across the river is 9 minutes. After 300 ms without an answer the matcher keeps the straight-line order.',
        },
        {
          from: 'm',
          to: 'ddb',
          label:
            'TransactWriteItems: ride SET offer O1 for Dana, round=1 IF matching AND round=0; driver SET offer O1 IF available AND slot empty or expired',
          note: 'Both rows change or neither does. If Dana’s condition fails, because another ride reserved her a moment ago, the matcher tries the next candidate, up to 3 in this pass. If the ride’s condition fails, something else moved the ride, and the matcher reads it again.',
        },
        {
          from: 'm',
          to: 'geo',
          label: 'SET hint:Dana {offer O1, ride F42, pickup, fare, expires} EX 15',
          note: 'After the commit, and not atomic with it. If this write is lost Dana never sees the offer, and it expires like one she did not answer.',
          style: 'async',
        },
        {
          from: 'm',
          to: 'q',
          label: 'ChangeMessageVisibility 16 s',
          note: 'One second after the offer expires. The message is not deleted: it is the timer. When no candidate was found at all, the matcher hides it for 5 seconds and searches again.',
        },
      ],
    },
    {
      id: 'accept',
      title: 'The driver accepts',
      kind: 'sync',
      summary:
        'Dana’s next position update is answered with the offer. She accepts, and one transaction gives the ride its driver and the driver her ride. Ana’s app sees it on its next poll.',
      runsOn:
        'Location service → ElastiCache for Valkey, then Ride API on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'app', label: 'Driver app', service: 'Phone' },
        { id: 'loc', label: 'Location service', service: 'ECS Fargate' },
        { id: 'geo', label: 'Geo index', service: 'ElastiCache for Valkey' },
        { id: 'api', label: 'Ride API', service: 'ALB + ECS Fargate' },
        { id: 'ddb', label: 'Rides and drivers', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'loc',
          label: 'POST /drivers/me/location',
          note: 'The regular update, up to 5 seconds after the offer was made and 2.5 on average.',
        },
        {
          from: 'loc',
          to: 'geo',
          label: 'GET hint:Dana',
          note: 'The hint is there for the 15 seconds the offer lasts.',
        },
        {
          from: 'loc',
          to: 'app',
          label: '200 {offer O1: pickup, fare, expires}',
          note: 'The app shows the offer with the time left. It ignores a hint for an offer it has already answered, since the hint stays until it expires.',
          style: 'reply',
        },
        {
          from: 'app',
          to: 'api',
          label: 'POST /rides/F42/offers/O1/accept',
          note: 'Repeated by the app until it is answered.',
        },
        {
          from: 'api',
          to: 'ddb',
          label:
            'TransactWriteItems: ride SET accepted, driver=Dana, dueAt=now+30 min IF matching AND offer=O1; driver SET busy, ride=F42 IF available AND offer=O1',
          note: 'The ride’s condition fails if the rider cancelled, the search ended or the matcher moved on. The driver’s condition fails if she went offline or another ride took her slot after this offer expired. Either way nothing changes. No clock is compared: an answer a moment late still wins if nothing else moved first.',
        },
        {
          from: 'api',
          to: 'app',
          label: '200 {ride F42, pickup}',
          note: 'If the transaction was refused, the API reads the ride: when Dana is already its driver this call is a repeat and gets the same 200, otherwise 409 and the app drops the offer.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'contend',
      title: 'Two riders, one driver',
      kind: 'queue',
      summary:
        'Ana and Ben request at the same moment from the same corner, and Dana is the best driver for both. Two matchers try to reserve her; the store lets one through and the other moves to the next driver.',
      runsOn: 'Two matcher tasks on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'ma', label: 'Matcher, Ana’s ride', service: 'ECS Fargate' },
        { id: 'mb', label: 'Matcher, Ben’s ride', service: 'ECS Fargate' },
        { id: 'ddb', label: 'Rides and drivers', service: 'DynamoDB' },
        { id: 'geo', label: 'Geo index', service: 'ElastiCache for Valkey' },
      ],
      steps: [
        {
          from: 'ma',
          to: 'geo',
          label: 'GEOSEARCH around the corner',
          note: 'Dana first, Eli second. Ben’s matcher runs the same search a few milliseconds later and gets the same list, because Dana holds no hint yet.',
        },
        {
          from: 'ma',
          to: 'ddb',
          label: 'TransactWriteItems: Ana’s ride + Dana’s slot',
          note: 'Commits. Dana’s row now holds offer O1 with an expiry 15 seconds ahead.',
        },
        {
          from: 'mb',
          to: 'ddb',
          label: 'TransactWriteItems: Ben’s ride + Dana’s slot',
          note: 'Refused: Dana’s slot is neither empty nor expired. Had the two calls overlapped, the store would have cancelled one of them as a conflict, with the same result. Nothing was written to Ben’s ride, because a transaction is all or nothing. The refused attempt is still billed.',
        },
        {
          from: 'mb',
          to: 'ddb',
          label: 'TransactWriteItems: Ben’s ride + Eli’s slot',
          note: 'The next candidate in the same pass. Commits: Ben’s ride now waits for Eli. Up to 3 candidates are tried before the matcher hides the message for 5 seconds and searches again.',
        },
        {
          from: 'mb',
          to: 'geo',
          label: 'SET hint:Eli EX 15',
          note: 'From here both rides go on as in the single case. If Dana declines Ana’s offer, her slot is cleared at once and she can be offered Ben’s ride only if Eli also says no.',
          style: 'async',
        },
      ],
    },
    {
      id: 'no-answer',
      title: 'A driver declines or does not answer',
      kind: 'queue',
      summary:
        'Dana declines after 4 seconds, and the next driver, Eli, never answers. The decline wakes a matcher at once; the silence is noticed when the hidden message returns. Neither path needs a timer in any process.',
      runsOn: 'Ride API on ECS Fargate → Amazon DynamoDB → Amazon SQS → Matcher',
      participants: [
        { id: 'app', label: 'Driver app', service: 'Phone' },
        { id: 'api', label: 'Ride API', service: 'ALB + ECS Fargate' },
        { id: 'ddb', label: 'Rides and drivers', service: 'DynamoDB' },
        { id: 'q', label: 'Match queue', service: 'SQS standard' },
        { id: 'm', label: 'Matcher', service: 'ECS Fargate' },
      ],
      steps: [
        {
          from: 'app',
          to: 'api',
          label: 'POST /rides/F42/offers/O1/decline',
          note: 'Dana says no, 4 seconds after the offer was made. The app repeats the call until it is answered.',
        },
        {
          from: 'api',
          to: 'ddb',
          label:
            'TransactWriteItems: ride REMOVE offer IF offer=O1 AND matching; driver REMOVE offer IF offer=O1',
          note: 'Dana’s slot is free for other rides at once, and she stays in this ride’s list of drivers already tried. A repeated decline fails the condition and changes nothing.',
        },
        {
          from: 'api',
          to: 'q',
          label: 'SendMessage {rideId: F42}',
          note: 'A second message for the same ride, so a matcher runs now and not when the first offer would have expired. If this send is lost, the first message still returns at second 16.',
          style: 'async',
        },
        {
          from: 'q',
          to: 'm',
          label: 'ReceiveMessage {rideId: F42}',
          note: 'The matcher reads the ride, sees round 1 with no offer, and offers the ride to Eli as O2 with round 2. This message is hidden for 16 seconds.',
          style: 'async',
        },
        {
          from: 'q',
          to: 'm',
          label: 'ReceiveMessage, the first message, at second 16',
          note: 'It finds offer O2 still live and hides itself until O2 expires. Two messages now watch one ride; both are deleted as soon as a matcher finds the ride no longer matching.',
          style: 'async',
        },
        {
          from: 'q',
          to: 'm',
          label: 'ReceiveMessage after O2 expires',
          note: 'Eli did not answer. Nothing has to be undone: his slot simply reads as expired, and the ride’s offer is past its expiry.',
          style: 'async',
        },
        {
          from: 'm',
          to: 'ddb',
          label:
            'TransactWriteItems: ride SET offer O3, round=3 IF matching AND round=2; next driver’s slot',
          note: 'Whichever of the two messages gets here first wins; the other fails the round condition, reads the ride again and goes back to sleep. If no offer is out when 60 seconds of search have passed, the matcher sets the ride to expired with the reason no driver, on the same round condition, and deletes the message.',
        },
      ],
    },
    {
      id: 'trip',
      title: 'Pickup to drop-off, with a phone that loses signal',
      kind: 'sync',
      summary:
        'Dana picks Ana up and drives her to the destination, where her phone has no signal for two minutes. The drop-off is sent when the signal returns, takes effect once, and the fare is the one quoted.',
      runsOn: 'Ride API on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'app', label: 'Driver app', service: 'Phone' },
        { id: 'api', label: 'Ride API', service: 'ALB + ECS Fargate' },
        { id: 'ddb', label: 'Rides and drivers', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'api',
          label: 'POST /rides/F42/pickup',
          note: 'Dana has Ana in the car.',
        },
        {
          from: 'api',
          to: 'ddb',
          label:
            'UpdateItem SET in_progress, startedAt, dueAt=now+4×12 min+1 h IF accepted AND driver=Dana',
          note: 'The quoted trip time is 12 minutes, so the ride is due for review 1 hour and 48 minutes from now if no drop-off arrives. From here the rider can no longer cancel.',
        },
        {
          from: 'app',
          to: 'app',
          label: 'no signal: keep the drop-off and retry',
          note: 'At the destination the phone is offline. The app stores the drop-off and repeats it with a growing pause. Position updates fail quietly in the meantime, which matters to nobody: a busy driver is not in the index.',
        },
        {
          from: 'app',
          to: 'api',
          label: 'POST /rides/F42/dropoff',
          note: 'Two minutes late. The completion time is the server’s clock when the call arrives. That changes nothing about the price, which was fixed at the quote.',
        },
        {
          from: 'api',
          to: 'ddb',
          label:
            'TransactWriteItems: ride SET completed, payment=pending, dueAt=now IF in_progress AND driver=Dana; driver SET available REMOVE ride IF ride=F42',
          note: 'One step ends the trip, frees Dana and makes the payment due. Her next position update says available and puts her back in the index.',
        },
        {
          from: 'api',
          to: 'app',
          label: '200 {completed, fare 14.20}',
          note: 'If the answer is lost, the app sends the drop-off again. The transaction is refused because the ride is no longer in progress, the API reads the ride, sees it completed with Dana as its driver and answers 200 again. Had the phone stayed dead past the due time, the sweeper would have moved the ride to review and this call would get 409.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'pay',
      title: 'Charge the fare after the trip',
      kind: 'scheduled',
      summary:
        'Within 15 seconds of the drop-off the sweeper queues the payment. A worker charges the quoted fare with the ride id as the idempotency key and records the result.',
      runsOn:
        'Sweeper on ECS Fargate → Amazon DynamoDB due index → Amazon SQS → payment worker → payment provider',
      participants: [
        { id: 'sw', label: 'Sweeper', service: 'ECS Fargate, one task' },
        { id: 'ddb', label: 'Rides table', service: 'DynamoDB + due index' },
        { id: 'q', label: 'Payment queue', service: 'SQS standard' },
        { id: 'w', label: 'Payment worker', service: 'ECS Fargate' },
        { id: 'psp', label: 'Payment provider', service: 'External' },
      ],
      steps: [
        {
          from: 'sw',
          to: 'ddb',
          label: 'Query due index: shard n, dueAt <= now, oldest first',
          note: 'Every 15 seconds, for each of the 32 shards in parallel. The index is read with eventual consistency, so the sweeper treats what it reads as a list of candidates, not as facts.',
        },
        {
          from: 'sw',
          to: 'q',
          label: 'SendMessageBatch {rideId: F42} and 9 more',
          note: 'Ride F42 is completed with a pending payment. A batch can report some entries as failed; those stay pending and are picked up by the next pass.',
          style: 'async',
        },
        {
          from: 'sw',
          to: 'ddb',
          label: 'UpdateItem payment=queued, dueAt=completedAt+25 h IF payment=pending',
          note: 'Only after the send. A crash between the two sends the same ride again 15 seconds later, which the steps below make harmless. The new due time is the last backstop: a payment still queued then is closed as failed.',
        },
        {
          from: 'q',
          to: 'w',
          label: 'ReceiveMessage {rideId: F42}',
          note: 'Invisible for 60 seconds. The worker reads the ride with a consistent read: a payment already charged or failed means a repeat, and the message is deleted.',
          style: 'async',
        },
        {
          from: 'w',
          to: 'psp',
          label: 'charge 14.20, Idempotency-Key: F42',
          note: 'With a 10-second timeout. Two workers holding two copies of the message both get the same single charge back, because the provider keys it on the ride id.',
        },
        {
          from: 'w',
          to: 'ddb',
          label:
            'UpdateItem payment=charged, chargeId REMOVE dueAt IF payment IN (pending, queued)',
          note: 'Removing the due time takes the ride out of the index: nothing is open any more. A declined card is recorded as failed with the reason declined in the same way.',
        },
        {
          from: 'w',
          to: 'q',
          label: 'DeleteMessage',
          note: 'Last. If the provider or the table did not answer, the worker instead sends a copy of the message with a delay that doubles from 30 seconds up to 15 minutes, and deletes the original, so a long outage never uses up the queue’s receive count. No charge is started later than 24 hours after the drop-off: the payment is then recorded as failed with the reason provider unavailable.',
        },
      ],
    },
    {
      id: 'shard-down',
      title: 'A shard of the geo index dies',
      kind: 'direct',
      summary:
        'The primary of one of the 8 shards fails. For a few seconds the cells on that shard take no writes; then a replica is promoted and the next round of position updates fills in whatever replication had not carried over.',
      runsOn: 'Location service and matcher on ECS Fargate → Amazon ElastiCache for Valkey',
      participants: [
        { id: 'loc', label: 'Location service', service: 'ECS Fargate' },
        { id: 'p', label: 'Shard 3 primary', service: 'ElastiCache node' },
        { id: 'r', label: 'Shard 3 replica', service: 'ElastiCache node, other AZ' },
        { id: 'm', label: 'Matcher', service: 'ECS Fargate' },
      ],
      steps: [
        {
          from: 'loc',
          to: 'p',
          label: 'GEOADD: connection refused',
          note: 'Writes to the cells and hints on shard 3 fail. The service drops them and still answers the phones, so one eighth of the positions and hints are lost for the moment and the other seven shards are untouched.',
        },
        {
          from: 'm',
          to: 'p',
          label: 'GEOSEARCH: error',
          note: 'A search that touches a cell on shard 3 treats that cell as empty. If no candidate is left, the ride’s message is hidden for 5 seconds and the search runs again, well inside its 60 seconds.',
        },
        {
          from: 'r',
          to: 'r',
          label: 'promoted to primary',
          note: 'ElastiCache promotes the replica with the least lag, typically within a few seconds. Replication is asynchronous, so the last writes before the failure may be missing.',
        },
        {
          from: 'loc',
          to: 'r',
          label: 'GEOADD',
          note: 'Clients follow the new primary. Within 5 seconds every available driver in those cells has reported again, so the missing writes are rewritten without any rebuild.',
        },
        {
          from: 'm',
          to: 'r',
          label: 'GEOSEARCH',
          note: 'Searches see full cells again. Offers whose hint was lost in the failover were not shown to their drivers and expire after 15 seconds; the rides move on to the next driver. Had the replica been lost too, the shard would come back empty and fill the same way.',
        },
      ],
    },
    {
      id: 'duplicate',
      title: 'A duplicate ride request',
      kind: 'sync',
      summary:
        'Ana’s app does not get the 202 and sends the request again. The fare id is the ride id, so the second request finds the ride, queues one more message and returns the same ride. One ride, one driver.',
      runsOn: 'Ride API on ECS Fargate → Amazon DynamoDB → Amazon SQS → Matcher',
      participants: [
        { id: 'app', label: 'Rider app', service: 'Phone' },
        { id: 'api', label: 'Ride API', service: 'ALB + ECS Fargate' },
        { id: 'ddb', label: 'Rides table', service: 'DynamoDB' },
        { id: 'q', label: 'Match queue', service: 'SQS standard' },
        { id: 'm', label: 'Matcher', service: 'ECS Fargate' },
      ],
      steps: [
        {
          from: 'app',
          to: 'api',
          label: 'POST /rides {fareId: F42}',
          note: 'The ride is stored and message M1 is queued, but the 202 is lost on the way back.',
        },
        {
          from: 'app',
          to: 'api',
          label: 'POST /rides {fareId: F42}, again',
          note: 'The same fare id, so the same ride id.',
        },
        {
          from: 'api',
          to: 'ddb',
          label: 'GetItem F42, consistent: matching',
          note: 'The ride exists. Had the two requests raced, the second PutItem would have failed its condition and ended up here as well.',
        },
        {
          from: 'api',
          to: 'q',
          label: 'SendMessage M2 {rideId: F42}',
          note: 'The API cannot know whether M1 was sent, so it sends again while the ride is matching and inside its search time. This is what repairs a first attempt that died between the row and the queue.',
          style: 'async',
        },
        {
          from: 'api',
          to: 'app',
          label: '202 {rideId: F42, status: matching}',
          note: 'The same answer as the first time.',
          style: 'reply',
        },
        {
          from: 'q',
          to: 'm',
          label: 'ReceiveMessage M2',
          note: 'M1 already produced offer O1. The matcher holding M2 reads the ride, sees a live offer and hides M2 until it expires. If both had read the ride before any offer, both would try a transaction with round 0, and one would be refused.',
          style: 'async',
        },
        {
          from: 'm',
          to: 'q',
          label: 'DeleteMessage M2, once the ride is accepted',
          note: 'Every message for a ride is deleted the first time a matcher finds the ride no longer matching. The queue can also deliver one message twice by itself; the handling is the same.',
        },
      ],
    },
    {
      id: 'hotspot',
      title: 'A hot area: far more riders than drivers',
      kind: 'queue',
      summary:
        'A stadium empties: 20,000 requests in 5 minutes around a few cells with 300 drivers. Every request is accepted in 60 ms, 300 riders get a driver quickly, and the rest search for 60 seconds and are told honestly that no driver was found.',
      runsOn: 'Ride API → Amazon SQS → Matcher on ECS Fargate → ElastiCache and DynamoDB',
      participants: [
        { id: 'app', label: 'Rider apps', service: 'Phones' },
        { id: 'api', label: 'Ride API', service: 'ALB + ECS Fargate' },
        { id: 'q', label: 'Match queue', service: 'SQS standard' },
        { id: 'm', label: 'Matchers', service: 'ECS Fargate' },
        { id: 'geo', label: 'Geo index', service: 'ElastiCache for Valkey' },
        { id: 'ddb', label: 'Rides and drivers', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'api',
          label: 'POST /rides × 67 a second',
          note: 'On top of normal traffic. Each request is two reads, one write and one send, and holds an API worker for about 60 ms, the same as on a quiet night.',
        },
        {
          from: 'api',
          to: 'q',
          label: 'SendMessage × 67 a second',
          note: 'The queue has no backlog limit to speak of. The matcher pool grows with the number of visible messages.',
          style: 'async',
        },
        {
          from: 'q',
          to: 'm',
          label: 'ReceiveMessage',
          note: 'The first 300 rides or so each reserve a driver. After that a search around the stadium returns drivers who hold a hint, drivers who have just accepted, or nobody.',
          style: 'async',
        },
        {
          from: 'm',
          to: 'geo',
          label: 'GEOSEARCH × 18, then EXISTS on the hints',
          note: 'Up to 4,000 rides are searching at once, each every 5 seconds: 800 passes a second and about 14,400 searches a second on the keys of nine cells. Even if they all land on one shard, it goes from 80,000 commands a second to about 94,000, of the 150,000 it is planned for. Like the 80,000, that figure leaves out the matchers’ normal searches and the hint commands, which are keyed by driver and spread over every shard: about 2% more.',
        },
        {
          from: 'm',
          to: 'q',
          label: 'ChangeMessageVisibility 5 s',
          note: 'No candidate: the ride waits 5 seconds and tries again. A waiting ride costs one cheap pass every 5 seconds and no API worker, no connection and no lock.',
        },
        {
          from: 'm',
          to: 'ddb',
          label: 'TransactWriteItems when a driver frees up',
          note: 'A driver who drops someone off nearby shows up in the index, and several waiting rides may try to reserve her in the same second. One transaction commits, the others are refused, and each pass stops after 3 refusals. Which rider gets her is not decided by who asked first.',
        },
        {
          from: 'm',
          to: 'ddb',
          label:
            'UpdateItem status=expired, reason no driver REMOVE dueAt IF matching AND round unchanged',
          note: 'After 60 seconds of search. The rider’s next poll shows that no driver was found, and a new attempt needs a new quote. Rides elsewhere in the city share the queue and the pool, which is sized for 2,500 passes a second against the 1,800 of this moment.',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'How do we store and query frequent driver locations?',
      options: [
        {
          name: 'Latitude and longitude columns with an index',
          pros: 'No new technology; easy to query.',
          cons: 'A range on two columns scans a wide band of rows, and 200,000 durable writes a second of values that live 5 seconds overwhelm the database.',
        },
        {
          name: 'Spatial extension of a relational database',
          pros: 'Real spatial queries with a proper index.',
          cons: 'Still a durable write and an index update per position, which is wasted work at this volume.',
        },
        {
          name: 'In-memory geospatial sets with expiry',
          pros: 'Handles a very high write rate; a nearby query reads a few small sets and returns members sorted by distance.',
          cons: 'Not durable, a second store to run, and the cell size and the expiry have to be designed.',
        },
      ],
      choice:
        'In-memory geospatial sets, one per map cell and 10-second bucket, spread over 8 shards. Positions are disposable: the next update rewrites them, so throughput matters and durability does not. The durable facts, who is on which ride, live in the rides and drivers tables and never in this store.',
    },
    {
      question: 'How big is a cell, and how does a stale position leave the index?',
      options: [
        {
          name: 'One set per city',
          pros: 'One search per query, no neighbours to think about.',
          cons: 'A city’s whole write rate lands on one key and so on one shard, which cannot be split, and a search scans a set of a hundred thousand members.',
        },
        {
          name: 'Small cells of a few hundred metres, one long-lived set each',
          pros: 'Tiny sets and precise cells.',
          cons: 'A 2 km search has to read dozens of cells, and the store cannot expire one member of a set, so a job must remove drivers who went quiet, and that job has to keep up with a million drivers.',
        },
        {
          name: 'Cells about 5 km wide, a new set every 10 seconds',
          pros: 'The pickup’s cell and its eight neighbours cover a 2 km search. Whole keys expire by themselves 30 seconds after their last write, so there is no cleanup job. The hottest cell is a few thousand drivers, about a thousand writes a second on one key.',
          cons: 'Every search reads two buckets per cell, 18 small searches, and must merge them; memory holds about four copies of each position; a position can be 20 seconds old.',
        },
      ],
      choice:
        'Cells of 5 geohash characters, about 4.9 km on a side at the equator and narrower toward the poles, with a new key every 10 seconds that expires 30 seconds after its last write. A reader takes the current and the previous bucket, which bounds the age of a position at 20 seconds and makes a silent driver disappear with no job. The nine cells cover the 2 km search wherever a cell is at least 2 km wide, which holds in every large city.',
    },
    {
      question: 'How do we take 200,000 positions a second, and what may be lost?',
      options: [
        {
          name: 'Write every position to a durable table',
          pros: 'A history of every car, and nothing lost on a failure.',
          cons: 'The highest write rate in the system, paid for data that is replaced 5 seconds later and that matching never reads twice.',
        },
        {
          name: 'Put positions on a stream and let a consumer update the index',
          pros: 'A buffer in front of the index, a history for other consumers, and a replay after a failure.',
          cons: 'The consumer’s lag is added to every position’s age, a replayed position is worth nothing by the time it is replayed, and the stream is a second thing to size for 200,000 records a second.',
        },
        {
          name: 'Write straight to the in-memory index and drop on failure',
          pros: 'The fewest moving parts and the freshest positions. A failed write needs no retry, because the phone sends a newer one in 5 seconds.',
          cons: 'No history at all, and a failing shard makes its cells look empty until it is back.',
        },
      ],
      choice:
        'Straight to the index, and anything may be lost. The location service never retries and never queues: a dropped position costs a driver at most 5 seconds of visibility, and a lost shard is refilled by the next round of updates. What must not be lost is kept elsewhere: the ride and the driver’s status are rows in a durable table. A stream beside the index is the step to add when someone needs the history.',
    },
    {
      question:
        'How do we keep a driver from getting two offers and a ride from getting two drivers?',
      options: [
        {
          name: 'Check the driver’s status in the matcher',
          pros: 'Simple.',
          cons: 'Two matchers can both read "available" in the same moment and both make an offer.',
        },
        {
          name: 'Lock in the in-memory store with a time to live, plus a conditional update at accept',
          pros: 'Cheap, and a crashed matcher frees the driver when the lock runs out.',
          cons: 'The lock can vanish in a failover, so it is an optimization and not a guarantee. The real guard is still a write in the durable store, which makes two mechanisms where one is enough.',
        },
        {
          name: 'Reserve on the driver row, in one transaction with the ride',
          pros: 'One mechanism, in the store that already owns the truth. The driver row has a single offer slot, filled only if it is empty or expired, so a crashed matcher blocks a driver for at most 15 seconds. Accept is one more transaction on the same two rows.',
          cons: 'A transactional write per offer, 4 write units, also when it is refused; about 500 a second at peak.',
        },
      ],
      choice:
        'One offer slot on the driver row, written in the same transaction that puts the offer on the ride, and an accept that moves both rows only if both still show that offer. A driver can never hold two offers because there is one slot, and can never be on two rides because the row turns busy only from available. No part of this depends on clocks agreeing: time only decides when a slot may be reused.',
    },
    {
      question: 'How does the matcher wait for an answer without losing the ride if it crashes?',
      options: [
        {
          name: 'A timer in the matcher’s memory',
          pros: 'Nothing to store.',
          cons: 'A task that restarts forgets every ride it was waiting on, and those riders wait until something else notices.',
        },
        {
          name: 'A scheduled call per offer',
          pros: 'The timer survives the matcher.',
          cons: 'A second system to write to after the offer is committed, with its own lost-write case, for 500 timers a second that last 15 seconds.',
        },
        {
          name: 'The queue message is the timer',
          pros: 'After making an offer the matcher hides the ride’s message until the offer expires. A crash at any point returns the message after 30 seconds by itself. A decline adds a message to act sooner.',
          cons: 'One message is received many times, so the dead-letter threshold must be high, 40 receives, and a poisoned message takes about 20 minutes to be set aside. The age of the oldest message stops being a useful signal on this queue.',
        },
      ],
      choice:
        'The queue message is the timer. It is deleted only when a matcher finds the ride no longer matching, so as long as the ride is open something will come back to it, and every step it triggers is a conditional write, so a second copy of the message is harmless. The sweeper is the backstop for a message that is lost or poisoned: it ends the ride as expired 90 seconds after the request.',
    },
    {
      question: 'How do offers and ride changes reach the phones?',
      options: [
        {
          name: 'Mobile push notifications',
          pros: 'Reaches an app that is in the background.',
          cons: 'Delivery time is not promised and there is no receipt, which is a poor fit for an offer that lasts 15 seconds; two external providers to integrate.',
        },
        {
          name: 'A persistent connection per phone',
          pros: 'An offer arrives in well under a second, and no polling.',
          cons: 'Over a million connections to hold, a registry of which server holds which phone, and a reconnect storm to survive after every deploy or network blip.',
        },
        {
          name: 'The answer to the position update, and polling',
          pros: 'No new component: the driver’s phone already calls every 5 seconds, and the answer carries the offer. Riders and drivers read the ride every 2 or 15 seconds.',
          cons: 'An offer waits 2.5 seconds on average and 5 at worst before the driver sees it, and polling is 50,000 reads a second, the largest load on the Ride API.',
        },
      ],
      choice:
        'The answer to the position update for offers, and polling for the state of a ride. It adds a few seconds to a match and a steady read load, and removes a whole class of failures: there is no connection to lose and no registry to keep right. The truth is always the ride row, so a missed hint or a late poll delays what a phone shows and changes nothing about who has the ride. Persistent connections are the first thing to add at ten times the load.',
    },
    {
      question: 'How does a ride move from request to payment, and who ends a ride nobody ends?',
      options: [
        {
          name: 'Let each call set the status it wants',
          pros: 'Least code.',
          cons: 'A late drop-off can complete a ride that was cancelled, and a repeated call can charge twice.',
        },
        {
          name: 'A workflow engine with one execution per ride',
          pros: 'Timeouts and steps are declared in one place.',
          cons: 'A second owner of the ride’s state next to the table the apps read, to be kept in step with it, at 400 new executions a second.',
        },
        {
          name: 'A status on the ride row, conditional writes and a due time',
          pros: 'Each change names the state it starts from, so one of two racing calls wins and the other is answered from the row. Every open state carries a due time that one sweeper applies.',
          cons: 'The state machine is spread over several handlers and has to be kept consistent by review and tests.',
        },
      ],
      choice:
        'A status on the row. Matching ends as accepted, cancelled or expired; accepted ends as in progress or cancelled; in progress ends as completed, or as review when its due time passes. After the acceptance every ending changes the ride and its driver in one transaction, so a driver is free exactly when their ride is over. Every write that leaves nothing open on a ride, cancelled, expired, review, and charged or failed after a completed one, removes its due time, so the ride leaves the due index. The sweeper owns only time: 90 seconds for a request, 30 minutes for a pickup, four times the quoted trip plus an hour for a trip.',
    },
    {
      question: 'How far do pricing and travel time go in this design?',
      options: [
        {
          name: 'Meter the trip from the car’s positions',
          pros: 'The fare follows the real route and time.',
          cons: 'Positions become billing data: they must be durable, ordered and complete, and a phone without signal leaves a gap in the bill.',
        },
        {
          name: 'A managed routing API for every quote and every ranking',
          pros: 'No road data to maintain.',
          cons: 'Its default request quotas are far below 2,000 quotes a second and differ by Region, so the design would rest on quota increases agreed first, and on a price per call.',
        },
        {
          name: 'A fare fixed at the quote, from our own route service',
          pros: 'The rider pays what they saw, and nothing after the quote depends on tracking the car. The same service ranks the 5 nearest drivers by travel time.',
          cons: 'A routing engine and its road data to run, and a detour or a traffic jam is the driver’s loss or gain.',
        },
      ],
      choice:
        'A fixed fare from a route service we run: an open-source routing engine with the road graph in memory, as stateless replicas. Both callers have a fallback so that it cannot stop rides: after 300 ms a quote uses the straight-line distance times 1.3 and an average speed, and a ranking keeps the straight-line order. Surge pricing and the pricing model are out of scope.',
    },
    {
      question: 'How do we charge after the trip without charging twice or forgetting to?',
      options: [
        {
          name: 'Charge inside the drop-off request',
          pros: 'The driver sees the result at once.',
          cons: 'The driver’s request now waits on the payment provider, and a provider outage would keep trips from ending.',
        },
        {
          name: 'Complete the ride, then queue the payment from the same request',
          pros: 'The charge starts within a second.',
          cons: 'Two writes: a crash between them leaves a completed ride that nothing will charge, so a sweeper for pending payments is needed anyway, and it would run only on the rare failure.',
        },
        {
          name: 'The drop-off marks the payment pending, and the sweeper is the only path to the queue',
          pros: 'One path, exercised 400 times a second. The provider’s idempotency key, the ride id, makes a repeat of any step the same single charge.',
          cons: 'A charge starts up to 15 seconds after the drop-off, and none start while the sweeper is down.',
        },
      ],
      choice:
        'Pending on the row, queued by the sweeper, charged by a worker with the ride id as the idempotency key. Delivery to the worker is at least once, made harmless by that key at the provider and by the conditional write that records the result. A provider that does not answer delays the charge through delayed copies of the message, for up to 24 hours, and a payment still queued 25 hours after the drop-off is closed as failed by the sweeper, so every completed ride ends charged or failed with a reason.',
    },
    {
      question: 'What happens when a phone loses signal in the middle of a trip?',
      options: [
        {
          name: 'End the trip when positions stop arriving',
          pros: 'No ride stays open because of a dead phone.',
          cons: 'A tunnel or a car park would end trips that are going fine, and the rider would be charged for a trip the system declared over.',
        },
        {
          name: 'Trust a completion time sent by the phone',
          pros: 'The trip ends at the time it really ended.',
          cons: 'The phone’s clock decides a billing fact, and it can be wrong or changed.',
        },
        {
          name: 'Keep the trip open, let the app retry, and bound it with a due time',
          pros: 'Nothing about the ride depends on a continuous signal: the fare is fixed, the drop-off is idempotent, and the app repeats it until it is answered.',
          cons: 'The recorded end of the trip is late by as long as the phone was offline, the rider’s app shows in progress meanwhile, and a phone that never returns leaves the ride for a person.',
        },
      ],
      choice:
        'Keep the trip open. The driver’s app stores the drop-off and repeats it until the Ride API answers, and the completion time is the server’s clock. If no drop-off arrives by four times the quoted trip time plus one hour, the sweeper moves the ride to review, frees the driver and charges nothing; support decides from there. A rider’s phone without signal only stops the polling, and catches up on its next read.',
    },
    {
      question: 'How do we handle a sudden spike of requests in one city?',
      options: [
        {
          name: 'Match synchronously in the API',
          pros: 'Simple; the rider gets a direct answer.',
          cons: 'Every waiting rider holds an API worker for up to a minute, so one crowd exhausts the API for every city.',
        },
        {
          name: 'A durable queue for the whole region and a matcher pool that scales',
          pros: 'A request costs the API 60 ms whatever happens next, and a crowd becomes a longer queue. One queue, one pool and one set of alarms.',
          cons: 'An asynchronous flow in the app, and every city shares the pool, so a very large crowd can slow the first offer everywhere until the pool has grown.',
        },
        {
          name: 'A durable queue and a matcher pool per city',
          pros: 'One city’s crowd cannot delay another city’s matches.',
          cons: 'As many queues, pools, dead-letter queues and alarms as there are cities, most of them idle.',
        },
      ],
      choice:
        'One durable queue for the region, written right after the ride row, with a matcher pool that scales on the number of visible messages and is sized for 2,500 passes a second against a normal peak of 1,000. A stadium adds about 800. A queue per city is the step to take when one city’s events are large enough to slow the others.',
    },
    {
      question: 'What happens in an area where demand far exceeds the drivers?',
      options: [
        {
          name: 'Let every waiting ride search as fast as it can',
          pros: 'A freed driver is found at once.',
          cons: 'Thousands of rides hammer the same nine cells and the same few driver rows, and the load grows with the number of riders who cannot be served.',
        },
        {
          name: 'A waiting list per cell, served in order',
          pros: 'First come, first served, and one offer per freed driver with no races.',
          cons: 'A new ordered structure that must survive crashes, handle riders who cancel while waiting, and be merged across neighbouring cells.',
        },
        {
          name: 'A bounded search per ride and an honest answer',
          pros: 'Each ride searches once every 5 seconds for 60 seconds and then ends as expired with the reason no driver. The load is bounded by riders times one pass per 5 seconds, and a driver whose offer hint is still alive is filtered out before any write; the hint does not cover a driver in the seconds after they accept.',
          cons: 'Who gets a freed driver is decided by timing, not by who asked first, and most of the crowd is told no.',
        },
      ],
      choice:
        'A bounded search. The stadium’s 20,000 requests are all accepted, about 4,000 search at once at 800 passes a second, the drivers that exist are matched within seconds, and everyone else gets a clear answer after a minute and can ask again with a new quote. Raising the price where demand is high is the usual next lever and is out of scope here, as is fairness between waiting riders.',
    },
  ],
  wrapUp:
    'Positions are disposable and live in memory, in cells that expire on their own; a ride request is a durable row plus a queue message that doubles as the timer; one transaction on the ride and the driver decides every offer and every acceptance, so a driver holds one offer and one ride; every open ride carries a due time that a sweeper applies; and the fare, fixed at the quote, is charged after the trip with the ride id as the idempotency key.',
  guarantees: {
    provides: [
      {
        property: 'Acceptance',
        promise:
          'A 202 is answered only after the ride row is stored in the rides table, which acknowledges a write once it is durable, and after the match message is in the queue. If the message is missing because a task died between the two, a repeat of the request sends it, and without a repeat the sweeper ends the ride as expired 90 seconds after the request.',
      },
      {
        property: 'Idempotent request',
        promise:
          'The fare id is the ride id. Any number of requests with the same fare produce one ride, because the row is written only if it does not exist, for as long as the row is kept.',
      },
      {
        property: 'One driver per ride, one ride per driver',
        promise:
          'A ride gets a driver only through the accept transaction, which requires the ride to be matching with that offer and the driver to be available with that offer, and changes both rows or neither. Every later ending frees the driver in the same transaction that ends the ride. Requests and messages arrive at least once, made harmless by those conditions.',
      },
      {
        property: 'One offer at a time',
        promise:
          'A driver row has one offer slot, filled only when it is empty or past its expiry. A new offer replaces an old one only after the old one expired by the writer’s clock, and an offer that was replaced can no longer be accepted.',
      },
      {
        property: 'Every request ends',
        promise:
          'A ride leaves matching as accepted, cancelled, or expired with a reason. The matcher ends it once 60 seconds of search have passed and no offer is out. That is about 76 seconds after the request when the last offer was made just before second 60 and its message came back on time, and about 90 seconds when the matcher crashed after that offer, because the message then returns only after the queue’s 30 seconds. The sweeper is the backstop from 90 seconds, within one 15-second pass, so a ride is out of matching by about 105 seconds while the sweeper runs.',
      },
      {
        property: 'Every ride ends',
        promise:
          'An accepted ride with no pickup after 30 minutes is cancelled with the reason pickup timeout. A ride in progress past four times its quoted trip time plus one hour moves to review. In both cases the driver is freed in the same transaction.',
      },
      {
        property: 'Fare',
        promise:
          'The amount charged is the price stored on the ride when it was requested, copied from a fare that belonged to the rider and had not expired.',
      },
      {
        property: 'Payment',
        promise:
          'Every completed ride ends charged, or failed with a reason: declined, provider unavailable after 24 hours, or timeout at 25 hours. Payment messages are delivered at least once, made harmless by the ride id as the provider’s idempotency key, so a ride is charged at most once.',
      },
      {
        property: 'Freshness of positions',
        promise:
          'A position used for matching is at most 20 seconds old, plus up to a second of clock difference, because a search reads only the current and the previous 10-second bucket. A driver who stops reporting leaves the search results within 20 seconds.',
      },
    ],
    assumes: [
      'The rides and drivers tables apply a conditional write to one item atomically, run a transaction on several items as all or nothing, and return every acknowledged write to a consistent read.',
      'The queues deliver every stored message at least once.',
      'The payment provider treats a repeated charge with the same idempotency key as the same charge, for longer than the 24 hours in which this design retries.',
      'The driver’s app sends a position every 5 seconds while online, ignores a hint for an offer it already answered, and repeats accept, pickup and drop-off until they are answered.',
      'Server clocks agree within a second. Clocks decide which bucket a position goes to and when a slot or a due time has passed; they do not decide who owns a ride.',
      'The token identifies the rider or the driver, and a driver’s reported position and status are honest. Forged positions are out of scope.',
      'A payment worker never starts a charge later than 24 hours after the drop-off, which leaves an hour before the sweeper closes a queued payment as failed.',
    ],
    doesNotGuarantee: [
      'The nearest or the best driver. The search reads positions up to 20 seconds old, ranks only the 5 nearest by travel time, stops at 2 km and looks at one ride at a time. Each of the 18 searches returns at most its 10 nearest drivers before those already tried or holding an offer are dropped, so a free driver farther out can stay unseen while nearer ones are taken, until a later search.',
      'First come, first served. When several riders wait for the same driver, timing decides who gets them.',
      'That an offer reaches the driver’s phone. The hint is written after the offer is committed and lives in a store that can lose it; an offer the driver never saw expires like one they did not answer.',
      'An instant offer. It waits for the driver’s next position update, up to 5 seconds.',
      'That a waiting ride is woken on time under a backlog. A standard queue promises no order, and SQS moves a message that was received three or more times without being deleted to the back of the queue, so a ride that has waited longest can be served after newer ones and leave matching later than 76 seconds. Such a ride counts as a late search.',
      'That a driver who declined can be offered another ride at once. Their slot is free, but their hint stays for up to 15 seconds and other searches skip them until it expires.',
      'Durable positions. A failover loses the last writes of a shard and a lost shard comes back empty; both are refilled within 5 seconds by the next updates.',
      'That a completed trip is paid. The card is charged after the drop-off and can be declined, and no amount is held beforehand.',
      'That a payment recorded as failed with the reason provider unavailable or timeout took no money. A charge call that timed out may have gone through; a later retry with the same key learns it, but if the provider never answers again within 24 hours the row cannot know. Reconciling against the provider’s reports is out of scope.',
      'A page for a provider failure that keeps hitting the same small share of payments, under the 20% of calls that Payment provider failing needs. Each failed attempt is a new message, so Payments late stays quiet, and those payments show only in the workers’ time from drop-off to result and in the Payment objective.',
      'One open ride per rider. Two different fares are two rides, and nothing stops a rider from requesting both.',
      'A new driver after a driver cancels. The ride ends as cancelled and the rider requests again with a new quote.',
      'That a trip ends without its driver. A ride whose driver never reports the drop-off stays in progress until its due time and then waits in review for a person, uncharged.',
      'The real time of a drop-off. It is the moment the call reached the server, which is late by as long as the phone was offline.',
      'A fare that follows the trip. The quoted price is charged whatever route and time the trip took, and a quote made while the route service was unavailable rests on straight-line distance.',
      'An up-to-the-second status on the phones. The apps poll every 2 or 15 seconds, with reads that can trail a write by a moment.',
      'Isolation between cities. One queue and one matcher pool serve the region, so a very large crowd can slow first offers elsewhere until the pool has grown.',
      'That a dead letter resolves on its own. A match message set aside belongs to a ride that the sweeper ends as expired. A payment message set aside waits for a person, and if nobody redrives it the payment is closed as failed at 25 hours.',
    ],
  },
  failures: [
    {
      scenario:
        'A matcher crashes after the offer transaction committed and before it wrote the hint or hid the message.',
      impact:
        'The driver is reserved for 15 seconds for an offer they may never see, and the rider’s search loses up to 30 seconds, because the message returns only after the queue’s default visibility timeout. When that offer was made near the end of the 60 seconds, the search ends at about 90 seconds and not 76, and the ride counts as a late search.',
      detection:
        'The share of offers that expire unanswered, published by the matchers, rises above its normal 10%. One crash is invisible; a pool that keeps crashing shows in that metric and in the backlog of visible messages.',
      recovery:
        'The message returns after 30 seconds. The next matcher finds an expired offer, leaves that driver in the list already tried, and offers the ride to the next one. Nothing has to be undone: the driver’s slot reads as expired.',
    },
    {
      scenario: 'Two matchers try to reserve the same driver for two rides at the same moment.',
      impact:
        'Without the transaction the driver would get two offers and could accept both. With it, one commits and the other is refused, which costs 4 write units and a few milliseconds.',
      detection:
        'Nothing to detect for one event. TransactionConflict on the drivers table and the count of refused reservations are the baseline, and they rise in a hot area.',
      recovery:
        'The refused matcher tries its next candidate in the same pass, up to 3, and otherwise hides the message for 5 seconds and searches again.',
    },
    {
      scenario:
        'A driver accepts at the moment the offer expires, or the accept is sent twice because its answer was lost.',
      impact:
        'The accept races the matcher’s next offer. Whichever write reaches the ride first wins; the other is refused. The driver either has the ride or is told the offer is gone, never something in between.',
      detection:
        'The rate of 409 answers to accept, published by the Ride API. A steady few percent is normal; a jump means offers are reaching phones late.',
      recovery:
        'A refused accept reads the ride. If this driver is already its driver, the call was a repeat and is answered 200. Otherwise it answers 409, the app drops the offer, and the driver’s slot is either already reused or expires by itself.',
    },
    {
      scenario: 'The primary node of one geo index shard fails.',
      impact:
        'For a few seconds an eighth of the cells take no writes and return errors to searches, and an eighth of the hints cannot be read. Rides near those cells wait for their next search, and offers whose hint was lost run out unanswered after 15 seconds.',
      detection:
        'The failover event that ElastiCache publishes through Amazon SNS, the index write failures counted by the location service, and the share of offers that expire unanswered.',
      recovery:
        'A replica in another Availability Zone is promoted, typically within a few seconds, and clients follow it. The next round of position updates, 5 seconds, rewrites anything replication had not carried over. No rebuild and no manual step.',
    },
    {
      scenario: 'The whole geo index is unreachable for several minutes.',
      impact:
        'No search finds a driver and no offer hint can be written or read, so no new ride is matched. Requests are still accepted and end as expired with the reason no driver after 60 seconds. Rides already accepted or in progress are unaffected, because nothing after the acceptance reads the index.',
      detection:
        'Index write failures at the location service, far above the 0.2% alarm, and the share of requests that end as expired.',
      recovery:
        'When the store answers again it is empty or stale, and within 5 seconds every available driver has reported. Matching resumes by itself. Riders who were told no driver ask again with a new quote.',
    },
    {
      scenario:
        'A Ride API task dies after writing the ride row and before putting its message on the queue.',
      impact:
        'A ride is matching and nothing is working on it. The rider’s app shows it searching.',
      detection:
        'The count of rides the sweeper had to end as expired, which is normally close to zero. Each of them is also a late search, and late searches are alarmed at 0.05% of requests.',
      recovery:
        'The app gets no answer and repeats the request; the repeat finds the row and sends the message. If the app never retries, the sweeper ends the ride as expired with the reason timeout from 90 seconds after the request, within one 15-second pass.',
    },
    {
      scenario: 'The sweeper task is down.',
      impact:
        'No payment is queued, and no overdue ride is closed. Trips still start and end normally. Nothing is lost: pending payments and due times stay on their rows.',
      detection:
        'The age of the oldest overdue ride, which the sweeper publishes on every pass, is alarmed at 60 seconds with missing data counted as breaching, so a dead sweeper fires the alarm by its silence, a few minutes after its last pass, once no real data point is left in the alarm’s evaluation range.',
      recovery:
        'The container service starts a new task, which reads every shard of the due index oldest first and catches up. A ride handled by both the old and the new task is written once, because each write checks the state and the due time it read, and a payment queued twice is one charge.',
    },
    {
      scenario: 'The payment provider is down or slow for an hour.',
      impact:
        'Completed rides are not charged for that hour. Trips, matching and drop-offs are unaffected, because nothing in a request waits on the provider.',
      detection:
        'The share of failed or unanswered charge calls and the breaker state, published by the payment workers, and the age of the oldest message on the payment queue, which comes from the queue itself and shows workers that have stopped receiving: a failed attempt puts a new copy on the queue, whose age starts over.',
      recovery:
        'A call that fails becomes a delayed copy of its message, with a delay that doubles from 30 seconds to 15 minutes, and the original is deleted, so no receive count is used up. A task whose calls keep failing opens its breaker, stops receiving and tries one message every 30 seconds. When the provider answers, the backlog, up to 1.44 million payments after an hour at peak, drains, and a charge that the provider had accepted before failing to answer is returned as the same charge because of the idempotency key. Only a payment still failing 24 hours after its drop-off ends as failed with the reason provider unavailable.',
    },
    {
      scenario: 'A driver’s phone dies during a trip and never comes back.',
      impact:
        'The ride stays in progress and the driver stays busy, so they get no offers, which is right for as long as the trip may still be going on.',
      detection:
        'The ride’s due time, four times the quoted trip time plus one hour after the pickup. Rides moved to review are counted by the sweeper.',
      recovery:
        'The sweeper moves the ride to review and frees the driver in one transaction. Nothing is charged; support decides what happens to the fare. A drop-off that arrives afterwards is answered 409 with the state of the ride.',
    },
    {
      scenario: 'The rides or drivers table throttles or is unavailable.',
      impact:
        'New requests are refused with 503, so nothing is accepted that cannot be stored. Offers, accepts, pickups and drop-offs fail and are retried by the apps. Positions keep flowing, because the location service does not touch the tables.',
      detection:
        'ThrottledRequests and SystemErrors on the tables, the error ratio on the Ride API’s load balancer, and the backlog of visible messages on the match queue.',
      recovery:
        'A matcher whose table calls fail leaves the message it holds, which returns after 30 seconds, and stops receiving until one message tried every 30 seconds succeeds, so messages wait in the queue without using up receives. Payment workers send delayed copies. When the table answers, rides that are past their 60 seconds are ended as expired and the rest go on. A drop-off that could not be written is repeated by the driver’s app until it is.',
    },
    {
      scenario: 'A malformed message makes every matcher that receives it crash.',
      impact:
        'The message returns every 30 seconds and kills a task each time. Its ride gets no offers.',
      detection:
        'After 40 receives, about 20 minutes, the queue moves it to the dead-letter queue, and the alarm on that queue’s visible messages fires on the first one.',
      recovery:
        'The ride itself was ended as expired by the sweeper long before, from 90 seconds after the request. A person reads the message and fixes the matcher. The message can then be deleted, or redriven, in which case the matcher finds the ride ended and deletes it. The alarm returns to OK when the dead-letter queue is empty.',
    },
    {
      scenario: 'The route service is slow or down.',
      impact:
        'Quotes are less accurate and rankings fall back to straight-line distance. No request fails because of it.',
      detection:
        'The share of quotes and rankings that used the fallback, published by the Ride API and the matchers, and the target response time on the route service’s load balancer.',
      recovery:
        'Both callers give up after 300 ms and use the fallback. When the service answers in time again, the next quote and the next ranking use it. Fares quoted meanwhile stay as they were stored.',
    },
  ],
  capacity: {
    assumptions: [
      '1 million drivers online at peak, each sending a position every 5 seconds whether available or busy.',
      'About 8.6 million ride requests a day, with a peak 4 times the average, and about 5 quotes for every request.',
      'A ride lasts 15 minutes on average from acceptance to drop-off: about 5 to the pickup and 10 for the trip.',
      '4 in 5 offers are accepted. Of the offers that are not, half are declined and half get no answer.',
      'A match takes about 10 seconds on average, counting the rides that need a second offer.',
      'A ride row is at most 1 KB, so a plain write costs 1 write unit, a write inside a transaction costs 2, and an eventually consistent read costs half a read unit.',
      'A position in the index takes about 100 bytes, and a shard is planned for 150,000 commands a second, a planning figure to confirm with a load test and not a limit of the service.',
      'A charge at the payment provider takes about 300 ms.',
      'The stadium case: 20,000 requests in 5 minutes around a few cells with about 300 available drivers.',
    ],
    estimates: [
      {
        label: 'Position updates',
        value: '200,000 per second',
        math: '1,000,000 drivers ÷ 5 s.',
      },
      {
        label: 'Ride requests',
        value: '~8.6M a day, 100 per second on average, 400 at peak',
        math: '100/s × 86,400 s = 8.64M. Peak is 4 × 100/s. Quotes: 400/s × 5 = 2,000/s.',
      },
      {
        label: 'Open rides and busy drivers',
        value: '360,000 at peak, so 640,000 drivers available',
        math: '400/s × 15 min × 60 s = 360,000 rides between acceptance and drop-off, one driver each. 1,000,000 − 360,000 = 640,000.',
      },
      {
        label: 'Geo index commands',
        value: '640,000 per second, 80,000 per shard; at most 1,000,000 and 125,000',
        math: 'A stored update is 5 commands: MULTI, GEOADD, EXPIRE and EXEC on the cell key, and the GET of the hint. Only available drivers are stored, and a busy update never reaches the index: 640,000 ÷ 5 s = 128,000 updates/s × 5 = 640,000/s; ÷ 8 shards = 80,000, 53% of the 150,000 planned per shard. If all 1,000,000 drivers were available: 200,000/s × 5 = 1,000,000/s, 125,000 per shard, 83% of the plan. The matchers add about 15,000 commands a second, about 2%, that the per-shard figure does not count: 9,000 GEOSEARCH, the EXISTS on each candidate’s hint and 500 SET of a hint.',
      },
      {
        label: 'Geo index memory',
        value: '~260 MB',
        math: 'A key expires 30 seconds after its last write, so the current bucket and the three before it are alive: 640,000 stored positions × 4 buckets × 100 bytes = about 260 MB, 400 MB if every driver were available. The shards are sized for commands, not for memory.',
      },
      {
        label: 'Hottest key',
        value: '1,000 writes per second',
        math: 'A cell with 5,000 available drivers ÷ 5 s. One city in one key would be 100,000 drivers ÷ 5 s = 20,000 writes a second on a single shard.',
      },
      {
        label: 'Offers',
        value: '500 per second, 50 of them never answered',
        math: '400 rides/s ÷ 0.8 accepted = 500 offers/s. 100/s are not accepted: 50 declined and 50 unanswered, 10% of all offers.',
      },
      {
        label: 'Matcher passes',
        value: '~1,000 per second, 9,000 searches per second',
        math: '500 passes/s that make an offer, and about as many wake-ups that find the ride already accepted or an offer still out. 500 × 18 searches = 9,000/s. The pool is sized for 2,500 passes/s.',
      },
      {
        label: 'Time to match',
        value: '~8 s typical, 4,000 rides searching at once',
        math: 'About 0.5 s to the first offer + 2.5 s on average until the driver’s next position update + about 5 s to decide = 8 s. With second offers the average is about 10 s: 400/s × 10 s = 4,000.',
      },
      {
        label: 'Status polls',
        value: '50,000 per second, 25,000 read units',
        math: 'Matching: 4,000 rides ÷ 2 s = 2,000/s. Afterwards: 360,000 rides × 2 apps ÷ 15 s = 48,000/s. 50,000 × 0.5 read units = 25,000.',
      },
      {
        label: 'Ride API at peak',
        value: '~54,000 requests per second',
        math: '50,000 polls + 2,000 quotes + 400 requests + 1,250 calls from drivers (400 accepts, 50 declines, 400 pickups, 400 drop-offs) = 53,650.',
      },
      {
        label: 'Table writes at peak',
        value:
          '~4,200 write units per second on the rides table, ~4,000 on its due index, ~2,600 on the drivers table, 2,000 on the fares table',
        math: 'Per ride on the rides table: request 1 + offers 1.25 × 2 + accept 2 + pickup 1 + drop-off 2 + queued 1 + charged 1 = 10.5. Drivers table: offers 1.25 × 2 + accept 2 + drop-off 2 = 6.5. Due index: 1 to enter + 4 changes of the due time × 2 + 1 to leave = 10. Each × 400/s. Fares: one write per quote. Declines, cancels and refused transactions add about one more unit per ride and are not counted.',
      },
      {
        label: 'Due index per shard',
        value: '125 write units per second per shard value',
        math: '4,000 ÷ 32 shard values, an eighth of the 1,000 write units a second that one partition takes.',
      },
      {
        label: 'Sweeper pass',
        value: '~6,000 rides per pass, ~190 per shard',
        math: '400 payments/s become due × 15 s = 6,000; ÷ 32 = 187.5. Each is one entry in a batch of 10 and one update.',
      },
      {
        label: 'Payments',
        value: '120 calls in flight; up to 1.44M waiting after an hour without the provider',
        math: '400/s × 0.3 s = 120. 400/s × 3,600 s = 1.44M.',
      },
      {
        label: 'Hot area',
        value: '67 requests per second, 4,000 rides searching, 800 extra passes per second',
        math: '20,000 ÷ 300 s ≈ 67/s. Each searches for 60 s: 67 × 60 ≈ 4,000 at once, one pass every 5 s = 800 passes/s and 800 × 18 = 14,400 searches/s. With the normal 1,000 passes that is 1,800 of the 2,500 the pool is sized for.',
      },
      {
        label: 'Match messages in flight',
        value: '~8,400, about 12,400 with the hot area',
        math: 'A message is in flight from its first receive until a matcher deletes it. An offer hides its message for 16 s, and the message is deleted only on its next receive, even when the driver accepted sooner: 500 offers/s × 16 s = 8,000. The first message of a declined offer also waits beside the second, about 8 s for 50 declines/s: 400 more, 8,400 in all. The stadium’s 4,000 searching rides keep one message each in flight: about 12,400. A standard queue allows about 120,000.',
      },
      {
        label: 'Rides stored',
        value: '~8.6 GB a day, ~3.2 TB a year',
        math: '8.64M × 1 KB = 8.64 GB/day; × 365 ≈ 3,150 GB.',
      },
    ],
    implications: [
      'Positions are 200,000 writes a second of values that live 5 seconds, 500 times the rate of ride requests. That gap is why they get their own service, their own load balancer and an in-memory store, and why nothing durable is ever written per position.',
      'The index needs about 260 MB, so memory never decides its size. Commands do: at peak the 8 shards run at 53% of their planned rate, which leaves room for the hot area’s searches, about 14,400 a second more on one shard at worst. If every online driver were available the same shards would run at 83%, still under the plan and with little to spare.',
      'A cell is a key, and a key lives on one shard. 5 km cells keep the hottest key near 1,000 writes a second, where one key per city would put 20,000 on a single shard that cannot be split.',
      'The largest load on the Ride API is not rides but polls: 50,000 of its 54,000 requests a second and 25,000 read units on the rides table, against a default table quota of 40,000 and the 12,000 reads a second that a new on-demand table sustains, so the table is pre-warmed for reads as well as for writes. It is the first thing that stops fitting.',
      'An offer is a transaction of 4 write units and there are 500 a second, which is small next to what it buys: no lock service and no timing assumption for who gets a driver.',
      'The due index takes about as many write units as the rides table itself, 4,000 a second, because each change of a due time is a delete and a put. 32 shard values keep each one at 125 a second, far from a partition’s limit, and the index must stay unthrottled because a throttled index throttles the table.',
      'A hot area nearly doubles the matcher’s passes, from 1,000 to 1,800 a second, and adds little to the API: its 4,000 searching rides are 2,000 more status polls a second and 67 requests a second, about 4% more traffic and about 1,000 read units. That is the whole point of the queue: waiting riders cost matcher passes every 5 seconds, not API workers.',
      'One load is in none of these figures: a driver who accepts stays in the current and the previous bucket for up to 20 seconds after their last available update, while their hint expires 15 seconds after the offer, so for some seconds a search can return a busy driver with no hint, and a pass in a hot area can spend its refused transactions, up to 3 at 4 write units each, on such drivers.',
      'One sweeper task handles 400 rides a second at peak. That is comfortable for one task and it is a single place to fail, which is why its own lag is alarmed with missing data counted as breaching.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one Region across three Availability Zones. The payment provider is outside AWS. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Ride API',
        service:
          'An Application Load Balancer that serves only this API, with AWS WAF, in front of Amazon ECS on AWS Fargate',
        why: 'A stateless service for quotes, ride requests, status reads and the drivers’ accept, decline, pickup and drop-off. Every write it makes is a conditional write or a transaction in DynamoDB, plus one queue send for a request or a decline.',
        watch:
          'ALB TargetResponseTime, RequestCount, HTTPCode_Target_5XX_Count and HTTPCode_ELB_5XX_Count; ECS CPUUtilization and MemoryUtilization. Custom: 409 answers to accept, quotes that used the fallback, and rides that left matching more than 80 s after the request.',
      },
      {
        part: 'Location service',
        service:
          'A second Application Load Balancer with AWS WAF, in front of its own Amazon ECS service on AWS Fargate',
        why: 'Takes 200,000 position updates a second and nothing else. Its own load balancer and tasks keep that traffic, which may be dropped, away from ride requests, which may not. It talks only to the geo index.',
        watch:
          'ALB RequestCount, TargetResponseTime, HTTPCode_Target_5XX_Count and HTTPCode_ELB_5XX_Count; ECS CPUUtilization. Custom: positions received by status, positions stored and index write failures.',
      },
      {
        part: 'Geo index and offer hints',
        service:
          'Amazon ElastiCache for Valkey, cluster mode enabled, 8 shards, each a primary and a replica in different Availability Zones with Multi-AZ',
        why: 'Geospatial sets hold the positions and plain keys hold the hints, all with an expiry. Keys spread over the shards by their hash, and a transaction on one key runs on one shard. Nothing here is the source of truth, so asynchronous replication and an occasional lost write are acceptable.',
        watch:
          'Per node: EngineCPUUtilization, GeoSpatialBasedCmds for the position writes, SuccessfulWriteRequestLatency, ReplicationLag on replicas, CurrConnections, DatabaseMemoryUsagePercentage and Evictions. GEOSEARCH is not in the documented list of commands that GeoSpatialBasedCmds sums, so searches are watched through the matchers’ own count.',
      },
      {
        part: 'Match queue',
        service:
          'An Amazon SQS standard queue with a 30 s visibility timeout and redrive after 40 receives to a dead-letter queue that keeps 14 days',
        why: 'Holds one message per ride request, and one more per decline, until a matcher finds the ride no longer matching. The visibility timeout is the offer timer: the matcher sets it per message to the time the offer expires. Standard queues deliver at least once and in no order, which the conditional writes already assume.',
        watch:
          'ApproximateNumberOfMessagesVisible, ApproximateNumberOfMessagesNotVisible and NumberOfMessagesSent. Not ApproximateAgeOfOldestMessage: a message here is received many times by design.',
      },
      {
        part: 'Matcher',
        service:
          'An Amazon ECS service on AWS Fargate that scales on ApproximateNumberOfMessagesVisible, sized for 2,500 passes a second',
        why: 'Each pass is short and holds nothing in memory between passes: read the ride, search, rank, one transaction, one hint, one change of visibility. Any task can take any message. A task whose calls to the tables keep failing stops receiving and tries one message every 30 seconds until one succeeds.',
        watch:
          'ECS CPUUtilization. Custom: time to the end of the first pass, passes and searches per second, refused reservations, offers that expired unanswered, rankings that used the fallback, rides ended by reason, and rides ended more than 80 s after the request.',
      },
      {
        part: 'Rides and drivers',
        service:
          'Amazon DynamoDB, on-demand: a rides table keyed by ride id with a global secondary index on sweep shard and due time, a drivers table keyed by driver id, and a fares table keyed by fare id with time to live',
        why: 'Conditional writes are every state change, a transaction across the ride and the driver is every offer, acceptance and ending, and a consistent read tells a handler what state a ride is in. The index is sparse: a ride is in it only while it has a due time.',
        watch:
          'ThrottledRequests, WriteKeyRangeThroughputThrottleEvents on the table and on the index, SystemErrors, TransactionConflict, ConditionalCheckFailedRequests, ConsumedWriteCapacityUnits, ConsumedReadCapacityUnits and SuccessfulRequestLatency.',
      },
      {
        part: 'Route service',
        service:
          'An internal Application Load Balancer in front of an Amazon ECS service on AWS Fargate that runs an open-source routing engine with the road graph in memory',
        why: 'Answers distance and travel time for quotes and for ranking the 5 nearest drivers. Replicas are stateless and interchangeable, and both callers fall back to straight-line distance after 300 ms, so this service can fail without stopping rides.',
        watch:
          'ALB TargetResponseTime and HTTPCode_Target_5XX_Count; ECS CPUUtilization and MemoryUtilization.',
      },
      {
        part: 'Sweeper',
        service: 'One Amazon ECS task on AWS Fargate, restarted by the service if it stops',
        why: 'Every 15 seconds it queries the 32 shard values of the due index in parallel and applies what is overdue with conditional writes: it queues pending payments and closes rides and payments past their deadline. One task is enough at 400 rides a second.',
        watch:
          'Custom, published on every pass, also when it is zero: the age of the oldest overdue ride, rides handled by kind, and rides it had to end as expired, each of which is also a late search.',
      },
      {
        part: 'Payment queue and payment worker',
        service:
          'An Amazon SQS standard queue with a 60 s visibility timeout, 4 days of retention and redrive after 5 receives to a dead-letter queue that keeps 14 days; an Amazon ECS service on AWS Fargate; a payment provider outside AWS',
        why: 'The queue holds completed rides through a provider outage. Each worker task has its own circuit breaker and sends a delayed copy when a call fails, so only a message that crashes workers is ever received 5 times.',
        watch:
          'ApproximateAgeOfOldestMessage, ApproximateNumberOfMessagesVisible and ApproximateNumberOfMessagesDelayed on the queue. Custom: charge calls by outcome, breaker state, and time from drop-off to result.',
      },
      {
        part: 'Security',
        service:
          'AWS WAF on the two public load balancers, AWS Secrets Manager, AWS KMS, IAM roles per service, AWS CloudTrail',
        why: 'Riders and drivers present short-lived tokens, and the caller’s id always comes from the token. A driver can act only on a ride that names them in its offer or as its driver. The card is a token held by the payment provider, and its key is read from Secrets Manager by the payment workers alone. Tables, queues and the in-memory store are encrypted, each role reaches only its own resources, and the location service has no access to the tables.',
        watch: 'WAF blocked requests per rule, and CloudTrail events for reads of the secret.',
      },
      {
        part: 'Observability',
        service: 'Amazon CloudWatch dashboards and alarms; ElastiCache events through Amazon SNS',
        why: 'The alarms that protect an objective read metrics that the load balancers and the queues publish, which do not depend on the tasks they watch. Alarms on a metric that a task publishes about itself treat missing data as breaching where silence means trouble.',
        watch: 'The objectives below, and the two dead-letter queues, which should be empty.',
      },
    ],
    limits: [
      'An SQS visibility timeout is 30 seconds by default and at most 12 hours, counted from the first receive. ChangeMessageVisibility takes 0 to 43,200 seconds, and the next receive of the message starts again from the queue’s default.',
      'A standard SQS queue allows about 120,000 messages in flight, received and not yet deleted. The match queue keeps a message in flight from its first receive until the wake-up that finds its ride no longer matching, about 12,400 at the worst moment here.',
      'SQS raises the receive count on every receive, and the redrive policy moves a message after the configured number. The match queue’s number is 40 because a healthy message is received again on every wake-up.',
      'An SQS message can be delayed by at most 15 minutes, which caps the backoff of a delayed payment copy, and is at most 1 MiB. Messages here hold a ride id.',
      'SQS keeps a message 4 days by default and 14 at most. In a standard queue a message moved to a dead-letter queue keeps its original enqueue time, so the dead-letter queues keep 14 days.',
      'SendMessageBatch takes up to 10 messages and reports each entry on its own, so the sweeper marks as queued only the rides whose entry succeeded.',
      'ApproximateAgeOfOldestMessage leaves out a message that was received three or more times without being deleted, also with a redrive policy in place. Match messages are received many times, so that queue is watched by its visible count, and dead-letter queues by ApproximateNumberOfMessagesVisible.',
      'SQS metrics arrive once a minute, and a queue that has been idle can take up to 15 minutes to report again. The match and payment queues are polled all the time; a dead-letter queue is idle, so its alarm can lag by that much.',
      'A CloudWatch alarm reads more data points than its evaluation periods, a span called the evaluation range, and every real data point in that range is used before a missing one is filled in. So an alarm that counts missing data as breaching fires on silence only once the last real data point has left the range, and one that counts it as not breaching returns to OK only once the breaching points have left it. CloudWatch gives no fixed size for the range, only that it depends on the alarm’s period and the metric’s resolution, so those delays are written here as a few minutes.',
      'A DynamoDB transaction changes up to 100 items and 4 MB as all or nothing, cannot touch the same item twice, and costs two writes per item. DynamoDB states that this capacity is consumed even when a transaction does not succeed, as when it is cancelled because a condition failed.',
      'DynamoDB isolates a transaction from other transactions and from single writes on the same items as if they ran one after another. Two that overlap on an item can be cancelled as a conflict, counted in TransactionConflict.',
      'A DynamoDB partition takes 1,000 write units and 3,000 read units a second. A new on-demand table sustains 4,000 writes and 12,000 reads a second until its warm throughput is raised. The polls alone need 25,000 read units, so the rides table and its index are pre-warmed before launch, for reads as well as for writes.',
      'A DynamoDB on-demand table, and each of its global secondary indexes, has a default quota of 40,000 read and 40,000 write request units a second, which can be raised on request. The polls use 25,000 read units of it.',
      'A global secondary index is updated asynchronously and can only be read with eventual consistency. Changing an indexed key attribute costs two index writes, a delete and a put, and an index that is throttled throttles writes to its table.',
      'DynamoDB time to live deletes an item within a few days of its expiry, not at it. A fare is checked against its own expiry field, never against whether the row still exists.',
      'ElastiCache replication is asynchronous. With Multi-AZ, a failed primary is replaced by the replica with the least lag, and writes can resume typically within a few seconds; the last writes before the failure can be missing.',
      'ElastiCache publishes metrics per node. EngineCPUUtilization is the one to alarm on for nodes with 4 or more vCPUs, and CPUUtilization for nodes with 2 or fewer. GeoSpatialBasedCmds is documented as the sum of geoadd, geodist, geohash, geopos, georadius and georadiusbymember, a list without GEOSEARCH, so the matchers publish their own count of searches. Failover events arrive through Amazon SNS.',
      'An ElastiCache cluster with cluster mode enabled has a default quota of 90 nodes. 8 shards of 2 nodes are 16.',
      'The store can expire a key but not a single member of a geospatial set, which is why positions are grouped into keys that expire as a whole.',
      'HTTPCode_Target_5XX_Count leaves out the 5xx that the load balancer generates itself, and HTTPCode_ELB_5XX_Count exists per load balancer and is reported only in minutes that have one. Each service therefore has its own load balancer, and an error ratio adds both counts with an absent count read as zero. RequestCount counts only requests for which a target was chosen, so the ratio is missing only when RequestCount is, and that case counts as breaching.',
      'AWS WAF attaches to an Application Load Balancer and not to a Network Load Balancer, one reason both public entry points are Application Load Balancers.',
    ],
  },
  slos: [
    {
      objective: 'Ride API',
      target: '99.9% of requests answered within 500 ms and without a 5xx, over 28 days',
      measure:
        'On the Ride API’s own load balancer: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount for errors, and TargetResponseTime for latency. An absent 5XX count is read as zero. The ratio is missing only when RequestCount is, and such a minute counts as failed. The usual p95 is 60 ms.',
    },
    {
      objective: 'Position updates',
      target: '99.5% of updates from available drivers stored in the index, over 28 days',
      measure:
        'Positions stored over positions received with the status available, both published by the location service, together with the error ratio on its own load balancer for the updates that never reached a task. Updates with the status busy are answered without being stored and are in neither count.',
    },
    {
      objective: 'First offer',
      target:
        '99% of ride requests have their first matcher pass finished, with an offer made or no candidate found, within 2 s of the request, over 28 days',
      measure:
        'The end of the first pass minus the request time on each ride, published by the matchers as a percentile, together with their count of rides whose first pass ended within 2 s; the usual p99 is 1 s. The share is that count over the Ride API’s count of requests, so a ride that leaves matching without a first pass is a miss with no handler having to report it, also when the rider cancelled it first, which is rare. The independent signal is ApproximateNumberOfMessagesVisible on the match queue, from SQS.',
    },
    {
      objective: 'Search ends on time',
      target:
        '99.9% of ride requests leave matching, as accepted, cancelled or expired, within 80 s of the request, over 28 days',
      measure:
        'The time a ride left matching minus its request time, published by the handler that made the change: the Ride API on an accept or a cancel, a matcher on an expiry, the sweeper on its backstop. A ride over 80 s is a miss, and the Ride API counts requests. A healthy search ends within about 76 s. A matcher crash after a late offer, or a backlog on the last wake-up, ends it later, at about 90 s after a crash, and every ride the sweeper ends, from 90 s, is a miss.',
    },
    {
      objective: 'Payment',
      target:
        '99% of completed rides charged, or failed with a reason, within 10 min of the drop-off, over 28 days',
      measure:
        'Result time minus completion time on each ride, published by whoever records the result: the payment workers, or the sweeper for a payment it closes as failed at 25 hours, which is a miss. The share is taken over completed rides, which the Ride API counts on the drop-off. The usual time is about 20 s. The independent signals are ApproximateAgeOfOldestMessage on the payment queue and the sweeper’s lag.',
    },
    {
      objective: 'Due times',
      target: '99.9% of due times applied within 5 min of falling due, over 28 days',
      measure:
        'The time a ride is handled minus its due time, and the age of the oldest overdue ride at the start of each pass, both published by the sweeper. The usual worst case is one 15-second pass.',
    },
    {
      objective: 'Dead letters',
      target: 'Every dead letter read and closed or redriven within 4 hours, over 28 days',
      measure:
        'ApproximateNumberOfMessagesVisible on each of the two dead-letter queues over time: how long it stays above zero.',
    },
  ],
  alarms: [
    {
      name: 'Ride API errors',
      metric:
        'On the Ride API’s own ALB, each over one 5-minute window: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount above 0.04%, with an absent 5XX count read as zero and a missing ratio counted as breaching, or p99.96 TargetResponseTime above 300 ms. The load balancer publishes these, not the API',
      meaning:
        'Requests, polls or driver calls are failing or slow: tasks are down or too few, or the tables are throttling. Each clause lets through at most 0.04% of requests, so both together stay inside the 0.1% the target allows, and 300 ms is tighter than the 500 ms target. The ratio is missing only when RequestCount is, as when no task is registered, and that fires the alarm too. The apps repeat their calls, and every one of them is safe to repeat.',
    },
    {
      name: 'Positions failing',
      metric:
        'Over one 5-minute window: index write failures above 0.2% of positions received with the status available, a custom metric from the location service with missing data counted as breaching, or (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount above 0.2% on the location ALB, with an absent 5XX count read as zero and a missing ratio counted as breaching',
      meaning:
        'Drivers are disappearing from the index: a shard is failing over, the store is overloaded, or location tasks are down. The first clause is measured against available updates only, like the target. The load balancer cannot tell available from busy, and its errors fall on both alike. The two clauses together allow 0.4%, inside the 0.5% the target leaves. A failover of one shard that takes 10 seconds loses an eighth of the writes for that time, about 0.4% of a 5-minute window, so it fires once and clears on the next window; an outage that lasts keeps it firing. If every task is dead the custom metric is silent and both clauses fire by missing data.',
    },
    {
      name: 'Match backlog',
      metric:
        'SQS ApproximateNumberOfMessagesVisible on the match queue above 800 for 2 consecutive 1-minute periods; missing data is not breaching: the API writes to this queue all the time, so it always reports',
      meaning:
        'Messages are waiting for a matcher: the pool is down, too small for a crowd, or blocked on the tables. At the normal peak of 1,000 passes a second, 800 waiting messages are 0.8 seconds of delay, under the 2-second target. The number comes from the queue, so it works with every matcher dead; the queue reports once a minute, so it fires a minute or two after the pool falls behind.',
    },
    {
      name: 'First offer slow',
      metric:
        'Custom, from the matchers: p99 of the time from request to the end of the first pass above 1.5 s for 3 consecutive 1-minute periods; missing data is not breaching',
      meaning:
        'The first pass is taking too long while matchers are running: the geo index, the route service or the tables are slow. It fires at 1.5 seconds, before the 2-second target. Matchers publish it, so if they are all down it is silent and Match backlog fires from the queue.',
    },
    {
      name: 'Offers not answered',
      metric:
        'Custom, from the matchers: offers found expired with no answer above 30% of offers made, for 5 minutes; missing data is not breaching',
      meaning:
        'Normal is about 10%. Three times that means offers are not reaching phones: hints are being lost, the location service is not returning them, or matchers are crashing after the commit. Riders wait 15 seconds per lost offer. Check the geo index and the location service first.',
    },
    {
      name: 'Searches ending late',
      metric:
        'Custom, from the Ride API, the matchers and the sweeper: rides that left matching more than 80 s after the request, above 0.05% of ride requests over 5 minutes; missing data is not breaching, because Match backlog covers matchers that are down and Sweeper behind covers a silent sweeper',
      meaning:
        'Searches are outliving their time. The late rides the sweeper ended, which it also counts on its own, reached their 90-second backstop with nothing working on them: requests are dying between the row and the queue, or match messages are being lost or poisoned. Late rides ended by a matcher or by an accept mean wake-ups are arriving late: a backlog, or matchers crashing after an offer. It fires at half of the 0.1% the target allows, and it returns to OK by itself when new requests are matched normally again.',
    },
    {
      name: 'Sweeper behind',
      metric:
        'Custom, from the sweeper on every pass: age of the oldest overdue ride above 60 s for one 1-minute period; missing data counts as breaching',
      meaning:
        'Due times are not being applied: payments are not being queued and stuck rides are not being closed. A sweeper that runs and falls behind fires it within about 2 minutes, before the 5-minute target for due times and the 10-minute target for payments. The sweeper publishes this about itself, so a dead task publishes nothing, and the alarm then fires a few minutes after the last pass, once no real data point is left in its evaluation range. That is not promised before the 5-minute target for due times: for a dead task the alarm protects the 10-minute target for payments and the 28-day budget.',
    },
    {
      name: 'Payments late',
      metric:
        'SQS ApproximateAgeOfOldestMessage (maximum) on the payment queue above 3 min for 2 consecutive 1-minute periods; missing data is not breaching, because an empty queue has no age',
      meaning:
        'Payments are queued and not being worked: the worker pool is down or too small, or its breakers are open because the provider is failing. It fires at 3 minutes of waiting, before the 10-minute target, and it comes from the queue, so it works with every worker dead. A failed charge is sent again as a new delayed copy, so a message’s age starts over on every attempt: the age shows a pool that is not receiving, and charges that keep failing while the workers run are seen in the workers’ time from drop-off to result and in the Payment objective.',
    },
    {
      name: 'Payment provider failing',
      metric:
        'Custom, from the payment workers: failed or unanswered charge calls above 20% for 2 minutes, or more than half of the pool’s breakers open; missing data is not breaching',
      meaning:
        'The provider is down, throttling or rejecting our credentials. Charges wait as delayed copies and nothing fails before 24 hours. Workers publish this, so if they are down this alarm is silent and Payments late fires from the queue.',
    },
    {
      name: 'Dead letters',
      metric:
        'SQS ApproximateNumberOfMessagesVisible above 0 on the match dead-letter queue or the payment dead-letter queue',
      meaning:
        'A message crashed its consumer 40 times on the match queue or 5 times on the payment queue. It pages on the first one, far inside the 4-hour target, though an idle queue can take up to 15 minutes to report. The count is used because the age metric can leave such messages out. It returns to OK when the queue is empty: after the fix, a redrive sends the messages back to their source queue, where a match message finds its ride ended and is deleted, and a payment message is charged, or recorded as failed if 24 hours have passed.',
    },
    {
      name: 'Geo shard under pressure',
      metric:
        'ElastiCache EngineCPUUtilization above 70% on any primary node of the geo index for 5 minutes',
      meaning:
        'A shard is close to what its engine thread can do, usually because a few very hot cells landed on it or the cluster needs another shard. Writes are about to slow down and positions to be dropped. The metric is per node, so the alarm is defined on each primary.',
    },
    {
      name: 'Table throttling',
      metric:
        'DynamoDB ThrottledRequests above 0 for 1 minute, summed over the operations the services use (GetItem, Query, PutItem, UpdateItem and TransactWriteItems) on the rides table or on the drivers table; missing data is not breaching, because the metric has a data point only in a minute with a throttled request',
      meaning:
        'Polls, offers, accepts or drop-offs are being refused and retried. Usually a table or the due index whose warm throughput was not raised, for reads, where the polls are the load, or for writes; WriteKeyRangeThroughputThrottleEvents above 0 on the due index says one shard value is too hot, and the fix is more shard values. It returns to OK a few minutes after the last throttled request, once that data point has left the alarm’s evaluation range.',
    },
  ],
  evolution: {
    mvp: 'One city. A single in-memory node with a replica holds the geo index, with the cell and bucket keys from the first day because they cost nothing extra. One Ride API service also takes the position updates. The match queue, the offer and accept transactions, the due times with a single sweeper, and the payment keyed by ride id are all in the first version: they are what keeps a driver on one ride and a rider charged once, and neither can be added after it has gone wrong. Left out at first: the route service, replaced by straight-line distance times 1.3 for both quotes and ranking, and the separate load balancer for positions.',
    atScale: [
      'At 10x (2 million position updates a second, 4,000 requests a second), polling comes first: 500,000 reads a second is more than any reasonable quota on one table. Phones keep a connection open, the Ride API pushes each change of a ride once, and a slow poll remains as the fallback. Offers travel on the same connection, which also removes the wait for the next position update.',
      'At 10x, the geo index grows from 8 to about 80 shards, past the default quota of 90 nodes per cluster once replicas are counted, so the quota is raised or the index is split into one cluster per group of cities. Drivers who are standing still report less often, which cuts the write rate without hurting matching.',
      'At 10x, the sweeper handles 4,000 rides a second and one task is no longer enough. The due index goes from 32 to 256 shard values, and several sweeper tasks each hold a lease on a range of them, taken with a conditional write.',
      'At 10x, one city’s event can be larger than the whole matcher pool’s headroom, so the match queue and the matcher pool are split per city, each scaling by itself.',
      'At 100x, one Region is too far from most cities and too large to fail at once. Each group of cities runs the whole design in its own Region: a ride belongs to the Region of its pickup, a driver to the Region they are driving in, and no transaction crosses Regions.',
    ],
    firstBottleneck:
      'Status polling. It is 50,000 of the Ride API’s 54,000 requests a second and 25,000 read units a second on the rides table, already more than half of the table’s default quota of 40,000, and it grows with the number of open rides, not with the number of requests. The second is the single sweeper task, in availability before throughput: everything that is due waits while it is down.',
    avoided: [
      'A persistent connection to every phone. Polling and the answer to the position update need no connection registry and survive any restart. Worth adding when the 2.5 seconds an offer waits on average, or the read load of polling, costs more than running a million connections.',
      'A lock service for drivers. The offer slot on the driver row does the same job inside the transaction that needs it. Worth revisiting only if offers outgrow what transactions on the drivers table can take.',
      'Surge pricing. A fixed-rate fare keeps pricing out of the matching path. Worth adding as a multiplier per cell at quote time when turning riders away is worse for the product than charging more.',
      'Matching many rides and drivers together in batches. One ride at a time is simple and good enough when drivers are plentiful. Worth adding when average pickup times in dense areas matter more than the seconds a batch has to wait.',
      'A waiting list per cell that serves riders in order. A bounded search and an honest answer are simpler. Worth adding if fairness in crowded areas becomes a complaint.',
      'A stream of every position for history. Matching needs only the latest one. Worth adding beside the index when trip history, disputes or analytics need the path a car took.',
      'Holding the fare on the card at request time. It adds a call to the payment provider before every ride and a release on every cancellation. Worth adding when declined cards after the trip cost more than that.',
      'Finding a new driver automatically after a driver cancels. The ride ends and the rider asks again. Worth adding when the extra quote and request are a visible drop in completed rides.',
      'A queue and a matcher pool per city. One of each is less to run. Worth adding when one city’s crowd slows first offers in another.',
    ],
  },
};
