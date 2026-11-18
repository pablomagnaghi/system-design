import type { Design } from '../types';

export const localDelivery: Design = {
  slug: 'local-delivery',
  title: 'Local delivery',
  summary:
    'Show each customer only the items that a nearby warehouse can deliver to them within the hour, keep stock per warehouse, and take orders without ever selling a unit twice, while availability reads outnumber orders by a wide margin.',
  difficulty: 'Medium',
  minutes: 9,
  requirements: {
    functional: [
      'Show the items available for delivery to an address within a set time, such as one hour.',
      'Place an order with several items, served from one or more nearby warehouses.',
      'Warehouses update their stock as goods arrive, are picked or are written off.',
    ],
    nonFunctional: [
      'Availability answers in about a hundred milliseconds; browsing outnumbers ordering by ten to a hundred to one.',
      'Never sell more units than the recorded stock; the shelf itself can differ from the record, and short picks handle that.',
      'On the order of ten thousand warehouses, a few thousand items each and millions of orders a day.',
      'Availability may lag stock by seconds; the order is where correctness is enforced.',
    ],
    outOfScope: ['Courier dispatch and routing.', 'Catalog management and pricing.'],
  },
  entities: [
    {
      name: 'Warehouse',
      description: 'A small fulfillment center with a location, opening hours and region.',
    },
    {
      name: 'Item',
      description: 'A catalog product: name, price and category.',
    },
    {
      name: 'Inventory',
      description: 'Units of one item on the shelf at one warehouse, one row per pair.',
    },
    {
      name: 'Order',
      description:
        'Customer, address, status and lines, each line naming the item, quantity and warehouse.',
    },
  ],
  api: [
    {
      method: 'GET',
      path: '/availability?lat=&lng=&category=&cursor=',
      description:
        'Items deliverable to that point in time, with whether each is in stock, paged with a cursor.',
    },
    {
      method: 'POST',
      path: '/orders',
      description:
        'Body: address, lines (item, quantity), idempotencyKey. Returns 201 with the order, or 409 with the lines that are no longer available.',
    },
    {
      method: 'GET',
      path: '/orders/{id}',
      description: 'Status of an order and the warehouses serving it.',
    },
  ],
  dataFlow: [
    'The app sends the delivery point; the service finds warehouses that can reach it in time.',
    'Stock for those warehouses is read from a short-lived cache, backed by read replicas.',
    'An order picks a warehouse per line and decrements every line in one transaction, only if enough units remain.',
    'Payment runs after the decrement; a failed payment returns the units.',
  ],
  highLevel: {
    label: 'Browse what is nearby, then order it',
    intro:
      'Follow a customer opening the app at their address to see what can arrive within the hour, then placing an order that must not take a unit someone else already bought. Watch browsing overload the inventory database, then see the cache, the replicas and the order path join as the design grows. Numbers are illustrative. Press play, or step through the stages.',
    lanes: { top: 'Browse availability', bottom: 'Place an order' },
    nodes: [
      {
        id: 'customer',
        title: 'Customer',
        detail: 'App with an address',
        column: 0,
        row: 'middle',
      },
      { id: 'gateway', title: 'API gateway', detail: 'Auth, routing', column: 1, row: 'middle' },
      { id: 'avail', title: 'Availability API', detail: 'Hot read path', column: 2, row: 'top' },
      {
        id: 'nearby',
        title: 'Reachable warehouses',
        detail: 'Radius, then time',
        column: 3,
        row: 'top',
      },
      {
        id: 'travel',
        title: 'Travel times',
        detail: 'Matrix, cached',
        column: 4,
        row: 'top',
        appearsAt: 1,
      },
      {
        id: 'cache',
        title: 'Availability cache',
        detail: 'Seconds old',
        column: 3,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'replica',
        title: 'Read replicas',
        detail: 'Inventory copies',
        column: 4,
        row: 'middle',
        appearsAt: 4,
      },
      {
        id: 'orders',
        title: 'Order API',
        detail: 'One transaction',
        column: 2,
        row: 'bottom',
        appearsAt: 5,
      },
      {
        id: 'payments',
        title: 'Payments',
        detail: 'After the hold',
        column: 3,
        row: 'bottom',
        appearsAt: 7,
      },
      {
        id: 'db',
        title: 'Inventory DB',
        detail: 'Stock and orders',
        column: 4,
        row: 'bottom',
        appearsAt: 2,
      },
      {
        id: 'warehouse',
        title: 'Warehouse app',
        detail: 'Restock, pick',
        column: 5,
        row: 'bottom',
        appearsAt: 8,
      },
    ],
    edges: [
      ['customer', 'gateway'],
      ['gateway', 'avail', 'browse'],
      ['avail', 'nearby'],
      ['nearby', 'travel', 'short list'],
      ['avail', 'cache'],
      ['cache', 'replica', 'miss'],
      ['db', 'replica', 'replicate'],
      ['gateway', 'orders', 'order'],
      ['orders', 'db', 'decrement'],
      ['orders', 'payments', 'charge'],
      ['warehouse', 'db', 'adjust'],
    ],
    stages: [
      {
        title: 'Prefilter warehouses by distance',
        narration:
          'The app sends the delivery point. Warehouses number in the thousands and rarely move, so their locations sit in memory, and a radius check keeps only the few within a generous straight-line distance.',
        tradeoff:
          'Asking a routing service about every warehouse would be accurate and slow and costly. A radius check is almost free and wrong at the edges, since a river or a highway can turn five kilometers into forty minutes, so it only narrows the list.',
        nodes: ['customer', 'gateway', 'avail', 'nearby'],
        travel: [
          ['customer', 'gateway'],
          ['gateway', 'avail', 'browse'],
          ['avail', 'nearby'],
        ],
        short: 'Prefilter',
        metrics: {
          users: '200K',
          requestsPerSecond: '2K',
          p95Latency: '120 ms',
          errorRate: '0.1%',
        },
        load: { avail: 20, nearby: 15 },
      },
      {
        title: 'Confirm with travel time',
        narration:
          'The short list goes to a travel-time service in one matrix call, with prep time added per warehouse. Results are cached per small map cell for a few minutes, because nearby addresses get the same answer.',
        tradeoff:
          'Caching by cell means two addresses at the far edges of a cell share one answer, and traffic changes are seen minutes late. In exchange most browses skip the routing call entirely; if the service is down, the radius is used with a safety margin.',
        nodes: ['nearby', 'travel'],
        travel: [['nearby', 'travel', 'short list']],
        short: 'Travel time',
        metrics: {
          users: '200K',
          requestsPerSecond: '2K',
          p95Latency: '150 ms',
          errorRate: '0.1%',
        },
        load: { nearby: 20, travel: 25 },
      },
      {
        title: 'Every browse reads the inventory database',
        narration:
          'At first the availability API reads stock for each reachable warehouse straight from the inventory database. Browsing outnumbers ordering by a hundred to one, so as customers grow the database spends its time answering reads, latency climbs and some browses time out.',
        tradeoff:
          'Reading the source of truth is always current, which is why it is tempting. But the same database must also take every order, so heavy browsing slows exactly the writes that earn money. Stock a few seconds old is good enough to show on a page.',
        nodes: ['avail', 'db'],
        travel: [],
        short: 'DB overload',
        metrics: {
          users: '2M',
          requestsPerSecond: '20K',
          p95Latency: '2.2 s',
          errorRate: '4%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { avail: 60, db: 96 },
        traffic: [{ edge: ['gateway', 'avail'], kind: 'failed' }],
      },
      {
        title: 'Read stock from the cache',
        narration:
          'A cache joins the read path. With the reachable warehouses known, the availability API reads their stock from a cache keyed by warehouse and merges it: an item is shown if any reachable warehouse has it. Entries live for a few seconds.',
        tradeoff:
          'Reading stock live on every browse would put the read load on the database that also takes orders. A cache a few seconds old serves almost every read, and the cost is that a customer sometimes sees an item that just sold out and learns it at checkout.',
        nodes: ['avail', 'cache'],
        travel: [['avail', 'cache']],
        short: 'Stock cache',
        metrics: { users: '2M', requestsPerSecond: '20K', p95Latency: '90 ms', errorRate: '0.2%' },
        load: { avail: 45, cache: 55, db: 40 },
      },
      {
        title: 'Fill misses from read replicas',
        narration:
          'A miss reads the warehouse stock from a read replica of the inventory database and refills the cache. Replicas trail the primary by a moment and take the read load off it. They still apply every order write through replication, so they scale reads, not writes.',
        tradeoff:
          'Reading misses from the primary would always be current and would compete with the transactions that matter most. Replicas add a small lag on top of the cache, which is acceptable because the order step checks stock again on the primary.',
        nodes: ['cache', 'replica', 'db'],
        travel: [
          ['cache', 'replica', 'miss'],
          ['db', 'replica', 'replicate'],
        ],
        short: 'Replicas',
        metrics: { users: '2M', requestsPerSecond: '20K', p95Latency: '80 ms', errorRate: '0.1%' },
        load: { cache: 50, replica: 30, db: 25 },
      },
      {
        title: 'Pick a warehouse for each line',
        narration:
          'At checkout the order API reruns the reachability check, then assigns lines to warehouses, preferring one warehouse that has everything and otherwise the fewest warehouses, since each one means a separate delivery.',
        tradeoff:
          'Choosing the closest warehouse per item gives the fastest single item and can split one basket into four deliveries. Minimizing warehouses first costs a slightly longer trip for some items and keeps the order cheap to deliver.',
        nodes: ['gateway', 'orders'],
        travel: [['gateway', 'orders', 'order']],
        short: 'Pick warehouse',
        metrics: { users: '2M', requestsPerSecond: '20K', p95Latency: '80 ms', errorRate: '0.1%' },
        load: { orders: 20 },
      },
      {
        title: 'Decrement every line in one transaction',
        narration:
          'For each line the order API decrements the stock row only if enough units remain, and inserts the order, all in one transaction on the primary. If any line finds too few units, the whole transaction rolls back and the customer sees which items ran out.',
        tradeoff:
          'A distributed lock per item would work and adds a lock service, timeouts and stuck locks to debug. Keeping stock and orders in one database makes the conditional decrement the guard; the cost is that each region is bound to one primary, which order volume easily fits.',
        nodes: ['orders', 'db'],
        travel: [['orders', 'db', 'decrement']],
        short: 'Decrement',
        metrics: { users: '2M', requestsPerSecond: '20K', p95Latency: '80 ms', errorRate: '0.1%' },
        load: { orders: 30, db: 35 },
      },
      {
        title: 'Charge after the decrement',
        narration:
          'With the units taken, the order API charges the customer using the idempotency key. On success the order is confirmed and goes to the warehouse for picking; on a declined charge a second transaction cancels the order and puts the units back, only if the order is still pending, so the units cannot be returned twice.',
        tradeoff:
          'Charging first would bill people for items that turn out to be gone. Decrementing first holds stock for the few seconds a payment takes, and the cost is a compensation step that must run even if the API crashes or the charge times out with an unknown result. A sweeper takes orders still pending past a deadline, asks the payment provider for the charge by its idempotency key, confirms the ones that were paid and releases only the ones that were not.',
        nodes: ['orders', 'payments', 'db'],
        travel: [
          ['orders', 'payments', 'charge'],
          ['orders', 'db', 'decrement'],
        ],
        short: 'Charge',
        metrics: { users: '2M', requestsPerSecond: '20K', p95Latency: '80 ms', errorRate: '0.1%' },
        load: { orders: 30, payments: 25, db: 35 },
      },
      {
        title: 'Warehouses keep counts honest',
        narration:
          'Staff record deliveries, picks and damaged goods in the warehouse app, which adjusts the same inventory rows. A picker who finds an empty shelf marks the line short, and the order offers a substitute or a refund.',
        tradeoff:
          'The database count is only as good as the shelf. Trusting it blindly means late surprises at picking; regular counts and short-pick handling cost staff time and keep the number customers see close to what is really there.',
        nodes: ['warehouse', 'db'],
        travel: [['warehouse', 'db', 'adjust']],
        short: 'Recount',
        metrics: { users: '2M', requestsPerSecond: '20K', p95Latency: '80 ms', errorRate: '0.1%' },
        load: { warehouse: 15, db: 30 },
      },
      {
        title: 'Partition by region',
        narration:
          'Every order touches warehouses near one address, so inventory and orders are split by metro region, each with its own primary and replicas. A city adding warehouses grows only its own partition.',
        tradeoff:
          'One global database is simpler to run and becomes the limit as cities are added. Regional partitions scale with the business; the cost is cross-region reporting, which moves to a separate analytics store.',
        nodes: ['db', 'replica', 'orders'],
        travel: [],
        short: 'By region',
        metrics: {
          users: '10M',
          requestsPerSecond: '100K',
          p95Latency: '80 ms',
          errorRate: '0.1%',
        },
        load: { db: 45, replica: 35, orders: 35 },
      },
    ],
  },
  deepDives: [
    {
      question: 'Which warehouses can deliver in time?',
      options: [
        {
          name: 'Straight-line radius only',
          pros: 'Instant and needs no outside service.',
          cons: 'Rivers, highways and traffic make it promise deliveries it cannot keep, or hide ones it could.',
        },
        {
          name: 'Travel time to every warehouse',
          pros: 'Accurate for every address.',
          cons: 'Thousands of routing calls per browse are slow and expensive.',
        },
        {
          name: 'Radius prefilter, then a cached travel-time matrix',
          pros: 'Accurate on a short list of a few warehouses, and cached per map cell for minutes.',
          cons: 'Edges of a cell share one answer, and traffic shows up a few minutes late.',
        },
      ],
      choice:
        'Prefilter by radius in memory, confirm with one matrix call, and cache by cell. If the routing service fails, fall back to a tighter radius rather than show nothing.',
    },
    {
      question: 'How do we avoid selling a unit twice?',
      options: [
        {
          name: 'Distributed lock per item and warehouse',
          pros: 'Works across separate stores for stock and orders.',
          cons: 'A lock service, lease timeouts and stuck locks to handle, and a multi-line order must take several locks.',
        },
        {
          name: 'Conditional decrement in one transaction',
          pros: 'The database applies "only if enough units remain" atomically for every line, and rolls back the whole basket on any failure.',
          cons: 'Stock and orders must live in the same database, and a very hot item queues on its row.',
        },
        {
          name: 'Soft reservation with a time limit at add to cart',
          pros: 'The customer knows early that the item is theirs.',
          cons: 'Abandoned carts hold stock that others could buy, and every hold needs an expiry job.',
        },
      ],
      choice:
        'A conditional decrement for every line in one transaction, with stock and orders in the same regional database. Load per row is a normal shopping rate, not a flash sale burst, so row contention is not a concern.',
    },
    {
      question: 'How do we keep availability fast at high read volume?',
      options: [
        {
          name: 'Query the primary on every browse',
          pros: 'Always exact.',
          cons: 'Browsing load lands on the database that takes orders and slows them down.',
        },
        {
          name: 'Cache per warehouse with a short TTL over read replicas',
          pros: 'Shared by every customer near that warehouse; most reads never reach a database.',
          cons: 'A few seconds of staleness, so some checkouts fail on items that just sold out.',
        },
        {
          name: 'Precomputed availability per map cell, updated from stock changes',
          pros: 'One read per browse, already merged across warehouses.',
          cons: 'Every stock change fans out to every cell that warehouse reaches, and the cells must be recomputed when travel times shift.',
        },
      ],
      choice:
        'Cache stock per warehouse for a few seconds over read replicas, and merge per request. The order transaction is the real check, so a little staleness on the read side only costs an occasional "sold out" at checkout.',
    },
  ],
  wrapUp:
    'Find reachable warehouses with a radius prefilter and a cached travel-time check, serve stock from a short-lived cache over read replicas, decrement every order line conditionally in one transaction on a regional primary, charge after the decrement with a compensating release that first checks the payment status, and let warehouse staff keep the counts honest.',
};
