import type { Design } from '../types';

export const priceTracker: Design = {
  slug: 'price-tracker',
  title: 'Price tracker',
  summary:
    'Watch the prices of hundreds of millions of products on outside stores: spend a limited crawl budget where people are looking, keep history as a list of changes, and tell each user once, quickly and correctly, when a product drops below their target.',
  minutes: 10,
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Users track a product by its store link and set a target price.',
      'Users see the price history of a product as a chart over months or years.',
      'Users get an email or push when the price drops to their target or below.',
    ],
    nonFunctional: [
      'Hundreds of millions of products and tens of millions of alerts.',
      'Popular products refreshed every few minutes to an hour, the long tail about once a week.',
      'An alert arrives within minutes of the refresh that sees the drop, once per drop, and a drop that looks like a glitch is confirmed by a second fetch before anyone is told.',
      'Stay within each store’s rate limits and terms.',
    ],
    outOfScope: [
      'Buying through the service, and comparing prices across stores.',
      'Delivering the notifications themselves, which a notification service handles.',
    ],
  },
  entities: [
    {
      name: 'Product',
      description:
        'One item at one store, found by its store id: current price, last checked time and a refresh priority.',
    },
    {
      name: 'Price change',
      description: 'Product, time and the new price. Stored only when the price actually moves.',
    },
    {
      name: 'Alert',
      description:
        'A user, a product and a target price, plus the price that last triggered it so it fires once per drop.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/alerts',
      description:
        'Body: productUrl, targetPrice. Resolves the product, creating it if new, and returns the alert.',
    },
    {
      method: 'DELETE',
      path: '/alerts/{id}',
      description: 'Stops tracking for this user.',
    },
    {
      method: 'GET',
      path: '/products/{id}/history?range=1y',
      description: 'Returns the price series, downsampled to fit the range.',
    },
  ],
  dataFlow: [
    'A user adds a link and a target; the link resolves to one shared product.',
    'A scheduler picks products that are due, by priority, and fetchers read their prices within each store’s limits.',
    'A price that differs from the current one is stored as a change and published to a stream.',
    'An alert matcher finds the alerts whose target the new price reaches and sends each one notification.',
  ],
  highLevel: {
    label: 'Refresh a price and fire the alerts',
    intro:
      'Follow a product from the moment a user starts tracking it, through a refresh that finds a lower price, to the alerts that fire and the chart the user opens. Watch the fetch pipeline, the alert path and the chart cache join the design as it grows, including a store that starts blocking fetches. Numbers are illustrative. Press play, or step through the stages.',
    lanes: { top: 'Refreshing prices', bottom: 'Alerts and history' },
    nodes: [
      {
        id: 'scheduler',
        title: 'Scheduler',
        detail: 'Due by priority',
        column: 0,
        row: 'top',
        appearsAt: 1,
      },
      {
        id: 'queue',
        title: 'Fetch queue',
        detail: 'Per store limits',
        column: 1,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'fetchers',
        title: 'Fetchers',
        detail: 'Store API or page',
        column: 2,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'history',
        title: 'Price history',
        detail: 'Changes only',
        column: 3,
        row: 'top',
        appearsAt: 4,
      },
      { id: 'user', title: 'User', detail: 'App or browser', column: 0, row: 'middle' },
      { id: 'api', title: 'Tracker API', detail: 'Alerts, charts', column: 1, row: 'middle' },
      { id: 'products', title: 'Products DB', detail: 'Current price', column: 2, row: 'middle' },
      {
        id: 'changes',
        title: 'Change stream',
        detail: 'By product',
        column: 3,
        row: 'middle',
        appearsAt: 5,
      },
      {
        id: 'matcher',
        title: 'Alert matcher',
        detail: 'Finds who to tell',
        column: 4,
        row: 'middle',
        appearsAt: 5,
      },
      {
        id: 'notify',
        title: 'Notifications',
        detail: 'Email, push',
        column: 5,
        row: 'middle',
        appearsAt: 8,
      },
      {
        id: 'charts',
        title: 'Chart cache',
        detail: 'Downsampled series',
        column: 1,
        row: 'bottom',
        appearsAt: 9,
      },
      { id: 'alerts', title: 'Alerts index', detail: 'Product, target', column: 4, row: 'bottom' },
    ],
    edges: [
      ['user', 'api', 'track'],
      ['api', 'products', 'resolve'],
      ['api', 'alerts', 'target'],
      ['products', 'scheduler', 'priority'],
      ['scheduler', 'queue'],
      ['queue', 'fetchers'],
      ['fetchers', 'products', 'compare'],
      ['fetchers', 'history', 'if changed'],
      ['fetchers', 'changes', 'change'],
      ['changes', 'matcher'],
      ['matcher', 'alerts', 'range query'],
      ['matcher', 'fetchers', 'recheck'],
      ['matcher', 'notify', 'once'],
      ['api', 'charts', 'history'],
      ['charts', 'history', 'miss'],
    ],
    stages: [
      {
        title: 'Track a product',
        narration:
          'The user pastes a store link and a target price. The API strips tracking parameters, extracts the store and its product id, and finds or creates one product row. The alert is stored in an index keyed by product and target price.',
        tradeoff:
          'Storing each user’s link as its own item would fetch the same product thousands of times. Normalizing to one product per store id costs a parser per store, and in exchange each product is fetched once no matter how many people watch it.',
        nodes: ['user', 'api', 'products', 'alerts'],
        travel: [
          ['user', 'api', 'track'],
          ['api', 'products', 'resolve'],
          ['api', 'alerts', 'target'],
        ],
        short: 'Track',
        metrics: { users: '2M', requestsPerSecond: '200', p95Latency: '150 ms', errorRate: '0%' },
        load: { api: 15, products: 15, alerts: 10 },
      },
      {
        title: 'Spend the budget where people look',
        narration:
          'Every product has a next check time computed from how many alerts it has, how often its price moved recently and how often it is viewed. The scheduler picks the products that are due, so a popular item is checked every few minutes and a forgotten one once a week. At about 3K fetches a second the budget is roughly 250 million fetches a day, so a weekly floor over about 300 million products takes around a sixth of it and the rest goes to watched products.',
        tradeoff:
          'Checking every product on the same cycle spreads the budget evenly over items nobody watches. A priority schedule keeps watched prices fresh within the same fetch budget; the cost is that a quiet product may change unnoticed for a week, which hurts few people.',
        nodes: ['products', 'scheduler'],
        travel: [['products', 'scheduler', 'priority']],
        short: 'Priority',
        metrics: { users: '2M', requestsPerSecond: '3K', p95Latency: '600 ms', errorRate: '0.5%' },
        load: { products: 25, scheduler: 30 },
      },
      {
        title: 'One store blocks the fetchers',
        narration:
          'Due products go into one shared queue and fetchers take them as fast as they can. A large store runs a sale, its products crowd the queue and fetchers hit it hard. The store starts answering with blocks and challenge pages, fetches fail, and smaller stores wait behind it.',
        tradeoff:
          'A single queue is the simplest way to hand out work, and it treats every store the same. Stores do not see it that way: each tolerates only so many requests, and going past that turns a busy store into a blocked one and stalls everyone queued behind it.',
        nodes: ['scheduler', 'queue', 'fetchers'],
        travel: [
          ['scheduler', 'queue'],
          ['queue', 'fetchers'],
        ],
        short: 'Store blocks',
        metrics: {
          users: '2M',
          requestsPerSecond: '3K',
          p95Latency: '8 s',
          errorRate: '25%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { scheduler: 30, queue: 90, fetchers: 95 },
        traffic: [{ edge: ['queue', 'fetchers'], kind: 'failed' }],
      },
      {
        title: 'Fetch within each store’s limits',
        narration:
          'Due products go to a queue split by store, and each store has its own rate limit. Fetchers use the store’s product API where one exists and fall back to reading the page, with an extractor per store layout.',
        tradeoff:
          'One shared pool with no per-store limits would get blocked by the busiest stores and starve the rest. Separate limits cost some idle capacity when one store’s queue is empty, and keep every store reachable; official APIs cost signing up for them and are far more stable than page parsing.',
        nodes: ['scheduler', 'queue', 'fetchers'],
        travel: [
          ['scheduler', 'queue'],
          ['queue', 'fetchers'],
        ],
        short: 'Store limits',
        metrics: { users: '2M', requestsPerSecond: '3K', p95Latency: '700 ms', errorRate: '0.5%' },
        load: { scheduler: 30, queue: 35, fetchers: 55 },
      },
      {
        title: 'Store only changes',
        narration:
          'The fetcher compares the new price with the current one. If they match, only the last checked time moves. If they differ, it updates the current price and writes an outbox row carrying a change id in one transaction, then appends one row to the history, keyed by product and time.',
        tradeoff:
          'Storing every reading would multiply history by the number of checks, while most prices stay flat for weeks. Storing changes keeps history small and charts cheap; the cost is that "price at time t" means finding the last change before t, and gaps in checking are invisible unless last checked is kept.',
        nodes: ['fetchers', 'products', 'history'],
        travel: [
          ['fetchers', 'products', 'compare'],
          ['fetchers', 'history', 'if changed'],
        ],
        short: 'Store changes',
        metrics: { users: '2M', requestsPerSecond: '3K', p95Latency: '700 ms', errorRate: '0.5%' },
        load: { fetchers: 55, products: 35, history: 15 },
      },
      {
        title: 'Publish changes to a stream',
        narration:
          'Each change becomes an event with product, old price, new price and a change id, on a stream partitioned by product. A relay publishes each outbox row, and repeats the history append if it is missing, until both are done, so a fetcher crash delays a change instead of losing its alerts. Delivery is at least once, made harmless by the change id. The alert matcher reads it in order per product.',
        tradeoff:
          'Matching inside the fetcher would make crawling wait on alert work and lose matches when a fetcher crashes. A stream decouples the two and lets the matcher catch up after a store-wide sale floods it; the cost is a few seconds of extra delay.',
        nodes: ['fetchers', 'changes', 'matcher'],
        travel: [
          ['fetchers', 'changes', 'change'],
          ['changes', 'matcher'],
        ],
        short: 'Change stream',
        metrics: { users: '2M', requestsPerSecond: '3K', p95Latency: '700 ms', errorRate: '0.5%' },
        load: { fetchers: 55, changes: 30, matcher: 35 },
        traffic: [{ edge: ['changes', 'matcher'], kind: 'heavy' }],
      },
      {
        title: 'Match with an index, not a scan',
        narration:
          'For a new price P, the matcher reads the alerts of that product whose target is at least P and that have not already fired at P or lower. The index is ordered by product, then target, so this is one range read.',
        tradeoff:
          'Scanning every alert on every change is tens of millions of rows per event. The index costs storage and a write per alert change, and makes each match proportional to the alerts that actually fire.',
        nodes: ['matcher', 'alerts'],
        travel: [['matcher', 'alerts', 'range query']],
        short: 'Match',
        metrics: { users: '2M', requestsPerSecond: '3K', p95Latency: '700 ms', errorRate: '0.5%' },
        load: { matcher: 40, alerts: 35 },
      },
      {
        title: 'Double-check suspicious drops',
        narration:
          'A drop that is far too big, such as 90 percent off, or that comes from a page whose layout looks changed, is held and fetched again a minute later. Only a confirmed price reaches the alerts.',
        tradeoff:
          'Alerting on the first reading is fastest, and one parsing glitch would then send a million people to a product that is not really on sale. A recheck costs a minute on rare large drops and an extra fetch, which is cheap next to lost trust.',
        nodes: ['matcher', 'fetchers'],
        travel: [['matcher', 'fetchers', 'recheck']],
        short: 'Recheck',
        metrics: { users: '2M', requestsPerSecond: '3K', p95Latency: '700 ms', errorRate: '0.5%' },
        load: { matcher: 35, fetchers: 55 },
      },
      {
        title: 'Notify once, then re-arm',
        narration:
          'Each match becomes a notification job with the key alert id plus change id, so a replayed event produces the same job and the notification service drops the repeat by that key. The alert records the price it fired at, and fires again only for a lower price or after the price climbs back above the target.',
        tradeoff:
          'Firing on every matching change would message the same user each time the price wobbles by a cent. Remembering the last fired price costs a write per notification, and turns a noisy price into one alert per real drop.',
        nodes: ['matcher', 'notify', 'alerts'],
        travel: [['matcher', 'notify', 'once']],
        short: 'Notify',
        metrics: { users: '2M', requestsPerSecond: '3K', p95Latency: '700 ms', errorRate: '0.5%' },
        load: { matcher: 35, notify: 40, alerts: 30 },
      },
      {
        title: 'Serve history from a cache',
        narration:
          'Opening a product shows its chart. The API reads a downsampled series, such as the daily low and high for a year, from a cache that is filled from the history store on a miss and refreshed when the price changes. A fill can race a refresh and keep an older series, so entries also expire after a short TTL.',
        tradeoff:
          'Returning every raw change for a five-year chart sends far more points than a screen can draw. Downsampled series cost a precompute step and lose detail inside a day, which a zoomed-in view can fetch separately.',
        nodes: ['user', 'api', 'charts', 'history'],
        travel: [
          ['user', 'api', 'track'],
          ['api', 'charts', 'history'],
          ['charts', 'history', 'miss'],
        ],
        short: 'Chart cache',
        metrics: { users: '2M', requestsPerSecond: '3K', p95Latency: '700 ms', errorRate: '0.5%' },
        load: { api: 30, charts: 35, history: 15 },
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we keep prices fresh with a limited crawl budget?',
      options: [
        {
          name: 'Round robin over every product',
          pros: 'Simple and fair; every product is checked eventually.',
          cons: 'Hundreds of millions of products at a few thousand fetches a second means each one waits about a day, including the ones thousands of people watch.',
        },
        {
          name: 'Priority by demand and volatility',
          pros: 'Watched and fast-moving products get most of the budget; the long tail still gets a floor.',
          cons: 'Needs signals kept up to date, and a quiet product that suddenly drops is caught late.',
        },
        {
          name: 'Prices reported by users’ browsers',
          pros: 'Free, fresh readings for exactly the products people are viewing.',
          cons: 'Untrusted input: it must be validated and confirmed before it can trigger alerts.',
        },
      ],
      choice:
        'Priority scheduling with a weekly floor for every product, plus browser reports used as hints that pull a product forward in the queue rather than as prices to trust directly.',
    },
    {
      question: 'How do we match a price change to millions of alerts?',
      options: [
        {
          name: 'Scan all alerts for the product',
          pros: 'No extra structure; fine for products with a handful of watchers.',
          cons: 'A product with a million watchers reads a million rows for every cent of movement.',
        },
        {
          name: 'Index by product and target price',
          pros: 'One range read returns exactly the alerts the new price reaches.',
          cons: 'A store-wide sale still produces a large burst of matches that must be throttled downstream.',
        },
        {
          name: 'Keep the highest target per product on the product',
          pros: 'Most changes skip the alerts store entirely, since the price is still above every target.',
          cons: 'The value must be kept current as alerts are added and removed.',
        },
      ],
      choice:
        'Index by product and target, and keep the highest target on the product so most changes skip matching altogether. The stream absorbs sale-day bursts and the notification service paces delivery.',
    },
    {
      question: 'How do we avoid false and duplicate alerts?',
      options: [
        {
          name: 'Alert on every matching reading',
          pros: 'Fastest possible alert.',
          cons: 'One bad parse sends a wave of wrong alerts, and a price that wobbles sends many.',
        },
        {
          name: 'Confirm suspicious drops with a second fetch',
          pros: 'Catches parsing errors and short glitches before anyone is told.',
          cons: 'Adds a minute and a fetch for large drops, and a deliberate one-minute sale can be missed.',
        },
        {
          name: 'Remember the last fired price per alert',
          pros: 'One alert per real drop, plus a key that makes replays harmless.',
          cons: 'A write on every notification, and rules for when an alert re-arms.',
        },
      ],
      choice:
        'Both of the last two: confirm drops that look implausible, and fire each alert once per drop with a key of alert id plus change id. An alert that has fired fires again only for a still lower price, or after the price rises back above the target and re-arms it.',
    },
  ],
  wrapUp:
    'Resolve every link to one shared product, refresh by priority within each store’s limits, store only price changes, publish changes to a stream, match drops with an index on product and target, confirm implausible drops, and fire each alert once per drop.',
};
