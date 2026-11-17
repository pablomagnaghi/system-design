import type { FieldNote } from '../types';

// The only rate the post gives: the peak job rate on Slack's busiest days.
const peak = { requestsPerSecond: '33,000' } as const;

export const slackJobQueue: FieldNote = {
  slug: 'slack-job-queue',
  company: 'Slack',
  title: 'A durable buffer in front of the job queue',
  summary:
    'After an outage in which a full Redis could neither accept nor hand out jobs, Slack put Kafka in front of its Redis job queue instead of replacing it, so a backlog lands on disk and is fed to Redis at a controlled rate.',
  minutes: 8,
  source: {
    title: "Scaling Slack's Job Queue",
    url: 'https://slack.engineering/scaling-slacks-job-queue/',
    year: 2017,
  },
  context: [
    'Slack runs any work too slow for a web request as a job: posting a message, sending push notifications, unfurling links, reminders, billing. The post puts the busiest days at over 1.4 billion jobs, peaking at 33,000 per second, with jobs taking anywhere from milliseconds to minutes.',
    'The queue dated from the earliest days of the company. The web app hashed each job onto one of several Redis hosts, and pools of workers polled Redis for work. Over the years it was scaled by adding CPU, memory and network, but the design stayed the same.',
    'Then contention in the database slowed jobs down, the queues grew until Redis hit its memory limit, and every feature that enqueues jobs began to fail. Taking a job off the queue also needed a little free memory, so the queue stayed stuck after the database recovered and had to be untangled by hand.',
  ],
  walkthrough: {
    label: 'A job, from a Redis-only queue to Kafka in front of Redis',
    intro:
      'Follow a job from the web app to a worker, watch a slow database fill Redis, and see Kafka and two small services join in front of it. The only metric is the peak job rate, quoted from the post; the load bars are approximate. Press play, or step through the stages.',
    lanes: { top: 'Added in front of Redis' },
    nodes: [
      { id: 'web', title: 'Web app', detail: 'Enqueues jobs', column: 0, row: 'middle' },
      {
        id: 'gate',
        title: 'Kafkagate',
        detail: 'HTTP in, Kafka out',
        column: 1,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'kafka',
        title: 'Kafka',
        detail: 'Durable job log',
        column: 2,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'relay',
        title: 'JQRelay',
        detail: 'One relay per topic',
        column: 3,
        row: 'top',
        appearsAt: 5,
      },
      {
        id: 'consul',
        title: 'Consul',
        detail: 'Locks, rate limits',
        column: 4,
        row: 'top',
        appearsAt: 5,
      },
      { id: 'redis', title: 'Redis', detail: 'Queues in memory', column: 2, row: 'middle' },
      { id: 'workers', title: 'Workers', detail: 'Poll and run jobs', column: 3, row: 'middle' },
      { id: 'db', title: 'Database', detail: 'Used by many jobs', column: 4, row: 'middle' },
    ],
    edges: [
      ['web', 'redis', 'enqueue'],
      ['redis', 'workers', 'poll'],
      ['workers', 'db'],
      ['web', 'gate', 'POST'],
      ['gate', 'kafka'],
      ['kafka', 'relay'],
      ['consul', 'relay'],
      ['relay', 'redis', 'relay'],
    ],
    stages: [
      {
        title: 'Jobs live in Redis, workers poll',
        narration:
          'The web app builds an ID from the job type and arguments, hashes it to pick a Redis host, and drops the job if an identical one is already queued. Workers poll Redis, move a job to an in-flight list, run it, and send failures to a retry queue.',
        tradeoff:
          'Redis makes enqueue and dequeue fast and simple, and the small dedup check comes for free. The cost is that every queued job sits in memory, so the queue can only be as long as Redis has room for.',
        nodes: ['web', 'redis', 'workers', 'db'],
        travel: [
          ['web', 'redis', 'enqueue'],
          ['redis', 'workers', 'poll'],
          ['workers', 'db'],
        ],
        short: 'Redis queue',
        metrics: peak,
        load: { web: 40, redis: 45, workers: 50, db: 40 },
      },
      {
        title: 'The database slows and the queues grow',
        narration:
          'Contention in the database layer makes jobs run slower. Workers drain the queues more slowly than the web app fills them, and the backlog piles up in Redis memory.',
        tradeoff:
          'Nothing pushes back on the producers: enqueueing still succeeds, so callers cannot tell anything is wrong until memory runs out. A queue with no durable overflow turns a slow dependency into a memory problem.',
        nodes: ['redis', 'workers', 'db'],
        travel: [
          ['web', 'redis', 'enqueue'],
          ['redis', 'workers', 'poll'],
          ['workers', 'db'],
        ],
        short: 'Backlog',
        metrics: { ...peak, alerts: ['requestsPerSecond'] },
        load: { web: 40, redis: 85, workers: 80, db: 98 },
        traffic: [{ edge: ['web', 'redis'], kind: 'heavy' }],
      },
      {
        title: 'Redis is full, in both directions',
        narration:
          'Redis reaches its configured memory limit and rejects new jobs, so everything that enqueues work starts failing. Moving a job into the in-flight list also needs a little memory, so workers cannot take jobs out either, and the queue stays locked after the database has recovered.',
        tradeoff:
          'Keeping the processing list in the same memory as the backlog made the failure self-sustaining. Recovery needed extensive manual work, which is the worst property a shared piece of infrastructure can have.',
        nodes: ['web', 'redis', 'workers'],
        travel: [['web', 'redis', 'enqueue']],
        short: 'Outage',
        metrics: { ...peak, alerts: ['requestsPerSecond'] },
        load: { web: 60, redis: 100, workers: 10, db: 40 },
        traffic: [
          { edge: ['web', 'redis'], kind: 'failed' },
          { edge: ['redis', 'workers'], kind: 'failed' },
        ],
      },
      {
        title: 'Why more of the same would not help',
        narration:
          'The post-mortem found deeper limits. Every client had to connect to, and know about, every Redis host. Adding workers added polling load on Redis, so more capacity could swamp an already overloaded host. Taking a job off a queue cost time in proportion to its length, so long queues got harder to empty.',
        tradeoff:
          'Each limit fed back on itself, so scaling the existing design was ruled out. A full rewrite was also on the table, but it would change scheduling, execution and dedup at once, with every caller depending on the old behavior.',
        nodes: ['web', 'redis', 'workers'],
        travel: [['redis', 'workers', 'poll']],
        short: 'Post-mortem',
        metrics: { ...peak, alerts: ['requestsPerSecond'] },
        load: { web: 40, redis: 90, workers: 60, db: 40 },
        traffic: [{ edge: ['redis', 'workers'], kind: 'heavy' }],
      },
      {
        title: 'Enqueue into Kafka through Kafkagate',
        narration:
          'The smallest change that removes the memory cliff is a durable log in front of Redis, keeping the enqueue and dequeue interfaces as they are. The web app now posts each job to Kafkagate, a small stateless Go service that writes it to Kafka and answers success or failure. Requests prefer a Kafkagate in the same availability zone. The post describes 16 brokers, 32 partitions per topic, three replicas and two days of retention.',
        tradeoff:
          'Kafkagate waits only for the partition leader to acknowledge, which keeps latency low but can lose a job if a broker dies before replicating it. Slack judged that fine for most jobs and considered a stricter option for critical ones.',
        nodes: ['web', 'gate', 'kafka'],
        travel: [
          ['web', 'gate', 'POST'],
          ['gate', 'kafka'],
        ],
        short: 'Kafka in front',
        metrics: peak,
        load: { web: 40, gate: 35, kafka: 30, redis: 50, workers: 50, db: 40 },
      },
      {
        title: 'Relay from Kafka into Redis',
        narration:
          'JQRelay, another stateless Go service, reads a topic and writes its jobs to the matching Redis cluster, where workers pick them up as before. Each instance grabs a Consul lock for a topic before relaying it, so every topic has exactly one relay, and a replacement instance from the auto-scaling group takes over a lost lock. Rate limits also live in Consul and apply as soon as they change.',
        tradeoff:
          'Workers and Redis did not have to change, which kept the rollout safe. The relay decodes and re-encodes each job, and Go and PHP escape JSON characters differently, so payloads that used to round-trip in PHP alone suddenly did not.',
        nodes: ['kafka', 'relay', 'consul', 'redis', 'workers'],
        travel: [
          ['kafka', 'relay'],
          ['consul', 'relay'],
          ['relay', 'redis', 'relay'],
          ['redis', 'workers', 'poll'],
        ],
        short: 'JQRelay',
        metrics: peak,
        load: {
          web: 40,
          gate: 35,
          kafka: 30,
          relay: 30,
          consul: 10,
          redis: 45,
          workers: 50,
          db: 40,
        },
      },
      {
        title: 'Failures stop at the relay',
        narration:
          'The relay commits its Kafka offset only after a job is safely in Redis. If Redis is down it keeps retrying until Redis is back, and a job that fails on its own is written back to Kafka instead of blocking its partition or being dropped.',
        tradeoff:
          'Retrying forever means a Redis problem shows up as lag in Kafka rather than as lost jobs, which is the point. Re-enqueueing a broken job keeps the queue moving but can send the same job around more than once.',
        nodes: ['kafka', 'relay', 'redis'],
        travel: [['relay', 'redis', 'relay']],
        short: 'Retry',
        metrics: peak,
        load: {
          web: 40,
          gate: 35,
          kafka: 40,
          relay: 35,
          consul: 10,
          redis: 60,
          workers: 50,
          db: 40,
        },
        traffic: [{ edge: ['relay', 'redis'], kind: 'failed' }],
      },
      {
        title: 'Break the cluster on purpose first',
        narration:
          'Before production, a load test enqueued jobs at the expected rate of each topic to size the cluster with room for lost brokers and leader changes. Failure tests killed one broker, two brokers in the same zone and all three brokers at once to force an unclean leader election, and restarted the whole cluster. The system behaved as expected in each case.',
        tradeoff:
          'Testing failures up front tells you what callers see when Kafka misbehaves: refused connections, failed enqueues, missing or duplicate jobs. Allowing an unclean leader election favors availability, at the risk of losing some writes.',
        nodes: ['gate', 'kafka'],
        travel: [['gate', 'kafka']],
        short: 'Failure tests',
        metrics: peak,
        load: { gate: 60, kafka: 75, relay: 30, consul: 10, redis: 45, workers: 50, db: 40 },
        traffic: [{ edge: ['gate', 'kafka'], kind: 'heavy' }],
      },
      {
        title: 'Double write, shadow relay, heartbeat canaries',
        narration:
          'Each job went to both Redis and Kafka, while JQRelay read from Kafka and threw the jobs away. Counts were compared at every hop, and a canary job was sent to each of the 1,600 Kafka partitions (50 topics of 32) every minute to watch the path end to end into 50 Redis clusters. Slack used it internally for a few weeks, then moved customers over one job type at a time.',
        tradeoff:
          'Running both paths costs double writes and more moving parts for a while, but real traffic tested the new path with no risk to jobs. Canaries catch a silent stall that a throughput graph would average away.',
        nodes: ['web', 'gate', 'kafka', 'relay', 'redis'],
        travel: [
          ['web', 'redis', 'enqueue'],
          ['web', 'gate', 'POST'],
          ['gate', 'kafka'],
          ['kafka', 'relay'],
        ],
        short: 'Rollout',
        metrics: peak,
        load: {
          web: 45,
          gate: 35,
          kafka: 30,
          relay: 30,
          consul: 10,
          redis: 45,
          workers: 50,
          db: 40,
        },
        traffic: [{ edge: ['kafka', 'relay'], kind: 'health' }],
      },
      {
        title: 'A backlog now waits on disk',
        narration:
          'When workers fall behind again, the web app keeps enqueueing at full speed because jobs land in Kafka, not in Redis memory. Operators lower the relay rate limit to match what workers can drain, or pause relaying to Redis entirely until things recover.',
        tradeoff:
          'The backlog becomes a delay instead of an outage, and the dial is a rate limit rather than a manual cleanup. Kafka is one more cluster to operate, and the rate limit still has to be chosen with Redis memory in mind.',
        nodes: ['web', 'gate', 'kafka', 'relay', 'consul', 'redis'],
        travel: [
          ['web', 'gate', 'POST'],
          ['gate', 'kafka'],
          ['kafka', 'relay'],
          ['consul', 'relay'],
          ['relay', 'redis', 'relay'],
        ],
        short: 'Backlog safe',
        metrics: peak,
        load: {
          web: 40,
          gate: 40,
          kafka: 70,
          relay: 35,
          consul: 10,
          redis: 45,
          workers: 75,
          db: 90,
        },
        traffic: [{ edge: ['web', 'gate'], kind: 'heavy' }],
      },
    ],
  },
  tradeoffs: [
    'Kafkagate waits only for the leader, so a broker that dies before replicating can lose a job; Slack chose availability and lower latency for most jobs.',
    'Redis is still in the path: dedup, scheduling and the polling workers did not change, so slow dequeues and the all-to-all connections remain for later work.',
    'The relay rate limit is set by hand; the post lists tying it to Redis memory as future work.',
    'Two new services and a Kafka cluster add operations, and moving data between brokers at 1.4 billion jobs a day still needed throttling, with partition-level migration left for the future.',
  ],
  takeaways: [
    'Put a durable log in front of an in-memory queue so a backlog grows on disk instead of exhausting memory, and drain it into the fast store at a controlled rate.',
    'Prefer the smallest change that removes the failure mode: keep the existing interfaces and add the buffer in front, rather than rewriting scheduling and execution at once.',
    'Give each partition a single consumer with a lock (Consul here) and advance the offset only after the downstream write succeeds.',
    'Roll out with double writes, a shadow consumer that discards, per-hop counts and heartbeat canaries on every partition before moving real traffic.',
  ],
  related: ['job-scheduler', 'notification-system'],
};
