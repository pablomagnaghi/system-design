import type { Design } from '../types';

export const adClickAggregator: Design = {
  slug: 'ad-click-aggregator',
  title: 'Ad click aggregator',
  summary:
    'Record every click on an ad, send the user on to the advertiser without delay, and give advertisers click counts per minute that are fast to query and accurate enough to bill on.',
  difficulty: 'Hard',
  minutes: 9,
  requirements: {
    functional: [
      'When a user clicks an ad, record the click and redirect them to the advertiser’s page.',
      'Let advertisers query clicks per ad over time, at minute granularity.',
      'Filter and group results by campaign, country and device.',
    ],
    nonFunctional: [
      'Handle tens of thousands of clicks per second, with spikes several times higher.',
      'The redirect adds only a few milliseconds and never fails because analytics is slow.',
      'Counts show up in queries within about a minute.',
      'Billing-grade accuracy: no double counting and no lost clicks once a click reaches the stream, reconciled daily.',
    ],
    outOfScope: [
      'Choosing which ad to show (the ad auction).',
      'Advanced click-fraud models beyond simple deduplication.',
    ],
  },
  entities: [
    {
      name: 'Click event',
      description:
        'Click id, impression id, ad id, campaign id, timestamp, country, device. Append-only.',
    },
    {
      name: 'Ad',
      description: 'Ad id, campaign, advertiser, destination URL.',
    },
    {
      name: 'Minute aggregate',
      description: 'Ad id, minute, dimensions (country, device) and click count.',
    },
  ],
  api: [
    {
      method: 'GET',
      path: '/click?impression={signedId}',
      description:
        'Records the click and responds with a 302 redirect to the ad’s destination URL.',
    },
    {
      method: 'GET',
      path: '/ads/{adId}/clicks?from=&to=&groupBy=country',
      description: 'Returns click counts per minute (or rolled up per hour or day) for the range.',
    },
  ],
  dataFlow: [
    'A click hits the click service, which writes the event to a stream and redirects the user.',
    'A stream aggregator deduplicates by impression and counts clicks per ad per minute.',
    'Minute counts are written to an analytics store that advertisers query.',
    'A daily batch job recounts from raw events and corrects any minute that disagrees.',
  ],
  highLevel: {
    label: 'Count a click and query it',
    intro:
      'Start with clicks counted on the redirect path and watch them slow every click down. Then see the stream, the aggregator, the query side and the daily reconciliation join as the design grows. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      { id: 'user', title: 'User', detail: 'Clicks an ad', column: 0, row: 'middle' },
      { id: 'click', title: 'Click service', detail: 'Log + redirect', column: 1, row: 'middle' },
      { id: 'site', title: 'Advertiser site', detail: 'Landing page', column: 1, row: 'top' },
      {
        id: 'stream',
        title: 'Click stream',
        detail: 'Partitioned by ad',
        column: 2,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'agg',
        title: 'Stream aggregator',
        detail: 'Dedup, per minute',
        column: 3,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'olap',
        title: 'Analytics store',
        detail: 'Columnar, by minute',
        column: 4,
        row: 'middle',
      },
      {
        id: 'query',
        title: 'Query API',
        detail: 'Rollups, filters',
        column: 5,
        row: 'middle',
        appearsAt: 6,
      },
      {
        id: 'advertiser',
        title: 'Advertisers',
        detail: 'Dashboards',
        column: 5,
        row: 'top',
        appearsAt: 6,
      },
      {
        id: 'raw',
        title: 'Raw click store',
        detail: 'Every event',
        column: 2,
        row: 'bottom',
        appearsAt: 7,
      },
      {
        id: 'recon',
        title: 'Reconciliation',
        detail: 'Daily batch',
        column: 3,
        row: 'bottom',
        appearsAt: 8,
      },
    ],
    edges: [
      ['user', 'click'],
      ['click', 'site', '302'],
      ['click', 'stream'],
      ['stream', 'agg'],
      ['agg', 'olap'],
      ['olap', 'query'],
      ['advertiser', 'query'],
      ['stream', 'raw'],
      ['raw', 'recon'],
      ['recon', 'olap', 'corrections'],
    ],
    stages: [
      {
        title: 'Counting on the click path',
        narration:
          'The simplest version adds one to the ad’s counter in the analytics store before it redirects. A campaign takes off, thousands of clicks a second update the same few rows, and the redirect waits behind them: users see a slow page and some clicks time out.',
        tradeoff:
          'Counting in the request is easy to reason about, but it ties the user’s redirect to the slowest write in the system. A columnar store is built for large batched writes, not one tiny update per click, so the counting has to move off the path the user waits on.',
        nodes: ['user', 'click', 'olap'],
        travel: [['user', 'click']],
        short: 'Slow clicks',
        metrics: {
          users: '10M',
          requestsPerSecond: '20K',
          p95Latency: '900 ms',
          errorRate: '3%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { click: 85, olap: 97 },
        traffic: [{ edge: ['user', 'click'], kind: 'failed' }],
      },
      {
        title: 'Redirect first, never block',
        narration:
          'Counting leaves the click path. The ad link points at the click service with a signed impression id. The service checks the signature, writes the click to the stream and answers with a redirect to the advertiser’s page.',
        tradeoff:
          'Routing clicks through our own service is the only way to count them reliably; trusting a script on the advertiser’s page would lose clicks to ad blockers and slow pages. The cost is one extra hop for the user, so the service does nothing slow on that path.',
        nodes: ['user', 'click', 'site'],
        travel: [
          ['user', 'click'],
          ['click', 'site'],
        ],
        short: 'Redirect',
        metrics: {
          users: '10M',
          requestsPerSecond: '20K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
        },
        load: { click: 30, site: 10 },
      },
      {
        title: 'Append to a durable stream',
        narration:
          'The click is appended to a replicated stream partitioned by ad id. The service only waits for the append to be acknowledged, not for any counting.',
        tradeoff:
          'Writing to a stream instead of a database keeps the redirect fast and absorbs traffic spikes. If the stream itself is unreachable, the service buffers clicks to local disk and still redirects, trading a delay in counts for never breaking the user’s click. A host that dies before its buffer drains takes those few clicks with it, a rare loss the design accepts.',
        nodes: ['click', 'stream'],
        travel: [['click', 'stream']],
        short: 'Stream',
        metrics: {
          users: '10M',
          requestsPerSecond: '20K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
        },
        load: { click: 30, stream: 25 },
      },
      {
        title: 'Deduplicate by impression',
        narration:
          'The aggregator keeps the impression ids it has seen in the last few minutes. A second click on the same impression, from a double tap or a retry, is dropped.',
        tradeoff:
          'Deduplicating on a signed impression id stops both accidental doubles and simple replay abuse. Keeping ids only for a bounded window keeps memory small; a duplicate that arrives later is caught by the daily reconciliation instead.',
        nodes: ['stream', 'agg'],
        travel: [['stream', 'agg']],
        short: 'Dedup',
        metrics: {
          users: '10M',
          requestsPerSecond: '20K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
        },
        load: { stream: 25, agg: 35 },
      },
      {
        title: 'Count per ad per minute',
        narration:
          'The aggregator groups clicks into one-minute windows by event time, per ad and dimension, and emits a count when the window closes. Late events within a grace period still land in the right minute.',
        tradeoff:
          'Event-time windows put each click in the minute it happened, not the minute it was processed, which is what advertisers expect. A grace period for late events adds a small delay before each minute is final.',
        nodes: ['agg'],
        travel: [],
        short: 'Minute counts',
        metrics: {
          users: '10M',
          requestsPerSecond: '20K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
        },
        load: { agg: 45 },
      },
      {
        title: 'Exactly-once effect in the sink',
        narration:
          'The aggregator checkpoints its stream offsets and its state together, and writes each minute as an upsert keyed by ad, minute and dimensions. Each upsert carries the full count for that minute, not an increment.',
        tradeoff:
          'Checkpoints plus idempotent upserts mean a restart replays from the last checkpoint and overwrites the same rows with the same full counts. Events are processed at least once, but nothing is counted twice. It requires a sink that supports upserts and some care in the checkpoint interval, which trades recovery time against overhead.',
        nodes: ['agg', 'olap'],
        travel: [['agg', 'olap']],
        short: 'Idempotent sink',
        metrics: {
          users: '10M',
          requestsPerSecond: '20K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
        },
        load: { agg: 45, olap: 20 },
      },
      {
        title: 'Query from a columnar store',
        narration:
          'Minute counts land in a columnar analytics store, with hourly and daily rollups built in the background. The query API picks the coarsest rollup that answers the request.',
        tradeoff:
          'A columnar store scans and groups billions of rows quickly and compresses well. Precomputed rollups make a month-long chart cheap, at the cost of storing the same clicks at several granularities.',
        nodes: ['olap', 'query', 'advertiser'],
        travel: [
          ['olap', 'query'],
          ['advertiser', 'query'],
        ],
        short: 'Query',
        metrics: {
          users: '10M',
          requestsPerSecond: '20K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
        },
        load: { olap: 35, query: 25 },
      },
      {
        title: 'Keep every raw click',
        narration:
          'Every event in the stream is also copied to cheap object storage, partitioned by day and hour.',
        tradeoff:
          'Keeping raw events costs storage but makes every number explainable and recomputable. Without them, a bug in the aggregator would mean a wrong bill that nobody could correct.',
        nodes: ['stream', 'raw'],
        travel: [['stream', 'raw']],
        short: 'Raw clicks',
        metrics: {
          users: '10M',
          requestsPerSecond: '20K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
        },
        load: { stream: 30, raw: 20 },
      },
      {
        title: 'Reconcile daily',
        narration:
          'A daily batch job recounts clicks from the raw store with full deduplication and compares them to the streamed counts. Minutes that disagree are overwritten, and large differences raise an alert.',
        tradeoff:
          'Running both a streaming and a batch path is extra work to maintain. It is what lets the live numbers be fast and approximate while the billed numbers are exact, and it catches streaming bugs before invoices go out.',
        nodes: ['raw', 'recon', 'olap'],
        travel: [
          ['raw', 'recon'],
          ['recon', 'olap'],
        ],
        short: 'Reconcile',
        metrics: {
          users: '10M',
          requestsPerSecond: '20K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
        },
        load: { raw: 40, recon: 80, olap: 40 },
        traffic: [{ edge: ['raw', 'recon'], kind: 'heavy' }],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we make sure no click is lost between the redirect and the count?',
      options: [
        {
          name: 'Write to the stream before redirecting',
          pros: 'A redirect means the click is durably recorded.',
          cons: 'A stream outage would block or slow every redirect.',
        },
        {
          name: 'Redirect first, log asynchronously',
          pros: 'Fastest possible redirect.',
          cons: 'A crash between redirect and log loses the click.',
        },
        {
          name: 'Stream write with a local disk fallback',
          pros: 'Durable in the normal case and never blocks the user.',
          cons: 'Buffered clicks arrive late and need a shipper to drain them.',
        },
      ],
      choice:
        'Write to the stream with a short timeout and fall back to a local disk buffer. The redirect never waits long, and a shipper drains the buffer into the stream when it recovers. The daily reconciliation reads the raw store, which is fed by the stream, so it corrects counting errors but cannot recover a click that never reached the stream. A host lost with an undrained buffer loses those clicks; the design accepts that rare loss, keeps the buffer small by draining fast, and alerts when it grows.',
    },
    {
      question: 'How do we handle a popular ad that floods one partition?',
      options: [
        {
          name: 'Partition by ad id only',
          pros: 'All counts for an ad live in one place; simple aggregation.',
          cons: 'A viral campaign overloads one aggregator task.',
        },
        {
          name: 'Salt hot ads into sub-partitions',
          pros: 'Spreads one ad across several tasks.',
          cons: 'Needs a second step to sum the sub-counts, and impression dedup must stay on one task per impression.',
        },
      ],
      choice:
        'Partition by ad id, and add a salt only for ads detected as hot. The salt is a hash of the impression id, so a given impression always lands on the same sub-partition. A small merge step sums the salted counts per minute.',
    },
    {
      question: 'Where do we compute the aggregates?',
      options: [
        {
          name: 'Batch only',
          pros: 'Simple and exact.',
          cons: 'Advertisers wait hours to see their numbers.',
        },
        {
          name: 'Stream only',
          pros: 'Fresh numbers within a minute.',
          cons: 'Bugs and late data leave wrong numbers with no way to fix them.',
        },
        {
          name: 'Stream plus batch reconciliation',
          pros: 'Fresh numbers that become exact the next day.',
          cons: 'Two code paths that must agree on counting rules.',
        },
      ],
      choice:
        'Stream plus batch reconciliation, sharing one library for deduplication and counting rules so the two paths cannot drift apart.',
    },
  ],
  wrapUp:
    'A fast redirect that appends to a partitioned stream, an event-time aggregator that deduplicates by impression and writes idempotent minute counts, a columnar store with rollups, and a daily batch that makes the numbers billable.',
};
