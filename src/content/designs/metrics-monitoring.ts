import type { Design } from '../types';

export const metricsMonitoring: Design = {
  slug: 'metrics-monitoring',
  title: 'Metrics monitoring and alerting',
  summary:
    'Collect 10 million samples a second from 100,000 hosts, keep them as time series for 13 months, draw a dashboard in under a second, and page one person per firing of a rule, with an outside watchdog that pages when the monitoring itself goes quiet.',
  difficulty: 'Hard',
  minutes: 14,
  requirements: {
    functional: [
      'Agents push batches of samples (counters, gauges and histogram buckets) with labels such as service, region and host. Every series belongs to one tenant, a team with its own token and limits.',
      'Query a metric over a time range, filtered and grouped by labels, for dashboards: the last hours at full 10-second detail, months and years from rolled-up data.',
      'Define alert rules on queries, with a threshold and a duration the condition must hold, and page the on-call person through a paging provider. Silence a rule during maintenance.',
      'Show each tenant its usage against its limits: samples per second, active series and samples dropped, with the reason.',
    ],
    nonFunctional: [
      'Ingest 10 million samples a second, 10,000 batches of about 1,000 samples, for 100 million active series, with room for 1.5 times that.',
      'An accepted batch is not dropped by a crash: the 200 is answered only after the batch is stored in a replicated queue across three Availability Zones, and storage nodes rebuild what they held in memory from that queue.',
      'A sample is stored once per series and timestamp, however many times its batch is retried or replayed.',
      'An accepted sample can be queried within 15 seconds for 99% of batches. A dashboard over recent hours answers within 1 second for 99% of queries, and a chart over months within 5 seconds.',
      'Raw 10-second samples are kept 15 days, 5-minute rollups 90 days and 1-hour rollups 13 months.',
      'A page reaches the paging provider within 2 minutes of the moment a condition has held for its rule’s duration, and one firing of one rule pages one time, even with two evaluators working every rule.',
      'One tenant’s label mistake or heavy query cannot take ingestion, storage or alerting away from the others.',
      'The system does not rely on itself to say it is down: signals from outside it page when samples stop flowing or rules stop being evaluated.',
    ],
    outOfScope: [
      'Log search and distributed tracing. Questions about one user or one request belong there, not in labels.',
      'Anomaly detection models and forecasts. Rules here are thresholds on queries.',
      'On-call schedules, escalation chains and acknowledgement. The paging provider owns them; this design hands it one event per firing.',
      'The dashboard editor and the query language itself. The design assumes expressions that select series by label and aggregate them.',
      'Pulling metrics from targets that cannot run an agent. A small push relay covers them and is not designed here.',
      'Re-evaluating alert rules over data that arrives late. Rules read what has arrived when they run.',
    ],
  },
  entities: [
    {
      name: 'Tenant',
      description:
        'A team: an id, hashed tokens, limits (samples per second, active series, concurrent queries, rules), a list of metric names to drop at the door and a topic with its escalation contacts.',
    },
    {
      name: 'Series',
      description:
        'A metric name plus a sorted set of labels. The gateway adds the tenant and the agent id as labels, so a series belongs to one tenant and one sender, and therefore to one partition.',
    },
    {
      name: 'Sample',
      description:
        'A timestamp in milliseconds and a 64-bit float, belonging to one series. The series and the timestamp are its identity: a second sample with the same pair is a repeat.',
    },
    {
      name: 'Batch',
      description:
        'What an agent sends every 10 seconds: about 1,000 series with one sample each, compressed, about 20 KB. One batch is one record in the write queue.',
    },
    {
      name: 'Block',
      description:
        'An immutable object in block storage for one partition and one time window: compressed chunks per series, a label index and, in its metadata, the queue offset to resume from. Raw blocks cover 2 hours, 5-minute rollup blocks a day and 1-hour rollup blocks a calendar month.',
    },
    {
      name: 'Alert rule',
      description:
        'An id chosen by the tenant and unique inside it, a version, a query, a threshold, the duration it must hold, a route (page, chat or heartbeat) and its target.',
    },
    {
      name: 'Rule state',
      description:
        'One row per rule, keyed by tenant and rule id: the last minute evaluated, the instances that are pending or firing (one per label set, at most 200), and the episode: an id, when it started, when the page was sent, when it resolved.',
    },
    {
      name: 'Episode',
      description:
        'One firing of one rule, from the first instance that fires until no instance has fired for 5 minutes. Its id, a hash of the tenant, the rule id and the start minute, is the deduplication key sent to the paging provider.',
    },
    {
      name: 'Silence',
      description:
        'An id chosen by the caller, a rule or a set of label matchers, a start, an end and who created it.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/write',
      description:
        'A compressed batch of series with their samples, with the tenant token. Answers 200 after the batch is stored in the write queue. It needs no idempotency key: a sample is identified by its series and timestamp, so a repeated batch stores nothing new. 429 with Retry-After when the tenant is over its sample rate; 400 for a sample older than 1 hour or more than 5 minutes ahead.',
    },
    {
      method: 'GET',
      path: '/query?expr=&from=&to=&step=',
      description:
        'Evaluates an expression for the caller’s tenant and returns series of points. The step picks the tier: raw under 5 minutes, 5-minute rollups under 1 hour, 1-hour rollups above. A result that could not reach every partition is marked partial.',
    },
    {
      method: 'PUT',
      path: '/rules/{ruleId}',
      description:
        'Creates or replaces a rule. The id is chosen by the caller and the body carries the version it replaces, checked by a conditional write, so a repeated or stale request changes nothing. Evaluators pick the change up within a minute.',
    },
    {
      method: 'GET',
      path: '/rules/{ruleId}/state',
      description:
        'The instances pending or firing, the current episode and whether its page was sent.',
    },
    {
      method: 'PUT',
      path: '/silences/{silenceId}',
      description:
        'Creates or replaces a silence. The caller’s id is the idempotency key. A page for a silenced rule is held, and sent when the silence ends if the rule still fires. While it is held, its episode is not counted as unsent and is not escalated.',
    },
    {
      method: 'PUT',
      path: '/settings/dropped-metrics/{name}',
      description:
        'Adds a metric name to the tenant’s drop list; DELETE removes it. Writing the same name twice changes nothing. Gateways apply the list within 60 seconds.',
    },
    {
      method: 'GET',
      path: '/usage',
      description:
        'The tenant’s sample rate, active series per partition against its cap there, and samples dropped in the last hours by reason.',
    },
  ],
  dataFlow: [
    'An agent on each host batches its samples every 10 seconds and posts them to the ingest gateway, which checks the token, the timestamps and the tenant’s sample rate.',
    'The gateway writes the batch as one record to the partition of the write queue chosen by tenant and agent, and answers 200 when the queue has it on two brokers at least.',
    'Two storage nodes in different Availability Zones consume each partition into memory, drop repeats by series and timestamp, and answer queries for the last hours.',
    'Every 2 hours each node cuts a block for the window that closed and writes it to block storage with a conditional put, so one of the two copies is kept. A compactor rolls blocks up to 5-minute and 1-hour points.',
    'The query service picks a tier by step, asks storage nodes for the last hours, reads every block that overlaps the range, merges the two, and caches the parts of a result that can no longer change.',
    'Two evaluators run every rule each minute through their own query pool. One of them claims the minute with a conditional write on the rule’s row and applies the result.',
    'A rule that starts firing opens an episode, and the evaluator sends one event to the paging provider with the episode id as its deduplication key.',
    'A heartbeat that crosses the path every minute, through one partition on the way in and through all of them on the way out, lands in a watchdog outside the system, which pages if it stops.',
  ],
  highLevel: {
    label: 'Collect a sample and fire an alert',
    intro:
      'Follow one sample from the host that produced it into storage, onto a dashboard and into an alert that pages someone. The design grows as it goes: a queue makes acceptance durable, two storage nodes hold each partition, a year-long chart overloads the query path until rollups fix it, and alerting joins last with a watchdog outside the system. Numbers are illustrative. Press play, or step through the stages.',
    lanes: { top: 'Long-term data', bottom: 'Alerting' },
    nodes: [
      { id: 'agents', title: 'Host agents', detail: 'Batch + push', column: 0, row: 'middle' },
      { id: 'gateway', title: 'Ingest gateway', detail: 'Auth, limits', column: 1, row: 'middle' },
      {
        id: 'queue',
        title: 'Write queue',
        detail: '24 h of batches',
        column: 2,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'tsdb',
        title: 'Storage nodes',
        detail: 'Two per partition',
        column: 3,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'blocks',
        title: 'Block storage',
        detail: 'Raw + rollups',
        column: 3,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'compactor',
        title: 'Compactor',
        detail: '5 min, 1 h points',
        column: 2,
        row: 'top',
        appearsAt: 6,
      },
      {
        id: 'query',
        title: 'Query service',
        detail: 'Tier, fan out, cache',
        column: 4,
        row: 'middle',
        appearsAt: 5,
      },
      {
        id: 'dashboards',
        title: 'Dashboards',
        detail: 'Charts',
        column: 5,
        row: 'top',
        appearsAt: 5,
      },
      {
        id: 'state',
        title: 'Rule state',
        detail: 'One row per rule',
        column: 3,
        row: 'bottom',
        appearsAt: 8,
      },
      {
        id: 'evaluator',
        title: 'Rule evaluators',
        detail: 'Two per rule',
        column: 4,
        row: 'bottom',
        appearsAt: 8,
      },
      {
        id: 'watchdog',
        title: 'Outside watchdog',
        detail: 'Pages on silence',
        column: 5,
        row: 'middle',
        appearsAt: 10,
      },
      {
        id: 'pager',
        title: 'Paging provider',
        detail: 'One per episode',
        column: 5,
        row: 'bottom',
        appearsAt: 9,
      },
    ],
    edges: [
      ['agents', 'gateway'],
      ['gateway', 'queue'],
      ['queue', 'tsdb'],
      ['tsdb', 'blocks', 'cut'],
      ['blocks', 'compactor'],
      ['tsdb', 'query'],
      ['blocks', 'query'],
      ['query', 'dashboards'],
      ['evaluator', 'query', 'ask'],
      ['evaluator', 'state'],
      ['evaluator', 'pager'],
      ['evaluator', 'watchdog'],
    ],
    stages: [
      {
        title: 'Agents batch and push',
        narration:
          'An agent on each of 100,000 hosts collects about 1,000 series from the machine and its services. Every 10 seconds it compresses one sample per series into a batch of about 20 KB and posts it to the ingest gateway with its tenant’s token: 10,000 batches a second, 10 million samples. A batch that gets no 200 stays on the agent’s disk for up to an hour and is sent again.',
        tradeoff:
          'Pushing works across networks and for hosts that live a few minutes, and one batch replaces a thousand requests. The cost is that a silent host looks the same as a host with nothing to say, so every agent sends an "up" series and a rule compares it with the hosts seen ten minutes earlier. Pulling would give that signal for free and would need service discovery and a route into every network.',
        nodes: ['agents', 'gateway'],
        travel: [['agents', 'gateway']],
        short: 'Push',
        metrics: {
          requestsPerSecond: '10K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Samples per second', value: '10M' }],
        },
        load: { agents: 10, gateway: 50 },
      },
      {
        title: 'Limits at the door',
        narration:
          'The gateway turns the token into a tenant, adds the tenant and the agent id as labels, and refuses what it can judge alone: a sample older than 1 hour or more than 5 minutes ahead, a series with too many labels, a metric name on the tenant’s drop list, and a tenant above its sample rate, which gets a 429. Each of the 40 gateway tasks holds a local token bucket per tenant, refilled at the tenant’s rate divided by 40 and never at less than 100 samples a second, with room for a few batches.',
        tradeoff:
          'Local buckets need no shared store in the write path; the cost is that a tenant whose traffic lands unevenly is limited a little early, and that the floor, without which a tenant of five hosts would get a share far smaller than one batch, lets a small tenant send up to 40 × 100 = 4,000 samples a second whatever its limit says. The limit that matters most, the number of active series, cannot be checked here, because a stateless gateway does not know which series already exist. It is enforced later, by the storage node that would create the series.',
        nodes: ['gateway'],
        travel: [],
        short: 'Limits',
        metrics: {
          requestsPerSecond: '10K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Samples per second', value: '10M' }],
        },
        load: { gateway: 50 },
      },
      {
        title: 'Queue first, then answer 200',
        narration:
          'The gateway writes each accepted batch as one record to a replicated, partitioned queue and answers 200 only when the queue confirms the record is on at least two of its three replicas, each in another Availability Zone. The partition is a hash of tenant and agent, so one host always lands on the same one of 200 partitions. The queue keeps 24 hours of records.',
        tradeoff:
          'The queue is the one durable write in the request, so there is nothing to lose after the 200 and storage can be slow, restarted or down for hours while agents keep getting their answer. It costs a cluster to run, about 52 TB of disk, and a second or two between the 200 and the first query that sees the sample. Writing straight to storage nodes would be faster to query and would push every storage hiccup back to 100,000 agents.',
        nodes: ['gateway', 'queue'],
        travel: [['gateway', 'queue']],
        short: 'Queue',
        metrics: {
          requestsPerSecond: '10K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Queue write', value: '200 MB/s' },
            { label: 'Per partition', value: '1 MB/s' },
          ],
        },
        load: { gateway: 50, queue: 45 },
        traffic: [{ edge: ['gateway', 'queue'], kind: 'heavy' }],
      },
      {
        title: 'Two storage nodes per partition',
        narration:
          'Each partition is consumed by two storage nodes in different Availability Zones. A node keeps the last hours in memory: per series, timestamps stored as the change in their spacing and values as the bits that differ from the previous value, about 1.5 bytes a sample. A sample whose series and timestamp are already there is dropped, which is what makes a retried batch harmless. A node that restarts reads the queue again from a stored offset, and a node answers queries only while it is within about 10 seconds of the end of the log, whether it is replaying after a restart or fell behind while running.',
        tradeoff:
          'The second node is not there for durability, since the queue already holds everything; it is there so that dashboards and alerts keep reading recent data during the 23 minutes a restarted node needs to replay. It doubles the memory, 100 nodes in place of 50. Keeping a log on each node’s disk would shorten the replay and add a second place where an accepted sample lives.',
        nodes: ['queue', 'tsdb'],
        travel: [['queue', 'tsdb']],
        short: 'In memory',
        metrics: {
          requestsPerSecond: '10K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Active series', value: '100M' },
            { label: 'Accept to queryable p99', value: '4 s' },
          ],
        },
        load: { queue: 45, tsdb: 55 },
      },
      {
        title: 'Cut a block every two hours',
        narration:
          'Time is cut into 2-hour windows. Because no sample older than an hour is accepted, a window can be closed 70 minutes after it ends: the node writes its series, chunks and label index as one object and uploads it with a put that succeeds only if the object does not exist. Both nodes of a partition build the same block from the same records; the first upload wins and the second is refused: that node discards the block it built and keeps the window in memory for as long as if its own upload had succeeded. The block’s metadata carries the queue offset from which everything not yet in a block can be read again.',
        tradeoff:
          'A conditional put makes the block the single owner of its window without any lock between the two nodes. Keeping the resume offset inside the block removes a second write that could disagree with it. The cost is memory: a node holds up to about 4 hours of samples, and a restart replays up to 205 minutes of the queue.',
        nodes: ['tsdb', 'blocks'],
        travel: [['tsdb', 'blocks']],
        short: 'Blocks',
        metrics: {
          requestsPerSecond: '10K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Raw blocks per day', value: '2,400' },
            { label: 'Raw data per day', value: '1.3 TB' },
          ],
        },
        load: { tsdb: 55, blocks: 20 },
      },
      {
        title: 'A year-long chart reads raw samples',
        narration:
          'A query service and dashboards join so people can see the data. Someone opens a chart of one service over the last year. Suppose every raw block were still there: the query matches 2,000 series and reads 3.15 million 10-second samples for each, 6.3 billion samples and about 9.5 GB pulled out of block storage for a chart 1,000 pixels wide. It times out, and the queries next to it slow down.',
        tradeoff:
          'More query tasks spread the scan and do not shrink it, and 13 months of raw samples would be 512 TB to keep. The chart never needed 10-second detail: at one point per pixel it shows a point every 9 hours.',
        nodes: ['tsdb', 'blocks', 'query', 'dashboards'],
        travel: [
          ['tsdb', 'query'],
          ['blocks', 'query'],
          ['query', 'dashboards'],
        ],
        short: 'Raw scan',
        metrics: {
          requestsPerSecond: '10K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Year chart', value: 'over 30 s', alert: true },
            { label: 'Samples read', value: '6.3B', alert: true },
          ],
        },
        load: { tsdb: 55, blocks: 95, query: 95, dashboards: 30 },
        traffic: [
          { edge: ['blocks', 'query'], kind: 'heavy' },
          { edge: ['query', 'dashboards'], kind: 'failed' },
        ],
      },
      {
        title: 'Roll up and expire',
        narration:
          'A compactor reads the raw blocks of each partition and writes two coarser tiers back to block storage: a 5-minute block per day and a 1-hour block per calendar month. Each rollup point keeps the minimum, maximum, sum, count and last value of its interval. Storage rules then expire raw blocks after 15 days, 5-minute blocks after 90 days and 1-hour blocks after 395 days. The year-long chart now reads 17.5 million points.',
        tradeoff:
          'Three tiers hold 13 months in about 48 TB, a tenth of the raw figure, and keeping minimum and maximum means a spike still shows on a yearly chart. Detail older than 15 days is gone for good, and an average of percentiles would be wrong, so latency is stored as histogram buckets, which are counters and add up correctly at any resolution.',
        nodes: ['blocks', 'compactor'],
        travel: [['blocks', 'compactor']],
        short: 'Rollups',
        metrics: {
          requestsPerSecond: '10K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Stored, 13 months', value: '48 TB' },
            { label: 'Year chart reads', value: '17.5M points' },
          ],
        },
        load: { blocks: 30, compactor: 40 },
        traffic: [{ edge: ['blocks', 'compactor'], kind: 'heavy' }],
      },
      {
        title: 'Pick a tier, fan out, cache what is final',
        narration:
          'The query service adds the caller’s tenant to every query and picks a tier by step: raw under 5 minutes, 5-minute points under an hour, 1-hour points above. It asks one ready storage node per partition for the last 4 hours, reads every listed block that overlaps the range, whatever its age, and merges the two by series and timestamp, so a window that a node has already dropped, or skipped when it replayed after a restart, comes from its block. A partition with no ready node, or a window that neither the nodes nor a listed block cover in full, makes the result partial. A result is cut into aligned extents, and those that ended more than 70 minutes ago, which no late sample can change, are kept in a cache for 24 hours if they are complete.',
        tradeoff:
          'A dashboard that refreshes every 30 seconds recomputes only its newest two or three extents. The cache holds nothing recent, so it can be lost at any time and the only cost is load. Every query touches all 200 partitions, because a hash of tenant and agent says nothing about which service a host runs; that is the price of batches that are one record each, and it means that one partition with no ready node makes every query partial.',
        nodes: ['tsdb', 'blocks', 'query', 'dashboards'],
        travel: [
          ['tsdb', 'query'],
          ['blocks', 'query'],
          ['query', 'dashboards'],
        ],
        short: 'Query',
        metrics: {
          requestsPerSecond: '10K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Dashboard queries', value: '300/s' },
            { label: 'Recent range p99', value: '600 ms' },
            { label: 'Year chart p99', value: '2.5 s' },
          ],
        },
        load: { tsdb: 55, blocks: 30, query: 45, dashboards: 30 },
      },
      {
        title: 'Two evaluators, one claim per minute',
        narration:
          'Rules are split into 8 slots by a hash of tenant and rule id, and each slot has two evaluator tasks in different Availability Zones. A second hash gives each rule a fixed second of the minute, spread evenly over the 60, and the rule’s minutes are cut at that second, so a slot runs 62.5 evaluations in every second and never a whole minute’s at once. For a rule’s minute mark M the first runs the rule’s query at M plus 30 seconds and the second at M plus 40, both asking for the data as of M through a query pool that dashboards cannot use. Whoever finishes first writes the rule’s row on the condition that the last evaluated minute is still the one it read; the other finds the minute taken and does nothing. The row holds which label sets are pending and which are firing, so a condition that has held for its full duration moves to firing in that same write.',
        tradeoff:
          'Two evaluators need no leader and no lease: either can die and the rule is still evaluated that minute, and the conditional write is what keeps a transition from being applied twice. The price is a write per rule per minute, 500 a second, also when nothing changes. A query that fails or comes back partial changes nothing: a rule never resolves or fires on half the data.',
        nodes: ['evaluator', 'query', 'state'],
        travel: [
          ['evaluator', 'query'],
          ['evaluator', 'state'],
        ],
        short: 'Evaluate',
        metrics: {
          requestsPerSecond: '10K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Rules', value: '30K' },
            { label: 'Evaluations', value: '500/s' },
          ],
        },
        load: { evaluator: 40, query: 50, state: 25 },
      },
      {
        title: 'One page per episode',
        narration:
          'The write that moves a rule’s first instance to firing also opens an episode in the same row. The evaluator then sends one event to the paging provider with the episode id as its deduplication key and marks the episode as notified. If it dies in between, the next evaluator to read the row, the other one 10 seconds later or either of them a minute later, finds an episode with no notified time and sends again; the provider folds events with the same key into one incident. More hosts tripping the same rule join the open episode, and it closes after 5 minutes with nothing firing.',
        tradeoff:
          'Keeping the unsent page inside the row that the next minute reads anyway means there is no outbox table and no queue to run, and the retry is the evaluation loop itself. One page per rule keeps a hundred hosts from paging a hundred times; the cost is that two different rules about one outage are two pages, and a chat message, which has no deduplication key, can repeat.',
        nodes: ['evaluator', 'state', 'pager'],
        travel: [
          ['evaluator', 'state'],
          ['evaluator', 'pager'],
        ],
        short: 'Page',
        metrics: {
          requestsPerSecond: '10K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Minute to page p99', value: '35 s' }],
        },
        load: { evaluator: 40, state: 25, pager: 10 },
      },
      {
        title: 'Watch the watcher',
        narration:
          'A canary in another region writes one sample a minute through the public gateway. Each of the 8 slots has a heartbeat rule that is true while that sample is under 3 minutes old, and its route is not a page: every minute it holds, the evaluator records a data point in a monitoring service outside this system. An alarm there on 3 consecutive missing minutes pages, through its own channel, a few minutes after the last heartbeat: more than 3, because an alarm on missing data waits until the last real data point has left its evaluation range. If it is the canary’s samples that stop reaching storage, the rule goes on holding for 3 minutes on the last sample it saw, so the page comes 3 minutes later still.',
        tradeoff:
          'A monitoring outage is silent by nature: no data, no alerts. On the way out the heartbeat covers every partition, the query pool, the evaluator and the state table, because a rule is skipped when any partition has no ready node. On the way in it proves less: the canary is one agent, so its sample crosses the gateway and one partition of 200, and writes failing on the other 199 are left to the queue’s own alarms and to the write error ratio. A missing data point does not say which part broke, and the heartbeat does not prove that the paging provider delivers what it accepts.',
        nodes: ['evaluator', 'watchdog'],
        travel: [['evaluator', 'watchdog']],
        short: 'Heartbeat',
        metrics: {
          requestsPerSecond: '10K',
          p95Latency: '20 ms',
          errorRate: '0.01%',
          healthy: '8 / 8',
          custom: [{ label: 'Silence to page', value: 'over 3 min' }],
        },
        load: { evaluator: 40, watchdog: 5 },
        traffic: [{ edge: ['evaluator', 'watchdog'], kind: 'health' }],
      },
    ],
  },
  flows: [
    {
      id: 'write',
      title: 'An agent writes a batch',
      kind: 'sync',
      summary:
        'The agent on host web-7 posts 1,000 samples. The gateway checks them, stores the batch as one record in the write queue and answers 200 in about 20 ms. Two storage nodes pick the record up a second or two later.',
      runsOn:
        'Application Load Balancer with AWS WAF → ingest gateway on Amazon EKS → Amazon MSK → storage nodes on Amazon EKS',
      participants: [
        { id: 'agent', label: 'Host agent', service: 'On the host' },
        { id: 'alb', label: 'Load balancer', service: 'ALB + AWS WAF' },
        { id: 'gw', label: 'Ingest gateway', service: 'Amazon EKS' },
        { id: 'msk', label: 'Write queue', service: 'Amazon MSK' },
        { id: 'node', label: 'Storage nodes', service: 'Amazon EKS' },
      ],
      steps: [
        {
          from: 'agent',
          to: 'alb',
          label: 'POST /write, 20 KB, tenant token',
          note: 'One sample for each of about 1,000 series, all taken in the last 10 seconds, compressed. The load balancer serves only the write path, so its metrics describe ingestion and nothing else.',
        },
        {
          from: 'alb',
          to: 'gw',
          label: 'forward',
          note: 'Gateway tasks are stateless and spread over three Availability Zones. Any of the 40 can take any batch.',
        },
        {
          from: 'gw',
          to: 'gw',
          label: 'token → tenant; timestamps; rate; add tenant and agent labels',
          note: 'Tenants, their limits and their drop lists are read from a table into memory every 60 seconds, so no store is read per request. A sample older than 1 hour or more than 5 minutes ahead is a 400. The local token bucket refills at one fortieth of the tenant’s sample rate, or at 100 samples a second if that is more; an empty bucket is a 429 with Retry-After, and the agent keeps the batch.',
        },
        {
          from: 'gw',
          to: 'msk',
          label: 'produce, acks=all, partition = hash(tenant, agent) mod 200',
          note: 'The whole batch is one record. Hashing by tenant and agent keeps a host on one partition, so one pair of nodes holds all of its series. Records sit in the log in the order they arrived, which a retry or a backfill can make differ from the order of their timestamps, and the nodes do not rely on it.',
        },
        {
          from: 'msk',
          to: 'gw',
          label: 'ack: offset, append time',
          note: 'The topic has three replicas in three Availability Zones and needs two in sync to accept a write. The broker stamps the record with its own clock; storage nodes later use that append time to decide when a window can close. This is the durable write the 200 stands on.',
          style: 'reply',
        },
        {
          from: 'gw',
          to: 'agent',
          label: '200',
          note: 'Any failure before this point is a 5xx or a timeout, and the agent sends the same batch again after a backoff. A batch that never got its 200 was never promised.',
          style: 'reply',
        },
        {
          from: 'msk',
          to: 'node',
          label: 'fetch partition 137',
          note: 'Two nodes, one in each replica set, read the partition. Each appends the samples to its series in memory and drops any whose series and timestamp it already holds. Every 2 seconds a node also commits the offset it has applied under its set’s consumer group, which exists only so that the queue can report lag; a restart never resumes from it.',
          style: 'async',
        },
      ],
    },
    {
      id: 'recent-query',
      title: 'A dashboard over the last 6 hours',
      kind: 'sync',
      summary:
        'At 14:20 a panel asks for a service’s request rate over 6 hours at a 20-second step. The range touches seven hourly extents: five come from the cache and the newest two are computed from storage nodes. About 300 ms.',
      runsOn:
        'Application Load Balancer → query service on Amazon EKS → Amazon ElastiCache → storage nodes on Amazon EKS',
      participants: [
        { id: 'dash', label: 'Dashboard', service: 'Browser' },
        { id: 'alb', label: 'Load balancer', service: 'ALB' },
        { id: 'query', label: 'Query service', service: 'Amazon EKS' },
        { id: 'cache', label: 'Result cache', service: 'ElastiCache' },
        { id: 'node', label: 'Storage nodes', service: 'Amazon EKS' },
      ],
      steps: [
        {
          from: 'dash',
          to: 'alb',
          label: 'GET /query expr, from=now-6h, step=20s',
          note: 'The user’s session token names the tenant. The load balancer serves only the query path.',
        },
        {
          from: 'alb',
          to: 'query',
          label: 'forward',
          note: 'A task of the dashboard pool. Alert rules use another pool of the same service, so a flood of dashboard queries cannot queue in front of them.',
        },
        {
          from: 'query',
          to: 'query',
          label: 'add tenant; tier = raw; cut into 1-hour extents',
          note: 'The tenant label is added by the service, not by the caller, so a query cannot name another tenant. A step under 5 minutes means the raw tier. The range is aligned to the step and cut into extents on hour boundaries. The task takes one of the tenant’s query slots, or answers 429 if all are busy.',
        },
        {
          from: 'query',
          to: 'cache',
          label: 'GET tenant | expr | step | extent start, one per extent',
          note: 'Seven single-key reads sent together, because the keys of one query sit on different shards of the cache. Five extents ended before 13:10, more than 70 minutes ago, and are in the cache. No sample older than an hour is accepted, so nothing can still change them. The two newest are not final. In the first 10 minutes of an hour the extent that just ended is not final either, and three are computed.',
        },
        {
          from: 'query',
          to: 'node',
          label: 'select series since 13:00, 200 partitions',
          note: 'One call per storage node, 50 in all, each covering the four partitions that node holds, sent to the replica set in the task’s own zone first. A node that is more than about 10 seconds behind the end of its log, replaying or stalled, answers not ready, and the task asks the node of the other set. Each node finds the matching series in its label index and returns their samples. The two windows this part of the range falls in, 12:00 and 14:00, have no block yet, so the nodes are its only source. With a cold cache, the hours before 12:00 would be read from the listed blocks of their windows and merged with whatever the nodes still hold.',
        },
        {
          from: 'node',
          to: 'query',
          label: 'series and samples',
          note: 'If neither node of a partition is ready and answers within 2 seconds, the result is marked partial. A dashboard shows it with a warning. A partial extent is never written to the cache.',
          style: 'reply',
        },
        {
          from: 'query',
          to: 'cache',
          label: 'SET extents that became final, TTL 24 h',
          note: 'Only extents older than 70 minutes that are complete: for every partition, each window they touch was answered in full by a ready node or read from a listed block. The cache is an optimization with no invalidation: its content is final when written, and the time to live bounds anything unforeseen.',
          style: 'async',
        },
        {
          from: 'query',
          to: 'dash',
          label: '200, 1,080 points per series',
          note: 'Six hours at 20 seconds. The next refresh, 30 seconds later, repeats the cache read and the computation of the newest extents.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'long-query',
      title: 'A chart over a year, from rollups',
      kind: 'sync',
      summary:
        'A capacity chart asks for a year at one point per pixel. The step is about 9 hours, so the query reads 1-hour rollup blocks, 17.5 million points in place of 6.3 billion raw samples.',
      runsOn: 'Query service on Amazon EKS → Amazon ElastiCache → Amazon S3',
      participants: [
        { id: 'dash', label: 'Dashboard', service: 'Browser' },
        { id: 'query', label: 'Query service', service: 'Amazon EKS' },
        { id: 'cache', label: 'Result cache', service: 'ElastiCache' },
        { id: 's3', label: 'Block storage', service: 'Amazon S3' },
        { id: 'node', label: 'Storage nodes', service: 'Amazon EKS' },
      ],
      steps: [
        {
          from: 'dash',
          to: 'query',
          label: 'GET /query from=now-365d, step=9h',
          note: 'A step of an hour or more selects the 1-hour tier. Each point of the answer is built from the minimum, maximum, sum and count stored in the rollup points, so a maximum over 9 hours is the true maximum.',
        },
        {
          from: 'query',
          to: 'cache',
          label: 'GET each extent',
          note: 'On the first load of the day nothing is cached. Later loads find every extent but the newest.',
        },
        {
          from: 'query',
          to: 's3',
          label: 'list of blocks, kept in memory for a minute',
          note: 'Each task lists the block prefixes once a minute and reads every listed block that overlaps the range, whatever its age. A listing shows a block as soon as its upload has finished, and a storage node keeps a window in memory for 30 minutes after its upload succeeds or is refused because the other node’s block exists, which only has to cover the age of that list: a window whose block is not listed yet is still answered by the nodes. A task whose refresh keeps failing and whose list is more than 5 minutes old marks as partial every result that reaches back more than 70 minutes, the part a block may hold, and caches nothing until a listing succeeds. Windows are fixed 2-hour slots, so the task knows which blocks should exist: a window whose start lies before the 4 hours the nodes are asked for, which happens 2 hours after its end, and with no block in the list makes the result partial, and it is not cached.',
        },
        {
          from: 'query',
          to: 's3',
          label: 'ranged GET: label index, then chunks, 12 monthly blocks × 200 partitions',
          note: 'The index section for the metric name gives the positions of the matching series, about 10 per partition, and one or two ranged reads fetch their chunks. 2,400 blocks are read in parallel.',
        },
        {
          from: 'query',
          to: 's3',
          label: 'the current month: daily 5-minute blocks',
          note: 'The month in progress has no 1-hour block yet, so its days are read from 5-minute blocks, up to 31 per partition, and reduced to hours on the fly. This is the slow part of a cold year-long query.',
        },
        {
          from: 'query',
          to: 'node',
          label: 'today: raw samples',
          note: 'The day in progress has no rollup. Its windows that already have a block are read from raw blocks and the newest hours from storage nodes, merged and reduced the same way.',
        },
        {
          from: 'query',
          to: 'cache',
          label: 'SET final extents, TTL 24 h',
          note: 'Everything older than 70 minutes. The same chart opened by a second person reads the cache and computes one extent.',
          style: 'async',
        },
        {
          from: 'query',
          to: 'dash',
          label: '200, about 1,000 points per series',
          note: 'Around 2 seconds cold and well under a second from the cache. Asking for a year at a 10-second step is refused: raw samples exist for 15 days.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'alert',
      title: 'A rule fires and pages',
      kind: 'scheduled',
      summary:
        'A rule says: error ratio above 5% for 5 minutes. It has been true since minute M minus 5. At minute M the first evaluator claims the minute, moves the instance to firing, opens an episode and pages.',
      runsOn:
        'Rule evaluators on Amazon EKS → alert query pool → Amazon DynamoDB → paging provider',
      participants: [
        { id: 'evalA', label: 'Evaluator A', service: 'Amazon EKS' },
        { id: 'evalB', label: 'Evaluator B', service: 'Amazon EKS' },
        { id: 'state', label: 'Rule state', service: 'DynamoDB' },
        { id: 'pool', label: 'Alert query pool', service: 'Amazon EKS' },
        { id: 'pager', label: 'Paging provider', service: 'External' },
      ],
      steps: [
        {
          from: 'evalA',
          to: 'state',
          label: 'GetItem tenant t, rule r, consistent, at M + 30 s',
          note: 'M is this rule’s own minute mark: the minute boundary moved to the fixed second that a hash gave the rule, which spreads the 30,000 rules over the 60 seconds. The row says: last evaluated minute M minus 1, one instance pending since M minus 5, no episode. Evaluators load rule definitions and silences into memory once a minute; the state is read fresh every time. Had the row shown an open episode that is unsent and not silenced, A would send its event now, before the query and whatever its outcome.',
        },
        {
          from: 'evalA',
          to: 'pool',
          label: 'query expr at time M',
          note: 'The query asks for the data as of M, not as of now, so both evaluators ask the same question. Thirty seconds of delay lets the samples taken just before M arrive: up to 10 seconds in the agent, a few in the pipeline and up to about 10 by which a ready node may trail the log, about 22 in all.',
        },
        {
          from: 'pool',
          to: 'evalA',
          label: 'complete result: checkout 7.2%',
          note: 'A failed or partial result is tried twice more inside the minute. If it still fails, the evaluator writes nothing for minute M: the instance stays pending and a firing instance would stay firing. B may still claim the minute 10 seconds later. A minute counts as missed only if nobody claims it: missed is the rule minutes due minus the rule minutes claimed, and a claim is a conditional write that succeeded.',
          style: 'reply',
        },
        {
          from: 'evalA',
          to: 'state',
          label: 'UpdateItem lastEval=M, instance=firing, episode={id, start M} IF lastEval = M-1',
          note: 'One conditional write carries the claim on the minute, the transition and the new episode. The episode id is a hash of the tenant, the rule id and M. There is no second write that could be lost between the state change and the intent to page.',
        },
        {
          from: 'evalB',
          to: 'state',
          label: 'GetItem at M + 40 s: lastEval = M',
          note: 'The minute is taken, so B runs no query. Had both read M minus 1 at the same moment, both would have run the query and one write would have failed its condition.',
        },
        {
          from: 'evalA',
          to: 'pager',
          label: 'POST event, dedup key = episode id',
          note: 'No matching silence is active, so the event goes out: at most 3 tries with a 2-second timeout each. The provider treats events with the same key as one incident.',
        },
        {
          from: 'pager',
          to: 'evalA',
          label: 'accepted',
          note: 'About 33 seconds after minute M. The provider now owns reaching a person.',
          style: 'reply',
        },
        {
          from: 'evalA',
          to: 'state',
          label: 'UpdateItem episode.notifiedAt IF episode.id = mine AND no notifiedAt',
          note: 'If the evaluator dies before this write, or all three tries fail, the row still shows an episode with no notified time. Every evaluator that reads the row after that sends the event again before it runs its query, whether or not it then claims the minute: B at M plus 40 seconds if it has not read yet, then both in every minute while the episode is open. A failing alert query pool therefore does not hold a page back. After 5 minutes without success an evaluator also publishes once to the tenant’s escalation topic, claimed first by a conditional write. An episode held by a silence is not sent, not counted as unsent and not escalated until the silence ends.',
        },
      ],
    },
    {
      id: 'node-dies',
      title: 'A storage node dies with hours in memory',
      kind: 'direct',
      summary:
        'Node A of partition 137 is killed. Queries move to node B at once. A replacement reads the resume offset from the newest block, replays up to 205 minutes of the queue in about 23 minutes and becomes ready again.',
      runsOn: 'Storage nodes on Amazon EKS → Amazon S3 → Amazon MSK',
      participants: [
        { id: 'query', label: 'Query service', service: 'Amazon EKS' },
        { id: 'a', label: 'Node A', service: 'Amazon EKS' },
        { id: 'b', label: 'Node B', service: 'Amazon EKS' },
        { id: 's3', label: 'Block storage', service: 'Amazon S3' },
        { id: 'msk', label: 'Write queue', service: 'Amazon MSK' },
      ],
      steps: [
        {
          from: 'a',
          to: 'a',
          label: 'killed: memory gone',
          note: 'Up to 4 hours of samples for four partitions were in its memory. None of them existed only there: every one is still in the queue, which keeps 24 hours.',
        },
        {
          from: 'query',
          to: 'b',
          label: 'select series, partition 137',
          note: 'The call to A fails, and the task asks B, in the other Availability Zone, which holds the same data. Dashboards and alert rules see no gap.',
        },
        {
          from: 'a',
          to: 's3',
          label: 'newest raw block of partition 137: read its metadata',
          note: 'The node comes back with the same ordinal and therefore the same four partitions. The newest block says which window it covers and from which offset the samples after that window can be read. No offset stored in the queue is trusted for this.',
        },
        {
          from: 'a',
          to: 'msk',
          label: 'fetch from the resume offset',
          note: 'The offset is the first record appended 10 minutes before that window ended, which covers the 5 minutes a sample may be ahead of the clock. The node replays at ten times the live rate and skips the samples that belong to windows already in a block; queries read those windows from the block and not from this node.',
        },
        {
          from: 'query',
          to: 'a',
          label: 'select series: not ready',
          note: 'A node is ready while, for each of its partitions, its last fetch is under 10 seconds old and left it within 500 records, about 10 seconds, of the end offset that the fetch reported. Until then it refuses queries, so nobody reads a memory with holes in it. The test runs for as long as the node lives, so a node that stalls later is not ready either.',
          style: 'reply',
        },
        {
          from: 'b',
          to: 's3',
          label: 'PUT block for the window that closed, If-None-Match: *',
          note: 'If a window closes during the replay, B uploads its block. Should A reach the same point and try too, its put is refused with 412 Precondition Failed and it drops the block it built. The refusal proves that the block exists, so A keeps the window in memory for the same 30 minutes as after an upload of its own.',
        },
        {
          from: 'a',
          to: 'a',
          label: 'caught up: ready',
          note: 'At worst 205 minutes of log, about 23 minutes of replay, and never less than about 9: the newest block was uploaded 70 minutes or more after its window ended and its offset lies 10 minutes before that end, so at least 80 minutes of log, and 80 ÷ 9 = 8.9. Query tasks list blocks every minute, so by the time the node is ready all of them read the windows it skipped from their blocks. While the replay lasts, partition 137 has one node; if B died too, the partition would have no ready node, every query would be partial and every rule skipped until one of them caught up, and nothing accepted would be gone.',
        },
      ],
    },
    {
      id: 'duplicate-late',
      title: 'A duplicate batch and a late batch',
      kind: 'queue',
      summary:
        'A gateway task dies after the queue stored a batch and before the 200. The agent sends it again and the samples are stored one time. Then a host returns from a 40-minute network cut and its backlog fills the gap.',
      runsOn: 'Host agent → ingest gateway on Amazon EKS → Amazon MSK → storage nodes',
      participants: [
        { id: 'agent', label: 'Host agent', service: 'On the host' },
        { id: 'gw', label: 'Ingest gateway', service: 'Amazon EKS' },
        { id: 'msk', label: 'Write queue', service: 'Amazon MSK' },
        { id: 'node', label: 'Storage nodes', service: 'Amazon EKS' },
      ],
      steps: [
        {
          from: 'agent',
          to: 'gw',
          label: 'POST /write, samples at 12:00:10',
          note: 'The gateway produces the record, the queue acknowledges it, and the task is killed before it answers.',
        },
        {
          from: 'agent',
          to: 'gw',
          label: 'POST /write, the same batch, after a 10 s timeout',
          note: 'Another task takes it. It has no way to know the first attempt got through, and it does not need one: it produces a second record and answers 200.',
        },
        {
          from: 'msk',
          to: 'node',
          label: 'record 1, then record 2',
          note: 'The node stores the samples of the first record. For the second, every series already has a sample at 12:00:10, so each one is dropped and a counter of repeats goes up. Delivery is at least once, made harmless by the series and timestamp.',
          style: 'async',
        },
        {
          from: 'agent',
          to: 'gw',
          label: 'after a 40-minute cut: live batch first, then backlog oldest first',
          note: 'The agent kept 240 batches on disk. It sends the live batch on time and the backlog at up to half the live rate, so the tenant stays within its sample rate, which is set at 1.5 times its steady rate.',
        },
        {
          from: 'gw',
          to: 'msk',
          label: 'produce batches up to 1 hour old',
          note: 'A cut of up to 30 minutes is filled completely. This one is longer: by the time the agent reaches the batches of its last 20 minutes they are more than an hour old and are refused with 400, and the agent drops them and counts them.',
        },
        {
          from: 'msk',
          to: 'node',
          label: 'samples older than the series’ newest',
          note: 'The node keeps out-of-order samples of a series in a small side buffer and merges them when the series is read or when its block is cut. The window they belong to is still open, because a window closes 70 minutes after it ends.',
          style: 'async',
        },
      ],
    },
    {
      id: 'cardinality',
      title: 'A label explodes cardinality',
      kind: 'queue',
      summary:
        'A deploy adds a user id as a label on one metric. The tenant’s series stop growing at its cap on each partition, its existing series and every other tenant are untouched, and the team sees why in its usage.',
      runsOn: 'Ingest gateway on Amazon EKS → Amazon MSK → storage nodes → usage call',
      participants: [
        { id: 'agent', label: 'Host agents', service: 'On the hosts' },
        { id: 'gw', label: 'Ingest gateway', service: 'Amazon EKS' },
        { id: 'node', label: 'Storage nodes', service: 'Amazon EKS' },
        { id: 'query', label: 'Query service', service: 'Amazon EKS' },
        { id: 'team', label: 'Tenant’s engineer', service: 'Person' },
      ],
      steps: [
        {
          from: 'agent',
          to: 'gw',
          label: 'POST /write with checkout_requests{user_id=...}',
          note: 'Each batch looks normal: the sample rate is under the limit and no series has too many labels. The gateway cannot tell a new series from an old one, so it accepts.',
        },
        {
          from: 'gw',
          to: 'node',
          label: 'through the queue',
          note: 'The tenant has 800,000 active series and a limit of 1 million. Each of the 200 partitions enforces three times the even share: 5,000 × 3 = 15,000. The factor is that large because a host puts its 1,000 series on one partition together, so a partition holds 5 of this tenant’s hosts on average at its limit and often several more.',
          style: 'async',
        },
        {
          from: 'node',
          to: 'node',
          label: 'tenant at 15,000 series on this partition: drop samples of new series',
          note: 'A sample for a series the node already holds is stored as always. A sample that would create series number 15,001 is dropped and counted by tenant and reason. The tenant can grow to 3 million series at most, 2.2 million more than before, which is about 11 GB of memory in each replica set, 220 MB a node.',
        },
        {
          from: 'team',
          to: 'query',
          label: 'GET /usage',
          note: 'The query service asks the storage nodes and returns: active series at the cap on every partition, and samples dropped for the reason series limit, by metric name. The write call could not say so, because the 200 was answered before any node saw the batch.',
        },
        {
          from: 'team',
          to: 'query',
          label: 'PUT /settings/dropped-metrics/checkout_requests',
          note: 'The control calls are served next to the query path and write the tenants table. Within 60 seconds every gateway task has reloaded it and refuses that metric at the door, which stops the flood without waiting for a deploy. The metric is lost until the label is removed in code; stripping one label at the gateway would merge many series into one with colliding timestamps.',
        },
        {
          from: 'node',
          to: 'node',
          label: 'windows upload, exploded series leave memory',
          note: 'A series counts as active while a window in memory holds a sample of it, so the tenant is back under its caps about 4 hours after the flood stops. Until then a new host of that tenant can find its partition full and have its new series dropped; an operator can raise the limit for the day.',
        },
      ],
    },
    {
      id: 'watchdog',
      title: 'The alerting path goes quiet',
      kind: 'scheduled',
      summary:
        'The rule state table starts refusing writes, so no evaluator can claim a minute and no rule can fire. The heartbeat that normally leaves every minute stops, and an alarm in another region pages on its own channel a few minutes after the last heartbeat.',
      runsOn:
        'CloudWatch Synthetics canary → ingest gateway → rule evaluators → Amazon CloudWatch alarm in a second region → Amazon SNS',
      participants: [
        { id: 'canary', label: 'Canary', service: 'CloudWatch Synthetics' },
        { id: 'gw', label: 'Ingest gateway', service: 'Amazon EKS' },
        { id: 'eval', label: 'Evaluators', service: 'Amazon EKS' },
        { id: 'cw', label: 'Heartbeat alarm', service: 'CloudWatch, region 2' },
        { id: 'sns', label: 'Watchdog topic', service: 'Amazon SNS' },
        { id: 'oncall', label: 'Platform on-call', service: 'Person' },
      ],
      steps: [
        {
          from: 'canary',
          to: 'gw',
          label: 'POST /write canary_heartbeat, once a minute',
          note: 'The canary runs in a second region and writes through the public endpoint like any agent, as its own small tenant. Its own success metric has an alarm too, which says that writing from outside fails.',
        },
        {
          from: 'eval',
          to: 'eval',
          label: 'heartbeat rule of slot 3: newest canary sample under 3 minutes old',
          note: 'A normal rule, evaluated and claimed like the others, one per slot. Its query goes through the alert query pool to the storage nodes, so it is true only if the sample crossed the gateway, the queue and a storage node. The canary is one agent, so that is always the same partition and the same pair of nodes: the write half of the heartbeat proves one partition of 200.',
        },
        {
          from: 'eval',
          to: 'cw',
          label: 'PutMetricData HeartbeatSent, slot=3',
          note: 'The heartbeat route sends a data point in every minute the rule holds, after the state write succeeds. Eight slots send eight data points a minute to the second region. A slot’s points leave about a minute apart, at its heartbeat rule’s own second, so a late one can leave at most one 1-minute period empty, and the alarm needs three in a row.',
          style: 'async',
        },
        {
          from: 'eval',
          to: 'eval',
          label: 'state writes fail: no minute is claimed',
          note: 'The table is unavailable. Evaluators cannot record a result, so they apply none, send no page and send no heartbeat. Nothing inside the system can report this, because reporting it is the thing that is broken.',
        },
        {
          from: 'cw',
          to: 'sns',
          label: 'ALARM: 3 periods with no data point, missing data treated as breaching',
          note: 'One alarm per slot. It needs no metric from the broken system to fire, only the absence of one, and it lives in another region. It goes to ALARM once the last real data point has left its evaluation range, which is longer than the 3 periods.',
        },
        {
          from: 'sns',
          to: 'oncall',
          label: 'HTTPS to the paging provider’s inbound address, and SMS',
          note: 'A few minutes after the last heartbeat. The topic has two subscriptions so that a failure of the paging provider’s intake still leaves a text message.',
        },
      ],
    },
    {
      id: 'rollup',
      title: 'Roll a day up to 5-minute points',
      kind: 'scheduled',
      summary:
        'Every 10 minutes a compactor task looks for days whose 12 raw blocks all exist and whose 5-minute block does not, builds it and uploads it with a conditional put. A crash costs a repeat of the work, not a wrong block.',
      runsOn: 'Compactor on Amazon EKS → Amazon S3',
      participants: [
        { id: 'comp', label: 'Compactor', service: 'Amazon EKS' },
        { id: 's3', label: 'Block storage', service: 'Amazon S3' },
      ],
      steps: [
        {
          from: 'comp',
          to: 's3',
          label: 'list raw/137/ and 5m/137/',
          note: 'Four tasks share the 200 partitions by partition number modulo 4. There is no job table: the listing is the state, and a block that exists is done. Each task also counts the days whose block is late, and the months whose 1-hour block is, over all 200 partitions, not only its own, so a stuck task shows in the count that the other three publish.',
        },
        {
          from: 'comp',
          to: 's3',
          label: 'GET the 12 raw blocks of the day, about 6.5 GB',
          note: 'For every series and every 5 minutes the task computes minimum, maximum, sum, count and last value from 30 raw samples. A rate over a counter is later computed from the last values of consecutive points.',
        },
        {
          from: 'comp',
          to: 's3',
          label: 'multipart upload 5m/137/2026-03-14, complete with If-None-Match: *',
          note: 'About 1.2 GB. If a second task built the same day, for example during a deploy, the second completion is refused with 412 and discarded. On a 409 the task starts the upload again.',
        },
        {
          from: 'comp',
          to: 's3',
          label: 'a month is complete: build 1h/137/2026-03 from its daily blocks',
          note: 'The same loop and the same conditional completion, once a month per partition, about 2.9 GB.',
        },
        {
          from: 's3',
          to: 's3',
          label: 'lifecycle: expire raw/ at 15 days, 5m/ at 90, 1h/ at 395',
          note: 'Retention is three storage rules, not a job of ours. A rollup that is late only makes a long query read a finer tier, as long as it arrives before the finer tier expires: a daily block has 15 days and a monthly block at least 59. A fourth rule removes the parts of uploads that were never completed, after one day.',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'Push or pull collection?',
      options: [
        {
          name: 'Pull (scrape each target)',
          pros: 'The server sets the rate and knows at once when a target does not answer, so "is it down?" comes for free.',
          cons: 'Needs service discovery and a network route into every host, and a job that lives 20 seconds can be gone before it is scraped.',
        },
        {
          name: 'Push from agents',
          pros: 'Works across networks and for short-lived hosts, batches a thousand samples into one request, and the agent can keep an hour on disk when the gateway is away.',
          cons: 'A misbehaving client can flood the system, and a host that stopped sending looks like a host with nothing to say.',
        },
      ],
      choice:
        'Push from agents through a gateway with limits. The flood is handled by the per-tenant sample rate at the door. The silent host is handled by an "up" series in every batch and a rule that compares it with the hosts seen ten minutes earlier; an agent that shuts down cleanly sends a last zero so that a host removed on purpose does not alert.',
    },
    {
      question: 'Where does a batch become durable?',
      options: [
        {
          name: 'Gateway writes straight to storage nodes',
          pros: 'No queue to run, and a sample can be queried the moment the write returns.',
          cons: 'A slow or restarting storage node pushes errors back to 100,000 agents, and each node needs its own log on disk and its own replication to survive a crash.',
        },
        {
          name: 'A log on each storage node, replicated between nodes',
          pros: 'Durable without a separate cluster.',
          cons: 'Acceptance now depends on the storage tier being healthy, and catching a replica up after an outage is a protocol we would have to write and prove.',
        },
        {
          name: 'A replicated queue is the first and only durable write',
          pros: 'One write in the request. Storage can be down for hours while agents keep getting 200, and a restarted node rebuilds its memory by reading the queue again.',
          cons: 'A cluster to run, about 52 TB of disk for 24 hours of batches, and a second or two before a sample can be queried.',
        },
      ],
      choice:
        'The queue is the first durable write, acknowledged by two of three replicas in different Availability Zones before the 200. Storage nodes keep no log of their own: the queue is their log, read from an offset stored inside the newest block.',
    },
    {
      question: 'How is a sample stored once when batches repeat and two nodes build every block?',
      options: [
        {
          name: 'An idempotency key per batch, remembered at the gateway',
          pros: 'A repeat is refused before it costs anything downstream.',
          cons: 'A store of keys in the write path at 10,000 batches a second, which can itself fail, and it does nothing about a replay after a node restart.',
        },
        {
          name: 'One consumer per partition, chosen by a lock',
          pros: 'Only one node ever writes a block.',
          cons: 'A lock with a timeout does not stop a paused node from waking up and writing, and with one consumer a restart blinds queries for the length of the replay.',
        },
        {
          name: 'Identity in the data, and a conditional put per block',
          pros: 'A sample is its series and timestamp, so a repeat or a replay stores nothing new. A block has one key per partition and window, and the store accepts the first upload only.',
          cons: 'Two nodes do the work of one, and two samples for the same series and timestamp with different values cannot both be kept: the first one stored wins.',
        },
      ],
      choice:
        'Identity in the data. Delivery from the queue is at least once, made harmless by the series and timestamp, and each block is written with a put that fails if the object exists, so any number of nodes or restarts produce one block per partition and window. The resume offset travels inside the block, so there is no separate commit that could disagree with it.',
    },
    {
      question: 'How do we store 864 billion samples a day?',
      options: [
        {
          name: 'Rows in a general-purpose database',
          pros: 'Familiar, with indexes and updates.',
          cons: 'A row per sample costs tens of bytes plus index entries, and a range read touches as many rows as there are points.',
        },
        {
          name: 'One compressed stream per series',
          pros: 'Samples of a series arrive at a steady interval with values that change little, so storing the change in spacing and the bits that differ from the previous value brings a sample to about 1.5 bytes, and a range read is sequential.',
          cons: 'Bad at changing an old point, and a series must be found through a separate label index.',
        },
      ],
      choice:
        'A compressed stream per series, in memory for the last hours and in immutable 2-hour blocks after that. Each block has an inverted index from label values to series, ordered by tenant first. Metrics almost never rewrite the past, so the weakness costs nothing here.',
    },
    {
      question: 'How do we keep 13 months without paying for 13 months of raw samples?',
      options: [
        {
          name: 'Keep everything raw',
          pros: 'Any question can be asked of any day.',
          cons: 'About 512 TB, and a yearly chart reads billions of samples to draw a thousand pixels.',
        },
        {
          name: 'Downsample to averages',
          pros: 'Small and simple.',
          cons: 'A 30-second spike disappears into an hourly average, and averaging a percentile gives a number that means nothing.',
        },
        {
          name: 'Tiers with minimum, maximum, sum, count and last per interval',
          pros: 'Spikes survive in the maximum, averages come from sum and count, counter rates from the last value, and 13 months fit in about 48 TB.',
          cons: 'Three tiers to query across, and detail older than 15 days cannot be recovered.',
        },
      ],
      choice:
        'Three tiers: raw for 15 days, 5-minute points for 90 days, 1-hour points for 13 months. A compactor builds each rollup under a key that names its partition and period and uploads it with a conditional put, and storage lifecycle rules do the expiry. Latency is recorded as histogram buckets, and percentiles are computed from summed buckets at query time.',
    },
    {
      question: 'How do we keep high cardinality from taking the system down?',
      options: [
        {
          name: 'No limits',
          pros: 'Teams can label anything.',
          cons: 'One label with unbounded values creates millions of series and exhausts the memory of every storage node, for every tenant.',
        },
        {
          name: 'Count series at the gateway',
          pros: 'The write could answer 429 the moment a tenant goes over.',
          cons: 'The gateway would need a shared, exact set of every tenant’s series in the write path, 100 million entries read 10 million times a second.',
        },
        {
          name: 'Per-tenant series limit where series are created',
          pros: 'The storage node already holds the set of series. The damage stays with the tenant that caused it, and its existing series keep flowing.',
          cons: 'The write has already answered 200, so the tenant learns of dropped samples from its usage, not from the response.',
        },
        {
          name: 'Strip or aggregate known bad labels',
          pros: 'Keeps the useful part of the data.',
          cons: 'Removing a label merges many series into one with colliding timestamps unless the values are aggregated, which needs rules per label kept up over time.',
        },
      ],
      choice:
        'A per-tenant limit on active series, enforced by each storage node per partition at three times the even share, the tenant’s limit divided by 200 partitions, because a host’s series land on one partition together, with dropped samples counted by reason and shown in the usage call, plus a per-tenant list of metric names refused at the gateway as the emergency stop. Questions about one user belong in logs or traces.',
    },
    {
      question: 'How does a dashboard stay fast when every query touches 200 partitions?',
      options: [
        {
          name: 'No cache',
          pros: 'Nothing can be stale.',
          cons: 'Thirty people watching one incident dashboard recompute the same six hours every 30 seconds.',
        },
        {
          name: 'Cache whole results for a few seconds',
          pros: 'Trivial, and it absorbs the incident crowd.',
          cons: 'Every refresh after the few seconds pays the full range again, and the newest points are stale by the time to live.',
        },
        {
          name: 'Cache the extents that are final',
          pros: 'A result is cut into aligned extents; those older than 70 minutes cannot change and are kept for a day, so a refresh computes only the newest two or three.',
          cons: 'More logic in the query service, and the recent part is always computed.',
        },
      ],
      choice:
        'Cache final extents, keyed by tenant, expression, step and extent start. There is no invalidation to race with a fill: an extent is written only when it is complete and past the late-arrival limit, a partial result is never written, and a 24-hour time to live bounds anything else. Per-tenant query slots and a cap on samples per query protect the nodes when the cache is cold.',
    },
    {
      question: 'How do we keep alerting working when storage is struggling?',
      options: [
        {
          name: 'Evaluate rules on the shared query path',
          pros: 'One pool to run, and the same results as dashboards.',
          cons: 'A heavy dashboard query can delay rule evaluation exactly during an incident, when everyone opens dashboards.',
        },
        {
          name: 'A dedicated query pool for alerts',
          pros: 'Rules keep their own tasks, and storage nodes reserve part of their query capacity for that pool.',
          cons: 'Capacity that sits half idle, and rules still depend on storage nodes being ready.',
        },
        {
          name: 'Evaluate on the ingest stream',
          pros: 'Fastest, and independent of storage.',
          cons: 'Only simple rules fit; a ratio over 5 minutes across a thousand hosts needs the state that storage nodes already hold.',
        },
      ],
      choice:
        'A dedicated query pool for the evaluators, with reserved capacity on the storage nodes. Rules read only the last minutes, which are always in memory, so they never wait on block storage or on the cache. A query touches every partition, so when any one partition has no ready node, no rule is evaluated for that minute and each keeps its state; none of them guesses.',
    },
    {
      question: 'Who owns an alert’s state change?',
      options: [
        {
          name: 'One evaluator with a standby',
          pros: 'One writer, simple reasoning.',
          cons: 'Failover needs a lock, and a lock with a timeout lets a stalled leader wake up and write after the standby took over.',
        },
        {
          name: 'Leases over shards of rules',
          pros: 'Each rule is evaluated by one task at a time, and any task can take over any shard.',
          cons: 'A lease protocol to write, with renewals, expiry and clock assumptions, and it still needs a check in the store to be safe.',
        },
        {
          name: 'Two evaluators per rule and a conditional write per minute',
          pros: 'No leader and no lease. Both can run; the row accepts one result per minute, and either can die without a gap.',
          cons: 'A write per rule per minute even when nothing changes, and up to twice the queries when the two overlap.',
        },
      ],
      choice:
        'Two evaluators per rule. The rule’s row holds the last evaluated minute, and a result is applied only by an update that finds the minute it read still in place. Pending, firing and resolved are all changes to that one row, so a transition has one owner by construction, whoever wrote the minute.',
    },
    {
      question: 'How do we page one time for one firing?',
      options: [
        {
          name: 'Send the page, then record it',
          pros: 'Simple.',
          cons: 'A crash after the state change and before the send loses the page; a crash after the send and before the record repeats it.',
        },
        {
          name: 'An outbox table and a notifier service',
          pros: 'The intent to page is written with the state change and a separate worker delivers it.',
          cons: 'A table, a relay and a worker pool to run and to watch, for a few pages a minute.',
        },
        {
          name: 'The episode in the rule’s row, sent with a deduplication key',
          pros: 'The state change and the intent to page are one write. Every evaluation starts by reading the row and sends what is still unsent. The provider merges repeats by key.',
          cons: 'Depends on the provider honouring the key, and routes without one, such as chat, can repeat.',
        },
      ],
      choice:
        'The episode lives in the rule’s row and its id is the deduplication key. Sends are at least once, made harmless by that key. A page is tried again by every evaluator that reads the row, so at least every minute while the episode is open and also in a minute whose query fails; after 5 minutes unsent, one message goes to the tenant’s escalation contacts, and the platform on-call is alarmed. When the episode closes, a resolve event with the same key is sent the same way, tried every minute for up to an hour or until the rule opens a new episode.',
    },
    {
      question: 'Who watches the watcher?',
      options: [
        {
          name: 'Alert on our own metrics with our own rules',
          pros: 'Nothing extra to build.',
          cons: 'When ingestion, storage or evaluation is broken, the rule that would say so is not evaluated.',
        },
        {
          name: 'Alarms on each component in the cloud provider’s monitoring',
          pros: 'Independent of our pipeline, and they say which part is broken.',
          cons: 'They watch parts, not the path: every part can look healthy while no rule fires.',
        },
        {
          name: 'A heartbeat through the path, checked from outside',
          pros: 'One always-true rule per evaluator slot must leave a mark every minute in a service outside the system, and its absence pages.',
          cons: 'It says that something is broken and not what, its sample is written through one partition of 200, and it stops at our edge: it does not test the paging provider.',
        },
      ],
      choice:
        'Both of the last two. Component alarms run in the cloud provider’s monitoring, never in this system, and say what broke; they are also the only cover for writes on the 199 partitions that the canary’s sample does not cross. The heartbeat, fed by a canary in another region and checked by an alarm there that treats missing data as breaching, says that rules stopped being evaluated or that the canary’s sample no longer arrives, and pages through a topic that does not pass through our evaluators.',
    },
    {
      question: 'How do tenants share one system without hurting each other?',
      options: [
        {
          name: 'A cluster per tenant',
          pros: 'Complete isolation, and a simple bill.',
          cons: 'Two hundred small clusters to run, each with its own idle headroom.',
        },
        {
          name: 'One shared system with limits per tenant',
          pros: 'One set of nodes, used well. The tenant is a label the system adds, and each scarce thing has a per-tenant cap: sample rate, active series, query slots, samples per query, rules.',
          cons: 'Every tenant touches every partition, so a fault in one node touches everyone, and limits must be sized so that their sum fits.',
        },
        {
          name: 'Shuffle each tenant onto a subset of partitions',
          pros: 'A bad tenant or a bad node reaches only the tenants that share its subset.',
          cons: 'Uneven partitions and a placement map to maintain; with 200 tenants of similar size it buys little.',
        },
      ],
      choice:
        'One shared system with limits. The gateway and the query service take the tenant from the token and add it themselves, so a caller can neither write nor read as another tenant. Limits are enforced without shared state: a local token bucket per gateway task, a per-partition series count on each storage node and a local slot count per query task.',
    },
  ],
  wrapUp:
    'Agents push batches through a gateway that limits each tenant; a replicated queue is the one durable write behind the 200; two storage nodes per partition rebuild from it and cut blocks with a conditional put; rollups and lifecycle rules keep 13 months in a tenth of the space; the query service picks a tier and caches what is final; two evaluators claim each rule minute with a conditional write and page with the episode id as the deduplication key; and a heartbeat checked from outside pages when rules stop being evaluated.',
  guarantees: {
    provides: [
      {
        property: 'Acceptance',
        promise:
          'A 200 is answered only after the batch is acknowledged by the write queue with at least two in-sync replicas in different Availability Zones. No later step has to succeed for the batch to exist: storage nodes read it from the queue, for up to 24 hours.',
      },
      {
        property: 'One stored sample per series and timestamp',
        promise:
          'Batches reach storage nodes at least once, made harmless by the series and timestamp: a retried batch, a replay after a restart and the second node of a partition all store nothing new. Each raw block and each rollup block exists once per partition and period, because it is written with a put that fails if the object exists.',
      },
      {
        property: 'Recovery of memory',
        promise:
          'A storage node that loses its memory rebuilds it from the queue, starting at the offset stored in the newest block of each of its partitions. That offset is at most 205 minutes behind, well inside the 24 hours the queue keeps.',
      },
      {
        property: 'Late and out-of-order samples',
        promise:
          'A sample up to 1 hour old is accepted and stored in its place, because a window is closed 70 minutes after it ends. An agent that was cut off for up to 30 minutes fills its gap completely.',
      },
      {
        property: 'Retention',
        promise:
          'Raw samples can be queried for 15 days, 5-minute points for 90 days and 1-hour points for at least 13 months, each point with the minimum, maximum, sum, count and last value of its interval.',
      },
      {
        property: 'One owner per alert transition',
        promise:
          'For each rule and minute, one evaluation result is applied: the update is conditional on the last evaluated minute that the evaluator read. An evaluation that fails or is partial applies nothing, so a rule neither fires nor resolves on incomplete data.',
      },
      {
        property: 'One page per episode',
        promise:
          'Opening an episode and recording that it needs a page are the same write. Events reach the paging provider at least once, made harmless by the episode id sent as the deduplication key, and are tried again every minute while the episode is open and unsent, also in a minute whose query fails.',
      },
      {
        property: 'Tenant isolation',
        promise:
          'The tenant is taken from the token and added by the gateway and by the query service, so a caller reads and writes only its own series. A tenant over its sample rate, its series limit or its query slots is limited alone.',
      },
      {
        property: 'An independent alarm for the alerting path',
        promise:
          'If rules stop being evaluated in a slot, because its evaluators, its queries or the state table fail, the heartbeat of that slot stops and an alarm in another region pages a few minutes after the last heartbeat, through a channel that does not use this system. One partition with no ready node stops the heartbeat of every slot, because it makes every query partial. On the write side the heartbeat proves one partition only, the one the canary’s agent hashes to: if the canary’s sample stops being accepted or stored while queries still answer, the heartbeat rule holds for 3 more minutes on the last sample, so the page comes 3 minutes later still.',
      },
    ],
    assumes: [
      'The queue does not elect a replica that is out of sync as leader: unclean leader election is turned off, the topic has three replicas and needs two in sync, and producers wait for all in-sync replicas.',
      'The clocks of gateways and queue brokers agree within a minute. The 70-minute close of a window is the 1-hour late limit plus 10 minutes for that difference and for a slow produce, and the resume offset is taken 10 minutes before a window’s end for the same reason.',
      'Every partition receives records continuously, since a window is closed when a record with a late enough append time is read. With about 500 hosts per partition this holds.',
      'Evaluators’ clocks are within a few seconds of true time. A rule’s minute is evaluated 30 seconds after its mark by the evaluator’s clock, and about 22 of those seconds are already spent on the agent’s interval, the pipeline and the lag of a ready node.',
      'Block storage offers a put that fails if the object exists and lists an object as soon as its upload has finished.',
      'The table behind rules and rule state supports conditional writes and consistent reads.',
      'The paging provider treats events with the same deduplication key as one incident.',
      'Agents send a batch again until they get a 200, keep up to an hour of unsent batches on disk and do not change a batch between attempts.',
      'Tenants do not all fill their per-partition caps at once. One tenant with a limit of 1 million that fills every partition holds 3 million series, 2 million above its limit: 10 GB in each replica set, 200 MB a node, and a node runs at 10 GB of 32.',
      'The two nodes of a partition are not restarted at the same time by a deploy: one replica set is rolled completely before the other, 5 pods at a time, each batch waiting until the one before it is ready.',
    ],
    doesNotGuarantee: [
      'Samples that never got a 200. An agent that crashes or a host that dies loses what was not yet accepted, and a gateway outage longer than 30 minutes loses part of it: an agent keeps an hour on disk and can refill 30 minutes, as the next item explains.',
      'A complete backfill after a cut longer than 30 minutes. The backlog is sent at half the live rate, and batches that are more than an hour old when their turn comes are refused. The 30 minutes hold for one agent or one partition: after a cut of the whole gateway, all of a tenant’s agents backfill together at exactly its sample rate limit, so any 429 slows them and less is filled.',
      'That a new series of a tenant at its cap on a partition is stored. Its samples are accepted with a 200 and then dropped by the storage node and counted. The two nodes of a partition count on their own, so around a restart one may keep a series the other dropped.',
      'An exact series limit. It is enforced per partition at three times the even share, so a tenant can hold up to three times its limit, and a tenant under its limit can still lose new series on a partition that drew more than 15 of its hosts, or from one host with more than 15,000 series. For a tenant at a limit of 1 million that is about 1 chance in 75.',
      'Which value wins when two samples have the same series and timestamp and different values. The first one a node stores is kept.',
      'Read-your-write. A sample can be queried a second or two after its 200, within 15 seconds for 99% of batches.',
      'Recent data for a partition while both of its nodes are down, replaying or more than about 10 seconds behind. Every query touches all 200 partitions, so while one partition has no ready node every query is marked partial and no rule of any tenant is evaluated, for up to about 23 minutes after one node restarts. Rules keep their state, the heartbeat of every slot stops and the watchdog pages. Nothing accepted is lost.',
      'That the heartbeat notices writes failing on a partition other than the canary’s. Its sample crosses one partition of 200. A partition that refuses writes while its nodes stay ready is reported by the queue’s count of partitions under their in-sync minimum and by the write error ratio, and a set of nodes that falls behind by the queue’s lag, not by the watchdog.',
      'A complete answer over a window whose block upload has been stalled for hours. The nodes still hold the window, but the query service asks nodes only for the last 4 hours, so from 2 hours after the window’s end, when its start falls out of those 4 hours, the range is answered as partial, and not cached, until the block is uploaded.',
      'Detail older than its tier. After 15 days a 10-second spike survives only as the maximum of its 5-minute point.',
      'An exact rate across a counter reset on the rollup tiers. A rollup point keeps a counter’s last value, so the increase between the previous point and a reset inside the interval is not counted: up to 5 minutes or 1 hour of it, against 10 seconds on the raw tier.',
      'That rules see late samples. A rule reads what has arrived 30 seconds after its minute mark, and backfilled data is never evaluated again.',
      'An evaluation every minute. A minute whose query fails three times is skipped, the rule keeps its state, and a condition is then seen up to a minute later.',
      'A single chat message per episode. Routes without a deduplication key can repeat when an evaluator dies between the send and the record. The one escalation message is the opposite: it is claimed before it is sent, so a crash in between loses it.',
      'That a person is reached. The design ends when the paging provider accepts the event; the heartbeat does not test the provider.',
      'One page per outage. Two rules that fire for the same cause are two pages, and an episode that closes and opens again after its 5 quiet minutes is a new page.',
      'That a resolve event arrives. It is tried every minute for an hour, or until the rule opens a new episode, which takes the one episode the row holds; after that the incident stays open at the provider until a person closes it. The same holds for a rare late page: an evaluator that stalls for more than 10 seconds between reading a row and sending can deliver the page of an episode that the other evaluator has just closed unsent.',
      'That a silence recalls a page already sent, or takes effect in under a minute.',
      'Survival of the home region. The watchdog reports a regional outage from the second region, but the system itself runs in one.',
    ],
  },
  failures: [
    {
      scenario: 'A gateway task dies after the queue stored a batch and before it answered 200.',
      impact:
        'The agent times out and sends the batch again. Two records in the queue describe the same samples.',
      detection:
        'Nothing to detect for one event. The storage nodes’ count of repeated samples is the baseline; a jump means agents are timing out.',
      recovery:
        'Each storage node keeps the first sample for a series and timestamp and drops the second. One stored sample, no gap.',
    },
    {
      scenario: 'A storage node dies with up to 4 hours of samples in memory.',
      impact:
        'Its four partitions are served by one node each. Dashboards and rules keep working, because queries go to the node of the other replica set. If that node also fails before the first is back, those partitions have no ready node. Every query touches every partition, so every result is partial and no rule of any tenant is evaluated until one of the two is ready, up to about 23 minutes; the heartbeat of every slot stops and the watchdog pages.',
      detection:
        'The queue reports MaxOffsetLag for the consumer group of the node’s replica set: the largest number of records, over the partitions, between the end of the log and the offset the group committed. It grows by about 50 a second while the node is dead, and it comes from the queue, not from the node. A replica set that stays behind for 45 minutes raises a ticket, and both sets behind pages.',
      recovery:
        'The replacement takes the same partitions, reads the resume offset from the newest block of each, replays at most 205 minutes of the queue in about 23 minutes, and answers queries again once it is within about 10 seconds of the end of the log. Samples it reads twice are repeats and are dropped.',
    },
    {
      scenario: 'A queue broker fails, or a partition falls below two in-sync replicas.',
      impact:
        'With one broker down, the other two replicas keep accepting, and agents see at most a batch to send again while the partitions that broker led elect a new leader; where it was a follower, a produce can wait until the broker leaves the in-sync set, 30 seconds with the MSK default for replica.lag.time.max.ms, and an agent whose 10-second timeout passes sends its batch again. Both storage nodes of a partition fetch from that leader, so if the election takes longer than the 10-second readiness limit those partitions have no ready node, every query is partial and a rule minute can be skipped for every tenant during that gap. If a partition has fewer than two in sync, produces to it fail, the gateway answers 503 for the hosts of that partition, and their agents keep batches on disk.',
      detection:
        'UnderMinIsrPartitionCount above 0 and OfflinePartitionsCount above 0, from the queue service, and the write error ratio on the load balancer. The heartbeat sees it only if the canary’s partition is one of them.',
      recovery:
        'The managed service replaces the broker and its replicas catch up. Agents send what they kept, live batches first. An outage of the partition of up to 30 minutes leaves no gap; a longer one leaves a hole for part of its duration.',
    },
    {
      scenario: 'Block storage refuses uploads for hours.',
      impact:
        'Windows that should have become blocks stay in memory on both nodes, and memory grows. Queries for recent hours still work. Once the start of a stalled window is more than 4 hours back, 2 hours after its end, queries over it are marked partial and are not cached until it is uploaded, because nodes are asked only for the last 4 hours. If reads fail too, long-range queries fail.',
      detection:
        'A gauge of the age of the oldest window not yet uploaded, published by the storage nodes, alarmed at 100 minutes against a normal 75, with missing data treated as breaching. 5xxErrors on the bucket confirm the cause.',
      recovery:
        'A node retries the upload every minute. A node that reaches 80% of its memory stops reading the queue, which holds 24 hours, so nothing accepted is dropped. Ten seconds later it also answers not ready, and once both nodes of a partition do, every result is partial and every rule skips the minute; none reads stale memory. Ingest lag then pages. When uploads work again the windows are written in order, memory is released and the nodes catch up.',
    },
    {
      scenario: 'A deploy adds an unbounded label and a tenant’s series multiply.',
      impact:
        'The tenant grows to its cap on each partition and no further. Its existing series are stored as before; samples of series beyond the limit are dropped after their 200. Other tenants are not affected, and the nodes hold at most three times that tenant’s limit.',
      detection:
        'Samples dropped for the reason series limit, by tenant and metric, in the usage call and on the operators’ view. It is not a page for the platform: the system is doing what it should.',
      recovery:
        'The tenant adds the metric to its drop list, which gateways apply within 60 seconds, and fixes the label. The extra series leave memory as their windows are uploaded, about 4 hours. Until then new series of that tenant can be dropped, unless an operator raises its limit.',
    },
    {
      scenario: 'The result cache is lost or unreachable.',
      impact:
        'Every dashboard query computes its full range. Recent ranges get slower and long ranges read block storage each time. Rules are not affected, since they never use the cache.',
      detection:
        'The latency alarms of the two dashboard tiers, and CacheHitRate and CurrConnections on the cache.',
      recovery:
        'A cache call has a 50 ms timeout and is skipped after it fails, so queries never wait on the cache. Per-tenant query slots and the cap on samples per query keep the storage nodes inside their capacity; queries beyond the slots get 429. The cache fills again from normal traffic.',
    },
    {
      scenario:
        'An evaluator dies after writing that an episode opened and before the paging provider got the event.',
      impact:
        'The rule’s row says firing, with an episode that has no notified time. Nobody has been paged yet.',
      detection:
        'A gauge of episodes open and unsent for more than 3 minutes, episodes held by a silence left out, published by every evaluator each minute, alarmed above 0. It returns to OK when the page is sent or the episode closes.',
      recovery:
        'The other evaluator of the slot reads the row 10 seconds after the first, sees the unsent episode and sends the event with the same key; if it had already read the row, it does so in the next minute. The page is 10 seconds to a minute late. If the first evaluator had in fact sent it, the provider merges the two.',
    },
    {
      scenario: 'The paging provider answers errors or times out.',
      impact:
        'Episodes open and stay unsent. Rule evaluation is not slowed: sends run in their own bounded pool with a 2-second timeout and at most 3 tries per evaluator per minute.',
      detection:
        'The same gauge of unsent episodes, and the provider error count from the evaluators. Both are published every minute, also at zero, and missing data is treated as breaching.',
      recovery:
        'Every open, unsent episode that is not silenced is tried again each minute, whether or not that minute’s query succeeds. After 5 minutes one message goes to the tenant’s escalation contacts through a topic, claimed first with a conditional write so that it is not repeated. When the provider returns, the still-open episodes are sent; an episode that closed unsent is recorded as never notified.',
    },
    {
      scenario: 'The rule state table throttles or is unavailable.',
      impact:
        'Evaluators cannot read state or claim a minute, so no rule is evaluated and no page is sent. Ingestion and dashboards are untouched.',
      detection:
        'The heartbeat of every slot stops, and the alarm in the second region pages a few minutes after the last heartbeat. ThrottledRequests and SystemErrors on the table say why.',
      recovery:
        'Evaluators keep trying each minute. When the table answers, the next evaluation applies the current result: a condition that started during the outage begins its hold then, and one that was already pending keeps the start it had, so it can fire at once.',
    },
    {
      scenario: 'Both evaluators of one slot are down.',
      impact: 'One eighth of the rules, 3,750, are not evaluated. The other slots are unaffected.',
      detection:
        'That slot’s heartbeat rule is among the rules not evaluated, so its data point is missing and its alarm pages a few minutes after the last heartbeat.',
      recovery:
        'The container platform restarts the tasks. Rule state is in the table, so the first evaluation continues from the stored pending and firing instances. Episodes that should have opened in the gap open at the first evaluation.',
    },
    {
      scenario: 'One query scans a tenant’s whole history at full detail.',
      impact:
        'Without limits it would hold a query task and 50 storage nodes busy and slow every dashboard.',
      detection:
        'Queries refused by reason and tenant, from the query service, and the dashboard latency alarms if the limits were set too high.',
      recovery:
        'The query is refused before it runs if its range and step need more points than the cap, and stopped when it has read 50 million samples or run 30 seconds. It holds one of its tenant’s slots meanwhile, so only that tenant has fewer slots left and gets 429 sooner; other tenants do not.',
    },
  ],
  capacity: {
    assumptions: [
      '100,000 hosts with about 1,000 series each, one sample per series every 10 seconds, owned by about 200 tenants. Load is steady; the system is planned for 1.5 times it.',
      'A batch of 1,000 samples with their labels compresses to about 20 KB, 20 bytes a sample on the wire and in the queue.',
      'In a block a raw sample takes about 1.5 bytes and a rollup point, with its five values, about 8 bytes. Label indexes and the growth from series that come and go are not counted.',
      'In memory a storage node spends about 5 KB per active series: up to 4 hours of samples at 1.5 bytes, about 2.2 KB, plus labels, index entries and buffers.',
      'A storage node applies 200,000 samples a second live and replays the queue at ten times that.',
      'A compactor core rolls up about 5 million raw samples a second, and a compactor pod has 16 cores.',
      '500 dashboards are open at the busiest time, with 18 panels each, refreshing every 30 seconds. A typical service query matches 2,000 series.',
      '30,000 alert rules, each evaluated every minute at its own fixed second, so evaluations are spread evenly over the minute. A paging event takes about a second, with a 2-second timeout and at most 3 tries.',
      'A tenant’s sample rate limit is 1.5 times its steady rate, and its series limit defaults to 1 million and is not set lower, so that the cap on a partition stays well above one host.',
    ],
    estimates: [
      {
        label: 'Ingest',
        value: '10M samples a second in 10K batches',
        math: '100,000 hosts × 1,000 series ÷ 10 s = 10M samples/s. 100,000 hosts ÷ 10 s = 10,000 batches/s. Active series: 100,000 × 1,000 = 100M.',
      },
      {
        label: 'Gateway',
        value: '40 tasks at half load, ~200 requests in flight',
        math: '10,000 batches/s ÷ 40 tasks = 250 per task, of the 500 a task is planned for. 10,000/s × 20 ms = 200 in flight.',
      },
      {
        label: 'Write queue',
        value: '200 MB/s, 1 MB/s per partition, ~52 TB on disk',
        math: '10,000 × 20 KB = 200 MB/s ÷ 200 partitions = 1 MB/s and 50 records/s each. 200 MB/s × 86,400 s = 17.3 TB a day × 3 replicas = 51.8 TB, 4.3 TB on each of 12 brokers.',
      },
      {
        label: 'Storage nodes',
        value: '100 nodes, 2M series and 10 GB each',
        math: '100M series × 2 copies ÷ 100 nodes = 2M per node × 5 KB = 10 GB of 32 GB. A partition holds 500 hosts, 500,000 series and 50,000 samples/s; a node holds 4 partitions.',
      },
      {
        label: 'Replay after a restart',
        value: 'At most 205 minutes of queue, ~23 minutes',
        math: '10 min before the window’s end + the 120 min of the next window + 70 min to close it + 5 min to upload = 205 min. The node reads at ten times the live rate while live records keep arriving, so it gains 9 minutes of log a minute: 205 ÷ 9 = 22.8 min. The queue keeps 1,440 min.',
      },
      {
        label: 'Raw tier',
        value: '1.3 TB a day, 19.4 TB for 15 days',
        math: '10M × 86,400 s = 864 billion samples a day × 1.5 B = 1.3 TB. × 15 days = 19.4 TB. A block: 500,000 series × 720 samples × 1.5 B = 540 MB; 12 windows × 200 partitions = 2,400 blocks a day.',
      },
      {
        label: 'Rollup tiers',
        value: '20.7 TB of 5-minute points, 7.6 TB of 1-hour points',
        math: '100M series × 288 points × 8 B = 230 GB a day × 90 days = 20.7 TB. 100M × 24 × 8 B = 19.2 GB a day × 395 days = 7.6 TB.',
      },
      {
        label: 'Compactor',
        value: 'A day rolled up in ~45 minutes',
        math: '864 billion samples ÷ (4 pods × 16 cores × 5M samples/s = 320M/s) = 2,700 s = 45 min. The last raw block of a day is uploaded about 75 min after the day ends, so its 5-minute blocks exist about 2 hours after it ends, against an alarm at 4 hours and a target of 6. A monthly block reads 31 daily blocks, 100M series × 288 × 31 = 893 billion points, about the same work once a month.',
      },
      {
        label: 'Thirteen months stored',
        value: '~48 TB, against 512 TB all raw',
        math: '19.4 + 20.7 + 7.6 = 47.7 TB. Raw for 395 days: 1.3 TB × 395 = 512 TB.',
      },
      {
        label: 'A year-long chart',
        value: '17.5M points, not 6.3B samples',
        math: 'Raw: 2,000 series × 3.15M samples a year = 6.3 billion × 1.5 B = 9.5 GB. At 1 hour: 2,000 × 8,760 = 17.5M points × 8 B = 140 MB.',
      },
      {
        label: 'Query load',
        value: '800 queries a second, 400 calls a second per storage node',
        math: 'Dashboards: 500 × 18 panels ÷ 30 s = 300/s. Rules: 30,000 ÷ 60 s = 500/s, a steady rate and not a burst, because each rule runs at its own second of the minute. Each asks one node per partition, 50 nodes: 800 × 50 = 40,000 calls/s ÷ 100 nodes = 400.',
      },
      {
        label: 'Rule state',
        value: '500 conditional writes a second',
        math: '30,000 rules ÷ 60 s = 500 writes/s, one per rule and minute. Per slot: 30,000 ÷ 8 = 3,750 rules spread over 60 s, 62.5 evaluations a second.',
      },
      {
        label: 'From the evaluated minute to the page',
        value: '~33 s, 43 s if the first evaluator is down',
        math: 'Counted from the rule’s own minute mark. First evaluator: 30 s delay + about 1 s of query + the write + about 1 s to the provider ≈ 33 s. The second evaluator starts 10 s later: ≈ 43 s, and 40 + 1 + 3 × 2 = 47 s if the provider answers only on the last of its 3 tries. All three are under the 50 s of the alarm and the 60 s of the target. A page that neither evaluator gets out in that minute is sent again in the rule’s next minute, 90 s or more after the mark that opened the episode, which misses the target and fires the alarm. Worst case from the moment the hold completes, with the first evaluator down: up to 60 s to the rule’s next mark + 43 s = 103 s, inside the 2 minutes required.',
      },
      {
        label: 'Series cap per partition',
        value: '15,000 for a tenant with a limit of 1M',
        math: '1,000,000 ÷ 200 partitions = 5,000, the even share, × 3 = 15,000. A host puts its 1,000 series on one partition, so the share is 5 hosts on average and the cap is 15. A tenant at its limit, 1,000 hosts, has about 1 chance in 75 that some partition draws 16 or more. Filling every partition is 200 × 15,000 = 3M series, the most the tenant can hold.',
      },
      {
        label: 'Backfill after a cut',
        value: 'Complete up to 30 minutes',
        math: 'With the backlog sent at half the live rate, the batch from minute x of a cut of D minutes is sent 2x minutes after it ends, D + x minutes old. It is accepted while D + x ≤ 60, which holds for every x ≤ D when D ≤ 30. An hour on disk is 360 batches × 20 KB = 7.2 MB.',
      },
    ],
    implications: [
      'Active series, not samples per second, size the storage tier: every 2 million series is one node in each replica set. That is why cardinality has a hard per-tenant limit and sample rate only a soft one.',
      'At 200 MB a second the queue is the largest thing to run after the storage nodes. Twenty-four hours of retention is chosen against the worst replay of 205 minutes and leaves about 20 hours to repair a storage outage before accepted data would age out.',
      'Raw detail for 13 months would cost ten times the storage and make a yearly chart read 360 times more points, so tiers are not an optimization here: they are what makes the retention requirement affordable.',
      'Rules are the larger query load, 500 a second against 300 from dashboards, and they are the ones that must not wait. That is the arithmetic behind a query pool of their own.',
      'Every query touches all 200 partitions because a batch is one record keyed by host. At 400 calls a second per node this is fine; at ten times the partitions it is the first thing to change.',
      'The second storage node per partition buys 23 minutes of read availability per restart, not durability. It is the 50 nodes to drop first if dashboards and rules could tolerate gaps, which rules cannot.',
      'A write per rule per minute is 500 a second, which is 500 write units while rows stay under 1 KB, an eighth of what a new on-demand table sustains, so the simplest claim, one row per rule, is affordable.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one region across three Availability Zones, with the watchdog in a second region. The paging provider is outside AWS. The system’s own health is watched in Amazon CloudWatch, never in itself. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Ingest gateway',
        service:
          'An internet-facing Application Load Balancer that serves only the write path, with AWS WAF, in front of 40 stateless pods on Amazon EKS spread over three Availability Zones',
        why: 'Agents reach it from any network with a token. A pod checks a batch against tenants held in memory and makes one produce call, so it depends on the queue and on nothing else per request.',
        watch:
          'ALB RequestCount, TargetResponseTime, HTTPCode_Target_5XX_Count, HTTPCode_ELB_5XX_Count and HTTPCode_Target_4XX_Count; Container Insights pod_cpu_utilization and service_number_of_running_pods. Custom: 429 answers by tenant.',
      },
      {
        part: 'Write queue',
        service:
          'Amazon MSK Provisioned with 12 Standard brokers in three Availability Zones; one topic with 200 partitions, replication factor 3, min.insync.replicas 2, retention set to 24 hours, append-time timestamps and unclean leader election turned off',
        why: 'A replicated log is the first durable write and the storage nodes’ replay source. A host’s batches all land on one partition, and the service replaces a failed broker.',
        watch:
          'BytesInPerSec, UnderMinIsrPartitionCount, UnderReplicatedPartitions, OfflinePartitionsCount, ActiveControllerCount, KafkaDataLogsDiskUsed, CpuUser plus CpuSystem, and MaxOffsetLag for the consumer group of each replica set.',
      },
      {
        part: 'Storage nodes',
        service:
          'Two StatefulSets of 50 pods on Amazon EKS, each set in its own Availability Zone, on memory-optimized instances with 32 GiB; no persistent volumes',
        why: 'A pod’s ordinal fixes its four partitions, so a replacement takes over the same data. Nothing on a node needs to survive it: memory is rebuilt from the queue. One set is deployed completely before the other, so a partition always keeps one ready node. A set is rolled 5 pods at a time: their replay reads 5 × 4 partitions × 10 MB/s = 200 MB/s, as much as one more set reading live, and ten batches of 9 to 23 minutes take between 1.5 and 4 hours.',
        watch:
          'Container Insights pod_memory_utilization, pod_cpu_utilization and pod_number_of_container_restarts. Custom, sent to CloudWatch: delay from append to applied, age of the oldest window not uploaded, active series and dropped samples by tenant and reason, repeated samples.',
      },
      {
        part: 'Block storage',
        service:
          'One Amazon S3 bucket with the prefixes raw/, 5m/ and 1h/, each followed by the partition number; lifecycle rules that expire them at 15, 90 and 395 days and abort incomplete multipart uploads after 1 day; request metrics turned on',
        why: 'Blocks are immutable objects read by range. A put with If-None-Match gives one block per partition and period without a lock, and lifecycle rules do retention without a job.',
        watch:
          '5xxErrors, 4xxErrors, FirstByteLatency and AllRequests from request metrics; BucketSizeBytes and NumberOfObjects, which are reported once a day.',
      },
      {
        part: 'Compactor',
        service:
          'A StatefulSet of 4 pods with 16 vCPUs each on Amazon EKS, each taking the partitions of its ordinal',
        why: 'Rollups are batch work with the listing of the bucket as its only state, so a pod can be killed at any point and the next loop repeats what is missing.',
        watch:
          'Custom, sent by every pod to one CloudWatch metric on every loop, also at zero: days whose 5-minute block is missing 4 hours after the day ended plus months whose 1-hour block is missing 2 days after the month ended, counted over all 200 partitions from the listing, and only for days inside the 90 days and months inside the 395 days their blocks are kept. Container Insights pod_number_of_container_restarts.',
      },
      {
        part: 'Query service',
        service:
          'An Application Load Balancer that serves only queries and control calls, in front of a dashboard pool of 20 pods on Amazon EKS; a separate alert pool of 10 pods reached only from inside the cluster',
        why: 'The same code in two pools, so dashboards and rules cannot take each other’s capacity. Pods are stateless: they hold a one-minute list of blocks and nothing else.',
        watch:
          'ALB RequestCount, TargetResponseTime, HTTPCode_Target_5XX_Count and HTTPCode_ELB_5XX_Count. Custom, per pool and tier: latency percentiles, partial results, queries refused by reason.',
      },
      {
        part: 'Result cache',
        service:
          'Amazon ElastiCache with the Valkey engine, cluster mode enabled, 3 shards with a replica each, entries with a 24-hour time to live',
        why: 'Holds only extents that can no longer change, so losing a node costs recomputation and no correctness. Replication is asynchronous, which is harmless for content that is final.',
        watch:
          'CacheHitRate, Evictions, DatabaseMemoryUsagePercentage, CurrConnections and EngineCPUUtilization, per node.',
      },
      {
        part: 'Rules, rule state, silences and tenants',
        service:
          'Four Amazon DynamoDB tables, on-demand: rules and rule state both keyed by tenant and rule id, silences and tenants',
        why: 'Conditional writes are the claim on a rule’s minute, the version check on a rule and the claim on an escalation message. A consistent read gives an evaluator the state it must not guess.',
        watch:
          'ThrottledRequests, SystemErrors, SuccessfulRequestLatency, ConsumedWriteCapacityUnits and ConditionalCheckFailedRequests, which counts the minutes the second evaluator lost.',
      },
      {
        part: 'Rule evaluators',
        service:
          'Two StatefulSets of 8 pods on Amazon EKS, set A and set B in different Availability Zones; pod k of each set evaluates the rules whose hash falls in slot k',
        why: 'Two pods per slot with no coordination between them: the table decides. Sends to the paging provider run in a bounded pool inside the pod, apart from evaluation.',
        watch:
          'Custom, sent to CloudWatch every minute, also at zero: rule minutes claimed and rules due, episodes unsent for over 3 minutes, paging provider errors. Published per notified episode only, episodes that a silence held left out, so absent in a minute with no page: the time from the evaluated minute to the page.',
      },
      {
        part: 'Paging and escalation',
        service:
          'An external paging provider called over HTTPS with a deduplication key; one Amazon SNS topic per tenant with the email addresses and phone numbers of its escalation contacts',
        why: 'The provider owns schedules and acknowledgement. The topic is the fallback when the provider does not accept an event for 5 minutes.',
        watch:
          'SNS NumberOfNotificationsFailed on the topics; provider answers by status code, from the evaluators.',
      },
      {
        part: 'Outside watchdog',
        service:
          'In a second region: a CloudWatch Synthetics canary that writes one sample a minute, one CloudWatch alarm per evaluator slot on the HeartbeatSent data points with missing data treated as breaching, and an Amazon SNS topic with an HTTPS subscription to the paging provider and an SMS subscription',
        why: 'It shares no component with the path it watches: not the region, not the evaluators, not the route by which normal pages leave.',
        watch:
          'The canary’s SuccessPercent and Failed in the CloudWatchSynthetics namespace, and the state of the eight heartbeat alarms.',
      },
      {
        part: 'Security',
        service:
          'TLS on every hop; tenant tokens stored hashed in the tenants table; AWS KMS keys for the bucket, the queue, the tables and the cache; an IAM role per workload through the cluster’s pod identity; the paging provider’s keys in AWS Secrets Manager',
        why: 'A token maps to one tenant and can only write; dashboards use user sessions that can only read their tenants. Each workload can reach only what it uses: the gateway cannot read blocks and the query service cannot produce to the queue. Labels are visible to the whole tenant, so they are not a place for personal data, and the series limit also discourages putting user ids there.',
      },
    ],
    limits: [
      'An MSK Standard broker holds at most 16,384 GiB of storage, and a cluster has at most 30 brokers when ZooKeeper-based and 60 when KRaft-based, by default. This design uses 12 brokers at about 4.3 TB each.',
      'For a cluster in three Availability Zones, the MSK default configuration sets default.replication.factor to 3 and min.insync.replicas to 2. On a cluster without tiered storage it also sets unclean.leader.election.enable to true, which lets an out-of-sync replica become leader and drop acknowledged records, so this design sets it to false.',
      'The 24 hours of retention are set on the topic. Left alone, the topic would keep the Apache Kafka default, which is longer and would need several times the disk. MSK has no minimum retention for primary storage; its 3-day minimum applies to low-cost tiered storage, which this design does not use.',
      'MSK recommends keeping CpuUser plus CpuSystem under 60% on each broker and acting when KafkaDataLogsDiskUsed reaches 85%. Its metrics reach CloudWatch at 1-minute intervals.',
      'MSK reports consumer lag only for a consumer group that has an offset set and is in the STABLE or EMPTY state, and whose name is ASCII with no colon. Storage nodes assign their partitions themselves and only commit offsets, so their groups have no members and stay EMPTY.',
      'MaxOffsetLag is the largest offset lag over the partitions of a topic for one consumer group, counted in records. EstimatedMaxTimeLag is an estimate of the time needed to drain that lag, not the age of the unread records, so the lag alarms here use the record count and convert it with the 50 records a second a partition takes.',
      'The gateway refuses a batch above 512 KB so that a record stays under the broker’s message size limit, which is left at the Apache Kafka default.',
      'Amazon S3 accepts If-None-Match on PutObject and CompleteMultipartUpload. A write to a key that exists answers 412 Precondition Failed, and concurrent requests can answer 409 Conflict, after which a put is retried and a multipart upload is started again.',
      'Amazon S3 gives strong read-after-write consistency: a GET or a LIST started after a successful PUT sees the object. That is what lets a block list be trusted.',
      'Amazon S3 supports at least 3,500 writes and 11,000 GET or HEAD requests a second per partitioned prefix and scales gradually beyond that, answering 503 Slow Down while it does. Keys start with the tier and the partition number, 600 prefixes that are all in steady use.',
      'A multipart upload has at most 10,000 parts of 5 MiB to 5 GiB each. A 2.9 GB monthly block fits in a few dozen parts.',
      'S3 Lifecycle removes an expired object asynchronously, possibly some time after its expiration date, and does not charge for the storage after that date. Retention is therefore "at least", never "exactly".',
      'S3 request metrics are opt-in and arrive at 1-minute intervals after some delay; the storage metrics arrive once a day.',
      'A DynamoDB item is at most 400 KB, attribute names included. A rule keeps at most 200 pending or firing instances in its row; a rule that matches more is reported as too broad and pages as one episode.',
      'A new on-demand DynamoDB table sustains 4,000 writes a second and a partition 1,000 write units a second; rule state takes 500 writes a second spread over 30,000 keys. One write unit covers an item of up to 1 KB, so the 500 writes are 500 units only while rows stay that small; a rule with many pending or firing instances has a larger row and costs more units per write.',
      'CloudWatch alarms on DynamoDB metrics ignore missing data by default, and ThrottledRequests has data only when a request is throttled, so the table alarm states its treatment of missing data explicitly.',
      'A CloudWatch alarm treats missing data as notBreaching, breaching, ignore or missing; the default is missing. Custom metrics have 1-minute granularity unless published as high resolution, and a regular alarm period is a multiple of 60 seconds, so no alarm here reacts in under a minute.',
      'A CloudWatch alarm reads back more data points than its evaluation periods, the evaluation range, and uses every real data point in that range. When a metric stops, an alarm that treats missing data as breaching therefore fires only once the last real data point has left the range, later than its evaluation periods, and an alarm that treats missing data as not breaching stays in ALARM until fewer breaching points remain in the range than the alarm needs. The documentation shows a range of 5 data points for 3 evaluation periods and says the number depends on the period, so the heartbeat and canary alarms here are given as a few minutes and not as a figure.',
      'A Synthetics canary created in the console runs at most once a minute. That is the resolution of the heartbeat.',
      'HTTPCode_Target_5XX_Count leaves out the 5xx that the load balancer generates itself, and HTTPCode_ELB_5XX_Count is reported only when it is not zero, so the write path and the query path each have their own load balancer and each error ratio adds both counts. RequestCount counts only requests for which a target was chosen.',
      'ElastiCache metrics are per node. Nodes with 4 or more vCPUs are watched with EngineCPUUtilization and smaller ones with CPUUtilization.',
      'Container Insights with enhanced observability for Amazon EKS reports pod_status_ready, which says that all containers of a pod are ready. A stuck workload is seen through it, through service_number_of_running_pods and pod_number_of_container_restarts and, for storage nodes, through the queue’s lag.',
      'HTTPS and email subscriptions to an SNS topic must be confirmed before they receive anything, which is checked when the watchdog is set up, not during an outage.',
    ],
  },
  slos: [
    {
      objective: 'Accepting a batch',
      target: '99.9% of write requests answered within 500 ms and without a 5xx, over 28 days',
      measure:
        'On the write path’s own load balancer: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount for errors and TargetResponseTime for latency. An absent 5XX count is read as zero; the ratio is missing only when RequestCount is, and such a minute counts as failed. A 429 is a limit doing its job and is not an error. The canary in the second region is the view from outside.',
    },
    {
      objective: 'Freshness',
      target: '99% of accepted batches can be queried within 15 s of their 200, over 28 days',
      measure:
        'Applied time minus the record’s append time, published as a percentile by the storage nodes that are ready. A node that is replaying after a restart is not ready and is left out: the records it applies are old by design, and its partitions are answered by the other node. When both nodes of a partition are behind, nobody publishes for its batches, so a minute in which the smaller of the two sets’ MaxOffsetLag is above 750 records counts as failed for that partition’s share of the batches. The independent signal is MaxOffsetLag of the two replica sets’ consumer groups, which the queue computes in records: at 50 records a second per partition, 15 seconds are 750 records. Normal is under 4 seconds, and under 300 records with the 2 seconds between commits.',
    },
    {
      objective: 'Dashboard queries succeed',
      target: '99.9% answered without a 5xx, over 28 days',
      measure:
        'On the query path’s own load balancer: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount, with an absent 5XX count read as zero and a missing ratio counted as failed. Partial results and 429 answers are counted apart.',
    },
    {
      objective: 'Recent-range latency',
      target: '99% of queries on the raw tier answered within 1 s, over 28 days',
      measure:
        'A latency percentile per tier published by the dashboard pool. Normal p99 is about 600 ms. The load balancer’s TargetResponseTime, which mixes tiers, is the independent check that the pool is answering at all.',
    },
    {
      objective: 'Long-range latency',
      target: '99% of queries on the rollup tiers answered within 5 s, over 28 days',
      measure: 'The same percentile for the 5-minute and 1-hour tiers. Normal p99 is about 2.5 s.',
    },
    {
      objective: 'Rule evaluation',
      target: '99.9% of rule minutes evaluated, over 28 days',
      measure:
        'Rule minutes due minus rule minutes claimed, over rule minutes due. Claimed is the sum of the conditional writes that took a minute, which every evaluator counts under the rule minute claimed, not under the second the write landed, and publishes to one metric once that minute’s marks and their retries are past; due is the number of rules, 30,000 a minute, which every evaluator counts over all slots when it reloads the rule definitions. A minute that the second evaluator claimed is therefore not missed, and a slot with both evaluators dead shows as 3,750 missed a minute. The independent signal is the heartbeat data point of each slot in the second region.',
    },
    {
      objective: 'Page delivery',
      target:
        '99% of episodes accepted by the paging provider within 60 s of the evaluated minute that opened them, over 28 days',
      measure:
        'Notified time minus the episode’s start minute, which is the rule’s own minute mark, from the rule’s row, published by the evaluators for each notified episode. An episode that closes unsent has no notified time: it is recorded as never notified and counts as over 60 s. Silenced episodes are left out. Normal is 33 seconds, 43 when the first evaluator of a slot is down.',
    },
    {
      objective: 'Blocks written',
      target:
        '99.9% of raw blocks in block storage within 2 hours of the end of their window, over 28 days',
      measure:
        'The block’s upload time minus its window’s end, and the age of the oldest window not uploaded, published by the storage nodes. Normal is 75 minutes.',
    },
    {
      objective: 'Rollups built',
      target:
        'Every daily 5-minute block exists within 6 hours of the end of its day, over 28 days',
      measure:
        'The count of days whose 5-minute block is missing 4 hours after the day ended, published by every compactor pod on every loop. The same count includes months whose 1-hour block is missing 2 days after the month ended, which is what stands behind the 13 months of 1-hour points, and it covers only days inside the 90 days and months inside the 395 days their blocks are kept, so an expired block is not read as a missing one. Each pod counts over all 200 partitions from the listing, not only its own, so the partitions of a stuck pod are counted by the others. The 6-hour target has no measure of its own: a miss is read from this count staying above 0, and so the Rollups late alarm staying up, for more than 2 hours. A late rollup slows long queries and loses nothing until raw blocks expire 15 days later.',
    },
  ],
  alarms: [
    {
      name: 'Write errors',
      metric:
        'On the write ALB, each over one 5-minute window: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount above 0.04%, with an absent 5XX count read as zero and a missing ratio counted as breaching, or p99.96 TargetResponseTime above 300 ms',
      meaning:
        'Agents are being refused or kept waiting: gateway pods are down or the queue is not acknowledging. Each clause lets through at most 0.04% of requests, so together they stay inside the 0.1% the target allows, and 300 ms is tighter than 500 ms. The ratio is missing only when RequestCount is, as when no pod is registered, and that pages too. An agent refills a cut of up to 30 minutes completely, and somewhat less when all of a tenant’s agents backfill at once against its rate limit, so that is the time to act before a gap.',
    },
    {
      name: 'Canary cannot write',
      metric:
        'CloudWatchSynthetics SuccessPercent (average) of the write canary below 100 for 3 consecutive 1-minute periods, in the second region; missing data is breaching',
      meaning:
        'Writing from outside fails although the load balancer may look healthy from inside: DNS, the certificate, the firewall rules or the whole region. It also fires if the canary itself stops, a few minutes later than on failed runs because the last real data point must first leave the evaluation range. That case matters because the heartbeat rules read its sample.',
    },
    {
      name: 'Ingest behind',
      metric:
        'MSK MaxOffsetLag: the smaller of the two replica sets’ consumer groups above 500 records for 2 consecutive 1-minute periods; missing data is breaching',
      meaning:
        'Each replica set has a partition more than 500 records behind, so new samples may not be queryable and rules will soon be skipped. At 50 records a second per partition 500 records are about 10 seconds, the 2 seconds between commits included, below the 750 records of the 15-second target; 500 records would be 15 seconds only on a partition a third below the average rate. The number comes from the queue, so it works with every storage node dead. Taking the smaller of the two keeps one set replaying after a restart from paging. Check node memory, a stalled block upload and the brokers.',
    },
    {
      name: 'A replica set is behind',
      metric:
        'MSK MaxOffsetLag of either replica set’s consumer group above 500 records for 45 consecutive 1-minute periods; missing data is breaching. A ticket, not a page',
      meaning:
        'A node has been behind for about twice the 23 minutes a restart takes to replay, or cannot start. Some partitions have a single ready node, and one more failure there would make every query partial and stop every rule. Rolling a set takes longer than 45 minutes, so this ticket is expected during a deploy and is closed by whoever runs it; the page above stays armed, because it reads the smaller of the two sets.',
    },
    {
      name: 'Queue under-replicated or filling',
      metric:
        'MSK UnderMinIsrPartitionCount above 0 or OfflinePartitionsCount above 0 for 2 minutes, or KafkaDataLogsDiskUsed above 70% on any broker; missing data is breaching',
      meaning:
        'Writes to some partitions are failing or about to, or a broker’s disk is filling faster than retention empties it. Seventy percent leaves time before the 85% at which the service recommends acting. It returns to OK when replicas are back in sync or the disk is expanded.',
    },
    {
      name: 'Blocks late',
      metric:
        'Custom: the maximum over storage nodes of the age of the oldest window not uploaded, above 100 minutes for 5 minutes; missing data is breaching',
      meaning:
        'Windows are closing and not reaching block storage. It fires at 105 minutes at the earliest, the 100 of the threshold plus the 5 it must hold, 15 minutes before the 2-hour target. Normal is 75 minutes. Memory on the nodes is growing; at 80% a node stops reading the queue and Ingest behind follows. If every node is dead the metric is missing, which also fires.',
    },
    {
      name: 'Rollups late',
      metric:
        'Custom, the maximum of what the compactor pods publish: days whose 5-minute block is missing 4 hours after the day ended, plus months whose 1-hour block is missing 2 days after the month ended, counted by each pod over all 200 partitions, above 0; missing data is breaching',
      meaning:
        'A compactor pod is down or failing on some partition, 2 hours before the 6-hour target and 2 hours after the blocks normally exist. The other pods report its backlog, and with all four down the metric is missing, which also fires. Long queries fall back to raw blocks meanwhile. A missing monthly block is counted from 2 days after its month, against the 59 days or more before its daily inputs expire. It returns to OK when the missing blocks are built, which the next loop does on its own once the cause is fixed.',
    },
    {
      name: 'Dashboard errors',
      metric:
        'On the query ALB over one 5-minute window: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount above 0.05%, with an absent 5XX count read as zero and a missing ratio counted as breaching',
      meaning:
        'Dashboard queries are failing at half the 0.1% the target allows: query pods are down or storage nodes are refusing. A missing ratio means no request reached a pod at all.',
    },
    {
      name: 'Dashboards slow',
      metric:
        'Custom, from the dashboard pool: p99 latency of the raw tier above 800 ms over 5 minutes, or p99 of the rollup tiers above 3.5 s over 15 minutes; a missing percentile is not breaching, because a quiet period has no query on a tier',
      meaning:
        'Queries are slowing before the 1-second and 5-second targets are missed. Usually the cache is cold or unreachable, a storage node is overloaded, or block storage is slow. Rules are not affected: they have their own pool. The alarm is silent while a tier has no queries. A pool that is down is caught by Dashboard errors, whose ratio goes missing; a pool that answers and stops publishing its percentiles is not caught here, and the load balancer’s TargetResponseTime is the only view left.',
    },
    {
      name: 'Rules not evaluated',
      metric:
        'Custom, from the evaluators: rule minutes due minus rule minutes claimed, over rule minutes due, above 0.05% over 5 minutes, with claimed as the sum and due as the maximum of what the evaluators publish; missing data is breaching',
      meaning:
        'Rules are being skipped at half the rate the 99.9% target allows: the alert query pool is failing, one partition has no ready node, the state table refuses writes, or both evaluators of a slot are down, which leaves its 3,750 rules unclaimed. If the evaluators cannot publish at all, this fires on missing data and the heartbeat alarms fire from the second region.',
    },
    {
      name: 'Heartbeat missing',
      metric:
        'In the second region, one alarm per slot: fewer than 1 HeartbeatSent data point in each of 3 consecutive 1-minute periods; missing data is breaching',
      meaning:
        'For at least 3 minutes no evaluator of that slot completed the heartbeat rule: the canary sample did not arrive, could not be queried, or the minute could not be claimed. Alerting for that slot’s 3,750 rules must be assumed dead. It fires a few minutes after the last heartbeat: more than 3, because an alarm on missing data waits until the last real data point has left its evaluation range. When it is the canary’s samples that stop reaching storage it fires 3 minutes later still, because the rule holds for 3 minutes on the last sample. The write half proves the canary’s partition only; one partition with no ready node, whichever it is, stops all eight. It pages through the watchdog topic, not through the evaluators.',
    },
    {
      name: 'Pages not leaving',
      metric:
        'Custom, from the evaluators: the maximum of notified time minus episode start, published for each notified episode only, episodes that a silence held left out, above 50 s over 15 minutes, with missing data not breaching because a quiet period has no page; or episodes unsent for over 3 minutes, those held by a silence left out, published every minute, also at zero, above 0, with missing data breaching',
      meaning:
        'People are not being paged in time, before the 60-second target is missed: the paging provider is failing or its key is wrong. The first clause reads the slowest page of the period, so one page over 50 seconds fires it, against a normal 33 seconds and 43 with one evaluator down; it is silent when no page is sent, and dead evaluators are caught by the second clause, which fires on missing data. The count returns to 0 when the events are accepted or the episodes close. Escalation contacts get one message per episode after 5 minutes.',
    },
    {
      name: 'State table throttled',
      metric:
        'DynamoDB ThrottledRequests on the rule state table above 0 for 3 consecutive 1-minute periods; missing data is not breaching, because the metric exists only when a request is throttled',
      meaning:
        'Claims on rule minutes are being refused. A few are retried inside the minute; sustained throttling shows next as Rules not evaluated. It returns to OK a few minutes after the last throttled request, once fewer breaching data points remain in the evaluation range than the alarm needs.',
    },
  ],
  evolution: {
    mvp: 'One region, agents that push, the gateway with a sample rate per tenant, the queue, and one storage node per partition, accepting that a restart makes every query partial and stops every rule for the length of the replay. Raw blocks only, kept 30 days, with no compactor and no cache: at a hundredth of the scale a monthly chart is still cheap. Two evaluators for all rules and the paging provider with a deduplication key. The pieces that are cheap now and painful to add later are there from the first day: the queue as the first durable write, a sample identified by series and timestamp, the conditional put per block, the conditional write per rule minute, and the heartbeat checked from outside.',
    atScale: [
      'At 10x (100 million samples a second, a billion active series) a query can no longer touch every partition: with 2,000 partitions each one would make 500 node calls. Each tenant is placed on a subset of partitions, so a query fans out to its tenant’s subset only, and a bad node reaches fewer tenants.',
      'At 10x the queue passes what one cluster holds by default, 60 brokers, so partitions are split over several clusters by partition number, which the gateway and the storage nodes map statically.',
      'At 10x, 300,000 rules make 5,000 state writes a second for minutes in which nothing changed. The claim moves from a row per rule to a row per slot and minute, and a rule’s row is written only when its state changes.',
      'At 10x a replay of 205 minutes is too long to run on one replica: nodes write a snapshot of their memory to local disk every few minutes and replay only what came after it.',
      'At 100x one region is too large to fail at once. Each region runs the whole design for its own hosts and evaluates its own rules; a global dashboard asks every region and merges, and each region’s watchdog lives in another.',
      'At 100x block storage is the bill. Rollup blocks move to a columnar layout shared by many series, and the 1-hour tier becomes the only one kept past a year.',
    ],
    firstBottleneck:
      'Memory on the storage nodes, driven by active series. Every 2 million series is another node in each replica set, and unlike samples per second, series can multiply overnight with one label. The per-tenant series limit is what keeps this a planning problem. The second is the query fan-out: every query asks all 200 partitions, 400 calls a second per node today, which grows with both the number of queries and the number of partitions.',
    avoided: [
      'Evaluating rules on the ingest stream. It is faster and independent of storage, and it fits only simple rules. Worth adding for a handful of critical thresholds if a 30-second evaluation delay becomes too slow.',
      'A notifier service with an outbox and grouping across rules. The episode in the rule’s row and the provider’s deduplication key cover one page per firing. Worth adding when routing and grouping rules outgrow what the paging provider does.',
      'A log or snapshot on each storage node’s disk. The queue is the only log, which keeps one source of truth and costs a 23-minute replay. Worth adding at 10x, as above.',
      'A shared rate limiter or series counter in an in-memory store. Local buckets and per-partition counts are approximate and add nothing that can fail in the write path. Worth adding if tenants need limits exact to the sample.',
      'Stripping labels at the gateway. Dropping a whole metric is blunt and always correct; removing one label needs aggregation rules. Worth adding when teams ask for it often enough to maintain them.',
      'Leases or a leader for evaluators. Two evaluators and a conditional write need no election. Worth revisiting only if doubled rule queries become a real cost.',
      'A second region for the data. The watchdog reports a regional outage; it does not survive one. Worth adding at 100x, or sooner if the monitored systems themselves run in several regions.',
      'Building all of this when a managed Prometheus-compatible service would do. Below a few million series a managed service such as Amazon Managed Service for Prometheus removes the storage tier entirely. Worth building when scale, cost or isolation needs pass what the managed service offers.',
    ],
  },
};
