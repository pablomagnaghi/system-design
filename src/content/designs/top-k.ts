import type { Design } from '../types';

export const topK: Design = {
  slug: 'top-k',
  title: 'Top-K trending items',
  summary:
    'Count billions of views a day and answer "what are the top 100 items right now, today, this week?" in milliseconds, accepting a little approximation in exchange for speed and low cost.',
  difficulty: 'Hard',
  requirements: {
    functional: [
      'Record a view (or like, or play) event for an item.',
      'Return the top K items for a window: last hour, last day, last week.',
      'Optionally filter the ranking by a category or region.',
    ],
    nonFunctional: [
      'Ingest hundreds of thousands of events per second at peak.',
      'Read the top K in tens of milliseconds, since the page is hit constantly.',
      'Rankings may lag reality by up to a minute.',
      'Approximate counts are fine for the live view; exact daily counts are needed later.',
    ],
    outOfScope: [
      'Personalized rankings per user.',
      'Fraud and bot filtering of the events themselves.',
    ],
  },
  entities: [
    {
      name: 'View event',
      description: 'Item id, timestamp, optional category and region. Immutable, append-only.',
    },
    {
      name: 'Window count',
      description: 'Item id, window start (minute, hour, day) and count for that window.',
    },
    {
      name: 'Top-K snapshot',
      description: 'For one window and filter: the ordered list of item ids with their counts.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/events',
      description: 'Body: itemId, type, timestamp. Fire and forget; returns 202.',
    },
    {
      method: 'GET',
      path: '/top?window=1h&k=100&category=music',
      description: 'Returns the ordered top K items with approximate counts and the snapshot time.',
    },
  ],
  dataFlow: [
    'Clients send view events; the ingest service appends them to a partitioned log.',
    'Stream counters, partitioned by item, keep per-minute counts and a local top list.',
    'A merger combines partial top lists into one top K per window and writes a snapshot.',
    'Reads come straight from the snapshot cache; a batch job recomputes exact daily counts.',
  ],
  highLevel: {
    label: 'Count a view and serve the ranking',
    intro:
      'Follow one view event from the client until it shows up in the trending list, and see how the list is served without scanning any counts. Press play, or step through the stages.',
    lanes: { top: 'Write path', bottom: 'Read and batch path' },
    nodes: [
      { id: 'clients', title: 'Clients', detail: 'Send view events', column: 0, row: 'middle' },
      {
        id: 'ingest',
        title: 'Ingest service',
        detail: 'Validate, append',
        column: 1,
        row: 'middle',
      },
      { id: 'log', title: 'Event log', detail: 'Partitioned by item', column: 2, row: 'middle' },
      {
        id: 'counters',
        title: 'Stream counters',
        detail: 'Per-minute counts',
        column: 3,
        row: 'middle',
      },
      { id: 'merger', title: 'Top-K merger', detail: 'Combine partials', column: 4, row: 'middle' },
      {
        id: 'cache',
        title: 'Snapshot cache',
        detail: 'Top K per window',
        column: 5,
        row: 'middle',
      },
      { id: 'api', title: 'Ranking API', detail: 'Read snapshots', column: 5, row: 'top' },
      { id: 'lake', title: 'Raw event store', detail: 'Cheap, columnar', column: 3, row: 'bottom' },
      { id: 'batch', title: 'Batch job', detail: 'Exact daily counts', column: 4, row: 'bottom' },
    ],
    edges: [
      ['clients', 'ingest'],
      ['ingest', 'log'],
      ['log', 'counters'],
      ['counters', 'merger'],
      ['merger', 'cache'],
      ['api', 'cache'],
      ['log', 'lake'],
      ['lake', 'batch'],
      ['batch', 'cache'],
    ],
    stages: [
      {
        title: 'Accept the event cheaply',
        narration:
          'A client sends a view event. The ingest service checks the shape, stamps a server time and returns right away without counting anything.',
        tradeoff:
          'Returning before the count is updated keeps the client fast and lets ingest scale on its own. The cost is that a view is not visible in the ranking for some seconds, which the requirements allow.',
        nodes: ['clients', 'ingest'],
        travel: [['clients', 'ingest']],
      },
      {
        title: 'Append to a partitioned log',
        narration:
          'Events are appended to a durable log partitioned by item id, so every event for one item lands on the same partition in order.',
        tradeoff:
          'Writing straight to a counter database would be simpler, but a hot item would hammer one row. The log absorbs spikes, can be replayed after a bug, and feeds both the live and the batch paths, at the cost of running one more system.',
        nodes: ['ingest', 'log'],
        travel: [['ingest', 'log']],
      },
      {
        title: 'Count per item, per minute',
        narration:
          'Stream counters read their partitions and keep, in memory, a count per item per minute. Because partitioning is by item, no two counters ever count the same item.',
        tradeoff:
          'Exact per-item counts in memory are easy to reason about and fine for millions of items. With hundreds of millions of distinct items, a count-min sketch plus a small heap uses far less memory but overcounts rare items slightly.',
        nodes: ['log', 'counters'],
        travel: [['log', 'counters']],
      },
      {
        title: 'Roll minutes into windows',
        narration:
          'An hourly count is the sum of the last sixty minute buckets. As the window slides, the oldest bucket is subtracted and the newest is added.',
        tradeoff:
          'Minute buckets give a smooth sliding window with bounded memory. Finer buckets make the window more precise but cost more memory; tumbling windows would be cheaper but make rankings jump on the hour.',
        nodes: ['counters'],
        travel: [],
      },
      {
        title: 'Keep a local top list',
        narration:
          'Each counter keeps a min-heap of its own top items for each window and sends that partial list, not every count, to the merger every few seconds.',
        tradeoff:
          'Sending only partial top lists cuts traffic by orders of magnitude. It is exact for the global top K because items are partitioned: an item that is in the global top must be in the top of its own partition.',
        nodes: ['counters', 'merger'],
        travel: [['counters', 'merger']],
      },
      {
        title: 'Merge into one ranking',
        narration:
          'The merger combines the partial lists from every partition, keeps the K largest, and writes the result as a snapshot keyed by window and filter.',
        tradeoff:
          'A single merger per window is simple and the input is small. It is a single point of failure, so it runs as a standby pair; if both fail, readers still see the last snapshot, only older.',
        nodes: ['merger', 'cache'],
        travel: [['merger', 'cache']],
      },
      {
        title: 'Serve reads from the snapshot',
        narration:
          'The ranking API reads the precomputed snapshot from a cache and returns it with the time it was built. Nothing is computed on the read path.',
        tradeoff:
          'Precomputing means every read is a single key lookup and the read load never touches the counters. The price is that only windows and filters chosen in advance can be served quickly; an arbitrary filter would need a slower query.',
        nodes: ['api', 'cache'],
        travel: [['api', 'cache']],
      },
      {
        title: 'Keep raw events for exact answers',
        narration:
          'The log is also copied into a cheap columnar store. A nightly batch job computes exact daily and weekly counts and overwrites the approximate snapshots for those windows.',
        tradeoff:
          'Running a fast approximate path and a slow exact path doubles some logic. It gives the best of both: a live ranking within a minute, and numbers that can be reported or paid on the next day.',
        nodes: ['log', 'lake', 'batch', 'cache'],
        travel: [
          ['log', 'lake'],
          ['lake', 'batch'],
          ['batch', 'cache'],
        ],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we count when there are too many distinct items to hold in memory?',
      options: [
        {
          name: 'Exact hash map per partition',
          pros: 'Exact counts, trivial to implement.',
          cons: 'Memory grows with the number of distinct items, most of which are seen once.',
        },
        {
          name: 'Count-min sketch plus a heap',
          pros: 'Fixed memory regardless of item count; good accuracy for heavy hitters.',
          cons: 'Only overestimates; rare items can look more popular than they are.',
        },
        {
          name: 'Space-saving (heavy hitters) counters',
          pros: 'Keeps only the top candidates with error bounds per item.',
          cons: 'Harder to merge across windows and partitions.',
        },
      ],
      choice:
        'Exact counts while they fit, switching to a count-min sketch plus heap per partition when distinct items explode. The trending list only needs the heavy hitters right, and the batch path fixes the long tail.',
    },
    {
      question: 'How do we handle one item that goes viral and floods a single partition?',
      options: [
        {
          name: 'Accept the hot partition',
          pros: 'No extra logic.',
          cons: 'One counter falls behind and the whole ranking goes stale.',
        },
        {
          name: 'Pre-aggregate at ingest',
          pros: 'Ingest nodes batch counts for a second and send one increment per item.',
          cons: 'Adds a small delay and a little state on ingest nodes.',
        },
        {
          name: 'Split hot keys into sub-keys',
          pros: 'Spreads one item across several partitions.',
          cons: 'The merger must sum sub-keys, and the local top-list shortcut is no longer exact.',
        },
      ],
      choice:
        'Pre-aggregate at ingest. A viral item becomes one message per ingest node per second, which removes the hot spot without changing how counters or the merger work.',
    },
    {
      question: 'How do we serve rankings for many categories and regions?',
      options: [
        {
          name: 'Precompute every combination',
          pros: 'Every read is a cache hit.',
          cons: 'Categories times regions times windows can mean millions of snapshots.',
        },
        {
          name: 'Precompute the popular ones, query the rest',
          pros: 'Covers almost all traffic with a manageable number of snapshots.',
          cons: 'Rare filters are slower and need an OLAP store to query.',
        },
      ],
      choice:
        'Precompute global, per-category and per-region rankings, and send rare combinations to an analytics store with a short cache. Most traffic is on a few views, so that is where precomputation pays.',
    },
  ],
  wrapUp:
    'A partitioned event log, per-minute counts with local heaps, a merger that writes top-K snapshots served from a cache, pre-aggregation for hot items, and a batch path that makes the daily numbers exact.',
};
