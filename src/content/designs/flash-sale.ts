import type { Design } from '../types';

export const flashSale: Design = {
  slug: 'flash-sale',
  title: 'Flash sale',
  summary:
    'Sell a few thousand units to a million people who all click at the same second: absorb the burst at the edge, admit buyers at a pace the backend can take, decrement stock in memory without overselling, and turn every reservation into a durable order or give it back.',
  difficulty: 'Hard',
  requirements: {
    functional: [
      'A sale opens at a set time for a small number of items with limited stock.',
      'Buyers reserve a unit and then have a few minutes to pay.',
      'Each buyer can buy at most a fixed number of units.',
      'Unpaid reservations go back on sale.',
    ],
    nonFunctional: [
      'Never sell more units than exist, even under a burst of a million requests in the first seconds.',
      'Fair: an earlier or luckier buyer is not overtaken by someone with a faster script.',
      'Buyers get a clear answer quickly: in line, reserved, or sold out.',
      'The rest of the store keeps working while the sale runs.',
    ],
    outOfScope: ['Shipping and fulfillment.', 'Pricing and the catalog of the rest of the store.'],
  },
  entities: [
    {
      name: 'Sale',
      description: 'Item, start time, total stock and the limit per buyer.',
    },
    {
      name: 'Admission pass',
      description: 'A signed, short-lived token that lets one buyer reach checkout for one sale.',
    },
    {
      name: 'Reservation',
      description: 'A unit held for a buyer until a deadline: reserved, paid or expired.',
    },
    {
      name: 'Order',
      description: 'The durable record of a paid purchase, unique per sale and buyer.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/sales/{id}/queue',
      description:
        'Joins the waiting room. Returns a position, then an admission pass when admitted.',
    },
    {
      method: 'POST',
      path: '/sales/{id}/reservations',
      description:
        'Header: admission pass. Body: quantity, idempotencyKey. Returns 201 with a reservation and its deadline, or 410 when sold out.',
    },
    {
      method: 'POST',
      path: '/reservations/{id}/pay',
      description: 'Pays for a reservation before its deadline and turns it into an order.',
    },
  ],
  dataFlow: [
    'Buyers load a static sale page from the edge and join a waiting room before the start.',
    'The waiting room admits buyers at a fixed rate and hands each a signed pass.',
    'Checkout decrements an in-memory stock counter atomically and logs the reservation durably.',
    'The buyer pays before the deadline; unpaid reservations return their unit to the counter.',
  ],
  highLevel: {
    label: 'Run the first seconds of a sale',
    intro:
      'Follow one buyer through the rush at the moment a sale opens, from the waiting room to a paid order, and see what keeps stock exact when units are reserved and released. Press play, or step through the stages.',
    nodes: [
      { id: 'buyers', title: 'Buyers', detail: 'A million at once', column: 0, row: 'middle' },
      {
        id: 'edge',
        title: 'Edge + CDN',
        detail: 'Static page, bot checks',
        column: 1,
        row: 'middle',
      },
      {
        id: 'room',
        title: 'Waiting room',
        detail: 'Admits at a fixed rate',
        column: 2,
        row: 'middle',
      },
      { id: 'checkout', title: 'Checkout API', detail: 'Needs a pass', column: 3, row: 'middle' },
      {
        id: 'payments',
        title: 'Payments',
        detail: 'Before the deadline',
        column: 3,
        row: 'bottom',
      },
      { id: 'expiry', title: 'Hold expiry', detail: 'Returns unpaid units', column: 4, row: 'top' },
      {
        id: 'counter',
        title: 'Stock counter',
        detail: 'Atomic, in memory',
        column: 4,
        row: 'middle',
      },
      { id: 'db', title: 'Orders DB', detail: 'Unique per buyer', column: 4, row: 'bottom' },
      {
        id: 'stream',
        title: 'Reservation log',
        detail: 'Durable, ordered',
        column: 5,
        row: 'middle',
      },
      { id: 'writer', title: 'Order writer', detail: 'Idempotent', column: 5, row: 'bottom' },
    ],
    edges: [
      ['buyers', 'edge'],
      ['edge', 'room'],
      ['room', 'checkout', 'pass'],
      ['checkout', 'counter', 'reserve'],
      ['counter', 'stream'],
      ['stream', 'writer'],
      ['writer', 'db'],
      ['checkout', 'payments'],
      ['payments', 'db', 'confirm'],
      ['expiry', 'counter', 'release'],
    ],
    stages: [
      {
        title: 'Serve the page from the edge',
        narration:
          'The sale page is static and cached at the edge, with a countdown driven by the server clock. Basic bot checks run there too: rate limits per address and device, and a challenge for traffic that looks automated.',
        tradeoff:
          'Rendering the page from origin would melt it minutes before the sale even starts. A static page costs some flexibility, such as showing live stock on it, and in exchange the edge absorbs almost all the refresh traffic at no cost to the backend.',
        nodes: ['buyers', 'edge'],
        travel: [['buyers', 'edge']],
      },
      {
        title: 'Line up in a waiting room',
        narration:
          'Buyers who arrive before the start join a waiting room and get a random position at opening time; later arrivals go to the back. The room admits buyers at a fixed rate the checkout can handle.',
        tradeoff:
          'Letting everyone hit checkout at once and rejecting the overflow rewards whoever retries fastest, which means scripts. A waiting room costs an extra hop and a page that buyers watch, and in exchange the load behind it is flat and the order is fair.',
        nodes: ['edge', 'room'],
        travel: [['edge', 'room']],
      },
      {
        title: 'Admit with a signed pass',
        narration:
          'An admitted buyer receives a pass signed by the waiting room, bound to their account and the sale, valid for a few minutes. Checkout verifies the signature without calling anything else.',
        tradeoff:
          'A pass that checkout must look up in a shared store would turn the store into a new hot spot. A signed, self-contained pass is checked locally on every checkout server; the cost is that a pass cannot be revoked early, which a short validity makes acceptable.',
        nodes: ['room', 'checkout'],
        travel: [['room', 'checkout', 'pass']],
      },
      {
        title: 'Reserve in memory, atomically',
        narration:
          'Checkout runs one atomic step on an in-memory store: check that the buyer is under their limit and stock is above zero, then decrement stock and record the buyer. Either all of it happens or none of it does.',
        tradeoff:
          'Decrementing a row in the database with a conditional update is correct, but every request queues on the same row lock and the database becomes the bottleneck. An in-memory counter handles orders of magnitude more operations per second, and the cost is that it is not the durable record, so the next step must make it one.',
        nodes: ['checkout', 'counter'],
        travel: [['checkout', 'counter', 'reserve']],
      },
      {
        title: 'Log the reservation before answering',
        narration:
          'The reservation is appended to a durable log before the buyer hears "reserved". A writer turns each entry into a row in the orders database, keyed by sale and buyer, so a replayed entry changes nothing.',
        tradeoff:
          'Answering from memory alone is fastest, and a crash of the counter would then lose reservations buyers were promised. Writing to a log adds a few milliseconds, and the database can fill in asynchronously at its own pace while the unique key catches any duplicate.',
        nodes: ['counter', 'stream', 'writer', 'db'],
        travel: [
          ['counter', 'stream'],
          ['stream', 'writer'],
          ['writer', 'db'],
        ],
      },
      {
        title: 'Sold out stops the line',
        narration:
          'When the counter reaches zero, a sold-out flag goes to the waiting room and the edge. Everyone still in line gets "sold out" from the edge instead of waiting, and new requests never reach checkout.',
        tradeoff:
          'Without the flag, a hundred thousand buyers would each walk through checkout just to hear no. Pushing the flag outward costs a small window where a few requests still arrive, and the counter rejects those correctly anyway.',
        nodes: ['counter', 'room', 'edge'],
        travel: [],
      },
      {
        title: 'Pay before the deadline',
        narration:
          'The buyer pays within a few minutes. On success the order moves from reserved to paid with a conditional update that only applies to a reservation that has not expired.',
        tradeoff:
          'Charging inside the reserve call would hold a scarce unit hostage to a slow payment provider during the busiest second. Splitting reserve and pay keeps the hot path short; the cost is a deadline to enforce and units temporarily held by people who may never pay.',
        nodes: ['checkout', 'payments', 'db'],
        travel: [
          ['checkout', 'payments'],
          ['payments', 'db', 'confirm'],
        ],
      },
      {
        title: 'Unpaid units go back',
        narration:
          'A job finds reservations past their deadline, marks them expired in the database and increments the counter again. The waiting room then admits a few more buyers for the returned units.',
        tradeoff:
          'Never releasing makes the sale end "sold out" with unpaid units sitting idle. Releasing needs care: the expire and the payment must race through the same conditional update, so a unit is either paid or returned, never both.',
        nodes: ['expiry', 'counter', 'room'],
        travel: [['expiry', 'counter', 'release']],
      },
      {
        title: 'The database has the last word',
        narration:
          'The orders database is the source of truth. If the counter is lost, it is rebuilt as stock minus active reservations. After the sale, paid orders are reconciled against stock and the per-buyer unique key.',
        tradeoff:
          'Trusting the in-memory counter forever would be simpler, and a bug or failover could then oversell silently. Reconciling against durable records costs a recovery procedure and an audit job, and makes any drift visible and fixable.',
        nodes: ['db', 'counter', 'writer'],
        travel: [['writer', 'db']],
      },
    ],
  },
  deepDives: [
    {
      question: 'Where do we decrement stock?',
      options: [
        {
          name: 'Conditional update on one database row',
          pros: 'Durable and simple; the database guarantees no oversell.',
          cons: 'Every buyer waits on the same row lock; throughput is capped at a few hundred to a few thousand per second.',
        },
        {
          name: 'Atomic counter in an in-memory store',
          pros: 'Very high throughput with a single atomic script per request.',
          cons: 'Not durable on its own; it needs a log and a way to rebuild after a failure.',
        },
        {
          name: 'Split stock into buckets across nodes',
          pros: 'Scales past one node by spreading the counter.',
          cons: 'Buyers may hit an empty bucket while others still have stock, so it needs rebalancing.',
        },
      ],
      choice:
        'An atomic in-memory counter, with every reservation logged durably before the buyer is told yes. With a waiting room in front, one counter per item is enough; buckets are kept for much larger sales.',
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
          pros: 'Being online at the start is enough; shaving milliseconds gains nothing.',
          cons: 'Buyers who arrived early may still be near the back, which needs a clear message.',
        },
      ],
      choice:
        'Randomize everyone who is waiting at opening time, then serve later arrivals in order. Admission rate follows the measured capacity of checkout.',
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
          cons: 'Happens late, and the canceled units must be resold.',
        },
      ],
      choice:
        'All three in layers: challenges at the edge, passes bound to an account with a per-buyer limit, and an audit before shipping. The random line removes the main reward for speed.',
    },
  ],
  wrapUp:
    'Serve the page from the edge, line buyers up in a randomized waiting room, admit them with signed passes at the pace checkout can take, decrement an atomic in-memory counter, log every reservation before answering, and let the orders database reconcile what was really sold.',
};
