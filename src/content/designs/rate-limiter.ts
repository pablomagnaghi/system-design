import type { Design } from '../types';

export const rateLimiter: Design = {
  slug: 'rate-limiter',
  title: 'Distributed rate limiter',
  summary:
    'Cap how many requests each client can make, across a fleet of gateways, without adding noticeable latency or becoming a single point of failure.',
  difficulty: 'Medium',
  minutes: 8,
  requirements: {
    functional: [
      'Limit requests per client, identified by API key, user id or IP address.',
      'Support different rules per endpoint and per plan (for example, 100 requests a minute on the free plan).',
      'Reject requests over the limit with HTTP 429 and tell the client when it can retry.',
      'Apply several rules to one request (for example a plan limit and an endpoint limit) all together: a request either passes every rule or spends nothing.',
      'Change rules without deploying the gateways, with a rollout that can be rolled back.',
    ],
    nonFunctional: [
      'Low overhead: a few milliseconds at most added to each request.',
      'Highly available: the limiter failing must not take the API down.',
      'Accurate across many gateway instances, not just per instance.',
      'Scale to hundreds of thousands of requests per second and about a million clients, and grow by adding nodes.',
      'Hard to cheat: the identity used for a bucket comes from authentication or a trusted proxy, never from a header the client controls, and rules change only through a reviewed, audited rollout.',
    ],
    outOfScope: [
      'Defending against volumetric DDoS, which belongs at the network edge.',
      'Billing, monthly quotas and quota purchases, which need exact durable counts.',
      'Authentication itself: the limiter receives an identity that was already verified.',
      'Concurrency limits (requests in flight at once) and cost-weighted limits, where an expensive request spends more than one token.',
      'Bot and abuse detection that decides who is malicious, as opposed to who is over a limit.',
    ],
  },
  entities: [
    {
      name: 'Rule',
      description:
        'Who it applies to, which endpoints, the refill rate and the burst capacity, with a version number.',
    },
    { name: 'Client', description: 'The identity being limited: API key, user id or IP address.' },
    {
      name: 'Bucket',
      description: 'The live state per client and rule: tokens left and last refill time.',
    },
  ],
  api: [
    {
      method: 'internal',
      path: 'check(clientId, ruleId) → { allowed, remaining, resetAt }',
      description: 'Called by the gateway on every request before it is forwarded.',
    },
    {
      method: 'headers',
      path: 'RateLimit-Limit · RateLimit-Remaining · RateLimit-Reset · Retry-After',
      description:
        'Returned to clients so well-behaved ones can slow down before they are cut off.',
    },
  ],
  dataFlow: [
    'A request reaches the API gateway.',
    'The gateway identifies the client and finds the rules that apply.',
    'It atomically takes a token from the client bucket for each rule, in a shared store.',
    'If a token was available the request goes to the backend, otherwise the client gets a 429.',
  ],
  highLevel: {
    label: 'Run a request through the limiter',
    intro:
      'Start with one client flooding the backend, then watch the limiter, its rules and a shared counter join the gateway, and see what happens when the counter store fails. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      { id: 'client', title: 'Client', detail: 'Request + API key', column: 0, row: 'middle' },
      { id: 'gateway', title: 'API gateway', detail: 'Every request', column: 1, row: 'middle' },
      {
        id: 'rules',
        title: 'Rules',
        detail: 'Cached in memory',
        column: 2,
        row: 'top',
        appearsAt: 3,
      },
      {
        id: 'limiter',
        title: 'Limiter',
        detail: 'Gateway middleware',
        column: 2,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'store',
        title: 'Redis cluster',
        detail: 'Buckets by client',
        column: 3,
        row: 'bottom',
        appearsAt: 4,
      },
      {
        id: 'reject',
        title: '429 response',
        detail: 'With Retry-After',
        column: 3,
        row: 'top',
        appearsAt: 7,
      },
      { id: 'backend', title: 'Backend', detail: 'Only allowed traffic', column: 4, row: 'middle' },
    ],
    edges: [
      ['client', 'gateway'],
      ['gateway', 'limiter'],
      ['rules', 'limiter'],
      ['limiter', 'store'],
      ['limiter', 'reject'],
      ['limiter', 'backend'],
      ['gateway', 'backend'],
    ],
    edgeStages: [{ edge: ['gateway', 'backend'], stages: [0, 1] }],
    stages: [
      {
        title: 'One client floods the backend',
        narration:
          'Before any limit, the gateway forwards everything. One client with a broken retry loop sends thousands of requests a second, the backend runs out of capacity and every other client sees slow pages and errors.',
        tradeoff:
          'Adding backend servers absorbs the spike for a while, but the bill then grows with the worst client instead of real demand, and a bigger loop fills the new servers too. Capping each client at the front door protects everyone else for a fraction of the cost.',
        nodes: ['client', 'gateway', 'backend'],
        travel: [
          ['client', 'gateway'],
          ['gateway', 'backend'],
        ],
        short: 'Flood',
        metrics: {
          users: '1M',
          requestsPerSecond: '150K',
          p95Latency: '2.5 s',
          errorRate: '8%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { gateway: 60, backend: 98 },
      },
      {
        title: 'Identify the client',
        narration:
          'The request arrives with an API key. The gateway picks the most specific identity it has: the API key, then the user id, then the IP address for anonymous traffic.',
        tradeoff:
          'IP addresses are always there but are shared by offices and mobile carriers, so one noisy user can throttle many. API keys are precise but only exist for authenticated traffic. Using the best identity available gets precision where possible and coverage everywhere else.',
        nodes: ['client', 'gateway'],
        travel: [['client', 'gateway']],
        short: 'Identify',
        metrics: {
          users: '1M',
          requestsPerSecond: '150K',
          p95Latency: '2.5 s',
          errorRate: '8%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { gateway: 60, backend: 98 },
      },
      {
        title: 'Limit at the gateway',
        narration:
          'A limiter joins the gateway. The check runs as middleware, so every request passes through it before reaching any service, and the flooding client is cut down to its share. In this first version each gateway counts in its own memory, which is enough to stop the flood but not to enforce an exact limit: with 30 gateways a client spread over all of them gets up to 30 times its limit.',
        tradeoff:
          'At the gateway, one implementation protects every service and nothing downstream has to change. Limiting inside each service would know more about the request but duplicates logic, and a separate limiter service would add a network hop to every request.',
        nodes: ['gateway', 'limiter', 'backend'],
        travel: [
          ['gateway', 'limiter'],
          ['limiter', 'backend'],
        ],
        short: 'Gateway limit',
        metrics: { users: '1M', requestsPerSecond: '150K', p95Latency: '90 ms', errorRate: '0.2%' },
        load: { gateway: 60, limiter: 30, backend: 55 },
      },
      {
        title: 'Load the rules',
        narration:
          'Rules are kept in memory on each gateway and refreshed from a config store every 15 to 45 seconds.',
        tradeoff:
          'Reading rules from memory adds no latency, but a change takes under a minute to reach a gateway. Reading them on every request would always be fresh and would put another dependency in the hot path.',
        nodes: ['rules', 'limiter'],
        travel: [['rules', 'limiter']],
        short: 'Rules',
        metrics: { users: '1M', requestsPerSecond: '150K', p95Latency: '90 ms', errorRate: '0.2%' },
        load: { rules: 5, limiter: 30 },
      },
      {
        title: 'Take a token, atomically',
        narration:
          'The limiter runs a small script in Redis that refills the client bucket based on the time elapsed on the Redis clock and takes one token, in a single atomic step. All the buckets of one client share a hash tag, so every rule that applies is checked in the same call on the same node.',
        tradeoff:
          'A shared store gives one consistent count across every gateway for about a millisecond per request. Counting in each gateway memory would be faster, but each instance would only see its share of the traffic and a client could get up to the limit multiplied by the number of instances. Reading the clock in Redis rather than in each gateway keeps a gateway with a skewed clock from minting extra tokens.',
        nodes: ['limiter', 'store'],
        travel: [['limiter', 'store']],
        short: 'Take token',
        metrics: {
          users: '1M',
          requestsPerSecond: '150K',
          p95Latency: '91 ms',
          errorRate: '0.1%',
          healthy: '6 / 6',
        },
        load: { limiter: 35, store: 40 },
      },
      {
        title: 'Why a token bucket',
        narration:
          'Each client has a bucket that refills at a steady rate and holds a maximum number of tokens. A request spends one token.',
        tradeoff:
          'A fixed window is simplest but lets a client send double the limit around the window boundary. A sliding log is exact but stores every timestamp, and a sliding window counter approximates it with two counters. A leaky bucket queues requests and releases them at a fixed rate, smoothing traffic at the cost of latency. A token bucket needs two numbers per client, answers at once, and allows short, bounded bursts, which matches how real clients behave.',
        nodes: ['store'],
        travel: [],
        short: 'Token bucket',
        metrics: {
          users: '1M',
          requestsPerSecond: '150K',
          p95Latency: '91 ms',
          errorRate: '0.1%',
          healthy: '6 / 6',
        },
        load: { store: 40 },
      },
      {
        title: 'Allowed: forward the request',
        narration:
          'With a token taken, the request goes to the backend. The response carries headers with the limit, what is left and when the bucket refills.',
        tradeoff:
          'Returning the headers on every response costs a few bytes, and lets well-behaved clients pace themselves instead of discovering the limit by hitting it.',
        nodes: ['limiter', 'backend'],
        travel: [['limiter', 'backend']],
        short: 'Allowed',
        metrics: {
          users: '1M',
          requestsPerSecond: '150K',
          p95Latency: '91 ms',
          errorRate: '0.1%',
          healthy: '6 / 6',
        },
        load: { limiter: 35, store: 40, backend: 50 },
      },
      {
        title: 'Over the limit: 429',
        narration:
          'With no token left, the gateway answers 429 Too Many Requests with a Retry-After header, and the backend never sees the request. The gateway also remembers the denial until that time, keyed by client and rule, and answers the matching requests itself, so a client hammering at thousands of requests a second costs the store one call per gateway per retry interval, not thousands a second.',
        tradeoff:
          'Rejecting fast protects the backend but pushes work back to the client. Telling it exactly when to retry, and documenting jittered retries, avoids a crowd of clients retrying at the same instant. The local denied-until cache protects the store: without it, every rejected request is still a script call on one shard, which is how a single abusive client can saturate it.',
        nodes: ['limiter', 'reject'],
        travel: [['limiter', 'reject']],
        short: '429',
        metrics: {
          users: '1M',
          requestsPerSecond: '150K',
          p95Latency: '91 ms',
          errorRate: '0.1%',
          healthy: '6 / 6',
        },
        load: { limiter: 35, reject: 25, backend: 50 },
      },
      {
        title: 'When Redis is down',
        narration:
          'If the store does not answer within a short timeout, the limiter lets the request through, falls back to a per-gateway bucket of a tenth of the plan limit and raises an alarm. A normal client spread over 30 gateways sends each one about a thirtieth of its traffic, so the fallback rarely rejects it; a runaway client is held to at most 3 times its limit across the fleet.',
        tradeoff:
          'Failing open keeps the product available but removes protection for a while. Failing closed protects the backends but turns a cache outage into a full outage. For most APIs, availability wins and the local fallback limits the damage.',
        nodes: ['limiter', 'store', 'backend'],
        travel: [['limiter', 'backend']],
        short: 'Redis down',
        metrics: {
          users: '1M',
          requestsPerSecond: '150K',
          p95Latency: '110 ms',
          errorRate: '0.1%',
          healthy: '0 / 6',
          alerts: ['healthy'],
        },
        load: { limiter: 40, store: 0, backend: 65 },
        traffic: [{ edge: ['limiter', 'store'], kind: 'failed' }],
      },
    ],
  },
  flows: [
    {
      id: 'allowed',
      title: 'An allowed request',
      kind: 'sync',
      summary:
        'Ana’s app calls GET /orders with her API key. The gateway checks her plan and endpoint buckets in one script call, about a millisecond, and forwards the request.',
      runsOn: 'ALB → gateway on ECS Fargate → ElastiCache for Valkey → backend',
      participants: [
        { id: 'app', label: 'Ana’s app', service: 'Client' },
        { id: 'alb', label: 'Load balancer', service: 'ALB + AWS WAF' },
        { id: 'gw', label: 'Gateway + limiter', service: 'ECS Fargate' },
        { id: 'store', label: 'Buckets', service: 'ElastiCache for Valkey' },
        { id: 'api', label: 'Backend', service: 'ECS services' },
      ],
      steps: [
        {
          from: 'app',
          to: 'alb',
          label: 'GET /orders, x-api-key',
          note: 'WAF has already dropped IP floods far above any plan. It counts over minutes, so it is a coarse guard, not the per-plan limit.',
        },
        {
          from: 'alb',
          to: 'gw',
          label: 'forward',
          note: 'The ALB appends the caller’s address to X-Forwarded-For. The gateway trusts only the entry the ALB added, never one the client wrote.',
        },
        {
          from: 'gw',
          to: 'gw',
          label: 'key → client {c42}, plan pro; match rules',
          note: 'The key is checked against a cached key table, and the rules come from the in-memory snapshot. Two rules apply: the plan limit and the endpoint limit.',
        },
        {
          from: 'gw',
          to: 'store',
          label: 'EVALSHA take {c42}:plan {c42}:orders',
          note: 'Both keys carry the hash tag {c42}, so they sit in one slot on one shard. The script reads the Redis clock, refills each bucket, and takes a token from both or from neither.',
        },
        {
          from: 'store',
          to: 'gw',
          label: 'allowed, remaining 57, reset 12 s',
          note: 'One round trip of about a millisecond, with a timeout of a few milliseconds in case the shard is slow.',
          style: 'reply',
        },
        {
          from: 'gw',
          to: 'api',
          label: 'GET /orders',
          note: 'Only admitted traffic reaches the backend.',
        },
        {
          from: 'gw',
          to: 'app',
          label: '200 + RateLimit-Remaining: 57',
          note: 'The headers let a well-behaved client slow down before it hits the limit.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'rejected',
      title: 'A client over its limit',
      kind: 'sync',
      summary:
        'A partner’s broken retry loop sends 3,000 requests a second against a limit of 100 a minute. On each gateway the first denial costs one script call; the rest are answered from that gateway’s memory until the retry time.',
      runsOn: 'Gateway on ECS → ElastiCache once per gateway → local denied-until cache',
      participants: [
        { id: 'bot', label: 'Partner’s script', service: 'Client' },
        { id: 'gw', label: 'Gateway + limiter', service: 'ECS Fargate' },
        { id: 'store', label: 'Buckets', service: 'ElastiCache for Valkey' },
      ],
      steps: [
        {
          from: 'bot',
          to: 'gw',
          label: 'POST /sync (101st this minute)',
          note: 'The identity is the partner’s API key, so the limit follows the key whatever IP addresses the script uses.',
        },
        {
          from: 'gw',
          to: 'store',
          label: 'EVALSHA take {p7}:plan {p7}:sync',
          note: 'The plan bucket is empty, so the script takes nothing from either bucket and returns when the next token arrives.',
        },
        {
          from: 'store',
          to: 'gw',
          label: 'denied, retry in 0.6 s',
          note: 'Nothing was spent: a denied check leaves both buckets unchanged.',
          style: 'reply',
        },
        {
          from: 'gw',
          to: 'gw',
          label: 'remember p7 plan rule denied until +0.6 s',
          note: 'Until then this gateway answers 429 itself. The entry is keyed by client and rule: an empty plan bucket covers every request of the client, an empty endpoint bucket only that endpoint. The cache is per gateway, so each of the 30 gateways pays its own call: about 30 calls per 0.6 s instead of 3,000 a second, which could saturate the shard.',
        },
        {
          from: 'gw',
          to: 'bot',
          label: '429 Too Many Requests, Retry-After: 1',
          note: 'Retry-After takes whole seconds, so 0.6 s is rounded up. The backend never sees the request. The documentation asks clients to retry with jitter so they do not return together.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'fail-open',
      title: 'The store stops answering',
      kind: 'direct',
      summary:
        'A shard stops answering. Checks time out after a few milliseconds, the breaker opens, and requests pass under a per-gateway fallback limit until probes succeed.',
      runsOn: 'Gateway on ECS → ElastiCache (timeout) → local fallback bucket → CloudWatch',
      participants: [
        { id: 'app', label: 'Client', service: 'Client' },
        { id: 'gw', label: 'Gateway + limiter', service: 'ECS Fargate' },
        { id: 'store', label: 'Buckets', service: 'ElastiCache for Valkey' },
        { id: 'cw', label: 'Metrics', service: 'CloudWatch' },
        { id: 'api', label: 'Backend', service: 'ECS services' },
      ],
      steps: [
        {
          from: 'gw',
          to: 'store',
          label: 'EVALSHA … (no reply in 5 ms)',
          note: 'The check is never retried: a retry would double the latency and could spend a second token.',
        },
        {
          from: 'gw',
          to: 'gw',
          label: 'breaker open; take from local fallback bucket',
          note: 'Each gateway allows a tenth of the plan limit. A normal client reaches each gateway with about a thirtieth of its traffic, so it is rarely rejected; a runaway client gets at most 30 × a tenth, 3 times its limit.',
        },
        {
          from: 'gw',
          to: 'api',
          label: 'forward',
          note: 'The API stays up. Backends rely on their own headroom and load shedding while the limiter is degraded.',
        },
        {
          from: 'gw',
          to: 'cw',
          label: 'FailOpen count, BreakerOpen=1',
          note: 'Published as custom metrics from every gateway; the fail-open ratio pages within a minute.',
          style: 'async',
        },
        {
          from: 'gw',
          to: 'store',
          label: 'probe every 2 s',
          note: 'A few probe checks; when they succeed the breaker closes. Buckets refill from elapsed time, capped at capacity, and local counters are dropped.',
        },
      ],
    },
    {
      id: 'rule-change',
      title: 'Change a rule',
      kind: 'async',
      summary:
        'An engineer raises the free plan to 200 requests a minute. The change is validated, rolled out to a few gateways first, and rolled back automatically if the 429 rate jumps.',
      runsOn:
        'Pull request → AWS AppConfig deployment → AppConfig agent on each gateway → CloudWatch alarm',
      participants: [
        { id: 'eng', label: 'Engineer', service: 'Reviewed PR' },
        { id: 'cfg', label: 'Rule config', service: 'AWS AppConfig' },
        { id: 'gw', label: 'Gateways', service: 'ECS + AppConfig agent' },
        { id: 'cw', label: '429 rate per rule', service: 'CloudWatch alarm' },
      ],
      steps: [
        {
          from: 'eng',
          to: 'cfg',
          label: 'new version 48: free = 200/min',
          note: 'Rules are versioned and changed only through a reviewed pull request. A validator rejects a limit of zero or a rule that matches every endpoint.',
        },
        {
          from: 'cfg',
          to: 'gw',
          label: 'deploy to 10% of gateways, then the rest',
          note: 'Each gateway’s agent polls every 15 to 45 seconds and swaps its in-memory snapshot, so a gateway picks up its step in under a minute. Old and new versions run side by side during the rollout.',
          style: 'async',
        },
        {
          from: 'gw',
          to: 'cw',
          label: '429s per rule, snapshot version',
          note: 'The deployment watches the alarm on the 429 rate per rule against its baseline.',
          style: 'async',
        },
        {
          from: 'cw',
          to: 'cfg',
          label: 'alarm → roll back to version 47',
          note: 'Only if the alarm fires. Buckets need no cleanup: a changed limit applies from the next refill.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'rebalance',
      title: 'Rebalance regional shares',
      kind: 'scheduled',
      summary:
        'Only once the API runs in several regions. A customer’s traffic moves from Virginia to Frankfurt. Every minute a rebalancer moves the share of its global limit toward the region where its requests now arrive.',
      runsOn:
        'EventBridge Scheduler → Lambda rebalancer → DynamoDB global table → gateways in each region',
      participants: [
        { id: 'sched', label: 'Scheduler', service: 'EventBridge Scheduler' },
        { id: 'reb', label: 'Rebalancer', service: 'Lambda' },
        { id: 'shares', label: 'Client shares', service: 'DynamoDB global table' },
        { id: 'gw', label: 'Gateways', service: 'ECS, every region' },
      ],
      steps: [
        {
          from: 'sched',
          to: 'reb',
          label: 'every minute',
          note: 'Once a minute is the most EventBridge Scheduler offers, and shares do not need to move faster.',
          style: 'async',
        },
        {
          from: 'reb',
          to: 'reb',
          label: 'admitted and denied per region, clients near their limit',
          note: 'Only the few thousand clients close to their global limit need a share other than the default split.',
        },
        {
          from: 'reb',
          to: 'shares',
          label: 'c42: us-east-1 20%, eu-central-1 80%',
          note: 'The global table replicates the new shares to every region within about a second.',
        },
        {
          from: 'gw',
          to: 'shares',
          label: 'refresh overrides every few seconds',
          note: 'Gateways pass the region’s share as the bucket’s rate and capacity to the script. Buckets keep their tokens, capped at the new capacity, and refill at the new rate.',
        },
      ],
    },
  ],
  deepDives: [
    {
      question:
        'How does the store scale to hundreds of thousands of checks per second and beyond?',
      options: [
        {
          name: 'One Redis primary',
          pros: 'Simple, strongly consistent, easy to operate.',
          cons: 'One node caps throughput and is a single point of failure.',
        },
        {
          name: 'Redis Cluster, sharded by client key',
          pros: 'Throughput grows with nodes; a client always lands on the same shard, so one node holds its whole count.',
          cons: 'More nodes to run; a very hot client still lands on a single shard.',
        },
        {
          name: 'Local counters, synced periodically',
          pros: 'No network call in the hot path.',
          cons: 'Approximate: between syncs every gateway is blind to the others.',
        },
      ],
      choice:
        'Shard by client key. A hash tag on the client id keeps every bucket of a client in one slot, so a check with several rules still runs as one script on one node. The count is exact while that primary stays up; replication is asynchronous, so a failover can lose the latest decrements and briefly allow extra requests. For a few very hot clients, add a small local pre-limit in each gateway.',
    },
    {
      question: 'How do concurrent requests avoid double-spending a token?',
      options: [
        {
          name: 'Read, then write',
          pros: 'Easy to write.',
          cons: 'Two gateways can read the same value and both allow the request.',
        },
        {
          name: 'Atomic script in the store',
          pros: 'Refill and take happen in one step on one node, so two requests can never spend the same token.',
          cons: 'The logic lives in a script that has to be versioned and tested.',
        },
      ],
      choice:
        'An atomic script. Correctness is the whole point of a limiter, and the script is a few lines. It reads the time from Redis, not from the gateway, and never lets elapsed time go negative.',
    },
    {
      question: 'What changes when the API runs in several regions?',
      options: [
        {
          name: 'One global store',
          pros: 'One exact count worldwide.',
          cons: 'Every request pays cross-region latency.',
        },
        {
          name: 'A store per region, with the limit split between regions',
          pros: 'Fast, and each region keeps working on its own.',
          cons: 'A client concentrated in one region is capped at that region’s share, below its global limit, unless shares are rebalanced.',
        },
      ],
      choice:
        'The walkthrough runs in one region. Once the API is in several, a store per region. Each region enforces its share locally and shares are rebalanced toward where a client’s traffic is; a client briefly capped below its global limit is cheaper than adding cross-region latency to every request.',
    },
    {
      question: 'Which algorithm counts the requests?',
      options: [
        {
          name: 'Fixed window counter',
          pros: 'One counter per client and window; trivial to write.',
          cons: 'A client can send the full limit at the end of one window and again at the start of the next, double the limit in a moment.',
        },
        {
          name: 'Sliding window log',
          pros: 'Exact over any window.',
          cons: 'Stores a timestamp per request, so memory grows with the limit.',
        },
        {
          name: 'Sliding window counter',
          pros: 'Two counters per client, smooths the boundary by weighting the previous window.',
          cons: 'An approximation that assumes requests were spread evenly in the previous window.',
        },
        {
          name: 'Leaky bucket',
          pros: 'Requests queue and leave at a fixed rate, so the backend sees a perfectly smooth flow.',
          cons: 'A burst waits in the queue instead of being served or rejected, which adds latency, and the queue is state to hold per client.',
        },
        {
          name: 'Token bucket',
          pros: 'Two numbers per client, a steady rate plus a bounded burst, and refill is computed from elapsed time.',
          cons: 'Burst size is one more setting to explain to customers.',
        },
      ],
      choice:
        'A token bucket. It allows the short bursts real clients make, bounds them by capacity, answers at once instead of queueing like a leaky bucket, and needs no background job to refill. A leaky bucket fits when the goal is shaping output to a fixed rate, such as calls to a partner API. A sliding window log is kept for low-volume, high-value limits such as login attempts.',
    },
    {
      question: 'Which identity do we limit, and can a client cheat?',
      options: [
        {
          name: 'The IP address from X-Forwarded-For',
          pros: 'Present on every request.',
          cons: 'A client can write any value into the header, and real users share addresses behind offices and carriers.',
        },
        {
          name: 'The API key or user id after authentication',
          pros: 'Precise and impossible to forge without the secret.',
          cons: 'Anonymous traffic has none, and someone can create many free accounts.',
        },
        {
          name: 'Best identity available, from trusted sources only',
          pros: 'Precision for authenticated traffic and coverage for the rest.',
          cons: 'Several rules per request and some care with proxies.',
        },
      ],
      choice:
        'The best identity available, taken only from trusted places: the key or user id after authentication, otherwise the address the ALB appended (the rightmost entry of X-Forwarded-For), with IPv6 grouped by /64 so one host cannot rotate through addresses. Creating keys and accounts has its own limits, so a client cannot multiply its quota by signing up again.',
    },
    {
      question: 'Build it, or use what AWS offers?',
      options: [
        {
          name: 'API Gateway usage plans',
          pros: 'Per-key throttling and quotas configured, not coded.',
          cons: 'AWS documents them as best effort, not hard limits; a regional account limit of 10,000 requests a second applies by default; and it means moving the API to API Gateway.',
        },
        {
          name: 'AWS WAF rate-based rules',
          pros: 'Drops floods at the edge before they cost anything.',
          cons: 'Counts over minutes and reacts with a delay; meant for abuse by IP or header, not per-plan limits per second.',
        },
        {
          name: 'Our own limiter on ElastiCache',
          pros: 'Exact per-plan and per-endpoint rules, our headers, and control over failure behavior.',
          cons: 'Code and a cache cluster to run.',
        },
      ],
      choice:
        'Both layers: WAF rate-based rules as a coarse guard against floods by IP, and our own limiter for the product limits customers see. For an API already on API Gateway with loose limits, usage plans are the cheaper answer.',
    },
  ],
  wrapUp:
    'A token bucket per client in a sharded Redis, checked atomically at the gateway, failing open with a local fallback: accurate where it matters and invisible when it works.',
  guarantees: {
    provides: [
      {
        property: 'Limit enforcement',
        promise:
          'Within one region, and while the shard primary stays up, a client is admitted at most capacity + rate × t requests in any interval of length t, counted across every gateway. The mechanism is one refill-and-take script per check, run by a single-threaded primary.',
      },
      {
        property: 'Atomicity across rules',
        promise:
          'A request that falls under several rules takes a token from all of their buckets or from none. The buckets of a client share a hash tag, so they live in one slot and one script call checks them together.',
      },
      {
        property: 'Check semantics',
        promise:
          'A check runs at most once per request. The limiter never retries a check that timed out; it fails open instead, so a lost reply costs the client one token at worst and never blocks the request on the store.',
      },
      {
        property: 'Availability',
        promise:
          'The limiter cannot take the API down. Every store call has a timeout of a few milliseconds and a circuit breaker; when the store does not answer, requests pass under a per-gateway fallback limit.',
      },
      {
        property: 'Isolation between clients',
        promise:
          'One client spending its tokens never reduces what another client is allowed, because each client and rule has its own bucket and there is no shared counter between clients.',
      },
    ],
    assumes: [
      'The identity is trustworthy: an API key or user id that was authenticated before the check. An IP address is a weaker identity, shared by many users.',
      'Every bucket of a client maps to the same hash slot, and the script reads the time from the Redis node, never from the gateway.',
      'A token bucket is soft state. A full bucket is a safe value to restart from, so nothing is persisted or replicated synchronously.',
      'Backends keep some headroom and their own load shedding, because the limiter fails open.',
      'Gateways hold a rule snapshot that is under a minute old.',
    ],
    doesNotGuarantee: [
      'An exact count through a failover. Replication is asynchronous, so a promoted replica can miss the latest decrements; each client gains at most one bucket capacity per failover.',
      'Any shared limit while the store is unreachable. The fallback counts per gateway, so a client spread over the fleet can get up to the fallback limit multiplied by the number of gateways: with 30 gateways and a fallback of a tenth, 3 times its limit.',
      'One exact global limit across regions. Each region enforces its share, so a client can be capped below its global limit until shares are rebalanced.',
      'That a rule change applies at once. It reaches each gateway within the refresh interval, under a minute, and every gateway only when the staged rollout completes.',
      'Queueing or ordering of rejected requests. A 429 is final for that request and the client decides when to retry.',
    ],
  },
  failures: [
    {
      scenario: 'A shard primary crashes and its replica is promoted.',
      impact:
        'Until the promotion finishes, seconds later, checks for that third of the clients time out and fail open under the per-gateway fallback. The new primary may miss the last decrements, so some of those clients can spend up to one extra bucket capacity.',
      detection:
        'A cluster failover event, the replication offset gap at promotion, and a jump in the check timeout rate for one shard.',
      recovery:
        'The breaker closes once the new primary answers. Buckets continue from the replicated state; the script clamps a negative elapsed time to zero if the new node’s clock is behind. A new replica is added and synced. Nothing is repaired: the error is bounded and expires as buckets refill.',
    },
    {
      scenario:
        'The whole store is unreachable from the gateways (network partition or cluster outage).',
      impact:
        'No shared count. Every gateway enforces the fallback limit on its own, so a client can get up to the fallback limit times the number of gateways. Latency rises by the timeout until the breaker opens, then returns to normal.',
      detection:
        'An alarm on the fail-open ratio (checks answered by the fallback over all checks) and on the breaker state per gateway. Backend load is watched at the same time.',
      recovery:
        'The breaker sends a few probe checks; when they succeed, traffic returns to the store. Buckets that outlived the outage refill from elapsed time and are capped at capacity; expired ones start full. Local fallback counters are dropped.',
    },
    {
      scenario:
        'The script takes a token but the reply is lost, or the gateway crashes before forwarding the request.',
      impact:
        'One token is spent for a request that the limiter did not count as allowed. A lost reply still passes through the fallback; after a gateway crash the client retries and pays a second token. The limit errs on the strict side by one request.',
      detection:
        'Not detected per request. The check timeout rate and gateway restarts show how often it can happen.',
      recovery:
        'No refund logic. The bucket refills the token within one refill period, which is cheaper and safer than a compensating write that could itself be duplicated.',
    },
    {
      scenario: 'One client floods far above its limit and overloads its shard.',
      impact:
        'Every rejected request still costs a script call. The shard primary runs out of CPU, checks for the other clients on that shard slow down, time out and fail open.',
      detection:
        'CPU and operations per second per shard, p99 check latency per shard, and the share of 429s by client.',
      recovery:
        'When a check is denied, the gateway remembers the client and rule as denied until the reset time and answers 429 locally without calling the store, so the flood costs one call per gateway per retry interval. The local pre-limit caps what any one client can send to the store. The shard returns to normal load; the bucket state was never wrong.',
    },
    {
      scenario:
        'The config store is down, or a wrong rule is published (for example a limit ten times too low, which the validator cannot tell from an intended one).',
      impact:
        'With the config store down, gateways keep enforcing the last snapshot and rule changes do not apply. With a wrong rule, legitimate clients get 429s on the first 10% of gateways, within a minute of that step, until the alarm rolls the deployment back; on every gateway only if the rule gets past that first step.',
      detection:
        'The age of the rule snapshot per gateway, and an alarm on the 429 rate per rule compared with its baseline.',
      recovery:
        'Rules are versioned: the Bad rule alarm rolls the deployment back to the previous version, or an engineer deploys it if the rollout had already finished, and gateways pick it up on the next refresh. Buckets need no cleanup, since a larger limit simply refills them. Validating rules and rolling them out to a few gateways first keeps the damage small.',
    },
    {
      scenario:
        'With the API in several regions, one region fails and its traffic moves to another.',
      impact:
        'Clients arrive in a region where their share of the limit is small, so they are capped below their global limit and see 429s they do not deserve.',
      detection:
        'The 429 rate per region and client next to the regional health signal, and the gap between a client’s global limit and its admitted rate.',
      recovery:
        'The rebalancer moves the failed region’s shares to the regions now receiving the traffic. Buckets there keep their tokens and refill at the new, larger rate. When the region returns, shares move back over a few refresh cycles.',
    },
  ],
  capacity: {
    assumptions: [
      '1M active clients and a peak of 150K requests per second, as in the walkthrough; the daily average is about a third of the peak.',
      'Two rules apply to a typical request (a plan limit and an endpoint limit), checked in one script call.',
      'A bucket costs about 200 bytes in Redis: the key, two numbers, a TTL and per-key overhead.',
      'One primary is budgeted at 50K script calls per second, about half of what a single thread can do, to leave room for failover and spikes.',
      'A gateway instance handles about 5K requests per second.',
    ],
    estimates: [
      {
        label: 'Checks',
        value: '150K/s peak, ~4.3B a day',
        math: '150K/s peak ÷ 3 = 50K/s average; 50K × 86,400 s ≈ 4.3B checks a day. One script call per request.',
      },
      {
        label: 'Read/write ratio',
        value: 'All writes',
        math: 'Every check reads and updates the bucket in one step, so 150K checks/s = 150K writes/s. Replicas serve no traffic.',
      },
      {
        label: 'Bucket memory',
        value: '~400 MB',
        math: '1M clients × 2 buckets × 200 B = 400 MB in total, about 130 MB per primary. Idle buckets expire after a full refill time.',
      },
      {
        label: 'Store nodes',
        value: '3 primaries + 3 replicas',
        math: '150K calls/s ÷ 50K per primary = 3 primaries; one replica each for failover = 6 nodes, the 6 / 6 in the walkthrough.',
      },
      {
        label: 'Gateway fleet',
        value: '~30 instances',
        math: '150K requests/s ÷ 5K per instance = 30 gateways, each with a small connection pool to every primary.',
      },
      {
        label: 'Worst case while failing open',
        value: 'Up to 3× the plan limit',
        math: '30 gateways × a fallback of a tenth of the plan limit = 3× the limit, for a client spread evenly over the fleet. Counting only in gateway memory at the full limit would allow 30×.',
      },
    ],
    implications: [
      'Memory is trivial and CPU is not: the data fits in one small node, so the store is sharded for write throughput, not for size.',
      'Every check is a write, so read replicas add no capacity. Replicas exist only for failover, and scaling means more primaries.',
      'A round trip per request is affordable at 150K/s only if it stays near 1 ms: the store sits in the same region as the gateways and connections are pooled.',
      'Thirty gateways make local-only counting 30 times too loose, which is why the count is shared, and why the fallback is treated as damage control, not as a limit.',
      'With a third of the clients per primary, a failover is a partial event: two thirds of the traffic keeps an exact count.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one region across three Availability Zones. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Edge',
        service: 'AWS WAF rate-based rules on the Application Load Balancer; AWS Shield Standard',
        why: 'Volumetric floods and abusive IP addresses are dropped before they reach a gateway, so the limiter only deals with real clients.',
        watch: 'WAF BlockedRequests per rule, and ALB RequestCount against gateway requests.',
      },
      {
        part: 'API gateway and limiter',
        service: 'About 30 gateway tasks on Amazon ECS on AWS Fargate behind the ALB',
        why: 'The check runs as middleware in the process that already handles every request, so no extra hop; tasks scale on request count.',
        watch:
          'Custom metrics per gateway: check latency p99, allowed and denied counts, fail-open count and breaker state.',
      },
      {
        part: 'Bucket store',
        service:
          'Amazon ElastiCache for Valkey (Redis-compatible), cluster mode, 3 shards of cache.r7g.large with one replica each in another zone',
        why: 'Atomic scripts, a single-threaded primary per shard, keys spread over 16,384 hash slots, and automatic failover to the replica. Memory is tiny; the shards exist for CPU.',
        watch:
          'EngineCPUUtilization per shard (the main thread, not the host CPU), CurrConnections, ReplicationLag, and the failover event.',
      },
      {
        part: 'Rules',
        service:
          'AWS AppConfig with a validator, a gradual deployment strategy and an alarm for rollback',
        why: 'Versioned rules rolled out to a few gateways first and rolled back automatically, read from memory through the AppConfig agent.',
        watch: 'Deployment state, and the snapshot version and age reported by each gateway.',
      },
      {
        part: 'API keys',
        service: 'Amazon DynamoDB table of keys, cached in each gateway',
        why: 'Maps a key to a client and plan without a lookup per request; revocation reaches gateways when the cache expires.',
        watch: 'ThrottledRequests, and the gateway cache hit rate.',
      },
      {
        part: 'Regional shares (only with several regions)',
        service:
          'Amazon DynamoDB global table, updated by an AWS Lambda rebalancer on EventBridge Scheduler',
        why: 'Overrides for the few clients near their global limit, replicated to every region within about a second.',
        watch:
          'ReplicationLatency on the global table, Lambda Errors, and the share given to each region.',
      },
      {
        part: 'Security',
        service: 'IAM roles per service, AWS KMS, AWS CloudTrail, TLS to ElastiCache',
        why: 'Only gateways reach the cache, with in-transit encryption and an auth token; KMS keys encrypt the API key table and the cache at rest; rule deployments and key changes are logged.',
        watch: 'CloudTrail events for AppConfig deployments and key changes.',
      },
      {
        part: 'Observability and cost',
        service: 'Amazon CloudWatch embedded metrics, dashboards and alarms; AWS Cost Explorer',
        why: 'One dashboard with the SLOs. The cost is three small cache shards and a little gateway CPU, tiny next to the backend capacity it protects.',
        watch: 'The SLO dashboard, and the 429 share per client and per rule.',
      },
    ],
    limits: [
      'ElastiCache cluster mode spreads keys over 16,384 hash slots; a hash tag such as {c42} pins all of a client’s buckets to one slot, which multi-key scripts require.',
      'A script blocks its shard while it runs, so it stays a few lines with no loops over many keys.',
      'Replication to the replica is asynchronous, which is why a failover can lose the last decrements.',
      'A node accepts up to 65,000 client connections, far above 30 gateways with a small pool each.',
      'API Gateway usage plans are best effort, and the account-level throttle is 10,000 requests a second per region by default.',
      'WAF rate-based rules count over a window of minutes and take time to start blocking, so they cannot enforce a limit per second.',
      'EventBridge Scheduler runs at most once a minute, the pace of the share rebalancer.',
      'The AppConfig agent polls every 45 seconds by default and AppConfig allows no less than 15 seconds between polls, so a rule change reaches a gateway in under a minute, never at once.',
    ],
  },
  slos: [
    {
      objective: 'Overhead',
      target: '99% of checks under 2 ms',
      measure: 'Check latency measured in the gateway around the script call.',
    },
    {
      objective: 'Shared counting',
      target: '99.9% of checks answered by the store, not the fallback',
      measure: 'Fail-open count over all checks, per gateway and in total.',
    },
    {
      objective: 'Accuracy',
      target: 'Admitted rate per client within 1% of its limit outside failovers',
      measure: 'Admitted requests per client and rule from gateway logs, compared with the rule.',
    },
    {
      objective: 'Rule changes',
      target: '99% of gateways on a new rule version within 60 s of full rollout',
      measure: 'Snapshot version reported by each gateway.',
    },
  ],
  alarms: [
    {
      name: 'Failing open',
      metric: 'Custom: fail-open checks above 1% for 1 min (page), or above 0.1% for 1 h (ticket)',
      meaning:
        'Clients are only under the per-gateway fallback; check the store before a runaway client reaches the backends. The slower threshold catches a small leak that is burning the 99.9% SLO without an outage.',
    },
    {
      name: 'Shard CPU',
      metric: 'ElastiCache EngineCPUUtilization above 70% on any shard',
      meaning:
        'The first bottleneck: a hot client or growth. Check the denied-until cache, then add a shard.',
    },
    {
      name: 'Slow checks',
      metric: 'Custom: check latency p99 above 2 ms for 5 min',
      meaning:
        'The Overhead SLO is being missed: the store is saturated or far away, and every request is paying for it. The threshold sits below the 5 ms timeout, which caps what a check can take.',
    },
    {
      name: 'Bad rule',
      metric: 'Custom: 429 rate for a rule above 3 times its baseline for 2 min',
      meaning: 'A wrong rule or a real attack; the AppConfig rollout rolls back on this alarm.',
    },
    {
      name: 'Stale rules',
      metric: 'Custom: rule snapshot older than 5 min on any gateway',
      meaning: 'The gateway lost its config source and is enforcing old limits.',
    },
    {
      name: 'Limits too loose',
      metric: 'Backend 5XX or saturation rising while the 429 rate stays flat',
      meaning:
        'The limiter is admitting more than the backends can take; the limits or the fallback need tightening.',
    },
  ],
  evolution: {
    mvp: 'One Redis primary with a replica, the same atomic token bucket script, rules in a config file shipped with the gateway, one region, fail open. At around 15K requests per second a single primary has plenty of room, and there is nothing to shard or rebalance.',
    atScale: [
      'At 10x (the 150K/s of the walkthrough): one thread is no longer enough, so the store becomes a cluster sharded by client with a hash tag per client. Rules move to a config store with versioned snapshots, and the per-gateway fallback, the local pre-limit and the denied-until cache for hot clients are added.',
      'At 100x (millions of checks per second): the round trip per request becomes the main cost. Gateways lease tokens in batches for busy clients and spend them locally, so the store sees one call per lease. Accuracy drops by at most one unused lease per gateway.',
      'Independently of volume, when the API itself runs in several regions for latency or regional failover, each region gets its own store, the global limit is split into regional shares, and a rebalancer moves shares toward where each client’s traffic arrives, as in the regions deep dive.',
    ],
    firstBottleneck:
      'The CPU of a shard primary. Script execution is single threaded, every check is a write, and replicas cannot take any of it. A single hot client makes it worse, because all its checks land on one shard no matter how many shards there are. Memory, storage and the gateways all have a lot of room left when this happens.',
    avoided: [
      'Synchronous replication or a consensus store for the buckets. It would remove the failover error at the price of latency on every check and less availability. Worth it only when a limit is a hard quota that costs money, and then it belongs in a metering system, not in the limiter.',
      'A sliding window log. It is exact at the window edge but stores one entry per request. Worth it for low-volume, high-value limits such as login attempts.',
      'A separate limiter service. It adds a hop and a fleet to run. Worth it when several gateway stacks in different languages need the same logic, or when token leasing needs a central place to live.',
      'Refunding tokens for requests that failed downstream. It needs compensating writes that can be lost or duplicated. Worth it only when clients pay per request.',
      'One global count across regions. Split shares are good enough until customers contract a precise global quota; then count asynchronously across regions and accept a short lag.',
    ],
  },
};
