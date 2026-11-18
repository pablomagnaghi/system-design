import type { Design } from '../types';

export const jobScheduler: Design = {
  slug: 'job-scheduler',
  title: 'Distributed job scheduler',
  summary:
    'Run millions of one-off and recurring jobs at the right time: lose no job once it is accepted, make a duplicate run harmless, retry what fails, and keep working when machines die.',
  difficulty: 'Medium',
  minutes: 9,
  requirements: {
    functional: [
      'Schedule a job to run once at a given time, or on a recurring schedule (cron).',
      'Run the job, retry it on failure, and give up after a limit.',
      'Cancel or pause a job, and see the history of every run.',
    ],
    nonFunctional: [
      'Durable: a job is acknowledged only after a synchronously replicated write, so it survives restarts and machine failures.',
      'Each run starts within a few seconds of its scheduled time.',
      'At-least-once execution, with job code written so a duplicate is harmless.',
      'Scale to about 100 million runs a day (around 1K a second on average, 50K in the peak second) by adding machines.',
    ],
    outOfScope: [
      'Workflow orchestration with dependencies between jobs.',
      'The business logic inside each job.',
    ],
  },
  entities: [
    {
      name: 'Job',
      description: 'Type, payload, schedule (time or cron plus time zone), next run time, status.',
    },
    {
      name: 'Run',
      description: 'One execution of a job: attempt number, worker, start, end, result.',
    },
    {
      name: 'Partition lease',
      description: 'Which dispatcher owns which slice of jobs, and until when.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/jobs',
      description:
        'Body: type, payload, runAt or cron + timeZone, maxAttempts, idempotencyKey. Returns 201 with the job id.',
    },
    {
      method: 'POST',
      path: '/jobs/{id}/pause · /jobs/{id}/cancel',
      description: 'Stops future runs; a run already in progress finishes.',
    },
    {
      method: 'GET',
      path: '/jobs/{id}/runs',
      description: 'History of every attempt with status, duration and error.',
    },
  ],
  dataFlow: [
    'A service schedules a job; it is stored with its next run time.',
    'Dispatchers, each owning a slice of jobs, claim the ones that are due and put them on a queue.',
    'Workers run them idempotently, report progress and record the result; failures are retried, then dead-lettered.',
  ],
  highLevel: {
    label: 'Run a job through the scheduler',
    intro:
      'Follow one job from the moment it is scheduled until it has run, including what happens when a worker dies or the job keeps failing. The design grows as it needs to: watch a midnight burst leave one dispatcher behind until partitions and leases join, then the queue, workers and history. Numbers are illustrative; P95 here is how late a job starts. Press play, or step through the stages.',
    nodes: [
      { id: 'service', title: 'Services', detail: 'Schedule a job', column: 0, row: 'middle' },
      { id: 'api', title: 'Scheduler API', detail: 'Validate + store', column: 1, row: 'middle' },
      { id: 'jobs', title: 'Jobs table', detail: 'Indexed by next run', column: 2, row: 'middle' },
      {
        id: 'leases',
        title: 'Partition leases',
        detail: 'One owner per slice',
        column: 3,
        row: 'top',
        appearsAt: 3,
      },
      {
        id: 'dispatcher',
        title: 'Dispatchers',
        detail: 'Claim due jobs',
        column: 3,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'queue',
        title: 'Work queue',
        detail: 'Ready to run',
        column: 4,
        row: 'middle',
        appearsAt: 5,
      },
      {
        id: 'history',
        title: 'Run history',
        detail: 'Every attempt',
        column: 5,
        row: 'top',
        appearsAt: 7,
      },
      {
        id: 'workers',
        title: 'Workers',
        detail: 'Idempotent, heartbeat',
        column: 5,
        row: 'middle',
        appearsAt: 6,
      },
      {
        id: 'dlq',
        title: 'Dead letters',
        detail: 'Alert + replay',
        column: 5,
        row: 'bottom',
        appearsAt: 8,
      },
    ],
    edges: [
      ['service', 'api'],
      ['api', 'jobs'],
      ['leases', 'dispatcher'],
      ['jobs', 'dispatcher'],
      ['dispatcher', 'queue'],
      ['queue', 'workers'],
      ['workers', 'history'],
      ['workers', 'dlq'],
    ],
    stages: [
      {
        title: 'Schedule and store durably',
        narration:
          'A service posts a job with its schedule and an idempotency key. The API validates it, computes the first run time, stores it in a database and replies only once that write is durable.',
        tradeoff:
          'Timers in memory or a cron file on one machine are simple, but a restart loses them and nobody can query them. A database survives failures and lets you list, pause and cancel jobs, at the cost of becoming the component every run depends on.',
        nodes: ['service', 'api', 'jobs'],
        travel: [
          ['service', 'api'],
          ['api', 'jobs'],
        ],
        short: 'Schedule',
        metrics: { requestsPerSecond: '1K', p95Latency: '1 s', errorRate: '0%' },
        load: { api: 15, jobs: 15 },
      },
      {
        title: 'Find due jobs with an index',
        narration:
          'Every job row has a next run time with an index on it. Finding what is due is a range query: everything scheduled up to now that is not yet claimed.',
        tradeoff:
          'Polling an indexed table every second is easy to build and keeps scheduling transactional. Delay queues or in-memory timing wheels can be more precise and scale further, but make it harder to change or cancel a job after it is scheduled.',
        nodes: ['jobs'],
        travel: [],
        short: 'Due index',
        metrics: { requestsPerSecond: '1K', p95Latency: '1 s', errorRate: '0%' },
        load: { jobs: 20 },
      },
      {
        title: 'Midnight leaves one dispatcher behind',
        narration:
          'At first a single dispatcher polls the table for due jobs. Many teams schedule daily jobs at midnight, so tens of thousands come due in the same second. The one dispatcher claims them as fast as it can, and the last jobs of the burst start minutes late.',
        tradeoff:
          'A bigger machine buys a little headroom, but one dispatcher is still a ceiling on throughput and a single point of failure: if it dies, nothing runs until it is replaced. The work needs to be split so several dispatchers can claim jobs at the same time without stepping on each other.',
        nodes: ['jobs', 'dispatcher'],
        travel: [['jobs', 'dispatcher']],
        short: 'Midnight burst',
        metrics: {
          requestsPerSecond: '50K',
          p95Latency: '4 min',
          errorRate: '0.1%',
          healthy: '1 / 1',
          alerts: ['p95Latency'],
        },
        load: { jobs: 80, dispatcher: 100 },
      },
      {
        title: 'Split the work into partitions',
        narration:
          'More dispatchers join. Jobs are hashed into a fixed number of partitions. Each dispatcher holds a time-limited lease on some partitions and only looks at those jobs.',
        tradeoff:
          'A single leader dispatcher is simpler, but caps throughput and leaves a gap while a new leader is chosen. Partitions with leases scale by adding dispatchers, and if one dies its lease expires and another takes over its slice.',
        nodes: ['leases', 'dispatcher'],
        travel: [['leases', 'dispatcher']],
        short: 'Partitions',
        metrics: {
          requestsPerSecond: '50K',
          p95Latency: '2 s',
          errorRate: '0.1%',
          healthy: '4 / 4',
        },
        load: { leases: 20, dispatcher: 60, jobs: 55 },
        traffic: [{ edge: ['leases', 'dispatcher'], kind: 'health' }],
      },
      {
        title: 'Claim and advance in one step',
        narration:
          'A dispatcher claims due jobs with a conditional update (or a row lock that skips rows already locked), marks them dispatched, writes a run record with a dispatch deadline, and for recurring jobs computes the next run time, all in the same transaction.',
        tradeoff:
          'Claiming and advancing atomically is what stops the same run from being fired twice when two dispatchers overlap. Skipping locked rows lets several dispatchers work on the same table without waiting on each other.',
        nodes: ['jobs', 'dispatcher'],
        travel: [['jobs', 'dispatcher']],
        short: 'Claim',
        metrics: {
          requestsPerSecond: '50K',
          p95Latency: '1 s',
          errorRate: '0.1%',
          healthy: '4 / 4',
        },
        load: { jobs: 55, dispatcher: 60 },
      },
      {
        title: 'Hand off to a work queue',
        narration:
          'Claimed jobs are put on a queue. Workers pull from it, and the worker pool scales on how many jobs are waiting. The claim and the enqueue are two separate steps, so a sweeper puts back on the queue any run that was claimed but not started by its deadline.',
        tradeoff:
          'The queue separates deciding when to run from actually running, so slow jobs never delay scheduling. It delivers at least once, which means the job code itself must tolerate running twice.',
        nodes: ['dispatcher', 'queue'],
        travel: [['dispatcher', 'queue']],
        short: 'Work queue',
        metrics: {
          requestsPerSecond: '50K',
          p95Latency: '1 s',
          errorRate: '0.1%',
          healthy: '4 / 4',
        },
        load: { dispatcher: 55, queue: 50 },
      },
      {
        title: 'Run idempotently, with a heartbeat',
        narration:
          'A worker runs the job using the run id as an idempotency key for its side effects, and sends heartbeats while it works. If the heartbeats stop, the run is considered lost and is retried.',
        tradeoff:
          'True exactly-once execution across machines needs heavy coordination. At-least-once plus idempotent jobs gets the same effect for far less. The heartbeat interval trades detection speed against overhead.',
        nodes: ['queue', 'workers'],
        travel: [['queue', 'workers']],
        short: 'Run',
        metrics: {
          requestsPerSecond: '50K',
          p95Latency: '1 s',
          errorRate: '0.1%',
          healthy: '4 / 4',
        },
        load: { queue: 50, workers: 70 },
        traffic: [{ edge: ['queue', 'workers'], kind: 'heavy' }],
      },
      {
        title: 'Record every attempt',
        narration:
          'Each attempt is written to the run history: start, end, worker, result and error. An alarm fires when a job is overdue, not only when it fails.',
        tradeoff:
          'Storing every attempt costs space, so old history is expired. In return, "did my job run?" always has an answer, and a job that silently never started is caught by the overdue alarm instead of by a customer.',
        nodes: ['workers', 'history'],
        travel: [['workers', 'history']],
        short: 'History',
        metrics: {
          requestsPerSecond: '50K',
          p95Latency: '1 s',
          errorRate: '0.1%',
          healthy: '4 / 4',
        },
        load: { workers: 70, history: 40 },
      },
      {
        title: 'Retry, then dead-letter',
        narration:
          'A failed run is retried with exponential backoff and jitter. After the maximum attempts it goes to a dead-letter queue and alerts the owning team, who can fix and replay it.',
        tradeoff:
          'Retrying forever hides bugs and burns resources; giving up silently loses work. A bounded number of retries with a dead-letter queue makes every permanent failure visible and recoverable.',
        nodes: ['workers', 'dlq'],
        travel: [['workers', 'dlq']],
        short: 'Retry + DLQ',
        metrics: {
          requestsPerSecond: '50K',
          p95Latency: '1 s',
          errorRate: '0.3%',
          healthy: '4 / 4',
        },
        load: { workers: 70, dlq: 15 },
        traffic: [{ edge: ['workers', 'dlq'], kind: 'failed' }],
      },
      {
        title: 'Catch up after downtime',
        narration:
          'If the scheduler was down, recurring jobs may have missed runs. Each job declares a catch-up policy: run once now, run every missed occurrence, or skip to the next.',
        tradeoff:
          'There is no single right answer: a billing job must run every missed period, while a cache refresh only needs the latest one. Making it a per-job setting avoids both duplicate work and silently skipped periods.',
        nodes: ['jobs', 'dispatcher'],
        travel: [],
        short: 'Catch up',
        metrics: {
          requestsPerSecond: '50K',
          p95Latency: '30 s',
          errorRate: '0.1%',
          healthy: '4 / 4',
        },
        load: { jobs: 75, dispatcher: 85 },
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we find due jobs at scale?',
      options: [
        {
          name: 'Poll an indexed table',
          pros: 'Simple, transactional, easy to cancel or edit jobs.',
          cons: 'Polling load grows with dispatchers; precision is the poll interval.',
        },
        {
          name: 'Sorted set in an in-memory store',
          pros: 'Very fast range queries by time.',
          cons: 'Durability and consistency with the job records become your problem.',
        },
        {
          name: 'Time-bucketed tables or delay queues',
          pros: 'Scales to huge volumes; each bucket is read once.',
          cons: 'Cancelling or rescheduling a job means finding it in the right bucket.',
        },
      ],
      choice:
        'Poll a partitioned, indexed table. It covers about 100 million runs a day; move hot partitions to time buckets only if polling becomes the bottleneck.',
    },
    {
      question: 'How do we stop a stale dispatcher or worker from acting after its lease expired?',
      options: [
        {
          name: 'Trust the lease timeout',
          pros: 'Nothing extra.',
          cons: 'A paused process can wake up after expiry and still write.',
        },
        {
          name: 'Fencing tokens',
          pros: 'Each lease has an increasing number; writes with an older number are rejected.',
          cons: 'Every write path has to check the token.',
        },
      ],
      choice:
        'Fencing tokens on leases and runs. A long garbage-collection pause or network partition can then delay work, but never cause a double write to the scheduler tables, which check the token. Side effects in other systems still rely on the run id as an idempotency key.',
    },
    {
      question: 'How do recurring schedules handle time zones?',
      options: [
        {
          name: 'Store cron in UTC',
          pros: 'One clock, simple math.',
          cons: '"Every day at 9:00" drifts by an hour when daylight saving changes.',
        },
        {
          name: 'Store cron plus the job time zone',
          pros: 'Runs at the local time people expect, all year.',
          cons: 'Must handle the hour that does not exist and the hour that happens twice.',
        },
      ],
      choice:
        'Cron plus time zone, computing each next run in that zone and storing it as UTC. The skipped and repeated hours get explicit rules: run at the next valid time, and only once.',
    },
  ],
  wrapUp:
    'Durable jobs indexed by next run time, partitioned dispatchers that claim and advance atomically, a queue to idempotent workers with heartbeats, bounded retries into dead letters, and a history that answers "did it run?".',
  guarantees: {
    provides: [
      {
        property: 'Durability',
        promise:
          'A job acknowledged with 201 is not lost if one database node fails. The API replies only after the row is committed on the primary and on a synchronous replica, and a retried POST with the same idempotency key returns the same job instead of creating a second one.',
      },
      {
        property: 'Dispatch',
        promise:
          'Every due occurrence of an active job is dispatched at least once. The claim, the run record and the next run time commit in one transaction, and the sweeper re-enqueues any run that is still not started at its dispatch deadline, so a crash between the commit and the enqueue delays the run instead of dropping it.',
      },
      {
        property: 'One run per occurrence',
        promise:
          'The scheduler creates a single run record for each (job id, scheduled time). The claim is a conditional update, the run table has a unique key on that pair, and the claim transaction checks the lease epoch of the partition, so two overlapping dispatchers cannot both fire the same occurrence.',
      },
      {
        property: 'Execution',
        promise:
          'Each run executes at least once, made harmless by the run id. A worker starts a run with a conditional update on (run id, attempt), so a duplicate message is dropped, and the job passes the run id to the systems it calls as an idempotency key for the case where an attempt is retried after it already had an effect.',
      },
      {
        property: 'Accounting',
        promise:
          'Every run ends in a recorded state: succeeded, dead-lettered after the maximum attempts, or cancelled. A run that is late or stuck raises the overdue alarm, so no run disappears without a trace while its history is retained.',
      },
    ],
    assumes: [
      'The jobs database has one primary per shard, replicates synchronously and evaluates conditional writes on the primary. Leases, jobs and pending runs live in the same shard so the lease epoch can be checked inside the claim transaction.',
      'Job code is idempotent for a given run id, and the systems it calls accept that id as a deduplication key and keep it longer than the retry window.',
      'The work queue is durable and delivers at least once.',
      'Due times are compared against the database clock, not against each dispatcher clock. Lease safety comes from the epoch check, not from clocks; clock skew only shifts when a job is seen as due.',
      'Workers send heartbeats while they work, and a run that is expected to outlive the heartbeat timeout keeps sending them.',
    ],
    doesNotGuarantee: [
      'Exactly-once execution. A worker can finish the side effect and die before recording the result, and the retry runs the job again.',
      'An exact start time. The target is a start within a few seconds at P95; a dispatcher failover adds up to one lease period, and a burst larger than the worker pool adds queue time.',
      'Ordering. Runs of different jobs start in any order, and a slow or retried run of a recurring job can overlap the next occurrence of the same job.',
      'That cancel or pause stops a run already in progress. They only prevent future claims.',
      'That every missed occurrence runs after an outage. That depends on the catch-up policy of the job.',
    ],
  },
  failures: [
    {
      scenario: 'A dispatcher dies while it holds the leases of a quarter of the partitions.',
      impact:
        'Jobs in those partitions stop being claimed. Nothing is lost, because unclaimed jobs are still rows in the table, but they start up to one lease period late (about 10 s with a 10 s lease).',
      detection:
        'The lease is not renewed. A per-partition metric, the age of the oldest due job that is still unclaimed, crosses its alarm threshold of a few seconds.',
      recovery:
        'Another dispatcher takes the expired lease with a higher epoch and claims the backlog on its next poll. If the old dispatcher was only paused and wakes up, its claim transaction fails the epoch check and it drops the partition.',
    },
    {
      scenario:
        'A dispatcher commits the claim of a batch and crashes before it puts the batch on the queue.',
      impact:
        'The runs exist and are marked dispatched, but no message carries them. Without a second mechanism they would never start, and recurring jobs would look healthy because their next run time has already advanced.',
      detection:
        'The sweeper scans for runs still in the dispatched state past their deadline (about 30 s). The count of swept runs is a metric; a steady rise means dispatchers are dying or the queue is rejecting writes.',
      recovery:
        'The sweeper enqueues the run again. If the first message did reach the queue, two messages now exist and the conditional start lets only one worker run it. The run starts at most one deadline late.',
    },
    {
      scenario: 'A worker stalls or dies in the middle of a run, then possibly comes back.',
      impact:
        'The run makes no progress and its side effects may be partly applied. If the worker was only paused, it can wake up and keep working after another worker has taken the run.',
      detection:
        'Heartbeats stop. After three missed intervals (about 30 s at one every 10 s) the run is declared lost. A counter of lost runs per job type shows a handler that hangs.',
      recovery:
        'The attempt number is increased and the run is enqueued again with backoff. The attempt number acts as the fencing token: the result of the old attempt is rejected by the scheduler, and the systems the job calls dedupe on the run id. The run ends recorded once, and its external effects happen once as long as those systems honor the key.',
    },
    {
      scenario: 'The queue delivers the same run twice, or a retry overtakes the original message.',
      impact:
        'Two workers hold a message for the same run, or an old attempt arrives after a newer one has started.',
      detection:
        'The conditional update that moves the run from dispatched to running for that attempt changes no row. Each such case increments a duplicates-dropped counter.',
      recovery:
        'The worker that lost the update acknowledges the message and does nothing else. No state changes, and the run continues on the worker that won.',
    },
    {
      scenario: 'The primary of the jobs database fails and a replica is promoted.',
      impact:
        'For the tens of seconds of the failover the API rejects new jobs and no dispatcher can claim, so every job that comes due in that window starts late. Runs already on workers continue, but cannot record their result until the database is back.',
      detection:
        'Database health checks, the API error rate and the unclaimed-age metric on every partition at once. The overdue alarm fires for affected jobs.',
      recovery:
        'The synchronous replica is promoted with every acknowledged job and claim. Dispatchers renew or retake their leases, the due backlog drains as a small burst, callers retry their POST with the same idempotency key, and workers retry their result write. Runs that were declared lost in the meantime are retried, which the run id makes harmless.',
    },
    {
      scenario:
        'A burst is larger than the worker pool, or one job type hangs and occupies the workers.',
      impact:
        'Dispatch stays on time but runs wait in the queue, so start lateness grows for every job that shares the pool. Nothing is lost.',
      detection:
        'The age of the oldest message in the queue and the P95 of start lateness, both with alarms. Per-type concurrency shows which job type is holding the workers.',
      recovery:
        'Workers scale on queue depth, and for known peaks they are added ahead of time from the count of jobs due in the next minutes, which the due index already knows. A per-type concurrency cap and a run timeout keep one type from taking the whole pool. The backlog drains in schedule order and the system is left consistent, only late.',
    },
  ],
  capacity: {
    assumptions: [
      '100 million runs a day, from about 20 million recurring jobs and 30 million pending one-off jobs.',
      'The busiest second is midnight UTC, with 50K jobs due at once.',
      'A run takes 2 s on average and is mostly waiting on I/O, so one worker holds about 50 runs at a time.',
      'A job row is about 1 KB with its payload; a finished attempt in the history is about 300 bytes.',
      'Run history is kept for 30 days, with 1.1 attempts per run on average.',
    ],
    estimates: [
      {
        label: 'Average run rate',
        value: '~1.2K runs/s',
        math: '100M runs/day ÷ 86,400 s ≈ 1,160/s',
      },
      {
        label: 'Peak second',
        value: '50K runs/s, ~40x average',
        math: '50,000 due at midnight ÷ 1,160/s average ≈ 43',
      },
      {
        label: 'Dispatch throughput',
        value: '4 min with one dispatcher, ~1 s with four',
        math: 'One row per transaction at ~200 claims/s: 50,000 ÷ 200 = 250 s. Four dispatchers × 25 batches/s × 500 rows = 50,000 claims/s',
      },
      {
        label: 'Database writes',
        value: '~5K rows/s average, ~100K in the peak second',
        math: '4 row writes per run (claim, run record, start, finish) × 1,160/s ≈ 4,600/s. At the peak, 50,000 claims × 2 rows (job + run record) = 100,000',
      },
      {
        label: 'Worker slots',
        value: '~2.3K average (~50 workers), ~50K at the peak (~1,000 workers)',
        math: '1,160 runs/s × 2 s ≈ 2,300 concurrent ÷ 50 per worker ≈ 46. To start 50,000 runs within about a second, 50,000 slots ÷ 50 = 1,000',
      },
      {
        label: 'Storage',
        value: '~50 GB of jobs, ~1 TB of history',
        math: '50M job rows × 1 KB = 50 GB. 100M runs × 1.1 attempts × 300 B ≈ 33 GB/day × 30 days ≈ 1 TB',
      },
    ],
    implications: [
      'The peak is about 40 times the average, so every tier is sized or pre-scaled for the burst, and the lateness target is checked at midnight, not on a daily average.',
      'A single dispatcher that claims one row per transaction is 250 times too slow for the peak second. That forces both partitions, for parallel claims, and batched claims that skip locked rows.',
      'The workload is write-heavy: each run costs about four row writes and almost no reads beyond the due poll. Read replicas do not help; the write throughput of the primary sets the limit, and 100K row writes in one second is only feasible in a few hundred batched transactions.',
      'Jobs and their due index (about 50 GB and a few GB) fit one database shard with the index in memory, so polling stays cheap. History is 20 times larger and append-only, so it lives in its own time-partitioned store and expires by dropping whole days.',
      'Worker demand jumps 20 times in one second, faster than scaling on queue depth can react. The due index already knows how many jobs come due in the next minutes, so workers are added before the peak instead of after it.',
      'The partition count is fixed and much larger than the dispatcher count (for example 256 partitions for 4 dispatchers), so dispatchers can be added by moving leases, with no rehash of jobs.',
    ],
  },
  evolution: {
    mvp: 'One database with a replica and one dispatcher with a warm standby, polling every second with batched claims. Workers pull runs straight from the runs table with a row lock that skips locked rows, so there is no separate queue, no partitions and no leases beyond the single leader. History stays in the same database. This is enough for a few hundred runs a second and keeps every guarantee except fast failover.',
    atScale: [
      'At 10x (1 billion runs a day, 500K in the peak second) the primary cannot absorb the claim burst. The jobs table is split across several database clusters by partition, each with its own dispatchers, and history moves to a store built for appends.',
      'At 10x the midnight spike is also worth flattening at the source: jobs that do not need the exact second opt into a jitter window, which spreads the claims and the worker demand over a minute.',
      'At 100x polling an index every second is the wrong shape. Jobs far in the future move to time-bucketed storage, and each partition loads the next few minutes into memory and fires from a timing wheel, with the bucket as the durable copy.',
      'At 100x one tenant can swamp the rest, so queues, concurrency limits and worker pools are split per tenant or per priority class.',
      'A second region is added as an independent scheduler that owns its own jobs. On a regional failure the jobs are reassigned to the other region with a higher epoch, which keeps one owner per job at any time.',
    ],
    firstBottleneck:
      'The primary of the jobs database. Every run costs about four row writes on it, the burst concentrates the claims into one second, and inserts and deletes all land on the same end of the next-run index. Dispatchers, the queue and workers scale by adding machines; the primary does not, so it is the first thing to be split by partition.',
    avoided: [
      'Exactly-once execution through distributed transactions with the systems a job calls. At least once with the run id as key gives the same effect; it would only be worth it for a target that cannot dedupe, and then a per-target outbox is the cheaper answer.',
      'In-memory timing wheels and delay queues. They give sub-second precision, but make cancel and reschedule hard; worth adding when jobs need precision below the one-second poll or polling becomes the bottleneck.',
      'Dependencies between jobs. A workflow engine needs durable state per step and is a different product; worth adding as a layer on top when teams start chaining jobs through payloads.',
      'Priorities and fairness between tenants. One shared queue is easier to operate; add them when one job type or tenant can delay the rest.',
      'A no-overlap rule for runs of the same job. It needs a lock per job held across the whole run; add it as an opt-in when jobs that are not safe to run concurrently appear.',
    ],
  },
};
