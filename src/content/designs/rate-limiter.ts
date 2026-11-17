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
      'Scale to millions of requests per second and hundreds of millions of clients.',
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
    'It atomically takes a token from the client bucket in a shared store.',
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
          'The limiter runs a small script in Redis that refills the client bucket based on elapsed time and takes one token, in a single atomic step.',
        tradeoff:
          'A shared store gives one consistent count across every gateway for about a millisecond per request. Counting in each gateway memory would be faster, but each instance would only see its share of the traffic and a client could exceed the limit by the number of instances.',
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
      question: 'How does the store scale to millions of checks per second?',
      options: [
        {
          name: 'One Redis primary',
          pros: 'Simple, strongly consistent, easy to operate.',
          cons: 'One node caps throughput and is a single point of failure.',
        },
        {
          name: 'Redis Cluster, sharded by client key',
          pros: 'Throughput grows with nodes; a client always lands on the same shard, so its count stays exact.',
          cons: 'More nodes to run; a very hot client still lands on a single shard.',
        },
        {
          name: 'Local counters, synced periodically',
          pros: 'No network call in the hot path.',
          cons: 'Approximate: between syncs every gateway is blind to the others.',
        },
      ],
      choice:
        'Shard by client key. Each check touches one key, so sharding is natural and exact. For a few very hot clients, add a small local pre-limit in each gateway.',
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
          pros: 'Refill and take happen in one step, so the count is always correct.',
          cons: 'The logic lives in a script that has to be versioned and tested.',
        },
      ],
      choice:
        'An atomic script. Correctness is the whole point of a limiter, and the script is a few lines.',
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
          cons: 'A client spread across regions can briefly exceed the global limit.',
        },
      ],
      choice:
        'A store per region. A small, bounded overshoot is cheaper than adding cross-region latency to every request.',
    },
  ],
  wrapUp:
    'A token bucket per client in a sharded Redis, checked atomically at the gateway, failing open with a local fallback: accurate where it matters and invisible when it works.',
};
