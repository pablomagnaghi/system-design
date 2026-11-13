import type { Design } from '../types';

export const jobScheduler: Design = {
  slug: 'job-scheduler',
  title: 'Distributed job scheduler',
  summary:
    'Run millions of one-off and recurring jobs at the right time: never lose one, never fire the same run twice by accident, retry what fails, and keep working when machines die.',
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Schedule a job to run once at a given time, or on a recurring schedule (cron).',
      'Run the job, retry it on failure, and give up after a limit.',
      'Cancel or pause a job, and see the history of every run.',
    ],
    nonFunctional: [
      'Durable: a scheduled job survives restarts and machine failures.',
      'Each run starts within a few seconds of its scheduled time.',
      'At-least-once execution, with job code written so a duplicate is harmless.',
      'Scale to tens of millions of jobs a day by adding machines.',
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
      'Follow one job from the moment it is scheduled until it has run, including what happens when a worker dies or the job keeps failing. Press play, or step through the stages.',
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
      },
      {
        id: 'dispatcher',
        title: 'Dispatchers',
        detail: 'Claim due jobs',
        column: 3,
        row: 'middle',
      },
      { id: 'queue', title: 'Work queue', detail: 'Ready to run', column: 4, row: 'middle' },
      { id: 'history', title: 'Run history', detail: 'Every attempt', column: 5, row: 'top' },
      {
        id: 'workers',
        title: 'Workers',
        detail: 'Idempotent, heartbeat',
        column: 5,
        row: 'middle',
      },
      { id: 'dlq', title: 'Dead letters', detail: 'Alert + replay', column: 5, row: 'bottom' },
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
          'A service posts a job with its schedule and an idempotency key. The API validates it, computes the first run time and stores it in a database.',
        tradeoff:
          'Timers in memory or a cron file on one machine are simple, but a restart loses them and nobody can query them. A database survives failures and lets you list, pause and cancel jobs, at the cost of becoming the component every run depends on.',
        nodes: ['service', 'api', 'jobs'],
        travel: [
          ['service', 'api'],
          ['api', 'jobs'],
        ],
      },
      {
        title: 'Find due jobs with an index',
        narration:
          'Every job row has a next run time with an index on it. Finding what is due is a range query: everything scheduled up to now that is not yet claimed.',
        tradeoff:
          'Polling an indexed table every second is easy to build and keeps scheduling transactional. Delay queues or in-memory timing wheels can be more precise and scale further, but make it harder to change or cancel a job after it is scheduled.',
        nodes: ['jobs'],
        travel: [],
      },
      {
        title: 'Split the work into partitions',
        narration:
          'Jobs are hashed into a fixed number of partitions. Each dispatcher holds a time-limited lease on some partitions and only looks at those jobs.',
        tradeoff:
          'A single leader dispatcher is simpler, but caps throughput and leaves a gap while a new leader is chosen. Partitions with leases scale by adding dispatchers, and if one dies its lease expires and another takes over its slice.',
        nodes: ['leases', 'dispatcher'],
        travel: [['leases', 'dispatcher']],
      },
      {
        title: 'Claim and advance in one step',
        narration:
          'A dispatcher claims due jobs with a conditional update (or a row lock that skips rows already locked), marks them dispatched, and for recurring jobs computes the next run time in the same transaction.',
        tradeoff:
          'Claiming and advancing atomically is what stops the same run from being fired twice when two dispatchers overlap. Skipping locked rows lets several dispatchers work on the same table without waiting on each other.',
        nodes: ['jobs', 'dispatcher'],
        travel: [['jobs', 'dispatcher']],
      },
      {
        title: 'Hand off to a work queue',
        narration:
          'Claimed jobs are put on a queue. Workers pull from it, and the worker pool scales on how many jobs are waiting.',
        tradeoff:
          'The queue separates deciding when to run from actually running, so slow jobs never delay scheduling. It delivers at least once, which means the job code itself must tolerate running twice.',
        nodes: ['dispatcher', 'queue'],
        travel: [['dispatcher', 'queue']],
      },
      {
        title: 'Run idempotently, with a heartbeat',
        narration:
          'A worker runs the job using the run id as an idempotency key for its side effects, and sends heartbeats while it works. If the heartbeats stop, the run is considered lost and is retried.',
        tradeoff:
          'True exactly-once execution across machines needs heavy coordination. At-least-once plus idempotent jobs gets the same effect for far less. The heartbeat interval trades detection speed against overhead.',
        nodes: ['queue', 'workers'],
        travel: [['queue', 'workers']],
      },
      {
        title: 'Record every attempt',
        narration:
          'Each attempt is written to the run history: start, end, worker, result and error. An alarm fires when a job is overdue, not only when it fails.',
        tradeoff:
          'Storing every attempt costs space, so old history is expired. In return, "did my job run?" always has an answer, and a job that silently never started is caught by the overdue alarm instead of by a customer.',
        nodes: ['workers', 'history'],
        travel: [['workers', 'history']],
      },
      {
        title: 'Retry, then dead-letter',
        narration:
          'A failed run is retried with exponential backoff and jitter. After the maximum attempts it goes to a dead-letter queue and alerts the owning team, who can fix and replay it.',
        tradeoff:
          'Retrying forever hides bugs and burns resources; giving up silently loses work. A bounded number of retries with a dead-letter queue makes every permanent failure visible and recoverable.',
        nodes: ['workers', 'dlq'],
        travel: [['workers', 'dlq']],
      },
      {
        title: 'Catch up after downtime',
        narration:
          'If the scheduler was down, recurring jobs may have missed runs. Each job declares a catch-up policy: run once now, run every missed occurrence, or skip to the next.',
        tradeoff:
          'There is no single right answer: a billing job must run every missed period, while a cache refresh only needs the latest one. Making it a per-job setting avoids both duplicate work and silently skipped periods.',
        nodes: ['jobs', 'dispatcher'],
        travel: [],
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
        'Poll a partitioned, indexed table. It covers tens of millions of jobs a day; move hot partitions to time buckets only if polling becomes the bottleneck.',
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
        'Fencing tokens on leases and runs. A long garbage-collection pause or network partition can then delay work, but never cause a double write.',
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
};
