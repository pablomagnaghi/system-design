import type { FieldNote } from '../types';

export const metaZgateway: FieldNote = {
  slug: 'meta-zgateway',
  company: 'Meta',
  title: 'A proxy tier in front of a key-value store',
  summary:
    'Every ZippyDB client used to connect straight to every database host it needed, and that mesh of connections became a reliability limit. Meta put ZGateway, a stateless regional proxy, in between, and it became the place for batching, admission control, caching and load balancing.',
  minutes: 8,
  source: {
    title: 'ZGateway: Learnings from Putting a Proxy in Front of ZippyDB',
    url: 'https://engineering.fb.com/2026/09/03/core-infra/zgateway-proxy-zippydb-meta/',
    year: 2026,
  },
  context: [
    'ZippyDB is the most widely used key-value store at Meta. It holds product metadata, counters and configuration, and serves billions of operations per second. Its clients run on more than a million hosts owned by hundreds of teams, and those hosts cannot be changed quickly.',
    'In the original design each client opened connections directly to every database host it needed. One client can touch tens of thousands of shards spread over hundreds of thousands of hosts, so a typical client held tens of thousands of outbound connections and a typical database host accepted tens of thousands of inbound ones. Most of them sat idle, yet each cost memory, CPU and a file descriptor on both ends.',
    'Worse, every new group of clients added load to every database host, and each client ran its own pooling and failover. When connection reuse dropped, for example during a deploy, hosts were hit with a storm of new connections. Meta traced host crashes from file descriptor exhaustion and out-of-memory errors to exactly this.',
  ],
  walkthrough: {
    label: 'Move ZippyDB traffic behind a proxy',
    intro:
      'Start with clients connected straight to the database fleet, see the connection mesh fail, then watch the proxy tier and its features join one by one. Metric values are quoted from Meta’s post. The connection counts after the change come from the post’s own model, not a measurement, and the load shedding numbers from one overload test. Load bars are approximate. Press play, or step through the stages.',
    nodes: [
      {
        id: 'clients',
        title: 'Client hosts',
        detail: 'Hundreds of teams',
        column: 0,
        row: 'middle',
      },
      {
        id: 'lib',
        title: 'Thick client',
        detail: 'Pooling, failover per host',
        column: 1,
        row: 'top',
      },
      {
        id: 'router',
        title: 'ServiceRouter',
        detail: 'Sticky regional routes',
        column: 1,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'balancer',
        title: 'Weight balancer',
        detail: 'Weights from CPU',
        column: 1,
        row: 'bottom',
        appearsAt: 8,
      },
      {
        id: 'gateway',
        title: 'ZGateway',
        detail: 'Stateless regional proxy',
        column: 2,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'admission',
        title: 'Load shedding',
        detail: 'One bucket per tenant',
        column: 2,
        row: 'bottom',
        appearsAt: 6,
      },
      {
        id: 'engine',
        title: 'Embedded client',
        detail: 'One per use case',
        column: 3,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'cache',
        title: 'Read cache',
        detail: 'Keys split by hashing',
        column: 3,
        row: 'bottom',
        appearsAt: 7,
      },
      {
        id: 'zservers',
        title: 'ZServer fleet',
        detail: 'Shard replicas',
        column: 4,
        row: 'top',
      },
      {
        id: 'cdc',
        title: 'Change stream',
        detail: 'Writes, checkpoints',
        column: 5,
        row: 'top',
        appearsAt: 7,
      },
    ],
    edges: [
      ['clients', 'lib', 'direct'],
      ['lib', 'zservers', 'mesh'],
      ['clients', 'router', 'thin client'],
      ['router', 'gateway', 'sticky'],
      ['gateway', 'engine'],
      ['engine', 'zservers', 'batched RPCs'],
      ['gateway', 'admission', 'admit'],
      ['gateway', 'cache', 'hot reads'],
      ['zservers', 'cdc', 'changes'],
      ['cdc', 'cache', 'invalidate'],
      ['balancer', 'router', 'weights'],
    ],
    stages: [
      {
        title: 'Clients connect straight to the database',
        narration:
          'Each client host links a thick client library that finds the shard for a key and opens a TLS connection to the database host that holds it. Pooling and failover happen inside that library, on more than a million hosts.',
        tradeoff:
          'Direct access has no extra hop and no extra tier to run, which suited ZippyDB early on. The price is that the database fleet sees every client, and fixing client behavior means waiting for hundreds of teams to deploy.',
        nodes: ['clients', 'lib', 'zservers'],
        travel: [
          ['clients', 'lib'],
          ['lib', 'zservers'],
        ],
        short: 'Direct access',
        metrics: {
          users: '1M+ hosts',
          custom: [
            { label: 'Conns per host (model)', value: 'Tens of thousands' },
            { label: 'Total conns (model)', value: 'Full mesh' },
          ],
        },
        load: { clients: 40, lib: 50, zservers: 55 },
      },
      {
        title: 'The mesh grows with every client',
        narration:
          'A client touches tens of thousands of shards across hundreds of thousands of hosts, so both sides hold tens of thousands of connections, mostly idle. Inbound connections on a database host grow with the number of clients, so every new client group makes every host worse.',
        tradeoff:
          'Keeping connections open avoids handshake cost on each request, but at this scale the idle pool itself is the load: memory, CPU and file descriptors spent on connections that carry almost nothing.',
        nodes: ['lib', 'zservers'],
        travel: [['lib', 'zservers']],
        short: 'Mesh',
        metrics: {
          users: '1M+ hosts',
          custom: [
            { label: 'Conns per host (model)', value: 'Tens of thousands', alert: true },
            { label: 'Total conns (model)', value: 'Full mesh', alert: true },
          ],
        },
        load: { clients: 45, lib: 70, zservers: 85 },
        traffic: [{ edge: ['lib', 'zservers'], kind: 'heavy' }],
      },
      {
        title: 'A reconnection storm',
        narration:
          'When reuse drops, say a group of clients restarts, they all reconnect at once. In one incident a routing bug made every client open a connection per shard; hosts went over their file descriptor limit and the fleet fell into a reboot loop.',
        tradeoff:
          'Client-side fixes are slow because two fleets change on their own schedules: clients keep changing pooling policies while the database fleet consolidates. Nobody owns the whole picture, so nobody can stop a storm in minutes.',
        nodes: ['lib', 'zservers'],
        travel: [['lib', 'zservers']],
        short: 'Storm',
        metrics: {
          users: '1M+ hosts',
          custom: [
            { label: 'Conns per host (model)', value: 'Tens of thousands', alert: true },
            { label: 'Total conns (model)', value: 'Full mesh', alert: true },
          ],
        },
        load: { clients: 50, lib: 90, zservers: 100 },
        traffic: [{ edge: ['lib', 'zservers'], kind: 'failed' }],
      },
      {
        title: 'Put a proxy tier in between',
        narration:
          'ZGateway is a stateless regional tier found through ServiceRouter. A client keeps a sticky pool to nearby gateway hosts, which end TLS, check the use case’s access rules and forward through an embedded copy of the thick client, one per use case. Database hosts now see only gateway hosts, a fleet Meta sizes.',
        tradeoff:
          'Every request pays one more hop, and the post puts the extra compute at about 6% for an average use case. In return, by the post’s own model, connections per host drop by about 97 to 98% and total connections by about 19x.',
        nodes: ['clients', 'router', 'gateway', 'engine', 'zservers'],
        travel: [
          ['clients', 'router'],
          ['router', 'gateway'],
          ['gateway', 'engine'],
          ['engine', 'zservers'],
        ],
        short: 'Proxy tier',
        metrics: {
          users: '1M+ hosts',
          custom: [
            { label: 'Conns per host (model)', value: '~97-98% fewer' },
            { label: 'Total conns (model)', value: '~19x fewer' },
            { label: 'Proxy compute cost', value: '~6%' },
          ],
        },
        load: { clients: 40, lib: 40, router: 35, gateway: 55, engine: 45, zservers: 50 },
      },
      {
        title: 'Move traffic over with flags',
        narration:
          'Routing to the gateway is a client config flag, scoped by service and shard prefix. A percentage knob ramps traffic, a region filter limits the blast radius and a global kill switch sends everything back to direct access. No client code changes.',
        tradeoff:
          'Both paths must work for a long time, which is more to run and test. It buys a migration that is gradual and reversible in real time; the gateway now carries about 40% of all ZippyDB traffic, projected to pass 60%.',
        nodes: ['clients', 'lib', 'router', 'gateway'],
        travel: [
          ['clients', 'lib'],
          ['lib', 'zservers'],
          ['clients', 'router'],
          ['router', 'gateway'],
        ],
        short: 'Ramp by flag',
        metrics: {
          users: '1M+ hosts',
          requestsPerSecond: '1B+ ops',
          custom: [
            { label: 'Conns per host (model)', value: '~97-98% fewer' },
            { label: 'Total conns (model)', value: '~19x fewer' },
            { label: 'Traffic via gateway', value: '~40%' },
          ],
        },
        load: { clients: 40, lib: 30, router: 40, gateway: 55, engine: 45, zservers: 40 },
      },
      {
        title: 'Batch and coalesce across clients',
        narration:
          'A shared batcher on each gateway host groups requests by use case and shard into one backend call. If many callers want the same key at the same moment, it reads once and fans the answer out. A batch flushes on a time window, a size limit or a request cap.',
        tradeoff:
          'Fewer, larger calls cut per-call overhead, backend load and throttling, and the fragile client-side batching libraries could be retired. Held requests use memory, so idle batches are evicted and an in-flight cap rejects work when the backend slows.',
        nodes: ['gateway', 'engine', 'zservers'],
        travel: [
          ['router', 'gateway'],
          ['gateway', 'engine'],
          ['engine', 'zservers'],
        ],
        short: 'Batching',
        metrics: { users: '1M+ hosts', requestsPerSecond: '1B+ ops' },
        load: { router: 40, gateway: 60, engine: 50, zservers: 30 },
        traffic: [
          { edge: ['router', 'gateway'], kind: 'heavy' },
          { edge: ['engine', 'zservers'], kind: 'request' },
        ],
      },
      {
        title: 'Shed only the noisy tenant',
        narration:
          'Each request lands in a bucket keyed by use case and priority, and buckets drain round-robin, so a flooding tenant only fills its own. A CPU controller adjusts the admit rate. In a test at over 90% CPU with about 1,350 tenant buckets, only 6 shed; the rest ran 99.9% of requests with no rejections.',
        tradeoff:
          'Per-tenant isolation needs per-use-case accounting on every request, and the post says the machinery cost about 8% of CPU. Goodput held near 97 to 98% under that overload, instead of everyone slowing down together.',
        nodes: ['gateway', 'admission'],
        travel: [['gateway', 'admission']],
        short: 'Load shedding',
        metrics: {
          users: '1M+ hosts',
          requestsPerSecond: '1B+ ops',
          custom: [
            { label: 'Tenants shed (test)', value: '6 of ~1,350' },
            { label: 'Others served (test)', value: '99.9%, 0 rejected' },
            { label: 'Goodput (overload test)', value: '~97-98%' },
          ],
        },
        load: { gateway: 92, admission: 80, engine: 50, zservers: 35 },
        traffic: [
          { edge: ['router', 'gateway'], kind: 'heavy' },
          { edge: ['gateway', 'admission'], kind: 'failed' },
        ],
      },
      {
        title: 'Serve hot reads from a cache',
        narration:
          'On the cache tier, hot reads come from memory and each host owns a slice of keys by consistent hashing. A miss takes a per-key lock so only one fetch reaches the database. A change stream of writes and checkpoints invalidates or refreshes entries within a stated staleness bound.',
        tradeoff:
          'Reads move off storage and get faster, but the cache is only as fresh as its change stream, so callers accept bounded staleness. Moving weight between cache hosts also moves keys, which makes rebalancing costly.',
        nodes: ['gateway', 'cache', 'zservers', 'cdc'],
        travel: [
          ['gateway', 'cache'],
          ['zservers', 'cdc'],
          ['cdc', 'cache'],
        ],
        short: 'Read cache',
        metrics: { users: '1M+ hosts', requestsPerSecond: '1B+ ops' },
        load: { gateway: 55, cache: 50, zservers: 25, cdc: 30 },
      },
      {
        title: 'Balance unequal hosts by CPU',
        narration:
          'The tier mixes hosts from about 26 to about 126 cores. A control-plane balancer reads each host’s recent CPU, normalizes the tier average to 1.0 and nudges each weight against its load; ServiceRouter routes with those weights. Changes are damped, clamped and limited to the worst hosts per run.',
        tradeoff:
          'Weights stop hot hosts from turning into error spikes, but a loop that reacts too fast shuffles shards and keys for nothing. The guardrails trade reaction speed for stability, and no single fixed policy suits both a calm tier and one in shock, so the balancer is becoming adaptive.',
        nodes: ['balancer', 'router', 'gateway'],
        travel: [
          ['balancer', 'router'],
          ['router', 'gateway'],
        ],
        short: 'Balancing',
        metrics: { users: '1M+ hosts', requestsPerSecond: '1B+ ops' },
        load: { balancer: 30, router: 40, gateway: 50, engine: 45, cache: 45, zservers: 35 },
      },
    ],
  },
  tradeoffs: [
    'Every request takes an extra network hop through a tier that must be run, sized and kept healthy; the post puts the overhead at about 6% for an average use case.',
    'Two access paths coexist during a long migration: the gateway carried about 40% of ZippyDB traffic when the post was written.',
    'Moving client-side state onto the gateway, such as transaction bookkeeping, meant a careful phased rollout of the most correctness-critical code.',
    'Many tenants share one process, so one tenant’s memory blowup can still threaten a host; the post lists splitting the gateway into several processes as future work.',
  ],
  takeaways: [
    'When a huge, varied client fleet talks to a shared backend, a proxy turns an unbounded many-to-many mesh into two bounded hops, and fan-in on the backend stops growing with the client count.',
    'A shared tier is where cross-client work belongs: batching, coalescing duplicate reads, caching and per-tenant admission control.',
    'Migrate onto a new tier with config flags: percentage ramp, region filter and a kill switch, with no client code change.',
    'Isolate tenants by structure (one queue or bucket each) so overload sheds the noisy neighbor instead of everyone.',
  ],
  related: ['distributed-cache', 'rate-limiter'],
};
