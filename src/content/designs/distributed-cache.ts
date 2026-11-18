import type { Design } from '../types';

export const distributedCache: Design = {
  slug: 'distributed-cache',
  title: 'Distributed cache',
  summary:
    'Put a shared, in-memory cache in front of a database so reads take a millisecond instead of tens, without serving data that stays wrong, melting the database on a miss storm or losing everything when a node dies.',
  minutes: 9,
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Get, set and delete values by key, with an optional time to live.',
      'Serve reads for many application servers from one logical cache.',
      'Keep cached data close to the database: changes show up quickly.',
    ],
    nonFunctional: [
      'Cache hits in about a millisecond, and a few milliseconds at the 95th percentile with misses included, at tens of thousands of reads per second.',
      'Scale out by adding nodes, moving as few keys as possible.',
      'Stay available when a node fails, and never let a miss storm take the database down.',
      'Bounded staleness: seconds in the normal case, and never longer than the TTL of an entry.',
    ],
    outOfScope: [
      'Using the cache as the system of record: the database stays the source of truth.',
      'Cross-region replication.',
    ],
  },
  entities: [
    { name: 'Entry', description: 'Key, value, expiry and a version or timestamp.' },
    {
      name: 'Shard',
      description: 'A primary node and its replicas, owning part of the key space.',
    },
    {
      name: 'Hash ring',
      description: 'The map from keys to shards, with virtual nodes for balance.',
    },
  ],
  api: [
    {
      method: 'internal',
      path: 'get(key) → value | miss',
      description: 'Used by the application on every read, before the database.',
    },
    {
      method: 'internal',
      path: 'set(key, value, ttl) · delete(key)',
      description: 'Set after loading from the database; delete when the data changes.',
    },
  ],
  dataFlow: [
    'The application asks its small local cache, then the shared cache shard that owns the key.',
    'On a hit it returns; on a miss one request loads from the database and fills the cache.',
    'Writes go to the database and delete the cached key; a change stream catches writes from elsewhere.',
  ],
  highLevel: {
    label: 'Run a read through the cache',
    intro:
      'Start with every read hitting the database, then watch the cache layers join one by one: a local cache, a sharded cluster, a single-flight loader and a change stream. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      {
        id: 'local',
        title: 'Local cache',
        detail: 'Hottest keys, seconds',
        column: 0,
        row: 'top',
        appearsAt: 1,
      },
      { id: 'app', title: 'App servers', detail: 'Cache-aside client', column: 0, row: 'middle' },
      {
        id: 'ring',
        title: 'Hash ring',
        detail: 'Picks the shard',
        column: 1,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'shardA',
        title: 'Shard A',
        detail: 'Primary + replica',
        column: 2,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'shardB',
        title: 'Shard B',
        detail: 'Primary + replica',
        column: 2,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'shardC',
        title: 'Shard C',
        detail: 'Primary + replica',
        column: 2,
        row: 'bottom',
        appearsAt: 2,
      },
      {
        id: 'loader',
        title: 'Single flight',
        detail: 'One load per key',
        column: 3,
        row: 'middle',
        appearsAt: 4,
      },
      { id: 'db', title: 'Database', detail: 'Source of truth', column: 4, row: 'middle' },
      {
        id: 'changes',
        title: 'Change stream',
        detail: 'Every write, any writer',
        column: 4,
        row: 'bottom',
        appearsAt: 7,
      },
    ],
    edges: [
      ['app', 'local'],
      ['app', 'ring'],
      ['ring', 'shardA'],
      ['ring', 'shardB'],
      ['ring', 'shardC'],
      ['shardB', 'loader'],
      ['loader', 'db'],
      ['db', 'changes'],
      ['changes', 'shardC', 'invalidate'],
    ],
    stages: [
      {
        title: 'Every read hits the database',
        narration:
          'Before any cache, each page view runs its queries against the database. Traffic grows, the same popular rows are read over and over, and the database runs out of headroom: latency climbs and some reads time out.',
        tradeoff:
          'Adding database replicas buys read capacity, but each replica is a full copy that is expensive to run and still slow per query. Most of those reads ask for the same small set of hot rows, which is cheaper to keep in memory than to recompute.',
        nodes: ['app', 'db'],
        travel: [],
        short: 'DB overload',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '400 ms',
          errorRate: '2%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { app: 30, db: 95 },
      },
      {
        title: 'Check the local cache first',
        narration:
          'Each application server keeps a tiny in-process cache for the hottest keys, with a TTL of a few seconds. Most reads of a viral item never leave the server.',
        tradeoff:
          'A local cache removes the network hop and absorbs hot keys, but every server holds its own copy, so it costs memory and can be a few seconds stale. Keeping it small and short-lived limits both.',
        nodes: ['app', 'local'],
        travel: [['app', 'local']],
        short: 'Local cache',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '150 ms',
          errorRate: '0.5%',
          alerts: ['p95Latency'],
        },
        load: { app: 35, local: 40, db: 70 },
      },
      {
        title: 'Find the shard with consistent hashing',
        narration:
          'On a local miss, the client library hashes the key onto a ring with many virtual nodes per shard, and sends the request straight to the shard that owns it.',
        tradeoff:
          'Hashing by key modulo the number of nodes remaps almost every key when a node is added. Consistent hashing moves only about one shard’s worth of keys, and virtual nodes spread load evenly. Routing in the client avoids a proxy hop, at the cost of every client needing the current ring.',
        nodes: ['app', 'ring', 'shardB'],
        travel: [
          ['app', 'ring'],
          ['ring', 'shardB'],
        ],
        short: 'Hash ring',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '5 ms',
          errorRate: '0.1%',
          healthy: '3 / 3',
        },
        load: { shardA: 30, shardB: 35, shardC: 30, db: 20 },
      },
      {
        title: 'Hit: answer from memory',
        narration:
          'The shard has the key and answers from memory in well under a millisecond. Each shard has a replica that can take over or serve reads.',
        tradeoff:
          'Replicas give failover and extra read capacity. Replication is asynchronous to keep writes fast, so right after a failover a few recent writes can be missing. A lost fill is only an extra miss. A lost delete is worse: the old value is served again until its TTL, or until the change stream is replayed.',
        nodes: ['shardA', 'shardB', 'shardC'],
        travel: [
          ['ring', 'shardA'],
          ['ring', 'shardC'],
        ],
        short: 'Cache hit',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '2 ms',
          errorRate: '0.1%',
          healthy: '3 / 3',
        },
        load: { shardA: 30, shardB: 35, shardC: 30, db: 15 },
      },
      {
        title: 'Miss: only one request loads',
        narration:
          'On a miss, requests for the same key are coalesced: one of them takes a short lock and loads from the database, and the others wait for its result.',
        tradeoff:
          'Without coalescing, a popular key expiring sends thousands of identical queries to the database at once. A per-key lock adds a little latency for the waiters, and turns a stampede into a single query.',
        nodes: ['shardB', 'loader'],
        travel: [['shardB', 'loader']],
        short: 'Single flight',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '4 ms',
          errorRate: '0.1%',
          healthy: '3 / 3',
        },
        load: { shardB: 45, loader: 30, db: 20 },
      },
      {
        title: 'Load and fill with a jittered TTL',
        narration:
          'The loader reads from the database, writes the value into the cache with a TTL, and returns it. Each TTL gets a small random jitter.',
        tradeoff:
          'A TTL bounds how stale an entry can get even if an invalidation is lost; shorter TTLs mean fresher data and more misses. Jitter avoids thousands of keys written together expiring together.',
        nodes: ['loader', 'db'],
        travel: [['loader', 'db']],
        short: 'Fill + TTL',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '4 ms',
          errorRate: '0.1%',
          healthy: '3 / 3',
        },
        load: { loader: 30, db: 25 },
      },
      {
        title: 'Writes delete, they do not update',
        narration:
          'When the application changes data, it writes the database first and then deletes the cached key. The next read loads the new value.',
        tradeoff:
          'Updating the cache in place looks faster, but two concurrent writers can leave the older value in the cache for its whole TTL. Deleting costs one extra miss and removes the race between two writers. A slow reader can still refill an old value just after the delete, so the TTL stays as the bound, and the deep dive below covers versioned fills.',
        nodes: ['app', 'db'],
        travel: [],
        short: 'Write, delete',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '4 ms',
          errorRate: '0.1%',
          healthy: '3 / 3',
        },
        load: { app: 35, db: 30 },
      },
      {
        title: 'A change stream catches every writer',
        narration:
          'The database’s change log is streamed to a small service that deletes the affected keys, including changes made by other services, scripts or migrations.',
        tradeoff:
          'Invalidation in application code misses writers that do not know about the cache. Reading the database’s change log catches all of them, at the cost of another pipeline to run and a lag of a second or so.',
        nodes: ['db', 'changes', 'shardC'],
        travel: [
          ['db', 'changes'],
          ['changes', 'shardC', 'invalidate'],
        ],
        short: 'Change stream',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '4 ms',
          errorRate: '0.1%',
          healthy: '3 / 3',
        },
        load: { db: 30, changes: 25, shardC: 30 },
      },
      {
        title: 'Evict when memory is full',
        narration:
          'Each shard has a fixed memory budget. When it fills up, the least recently used entries are evicted first.',
        tradeoff:
          'LRU is simple and fits most read patterns. LFU keeps steadily popular keys better but adapts slower when popularity shifts. Watching the eviction rate tells you when the cache is simply too small.',
        nodes: ['shardA', 'shardB', 'shardC'],
        travel: [],
        short: 'Evict',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '5 ms',
          errorRate: '0.1%',
          healthy: '3 / 3',
        },
        load: { shardA: 85, shardB: 92, shardC: 80 },
      },
      {
        title: 'When a shard dies',
        narration:
          'If a primary fails, its replica is promoted. If the whole shard is lost, its keys move to the neighbors on the ring and start cold, while single-flight loads bound the work per key and a cap on concurrent loads bounds the total, so the database is not flooded.',
        tradeoff:
          'Replicas double the memory bill in exchange for fast failover. Without them, losing a node is still safe, but the database absorbs a burst of misses until the keys warm up again.',
        nodes: ['ring', 'shardA', 'shardC', 'loader'],
        travel: [],
        short: 'Shard dies',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '20 ms',
          errorRate: '0.4%',
          healthy: '2 / 3',
          alerts: ['healthy'],
        },
        load: { shardA: 70, shardC: 75, loader: 50, db: 55 },
        traffic: [
          { edge: ['ring', 'shardB'], kind: 'failed' },
          { edge: ['ring', 'shardA'], kind: 'health' },
          { edge: ['ring', 'shardC'], kind: 'health' },
        ],
      },
    ],
  },
  deepDives: [
    {
      question: 'Which caching pattern?',
      options: [
        {
          name: 'Cache-aside (lazy loading)',
          pros: 'Only what is read gets cached; the cache can fail without losing data.',
          cons: 'The first read of each key is a miss, and the application owns the logic.',
        },
        {
          name: 'Write-through',
          pros: 'The cache is always populated after a write.',
          cons: 'Every write pays for the cache too, and caches data that may never be read.',
        },
        {
          name: 'Write-behind',
          pros: 'Writes are very fast.',
          cons: 'A cache failure can lose writes the database never received.',
        },
      ],
      choice:
        'Cache-aside with delete on write. It keeps the database as the only source of truth and degrades to "slower" rather than "wrong" when the cache has problems.',
    },
    {
      question: 'What about a single very hot key?',
      options: [
        {
          name: 'Do nothing',
          pros: 'Simple.',
          cons: 'One shard takes all the traffic for that key and becomes the bottleneck.',
        },
        {
          name: 'Local cache in each app server',
          pros: 'The hot key is served from memory on every server.',
          cons: 'A few seconds of staleness for that key.',
        },
        {
          name: 'Replicate the key under several names',
          pros: 'Spreads one key across many shards.',
          cons: 'Every write must update or delete all copies.',
        },
      ],
      choice:
        'A short-lived local cache for keys detected as hot, and copies across shards only for the rare key that still overloads one node.',
    },
    {
      question: 'How do we avoid caching a stale value after a delete?',
      options: [
        {
          name: 'TTL only',
          pros: 'Nothing extra to build.',
          cons: 'A stale value lives for the whole TTL.',
        },
        {
          name: 'Versioned values',
          pros: 'A fill carrying an older version than the stored value is rejected. A delete leaves a short-lived tombstone with the new version, so a late fill is rejected even when nothing else is stored.',
          cons: 'Needs a version from the database on every row, and tombstones that outlive any fill in flight.',
        },
        {
          name: 'Delete again shortly after the write',
          pros: 'Cheap; catches a reader that filled the old value in between.',
          cons: 'Narrows the window instead of closing it.',
        },
      ],
      choice:
        'Versioned values where staleness matters, plus the TTL as the last line of defense everywhere else.',
    },
  ],
  wrapUp:
    'A local cache for hot keys, consistent hashing to replicated shards, single-flight loads with jittered TTLs on a miss, delete-on-write plus a change stream for freshness, and a database that never has to absorb a stampede.',
  guarantees: {
    provides: [
      {
        property: 'Durability',
        promise:
          'No write exists only in the cache. Every write is committed to the database first and the cache is filled from the database, so losing any node, or the whole cluster, loses no data.',
      },
      {
        property: 'Read consistency',
        promise:
          'Eventual, with bounded staleness. In the normal case a committed write is visible within about a second in the shared cache (delete on write, then the change stream) and within the local TTL of a few seconds on every server. In the worst case, a lost invalidation, the bound is the entry TTL.',
      },
      {
        property: 'Invalidation delivery',
        promise:
          'At least once, made harmless by the row version. The change stream consumer commits its position only after the delete succeeded, so a change is never skipped; a repeated delete or tombstone for the same version changes nothing.',
      },
      {
        property: 'Fill ordering',
        promise:
          'For keys with versioned values, the cached value never moves backwards. The shard accepts a fill only if its version is at least the version of the stored value or tombstone, compared and written in one atomic step on the node.',
      },
      {
        property: 'Availability',
        promise:
          'A cache failure makes reads slower, never wrong and never unavailable by itself. A timeout or a dead shard is treated as a miss, and the per-key load lock plus a cap on concurrent loads keeps the misses from overloading the database.',
      },
    ],
    assumes: [
      'The database is the source of truth and gives every row a version that only grows, exposed to the loader and in the change stream.',
      'The change stream contains every committed write, in commit order per row, and is retained longer than the longest consumer outage that should be repaired by replay.',
      'A tombstone lives longer than the loader’s deadline, so a fill that started before a write cannot arrive after the tombstone is gone.',
      'Every entry has a TTL. No key is cached forever.',
      'Clients share a ring that converges within seconds after a change in membership.',
    ],
    doesNotGuarantee: [
      'Read-your-writes or linearizable reads. A flow that must see its own write reads the database.',
      'Freshness through a failover. Replication is asynchronous, so a promoted replica can miss a recent delete or tombstone and serve the old value until its TTL or until the change stream is replayed.',
      'That the database commit and the cache delete happen together. They are two writes; the change stream is what repairs a delete that the application never sent.',
      'That an entry stays cached. Eviction, failover and resharding can drop any entry at any time.',
      'Exactly one database load per key. The load lock expires, so a slow loader can overlap with a second one; versioned fills make the overlap harmless, and the lock is an optimization, not a correctness mechanism.',
    ],
  },
  failures: [
    {
      scenario: 'A shard primary fails and its replica is promoted.',
      impact:
        'Reads for that shard fail for the few seconds of the promotion and are treated as misses. Fills that were not replicated become extra misses. Deletes and tombstones that were not replicated are worse: the old value is back and is served as a hit.',
      detection:
        'The failover event, the replication offset gap at promotion, and a sampled comparison of cached versions against the database that reports a stale-hit rate.',
      recovery:
        'The invalidation consumer for that shard is rewound by more than the replication gap and replays its deletes, which is safe because they are idempotent. Anything still missed expires with its TTL. A new replica syncs from the new primary.',
    },
    {
      scenario: 'A whole shard is lost, and later comes back.',
      impact:
        'A third of the keys move to the neighbors and start cold, so about a third of the reads miss at first and the database takes the burst. If the old node only lost its network and returns with its memory intact, it holds entries that missed every delete sent while it was away.',
      detection:
        'Healthy shards 2 / 3, a drop in hit ratio, a rise in database queries per second and in load-queue wait time.',
      recovery:
        'Single flight keeps it to one load per key and the cap on concurrent loads bounds the total; hot keys are warm again within seconds, the long tail within minutes. A node always rejoins the ring empty: it is flushed first, then given its range back, which causes a second, smaller round of misses.',
    },
    {
      scenario: 'The application commits a write and crashes before deleting the cached key.',
      impact:
        'The shared cache keeps the old value. Readers see stale data even though the write was acknowledged.',
      detection:
        'The change stream consumer counts deletes that found the key still present. A steady rate is normal for writers that do not know the cache; a jump points at failing application deletes.',
      recovery:
        'The change stream delivers the same change about a second later and deletes the key. The state is then the same as if the application had deleted it. If the stream is also stalled, the TTL is the bound.',
    },
    {
      scenario:
        'A reader loads a row, a writer commits and deletes the key, and then the reader’s fill arrives with the old value.',
      impact:
        'With plain deletes the old value is cached again and stays for a full TTL. The same happens when the loader reads from a database replica that lags behind the write.',
      detection: 'A counter of fills rejected for carrying an older version, per key family.',
      recovery:
        'For versioned keys the delete leaves a tombstone with the new row version, so the late fill is rejected and the next read loads the current row. Keys without versions rely on the TTL, which is why their TTL is kept short.',
    },
    {
      scenario: 'The change stream consumer stalls or falls far behind.',
      impact:
        'Deletes sent by the application still work. Writes from other services, scripts and migrations are not invalidated, so those keys are stale for up to their TTL.',
      detection:
        'An alarm on consumer lag measured in seconds behind the database’s latest commit, not in events.',
      recovery:
        'The consumer resumes from its committed position and replays; duplicates are harmless. If the lag is longer than the longest TTL, it can skip to one TTL ago: any entry still in the cache was filled after the older changes were committed, as long as loads read an up-to-date copy of the row.',
    },
    {
      scenario: 'The cluster starts cold: a full restart, a bad flush or a new empty cluster.',
      impact:
        'Misses are spread over millions of distinct keys, so single flight only helps for the hot ones. The database would see close to the 50K reads per second that overloaded it before the cache existed.',
      detection:
        'Hit ratio near zero, the load queue at its cap, database connections and CPU saturated.',
      recovery:
        'The cap on concurrent loads sheds the excess: those reads fail fast instead of piling up on the database. Traffic is shifted to the cold cluster in steps, or shards are restarted one at a time, so only a fraction of the keys is cold at any moment. The cluster ends warm with no repair needed.',
    },
  ],
  capacity: {
    assumptions: [
      '1M users and a peak of 50K reads per second, as in the walkthrough; about 50 reads for every write.',
      'The local caches answer about 20% of the reads (the hottest keys). The shared cache hits on 95% of the rest.',
      '30M cacheable entries of about 1 KB each, counting key, value and per-entry overhead. TTL of 10 minutes with jitter.',
      'A cache node has 16 GB of memory, of which 12 GB is the data budget; the rest covers fragmentation and replication buffers.',
      'An application server handles about 500 requests per second.',
    ],
    estimates: [
      {
        label: 'Reads reaching the shards',
        value: '~40K/s',
        math: '50K/s × (1 − 0.20 served locally) = 40K/s, about 13K/s per shard. Far below what one node can serve.',
      },
      {
        label: 'Database reads after the cache',
        value: '~2K/s (25× fewer)',
        math: '40K/s × 5% misses = 2K loads/s, against 50K/s before. Each point of hit ratio lost adds 400 loads/s.',
      },
      {
        label: 'Invalidations',
        value: '~2K deletes/s',
        math: '50K reads/s ÷ 50 = 1K writes/s; each is deleted once by the application and once by the change stream.',
      },
      {
        label: 'Memory',
        value: '30 GB of data, 96 GB provisioned',
        math: '30M entries × 1 KB = 30 GB; ÷ 12 GB budget per node = 2.5, so 3 shards; × 2 for replicas = 6 nodes × 16 GB.',
      },
      {
        label: 'Keys moved when a shard is added',
        value: '~25%, not ~75%',
        math: 'Consistent hashing, 3 → 4 shards: 1/4 of 30M = 7.5M keys move. With hash mod N only the keys where h mod 3 = h mod 4 stay, 3 in 12, so 75% move.',
      },
      {
        label: 'Misses when a shard is lost',
        value: '~13K/s at first',
        math: '40K/s ÷ 3 shards ≈ 13K reads/s start cold, on top of the usual 2K/s: about 30% of the load that used to overload the database, falling as keys warm up.',
      },
    ],
    implications: [
      'Memory sets the shard count, not throughput: each shard is asked for 13K operations a second and could serve several times that. Scaling out is driven by data size and hit ratio.',
      'The database is sized for about 2K reads per second plus headroom, not for 50K. That makes the cache part of the capacity plan, so the stampede and cold-start protections are required, not optional.',
      'Hit ratio is the number to watch. Going from 95% to 90% doubles the database reads, so eviction rate and hit ratio have alarms before latency does.',
      'A lost shard is survivable (about 15K loads a second in the first moments), a lost cluster is not (40K). Hence replicas, one-at-a-time restarts and a cap on concurrent loads.',
      'With 100 application servers, a local cache of 10K entries costs about 10 MB each and removes a fifth of the network calls. It is cheap, and it is also where the few seconds of extra staleness come from.',
    ],
  },
  evolution: {
    mvp: 'One cache node with a replica, cache-aside with a TTL and delete on write in the application. No local cache, no ring, no change stream, no versions. This is enough while the data fits in one node, the application is the only writer and a stale read for one TTL is acceptable.',
    atScale: [
      'At 10x (500K reads/s, about 300 GB): around 30 shards. The ring becomes shared configuration with a version, pushed to clients from a coordination service. Hot key detection and the local cache become necessary, and so does the change stream, because by now there are writers that do not know the cache.',
      'Also at 10x: about 1,000 application servers each holding connections to 30 shards. A proxy tier or a sidecar starts to pay for itself by pooling connections and owning the ring.',
      'At 100x (millions of reads per second, terabytes): memory is the main cost. Large or cold values move to a flash tier, values are compressed, and admission control keeps one-hit keys out. Each region gets its own cluster, and invalidations, not values, are sent across regions.',
      'At that size a cold cluster cannot be warmed by production traffic alone, so new clusters are warmed from a running one before they take reads.',
    ],
    firstBottleneck:
      'Memory per shard. When the working set outgrows the budget, eviction removes entries that are still being read, the hit ratio drops, and database load grows much faster than traffic: a few points of hit ratio are a multiple of database reads. A single hot key saturating one shard shows up earlier in some workloads, and the local cache is the answer to that one.',
    avoided: [
      'Write-through and write-behind. They make the cache part of the write path and, for write-behind, a place where data can be lost. Worth it only for data that can be recomputed or lost.',
      'Versioned fills on every key. They need a version on every row and a tombstone on every delete. Worth it for the key families where a stale read for one TTL is a real problem, such as permissions or prices.',
      'A consistent cache with leases or consensus on every read. It would give read-your-writes at the price of the latency the cache exists to remove. A flow that needs it reads the database.',
      'A proxy tier from day one. Client-side routing is one hop fewer and one fleet fewer. Worth adding when connection counts or several client languages make the ring hard to keep in sync.',
      'Refresh-ahead for hot keys (serve the current value while one request reloads it before expiry). It hides miss latency but adds background load and logic. Worth it when the p99 of a miss on a hot key matters.',
    ],
  },
};
