import type { Design } from '../types';

export const stockTrading: Design = {
  slug: 'stock-trading',
  title: 'Stock trading app',
  summary:
    'A retail brokerage app: stream live prices from a market data feed to millions of phones without falling behind, and send orders to an outside exchange or broker so that none is lost, duplicated or left in an unknown state, even when a cancel races a fill.',
  difficulty: 'Hard',
  requirements: {
    functional: [
      'Users see live prices for the symbols on their screen.',
      'Users place market and limit orders and cancel open ones.',
      'Users see the status of their orders and their positions update as orders fill.',
    ],
    nonFunctional: [
      'An order is never lost or sent twice, and every change to it is auditable.',
      'Prices reach the app within about a second; the latest price matters more than every tick.',
      'Millions of connected users and a spike of orders in the first minutes after the market opens.',
      'A storm of price updates must never slow down placing or canceling an order.',
    ],
    outOfScope: [
      'The matching engine: orders are executed by external exchanges and brokers.',
      'Options, margin and charting history.',
    ],
  },
  entities: [
    {
      name: 'Quote',
      description: 'The latest bid, ask and last price for a symbol, with the time it was seen.',
    },
    {
      name: 'Order',
      description:
        'Symbol, side, type, quantity, limit price, a client order id and its state: pending, submitted, partially filled, filled, cancel requested, canceled or rejected.',
    },
    {
      name: 'Fill',
      description: 'An execution reported by the venue: quantity, price and its own execution id.',
    },
    {
      name: 'Account',
      description: 'Cash, buying power on hold for open orders, and positions per symbol.',
    },
  ],
  api: [
    {
      method: 'WS',
      path: '/stream',
      description:
        'Subscribe and unsubscribe to symbols. Pushes conflated prices and the user’s order updates.',
    },
    {
      method: 'POST',
      path: '/orders',
      description:
        'Body: symbol, side, type, quantity, limitPrice, clientOrderId. Returns 202 with the order in state pending.',
    },
    {
      method: 'DELETE',
      path: '/orders/{id}',
      description: 'Requests a cancel. Returns 202; the venue decides whether it happens.',
    },
    {
      method: 'GET',
      path: '/orders?status=open, /positions',
      description: 'Open orders and positions, read from the orders database.',
    },
  ],
  dataFlow: [
    'An ingester reads the market data feed and publishes the latest price per symbol.',
    'Socket gateways subscribe to the symbols their clients watch and push only the newest price.',
    'An order is stored with a hold on buying power and an outbox row, then relayed to the venue.',
    'Fills come back as events that update the order, the account and the user’s screen; a reconciler settles anything uncertain.',
  ],
  highLevel: {
    label: 'Stream a price, then trade on it',
    intro:
      'Follow a price from the market data feed to a phone, then follow an order from the phone to an outside venue and back as fills. Press play, or step through the stages.',
    lanes: { top: 'Market data', bottom: 'Orders' },
    nodes: [
      { id: 'feed', title: 'Market feed', detail: 'Vendor or exchange', column: 0, row: 'top' },
      { id: 'ingester', title: 'Ingester', detail: 'Normalizes ticks', column: 1, row: 'top' },
      { id: 'pubsub', title: 'Price pub/sub', detail: 'Latest per symbol', column: 2, row: 'top' },
      {
        id: 'gateways',
        title: 'Socket gateways',
        detail: 'Conflate per client',
        column: 3,
        row: 'top',
      },
      { id: 'app', title: 'Trader app', detail: 'Phone or web', column: 0, row: 'middle' },
      { id: 'api', title: 'Order API', detail: 'Validates, holds', column: 1, row: 'middle' },
      { id: 'db', title: 'Orders DB', detail: 'Orders, holds, outbox', column: 2, row: 'middle' },
      { id: 'relay', title: 'Outbox relay', detail: 'Sends in order', column: 3, row: 'middle' },
      {
        id: 'broker',
        title: 'Venue gateway',
        detail: 'Session per venue',
        column: 4,
        row: 'middle',
      },
      { id: 'venue', title: 'Exchange', detail: 'External, executes', column: 5, row: 'middle' },
      { id: 'updater', title: 'Order updater', detail: 'State machine', column: 3, row: 'bottom' },
      { id: 'log', title: 'Execution log', detail: 'Acks and fills', column: 4, row: 'bottom' },
      {
        id: 'recon',
        title: 'Reconciler',
        detail: 'Unknowns, end of day',
        column: 5,
        row: 'bottom',
      },
    ],
    edges: [
      ['feed', 'ingester'],
      ['ingester', 'pubsub', 'by symbol'],
      ['pubsub', 'gateways'],
      ['gateways', 'app', 'latest'],
      ['app', 'api', 'order'],
      ['api', 'db', 'order + hold'],
      ['db', 'relay', 'outbox'],
      ['relay', 'broker'],
      ['broker', 'venue', 'new, cancel'],
      ['venue', 'log', 'acks, fills'],
      ['log', 'updater'],
      ['updater', 'db', 'apply'],
      ['updater', 'gateways', 'status'],
      ['recon', 'venue', 'query'],
      ['recon', 'db', 'repair'],
    ],
    stages: [
      {
        title: 'Ingest the market feed',
        narration:
          'An ingester holds the connection to the market data vendor, normalizes each tick into one quote format and publishes it on a channel per symbol. Only the latest quote per symbol is kept as state.',
        tradeoff:
          'Keeping only the newest quote, not every tick, makes the store tiny and recovery trivial. The cost is that nothing downstream can replay intraday history from here; a chart service would need its own copy of the ticks.',
        nodes: ['feed', 'ingester', 'pubsub'],
        travel: [
          ['feed', 'ingester'],
          ['ingester', 'pubsub', 'by symbol'],
        ],
      },
      {
        title: 'Gateways subscribe to what their clients watch',
        narration:
          'Each socket gateway holds tens of thousands of connections and a map from symbol to the connections watching it. It subscribes to a symbol channel when its first client asks for it and drops it when the last one leaves.',
        tradeoff:
          'Sending every symbol to every gateway would be simpler and waste most of the bandwidth, since a gateway only needs the few thousand symbols its users are looking at. Subscribing on demand costs bookkeeping for each subscribe and unsubscribe, and keeps a popular symbol spread over all gateways instead of one hot node.',
        nodes: ['pubsub', 'gateways'],
        travel: [['pubsub', 'gateways']],
      },
      {
        title: 'Conflate before pushing',
        narration:
          'A busy symbol can change hundreds of times a second. The gateway keeps one pending slot per symbol per client and flushes the newest value a few times a second; any value overwritten before the flush is dropped.',
        tradeoff:
          'Forwarding every tick would let a phone on a weak network build an ever growing backlog and show prices from a minute ago. Conflation gives up ticks no human could read anyway, and in exchange a slow client simply sees fewer, always current updates.',
        nodes: ['gateways', 'app'],
        travel: [['gateways', 'app', 'latest']],
      },
      {
        title: 'Store the order and hold buying power',
        narration:
          'The order API checks market hours and the symbol, then in one transaction inserts the order as pending, keyed by the client order id, and decrements available buying power with a conditional update that fails if there is not enough.',
        tradeoff:
          'Checking the balance and then sending the order lets two quick orders spend the same cash twice. A conditional update in the same transaction as the order is safe and cheap per account; the cost is holding an estimate for market orders, since the final price is not known yet.',
        nodes: ['app', 'api', 'db'],
        travel: [
          ['app', 'api', 'order'],
          ['api', 'db', 'order + hold'],
        ],
      },
      {
        title: 'Relay through an outbox',
        narration:
          'The same transaction writes an outbox row. A relay reads new outbox rows and hands them to the venue gateway, marking each one sent only after the gateway accepts it. The user already has a 202 and sees the order as pending.',
        tradeoff:
          'Calling the venue inside the request couples the user’s wait to an outside system and loses the order if the server dies between the database write and the call. The outbox guarantees that every stored order is eventually sent, at the cost of a short delay and the chance of sending twice, which the next stage absorbs.',
        nodes: ['db', 'relay', 'broker'],
        travel: [
          ['db', 'relay', 'outbox'],
          ['relay', 'broker'],
        ],
      },
      {
        title: 'Send with our own order id',
        narration:
          'The venue gateway keeps a long-lived session with each exchange or broker and sends the order tagged with our client order id, which the venue rejects if it has seen it before and echoes on every reply.',
        tradeoff:
          'Without our own id, a timeout leaves two bad choices: resend and maybe buy twice, or give up and maybe have a live order we do not know about. Our id makes a resend safe and lets us ask the venue later; the cost is that a timeout means "unknown", a state the system must handle explicitly.',
        nodes: ['broker', 'venue'],
        travel: [['broker', 'venue', 'new, cancel']],
      },
      {
        title: 'Fills drive the state machine',
        narration:
          'Acks, partial fills and final states arrive asynchronously and go to a durable execution log. The order updater applies each one as a state transition, records the fill by its execution id, moves shares and cash in the account, and releases whatever part of the hold the fill did not use.',
        tradeoff:
          'Updating the order straight from the gateway callback loses events if the updater is down. A log costs one more hop, and in exchange events are replayable, applied in order per order id, and deduplicated by execution id so a replay never fills twice.',
        nodes: ['venue', 'log', 'updater', 'db'],
        travel: [
          ['venue', 'log', 'acks, fills'],
          ['log', 'updater'],
          ['updater', 'db', 'apply'],
        ],
      },
      {
        title: 'Push the status to the user',
        narration:
          'After each transition the updater publishes the new state to the gateway holding the user’s connection, on the same socket that carries prices. The app shows "filled 60 of 100" without polling.',
        tradeoff:
          'Polling the orders endpoint would hammer the database exactly when it is busiest. Pushing reuses the open socket; the cost is that a dropped connection misses updates, so the app reloads open orders from the API when it reconnects.',
        nodes: ['updater', 'gateways', 'app'],
        travel: [
          ['updater', 'gateways', 'status'],
          ['gateways', 'app', 'latest'],
        ],
      },
      {
        title: 'A cancel is only a request',
        narration:
          'Canceling sets the order to cancel requested and sends a cancel through the same outbox and gateway. The venue answers canceled, or reports that the order filled first. A fill that arrives after the request is still applied.',
        tradeoff:
          'Marking the order canceled the moment the user taps would be wrong whenever the venue filled it a millisecond earlier, and the user would own shares the app says they do not. Waiting for the venue costs a moment of "canceling" on screen, and keeps the app truthful.',
        nodes: ['app', 'api', 'db', 'relay', 'broker', 'venue'],
        travel: [
          ['app', 'api', 'order'],
          ['api', 'db', 'order + hold'],
          ['db', 'relay', 'outbox'],
          ['relay', 'broker'],
          ['broker', 'venue', 'new, cancel'],
        ],
      },
      {
        title: 'Reconcile what is uncertain',
        narration:
          'A reconciler looks for orders stuck in pending or submitted for too long and asks the venue for their status by client order id. Every night it also compares orders and fills with the clearing files from the broker and repairs any difference.',
        tradeoff:
          'Trusting the event stream alone is simpler and leaves an order wrong forever if one message is lost. Reconciliation costs a job, venue queries and a repair path, and turns every "unknown" into a known state within minutes, plus a full daily check.',
        nodes: ['recon', 'venue', 'db'],
        travel: [
          ['recon', 'venue', 'query'],
          ['recon', 'db', 'repair'],
        ],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we stream prices to millions of clients?',
      options: [
        {
          name: 'Clients poll a quotes endpoint',
          pros: 'Stateless servers and simple caching per symbol.',
          cons: 'Millions of requests per second for mostly unchanged data, and prices that are always one poll late.',
        },
        {
          name: 'Sockets that forward every tick',
          pros: 'Lowest latency and complete data for every client.',
          cons: 'Slow clients build backlogs, gateways run out of memory, and phones drain batteries on updates nobody reads.',
        },
        {
          name: 'Sockets with per-symbol subscriptions and conflation',
          pros: 'Each gateway carries only the symbols its users watch, and each client gets at most a few fresh values a second.',
          cons: 'Intermediate ticks are dropped and gateways keep subscription state to rebuild after a restart.',
        },
      ],
      choice:
        'Socket gateways with on-demand symbol subscriptions and conflation. The app does not need every tick; it needs the current price, quickly, without ever falling behind.',
    },
    {
      question: 'The venue did not answer. Is the order live?',
      options: [
        {
          name: 'Resend until it answers',
          pros: 'Eventually gets a reply.',
          cons: 'Without a unique id it can place the same order twice, which is real money.',
        },
        {
          name: 'Mark it failed and tell the user',
          pros: 'Simple and fast to show.',
          cons: 'The venue may have accepted it, leaving a live order the system believes is dead.',
        },
        {
          name: 'Mark it unknown and ask by client order id',
          pros: 'A resend with the same id is safe, and a status query settles the truth.',
          cons: 'Needs an explicit unknown state, a reconciler and venues that support lookups by our id.',
        },
      ],
      choice:
        'Persist before sending, tag every order with our own id, and treat a timeout as unknown until the reconciler or a later message from the venue settles it.',
    },
    {
      question: 'How do we survive the spike at market open?',
      options: [
        {
          name: 'Autoscale on load',
          pros: 'No planning; capacity follows demand.',
          cons: 'New servers arrive minutes after the spike, which is when orders were being lost or slowed.',
        },
        {
          name: 'Scale ahead of a known schedule',
          pros: 'The open happens at the same time every day, so capacity is ready before it.',
          cons: 'Pays for idle capacity and still misses news-driven spikes on a single symbol.',
        },
        {
          name: 'Separate planes plus a buffer and limits',
          pros: 'Market data and orders run on different services, the outbox absorbs bursts, and per-user limits stop runaway clients.',
          cons: 'Orders may queue for a few seconds, which must be shown honestly as pending.',
        },
      ],
      choice:
        'Scale ahead of the open, keep the price plane and the order plane apart so a quote storm cannot slow trading, and let the outbox absorb the burst: under pressure prices may lag, orders must never be lost.',
    },
  ],
  wrapUp:
    'Fan prices out through per-symbol subscriptions with conflation, store every order with a buying power hold and an outbox in one transaction, send it with our own id, drive its state from fills in a durable log, treat cancels and timeouts as questions for the venue, and reconcile anything uncertain.',
};
