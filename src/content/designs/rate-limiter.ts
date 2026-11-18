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
    ],
    nonFunctional: [
      'Low overhead: a few milliseconds at most added to each request.',
      'Highly available: the limiter failing must not take the API down.',
      'Accurate across many gateway instances, not just per instance.',
      'Scale to hundreds of thousands of requests per second and millions of clients, and grow by adding nodes.',
    ],
    outOfScope: [
      'Defending against volumetric DDoS, which belongs at the network edge.',
      'Billing and quota purchases.',
    ],
  },
  entities: [
    { name: 'Rule', description: 'Who it applies to, which endpoints, the limit and the window.' },
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
    ],
    stages: [
      {
        title: 'One client floods the backend',
        narration:
          'Before any limit, the gateway forwards everything. One client with a broken retry loop sends thousands of requests a second, the backend runs out of capacity and every other client sees slow pages and errors.',
        tradeoff:
          'Adding backend servers absorbs the spike for a while, but the bill then grows with the worst client instead of real demand, and a bigger loop fills the new servers too. Capping each client at the front door protects everyone else for a fraction of the cost.',
        nodes: ['client', 'gateway', 'backend'],
        travel: [['client', 'gateway']],
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
          'A limiter joins the gateway. The check runs as middleware, so every request passes through it before reaching any service, and the flooding client is cut down to its share.',
        tradeoff:
          'At the gateway, one implementation protects every service and nothing downstream has to change. Limiting inside each service would know more about the request but duplicates logic, and a separate limiter service would add a network hop to every request.',
        nodes: ['gateway', 'limiter'],
        travel: [['gateway', 'limiter']],
        short: 'Gateway limit',
        metrics: { users: '1M', requestsPerSecond: '150K', p95Latency: '90 ms', errorRate: '0.2%' },
        load: { gateway: 60, limiter: 30, backend: 55 },
      },
      {
        title: 'Load the rules',
        narration:
          'Rules are kept in memory on each gateway and refreshed from a config store every few seconds.',
        tradeoff:
          'Reading rules from memory adds no latency, but a change takes a few seconds to reach every gateway. Reading them on every request would always be fresh and would put another dependency in the hot path.',
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
          'A fixed window is simplest but lets a client send double the limit around the window boundary. A sliding log is exact but stores every timestamp. A token bucket needs two numbers per client and allows short, bounded bursts, which matches how real clients behave.',
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
          'With no token left, the gateway answers 429 Too Many Requests with a Retry-After header, and the backend never sees the request.',
        tradeoff:
          'Rejecting fast protects the backend but pushes work back to the client. Telling it exactly when to retry, and documenting jittered retries, avoids a crowd of clients retrying at the same instant.',
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
          'If the store does not answer within a short timeout, the limiter lets the request through, falls back to a generous per-gateway limit and raises an alarm.',
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
      question: 'What about multiple regions?',
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
        'A store per region. Each region enforces its share locally and shares are rebalanced toward where a client’s traffic is; a client briefly capped below its global limit is cheaper than adding cross-region latency to every request.',
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
          'A check runs at most once per request. The limiter never retries a check that timed out; it fails open instead, so a lost reply costs the client one token at worst and never blocks the request.',
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
      'Gateways hold a rule snapshot that is at most a few seconds old.',
    ],
    doesNotGuarantee: [
      'An exact count through a failover. Replication is asynchronous, so a promoted replica can miss the latest decrements; each client gains at most one bucket capacity per failover.',
      'Any shared limit while the store is unreachable. The fallback counts per gateway, so a client spread over the fleet can get up to the fallback limit multiplied by the number of gateways.',
      'One exact global limit across regions. Each region enforces its share, so a client can be capped below its global limit until shares are rebalanced.',
      'That a rule change applies at once. It reaches every gateway within the refresh interval, a few seconds.',
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
        'When a check is denied, the gateway remembers the client as denied until the reset time and answers 429 locally without calling the store. The local pre-limit caps what any one client can send to the store. The shard returns to normal load; the bucket state was never wrong.',
    },
    {
      scenario:
        'The config store is down, or a wrong rule is published (for example a limit of zero).',
      impact:
        'With the config store down, gateways keep enforcing the last snapshot and rule changes do not apply. With a wrong rule, legitimate clients get 429s within seconds, on every gateway.',
      detection:
        'The age of the rule snapshot per gateway, and an alarm on the 429 rate per rule compared with its baseline.',
      recovery:
        'Rules are versioned, so the fix is to publish the previous version; gateways pick it up on the next refresh. Buckets need no cleanup, since a larger limit simply refills them. Validating rules and rolling them out to a few gateways first keeps this rare.',
    },
    {
      scenario: 'A region fails and its traffic moves to another region.',
      impact:
        'Clients arrive in a region where their share of the limit is small, so they are capped below their global limit and see 429s they do not deserve.',
      detection:
        'The 429 rate per region and client next to the regional health signal, and the gap between a client’s global limit and its admitted rate.',
      recovery:
        'The rebalancer moves the failed region’s shares to the regions now receiving the traffic. Buckets there start from the new share. When the region returns, shares move back over a few refresh cycles.',
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
        value: 'Up to 30× the fallback limit',
        math: '30 gateways × one local fallback bucket each, for a client spread evenly over the fleet. With counters only in gateway memory this would be the normal case.',
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
  evolution: {
    mvp: 'One Redis primary with a replica, the same atomic token bucket script, rules in a config file shipped with the gateway, one region, fail open. At around 15K requests per second a single primary has plenty of room, and there is nothing to shard or rebalance.',
    atScale: [
      'At 10x (the 150K/s of the walkthrough): one thread is no longer enough, so the store becomes a cluster sharded by client with a hash tag per client. Rules move to a config store with versioned snapshots, and the per-gateway fallback and the local pre-limit for hot clients are added.',
      'At 100x (millions of checks per second): the round trip per request becomes the main cost. Gateways lease tokens in batches for busy clients and spend them locally, so the store sees one call per lease. Accuracy drops by at most one unused lease per gateway. Regions get their own stores with split limits.',
      'At that size, rejected traffic is answered from a local denied-until cache, so abusive clients cost the store almost nothing.',
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
