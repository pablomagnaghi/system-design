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
      'Durable: a job is acknowledged only after its write is stored on a quorum of copies across zones, so it survives restarts and machine failures.',
      'Each run starts within a few seconds of its scheduled time.',
      'At-least-once execution, with job code written so a duplicate is harmless.',
      'Scale to about 100 million runs a day (about 1.2K a second on average, 50K in the peak second) by adding machines.',
      'Each service can schedule, see and cancel only its own jobs, payloads carry references instead of secrets, and every connection is authenticated and encrypted.',
    ],
    outOfScope: [
      'Workflow orchestration with dependencies between jobs.',
      'The business logic inside each job.',
      'Precision below one second.',
      'Running untrusted code from customers, which needs sandboxing.',
      'Active-active scheduling of the same job in two regions.',
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
      description:
        'Stops future runs. With stopRunning, a run in progress is asked to stop at its next checkpoint.',
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
        metrics: { requestsPerSecond: '1.2K', p95Latency: '1 s', errorRate: '0%' },
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
        metrics: { requestsPerSecond: '1.2K', p95Latency: '1 s', errorRate: '0%' },
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
          'More dispatchers join. Jobs are hashed into a fixed number of partitions. Each dispatcher holds a time-limited lease on some partitions and only looks at those jobs. Four dispatchers that still claim one row at a time clear the burst in about a minute instead of four: better, but still late.',
        tradeoff:
          'A single leader dispatcher is simpler, but caps throughput and leaves a gap while a new leader is chosen. Partitions with leases scale by adding dispatchers, and if one dies its lease expires and another takes over its slice.',
        nodes: ['leases', 'dispatcher'],
        travel: [['leases', 'dispatcher']],
        short: 'Partitions',
        metrics: {
          requestsPerSecond: '50K',
          p95Latency: '1 min',
          errorRate: '0.1%',
          healthy: '4 / 4',
          alerts: ['p95Latency'],
        },
        load: { leases: 20, dispatcher: 60, jobs: 55 },
        traffic: [{ edge: ['leases', 'dispatcher'], kind: 'health' }],
      },
      {
        title: 'Claim and advance in one step',
        narration:
          'A dispatcher claims due jobs in batches of 500 with a conditional update (or a row lock that skips rows already locked), marks them dispatched, writes a run record with a dispatch deadline, and for recurring jobs computes the next run time, all in the same transaction.',
        tradeoff:
          'Claiming and advancing atomically is what stops the same run from being fired twice when two dispatchers overlap. Skipping locked rows lets several dispatchers work on the same table without waiting on each other. Batches take the four dispatchers from 800 claims a second to 50,000, at the cost of larger transactions on the primary.',
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
          'A worker runs the job using the run id as an idempotency key for its side effects, and sends heartbeats while it works. If the heartbeats stop, the sweeper declares the run lost and it is retried.',
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
          'Each attempt is written to the run history: start, end, worker, result and error. The "Runs overdue or stuck" alarm fires when a run is still not finished past its retry window, not only when it fails.',
        tradeoff:
          'Storing every attempt costs space, so history expires after 30 days. In return, "did my job run?" has an answer for those 30 days, and a run that silently never started is caught by the "Runs overdue or stuck" alarm instead of by a customer.',
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
          'If the scheduler was down, recurring jobs may have missed runs. Each job declares a catch-up policy: run once now, run every missed occurrence, or skip to the next. While the missed runs drain, starts are late and the lateness alarm stays on.',
        tradeoff:
          'There is no single right answer: a billing job must run every missed period, while a cache refresh only needs the latest one. Making it a per-job setting avoids both duplicate work and silently skipped periods.',
        nodes: ['jobs', 'dispatcher'],
        travel: [['jobs', 'dispatcher']],
        short: 'Catch up',
        metrics: {
          requestsPerSecond: '50K',
          p95Latency: '30 s',
          errorRate: '0.1%',
          healthy: '4 / 4',
          alerts: ['p95Latency'],
        },
        load: { jobs: 75, dispatcher: 85 },
      },
    ],
  },
  flows: [
    {
      id: 'schedule',
      title: 'Schedule a job',
      kind: 'sync',
      summary:
        'The billing service schedules "charge account 7 every month on the 1st at 09:00 Buenos Aires time". It gets a 201 only once the write is on a quorum of copies across three zones.',
      runsOn: 'ALB → Scheduler API on ECS → Aurora PostgreSQL commit across three zones',
      participants: [
        { id: 'svc', label: 'Billing service', service: 'Caller' },
        { id: 'api', label: 'Scheduler API', service: 'ECS Fargate' },
        { id: 'db', label: 'Jobs table', service: 'Aurora PostgreSQL' },
      ],
      steps: [
        {
          from: 'svc',
          to: 'api',
          label: 'POST /jobs {cron, timeZone, idempotencyKey}',
          note: 'The caller signs the request with its own identity, and sends an idempotency key so a retried POST cannot create a second job.',
        },
        {
          from: 'api',
          to: 'api',
          label: 'owner check, next run in local time → UTC',
          note: 'The API checks the caller may create jobs of this type, computes the next 09:00 in Buenos Aires and stores it as UTC.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'INSERT job, unique idempotency key',
          note: 'The row goes in with its owner, schedule and next run time. A repeated key returns the existing job instead.',
        },
        {
          from: 'db',
          to: 'api',
          label: 'committed in 3 zones',
          note: 'Aurora acknowledges the commit only after a quorum of storage copies across three zones has it, so losing a node loses nothing.',
          style: 'reply',
        },
        {
          from: 'api',
          to: 'svc',
          label: '201 {jobId}',
          note: 'Only now is the job acknowledged. From here on it will run at least once per occurrence.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'dispatch',
      title: 'Claim and dispatch',
      kind: 'scheduled',
      summary:
        'Every second, each dispatcher claims the due jobs of the partitions it leases, advances recurring ones, and puts the runs on the queue.',
      runsOn: 'Dispatchers on ECS → Aurora claim transaction → SQS',
      participants: [
        { id: 'disp', label: 'Dispatcher', service: 'ECS' },
        { id: 'db', label: 'Jobs and leases', service: 'Aurora PostgreSQL' },
        { id: 'sqs', label: 'Work queue', service: 'SQS' },
      ],
      steps: [
        {
          from: 'disp',
          to: 'db',
          label: 'BEGIN; SELECT lease … FOR SHARE; check epoch',
          note: 'The transaction first reads the lease row of partition 17 with a shared lock and checks that this dispatcher still holds it with its epoch. A takeover has to update that row, so it cannot commit in the middle of the claim, and a dispatcher that lost the lease cannot claim.',
        },
        {
          from: 'disp',
          to: 'db',
          label: 'SELECT due … FOR UPDATE SKIP LOCKED LIMIT 500',
          note: 'Due rows are found by the next-run index, compared to the database clock. Skipping locked rows lets dispatchers work side by side.',
        },
        {
          from: 'disp',
          to: 'db',
          label: 'INSERT runs; advance next run; COMMIT',
          note: 'One run per (job, scheduled time), guarded by a unique key, a dispatch deadline, and the next occurrence for recurring jobs, all in one commit.',
        },
        {
          from: 'disp',
          to: 'sqs',
          label: 'SendMessageBatch {runId, attempt}',
          note: 'The message carries the run id and attempt number, never the payload, which stays in the database. A batch call takes at most 10 messages, so a claim of 500 goes out as 50 calls in parallel. If the dispatcher dies before this, the sweeper re-enqueues the run.',
        },
      ],
    },
    {
      id: 'run',
      title: 'Run a job',
      kind: 'queue',
      summary:
        'A worker takes the run from the queue, starts each attempt only once, does the work with the run id as an idempotency key, and records the result.',
      runsOn:
        'SQS → worker on ECS → Aurora conditional start → target system → run history in DynamoDB',
      participants: [
        { id: 'sqs', label: 'Work queue', service: 'SQS' },
        { id: 'worker', label: 'Worker', service: 'ECS' },
        { id: 'db', label: 'Runs', service: 'Aurora PostgreSQL' },
        { id: 'target', label: 'Payments API', service: 'Target system' },
        { id: 'hist', label: 'Run history', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'sqs',
          to: 'worker',
          label: 'ReceiveMessage {runId, attempt}',
          note: 'The message becomes invisible to other workers for the visibility timeout; it is deleted only after the run is recorded.',
        },
        {
          from: 'worker',
          to: 'db',
          label:
            'UPDATE run SET status = running WHERE id = :run AND status = dispatched AND attempt = :n',
          note: 'A conditional start: if another worker already started this attempt, or the attempt number in the message is stale, no row changes and this copy is dropped as a duplicate.',
        },
        {
          from: 'worker',
          to: 'target',
          label: 'charge, Idempotency-Key: runId',
          note: 'If an attempt is retried after it already charged, the payments API sees the same key and returns the first result.',
        },
        {
          from: 'worker',
          to: 'db',
          label: 'heartbeat every 10 s',
          note: 'While the job works, heartbeats keep the run alive. Three missed ones and the sweeper declares the run lost and retries it.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'db',
          label: 'finish: succeeded',
          note: 'The result is accepted only for the current attempt, which acts as a fencing token against an old attempt that wakes up.',
        },
        {
          from: 'worker',
          to: 'hist',
          label: 'append attempt',
          note: 'Start, end, worker and result are copied to the history, kept 30 days. The run record in Aurora is the source of truth: if this append is lost, a daily replay copies finished runs to the history before their rows are dropped.',
          style: 'async',
        },
      ],
    },
    {
      id: 'retry',
      title: 'Retry, then dead-letter',
      kind: 'queue',
      summary:
        'The payments API is down. The run is retried with backoff and, after the last attempt, lands in a dead-letter queue that pages the owning team.',
      runsOn:
        'Worker on ECS → Aurora → SQS delayed message → SQS dead-letter queue → CloudWatch alarm',
      participants: [
        { id: 'worker', label: 'Worker', service: 'ECS' },
        { id: 'db', label: 'Runs', service: 'Aurora PostgreSQL' },
        { id: 'sqs', label: 'Work queue', service: 'SQS' },
        { id: 'dlq', label: 'Dead letters', service: 'SQS DLQ' },
        { id: 'team', label: 'Owning team', service: 'Alarm' },
      ],
      steps: [
        {
          from: 'worker',
          to: 'db',
          label: 'attempt 1 failed: 503',
          note: 'One conditional update records the failure with its error, raises the attempt number and returns the run to dispatched with a new deadline of now + backoff + 30 s.',
        },
        {
          from: 'worker',
          to: 'sqs',
          label: 'requeue {runId, attempt 2}, delay 30 s ± jitter',
          note: 'Exponential backoff with jitter, so a struggling target is not hammered by every job at once. If this send is lost, the sweeper finds the run past its deadline and enqueues it.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'dlq',
          label: 'attempt 5 failed → dead letter',
          note: 'After the maximum attempts the worker first records the run as dead-lettered, then sends it to the dead-letter queue. The record is the durable fact: the sweeper resends any dead-lettered run not yet marked as sent, so the run ends in a recorded state instead of disappearing.',
        },
        {
          from: 'dlq',
          to: 'team',
          label: 'alarm: new dead letters',
          note: 'The page is routed by the job type and owner on the "runs dead-lettered" metric that the worker emits. The team fixes the cause and replays the run; the same run id keeps the replay harmless.',
          style: 'async',
        },
      ],
    },
    {
      id: 'sweeper',
      title: 'Sweep a lost dispatch',
      kind: 'scheduled',
      summary:
        'A dispatcher committed a claim and crashed before sending the message. Nothing would ever run it, so a sweeper looks for runs dispatched but not started. The same sweeper watches heartbeats and declares runs lost.',
      runsOn: 'Sweeper task on ECS → Aurora → SQS',
      participants: [
        { id: 'sweep', label: 'Sweeper', service: 'ECS' },
        { id: 'db', label: 'Runs', service: 'Aurora PostgreSQL' },
        { id: 'sqs', label: 'Work queue', service: 'SQS' },
      ],
      steps: [
        {
          from: 'sweep',
          to: 'db',
          label: 'runs dispatched, past deadline (30 s)',
          note: 'Every few seconds it queries runs still in the dispatched state past their dispatch deadline.',
        },
        {
          from: 'db',
          to: 'sweep',
          label: 'run 9031',
          note: 'The claim committed, the next occurrence already advanced, but no worker ever started it.',
          style: 'reply',
        },
        {
          from: 'sweep',
          to: 'sqs',
          label: 'SendMessage {runId: 9031, attempt: 1}',
          note: 'If the original message did get through, two now exist; the conditional start lets only one worker run it. The sweeper then moves the deadline forward, so a run waiting in a long queue is not sent again every few seconds.',
        },
        {
          from: 'sweep',
          to: 'sweep',
          label: 'count swept runs',
          note: 'A steady rise means dispatchers are dying or the queue rejects writes, so it has an alarm.',
        },
      ],
    },
    {
      id: 'lease',
      title: 'A dispatcher dies',
      kind: 'async',
      summary:
        'The dispatcher holding partition 17 stops. Its lease expires, another takes it with a higher epoch, and the old one cannot claim if it wakes up.',
      runsOn: 'Dispatchers on ECS → lease rows in Aurora with an epoch',
      participants: [
        { id: 'd1', label: 'Dispatcher 1', service: 'ECS, paused' },
        { id: 'db', label: 'Leases', service: 'Aurora PostgreSQL' },
        { id: 'd2', label: 'Dispatcher 2', service: 'ECS' },
      ],
      steps: [
        {
          from: 'd1',
          to: 'd1',
          label: 'long GC pause',
          note: 'Dispatcher 1 holds partition 17 with epoch 41 and stops renewing. Jobs in that partition wait; none are lost.',
        },
        {
          from: 'd2',
          to: 'db',
          label: 'take expired lease → epoch 42',
          note: 'After about 10 s the lease expires and dispatcher 2 takes it, raising the epoch.',
        },
        {
          from: 'd2',
          to: 'db',
          label: 'claim backlog',
          note: 'The waiting jobs start up to one lease period late, then the partition is on time again.',
        },
        {
          from: 'd1',
          to: 'db',
          label: 'claim with epoch 41 → rejected',
          note: 'Dispatcher 1 wakes up and tries to claim. The epoch check inside the transaction fails, so it drops the partition instead of firing jobs twice.',
        },
      ],
    },
    {
      id: 'reconcile',
      title: 'Hourly reconciliation',
      kind: 'scheduled',
      summary:
        'The check behind the "no lost jobs" SLO. Every hour, a reconciler recomputes which occurrences were due and looks for any without a run record.',
      runsOn: 'EventBridge Scheduler, hourly → reconciler task on ECS → Aurora → CloudWatch alarm',
      participants: [
        { id: 'eb', label: 'Hourly trigger', service: 'EventBridge Scheduler' },
        { id: 'rec', label: 'Reconciler', service: 'ECS task' },
        { id: 'db', label: 'Jobs and runs', service: 'Aurora PostgreSQL' },
        { id: 'alarm', label: 'On-call', service: 'CloudWatch alarm' },
      ],
      steps: [
        {
          from: 'eb',
          to: 'rec',
          label: 'start, 10:05',
          note: 'Once an hour is well inside EventBridge’s one-minute minimum, so a managed schedule fits here, unlike the sweeper.',
          style: 'async',
        },
        {
          from: 'rec',
          to: 'db',
          label: 'occurrences due 09:00–10:00',
          note: 'From each active job’s schedule and time zone it recomputes every occurrence that was due in the last full hour, partition by partition.',
        },
        {
          from: 'rec',
          to: 'db',
          label: 'runs for those occurrences',
          note: 'Each occurrence has at most one run record, by the unique key on job id and scheduled time; the reconciler checks that there is at least one.',
        },
        {
          from: 'rec',
          to: 'rec',
          label: '1 occurrence without a run',
          note: 'A gap means a bug: a claim that advanced the next run without inserting the run, or a schedule computed wrongly.',
        },
        {
          from: 'rec',
          to: 'db',
          label: 'insert missing run',
          note: 'The missing run is created following the job’s catch-up policy, and the unique key makes a second pass harmless.',
        },
        {
          from: 'rec',
          to: 'alarm',
          label: 'MissingRuns = 1',
          note: 'Any gap pages: the run is repaired, but the bug that caused it still exists.',
          style: 'async',
        },
      ],
    },
  ],
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
    {
      question: 'Build it, or use a managed scheduler such as Amazon EventBridge Scheduler?',
      options: [
        {
          name: 'EventBridge Scheduler',
          pros: 'One-time and cron schedules with time zones, retries and a dead-letter queue, with nothing to operate.',
          cons: 'Per-account quotas on schedules and invocations must be raised for millions of jobs and a 50K-per-second burst, and run history, catch-up policies and per-run idempotency stay our job.',
        },
        {
          name: 'Build on a database and a queue',
          pros: 'Full control of claiming, history, catch-up, fairness and pre-scaling for the midnight burst.',
          cons: 'Dispatchers, leases, a sweeper and alarms to build and run.',
        },
      ],
      choice:
        'Build it, because the product is the scheduler: run history per attempt, catch-up policies, per-run idempotency keys and the burst are requirements. For a team that only needs a few thousand timers, EventBridge Scheduler is the better answer, and saying so is part of the design.',
    },
    {
      question: 'How do we keep one tenant from delaying everyone else?',
      options: [
        {
          name: 'One shared queue, first come first served',
          pros: 'Simplest to run and to reason about.',
          cons: 'A tenant that schedules 10 million jobs for midnight fills the queue and every other tenant starts late.',
        },
        {
          name: 'Quotas at the API and concurrency caps at the workers',
          pros: 'Bounds what one tenant can create and how many of its runs execute at once.',
          cons: 'Limits to set per tenant, and a tenant over its cap runs later than scheduled.',
        },
        {
          name: 'A queue per tenant',
          pros: 'Complete isolation.',
          cons: 'Thousands of queues to poll and scale, most of them idle.',
        },
      ],
      choice:
        'Quotas and caps, plus two priority classes. The API enforces per-tenant limits on pending jobs and on runs per minute, answering 429 above them. Workers cap concurrent runs per tenant and per job type, so a burst from one tenant waits in the queue instead of taking the pool. Critical jobs go to their own queue, polled with a larger weight. Runs over a cap are delayed, never dropped, and their lateness is visible per tenant.',
    },
    {
      question: 'What happens when the code of a job changes?',
      options: [
        {
          name: 'Always run the latest handler',
          pros: 'Nothing to manage.',
          cons: 'A run queued with an old payload shape can crash the new handler, and every retry crashes again.',
        },
        {
          name: 'Pin each job to the handler version it was created with',
          pros: 'Old runs keep their old behaviour.',
          cons: 'Many versions to keep deployed, and fixes do not reach old jobs.',
        },
        {
          name: 'Versioned payloads and compatible handlers',
          pros: 'One deployed handler serves current and previous payload versions.',
          cons: 'Two versions to support at once, and a migration step to retire the old one.',
        },
      ],
      choice:
        'Every payload carries a schema version, and a handler accepts the current version and the previous one. Changes roll out in two steps: first deploy handlers that read both versions, then let callers write the new one, and drop the old version once no pending job uses it. A run whose version the handler does not know fails fast to the dead-letter queue instead of being retried, and new handlers roll out to a small share of runs first.',
    },
    {
      question: 'How do long jobs survive retries and cancellation?',
      options: [
        {
          name: 'Restart from the beginning',
          pros: 'No state to keep.',
          cons: 'A two-hour job that dies at minute 110 starts over, and a job that cannot finish between failures never finishes.',
        },
        {
          name: 'Checkpoints keyed by the run id',
          pros: 'A retry resumes from the last saved position; a cancel can stop it at a safe point.',
          cons: 'The job code must save and resume its own progress.',
        },
        {
          name: 'Split it into many small jobs',
          pros: 'Each piece is short and retried on its own.',
          cons: 'Needs a parent that tracks the pieces, which is workflow orchestration.',
        },
      ],
      choice:
        'Checkpoints. A long job saves its position, such as the last account processed, with each heartbeat, keyed by run id. A retry reads the checkpoint and resumes there, and the work after it stays idempotent by run id. Cancellation rides on the heartbeat: its reply carries a stop flag, and the job stops at its next checkpoint. Every job type also has a hard timeout, after which the attempt is declared lost.',
    },
    {
      question: 'How do we keep jobs and their payloads safe?',
      options: [
        {
          name: 'Trust the internal network',
          pros: 'Nothing to configure.',
          cons: 'Any service can cancel another team’s jobs, and secrets in payloads end up in the database, the queue and the logs.',
        },
        {
          name: 'Identity per service, tenant checks and secret references',
          pros: 'A service sees only its jobs, payloads hold references, and each job type runs with only the permissions it needs.',
          cons: 'An authorization check on every call, and a role per job type to maintain.',
        },
      ],
      choice:
        'Each calling service authenticates with its own identity, and every job row carries its owner, checked on create, read, pause and cancel. Payloads carry references such as a secret name, never the secret, and workers resolve them at run time. Each job type runs under its own role with least privilege, and payloads and history are encrypted at rest.',
    },
  ],
  wrapUp:
    'Durable jobs indexed by next run time, partitioned dispatchers that claim and advance atomically, a queue to idempotent workers with heartbeats, bounded retries into dead letters, and a history that answers "did it run?".',
  guarantees: {
    provides: [
      {
        property: 'Durability',
        promise:
          'A job acknowledged with 201 is not lost if one database node fails. The API replies only after the commit is stored on a quorum of storage copies across three zones, which Aurora does before it acknowledges, and a retried POST with the same idempotency key returns the same job instead of creating a second one.',
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
          'Each run executes at least once, made harmless by the run id. A worker starts a run with a conditional update on (run id, attempt), so a duplicate message is dropped, and the job passes the run id to the systems it calls as an idempotency key for the case where an attempt is retried after it already had an effect. A failed or lost attempt returns the run to dispatched with a new deadline, so the same sweeper covers a retry whose message is lost.',
      },
      {
        property: 'Accounting',
        promise:
          'Every run ends in a recorded state: succeeded, dead-lettered after the maximum attempts, or cancelled. A run still dispatched or running past its retry window raises the "Runs overdue or stuck" alarm, so no run disappears without a trace. The run record in the jobs database is the source of truth; the history is a copy of it, kept 30 days.',
      },
    ],
    assumes: [
      'The jobs database has one writer per shard, stores every commit on a quorum of copies across zones before acknowledging it, and evaluates conditional writes on the writer. Leases, jobs and pending runs live in the same shard so the lease epoch can be checked inside the claim transaction.',
      'Job code is idempotent for a given run id, and the systems it calls accept that id as a deduplication key and keep it longer than the retry window plus the time a dead letter can wait for a replay, which is at most 14 days in the dead-letter queue.',
      'The work queue is durable and delivers at least once.',
      'Due times are compared against the database clock, not against each dispatcher clock. Lease safety comes from the epoch check, not from clocks; clock skew only shifts when a job is seen as due.',
      'Workers send heartbeats while they work, and a run that is expected to outlive the heartbeat timeout keeps sending them.',
    ],
    doesNotGuarantee: [
      'Exactly-once execution. A worker can finish the side effect and die before recording the result, and the retry runs the job again.',
      'An exact start time. The target is a start within a few seconds at P95; a dispatcher failover adds up to one lease period, and a burst larger than the worker pool adds queue time.',
      'Ordering. Runs of different jobs start in any order, and a slow or retried run of a recurring job can overlap the next occurrence of the same job.',
      'That cancel stops a run in progress at once. Pause only prevents future claims; cancel with stopRunning stops a run at its next checkpoint, and a job that never checkpoints runs to its timeout.',
      'That every missed occurrence runs after an outage. That depends on the catch-up policy of the job.',
    ],
  },
  failures: [
    {
      scenario: 'A dispatcher dies while it holds the leases of a quarter of the partitions.',
      impact:
        'Jobs in those partitions stop being claimed. Nothing is lost, because unclaimed jobs are still rows in the table, but they start up to one lease period late (about 10 s with a 10 s lease).',
      detection:
        'The lease is not renewed. A per-partition metric, the age of the oldest due job that is still unclaimed, crosses its alarm threshold of 10 s.',
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
        'Heartbeats stop. After three missed intervals (about 30 s at one every 10 s) the sweeper, which also watches heartbeats, declares the run lost. A counter of lost runs per job type shows a handler that hangs.',
      recovery:
        'The sweeper marks the attempt lost with one conditional update that raises the attempt number and returns the run to dispatched with a new deadline of now + backoff + 30 s, then sends a new message with the backoff delay. If that send is lost, its next pass finds the run past its deadline. The old message reappears after its visibility timeout and is dropped by the conditional start, because its attempt number is stale. The attempt number acts as the fencing token: the result of the old attempt is rejected by the scheduler, and the systems the job calls dedupe on the run id. The run ends recorded once, and its external effects happen once as long as those systems honor the key.',
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
        'Database health checks, the API error rate and the unclaimed-age metric on every partition at once. The "Runs starting late" alarm fires for the jobs due in the window, and "Runs overdue or stuck" only if the outage outlasts a retry window.',
      recovery:
        'A replica is promoted; it reads the same quorum storage, so it has every acknowledged job and claim. Dispatchers renew or retake their leases, the due backlog drains as a small burst, callers retry their POST with the same idempotency key, and workers retry their result write. Runs that were declared lost in the meantime are retried, which the run id makes harmless.',
    },
    {
      scenario:
        'A burst is larger than the worker pool, or one job type hangs and occupies the workers.',
      impact:
        'Dispatch stays on time but runs wait in the queue, so start lateness grows for every job that shares the pool. Nothing is lost.',
      detection:
        'The P95 of start lateness, which has an alarm, and the age of the oldest message in the queue on the dashboard. Per-type concurrency shows which job type is holding the workers.',
      recovery:
        'Workers scale on queue depth, and for known peaks they are added ahead of time from the count of jobs due in the next minutes, which the due index already knows. A per-type concurrency cap and a run timeout keep one type from taking the whole pool. The backlog drains, in no particular order, and the system is left consistent, only late.',
    },
  ],
  capacity: {
    assumptions: [
      '100 million runs a day, from about 20 million recurring jobs and 30 million pending one-off jobs.',
      'The busiest second is midnight UTC, with 50K jobs due at once.',
      'A run takes 2 s on average and is mostly waiting on I/O, so one worker holds about 50 runs at a time.',
      'A job row is about 1 KB with its payload; a run row, and a finished attempt in the history, are about 300 bytes each.',
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
        value: '50K runs/s, ~43x average',
        math: '50,000 due at midnight ÷ 1,160/s average ≈ 43',
      },
      {
        label: 'Dispatch throughput',
        value: '4 min with one dispatcher, ~1 min with four, ~1 s with four and batches',
        math: 'One row per transaction at ~200 claims/s: 50,000 ÷ 200 = 250 s. Four dispatchers × 200 = 800 claims/s: 50,000 ÷ 800 ≈ 63 s. Four dispatchers × 25 batches/s × 500 rows = 50,000 claims/s',
      },
      {
        label: 'Database writes',
        value:
          '~5K rows/s average; ~100K in the peak second, then ~50K start and ~50K finish commits',
        math: '4 row writes per run (claim, run record, start, finish) × 1,160/s ≈ 4,600/s. At the peak, 50,000 claims × 2 rows (job + run record) = 100,000 rows in 4 × 25 = 100 batched transactions. The 50,000 starts and 50,000 finishes that follow are one commit per run, over the next few seconds',
      },
      {
        label: 'Worker slots',
        value: '~2.3K average (~50 workers), ~50K at the peak (~1,000 workers)',
        math: '1,160 runs/s × 2 s ≈ 2,300 concurrent ÷ 50 per worker ≈ 46. To start 50,000 runs within about a second, 50,000 slots ÷ 50 = 1,000',
      },
      {
        label: 'Storage',
        value: '~50 GB of jobs, ~30 GB of run rows, ~1 TB of history',
        math: '50M job rows × 1 KB = 50 GB. One day of run rows in the jobs database: 100M × 300 B = 30 GB. 100M runs × 1.1 attempts × 300 B ≈ 33 GB/day × 30 days ≈ 1 TB',
      },
    ],
    implications: [
      'The peak is about 43 times the average, so every tier is sized or pre-scaled for the burst, and the lateness target is checked at midnight, not on a daily average.',
      'A single dispatcher that claims one row per transaction is 250 times too slow for the peak second. Four of them are still about 60 times too slow (800 claims a second), so partitions alone are not enough: claims are also batched, 500 rows per transaction, skipping locked rows.',
      'The workload is write-heavy: each run costs about four row writes and almost no reads beyond the due poll. Read replicas do not help; the write throughput of the primary sets the limit. The 100K claim rows of the peak second fit in about 100 batched transactions (4 dispatchers × 25 batches), but each start and each finish is its own commit, so the primary also takes tens of thousands of small commits a second for the few seconds after midnight.',
      'Jobs and their due index (about 50 GB and a few GB) fit one database shard with the index in memory, so polling stays cheap. Run rows stay in that database for about a day (about 30 GB), in daily partitions that are dropped once every run in them is finished and copied to the history. History is 20 times larger than the jobs and append-only, so it lives in its own append-friendly store, DynamoDB on AWS, and expires through a 30-day TTL.',
      'Worker demand jumps 20 times in one second, faster than scaling on queue depth can react. The due index already knows how many jobs come due in the next minutes, so workers are added before the peak instead of after it.',
      'The partition count is fixed and much larger than the dispatcher count (for example 256 partitions for 4 dispatchers), so dispatchers can be added by moving leases, with no rehash of jobs.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one region across three Availability Zones. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Scheduler API',
        service: 'Application Load Balancer and Amazon ECS on AWS Fargate',
        why: 'A stateless HTTP API that validates, checks the caller’s identity and writes one row; it scales on request count.',
        watch:
          'ALB HTTPCode_Target_5XX_Count and TargetResponseTime; custom: POSTs answered from an existing idempotency key.',
      },
      {
        part: 'Jobs, runs and leases',
        service: 'Amazon Aurora PostgreSQL, one writer and a replica in another zone',
        why: 'FOR UPDATE SKIP LOCKED, unique keys and one transaction for claim, run record, next run and lease epoch. Every commit is stored on a quorum of copies across three zones before it is acknowledged.',
        watch:
          'CommitLatency, CommitThroughput, CPUUtilization, DatabaseConnections, Deadlocks; custom: oldest unclaimed due job per partition.',
      },
      {
        part: 'Dispatchers',
        service: 'Amazon ECS service, a few tasks holding 256 partition leases',
        why: 'Long-running loops that poll every second; adding a task moves leases, never jobs.',
        watch: 'Custom: claims per second, lease renewals and takeovers, claim transaction time.',
      },
      {
        part: 'Work queue',
        service:
          'Two Amazon SQS standard queues, critical and standard; messages carry the run id and attempt number, never the payload',
        why: 'At-least-once delivery with no throughput ceiling, a visibility timeout per message, and delays for backoff.',
        watch:
          'ApproximateAgeOfOldestMessage, ApproximateNumberOfMessagesVisible, NumberOfMessagesSent against NumberOfMessagesDeleted.',
      },
      {
        part: 'Workers',
        service:
          'Amazon ECS on Fargate, or on EC2 for the peak, scaled on queue depth plus scheduled scale-out',
        why: 'Jobs may run longer than a function allows, and the midnight peak needs about 1,000 workers added before 00:00, not after.',
        watch:
          'ECS RunningTaskCount against desired; custom: start lateness P95, lost runs and duplicates dropped per job type.',
      },
      {
        part: 'Sweeper',
        service: 'A small always-on Amazon ECS task',
        why: 'Every few seconds it scans for runs dispatched but not started and for runs whose heartbeats stopped, finer than the one-minute minimum of EventBridge schedules.',
        watch: 'Custom: runs re-enqueued per minute, runs declared lost per job type.',
      },
      {
        part: 'Run history',
        service:
          'Amazon DynamoDB: job id as partition key, scheduled time and attempt as sort key, TTL of 30 days',
        why: 'Append-only and twenty times larger than the jobs; one query answers GET /jobs/{id}/runs, and expired items delete themselves. It is a copy: the run record in Aurora is the source of truth, and a daily replay fills in any append that was lost.',
        watch: 'WriteThrottleEvents and ConsumedWriteCapacityUnits, which jump at midnight.',
      },
      {
        part: 'Dead letters',
        service: 'An SQS dead-letter queue, with a CloudWatch alarm routed to the owning team',
        why: 'Runs past their last attempt wait there with their error until the team fixes and replays them.',
        watch:
          'Custom: runs dead-lettered, with job type and owner dimensions, emitted by the worker. ApproximateNumberOfMessagesVisible on the dead-letter queue, which has only a queue name dimension, is the global backstop.',
      },
      {
        part: 'Reconciler',
        service: 'Amazon EventBridge Scheduler, hourly, starting a task on Amazon ECS',
        why: 'An hourly check is the kind of timer a managed schedule handles well; it compares due occurrences with run records.',
        watch:
          'Custom: missing runs found per hour, and the reconciler’s own duration and failures.',
      },
      {
        part: 'Security',
        service: 'IAM roles per service and per job type, AWS KMS, AWS Secrets Manager',
        why: 'Callers sign requests with their own identity, workers assume the role of the job type, payloads hold secret names that are resolved at run time, and data is encrypted at rest.',
        watch: 'AWS CloudTrail for denied calls, and the API’s rejected ownership checks.',
      },
      {
        part: 'Observability and cost',
        service: 'Amazon CloudWatch dashboards and alarms, AWS Cost Explorer',
        why: 'One dashboard with the SLOs below. The bill is mostly the workers held for the peak and Aurora’s writes, so flattening the midnight spike is also a cost lever.',
        watch: 'The SLO dashboard, and workers, Aurora and SQS as separate lines in Cost Explorer.',
      },
    ],
    limits: [
      'EventBridge schedules run at most once a minute, so anything that must poll every few seconds, like the sweeper, runs as a small always-on task.',
      'An SQS message is at most 1 MiB and its visibility timeout at most 12 hours. Messages carry the run id and attempt number, never the payload, so the database stays the only copy of it, and long jobs extend their visibility while they heartbeat.',
      'SendMessageBatch takes at most 10 messages per call, so a claim of 500 runs is sent as 50 calls in parallel, and a queue keeps a message for at most 14 days, which bounds how long a dead letter can wait for a replay.',
      'SQS standard queues deliver at least once and do not keep order, which the conditional start and the run id already handle.',
      'An Aurora failover takes tens of seconds, during which nothing can be claimed; the design treats it as a late start, not a loss.',
      'AWS Lambda stops a function after 30 minutes and long jobs can run for hours, so workers run on ECS; a job type that always finishes in seconds could use Lambda.',
    ],
  },
  slos: [
    {
      objective: 'Start on time',
      target: '95% of runs start within 5 s of their scheduled time, measured at midnight too',
      measure:
        'Start lateness, the worker’s start time minus the scheduled time, from the run records.',
    },
    {
      objective: 'No lost jobs',
      target: 'Every acknowledged job and every due occurrence has a run record',
      measure:
        'A reconciliation job compares due occurrences with run records per hour; any gap pages.',
    },
    {
      objective: 'Every run accounted for',
      target: '99.9% of runs reach succeeded, dead-lettered or cancelled within their retry window',
      measure: 'Runs still dispatched or running past their window, from the runs table.',
    },
    {
      objective: 'Scheduling API',
      target: '99.9% of POST /jobs succeed, 99% within 300 ms',
      measure: 'ALB 5XX count and target response time on the API.',
    },
  ],
  alarms: [
    {
      name: 'Partition not claiming',
      metric: 'Custom: oldest unclaimed due job above 10 s in any partition',
      meaning:
        'A dispatcher died or lost its lease and no one took it yet, or the database cannot take claims.',
    },
    {
      name: 'Runs starting late',
      metric:
        'Custom: start lateness P95 above 5 s for 5 minutes, the SLO level; it pages above 30 s. SQS ApproximateAgeOfOldestMessage stays on the dashboard, because it also counts messages held by a worker that is still running',
      meaning:
        'Dispatch is fine but workers are short: scale out, or a job type is hogging the pool.',
    },
    {
      name: 'Runs overdue or stuck',
      metric: 'Custom: runs still dispatched or running past their retry window, above zero',
      meaning:
        'A run neither finished nor was dead-lettered in time: a handler hangs while it still heartbeats, or the sweeper is not running.',
    },
    {
      name: 'Lost dispatches',
      metric: 'Custom: runs re-enqueued by the sweeper above a steady baseline',
      meaning: 'Dispatchers crash between commit and enqueue, or SQS is rejecting sends.',
    },
    {
      name: 'Workers dying mid-run',
      metric: 'Custom: runs declared lost per job type above zero for 5 minutes',
      meaning:
        'A handler hangs or crashes; its retries are safe only if the job honors the run id.',
    },
    {
      name: 'New dead letters',
      metric:
        'Custom: runs dead-lettered, by job type and owner, above zero; SQS ApproximateNumberOfMessagesVisible on the dead-letter queue above zero as the global backstop',
      meaning: 'A job exhausted its attempts; the owning team fixes the cause and replays it.',
    },
    {
      name: 'Missing runs',
      metric:
        'Custom: occurrences without a run record found by the hourly reconciliation, above zero',
      meaning:
        'The reconciler repaired them, but something skipped a run: a claim bug or a wrong schedule. Find it before it repeats.',
    },
    {
      name: 'Tenant over its cap',
      metric: 'Custom: runs delayed by a per-tenant concurrency cap for more than 5 minutes',
      meaning:
        'One tenant is scheduling beyond its quota; its runs are late by design, and the others are protected.',
    },
    {
      name: 'Scheduling API failing',
      metric:
        'ALB HTTPCode_Target_5XX_Count above 0.1% of requests, or TargetResponseTime P99 above 300 ms, for 5 minutes',
      meaning:
        'Callers cannot schedule jobs: the API tasks, or the database behind them, are failing or slow.',
    },
    {
      name: 'Database saturated',
      metric: 'Aurora CommitLatency above 20 ms, or CPUUtilization above 75% at the midnight peak',
      meaning:
        'The primary, the first bottleneck, is near its limit; batch claims harder or split partitions across clusters.',
    },
  ],
  evolution: {
    mvp: 'One database with a replica and one dispatcher with a warm standby, polling every second with batched claims. Workers pull runs straight from the runs table with a row lock that skips locked rows, so there is no separate queue, no partitions and no leases beyond the single leader. History stays in the same database. This is enough for a few hundred runs a second and keeps every guarantee except fast failover.',
    atScale: [
      'At 10x (1 billion runs a day, 500K in the peak second) the primary cannot absorb the claim burst and the start and finish commits behind it. The jobs table is split across several database clusters by partition, each with its own dispatchers; history is already in its own store and scales by adding partitions to it.',
      'At 10x the midnight spike is also worth flattening at the source: jobs that do not need the exact second opt into a jitter window, which spreads the claims and the worker demand over a minute.',
      'At 100x polling an index every second is the wrong shape. Jobs far in the future move to time-bucketed storage, and each partition loads the next few minutes into memory and fires from a timing wheel, with the bucket as the durable copy.',
      'At 100x one tenant can swamp the rest, so queues, concurrency limits and worker pools are split per tenant or per priority class.',
      'A second region is added as an independent scheduler that owns its own jobs. Jobs are copied to the other region asynchronously, so on a regional failure they are reassigned there with a higher epoch, minus the jobs and claims acknowledged in the last seconds of replication lag, which are lost or late. The failed region checks the epoch before it claims again, which keeps one owner per job; runs that were in flight can execute in both, harmless by run id.',
    ],
    firstBottleneck:
      'The primary of the jobs database. Every run costs about four row writes on it, the burst concentrates the claims into one second, each start and finish right after it is its own commit, and inserts and deletes all land on the same end of the next-run index. Dispatchers, the queue and workers scale by adding machines; the primary does not, so it is the first thing to be split by partition.',
    avoided: [
      'Exactly-once execution through distributed transactions with the systems a job calls. At least once with the run id as key gives the same effect; it would only be worth it for a target that cannot dedupe, and then a per-target outbox is the cheaper answer.',
      'In-memory timing wheels and delay queues. They give sub-second precision, but make cancel and reschedule hard; worth adding when jobs need precision below the one-second poll or polling becomes the bottleneck.',
      'Dependencies between jobs. A workflow engine needs durable state per step and is a different product; worth adding as a layer on top when teams start chaining jobs through payloads.',
      'Strict priorities with preemption. Two weighted queues and per-tenant caps cover the need; stopping running jobs to make room for urgent ones is worth it only for hard real-time work.',
      'A no-overlap rule for runs of the same job. It needs a lock per job held across the whole run; add it as an opt-in when jobs that are not safe to run concurrently appear.',
    ],
  },
};
