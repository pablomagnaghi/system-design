import type { Design } from '../types';

export const topK: Design = {
  slug: 'top-k',
  title: 'Top-K trending items',
  summary:
    'Count billions of views a day and answer "what are the top 100 items in the last hour, the last 24 hours, today and this week?" from memory: a live ranking that is at most a minute behind and counts every record in the log one time, and an exact daily ranking rebuilt from the raw events that replaces it.',
  difficulty: 'Hard',
  minutes: 14,
  requirements: {
    functional: [
      'Record a view of an item. One call carries one event with an id chosen by the client, the item, a category and a region.',
      'Return the top K items, K up to 100, for a live window: the last hour, the last 24 hours, or the current UTC day so far.',
      'Return the exact top K for a closed UTC day and for the 7 days that end on it, once the batch job has published them.',
      'Rank within a scope: everything, one of 30 categories or one of 70 regions, 101 scopes in all.',
      'Say on every answer how fresh it is and whether it is exact: the time it is as of, and an exact flag.',
    ],
    nonFunctional: [
      'About 4.32 billion events a day from 50 million daily users: 50,000 a second on average and 150,000 at peak.',
      'An accepted event is durable before the 202: the answer waits until the record is on at least two brokers in different Availability Zones.',
      'Ranking reads: 20,000 a second at peak, 99.9% answered within 100 ms, served from the memory of the API tasks.',
      'Freshness: a live ranking is normally 10 to 30 seconds behind the log, and at most 60 seconds behind in 99.5% of the minutes of 28 days.',
      'Live counts are the number of records in the log, each counted one time even across a crash and a replay. They include repeated event ids, about 0.1% of records, which only the batch job removes.',
      'The exact daily ranking counts each event id one time, can be rebuilt from the raw archive at any time, and is published by 03:00 UTC on at least 27 of 28 days.',
      'One viral item, 30% of all traffic, must not slow intake or make the ranking stale.',
    ],
    outOfScope: [
      'Rankings per user, and any ranking that needs to know who viewed what. An event carries no user id.',
      'Deciding whether a view is real. A bot that sends new event ids is counted like a person; only a rate rule per address and the removal of repeated ids are in scope.',
      'Combined filters, such as one category inside one region, and arbitrary time ranges.',
      'Rankings by anything other than a count of events: watch time, likes weighted against views, decay by age.',
      'Counting by the time on the phone. An event belongs to the moment the log received it.',
      'Daily rankings older than 7 days through the API. The exact counts stay in storage for analysts.',
      'More than one Region.',
    ],
  },
  entities: [
    {
      name: 'View event',
      description:
        'eventId (chosen by the client, repeated on a retry), itemId, category, region, occurredAt (the phone’s clock, kept but never used for counting). The log adds the partition, the offset and the append time. Immutable.',
    },
    {
      name: 'Counter key',
      description:
        'A scope and an item, such as all + item 42 or region br + item 42. Every event adds 1 to each of three keys: all, its category and its region.',
    },
    {
      name: 'Buckets',
      description:
        'Per counter key, in the state of one counter task: up to 60 minute buckets, 24 hour buckets and 2 day buckets, each a start time and a count.',
    },
    {
      name: 'Local top list',
      description:
        'What a counter task sends every 10 seconds for one scope and window: its 100 largest items with their totals, its task number, the number of tasks and its watermark.',
    },
    {
      name: 'Snapshot row',
      description:
        'One ranking, keyed by window (1h, 24h, day#date or 7d#date) and scope: up to 100 items with counts in order, asOf, exact (true or false), publishedAt and, on an exact row, runAt and the path of the counts it came from. About 5 KB.',
    },
    {
      name: 'Archive object',
      description:
        'A file of raw events from one partition, named by the first and last offset it holds and filed under the hour of its first record. Each row keeps the partition, the offset and the append time. Kept 90 days.',
    },
    {
      name: 'Daily exact counts',
      description:
        'Per day, scope and item: the number of distinct event ids. Written by one batch run under its own prefix and kept 2 years.',
    },
    {
      name: 'Checkpoint',
      description:
        'A consistent copy of the stream job: the offset of every partition together with every bucket, taken every 60 seconds.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/events',
      description:
        'Body: eventId, itemId, category, region, occurredAt. Answers 202 after the log has acknowledged the record, 503 if it has not within 2 seconds. The eventId is the idempotency key: a client that gets no 202 sends the same body again, for up to 24 hours. A repeat is accepted, counted again by the live ranking and counted one time by the exact one.',
    },
    {
      method: 'GET',
      path: '/top?window=1h|24h&scope=all|cat:music|reg:br&k=100',
      description:
        'The live ranking of a sliding window: items with their counts, asOf and exact: false. Served from the memory of the API task.',
    },
    {
      method: 'GET',
      path: '/top?window=day&date=2026-11-23&scope=all&k=100',
      description:
        'The ranking of one UTC day, today or one of the last 7. exact is false while the day is open and until the batch job has replaced the row, and true afterwards. Without a date it is today; in the first seconds after midnight UTC, until an API task has loaded the first row of the new day, it answers from the row of the day that just closed, and asOf shows it.',
    },
    {
      method: 'GET',
      path: '/top?window=7d&scope=all&k=100',
      description:
        'The exact ranking of the 7 closed days that end on the newest day the batch job has published. Always exact: true, with the date it ends on.',
    },
  ],
  dataFlow: [
    'A client posts a view. The ingest service checks it, appends it to a log partitioned by event id and answers 202 once two brokers have the record.',
    'A stream job reads the log, groups a second of events per item before sending them on, and routes each scope and item to one counter task, which keeps minute, hour and day buckets.',
    'Every 10 seconds each counter task scans its keys and sends its 100 largest items per scope and window. A merger combines the lists of all tasks and writes one snapshot row per scope and window, only if it is not older than the row already there.',
    'The ranking API copies the rows into memory every 5 seconds and answers every read from that copy.',
    'An archiver copies the log into object storage, one file per partition and range of offsets, and moves its position only after the file is stored.',
    'After midnight UTC a batch job checks that the archive is complete for the day, counts each event id one time, stores the exact counts and replaces the day’s provisional rows with exact ones.',
  ],
  highLevel: {
    label: 'Count a view and serve the ranking',
    intro:
      'Follow one view from the phone to a counted minute, and one ranking from the counters to a reader. The design grows a piece at a time: a log, counters that a viral item skews until events are grouped before the shuffle, windows made of buckets, local lists merged into one ranking, a snapshot served from memory, a crash and its replay, and the archive and batch job that make the daily numbers exact. Numbers are illustrative. Press play, or step through the stages to see what happens and what each choice costs.',
    lanes: { top: 'State and reads', bottom: 'Exact path' },
    nodes: [
      { id: 'clients', title: 'Clients', detail: 'Send view events', column: 0, row: 'middle' },
      {
        id: 'ingest',
        title: 'Ingest service',
        detail: 'Check, append, 202',
        column: 1,
        row: 'middle',
      },
      {
        id: 'log',
        title: 'Event log',
        detail: '64 partitions',
        column: 2,
        row: 'middle',
      },
      {
        id: 'counters',
        title: 'Stream counters',
        detail: 'Buckets per item',
        column: 3,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'ckpt',
        title: 'Checkpoints',
        detail: 'Offsets and counts',
        column: 3,
        row: 'top',
        appearsAt: 8,
      },
      {
        id: 'merger',
        title: 'Merger',
        detail: 'Lists into one top K',
        column: 4,
        row: 'middle',
        appearsAt: 5,
      },
      {
        id: 'table',
        title: 'Snapshot table',
        detail: 'A row per ranking',
        column: 5,
        row: 'middle',
        appearsAt: 6,
      },
      {
        id: 'readers',
        title: 'Ranking page',
        detail: 'Asks for a top K',
        column: 4,
        row: 'top',
        appearsAt: 7,
      },
      {
        id: 'api',
        title: 'Ranking API',
        detail: 'Rows in memory',
        column: 5,
        row: 'top',
        appearsAt: 7,
      },
      {
        id: 'archive',
        title: 'Raw archive',
        detail: 'Files by offset',
        column: 3,
        row: 'bottom',
        appearsAt: 9,
      },
      {
        id: 'batch',
        title: 'Batch job',
        detail: 'Exact daily counts',
        column: 4,
        row: 'bottom',
        appearsAt: 10,
      },
    ],
    edges: [
      ['clients', 'ingest'],
      ['ingest', 'log'],
      ['log', 'counters'],
      ['counters', 'ckpt'],
      ['counters', 'merger'],
      ['merger', 'table'],
      ['readers', 'api'],
      ['api', 'table'],
      ['log', 'archive'],
      ['archive', 'batch'],
      ['batch', 'table'],
    ],
    stages: [
      {
        title: 'Append the event, then answer 202',
        narration:
          'A client posts a view with an event id it chose. The ingest service checks the token and the shape, replaces an unknown category or region with other, and appends the event to a log of 64 partitions, picked by a hash of the event id. The log is told to acknowledge only when at least two of the three replicas of the partition, in different Availability Zones, have the record, and the 202 waits for that. If no acknowledgement comes within 2 seconds the answer is 503 and the client sends the same event again later. Nothing is counted yet.',
        tradeoff:
          'One append is the only write in the request, so intake depends on nothing but the log and there is no second step to lose after it. The cost is that a view shows in the ranking seconds later, and that a retry after a lost answer puts the same event in the log twice. Partitioning by event id spreads a viral item evenly over all 64 partitions and puts both copies of a repeated event in the same one; the price is that events of one item are scattered, so something downstream has to bring them together.',
        nodes: ['clients', 'ingest', 'log'],
        travel: [
          ['clients', 'ingest'],
          ['ingest', 'log'],
        ],
        short: 'Accept 202',
        metrics: {
          users: '50M',
          requestsPerSecond: '150K',
          p95Latency: '15 ms',
          errorRate: '0.01%',
        },
        load: { ingest: 67, log: 40 },
      },
      {
        title: 'Count per item, per minute',
        narration:
          'A stream job reads the 64 partitions with 32 parallel tasks. Every event becomes three increments, one for each of its counter keys: all, its category and its region. The job routes each key by its hash to one of 32 counter tasks, so every increment of one scope and item reaches the same task, which adds it to the bucket of the minute the log appended the event. The time comes from the log, not from the phone.',
        tradeoff:
          'Routing by key means no two tasks ever count the same item, which is what later lets their lists be merged without error. It costs a shuffle of every increment across the network, 450,000 a second at peak, and it makes one task responsible for whatever the busiest item sends.',
        nodes: ['log', 'counters'],
        travel: [['log', 'counters']],
        short: 'Count',
        metrics: {
          users: '50M',
          requestsPerSecond: '150K',
          p95Latency: '15 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Increments', value: '450K/s' },
            { label: 'Per counter task', value: '14K/s' },
          ],
        },
        load: { log: 40, counters: 28 },
      },
      {
        title: 'A viral item skews one task',
        narration:
          'One item takes 30% of all traffic: 45,000 views a second. Its three keys carry 135,000 increments a second, and in the worst case all three hash to the same counter task, which now receives up to about 149,000 a second against a plan of 50,000. That task falls behind and pushes back on every reader, because each of them has increments for it. Intake is unaffected, since it only appends to the log, but the job reads the log more slowly than it grows and every ranking goes stale, not just the viral item’s.',
        tradeoff:
          'More counter tasks do not help: a key lives on one task however many there are. Splitting the hot key over several tasks would spread the load, but then no single task knows the item’s count and the local lists stop being enough to merge.',
        nodes: ['log', 'counters'],
        travel: [['log', 'counters']],
        short: 'Viral item',
        metrics: {
          users: '50M',
          requestsPerSecond: '150K',
          p95Latency: '15 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Hot task input', value: '149K/s', alert: true },
            { label: 'Ranking age', value: 'Growing', alert: true },
          ],
        },
        load: { log: 40, counters: 100 },
        traffic: [{ edge: ['log', 'counters'], kind: 'heavy' }],
      },
      {
        title: 'Group a second of events before the shuffle',
        narration:
          'Each reading task now keeps a small table before it sends anything on: counter key and minute to a count. It empties the table downstream every second, when it reaches 10,000 entries, and before its state is saved. The viral item becomes one record per key per reading task per second, 96 records a second in all, each carrying a count in the thousands. The hot counter task is back to its usual 14,000 records a second.',
        tradeoff:
          'The grouping adds up to a second of delay and removes the hot key without changing who owns a count. It sits inside the stream job, after the log, so the raw events in the log are untouched and a crash loses nothing: the table is emptied before its state is saved, and whatever it held after that is read again from the log. For the long tail it saves nothing, since most items appear once a second or less, so the counter tasks are still sized for all 450,000 increments.',
        nodes: ['log', 'counters'],
        travel: [['log', 'counters']],
        short: 'Pre-aggregate',
        metrics: {
          users: '50M',
          requestsPerSecond: '150K',
          p95Latency: '15 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Hot item records', value: '96/s' },
            { label: 'Hot task input', value: '14K/s' },
          ],
        },
        load: { log: 40, counters: 28 },
      },
      {
        title: 'Windows made of buckets',
        narration:
          'A counter task adds each increment to three buckets of its key: the minute, the hour and the UTC day of the append time. The last hour is the sum of the 60 newest minute buckets, the current partial minute and the 59 before it, so it covers between 59 and 60 minutes and slides a minute at a time. The last 24 hours is the sum of the 24 newest hour buckets, the current partial hour and the 23 before it, so it slides an hour at a time. The day is one bucket. Now is not the wall clock but the watermark: 5 seconds behind the newest append time of the slowest partition. A bucket that has left every window is deleted, and a key with no buckets is deleted with it.',
        tradeoff:
          'Three bucket sizes keep the state small: about 50 million keys and 10 GB for everything, where a 24-hour window that slides by the minute would need up to 1,440 buckets per key. The price is a 24-hour ranking that covers between 23 and 24 hours and drops a whole hour on the hour. Using the log’s append time means there are no late events to wait for and a replay lands every event in the same bucket as before; it also means a view made offline is counted when it arrives, not when it happened.',
        nodes: ['counters'],
        travel: [],
        short: 'Windows',
        metrics: {
          users: '50M',
          requestsPerSecond: '150K',
          p95Latency: '15 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Keys in state', value: '50M' },
            { label: 'State', value: '~10 GB' },
          ],
        },
        load: { counters: 35 },
      },
      {
        title: 'Local top lists, merged into one',
        narration:
          'Every 10 seconds each counter task scans its keys, about 1.6 million of them, sums the buckets that are inside each window and keeps the 100 largest items per scope and window. It sends those lists, 303 per task, to the merger with its watermark. The merger holds the latest list of every task and, every 10 seconds, takes the 100 largest across the 32 lists of a scope and window. Ties are broken by item id, so the order is always defined.',
        tradeoff:
          'Sending lists and not counts cuts the traffic to 970 small records a second, and the result is the true top 100 of the live counts, because a key lives on one task: an item in the global top 100 has fewer than 100 items above it anywhere, so also on its own task. Recomputing the totals on every scan is what makes it safe when counts go down as buckets leave a window; a heap that only saw increases would keep an item that has fallen. The cost is a full scan of the state every 10 seconds, which grows with the number of keys and not with traffic.',
        nodes: ['counters', 'merger'],
        travel: [['counters', 'merger']],
        short: 'Merge lists',
        metrics: {
          users: '50M',
          requestsPerSecond: '150K',
          p95Latency: '15 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Keys per scan', value: '1.6M' },
            { label: 'Lists per round', value: '9,696' },
          ],
        },
        load: { counters: 40, merger: 20 },
      },
      {
        title: 'Publish a snapshot that cannot go back',
        narration:
          'For every scope and window the merger writes one row to the snapshot table: the 100 items with their counts and asOf, the lowest watermark among the 32 lists it used. It publishes only when it holds a list from every task. The write carries a condition: it writes the row if there is none, and otherwise replaces it only if the row is not exact and its asOf is not newer. The writes of a round go out concurrently under one 2-second limit for the whole round. A write that fails or has not finished by then is dropped, and the round 10 seconds later writes the row again.',
        tradeoff:
          'A complete row per ranking makes the publish a plain overwrite that the next round repeats, so there is no outbox and no retry queue. The condition means a job that replays old data after a restart cannot move a ranking backwards, and two copies of the job running at once cannot fight: the newer asOf wins. It costs 303 writes every round, about 152 write units a second, whether the ranking changed or not, because asOf is how readers measure staleness.',
        nodes: ['merger', 'table'],
        travel: [['merger', 'table']],
        short: 'Publish',
        metrics: {
          users: '50M',
          requestsPerSecond: '150K',
          p95Latency: '15 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Rows per round', value: '303' },
            { label: 'Table writes', value: '30/s' },
          ],
        },
        load: { merger: 20, table: 15 },
      },
      {
        title: 'Serve every read from memory',
        narration:
          'Each ranking API task copies the 303 live rows into memory every 5 seconds with three queries, and the day and week rows every 5 minutes. A read is a lookup in that copy: it returns the first K items, asOf and the exact flag, and touches no store. If the table cannot be read, the task keeps answering from the copy it has, and asOf tells the reader how old it is. Each task also publishes the age of its oldest live row, which is the number the freshness alarm watches.',
        tradeoff:
          'All rankings together are about 5.6 MB, so every task can hold all of them and 20,000 reads a second never reach the table or the counters. The cost is up to 5 more seconds of staleness and a fixed menu: only the windows and scopes that were computed in advance can be served. A new task must load the rows before it takes traffic.',
        nodes: ['readers', 'api', 'table'],
        travel: [
          ['readers', 'api'],
          ['api', 'table'],
        ],
        short: 'Serve',
        metrics: {
          users: '50M',
          requestsPerSecond: '150K',
          p95Latency: '15 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Ranking reads', value: '20K/s' },
            { label: 'Read p95', value: '10 ms' },
            { label: 'Ranking age', value: '10-30 s' },
          ],
        },
        load: { api: 67, table: 10 },
      },
      {
        title: 'A task dies and the job replays',
        narration:
          'Every 60 seconds the job stores a checkpoint: the offset of each partition together with every bucket and the merger’s lists, as of the same instant. A counter task dies. The service restarts the job from the newest checkpoint, about 90 seconds later, and the readers start again from the stored offsets, so every record after the checkpoint is counted again into state that had not counted it yet. The job is up to about 150 seconds behind, the 60 seconds between checkpoints plus the few seconds a checkpoint takes plus the restart, and reads at three times the peak rate, so it catches up in about 75 seconds. Until its watermark passes the asOf already in the table, its writes are refused by the condition and readers keep the last ranking.',
        tradeoff:
          'Storing offsets and counts together is what makes a replay count each record one time; committing offsets and counts separately would count some twice or skip them. The price is staleness, not error: the ranking is up to about 2 minutes old during a restart at peak, which uses about 3 minutes of the 201 minutes in 28 days that the freshness objective allows. A deploy of the job costs the same.',
        nodes: ['log', 'counters', 'ckpt', 'table'],
        travel: [
          ['counters', 'ckpt'],
          ['log', 'counters'],
        ],
        short: 'Crash, replay',
        metrics: {
          users: '50M',
          requestsPerSecond: '150K',
          p95Latency: '15 ms',
          errorRate: '0.01%',
          healthy: '31 / 32',
          custom: [
            { label: 'Ranking age', value: '~2 min', alert: true },
            { label: 'Catch-up', value: '75 s' },
          ],
        },
        load: { log: 40, counters: 85 },
        traffic: [{ edge: ['log', 'counters'], kind: 'heavy' }],
      },
      {
        title: 'Archive the raw events',
        narration:
          'An archiver reads the same log with its own position. For each partition it collects records for 5 minutes or 128 MB of stored columnar file, writes them as one file named by the first and last offset it holds, and only after the file is stored does it move its position. A crash between the two writes the same records again in a file that overlaps the first. The log keeps 72 hours, so the archiver can be down for a long time before anything is missed.',
        tradeoff:
          'File first, position second means the archive can repeat records but cannot skip them, and the offsets in the file names let anyone prove it: the ranges of a partition must chain without a gap. The cost is a second reader of the whole log and files that repeat a few records, which whoever reads the archive drops by partition and offset. The live path does not depend on the archive at all.',
        nodes: ['log', 'archive'],
        travel: [['log', 'archive']],
        short: 'Archive',
        metrics: {
          users: '50M',
          requestsPerSecond: '150K',
          p95Latency: '15 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Archive lag', value: '≤ 5 min' },
            { label: 'Files per day', value: '18,432' },
            { label: 'Ranking age', value: '10-30 s' },
          ],
        },
        load: { log: 40, archive: 30 },
      },
      {
        title: 'The batch job makes the day exact',
        narration:
          'At 00:30 UTC a schedule starts the batch job for the day that just closed. It first checks the archive: for each of the 64 partitions the offset ranges must chain without a gap from a record appended before the day began up to a record appended at 00:10 or later. Then it keeps one record per event id, the earliest, leaves out ids whose earliest copy is in the previous day, counts per scope and item, and stores the counts under a prefix of its own. Last, it replaces the day’s 101 provisional rows with exact ones, and writes the 7-day rows from seven days of exact counts. If the check fails it publishes nothing, and the schedule tries again every hour until 05:30.',
        tradeoff:
          'Two paths mean two pieces of counting logic, and the exact answer arrives about an hour after the day ends. In exchange the live path can stay simple and fast, counting repeats and all, while the numbers that are reported or paid on come from the raw events and can be recomputed after any bug. The job also measures how far the provisional counts were from the exact ones, so the error of the live ranking is a number on a dashboard and not an assumption.',
        nodes: ['archive', 'batch', 'table'],
        travel: [
          ['archive', 'batch'],
          ['batch', 'table'],
        ],
        short: 'Exact batch',
        metrics: {
          users: '50M',
          requestsPerSecond: '150K',
          p95Latency: '15 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Events per day', value: '4.32B' },
            { label: 'Exact by', value: '~01:00 UTC' },
            { label: 'Repeats removed', value: '~0.1%' },
          ],
        },
        load: { archive: 60, batch: 85, table: 10 },
        traffic: [{ edge: ['archive', 'batch'], kind: 'heavy' }],
      },
    ],
  },
  flows: [
    {
      id: 'view',
      title: 'One view, from the phone to a counted minute',
      kind: 'sync',
      summary:
        'Ana opens item 42. Her app posts one event; the ingest service appends it to the log and answers 202 in about 15 ms. A few seconds later a counter task has added it to the buckets of three keys.',
      runsOn:
        'Events ALB → ingest service on ECS Fargate → Amazon MSK → Managed Service for Apache Flink',
      participants: [
        { id: 'app', label: 'Client app', service: 'Phone' },
        { id: 'ingest', label: 'Ingest service', service: 'ALB with AWS WAF + ECS Fargate' },
        { id: 'log', label: 'Event log', service: 'Amazon MSK' },
        { id: 'reader', label: 'Reading task', service: 'Managed Flink' },
        { id: 'counter', label: 'Counter task', service: 'Managed Flink' },
      ],
      steps: [
        {
          from: 'app',
          to: 'ingest',
          label: 'POST /events {eventId: e7, itemId: 42, category: music, region: br}',
          note: 'Over TLS with a short-lived session token. The load balancer serves only this API, and a rate rule per source address sits in front of it. The app chose e7 and will send the same id if it has to try again.',
        },
        {
          from: 'ingest',
          to: 'ingest',
          label: 'check token and shape; unknown category or region → other',
          note: 'Tasks are stateless and read no store. The lists of 30 categories and 70 regions are configuration. A malformed event is refused with 400 and never reaches the log.',
        },
        {
          from: 'ingest',
          to: 'log',
          label: 'produce key=e7, acks=all',
          note: 'The partition is a hash of the event id, here 17 of 64. The producer waits at most 2 seconds. Its own retries inside that time cannot write the record twice, because the producer is idempotent.',
        },
        {
          from: 'log',
          to: 'ingest',
          label: 'ack: partition 17, offset 9,001, append time 12:00:07',
          note: 'The leader answers after the in-sync replicas have the record, at least two of three, in different Availability Zones. The broker sets the timestamp at the append; this is the time the event is counted under.',
          style: 'reply',
        },
        {
          from: 'ingest',
          to: 'app',
          label: '202',
          note: 'No acknowledgement within 2 seconds is a 503, and the app sends e7 again with a growing pause, for up to 24 hours. An event that never got its 202 was never promised.',
          style: 'reply',
        },
        {
          from: 'log',
          to: 'reader',
          label: 'record 17:9,001',
          note: 'One of 32 reading tasks, each with two partitions. It turns the event into three increments: (all, 42), (cat:music, 42) and (reg:br, 42), all for minute 12:00.',
          style: 'async',
        },
        {
          from: 'reader',
          to: 'reader',
          label: 'table[(key, 12:00)] += 1',
          note: 'The small table that groups a second of events. It is emptied every second, at 10,000 entries and before each checkpoint.',
        },
        {
          from: 'reader',
          to: 'counter',
          label: '(all, 42, 12:00, +3) and two more',
          note: 'Each key goes to the counter task its hash names, always the same one. In this second three views of item 42 passed through this reading task, so the record carries 3.',
          style: 'async',
        },
        {
          from: 'counter',
          to: 'counter',
          label: 'minute 12:00 += 3, hour 12 += 3, day += 3',
          note: 'Three buckets of the key, in the task’s local state. The next scan, at most 10 seconds away, will see the new totals.',
        },
      ],
    },
    {
      id: 'read',
      title: 'A ranking read served from memory',
      kind: 'sync',
      summary:
        'The home page asks for the 10 most viewed music items of the last hour. An API task answers from the copy of the snapshot rows it refreshed a few seconds ago, in about 10 ms and without calling anything.',
      runsOn: 'Ranking ALB → ranking API on ECS Fargate (memory), refreshed from Amazon DynamoDB',
      participants: [
        { id: 'page', label: 'Ranking page', service: 'Browser or app' },
        { id: 'api', label: 'Ranking API', service: 'ALB with AWS WAF + ECS Fargate' },
        { id: 'table', label: 'Snapshot table', service: 'DynamoDB' },
        { id: 'cw', label: 'Metrics', service: 'CloudWatch' },
      ],
      steps: [
        {
          from: 'api',
          to: 'table',
          label: 'every 5 s: Query pk=1h, Query pk=24h, Query pk=day#today',
          note: 'Three eventually consistent queries, each returning the 101 scopes of one window, about 505 KB and so inside one page. A copy can trail the table by a moment, which is small next to the 5 seconds between refreshes.',
        },
        {
          from: 'table',
          to: 'api',
          label: '303 rows',
          note: 'The task swaps the new rows in. If a query fails, it keeps the rows it has and tries again in 5 seconds. A row is never replaced by one with an older asOf.',
          style: 'reply',
        },
        {
          from: 'api',
          to: 'cw',
          label: 'OldestLiveRowAge = now − min(asOf)',
          note: 'One number per task per refresh: the age of the oldest of the live rows it holds, 303 except in the first seconds of a day, before the new day’s 101 are loaded. It is measured by the reader, so it rises when the stream job, the table or the refresh itself is the part that stopped. The limit: a task whose refresh loop hangs publishes nothing, the maximum over the other tasks hides it, and no alarm here sees that one task; its answers still carry their asOf.',
          style: 'async',
        },
        {
          from: 'page',
          to: 'api',
          label: 'GET /top?window=1h&scope=cat:music&k=10',
          note: 'On its own load balancer, apart from the events. An unknown window or scope is a 400.',
        },
        {
          from: 'api',
          to: 'api',
          label: 'rows[1h][cat:music].items[0..10]',
          note: 'A lookup and a slice in memory. Nothing is computed and no store is called on the read path.',
        },
        {
          from: 'api',
          to: 'page',
          label: '200 {items, asOf: 12:00:41, exact: false}',
          note: 'The reader always learns how fresh the answer is. Normally asOf is 10 to 30 seconds ago.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'viral',
      title: 'A viral item skews one task',
      kind: 'async',
      summary:
        'Item 42 gets 45,000 views a second, 30% of the peak. Grouping a second of events in each reading task turns 135,000 increments a second into 96 records, so the counter task that owns its keys sees no difference.',
      runsOn: 'Amazon MSK → Managed Service for Apache Flink (reading tasks → counter tasks)',
      participants: [
        { id: 'log', label: 'Event log', service: 'Amazon MSK' },
        { id: 'reader', label: 'Reading tasks', service: 'Managed Flink, 32 tasks' },
        { id: 'hot', label: 'Counter task 9', service: 'Managed Flink' },
        { id: 'merger', label: 'Merger', service: 'Managed Flink' },
      ],
      steps: [
        {
          from: 'log',
          to: 'reader',
          label: '45,000 views of item 42 a second, over 64 partitions',
          note: 'The log is partitioned by event id, so the viral item is spread evenly: about 700 a second per partition, and no partition or broker is hot.',
          style: 'async',
        },
        {
          from: 'reader',
          to: 'reader',
          label: 'table[((all, 42), 12:00)] += 1, about 1,400 times a second',
          note: 'Each reading task sees about 1,400 views of the item a second and adds them up in its table, under three keys.',
        },
        {
          from: 'reader',
          to: 'hot',
          label: 'once a second: (all, 42, 12:00, +1,406)',
          note: 'One record per key per reading task per second: 32 × 3 = 96 records a second for the whole item. Without the table it would be 135,000, on top of the rest of the task’s load, at most its usual 14,000, against a plan of 50,000.',
          style: 'async',
        },
        {
          from: 'hot',
          to: 'hot',
          label: 'minute 12:00 += 1,406',
          note: 'The count is the same as if the views had arrived one by one. Only the number of records changed.',
        },
        {
          from: 'hot',
          to: 'merger',
          label: 'local top 100 of (all, 1h): item 42 first',
          note: 'The item’s full count is on this one task, so its place in the local list is its true place, and the merger needs nothing else to rank it.',
          style: 'async',
        },
      ],
    },
    {
      id: 'restart',
      title: 'A task dies and the job restarts from its checkpoint',
      kind: 'async',
      summary:
        'A counter task dies 40 seconds after a checkpoint. The service restarts the job from that checkpoint; the 40 seconds and the downtime are read again from the log into state that had not counted them, and the table refuses rankings older than the one it has.',
      runsOn:
        'Managed Service for Apache Flink → its checkpoint storage in Amazon S3 → Amazon MSK → Amazon DynamoDB',
      participants: [
        { id: 'svc', label: 'Flink service', service: 'Managed Service for Apache Flink' },
        { id: 'ckpt', label: 'Checkpoint', service: 'S3, owned by the service' },
        { id: 'log', label: 'Event log', service: 'Amazon MSK' },
        { id: 'job', label: 'Stream job', service: 'Managed Flink, 32 tasks' },
        { id: 'table', label: 'Snapshot table', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'job',
          to: 'ckpt',
          label: '12:00:00 checkpoint: offsets of 64 partitions + all buckets + merger lists',
          note: 'Taken every 60 seconds. Every task stores its part as of the same point in the stream, so the offsets and the counts describe the same set of records. The reading tasks empty their tables first.',
        },
        {
          from: 'job',
          to: 'table',
          label: 'PutItem 1h/all asOf=12:00:33',
          note: 'The last ranking published before the failure.',
        },
        {
          from: 'job',
          to: 'svc',
          label: '12:00:40 counter task 9 is gone',
          note: 'Its machine died. The buckets it changed since 12:00:00 are lost with it, and so is the consistency of the other tasks, which have counted records it has not.',
          style: 'async',
        },
        {
          from: 'svc',
          to: 'job',
          label: 'restart every task from the newest checkpoint',
          note: 'Planned at about 90 seconds; the service states no figure. All tasks go back, not only the one that died, because only the whole checkpoint is consistent.',
        },
        {
          from: 'ckpt',
          to: 'job',
          label: 'buckets and offsets as of 12:00:00',
          note: 'Nothing counted after 12:00:00 is in this state, and nothing counted before it is missing.',
          style: 'reply',
        },
        {
          from: 'job',
          to: 'log',
          label: 'read each partition from its stored offset',
          note: 'The offsets come from the checkpoint, not from what the job last reported to the log. Each record after the checkpoint is counted again, into state that does not contain it: one time in the end.',
        },
        {
          from: 'job',
          to: 'table',
          label: 'PutItem 1h/all asOf=12:00:20 IF not exists OR (exact = false AND asOf <= :asOf)',
          note: 'Refused: the row holds 12:00:33. While the job is behind what it published before, every write fails its condition and readers keep the newer ranking. A refused write still uses write units.',
        },
        {
          from: 'job',
          to: 'table',
          label: 'PutItem 1h/all asOf=12:00:35',
          note: 'Accepted once the watermark passes 12:00:33, about 15 seconds after the job is back. Here the job is 130 seconds behind and reads at three times the peak rate, so it is level again in about 65 seconds. The worst case, a failure just before a checkpoint, is 150 seconds behind and 75 to catch up, with rankings up to about 2 minutes old on the way.',
        },
      ],
    },
    {
      id: 'repeat',
      title: 'A repeated event and an event that arrives late',
      kind: 'async',
      summary:
        'The answer to event e7 is lost, so the app sends it again: two records, counted twice by the live ranking and one time by the batch job. Event e9 was made on a plane three hours ago and is counted in the minute it arrives.',
      runsOn:
        'Ingest service on ECS Fargate → Amazon MSK → Managed Service for Apache Flink; later Amazon EMR Serverless',
      participants: [
        { id: 'app', label: 'Client app', service: 'Phone' },
        { id: 'ingest', label: 'Ingest service', service: 'ECS Fargate' },
        { id: 'log', label: 'Event log', service: 'Amazon MSK' },
        { id: 'job', label: 'Stream job', service: 'Managed Flink' },
        { id: 'batch', label: 'Batch job', service: 'EMR Serverless' },
      ],
      steps: [
        {
          from: 'app',
          to: 'ingest',
          label: 'POST /events {eventId: e7, itemId: 42}',
          note: 'The ingest task appends the event at offset 9,001 of partition 17 and dies before it answers.',
        },
        {
          from: 'app',
          to: 'ingest',
          label: 'POST /events {eventId: e7, itemId: 42} again',
          note: 'The app got no 202, so it repeats with the same id. Another task appends it: the same partition, because the partition is a hash of the id, at offset 9,950. The ingest service keeps no memory of ids and does not try to.',
        },
        {
          from: 'log',
          to: 'job',
          label: 'records 17:9,001 and 17:9,950',
          note: 'Two records are two increments. The live count of item 42 is one too high until the buckets that hold them leave the windows. Dropping repeats here would need the ids of a whole day in state, 4.32 billion of them.',
          style: 'async',
        },
        {
          from: 'app',
          to: 'ingest',
          label: 'POST /events {eventId: e9, itemId: 7, occurredAt: 09:00}',
          note: 'Sent at 12:00, when the phone is online again. The ingest service accepts it like any other event.',
        },
        {
          from: 'log',
          to: 'job',
          label: 'record with append time 12:00:07',
          note: 'Counted in minute 12:00. The phone’s clock is kept in the event and plays no part. There is no late event to place in a closed window, because the time is given by the log and the stream job reads the log in order.',
          style: 'async',
        },
        {
          from: 'batch',
          to: 'batch',
          label: 'after midnight: one record per event id, the earliest',
          note: 'Offset 9,950 is dropped and e7 counts one time. An id whose earliest copy is in the previous day is left out of this day, which is why a client stops repeating an event after 24 hours. e9 is counted on the day it arrived, the same day the live ranking used.',
        },
      ],
    },
    {
      id: 'roll',
      title: 'A window rolls: minutes, the hour and the day',
      kind: 'scheduled',
      summary:
        'Nothing is copied from minutes into hours. Every increment is added to a minute, an hour and a day bucket at once, and a window moves when the watermark crosses a boundary: the next scan simply sums different buckets.',
      runsOn: 'Managed Service for Apache Flink (counter task → merger) → Amazon DynamoDB',
      participants: [
        { id: 'counter', label: 'Counter task', service: 'Managed Flink' },
        { id: 'merger', label: 'Merger', service: 'Managed Flink' },
        { id: 'table', label: 'Snapshot table', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'counter',
          to: 'counter',
          label: 'watermark passes 13:00:00',
          note: 'The watermark is 5 seconds behind the newest append time of the slowest partition, and a partition silent for 30 seconds stops holding it back. Crossing 13:00 is a new minute and a new hour.',
        },
        {
          from: 'counter',
          to: 'counter',
          label: 'scan: 1h = minutes 12:01 to 13:00; 24h = hours 14:00 yesterday to 13:00',
          note: 'The minute bucket 12:00 and the hour bucket 13:00 of yesterday are no longer summed, and the scan deletes them. Totals are recomputed from the buckets on every scan, so there is no running total to correct.',
        },
        {
          from: 'counter',
          to: 'merger',
          label: '303 local lists, watermark 13:00:02',
          note: 'An item whose views were all in the hour that left the 24-hour window drops out of the list at this scan. That is the step of an hour the 24-hour window moves in.',
          style: 'async',
        },
        {
          from: 'merger',
          to: 'table',
          label:
            'PutItem 1h, 24h and day#today rows IF not exists OR (exact = false AND asOf <= :asOf)',
          note: 'One row per scope and window, every 10 seconds, with the lowest watermark of the 32 lists.',
        },
        {
          from: 'counter',
          to: 'counter',
          label: 'watermark passes 00:00:00 UTC',
          note: 'New increments go to the new day’s bucket. The task keeps the bucket of the day that closed for 10 more minutes and keeps sending its list.',
        },
        {
          from: 'merger',
          to: 'table',
          label: 'PutItem day#yesterday asOf=00:00:00, and day#today',
          note: 'The closed day is written again on every round until the watermark passes 00:10, so one failed write is replaced by the next. Its last version is the provisional ranking of the day, exact: false, until the batch job replaces it. The new day has no row before this first round after midnight; until an API task has loaded it, a day request without a date is answered from the closed day’s row.',
        },
      ],
    },
    {
      id: 'archive',
      title: 'The archiver copies the log, and crashes once',
      kind: 'queue',
      summary:
        'An archiver task writes five minutes of partition 17 as one file and dies before it moves its position. Its successor writes the same records again. The archive has a repeat and no gap.',
      runsOn: 'Amazon MSK → archiver on ECS Fargate → Amazon S3',
      participants: [
        { id: 'log', label: 'Event log', service: 'Amazon MSK' },
        { id: 'arch', label: 'Archiver', service: 'ECS Fargate, 8 tasks' },
        { id: 's3', label: 'Raw archive', service: 'Amazon S3' },
      ],
      steps: [
        {
          from: 'arch',
          to: 'log',
          label: 'fetch partition 17 from committed offset 9,000',
          note: 'The 8 tasks share the 64 partitions as one consumer group. The archiver has its own position in the log and shares nothing with the stream job.',
        },
        {
          from: 'arch',
          to: 's3',
          label: 'PutObject raw/dt=2026-11-23/hour=12/p=17/9000-243000.parquet',
          note: 'After 5 minutes or 128 MB of stored file, whichever comes first; a five-minute file is about 35 MB at peak, so only an archiver that is catching up reaches the size. Each row keeps its partition, offset and append time next to the event. A failed write is tried again with a pause for as long as it takes; the partition waits and the lag alarm tells someone.',
        },
        {
          from: 'arch',
          to: 'arch',
          label: 'crash before the commit',
          note: 'The file is stored. The position in the log still says 9,000.',
        },
        {
          from: 'arch',
          to: 'log',
          label: 'another task: fetch partition 17 from 9,000',
          note: 'The group gives the partition to a task that is alive, and it starts from the committed position.',
        },
        {
          from: 'arch',
          to: 's3',
          label: 'PutObject .../p=17/9000-251500.parquet',
          note: 'It cut the file at a different moment, so the name differs and both files stay. They overlap on 234,001 records. A reader of the archive keeps one row per partition and offset.',
        },
        {
          from: 'arch',
          to: 'log',
          label: 'commit offset 251,501',
          note: 'Only after the file is stored. A position can therefore be behind the files and never ahead of them, which is why the ranges of a partition always chain.',
        },
      ],
    },
    {
      id: 'batch',
      title: 'The batch job publishes the exact day',
      kind: 'scheduled',
      summary:
        'At 00:30 UTC the job for the day that closed checks that the archive is complete, counts each event id one time, stores the counts and replaces the provisional rows with exact ones. It takes about 20 minutes.',
      runsOn: 'EventBridge Scheduler → Amazon EMR Serverless (Spark) → Amazon S3 → Amazon DynamoDB',
      participants: [
        { id: 'sched', label: 'Schedule', service: 'EventBridge Scheduler' },
        { id: 'job', label: 'Batch job', service: 'EMR Serverless, Spark' },
        { id: 's3', label: 'Archive and counts', service: 'Amazon S3' },
        { id: 'table', label: 'Snapshot table', service: 'DynamoDB' },
        { id: 'cw', label: 'Metrics', service: 'CloudWatch' },
      ],
      steps: [
        {
          from: 'sched',
          to: 'job',
          label: 'StartJobRun at 00:30 and every hour to 05:30 UTC',
          note: 'Six starts a day, with no retries of their own: the next hour is the retry. The job takes its day from its own start time: the UTC day that closed before it, here 2026-11-23. An optional date argument overrides it, which is how a person runs it for another day. A run is stopped after 50 minutes, which the service records as cancelled and not as failed, so two never overlap.',
        },
        {
          from: 'job',
          to: 'table',
          label: 'GetItem day#2026-11-23 / all, consistent',
          note: 'If the row is already exact and the global 7-day row exists, the run ends here: each of the two write steps below writes the global scope last, so those two rows mean all 202 are in. Otherwise, if the row it fetched has exact = false, it keeps that provisional row to compare with later.',
        },
        {
          from: 'job',
          to: 's3',
          label: 'list raw/dt=2026-11-23, the last hour of the 22nd and the first hour of the 24th',
          note: 'The check: for each of the 64 partitions the offset ranges in the file names chain without a gap, from a file that holds a record appended before 00:00 on the 23rd up to a file that holds a record appended at 00:10 or later on the 24th. A file is filed under the hour of its first record, so the first minutes of the 23rd are in the tail of a file under the 22nd. A listing shows every file already stored. If the check fails, the run ends without publishing. An archiver catching up through quiet hours can put more than an hour of records into one 128 MB file, which is then filed before the hours listed; the check fails then too, and a person starts the job with a wider listing.',
        },
        {
          from: 'job',
          to: 's3',
          label: 'read the day, and the event id column of the day before',
          note: 'It drops repeated rows by partition and offset, keeps records appended on the 23rd, keeps the earliest record per event id, and leaves out ids that also appear on the 22nd. The ids of the 22nd come from the files under the 22nd and, for its first minutes, from the last file of each partition under the 21st. Then it counts per scope and item.',
        },
        {
          from: 'job',
          to: 's3',
          label: 'write counts/dt=2026-11-23/run=<runAt>/',
          note: 'Under a prefix no other run uses. A run that dies here leaves files that nothing points to.',
        },
        {
          from: 'job',
          to: 'cw',
          label: 'ProvisionalCountDifferencePercent = 0.1, ProvisionalOverlap = 100',
          note: 'For the items in both the provisional and the exact global top 100: the absolute difference between the provisional and the exact counts, in percent of the exact ones, and how many of the 100 items are the same. The job publishes the two metrics only when the global row it fetched has exact = false, so a rerun on a day that is already exact but has no 7-day row publishes nothing instead of comparing exact with exact.',
          style: 'async',
        },
        {
          from: 'job',
          to: 'table',
          label:
            'PutItem day#2026-11-23 × 101 scopes, exact=true IF not exists OR exact=false OR runAt < :runAt',
          note: 'The row is the commit: it names the counts prefix of this run. The stream job’s condition refuses to overwrite an exact row, so a replay cannot undo it. A second run that got here would write the same numbers. The global scope is written last of the 101.',
        },
        {
          from: 'job',
          to: 'table',
          label: 'PutItem 7d#2026-11-23 × 101 scopes',
          note: 'The sum of the seven days of counts that the last seven exact day rows point to. If one of them is missing, the 7-day rows are not written and the previous ones stay. One day left provisional therefore holds back the 7-day rows of that day and of the six after it, as does the first week after launch, and with no global 7-day row to find, every scheduled start on those days counts the day again and writes the same numbers. The global scope is written last here too.',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'Where is a view counted?',
      options: [
        {
          name: 'A counter row per item in a database, incremented in the request',
          pros: 'One system, and the ranking is a sorted query. Fine for a few hundred events a second.',
          cons: 'Every view of a viral item updates the same row, so writes queue behind each other and the requests time out. A bigger database does not help, because the contention is on one row.',
        },
        {
          name: 'Counters in the memory of the ingest tasks, flushed every few seconds',
          pros: 'No contention and almost no cost per event.',
          cons: 'A task that dies takes its unflushed counts with it, after the client was told the view was accepted, and no raw events are left to recount from.',
        },
        {
          name: 'Append to a log in the request, count in a stream job',
          pros: 'The request does one sequential write. The log absorbs spikes, can be read again after a crash or a bug, and feeds the live counters and the archive from the same records.',
          cons: 'Two more systems to run, and the count trails the view by seconds.',
        },
      ],
      choice:
        'The log. An accepted event is durable before anything counts it, intake and counting scale and fail apart, and the exact ranking is possible at all only because the raw events exist. The seconds of delay are inside the minute the requirements allow.',
    },
    {
      question: 'How do we count when there are many distinct items, and what error do we promise?',
      options: [
        {
          name: 'Exact counts per key in the state of each counter task',
          pros: 'The count is the number of records, with no error of its own, and it is easy to explain and to test against the batch result.',
          cons: 'State grows with the number of distinct keys, most of which are seen a handful of times: about 50 million keys and 10 GB here, scanned every 10 seconds.',
        },
        {
          name: 'A count-min sketch per window plus a heap of candidates',
          pros: 'Fixed memory whatever the number of items. With a width of w counters per row and d rows, a count is too high by at most e/w of all increments in the window, with probability at least 1 − e^−d.',
          cons: 'It only ever overestimates, and the error is an absolute number: small next to a heavy hitter and larger than the true count of a rare item. Sketches subtract poorly, so every bucket needs its own.',
        },
        {
          name: 'Space-saving counters that keep only the heaviest candidates',
          pros: 'Keeps just the top candidates, each with an error bound.',
          cons: 'An item that enters late inherits the count of the one it evicted, and merging across buckets and tasks loosens the bound each time.',
        },
      ],
      choice:
        'Exact counts, because they fit: 10 GB over 32 tasks is about 310 MB each. The promise is then simple to state. A live count is the number of log records for that key in the window, as of the task’s watermark, each counted one time. It differs from the exact count only by repeated event ids, about 0.1% of records by assumption, and that difference is measured every night and not bounded. A sketch becomes the right tool at 100 times the keys; with w = 2^20 and d = 5 its error would be under 0.0003% of a window’s increments 99.3% of the time, a stated bound we do not need yet.',
    },
    {
      question: 'How do we handle one item that goes viral?',
      options: [
        {
          name: 'Partition the log by item and accept the hot partition',
          pros: 'Events of an item arrive together and in order, with no shuffle.',
          cons: 'A viral item floods one partition and one broker. The consumer of that partition falls behind, and so does the ranking of every item that shares it.',
        },
        {
          name: 'Split the hot key into sub-keys on several counter tasks',
          pros: 'Spreads one item over many tasks.',
          cons: 'No task knows the item’s whole count, so a local top list is no longer enough and a second stage has to sum the parts before anything can be ranked.',
        },
        {
          name: 'Group events per key for a second in each reading task, before the shuffle',
          pros: 'A hot key becomes one record per reading task per second, whatever its rate, and the key still lives on one counter task.',
          cons: 'Up to a second of extra delay, and no saving for the long tail.',
        },
      ],
      choice:
        'The log is partitioned by event id, so no partition is ever hot, and the grouping happens inside the stream job before the shuffle. A viral item at 45,000 views a second becomes 96 records a second. Nothing is lost by it: the raw events are already in the log, the table is emptied before every checkpoint, and a restart reads the rest again.',
    },
    {
      question: 'Is a local top list per task enough to build the correct global top K?',
      options: [
        {
          name: 'Send every count to the merger',
          pros: 'Trivially correct.',
          cons: 'Tens of millions of counts every round through one operator, to find 100 of them.',
        },
        {
          name: 'Local top 100 per log partition, without routing by key',
          pros: 'No shuffle: each reader ranks what it read.',
          cons: 'Wrong. An item spread over all partitions can be just below the cut in each of them and still be first overall, and the merger cannot know, because it never sees the counts that were cut.',
        },
        {
          name: 'Route each key to one task, then local top 100 per task',
          pros: 'Exact: the whole count of an item is on one task, so an item in the global top 100 is in the top 100 of its task.',
          cons: 'Needs the shuffle, and each task must find its top 100 again as counts fall, here with a scan.',
        },
      ],
      choice:
        'Route by key, then merge local lists. The argument is short: if an item is in the global top 100, fewer than 100 items anywhere have a higher count, so fewer than 100 on its own task do. The merger publishes only when it holds a list from every task, and it stamps the row with the lowest of their watermarks. The lists of one round were computed up to 10 seconds apart, so the ranking is exact for counts taken within 10 seconds of each other, not at one instant.',
    },
    {
      question: 'How are the windows built, and how much state does each one need?',
      options: [
        {
          name: 'Tumbling windows: count per hour and per day, reset at the boundary',
          pros: 'One number per key and window.',
          cons: 'The ranking empties on the hour: at 13:01 the last hour holds one minute of views.',
        },
        {
          name: 'Minute buckets for every window',
          pros: 'Every window slides smoothly by the minute.',
          cons: 'Up to 1,440 buckets per key for 24 hours: tens of times the state, most of it for items nobody will rank.',
        },
        {
          name: 'A bucket size per window: minutes for the hour, hours for 24 hours, one for the day',
          pros: 'At most 60 + 24 + 2 buckets per key, and usually a handful, since most keys are seen in few minutes.',
          cons: 'The 24-hour window covers 23 to 24 hours and drops a whole hour at once.',
        },
      ],
      choice:
        'A bucket size per window. The last hour needs minute buckets for the 10 million keys seen in an hour; the 24-hour window and the day need hour and day buckets for the 50 million keys seen in a day. At about 200 bytes a key on average that is 10 GB. A week is not a live window at all: the 7-day ranking comes from the batch job once a day, because nobody needs a weekly list that is fresh to the minute and seven days of live state would cost several times more.',
    },
    {
      question: 'Which clock places an event in a window, and what happens to late events?',
      options: [
        {
          name: 'The time on the phone, with an allowed lateness',
          pros: 'A view counts in the minute it happened.',
          cons: 'Phones are offline for hours and their clocks are wrong or forged. Windows have to stay open for the lateness, events after it are dropped, and the live and exact rankings disagree about which day a view belongs to.',
        },
        {
          name: 'The time the ingest task received it',
          pros: 'A clock we control.',
          cons: 'Stamped before the append, so records in a partition can be seconds out of order, and a stalled task can stamp a time long before its record lands.',
        },
        {
          name: 'The time the log appended it',
          pros: 'Set by the broker at the append, in the order of the partition. The stream job, the archive and the batch job all see the same value.',
          cons: 'A view made offline counts when it arrives. A change of partition leader can step the time back by the difference between two broker clocks.',
        },
      ],
      choice:
        'The log’s append time. There is no late event in the usual sense: the watermark trails the slowest partition by 5 seconds, more than the difference between broker clocks, and a record older than the watermark is still added to its own bucket while that bucket is inside a window. The one case that is dropped from the live count is a record for a day whose bucket was already let go, 10 minutes after midnight; the job counts those, and the batch job includes them.',
    },
    {
      question: 'How is each record counted one time when the job crashes and replays?',
      options: [
        {
          name: 'Commit the offset to the log, keep counts in memory',
          pros: 'Simple.',
          cons: 'A crash loses the counts made since they were last saved while the offset has moved on, or counts records again if the offset is committed later. Either way the count is off by an unknown amount.',
        },
        {
          name: 'Remove repeats by event id in the stream',
          pros: 'Would also remove client retries, so live and exact counts would agree.',
          cons: 'Needs every id of the window in state: 4.32 billion a day. The exact path already does this once, offline, for far less.',
        },
        {
          name: 'Checkpoint offsets and counts together, replay from the checkpoint',
          pros: 'After a restart the state and the read positions describe the same records, so nothing is counted twice or skipped inside the job.',
          cons: 'Every task goes back to the checkpoint, up to 60 seconds plus the few seconds the checkpoint itself took, and the ranking is stale while the job catches up. What the job wrote outside itself is written again.',
        },
      ],
      choice:
        'Checkpoints every 60 seconds. Inside the job a record changes the counts one time, whatever crashes. Outside it, the only effect is the snapshot row, which is a complete overwrite guarded by asOf, so writing it again is harmless and a replay cannot put an older ranking over a newer one. Records that are in the log twice are still counted twice here: that is at-least-once from the client to the log, made harmless for the exact ranking by the event id.',
    },
    {
      question: 'How is the ranking published and served, and how stale can it be?',
      options: [
        {
          name: 'Compute on read: query the counters for the top K',
          pros: 'Always current, and any filter is possible.',
          cons: '20,000 reads a second would each scan millions of counts on the tasks that are busy counting.',
        },
        {
          name: 'A sorted set per window in an in-memory cache, updated on every increment',
          pros: 'Fresh to the second, and the top K is one command.',
          cons: 'Every increment becomes a cache write, 450,000 a second, the set holds every item and not just the top, expiring buckets means subtracting from it, and a failover of the cache can drop its last writes.',
        },
        {
          name: 'A complete row per ranking in a table, copied into the memory of the API tasks',
          pros: 'A read is a lookup in memory. The publish is 303 small writes a round, and a row replaced as a whole cannot be half updated.',
          cons: 'Staleness adds up along the way, and only rankings computed in advance exist.',
        },
      ],
      choice:
        'Rows in a table, copied into memory. The staleness is a sum that can be written down: 5 seconds of watermark, 1 of grouping, up to 10 until the next scan, up to 10 until the merger publishes, up to 5 until the API copies the row. That is 31 seconds at worst and 10 to 30 in practice, against a target of 60. Every answer carries asOf, and each API task publishes the age of its oldest live row, so staleness is measured where it is felt.',
    },
    {
      question: 'How do we serve rankings for categories and regions?',
      options: [
        {
          name: 'Precompute every combination of category, region and window',
          pros: 'Every read is a lookup.',
          cons: '30 × 70 = 2,100 combined scopes, twenty times the lists and the keys, for pages few people open.',
        },
        {
          name: 'Precompute global, per category and per region; no combinations',
          pros: '101 scopes cover the pages people use, and a scope is just one more counter key per event.',
          cons: 'Three increments per event and no answer for "music in Brazil".',
        },
        {
          name: 'Filter the global list on read',
          pros: 'No extra state.',
          cons: 'Wrong for anything but the largest scopes: the top 100 of a small region are nowhere near the global top 100.',
        },
      ],
      choice:
        'One counter key per scope: all, the category and the region. A scope is counted like any other key, so nothing in the pipeline knows what a category is, and adding one is configuration. Combinations are out of scope; they would be the first reason to add an analytics store next to this design.',
    },
    {
      question: 'What makes the daily ranking exact, and how does it replace the live one?',
      options: [
        {
          name: 'Trust the stream: the provisional ranking at midnight is the result',
          pros: 'No second path.',
          cons: 'It counts repeated events, a counting bug is baked in for good, and nothing can be recomputed once the log has expired.',
        },
        {
          name: 'Replay the log through the stream job to correct it',
          pros: 'One piece of counting logic.',
          cons: 'The log keeps 72 hours, repeats are still counted, and a replay competes with the live job for the same capacity.',
        },
        {
          name: 'A batch job over an archive of the raw events',
          pros: 'Counts each event id one time, reads files that are kept 90 days, and can be run again for any of them with fixed code.',
          cons: 'A second implementation of the count, and an answer about an hour after the day ends.',
        },
      ],
      choice:
        'The batch job is the source of truth and the stream is a preview of it. Three things make its answer exact and repeatable: the archiver stores a file before it moves its position, so the archive has no gaps unless it falls 72 hours behind; the job refuses to publish until the offset ranges of every partition chain from before the start of the day past 00:10 of the next day; and it counts by the log’s append time and the event id, which are in the archive and never change. The replacement is one conditional write per row: provisional to exact, and exact only to a newer run.',
    },
    {
      question: 'How much abuse does this design handle?',
      options: [
        {
          name: 'Nothing: count whatever arrives',
          pros: 'Nothing to build.',
          cons: 'One script in a loop can put an item on the home page.',
        },
        {
          name: 'A token, a rate rule per address and one count per event id',
          pros: 'Stops the cheap attacks: anonymous posts, one address flooding, and the same event sent a million times.',
          cons: 'A rate rule acts after a delay and only near its limit, and a bot that makes new ids from many addresses is counted.',
        },
        {
          name: 'Score every event for fraud before counting it',
          pros: 'The ranking would mean real people.',
          cons: 'A product of its own, with models, labels and appeals, in the hot path of 150,000 events a second.',
        },
      ],
      choice:
        'The middle option, and no more. Events need a valid session token, the load balancer’s firewall limits each source address, and the exact ranking counts an event id one time. Deciding whether a view is real is out of scope: a filter would sit between the archive and the batch count, where it can be changed and rerun without touching intake.',
    },
  ],
  wrapUp:
    'Events are appended to a log partitioned by event id and acknowledged by two brokers before the 202. A stream job groups a second of events before the shuffle, keeps exact minute, hour and day buckets per key on one task each, and merges local top lists into snapshot rows that only move forward. Readers get those rows from memory with the time they are as of. Checkpoints of offsets and counts together make a replay count each record one time, and a batch job over an archive without gaps publishes the exact daily ranking over the provisional one.',
  guarantees: {
    provides: [
      {
        property: 'Acceptance',
        promise:
          'A 202 is answered only after the log has acknowledged the record with all in-sync replicas, at least two of three, on brokers in different Availability Zones. An acknowledged record is gone only if every in-sync replica fails before any of them has written it to disk. A request with no 202 promises nothing, and the client repeats it.',
      },
      {
        property: 'Idempotent event',
        promise:
          'An event id counts one time in the exact rankings, however many times it was sent, as long as its copies are less than 24 hours apart. Requests arrive at least once, made harmless by the event id in the batch job. The live rankings count every copy.',
      },
      {
        property: 'Live count',
        promise:
          'A live count is the number of records in the log for that scope and item whose append time is inside the window, as of the counter task’s watermark. Each record changes the counts one time, also across a crash and a replay, because offsets and counts are stored in the same checkpoint.',
      },
      {
        property: 'Top K of the live counts',
        promise:
          'A published ranking holds the 100 largest live counts of its scope and window, in order, with ties broken by item id. It is built from one list per counter task, taken within 10 seconds of each other, and is published only when all 32 are present.',
      },
      {
        property: 'Rankings do not go back',
        promise:
          'A live row is replaced only by one whose asOf is the same or newer, and an exact row only by a newer batch run. Both are conditions checked by the table on the write, so a replay, a second copy of the job or a late run cannot undo a newer row.',
      },
      {
        property: 'Freshness',
        promise:
          'Every answer says the time it is as of. In steady state that is at most 31 seconds ago. Over 28 days, in 99.5% of minutes no live row is more than 60 seconds old, and when rows stay older than 45 seconds for 5 minutes, or 7 minutes within 24 hours are missed, someone is paged.',
      },
      {
        property: 'Exact daily ranking',
        promise:
          'For a closed UTC day: one count per event id whose earliest record was appended that day, over an archive verified to have no gap in any partition. The same input files give the same result on every run. A row is marked exact only by the batch job.',
      },
      {
        property: 'Reads during an outage',
        promise:
          'A ranking read needs only its API task. If the stream job or the table stops, tasks that are running keep answering from the rows they hold, with an asOf that shows their age.',
      },
    ],
    assumes: [
      'The log keeps an acknowledged record while at least one in-sync replica survives, does not elect a replica that was out of sync, and sets the append time from clocks that agree within a second.',
      'The stream service restores every task from the same completed checkpoint and reads on from the offsets stored in it.',
      'The snapshot table applies a conditional write to one item atomically and keeps an acknowledged write.',
      'Object storage keeps a stored file, and a listing shows every file whose write was acknowledged.',
      'A client repeats an event with the same id, and stops repeating it 24 hours after its first attempt.',
      'Clocks of the API tasks and the brokers agree within a second. They decide which bucket a record goes to and how old a row looks; they do not decide which write wins.',
      'The archiver is never more than 72 hours behind, the time the log keeps its records.',
    ],
    doesNotGuarantee: [
      'A bound on the error of a live count. It is too high by the repeated records in its window, about 0.1% in normal operation and more after a period in which many answers were lost and clients sent again. The difference is measured every night, not limited.',
      'That a view is real. A client with a valid token can send new event ids for the same item, and each one counts in both rankings.',
      'A ranking at one instant. The 32 lists behind a row were taken up to 10 seconds apart.',
      'A full 24 hours in the 24-hour window. It covers the current hour and the 23 before it, so between 23 and 24 hours, and it drops an hour at once. The last-hour window is the same at a smaller scale: the current minute and the 59 before it, so between 59 and 60 minutes.',
      'Counting by the time of the view. An event sent three hours late counts in the minute and on the day it arrived, in both rankings.',
      'Acceptance while a partition has fewer than two in-sync replicas. Events whose id hashes to it, 1 in 64, are answered 503 until the partition is back, and their clients keep trying.',
      'Fresh rankings during a restart or a deploy of the stream job. A restart at peak leaves them up to about 2 minutes old, and a replay after a counting bug leaves them wrong for hours.',
      'That the provisional ranking of a day is complete. If the last writes before 00:10 fail, its asOf is earlier than midnight and it lacks the last seconds of the day until the batch job replaces it.',
      'An exact ranking by a fixed time. It is normally published about an hour after midnight UTC; if the archive is behind, it waits, and a page goes out at 02:00.',
      'Exactness when a client repeats an event more than 24 hours later, or when the archive has a gap. The first is counted twice. The second leaves the day provisional until a person decides, and a day left provisional holds back the 7-day ranking of that day and of the six after it, which stays at its last version.',
      'Rankings for a combined filter, for another K than 1 to 100, or for a day more than 7 days back.',
      'Read-your-own-view. A view shows in a ranking 10 to 30 seconds later, and only if it changes the top 100.',
      'That a new API task can start while the table is unreadable. It has no rows to serve, so it stays out of the load balancer until it has loaded them.',
    ],
  },
  failures: [
    {
      scenario: 'An ingest task dies after the log stored the event and before it answered 202.',
      impact:
        'The client sees a timeout and sends the event again. The log holds two records with one event id, and the live count of that item is one too high for as long as their buckets are inside a window.',
      detection:
        'Not visible per event. The batch job publishes how many repeated ids it removed and how far the provisional counts were from the exact ones, above or below; Live count drift fires when that passes 0.5%.',
      recovery:
        'None needed in the live path. The batch job keeps the earliest record per event id, so the exact ranking counts it one time.',
    },
    {
      scenario: 'A broker fails, or a whole Availability Zone with two of the six brokers.',
      impact:
        'Partitions led by those brokers elect a new leader in seconds. Producers retry inside their 2 seconds; some requests get a 503 and are sent again. Every partition still has two in-sync replicas, so intake continues. The stream job waits for the partitions that are electing, and rankings age by those seconds.',
      detection:
        'UnderReplicatedPartitions rises on the surviving brokers, and the events load balancer shows a short rise in 5xx. Log unhealthy stays quiet because no partition is under its minimum.',
      recovery:
        'The service replaces the broker and it catches up from the leaders. No acknowledged record is affected, since each was on at least two brokers.',
    },
    {
      scenario:
        'A second broker fails while the first is still out, and some partitions have one in-sync replica.',
      impact:
        'Appends to those partitions are refused, so the events whose id hashes to them get a 503 for as long as it lasts: 1 in 64 per partition. Everything else is accepted. After 30 seconds of silence those partitions stop holding the watermark back, so rankings keep moving on the rest of the data.',
      detection:
        'Log unhealthy: UnderMinIsrPartitionCount above 0. Intake errors fires as well when the refused share passes its threshold.',
      recovery:
        'When a second replica is back in sync the partitions accept again and clients deliver what they held, with the same ids. Those events are counted when they arrive.',
    },
    {
      scenario: 'A counter task, or the machine under it, dies.',
      impact:
        'The whole job restarts from the newest checkpoint, about 90 seconds later, up to 150 seconds behind. Counts are not doubled and not short. Rankings are up to about 2 minutes old, and writes with an older asOf are refused until the job has caught up, about 75 seconds after it is back at peak.',
      detection:
        'OldestLiveRowAge from the API tasks rises past 45 seconds; the Flink downtime metric is above 0. Ranking stale pages if it lasts 5 minutes, or if 7 minutes within 24 hours pass 60 seconds, so one clean restart does not and a third within 24 hours does.',
      recovery:
        'Automatic. The job reads from the offsets in the checkpoint at up to three times the peak rate. Each restart at peak uses about 3 of the 201 minutes in 28 days the freshness objective allows, as long as checkpoints have been completing; Checkpoints failing is the alarm for when they have not.',
    },
    {
      scenario: 'One item takes 30% of all traffic.',
      impact:
        'With the grouping in place, none: 96 records a second for the item. If the grouping were removed or its flush set far too short, one counter task would get three times its plan, push back on all readers, and every ranking would age.',
      detection:
        'records_lag_max on the stream job and OldestLiveRowAge rise together while intake stays healthy. Per-task input rates show one task far above the others.',
      recovery:
        'Nothing to do in the normal case. The log holds the backlog, and the job catches up when the cause is fixed.',
    },
    {
      scenario: 'The snapshot table throttles or is unavailable.',
      impact:
        'The merger’s writes fail and are dropped. They go out concurrently under one 2-second limit for the whole round, so a round is never held up for longer than that; the job itself keeps counting and checkpointing. API tasks cannot refresh and keep serving the rows they have, which grow older. Reads still succeed. A new API task cannot load and stays out of service.',
      detection:
        'Ranking stale, from the API tasks’ own measure, a few minutes in. ThrottledRequests and SystemErrors on the table say why.',
      recovery:
        'The next round after the table is back writes all 303 rows, and the next refresh picks them up: fresh within about 15 seconds. Nothing was queued, so there is nothing to drain.',
    },
    {
      scenario: 'An archiver task crashes between storing a file and moving its position.',
      impact:
        'The next task writes the same records again in a second file. The archive holds about five minutes of one partition twice.',
      detection:
        'Nothing to detect; it is the expected cost of storing the file first. The batch job reports how many rows it dropped by partition and offset.',
      recovery:
        'None. Readers of the archive keep one row per partition and offset, and the ranges still chain.',
    },
    {
      scenario: 'The archiver is down or far behind when the batch job starts.',
      impact:
        'The check fails for the partitions that have not reached 00:10, the run publishes nothing, and the day stays provisional. Live rankings are not affected.',
      detection:
        'Archive behind, from the log’s own lag metric for the archiver’s group, usually long before midnight. Exact ranking late at 02:00 if the day is still not exact.',
      recovery:
        'The archiver catches up from its committed position; the log keeps 72 hours. The schedule starts the job every hour until 05:30, and the first run after the archive is complete publishes. After 05:30 a person starts it.',
    },
    {
      scenario: 'A batch run fails halfway, or runs twice.',
      impact:
        'A failed run leaves count files under its own prefix that no row points to, and the day stays provisional for another hour. Two runs that both finish write the same numbers; the row keeps the newer run.',
      detection:
        'FailedJobs on the batch application, or CancelledJobs for a run cut at the 50-minute limit, which is cancelled and not failed, and Exact ranking late if no run succeeds by 02:00.',
      recovery:
        'The next hourly start runs the whole job again. The rows are the commit, so there is nothing to clean up before it. Prefixes that no row points to cost little and are left alone.',
    },
    {
      scenario: 'A deploy puts a counting bug into the stream job.',
      impact:
        'Live rankings are wrong from the deploy on, and the bad counts are in the checkpoints. The archive and the exact rankings are not touched, because they do not pass through the job.',
      detection:
        'Live count drift the next night, or sooner by eye. Nothing automatic catches a plausible wrong ranking within minutes.',
      recovery:
        'Deploy the fix and start the job with empty state from 24 hours back in the log. It reads 450,000 events a second while 50,000 arrive on average, so a day of 4.32 billion events takes about 3 hours: 4.32 billion ÷ 400,000. Until its watermark passes the asOf in the table the bad rows stay, because older rows are refused; the page shows their asOf. If yesterday’s row is still provisional when the replay passes midnight, the replay overwrites it with the count of only the part of that day it read, because an equal asOf is accepted; the batch job replaces it with the exact row, and Live count drift shows the difference.',
    },
    {
      scenario: 'An Availability Zone is lost.',
      impact:
        'A third of the ingest tasks and of the API tasks go with it: 50 of 75 and 8 of 12 remain, which is what the peak needs with nothing to spare. Two brokers are out, as above. The stream job restarts if any of its tasks ran there.',
      detection:
        'HealthyHostCount on both load balancers, UnderReplicatedPartitions, and the job’s downtime.',
      recovery:
        'The services start replacement tasks in the other zones. Until they are up, the ingest tasks run at their planned 3,000 requests a second and a further loss would shed load as 503s that clients retry.',
    },
  ],
  capacity: {
    assumptions: [
      '50 million daily users with about 86 views each. The peak is 3 times the average.',
      'An event is about 200 bytes in the log and about 50 bytes in a compressed columnar file. An event id is 16 bytes.',
      'Every event adds to 3 counter keys. About 2 million distinct items are viewed in an hour and 10 million in a day, and an item has about 5 keys: all, one category and 3 regions on average.',
      'A key takes about 200 bytes of state on average: most keys hold a few buckets, a popular one up to 86.',
      'About 0.1% of records repeat an event id already in the log.',
      'Planning figures, to confirm with a load test: an ingest task takes 3,000 requests a second, an API task 2,500 reads a second, a counter task 50,000 records a second, and the stream job restarts in about 90 seconds.',
      'A snapshot row is about 5 KB: 100 items of about 40 bytes plus the fields around them.',
      '30 categories and 70 regions, so 101 scopes with the global one. Three live windows: 1h, 24h and the day.',
      'Ranking reads peak at 20,000 a second.',
    ],
    estimates: [
      {
        label: 'Events',
        value: '4.32 billion a day, 50,000 a second on average, 150,000 at peak',
        math: '50M users × 86 ≈ 4.3 billion. 50,000/s × 86,400 s = 4.32 billion. Peak 3 × 50,000 = 150,000/s.',
      },
      {
        label: 'Log volume',
        value: '30 MB/s at peak, 864 GB a day, 7.8 TB on the brokers',
        math: '150,000 × 200 B = 30 MB/s. 4.32 billion × 200 B = 864 GB a day. 72 hours = 2,592 GB; × 3 replicas ≈ 7.8 TB; ÷ 6 brokers = 1.3 TB each, half of the 2,600 GiB each one has.',
      },
      {
        label: 'Per partition',
        value: '2,344 records and 0.47 MB a second at peak',
        math: '150,000 ÷ 64 = 2,344/s; × 200 B = 0.47 MB/s. 64 partitions × 3 replicas = 192 replicas, 32 per broker.',
      },
      {
        label: 'Ingest tasks',
        value: '75, of which the peak needs 50',
        math: '150,000 ÷ 3,000 = 50. 75 tasks over three zones run at 2,000/s each, 67% of plan, and a lost zone leaves 50.',
      },
      {
        label: 'Increments',
        value: '450,000 a second at peak, about 14,000 per counter task',
        math: '150,000 × 3 keys = 450,000/s; ÷ 32 = 14,063/s, 28% of the 50,000 planned. Catching up at 3 times the peak rate is 42,000/s per task, 84%.',
      },
      {
        label: 'A viral item',
        value: '135,000 increments a second without grouping, 96 records with it',
        math: '30% × 150,000 = 45,000 views/s × 3 keys = 135,000/s; plus at most the usual 14,000 on one task, an average that already contains the item, so at most about 149,000/s. Grouped: 32 reading tasks × 3 keys × 1 per second = 96/s.',
      },
      {
        label: 'Live state',
        value: 'about 50 million keys and 10 GB, 310 MB per task',
        math: '10M items a day × 5 keys = 50M keys; × 200 B = 10 GB; ÷ 32 ≈ 310 MB of the 50 GB of disk a task has. Keys with minute buckets: 2M × 5 = 10M.',
      },
      {
        label: 'Scan',
        value: '1.56 million keys per task every 10 seconds',
        math: '50M ÷ 32 = 1.56M keys; ÷ 10 s = 156,000 keys/s per task.',
      },
      {
        label: 'Local lists',
        value: '9,696 per round, about 970 a second',
        math: '101 scopes × 3 windows = 303 lists per task; × 32 tasks = 9,696 every 10 s ≈ 970/s; × 4 KB ≈ 3.9 MB/s into the merger.',
      },
      {
        label: 'Snapshot writes',
        value: '303 rows per round, about 152 write units a second',
        math: '303 ÷ 10 s = 30.3 writes/s; × 5 units for a 5 KB row ≈ 152/s. One window key takes 101 × 5 ÷ 10 ≈ 51/s, against 1,000 per partition.',
      },
      {
        label: 'Rows in an API task',
        value: '1,111 rows, about 5.6 MB',
        math: '303 live + 7 closed days × 101 = 707 + 101 for 7 days = 1,111; × 5 KB ≈ 5.6 MB.',
      },
      {
        label: 'Table reads',
        value: 'about 460 read units a second',
        math: 'A query returns 101 × 5 KB = 505 KB: 127 units, halved for an eventually consistent read ≈ 64. 3 queries × 12 tasks ÷ 5 s × 64 ≈ 460/s. The slow rows add about 20.',
      },
      {
        label: 'Ranking API tasks',
        value: '12, of which the peak needs 8',
        math: '20,000 ÷ 2,500 = 8. 12 tasks run at 1,667/s each, 67% of plan, and a lost zone leaves 8.',
      },
      {
        label: 'Staleness in steady state',
        value: 'at most 31 seconds, usually 10 to 30',
        math: '5 s watermark + 1 s grouping + up to 10 s to the next scan + up to 10 s to the next merge + up to 5 s to the next API refresh = 31 s.',
      },
      {
        label: 'A restart at peak',
        value: 'up to 150 s behind, level again 75 s after the job is back',
        math: '60 s plus the checkpoint’s own few seconds back to the checkpoint + 90 s down = about 150 s of input as the planning case. Reading 450,000/s against 150,000/s arriving gains 2 s per second: 150 ÷ 2 = 75 s. Rows are older than 60 s for about 2 minutes, counted as 3 missed minutes. At the 30 s of checkpoint duration that the alarm tolerates it is about 180 s and 90 s, with rows older than 60 s for about 15 seconds longer, still planned as 3 missed minutes.',
      },
      {
        label: 'Freshness budget',
        value: '201 minutes in 28 days, about 67 restarts',
        math: '28 × 1,440 = 40,320 minutes; × 0.5% ≈ 201. 201 ÷ 3 = 67.',
      },
      {
        label: 'Archive',
        value: '216 GB a day, 19.4 TB for 90 days, 18,432 files a day',
        math: '4.32 billion × 50 B = 216 GB; × 90 = 19.4 TB. 64 partitions × 288 five-minute files = 18,432, about 11.7 MB each.',
      },
      {
        label: 'Batch input and output',
        value: '216 GB of events plus 69 GB of ids in; 1.5 GB of counts out',
        math: 'The day’s files, and the id column of the day before: 4.32 billion × 16 B = 69 GB. 50M keys × 30 B = 1.5 GB a day, about 1.1 TB for 2 years.',
      },
      {
        label: 'Repeated events',
        value: 'about 4.3 million a day',
        math: '4.32 billion × 0.1% = 4.32 million records that the batch job drops and the live counts include.',
      },
      {
        label: 'Stream job size',
        value: '33 KPUs',
        math: 'Parallelism 32 at 1 per KPU = 32, plus 1 the service adds for orchestration. The default quota is 64.',
      },
    ],
    implications: [
      'Intake is 150,000 small writes a second and reads are 20,000 lookups of 303 rows. They share nothing: separate load balancers, separate services, and a log between the write and everything that counts.',
      'All rankings fit in 5.6 MB, so the serving layer is the memory of the API tasks and the table is only how the rows get there. A cache cluster would add a hop and a failure mode for data that fits in a process.',
      'State grows with distinct keys, not with traffic. 50 million keys are 10 GB and exact counting is cheap; the scan of 1.56 million keys per task every 10 seconds is the cost that grows first.',
      'A counter task runs at 28% at peak so that the job can read at 3 times the peak rate after a restart. That headroom is what turns 150 seconds of delay into 75 seconds of catch-up, and it is why a restart costs 3 minutes of the budget and not 10.',
      'The grouping before the shuffle is sized for the viral case, not the average: it changes up to 149,000 records a second on one task into 14,000.',
      'Both services lose a third of their tasks with a zone and are sized to carry the peak on what is left: 50 of 75 and 8 of 12. Ingest deploys with a minimum of 100% healthy and a maximum of 120%, the API with 100% and 150%, so a deploy never drops below the full count.',
      'The stream job is one unit: a restart or a deploy stops all of it for about 90 seconds. That is acceptable only because readers are served from rows that outlive it, and it is counted against the freshness budget.',
      'Keeping 72 hours of log costs 7.8 TB and buys three days in which the archiver or the stream job can be repaired without losing an event.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one Region across three Availability Zones. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Ingest service',
        service:
          'An Application Load Balancer that serves only POST /events, with AWS WAF, in front of Amazon ECS on AWS Fargate: 75 tasks, minimum healthy 100%, maximum 120%',
        why: 'Stateless tasks that check an event and produce it to the log with acks=all and a 2-second limit. They read no store, so the log is their only dependency. The firewall carries a rate-based rule per source address.',
        watch:
          'ALB RequestCount, TargetResponseTime, HTTPCode_Target_5XX_Count, HTTPCode_ELB_5XX_Count and HealthyHostCount; ECS CPUUtilization. WAF BlockedRequests for the rate rule. Custom: produce failures and timeouts.',
      },
      {
        part: 'Event log',
        service:
          'Amazon MSK Provisioned, 6 Standard brokers in three Availability Zones with 2,600 GiB each; one topic with 64 partitions, replication factor 3, min.insync.replicas 2, append-time timestamps, 72 hours of retention and unclean leader election turned off',
        why: 'The first durable write and the only input of both the live and the exact path. Three replicas in three zones with a minimum of two in sync let it take a broker or a zone failure without refusing or losing an acknowledged record. The broker’s append time is the clock of the whole design.',
        watch:
          'BytesInPerSec, MessagesInPerSec, CpuUser plus CpuSystem, KafkaDataLogsDiskUsed, UnderReplicatedPartitions, UnderMinIsrPartitionCount, OfflinePartitionsCount and ActiveControllerCount. MaxOffsetLag for the archiver’s consumer group and for the stream job’s.',
      },
      {
        part: 'Stream counters and merger',
        service:
          'Amazon Managed Service for Apache Flink: one application, parallelism 32 at 1 per KPU, 33 KPUs, checkpoints every 60 seconds',
        why: 'Reading tasks, the grouping, the counter tasks and the merger are one job. The service keeps state in RocksDB on each task’s disk, stores checkpoints in Amazon S3 that it owns, and restarts the job from the newest checkpoint after a failure. The source keeps its offsets in the checkpoint, and reports them to the log only so that lag can be seen.',
        watch:
          'downtime, numberOfFailedCheckpoints, lastCheckpointDuration, lastCheckpointSize, commitsSucceeded, cpuUtilization, heapMemoryUtilization, records_lag_max and currentOutputWatermark. Custom: records per counter task, scan duration, publish failures, and records dropped for a closed day.',
      },
      {
        part: 'Snapshot table',
        service:
          'Amazon DynamoDB, on-demand: partition key window (1h, 24h, day#date, 7d#date), sort key scope',
        why: 'Holds one item per ranking and checks the condition on every write: asOf for the stream job, the exact flag and the run time for the batch job. A query on one window returns all 101 scopes in a single page. It is not on the read path of a ranking request.',
        watch:
          'ConditionalCheckFailedRequests, which rises during a replay, ThrottledRequests and SystemErrors per operation, ConsumedWriteCapacityUnits, ConsumedReadCapacityUnits and SuccessfulRequestLatency.',
      },
      {
        part: 'Ranking API',
        service:
          'A second Application Load Balancer with AWS WAF, in front of Amazon ECS on AWS Fargate: 12 tasks, minimum healthy 100%, maximum 150%',
        why: 'Each task holds all 1,111 rows in memory, refreshes the live ones every 5 seconds and answers from them. Its health check passes once the rows are loaded and does not look at their age, so a stale table makes rankings old and never takes the API down.',
        watch:
          'ALB RequestCount, TargetResponseTime, HTTPCode_Target_5XX_Count, HTTPCode_ELB_5XX_Count and HealthyHostCount; ECS CPUUtilization and MemoryUtilization. Custom, from every task: OldestLiveRowAge and NewestExactDayAgeHours.',
      },
      {
        part: 'Archiver',
        service:
          'An Amazon ECS service on AWS Fargate, 8 tasks in one consumer group, minimum healthy 50%',
        why: 'Reads the log, writes one columnar file per partition every 5 minutes or 128 MB, and commits its position only after Amazon S3 has acknowledged the file. Eight tasks share the 64 partitions; when one stops, the group hands its partitions to the others.',
        watch:
          'MSK MaxOffsetLag for its consumer group, which the brokers publish. Custom: files written, write failures and the append time of the newest archived record per partition.',
      },
      {
        part: 'Raw archive and exact counts',
        service:
          'Amazon S3 Standard, one bucket: raw/ expires after 90 days and counts/ after 2 years, by lifecycle rules',
        why: 'Cheap, durable storage that a batch job can read in parallel. A file is visible to a listing as soon as its write is acknowledged, which is what the completeness check relies on.',
        watch:
          'BucketSizeBytes and NumberOfObjects, daily. With request metrics turned on for the bucket: 5xxErrors and PutRequests.',
      },
      {
        part: 'Batch job',
        service:
          'Amazon EMR Serverless running Apache Spark, started by an Amazon EventBridge Scheduler schedule at minute 30 of hours 0 to 5 UTC, with a 50-minute limit per run',
        why: 'Six hours a day of work at most, so nothing runs in between. The schedule calls StartJobRun with <aws.scheduler.execution-id> as the client token, the id Scheduler assigns to each invocation, and the job works out the closed day from its own start time. The schedule has its own retries set to zero because the next hour is the retry.',
        watch:
          'SuccessJobs, FailedJobs and CancelledJobs for the application, and the job run state change events. Custom, from the job: ProvisionalCountDifferencePercent, ProvisionalOverlap, repeated ids removed and run duration.',
      },
      {
        part: 'Security',
        service: 'AWS WAF on both load balancers, AWS KMS, IAM roles per service, AWS CloudTrail',
        why: 'Clients present a short-lived signed session token that the ingest tasks verify without a call. An event carries no user id, and the token is not stored. The log, the table, the bucket and the checkpoints are encrypted. Each role reaches only its own resources: ingest can only produce to the topic, the API can only read the table, the archiver can only write under raw/, and the stream job and the batch job are the only writers of the table.',
        watch:
          'WAF BlockedRequests per rule, and CloudTrail events for changes to roles and to the schedule.',
      },
      {
        part: 'Observability',
        service: 'Amazon CloudWatch dashboards and alarms',
        why: 'Freshness is measured by the API tasks, which read the rows, and not by the job that writes them, so a dead job cannot hide it. Intake and reads are measured by the load balancers, and the archiver’s lag by the brokers. Alarms on a metric that a component publishes about itself treat missing data as breaching, except Live count drift, which keeps its state, because Exact ranking late covers a batch job that does not run.',
        watch:
          'The objectives below, and the daily difference between provisional and exact counts.',
      },
    ],
    limits: [
      'Managed Service for Apache Flink gives each KPU 1 vCPU, 4 GB of memory, of which 3 GB are heap, and 50 GB of disk for running state, and charges one more KPU per application for orchestration. The default quota is 64 KPUs per application and can be raised; this job uses 33.',
      'Its defaults are a checkpoint every 60 seconds with at least 5 seconds between two, and changing them needs the checkpoint configuration set to custom. Checkpoints go to an S3 bucket the service owns, one is retained, and the state backend is RocksDB and cannot be changed. The checkpoint timeout is 60 minutes and at most one checkpoint runs at a time, and neither can be modified.',
      'After a failure the service restarts the application from the newest checkpoint. It states no restart time, so the 90 seconds here are a planning figure. An update or a stop takes a snapshot, which is a Flink savepoint, when snapshots are enabled.',
      'The downtime metric is 0 while the job runs and above 0 while it is failing or recovering. Newer Flink versions on the service mark it as deprecated in favour of separate restarting and failing times, so the alarm that pages here is the age measured by the readers.',
      'The Flink Kafka source does not rely on offsets committed to the brokers for recovery. It commits them when a checkpoint completes only to expose progress, so the lag the brokers report for the stream job moves in steps of one checkpoint. The service publishes numberOfFailedCheckpoints, lastCheckpointDuration and lastCheckpointSize but no count of completed checkpoints, so the alarm reads the source’s commitsSucceeded, the total of successful offset commits, to see that checkpoints still complete.',
      'MSK’s default configuration for three zones sets the replication factor to 3 and min.insync.replicas to 2. On a cluster without tiered storage it also sets unclean.leader.election.enable to true, which would let an out-of-sync replica become leader and drop acknowledged records, so this design sets it to false.',
      'With acks=all the leader waits for the full set of in-sync replicas, and a produce is refused when fewer than min.insync.replicas are in sync. A topic set to log append time has each record’s timestamp overwritten with the broker’s local time at the append.',
      'A Kafka producer with idempotence enabled does not write a record twice when it retries inside one session. A new request from the client after a lost answer is a new record, which is why the event id exists.',
      'MSK recommends at most 1,000 partition replicas per broker on the large and xlarge sizes, and keeping CpuUser plus CpuSystem under 60%. A Standard broker holds up to 16,384 GiB. This design has 32 replicas and 1.3 TB per broker.',
      'MSK reports MaxOffsetLag per consumer group and topic at the default monitoring level, in records, and only while the group is stable or empty and has committed an offset. EstimatedMaxTimeLag is an estimate of the time to drain, not an age.',
      'A DynamoDB item is at most 400 KB and a query returns at most 1 MB per call; a window’s 101 rows are about 505 KB. A write costs 1 unit per KB, and a query is charged on the total size it reads, halved when eventually consistent.',
      'A conditional write that fails still consumes write units, by the size of the item, and is counted in ConditionalCheckFailedRequests. During a replay every refused row costs the same 5 units as an accepted one.',
      'A DynamoDB partition takes 1,000 write units and 3,000 read units a second, and a new on-demand table sustains 4,000 writes and 12,000 reads a second. This table needs about 152 and 480.',
      'ThrottledRequests has a data point only in a minute with a throttled request, and SystemErrors is published only with both the table and the operation as dimensions.',
      'Amazon S3 returns a stored object to any read or listing that starts after the write was acknowledged. It supports at least 3,500 writes a second per prefix; the archiver makes about one every 5 seconds.',
      'S3 storage metrics arrive once a day. Request metrics such as 5xxErrors arrive each minute only after they are turned on for the bucket.',
      'EMR Serverless has a default quota of 16 concurrent vCPUs per account, which is raised before launch for a job of this size. A job run times out after 12 hours unless a limit is set; this one is set to 50 minutes. StartJobRun requires a client token.',
      'EventBridge Scheduler starts its targets with 60-second precision, accepts cron expressions in UTC, and allows the retry attempts of a schedule to be set to 0.',
      'An AWS WAF rate-based rule counts requests per source address over a window of 1, 2, 5 or 10 minutes, with a lowest limit of 10. It can take up to several minutes, usually under 30 seconds, to start acting, and it limits near the number set, not exactly at it.',
      'HTTPCode_Target_5XX_Count leaves out the 5xx that the load balancer generates itself, and HTTPCode_ELB_5XX_Count exists per load balancer and is reported only in minutes that have one. Each API therefore has its own load balancer, and an error ratio adds both counts with an absent count read as zero. RequestCount counts only requests for which a target was chosen, so the ratio is missing only when RequestCount is, and that case counts as breaching.',
      'In an ECS deployment the maximum percent counts running, pending and stopping tasks, and the minimum healthy percent is rounded up. Fargate spreads the tasks of a service over the configured zones as well as it can.',
      'A CloudWatch alarm reads more data points than its evaluation periods, and every real point in that range is used before a missing one is filled in. An alarm that treats missing data as breaching therefore fires on silence only once the last real point has left the range, and CloudWatch gives no fixed size for it, so those delays are written here as a few minutes. An alarm with a period under one hour can look back at most one day, which is 1,440 one-minute periods, and the breaching points of an M-out-of-N alarm do not have to be consecutive.',
    ],
  },
  slos: [
    {
      objective: 'Event intake',
      target: '99.9% of POST /events answered within 200 ms and without a 5xx, over 28 days',
      measure:
        'On the events load balancer: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount for errors, and TargetResponseTime for latency. An absent 5XX count is read as zero. The ratio is missing only when RequestCount is, and such a minute counts as failed. The usual p95 is 15 ms.',
    },
    {
      objective: 'Ranking reads',
      target: '99.9% of GET /top answered within 100 ms and without a 5xx, over 28 days',
      measure:
        'The same two measures on the ranking load balancer, with the same rules for absent and missing data. The usual p95 is 10 ms.',
    },
    {
      objective: 'Freshness',
      target: 'In 99.5% of minutes no live row is more than 60 s old, over 28 days',
      measure:
        'OldestLiveRowAge: now minus the lowest asOf among the live rows a task holds, 303 except in the first seconds of a day, published by every API task on each refresh. A minute is good when the maximum over all tasks is at most 60 s, and a minute with no data counts as missed. It is measured by the reader, so it covers the stream job, the table and the refresh. The usual value is 10 to 30 s.',
    },
    {
      objective: 'Exact daily ranking',
      target: 'Published by 03:00 UTC on at least 27 of 28 days',
      measure:
        'NewestExactDayAgeHours: the hours since the end of the newest day whose global row is exact, published by every API task. A day is met when the value never reaches 27. It normally peaks near 25, just before the job publishes at about 01:00.',
    },
    {
      objective: 'Live count error',
      target:
        'On at least 27 of 28 days the provisional global counts are within 1% of the exact ones and at least 90 of the top 100 items are the same',
      measure:
        'ProvisionalCountDifferencePercent and ProvisionalOverlap, published by the batch job before it replaces the provisional rows, over the items present in both lists. Usually 0.1% and 99 or 100. A day without an exact ranking has no measure and counts as missed.',
    },
  ],
  alarms: [
    {
      name: 'Intake errors',
      metric:
        'On the events ALB, each over one 5-minute window: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount above 0.04%, with an absent 5XX count read as zero and a missing ratio counted as breaching, or p99.96 TargetResponseTime above 150 ms. The load balancer publishes these, not the service',
      meaning:
        'Events are being refused or are slow: ingest tasks are down or too few, or the log is not acknowledging in time. Each clause lets through at most 0.04% of requests, so both together stay inside the 0.1% the target allows, and 150 ms is tighter than 200. The ratio is missing only when RequestCount is, as when no task is registered, and that fires too. Clients send refused events again with the same id.',
    },
    {
      name: 'Ranking API errors',
      metric:
        'On the ranking ALB, each over one 5-minute window: the same error ratio above 0.04%, with an absent 5XX count read as zero and a missing ratio counted as breaching, or p99.96 TargetResponseTime above 60 ms',
      meaning:
        'Ranking reads are failing or slow. A read touches only the task’s memory, so this is tasks that are down, too few or out of memory, not the table. 60 ms is tighter than the 100 ms target, and the two clauses together allow 0.08%.',
    },
    {
      name: 'Ranking stale',
      metric:
        'Custom, from the API tasks: maximum OldestLiveRowAge above 45 s for 5 consecutive 1-minute periods, or above 60 s in 7 of the last 1,440 1-minute periods; missing data counts as breaching',
      meaning:
        'Live rankings are not being renewed: the stream job is down, behind or restarting again and again, the table refuses writes or reads, or a task cannot refresh. 45 seconds is tighter than the 60-second bound, and 5 minutes lets one clean restart pass without a page while leaving most of the 201-minute budget. The second clause is for a job that keeps restarting without ever being stale for 5 minutes in a row. It counts the minutes the objective counts as missed, over 24 hours: two restarts make 6 and pass, a third makes 9 and pages, and 28 days in which it never fires hold at most 6 × 28 = 168 missed minutes, inside the 201. Readers still get answers, with an honest asOf. The readers publish it, so a dead job cannot silence it; if every API task is silent the alarm fires a few minutes later, and Ranking API errors fires as well. The two clauses change state separately, so a long outage still pages while the second one is in alarm. The first returns to OK by itself once rows are fresh again, and the second once fewer than 7 missed minutes are left in the last 24 hours.',
    },
    {
      name: 'Checkpoints failing',
      metric:
        'Managed Flink: the rate of numberOfFailedCheckpoints above 0 in 3 of the last 30 1-minute periods, or lastCheckpointDuration above 30 s, or the Kafka source’s commitsSucceeded not rising for 5 consecutive 1-minute periods; missing data counts as breaching',
      meaning:
        'The job is counting but not saving. Readers see nothing while checkpoints only fail to complete, but the next restart goes back to the last completed one, further than 60 seconds, and costs more of the freshness budget. A failed checkpoint can itself be that restart: Apache Flink’s default tolerates no failed checkpoint before it fails the job over, and the service does not list that number among the settings an application may change, so this design does not count on raising it. The restart is then what Ranking stale sees. Usually the state has grown or a task is under pressure. The first clause counts 3 minutes in 30 and not 3 in a row, because failures that each end in a restart are minutes apart. It does not see a checkpoint that hangs: the service’s checkpoint timeout is 60 minutes and only one checkpoint runs at a time, so a hung one fails at most once an hour and no other starts meanwhile. lastCheckpointDuration is the time the last completed checkpoint took, so the second clause sees only slow successes. The third clause sees the hang: the source commits its offsets to the brokers each time a checkpoint completes, so 5 minutes without a successful commit are 5 minutes without a completed checkpoint, or brokers that refuse the commits. When it fires, the newest checkpoint is up to about 6 minutes old, and a restart at that point is about 450 seconds behind and takes about 225 seconds to catch up at peak, with rows older than 60 seconds for about 4 and a half minutes instead of 2. Every further minute without a checkpoint adds a minute of input and half a minute of catch-up; left alone until the timeout, the restart replays about an hour of input in about half an hour. It returns to OK when fewer than 3 of the last 30 minutes had a failed checkpoint, the last completed one took at most 30 s and a commit has succeeded in the last 5 minutes.',
    },
    {
      name: 'Log unhealthy',
      metric:
        'MSK UnderMinIsrPartitionCount above 0 or OfflinePartitionsCount above 0 for 2 minutes, or KafkaDataLogsDiskUsed above 70% on any broker; UnderMinIsrPartitionCount and KafkaDataLogsDiskUsed are reported per broker and are read as a metric-math maximum over the six brokers, so a broker that reports nothing does not make the value missing while another reports; missing data counts as breaching',
      meaning:
        'Some partitions cannot accept events, so 1 in 64 per partition is being refused, or a broker’s disk is filling toward the point where retention can no longer be kept. One broker down does not fire it, and neither do the two brokers of one zone; a second one in another zone does. 70% is below the 85% at which MSK advises action.',
    },
    {
      name: 'Archive behind',
      metric:
        'MSK MaxOffsetLag for the archiver’s consumer group above 3 million records for 15 consecutive 1-minute periods; missing data counts as breaching',
      meaning:
        'The archiver is not keeping up or not running. In normal work the lag swings up to about 700,000 records per partition at peak, one five-minute file. 3 million records are about 21 minutes at the peak rate and about an hour at the average one, far inside the 72 hours the log keeps and early enough to fix before the batch job needs the day. The brokers publish it, so it works with every archiver task dead.',
    },
    {
      name: 'Exact ranking late',
      metric:
        'Custom, from the API tasks: NewestExactDayAgeHours above 26 for one 5-minute period; missing data counts as breaching',
      meaning:
        'It is 02:00 UTC and yesterday is still provisional: the archive is incomplete, the job is failing, or the schedule did not start it. It fires an hour before the 03:00 target, with four more scheduled starts to come, one of them before the target. It returns to OK when the exact rows are published and the API tasks have loaded them, within 5 minutes.',
    },
    {
      name: 'Live count drift',
      metric:
        'Custom, from the batch job, on the latest daily value: ProvisionalCountDifferencePercent above 0.5, or ProvisionalOverlap below 95; missing data keeps the current state',
      meaning:
        'The live ranking was further from the exact one than repeats explain: a retry storm, a counting bug in the stream job, or a provisional row that missed the end of the day. 0.5% and 95 items are tighter than the 1% and 90 of the objective. A ticket, not a page. It returns to OK with the next night’s values if they are back in range.',
    },
  ],
  evolution: {
    mvp: 'One scope and one window: the global top 100 of the last hour. A small log, a stream job with parallelism 2 that keeps exact minute buckets and writes one row, and an API that serves it from memory. The archive is there from the first day, because raw events that were not kept cannot be recovered later, and so are the event id, the append-time clock and the conditional write on asOf, since each of them is hard to add once data exists without them. Left out at first: categories and regions, the 24-hour and day windows, the grouping before the shuffle and the batch job, which can be written when the first exact number is needed and run over the archive from day one.',
    atScale: [
      'At 10x (1.5 million events a second at peak), one request per event is the first waste: clients send batches of events in one call, and the answer lists the ids that were stored. The log grows to 640 partitions and the stream job to a parallelism of 320, past the default quota of 64 KPUs, which is raised.',
      'At 10x, the merger receives 97,000 lists a round from 320 tasks. It is split by scope, so several merger tasks each own a set of scopes and write their own rows.',
      'At 10x the items, the scan is the problem: 500 million keys are 15.6 million per task every 10 seconds. Each task keeps a list of candidates above a floor that follows its 100th total and scans everything only when that total falls below the floor.',
      'At 100x the items, exact state stops being cheap. The long tail moves into a count-min sketch per bucket with a stated bound, exact counts are kept only for the candidates, and the batch job remains the place where every item is counted exactly.',
      'At 100x, one Region is too far from most users. Each Region runs intake, a log and its own counters, and a global ranking is a merge of regional counts for a candidate set, which is no longer exact because an item’s count is now split.',
    ],
    firstBottleneck:
      'The full scan of every counter task every 10 seconds. It grows with the number of distinct keys, not with traffic: a catalogue ten times larger means ten times the scan while the event rate has not moved. The second is the stream job as a single unit, in availability before throughput: every restart or deploy stops all counting for about 90 seconds, and the freshness budget is what pays.',
    avoided: [
      'Removing repeats in the stream. It needs the ids of a day in state for a 0.1% error that is measured and that the exact ranking does not have. Worth adding, over a short window, if retry storms make the live ranking visibly wrong.',
      'A sketch for counting. Exact counts fit in 10 GB and have no error to explain. Worth adding at 100 times the keys.',
      'A cache cluster or a CDN in front of the rankings. All rows fit in the memory of a task. Worth adding when reads grow past what a few dozen tasks can serve, or when readers are far from the Region.',
      'An analytics store for combined filters. 101 precomputed scopes cover the pages that exist. Worth adding when the product needs a category inside a region or arbitrary ranges.',
      'Counting by the time on the phone, with windows held open for late events. The log’s clock keeps the live and exact rankings on the same definition. Worth adding only if offline viewing becomes a large share and its timing matters.',
      'A 24-hour window that slides by the minute. Hour buckets keep the state tens of times smaller. Worth adding if the hourly step is visible in the product.',
      'Two-phase or transactional writes from the stream job. A whole row guarded by asOf can be written again safely. Worth revisiting only if the job starts writing something that cannot be overwritten.',
      'A second copy of the stream job on standby. A restart costs 3 minutes of a 201-minute budget. Worth adding when the freshness target becomes tighter than a restart.',
      'Fraud scoring. It is a product of its own. Worth adding as a filter between the archive and the batch count first, where it can be rerun.',
    ],
  },
};
