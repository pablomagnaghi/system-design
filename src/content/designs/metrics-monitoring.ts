import type { Design } from '../types';

export const metricsMonitoring: Design = {
  slug: 'metrics-monitoring',
  title: 'Metrics monitoring and alerting',
  summary:
    'Collect numeric metrics from hundreds of thousands of machines, store them as time series for months, draw dashboards in under a second, and page the right person when something crosses a line.',
  difficulty: 'Hard',
  requirements: {
    functional: [
      'Collect metrics (counters, gauges, histograms) with labels such as host, service and region.',
      'Query a metric over a time range, filtered and grouped by labels, for dashboards.',
      'Define alert rules on queries and notify on-call people through several channels.',
    ],
    nonFunctional: [
      'Ingest tens of millions of data points per second without dropping data during spikes.',
      'Dashboard queries over recent data return in under a second.',
      'Alerts fire within a minute of the condition becoming true.',
      'Keep raw data for weeks and downsampled data for a year or more, at low cost.',
    ],
    outOfScope: ['Log search and distributed tracing.', 'Automatic anomaly detection models.'],
  },
  entities: [
    {
      name: 'Series',
      description:
        'A metric name plus a set of label values, for example request count for one service in one region.',
    },
    {
      name: 'Data point',
      description: 'A timestamp and a numeric value belonging to one series.',
    },
    {
      name: 'Alert rule',
      description: 'A query, a threshold, how long it must hold, a severity and who to notify.',
    },
    {
      name: 'Alert',
      description: 'One firing of a rule: state (pending, firing, resolved), start time, labels.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/write',
      description:
        'Batch of series with their data points, compressed. Sent by agents every few seconds.',
    },
    {
      method: 'GET',
      path: '/query?expr=&from=&to=&step=',
      description: 'Evaluates a query expression and returns one or more series of points.',
    },
    {
      method: 'POST',
      path: '/rules',
      description: 'Creates or updates an alert rule: expression, threshold, duration, routing.',
    },
  ],
  dataFlow: [
    'Agents on each host batch metrics and push them to an ingest gateway.',
    'The gateway writes batches to a durable queue; storage nodes consume them into a time-series database.',
    'Dashboards query recent data from the database and older data from downsampled cold storage.',
    'An evaluator runs alert rules on a schedule and sends firing alerts to a notifier that routes them.',
  ],
  highLevel: {
    label: 'Collect a metric and fire an alert',
    intro:
      'Follow one data point from the host that produced it into storage, onto a dashboard, and into an alert that pages someone. Press play, or step through the stages.',
    nodes: [
      { id: 'agents', title: 'Host agents', detail: 'Batch + push', column: 0, row: 'middle' },
      { id: 'gateway', title: 'Ingest gateway', detail: 'Auth, limits', column: 1, row: 'middle' },
      { id: 'queue', title: 'Write queue', detail: 'Buffer spikes', column: 2, row: 'middle' },
      {
        id: 'tsdb',
        title: 'Time-series DB',
        detail: 'Sharded by series',
        column: 3,
        row: 'middle',
      },
      { id: 'cold', title: 'Cold storage', detail: 'Downsampled blocks', column: 3, row: 'top' },
      { id: 'query', title: 'Query service', detail: 'Fan out, merge', column: 4, row: 'middle' },
      { id: 'dashboards', title: 'Dashboards', detail: 'Charts', column: 5, row: 'middle' },
      { id: 'rules', title: 'Alert rules', detail: 'Query + threshold', column: 3, row: 'bottom' },
      {
        id: 'evaluator',
        title: 'Rule evaluator',
        detail: 'Every minute',
        column: 4,
        row: 'bottom',
      },
      { id: 'notifier', title: 'Notifier', detail: 'Dedup, route', column: 5, row: 'bottom' },
    ],
    edges: [
      ['agents', 'gateway'],
      ['gateway', 'queue'],
      ['queue', 'tsdb'],
      ['tsdb', 'cold', 'compact'],
      ['tsdb', 'query'],
      ['cold', 'query'],
      ['query', 'dashboards'],
      ['rules', 'evaluator'],
      ['query', 'evaluator'],
      ['evaluator', 'notifier'],
    ],
    stages: [
      {
        title: 'Agents batch and push',
        narration:
          'An agent on each host collects metrics from the machine and its services, keeps counters locally, and every ten seconds pushes a compressed batch to the ingest gateway.',
        tradeoff:
          'Pushing works through firewalls and for short-lived jobs, and batching cuts requests by orders of magnitude. Pulling (the server scraping each host) makes it easy to tell a dead host from a quiet one, so push systems need a separate heartbeat to catch silent hosts.',
        nodes: ['agents', 'gateway'],
        travel: [['agents', 'gateway']],
      },
      {
        title: 'Protect the pipeline at the door',
        narration:
          'The gateway authenticates the sender, enforces per-tenant limits on data points and on the number of distinct series, and rejects labels that would explode cardinality.',
        tradeoff:
          'Limits at the edge stop one bad deploy, such as a label holding a user id, from creating millions of series and slowing everyone. The cost is that a team can hit its limit and lose data until it fixes its labels, so limits come with clear errors and dashboards.',
        nodes: ['gateway'],
        travel: [],
      },
      {
        title: 'Buffer writes in a queue',
        narration:
          'Accepted batches are written to a durable, partitioned queue. Storage nodes consume from it at their own pace.',
        tradeoff:
          'The queue absorbs spikes and lets storage be restarted or upgraded without losing data, at the cost of a few seconds of extra delay and one more system to run. Writing straight to storage is simpler but drops data whenever storage is slow.',
        nodes: ['gateway', 'queue'],
        travel: [['gateway', 'queue']],
      },
      {
        title: 'Store as compressed time series',
        narration:
          'Storage nodes, sharded by a hash of the series, append points to in-memory blocks and flush them to disk every couple of hours. Timestamps are delta-encoded and values are compressed against the previous one.',
        tradeoff:
          'A time-series layout compresses a point to a couple of bytes and makes range reads sequential, which a general database cannot match. It is bad at updating old points, which metrics almost never need.',
        nodes: ['queue', 'tsdb'],
        travel: [['queue', 'tsdb']],
      },
      {
        title: 'Downsample into cold storage',
        narration:
          'Older blocks are compacted, downsampled to one point per five minutes or per hour with min, max, sum and count, and moved to object storage.',
        tradeoff:
          'Downsampling cuts long-term storage by one or two orders of magnitude, and keeping min and max preserves spikes on a year-long chart. Detail older than a few weeks is gone for good, which is accepted for metrics.',
        nodes: ['tsdb', 'cold'],
        travel: [['tsdb', 'cold']],
      },
      {
        title: 'Query recent and old data together',
        narration:
          'The query service finds which series match the labels using an inverted index, fans out to the shards that hold them, reads cold storage for older ranges, and merges the results.',
        tradeoff:
          'Splitting by time range keeps recent queries fast on local disks while old data sits on cheap storage. Fan-out queries are only as fast as the slowest shard, so the query service caches results for common dashboard panels.',
        nodes: ['tsdb', 'cold', 'query', 'dashboards'],
        travel: [
          ['tsdb', 'query'],
          ['cold', 'query'],
          ['query', 'dashboards'],
        ],
      },
      {
        title: 'Evaluate alert rules on a schedule',
        narration:
          'The evaluator loads rules and runs each one every minute through the query service. A rule that is true for its full duration, for example five minutes, moves from pending to firing.',
        tradeoff:
          'Requiring a condition to hold for a while removes most noise from brief spikes, at the cost of alerting a few minutes later. Rules are sharded across evaluators so one slow rule never delays the others.',
        nodes: ['rules', 'evaluator', 'query'],
        travel: [
          ['rules', 'evaluator'],
          ['query', 'evaluator'],
        ],
      },
      {
        title: 'Route, group and silence',
        narration:
          'Firing alerts go to the notifier, which groups related alerts into one page, routes them by service and severity to chat, email or a paging tool, and respects silences during maintenance.',
        tradeoff:
          'Grouping turns a hundred alerts from one outage into one page, which is what keeps on-call people listening. The risk is hiding a second, unrelated problem inside the group, so groups are keyed by service and alert name rather than by everything.',
        nodes: ['evaluator', 'notifier'],
        travel: [['evaluator', 'notifier']],
      },
      {
        title: 'Watch the watcher',
        narration:
          'The monitoring system sends itself a heartbeat alert that always fires. An external service pages if that heartbeat stops arriving.',
        tradeoff:
          'A monitoring outage is silent by nature: no data means no alerts. A dead man’s switch outside the system costs almost nothing and is the only way to learn that alerting itself is broken.',
        nodes: ['evaluator', 'notifier'],
        travel: [],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we keep high cardinality from taking the system down?',
      options: [
        {
          name: 'No limits',
          pros: 'Teams can label anything.',
          cons: 'One label with unbounded values creates millions of series and exhausts index memory.',
        },
        {
          name: 'Per-tenant series limits at ingest',
          pros: 'Contains the damage to the tenant that caused it.',
          cons: 'New series are dropped once the limit is hit.',
        },
        {
          name: 'Drop or aggregate known bad labels',
          pros: 'Keeps the useful part of the data.',
          cons: 'Needs rules per label, maintained over time.',
        },
      ],
      choice:
        'Per-tenant series limits at the gateway, plus rules that strip labels known to be unbounded. High-cardinality questions like per-user behavior belong in logs or traces, not metrics.',
    },
    {
      question: 'Push or pull collection?',
      options: [
        {
          name: 'Pull (scrape each target)',
          pros: 'The server controls the rate and knows instantly when a target is down.',
          cons: 'Needs service discovery and network access to every host; awkward for short jobs.',
        },
        {
          name: 'Push from agents',
          pros: 'Works across networks and for short-lived jobs; easy to buffer and batch.',
          cons: 'A misbehaving client can flood the system; a silent host is not obvious.',
        },
      ],
      choice:
        'Push from agents through a gateway with limits, with an "up" heartbeat metric per host. It fits large fleets across many networks, and the heartbeat restores the "is it down?" signal that pull gives for free.',
    },
    {
      question: 'How do we keep alerting working when storage is struggling?',
      options: [
        {
          name: 'Evaluate rules on the shared query path',
          pros: 'One query engine, consistent results with dashboards.',
          cons: 'A heavy dashboard query can slow alert evaluation exactly during an incident.',
        },
        {
          name: 'Dedicated query capacity for alerts',
          pros: 'Alerts keep their own resources and priority.',
          cons: 'More capacity to run that sits mostly idle.',
        },
        {
          name: 'Evaluate on the ingest stream',
          pros: 'Fastest alerts, independent of storage.',
          cons: 'Only works for simple rules; windowed aggregations get hard.',
        },
      ],
      choice:
        'Dedicated query capacity with priority for the evaluator, and stream evaluation for a handful of critical, simple rules. During an incident, alerts matter more than dashboards.',
    },
  ],
  wrapUp:
    'Agents push batches through a gateway that enforces cardinality limits, a queue buffers writes into a sharded, compressed time-series store with downsampled cold storage, and a prioritized evaluator feeds a notifier that groups and routes pages.',
};
