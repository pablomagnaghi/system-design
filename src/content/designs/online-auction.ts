import type { Design } from '../types';

export const onlineAuction: Design = {
  slug: 'online-auction',
  title: 'Online auction',
  summary:
    'Run timed auctions where the highest bid always wins: every bid is a conditional update on the auction row, every attempt is recorded, watchers see the new price live, and the end time is enforced by the bid itself, not by a timer.',
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Sellers list an item with a starting price and an end time.',
      'Buyers place bids that must beat the current highest bid.',
      'Everyone watching an auction sees the highest bid update live.',
      'When the auction ends, the highest bidder wins and both sides are notified.',
    ],
    nonFunctional: [
      'Strong consistency for bids: an accepted bid is never lost and a lower bid never wins.',
      'Bids are acknowledged in well under a second.',
      'Scale to millions of open auctions, with a few hot ones getting many bids per second near the end.',
      'The close is fair: no bid accepted after the end, no valid bid rejected before it.',
    ],
    outOfScope: ['Payment, shipping and fraud checks.', 'Search and recommendations of auctions.'],
  },
  entities: [
    {
      name: 'Auction',
      description:
        'Item, seller, starting price, end time, state, and the current highest bid and bidder.',
    },
    {
      name: 'Bid',
      description: 'Auction, bidder, amount, time and outcome: accepted or rejected.',
    },
    { name: 'User', description: 'A seller, a bidder or both.' },
  ],
  api: [
    {
      method: 'POST',
      path: '/auctions',
      description: 'Body: item, startingPrice, endsAt. Creates an open auction.',
    },
    {
      method: 'POST',
      path: '/auctions/{id}/bids',
      description:
        'Body: amount, idempotencyKey. Returns 201 if it is now the highest bid, or 409 with the current price.',
    },
    {
      method: 'GET',
      path: '/auctions/{id}/stream',
      description: 'A server-sent events stream of new highest bids and the final result.',
    },
  ],
  dataFlow: [
    'The seller lists an item; an open auction row is created with its end time.',
    'A bid updates the auction row only if it is higher and the auction has not ended.',
    'The bid is recorded and an event is published through an outbox.',
    'Watchers receive the new price; at the end time the auction closes and the winner is notified.',
  ],
  highLevel: {
    label: 'Run an auction to the end',
    intro:
      'Follow an auction from listing to winner, with bids competing for the same row and watchers following live. Press play, or step through the stages.',
    nodes: [
      { id: 'seller', title: 'Seller', detail: 'Lists an item', column: 0, row: 'top' },
      { id: 'bidder', title: 'Bidder', detail: 'Places a bid', column: 0, row: 'middle' },
      { id: 'listings', title: 'Listing API', detail: 'Creates auctions', column: 1, row: 'top' },
      { id: 'api', title: 'Bid API', detail: 'Idempotency key', column: 1, row: 'middle' },
      { id: 'closer', title: 'Closer', detail: 'Fires at end time', column: 1, row: 'bottom' },
      { id: 'ledger', title: 'Bid ledger', detail: 'Every attempt', column: 2, row: 'top' },
      {
        id: 'auction',
        title: 'Auction row',
        detail: 'Conditional update',
        column: 2,
        row: 'middle',
      },
      { id: 'events', title: 'Bid events', detail: 'Via an outbox', column: 3, row: 'middle' },
      { id: 'live', title: 'Live updates', detail: 'SSE per auction', column: 4, row: 'middle' },
      { id: 'notify', title: 'Notifications', detail: 'Winner, seller', column: 4, row: 'bottom' },
      { id: 'watchers', title: 'Watchers', detail: 'See the price', column: 5, row: 'middle' },
    ],
    edges: [
      ['seller', 'listings'],
      ['listings', 'auction'],
      ['bidder', 'api'],
      ['api', 'auction', 'if higher'],
      ['auction', 'ledger', 'same transaction'],
      ['auction', 'events'],
      ['events', 'live'],
      ['live', 'watchers'],
      ['closer', 'auction', 'close'],
      ['events', 'notify'],
    ],
    stages: [
      {
        title: 'List an item',
        narration:
          'The seller creates an auction with a starting price and an end time. The auction row is the single place that holds the current highest bid.',
        tradeoff:
          'Deriving the highest bid from all bids on every request needs no extra column, but gets slower as bids pile up and makes the comparison racy. Keeping the current maximum on the auction row gives one small row to read and update, at the cost of keeping it consistent with the ledger.',
        nodes: ['seller', 'listings', 'auction'],
        travel: [
          ['seller', 'listings'],
          ['listings', 'auction'],
        ],
      },
      {
        title: 'Place a bid with a key',
        narration:
          'A bidder submits an amount with an idempotency key, so a double click or a retry on a bad connection cannot become two bids.',
        tradeoff:
          'Without the key, a retry after a timeout could place a second, higher bid the user never meant. Storing keys costs a lookup per bid, which is small next to the harm of an unintended bid.',
        nodes: ['bidder', 'api'],
        travel: [['bidder', 'api']],
      },
      {
        title: 'Accept only a higher bid',
        narration:
          'The service runs one conditional update: set the highest bid to this amount where the current highest is lower and the end time has not passed. If no row changes, the bid lost and the bidder gets the current price.',
        tradeoff:
          'Reading the price and then writing leaves a gap where two bids both think they win. Locking the row closes the gap but makes bids wait in line. The conditional update lets the database decide atomically, and only the losing bid pays with a retry.',
        nodes: ['api', 'auction'],
        travel: [['api', 'auction', 'if higher']],
      },
      {
        title: 'Record every attempt',
        narration:
          'In the same transaction, the bid is appended to a ledger with its outcome, accepted or rejected.',
        tradeoff:
          'Storing only the winning bid is smaller, but makes disputes and audits impossible. An append-only ledger costs storage and an extra insert, and lets anyone reconstruct exactly what happened and when.',
        nodes: ['auction', 'ledger'],
        travel: [['auction', 'ledger', 'same transaction']],
      },
      {
        title: 'Publish through an outbox',
        narration:
          'An accepted bid also writes an outbox row in the same transaction. A worker publishes it as an event: the new price, the new leader and the previous leader, who was outbid.',
        tradeoff:
          'Publishing directly after commit can lose the event if the process dies in between. The outbox adds a table and a worker, and guarantees every accepted bid is announced.',
        nodes: ['auction', 'events'],
        travel: [['auction', 'events']],
      },
      {
        title: 'Watchers see the price live',
        narration:
          'Real-time servers subscribe to the auctions their viewers watch and push each new price over server-sent events. The outbid bidder also gets a notification.',
        tradeoff:
          'Polling every second is simple but costly with many watchers and still feels slow at the end. Pushing over long-lived connections is cheaper per update and instant, at the cost of running a connection layer.',
        nodes: ['events', 'live', 'watchers'],
        travel: [
          ['events', 'live'],
          ['live', 'watchers'],
        ],
      },
      {
        title: 'Bids in the last seconds',
        narration:
          'A bid in the final minutes pushes the end time forward by a few minutes, as part of the same conditional update. Others get a fair chance to answer.',
        tradeoff:
          'A hard close rewards last-second bidding scripts and frustrates everyone else. A soft close makes the end time less predictable for sellers, and turns the end into a contest of real prices instead of reflexes.',
        nodes: ['auction'],
        travel: [],
      },
      {
        title: 'Close at the end time',
        narration:
          'A scheduled closer fires when the end time passes, rechecks it against the row, and moves the auction from open to closed. Bids were already rejected after the end time by their own condition.',
        tradeoff:
          'If the timer were the only guard, a late timer would accept late bids. Making the bid condition enforce the end time means the closer can be late without breaking fairness; it only decides when the result is announced.',
        nodes: ['closer', 'auction'],
        travel: [['closer', 'auction', 'close']],
      },
      {
        title: 'Announce the winner',
        narration:
          'The close emits a final event. Watchers see the result, and the winner and seller are notified to continue to payment.',
        tradeoff:
          'Reusing the same outbox and event path for the result keeps a single, reliable way out of the system. It costs a few seconds of delay between the end and the announcement, which buyers accept.',
        nodes: ['auction', 'events', 'notify'],
        travel: [
          ['auction', 'events'],
          ['events', 'notify'],
        ],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do concurrent bids stay consistent?',
      options: [
        {
          name: 'Read, compare, then write',
          pros: 'Easy to write.',
          cons: 'Two bids can both pass the comparison and the lower one can overwrite the higher.',
        },
        {
          name: 'Lock the auction row',
          pros: 'Correct and easy to reason about.',
          cons: 'Bids on a hot auction wait in line and lock time grows with load.',
        },
        {
          name: 'Conditional update on the highest bid',
          pros: 'Atomic, no explicit locks; the database settles races.',
          cons: 'Losing bids must be reported and maybe retried by the client.',
        },
        {
          name: 'Queue of bids per auction',
          pros: 'One consumer per auction processes bids strictly in order.',
          cons: 'Bids become asynchronous, so the bidder waits for a result instead of a direct answer.',
        },
      ],
      choice:
        'A conditional update on the auction row. It handles hot auctions well because each update is tiny; a queue per auction is the next step only if a single row cannot keep up.',
    },
    {
      question: 'How do we end an auction fairly?',
      options: [
        {
          name: 'A periodic job that closes expired auctions',
          pros: 'Simple.',
          cons: 'Bids can slip in between the end time and the next run.',
        },
        {
          name: 'A delayed message per auction',
          pros: 'Fires close to the end time.',
          cons: 'Still a timer: if it is late, so is the close.',
        },
        {
          name: 'End time checked in every bid, plus a closer for the result',
          pros: 'No late bid is ever accepted, whatever the timer does.',
          cons: 'Two pieces to keep in sync: the bid condition and the closer.',
        },
      ],
      choice:
        'Every bid checks the end time in its own condition, and a delayed message triggers the close and the announcement. Fairness never depends on timer precision.',
    },
    {
      question: 'How do bidders and watchers see updates?',
      options: [
        {
          name: 'Polling',
          pros: 'Simple and cacheable.',
          cons: 'Costly for many watchers and slow near the end.',
        },
        {
          name: 'Server-sent events with a channel per auction',
          pros: 'Instant one-way updates over plain HTTP.',
          cons: 'A connection layer and pub/sub to run.',
        },
      ],
      choice:
        'Server-sent events fed by a pub/sub channel per auction; bids are still placed with normal requests, so they get a direct, consistent answer.',
    },
  ],
  wrapUp:
    'One conditional update decides every bid, including the end time; a ledger records every attempt; an outbox announces each new price; and a soft close keeps the last minutes fair.',
};
