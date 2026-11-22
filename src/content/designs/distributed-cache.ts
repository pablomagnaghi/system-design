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
      'Cache hits in about a millisecond and a few milliseconds at the 95th percentile with misses included, at tens of thousands of reads per second. The 4% of reads that load from the database take tens of milliseconds.',
      'Scale out by adding nodes, moving as few keys as possible.',
      'Stay available when a node fails, and never let a miss storm take the database down.',
      'Bounded staleness: seconds in the normal case, and never longer than the TTL of an entry plus the few seconds of the local cache.',
      'Only the application can reach the cache: a private network, an authenticated client and encryption in transit and at rest.',
    ],
    outOfScope: [
      'Using the cache as the system of record: the database stays the source of truth.',
      'Replicating cached values across regions: each region runs its own cluster (see the deep dive on regions).',
      'Caching whole HTTP responses at a CDN or reverse proxy.',
      'Transactions or atomic updates across several keys.',
      'A cache that keeps its data through a full restart: it always restarts empty.',
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
      'Start with every read hitting the database, then watch the cache layers join one by one: a local cache, a sharded cluster, a single-flight loader and a change stream. The diagram draws three of the four shards. Numbers are illustrative. Press play, or step through the stages.',
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
        detail: 'About one load per key',
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
      ['app', 'db', 'every read'],
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
    // The direct path to the database is the problem of the first stage; the cache replaces it.
    edgeStages: [{ edge: ['app', 'db'], stages: [0] }],
    stages: [
      {
        title: 'Every read hits the database',
        narration:
          'Before any cache, each page view runs its queries against the database. Traffic grows, the same popular rows are read over and over, and the database runs out of headroom: latency climbs and some reads time out.',
        tradeoff:
          'Adding database replicas buys read capacity, but each replica is a full copy that is expensive to run and still slow per query. Most of those reads ask for the same small set of hot rows, which is cheaper to keep in memory than to recompute.',
        nodes: ['app', 'db'],
        travel: [['app', 'db']],
        short: 'DB overload',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '400 ms',
          errorRate: '2%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { app: 30, db: 95 },
        traffic: [
          { edge: ['app', 'db'], kind: 'heavy' },
          { edge: ['app', 'db'], kind: 'failed' },
        ],
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
          'Hashing by key modulo the number of nodes remaps almost every key when a node is added. Consistent hashing moves only about one shard’s worth of keys, and virtual nodes spread load evenly. Routing in the client avoids a proxy hop, at the cost of every client needing the current ring. Managed Redis and Valkey apply the same idea with 16,384 fixed hash slots: adding a shard moves slots, not individual keys.',
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
          healthy: '4 / 4',
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
          healthy: '4 / 4',
        },
        load: { shardA: 30, shardB: 35, shardC: 30, db: 15 },
      },
      {
        title: 'Miss: only one request loads',
        narration:
          'On a miss, requests for the same key are coalesced: one of them takes a short lock and loads from the database, and the others wait for its result.',
        tradeoff:
          'Without coalescing, a popular key expiring sends thousands of identical queries to the database at once. A per-key lock adds a little latency for the waiters, and turns a stampede into about one query: the lock expires on its own, so a slow loader can overlap with a second one.',
        nodes: ['shardB', 'loader'],
        travel: [['shardB', 'loader']],
        short: 'Single flight',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '4 ms',
          errorRate: '0.1%',
          healthy: '4 / 4',
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
          healthy: '4 / 4',
        },
        load: { loader: 30, db: 25 },
      },
      {
        title: 'Writes delete, they do not update',
        narration:
          'When the application changes data, it writes the database first and then deletes the cached key. The next read loads the new value.',
        tradeoff:
          'Updating the cache in place looks faster, but two concurrent writers can leave the older value in the cache for its whole TTL. Deleting costs one extra miss and removes the race between two writers. A slow reader can still refill an old value just after the delete, so the TTL stays as the bound, and the deep dive below covers versioned fills.',
        nodes: ['app', 'ring', 'shardB', 'db'],
        travel: [
          ['app', 'ring'],
          ['ring', 'shardB'],
        ],
        short: 'Write, delete',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '4 ms',
          errorRate: '0.1%',
          healthy: '4 / 4',
        },
        load: { app: 35, db: 30, shardB: 35 },
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
          healthy: '4 / 4',
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
          healthy: '4 / 4',
        },
        load: { shardA: 85, shardB: 92, shardC: 80 },
      },
      {
        title: 'When a shard dies',
        narration:
          'If a primary fails, its replica is promoted. If the whole shard is lost, its keys move to the neighbors on the ring and start cold. Single flight collapses the reads of a hot key into about one load, and a cap on concurrent loads lets about 4K loads a second through. Reads over the cap fail fast, so the database is not flooded. A node that comes back always rejoins empty, because its old entries missed every delete sent while it was away.',
        tradeoff:
          'Replicas double the memory bill in exchange for fast failover. Without them, losing a node still loses no data, but its reads miss: the database takes loads up to the cap and the rest fail fast until the keys warm up again.',
        nodes: ['ring', 'shardA', 'shardC', 'loader'],
        travel: [],
        short: 'Shard dies',
        metrics: {
          users: '1M',
          requestsPerSecond: '50K',
          p95Latency: '30 ms',
          errorRate: '5%',
          healthy: '3 / 4',
          alerts: ['p95Latency', 'errorRate', 'healthy'],
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
  flows: [
    {
      id: 'hit',
      title: 'Read that hits',
      kind: 'sync',
      summary:
        'A product page asks for item 42. The local cache does not have it, the shared cache does, and the database is never touched.',
      runsOn: 'App on ECS → in-process cache → ElastiCache shard',
      participants: [
        { id: 'app', label: 'App server', service: 'ECS' },
        { id: 'local', label: 'Local cache', service: 'In-process LRU' },
        { id: 'shard', label: 'Cache shard', service: 'ElastiCache' },
      ],
      steps: [
        {
          from: 'app',
          to: 'local',
          label: 'get item:42',
          note: 'The hottest keys live in the server’s own memory for a few seconds, so a viral item never leaves the server.',
        },
        {
          from: 'local',
          to: 'app',
          label: 'miss',
          note: 'Item 42 is not hot enough to be here, or its few seconds expired.',
          style: 'reply',
        },
        {
          from: 'app',
          to: 'app',
          label: 'hash key → slot → shard',
          note: 'The client library hashes the key to one of 16,384 slots and keeps a map of which shard owns each slot, so there is no proxy hop.',
        },
        {
          from: 'app',
          to: 'shard',
          label: 'GET item:42',
          note: 'One network round trip over TLS to the primary that owns the slot.',
        },
        {
          from: 'shard',
          to: 'app',
          label: 'value, v7',
          note: 'Answered from memory in well under a millisecond. The value carries the row version it was loaded with.',
          style: 'reply',
        },
        {
          from: 'app',
          to: 'local',
          label: 'keep a few seconds',
          note: 'Only keys detected as hot are copied locally, which is where the few seconds of extra staleness come from.',
          style: 'async',
        },
      ],
    },
    {
      id: 'miss',
      title: 'Read that misses',
      kind: 'sync',
      summary:
        'Item 42 expired and a thousand requests want it at once. One of them loads it from the database; the rest wait for its result.',
      runsOn: 'App on ECS → ElastiCache lock → Aurora writer → versioned fill',
      participants: [
        { id: 'app', label: 'Request A', service: 'ECS' },
        { id: 'other', label: 'Requests B…', service: 'ECS' },
        { id: 'shard', label: 'Cache shard', service: 'ElastiCache' },
        { id: 'db', label: 'Database', service: 'Aurora PostgreSQL' },
      ],
      steps: [
        {
          from: 'app',
          to: 'shard',
          label: 'GET item:42 → miss',
          note: 'The entry expired. Without protection, every request that misses would now query the database.',
        },
        {
          from: 'app',
          to: 'shard',
          label: 'SET lock:{item:42} NX PX 2000',
          note: 'Only one request gets the load lock for this key. It expires on its own, so a crashed loader cannot block the key forever. The braces are a hash tag: the lock hashes on item:42, so it lands in the same slot and shard as the entry.',
        },
        {
          from: 'other',
          to: 'shard',
          label: 'lock taken → wait, GET again',
          note: 'Requests that lose the lock wait a few milliseconds and read again instead of querying the database. In-process single flight does the same within one server.',
        },
        {
          from: 'app',
          to: 'db',
          label: 'SELECT row, version',
          note: 'The loader reads the row and its version from the writer, or from a replica it knows is current, so it does not cache an old copy.',
        },
        {
          from: 'app',
          to: 'shard',
          label: 'versioned SET, TTL 1 min ± jitter',
          note: 'A script on the shard stores the value only if its version is not older than what is stored. The item carries a price, so it gets the one-minute TTL of that family. Jitter keeps keys filled together from expiring together.',
        },
        {
          from: 'shard',
          to: 'other',
          label: 'value, v7',
          note: 'The waiting requests now hit. About one database query served a thousand readers: only a loader slower than the 2 seconds of the lock lets a second one through.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'write',
      title: 'Write, then delete',
      kind: 'sync',
      summary:
        'The price of item 42 changes. The database is written first and the cached key is deleted, never updated in place.',
      runsOn: 'App on ECS → Aurora commit → ElastiCache delete with tombstone',
      participants: [
        { id: 'app', label: 'App server', service: 'ECS' },
        { id: 'db', label: 'Database', service: 'Aurora PostgreSQL' },
        { id: 'shard', label: 'Cache shard', service: 'ElastiCache' },
      ],
      steps: [
        {
          from: 'app',
          to: 'db',
          label: 'UPDATE price, version = 8',
          note: 'The database is the source of truth, so the write commits there first. Every row has a version that only grows.',
        },
        {
          from: 'db',
          to: 'app',
          label: 'committed',
          note: 'From here the write is durable whatever happens to the cache.',
          style: 'reply',
        },
        {
          from: 'app',
          to: 'shard',
          label: 'delete → tombstone v8',
          note: 'Deleting instead of updating removes the race between two writers. For versioned keys the delete leaves a short-lived tombstone with version 8. The shard keeps the highest version it has seen, so a late delete for an older version changes nothing.',
        },
        {
          from: 'app',
          to: 'app',
          label: 'next read loads v8',
          note: 'The next reader misses and fills the new value. If the app crashed before the delete, the change stream deletes the key a second later.',
        },
      ],
    },
    {
      id: 'race-update',
      title: 'Two writers, updating',
      kind: 'sync',
      summary:
        'Why the cache is never updated in place. Two writers change the price of item 42 at almost the same time, and the cache ends up with the wrong one.',
      runsOn: 'Two app servers on ECS → Aurora → ElastiCache SET (the rejected design)',
      participants: [
        { id: 'a', label: 'Writer A', service: 'ECS' },
        { id: 'b', label: 'Writer B', service: 'ECS' },
        { id: 'db', label: 'Database', service: 'Aurora PostgreSQL' },
        { id: 'shard', label: 'Cache shard', service: 'ElastiCache' },
      ],
      steps: [
        {
          from: 'a',
          to: 'db',
          label: 'price = 100',
          note: 'Writer A commits first.',
        },
        {
          from: 'b',
          to: 'db',
          label: 'price = 120',
          note: 'Writer B commits second, so the database correctly ends at 120.',
        },
        {
          from: 'b',
          to: 'shard',
          label: 'SET 120',
          note: 'B updates the cache right away.',
        },
        {
          from: 'a',
          to: 'shard',
          label: 'SET 100, late',
          note: 'A’s cache write was delayed by the network or a pause, and lands last. Nothing orders the two cache writes like the database ordered the commits.',
        },
        {
          from: 'shard',
          to: 'shard',
          label: 'cache 100, database 120',
          note: 'Every reader now gets the wrong price for the whole TTL, one minute for a price. This is the race that delete on write removes.',
        },
      ],
    },
    {
      id: 'race-delete',
      title: 'Two writers, deleting',
      kind: 'sync',
      summary:
        'The same two writers with delete on write. Two deletes in any order leave the same thing, an empty key, and the next reader loads the truth.',
      runsOn: 'Two app servers on ECS → Aurora → ElastiCache delete → reader fills from Aurora',
      participants: [
        { id: 'a', label: 'Writer A', service: 'ECS' },
        { id: 'b', label: 'Writer B', service: 'ECS' },
        { id: 'db', label: 'Database', service: 'Aurora PostgreSQL' },
        { id: 'shard', label: 'Cache shard', service: 'ElastiCache' },
        { id: 'reader', label: 'Reader', service: 'ECS' },
      ],
      steps: [
        {
          from: 'a',
          to: 'db',
          label: 'price = 100',
          note: 'Same start: A commits first.',
        },
        {
          from: 'b',
          to: 'db',
          label: 'price = 120',
          note: 'B commits second; the database ends at 120.',
        },
        {
          from: 'b',
          to: 'shard',
          label: 'delete',
          note: 'B deletes the key instead of writing a value.',
        },
        {
          from: 'a',
          to: 'shard',
          label: 'delete, late',
          note: 'A’s delete arrives late and changes nothing: deleting is idempotent and the order does not matter.',
        },
        {
          from: 'reader',
          to: 'db',
          label: 'miss → SELECT → 120',
          note: 'The next reader misses and loads from the source of truth. The cache is only ever filled from a database read.',
        },
        {
          from: 'reader',
          to: 'shard',
          label: 'fill 120',
          note: 'Cache and database agree. The cost was one miss, at 50 reads per write. A reader that loaded the old value before the writes is the remaining case, handled by versions and tombstones.',
        },
      ],
    },
    {
      id: 'change-stream',
      title: 'Change stream invalidation',
      kind: 'queue',
      summary:
        'A migration script updates item 42 directly in the database. It knows nothing about the cache, and the change stream still invalidates it.',
      runsOn:
        'Aurora logical replication → Debezium on MSK Connect → MSK → invalidator on ECS → ElastiCache',
      participants: [
        { id: 'db', label: 'Database', service: 'Aurora PostgreSQL' },
        { id: 'cdc', label: 'Connector', service: 'MSK Connect' },
        { id: 'topic', label: 'Change topic', service: 'Amazon MSK' },
        { id: 'inv', label: 'Invalidator', service: 'ECS' },
        { id: 'shard', label: 'Cache shard', service: 'ElastiCache' },
      ],
      steps: [
        {
          from: 'db',
          to: 'cdc',
          label: 'logical replication: item 42, v9',
          note: 'Every committed write appears in the database’s change log, whichever service, script or migration made it.',
          style: 'async',
        },
        {
          from: 'cdc',
          to: 'topic',
          label: 'publish change',
          note: 'The connector turns the log into events keyed by row, so changes to one row stay in order.',
          style: 'async',
        },
        {
          from: 'topic',
          to: 'inv',
          label: 'consume',
          note: 'A small consumer reads the events about a second behind the commit.',
        },
        {
          from: 'inv',
          to: 'shard',
          label: 'delete → tombstone v9',
          note: 'The same delete the application would have sent. Repeating it for the same version changes nothing, and one for an older version is ignored.',
        },
        {
          from: 'inv',
          to: 'topic',
          label: 'commit offset',
          note: 'The position moves only after the delete succeeded, so a crash replays the change instead of skipping it.',
        },
      ],
    },
    {
      id: 'late-fill',
      title: 'A late fill is rejected',
      kind: 'sync',
      summary:
        'A slow reader loaded version 7 just before a write. Its fill arrives after the delete and would cache the old price for a full TTL, one minute.',
      runsOn: 'Two app servers → Aurora → ElastiCache script comparing versions',
      participants: [
        { id: 'reader', label: 'Slow reader', service: 'ECS' },
        { id: 'writer', label: 'Writer', service: 'ECS' },
        { id: 'db', label: 'Database', service: 'Aurora PostgreSQL' },
        { id: 'shard', label: 'Cache shard', service: 'ElastiCache' },
      ],
      steps: [
        {
          from: 'reader',
          to: 'db',
          label: 'SELECT → v7',
          note: 'The reader missed and loaded the row, then paused: a garbage collection, a slow network.',
        },
        {
          from: 'writer',
          to: 'db',
          label: 'UPDATE → v8',
          note: 'A writer changes the price and commits version 8.',
        },
        {
          from: 'writer',
          to: 'shard',
          label: 'delete → tombstone v8',
          note: 'The key is gone, and the tombstone remembers that version 8 exists.',
        },
        {
          from: 'reader',
          to: 'shard',
          label: 'versioned SET v7',
          note: 'The old fill finally arrives. With a plain SET it would be cached for a full TTL.',
        },
        {
          from: 'shard',
          to: 'reader',
          label: 'rejected: 7 < 8',
          note: 'The script compares and writes in one atomic step on the node, so the old value never lands. The next read loads version 8.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'failover',
      title: 'A shard primary fails',
      kind: 'async',
      summary:
        'The primary of one shard dies. Its replica in another zone takes over, and the deletes that did not replicate are replayed.',
      runsOn:
        'ElastiCache Multi-AZ failover → client slot map refresh → replayer for the affected slots',
      participants: [
        { id: 'app', label: 'App server', service: 'ECS' },
        { id: 'primary', label: 'Primary', service: 'ElastiCache, zone a' },
        { id: 'replica', label: 'Replica', service: 'ElastiCache, zone b' },
        { id: 'inv', label: 'Replayer', service: 'ECS' },
      ],
      steps: [
        {
          from: 'app',
          to: 'primary',
          label: 'GET → timeout',
          note: 'A timeout is treated as a miss, so the read is slower, not wrong. The lock lives on the shard that is down, so in-process single flight and the cap on concurrent loads are what protect the database here.',
        },
        {
          from: 'replica',
          to: 'replica',
          label: 'promoted to primary',
          note: 'Multi-AZ automatic failover promotes the replica. Replication was asynchronous, so the last few writes may be missing.',
        },
        {
          from: 'app',
          to: 'replica',
          label: 'refresh slot map, GET',
          note: 'The client learns the new owner of the slots and reads from it.',
        },
        {
          from: 'inv',
          to: 'replica',
          label: 'replay recent deletes',
          note: 'A delete that did not replicate would let an old value come back. A replayer reads the change topic again from before the replication gap and sends the deletes for keys in the slots of that shard, while the main consumer keeps its position. Deletes are idempotent.',
        },
      ],
    },
  ],
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
        'A short-lived local cache for keys detected as hot, and copies across shards only for the rare key that still overloads one node. Detection runs in each client: it samples its reads into a small top-K counter over a sliding window of a few seconds, with K around 1,000, and the keys in that top K are promoted to the local cache until they cool down. The hot shard alarm, one shard’s CPU far above the others, is the server-side signal that detection is missing something.',
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
    {
      question: 'What about reads for keys that do not exist?',
      options: [
        {
          name: 'Do nothing',
          pros: 'Nothing to build.',
          cons: 'A missing row is never cached, so every request for it reaches the database. A bug or an attacker asking for random IDs bypasses the cache completely.',
        },
        {
          name: 'Cache "not found" with a short TTL',
          pros: 'A repeated request for a missing key becomes a cache hit, with the same single-flight protection as any miss.',
          cons: 'A row created right after can look missing for that short TTL unless the insert deletes the marker; random IDs still miss once each.',
        },
        {
          name: 'A Bloom filter of existing keys in front',
          pros: 'Rejects IDs that certainly do not exist before the cache or the database, even when each ID is asked once.',
          cons: 'Must be rebuilt or updated on every insert, and allows a small rate of false positives that still go through.',
        },
      ],
      choice:
        'Negative entries: a missing row is cached as a "not found" marker with a TTL of about 30 seconds. An insert deletes the key like any write, and the change stream catches inserts from other writers, so a new row shows up within a second. A Bloom filter is added only for key spaces that are enumerable and under attack, together with rate limits per client.',
    },
    {
      question: 'How long should each kind of data live?',
      options: [
        {
          name: 'One TTL for everything',
          pros: 'Simple to reason about and to configure.',
          cons: 'Either too long for prices and permissions or too short for a catalog that rarely changes.',
        },
        {
          name: 'A TTL per key family',
          pros: 'Each family trades freshness against misses on its own terms.',
          cons: 'A small table to own and review, and one more thing to get wrong for a new family.',
        },
        {
          name: 'No TTL, rely on invalidation only',
          pros: 'The fewest misses.',
          cons: 'A lost invalidation leaves a wrong value forever, and memory fills with keys nobody reads.',
        },
      ],
      choice:
        'A TTL per key family, all with jitter: permissions and prices about 1 minute and versioned, user profiles about 10 minutes, catalog and reference data about an hour, "not found" markers about 30 seconds, and the local cache a few seconds. The TTL is the bound when invalidation fails, so the families where a stale read hurts get the shortest one.',
    },
    {
      question: 'How do we add a shard without downtime?',
      options: [
        {
          name: 'Build a bigger cluster and switch over',
          pros: 'Simple to reason about; the old cluster stays as a fallback.',
          cons: 'The new cluster starts cold, which is the cold start the design must avoid, unless it is warmed first.',
        },
        {
          name: 'Move hash slots online',
          pros: 'Keys move slot by slot with their TTLs while both shards serve; clients follow redirects.',
          cons: 'Requests for a slot in flight take an extra hop, and the move adds load to both shards while it runs.',
        },
      ],
      choice:
        'Online slot migration. While a slot moves, a key already copied to the new shard is answered with a redirect: ASK for that one request during the move, MOVED once the slot belongs to the new shard, after which the client updates its slot map. Nothing is lost and nothing starts cold; latency rises slightly, so it runs at low traffic and one slot range at a time.',
    },
    {
      question: 'What about large values?',
      options: [
        {
          name: 'Cache them as they are',
          pros: 'No extra code.',
          cons: 'A 1 MB value takes a thousand times the bandwidth and memory of a typical entry, and a single-threaded node is blocked while it sends it.',
        },
        {
          name: 'Compress above a threshold',
          pros: 'Text and JSON shrink several times, saving memory and network.',
          cons: 'CPU on the client for every read and write of those entries.',
        },
        {
          name: 'Keep big objects out of the cache',
          pros: 'The cache stays fast for everyone; the object is served from object storage or a CDN.',
          cons: 'A second fetch for those objects.',
        },
      ],
      choice:
        'Compress values above about 1 KB, which most entries are not. Values above about 100 KB are not cached here at all: the object lives in S3 behind a CDN and the cache holds its key and version. Big values are what trip the node’s network bandwidth limit before CPU or memory, so NetworkBandwidthOutAllowanceExceeded is the alarm that catches a new one.',
    },
    {
      question: 'How do we warm a new or cold cluster?',
      options: [
        {
          name: 'Let production traffic warm it',
          pros: 'Nothing to build.',
          cons: 'This is the cold start: about 40K reads a second would reach the database at once.',
        },
        {
          name: 'Preload the hot keys from the database',
          pros: 'The keys that carry most reads are present before any traffic arrives.',
          cons: 'A load on the database of its own, so it must be rate limited, and the hot key list must be known.',
        },
        {
          name: 'Mirror reads to the new cluster',
          pros: 'Warms with the real access pattern, including the long tail.',
          cons: 'Doubles reads on the old cluster and the misses of the new one still reach the database.',
        },
      ],
      choice:
        'Preload, then shift traffic in steps. The keys to load are sampled from the old cluster with SCAN, not taken from the clients’ hot lists, which only name keys the servers already answer locally. A loader fills them from the database under the same cap on concurrent loads. With no old cluster to sample, the stepped shift and the cap are what is left. Then traffic moves to the new cluster in steps, 1%, 10%, 50%, 100%, and each step waits until the new cluster’s hit ratio is close to the old one’s.',
    },
    {
      question: 'What about several regions?',
      options: [
        {
          name: 'One cluster for all regions',
          pros: 'One copy, one place to invalidate.',
          cons: 'Every read from a far region pays a cross-region round trip, tens of milliseconds, which defeats the cache.',
        },
        {
          name: 'Replicate values across regions, like ElastiCache Global Datastore',
          pros: 'Readers in every region hit locally, with managed replication.',
          cons: 'One primary region takes writes, replication is asynchronous, and deletes reach other regions late.',
        },
        {
          name: 'A cluster per region, invalidations sent across',
          pros: 'Each region fills from its own database replica and only small deletes cross regions.',
          cons: 'Each region warms on its own, and a remote delete arrives after replication lag plus delivery.',
        },
      ],
      choice:
        'A cluster per region. Each region fills from its local database copy, and invalidations, not values, cross regions: the change topic is replicated to every region and each region runs its own invalidator on its copy, because a read-only database copy may not offer a change log to read. A delete can arrive before the local database copy has the new row, so a fill can read an old row, which is what tombstones, versioned fills and the TTL already bound.',
    },
    {
      question: 'Which engine, and who runs it?',
      options: [
        {
          name: 'Memcached',
          pros: 'Simple, multithreaded and very fast for plain get and set.',
          cons: 'No replication, no scripts for an atomic compare-and-set, and every node restart is a cold shard.',
        },
        {
          name: 'Redis or Valkey, self-managed',
          pros: 'Replicas, scripts for versioned fills, and full control over versions and tuning.',
          cons: 'Failover, patching, resharding and backups become our on-call work.',
        },
        {
          name: 'Managed Redis or Valkey, such as ElastiCache',
          pros: 'Automatic failover across zones, online resharding and metrics out of the box.',
          cons: 'Less control over versions and settings, and a higher price per GB than raw instances.',
        },
      ],
      choice:
        'Managed Redis or Valkey in cluster mode. Replicas give the failover the design relies on, a script compares versions atomically on the node, and the team does not run a cache fleet. Memcached is a fair choice for a cache that needs neither replicas nor versioned fills.',
    },
    {
      question: 'Who can reach the cache?',
      options: [
        {
          name: 'Network isolation only',
          pros: 'Nothing to configure in the client.',
          cons: 'Anything that gets into the network can read or flush every key, and traffic travels in clear text.',
        },
        {
          name: 'Isolation plus authentication, TLS and per-service users',
          pros: 'Each service gets its own user and allowed commands; a leaked credential cannot run a flush or read other services’ keys.',
          cons: 'TLS costs some CPU per request, and credentials must be rotated.',
        },
      ],
      choice:
        'Private subnets with security groups that admit only the application and the invalidator, TLS in transit, encryption at rest, and a user per service whose allowed commands exclude flushes and admin commands. Values that are personal data get a short TTL so they do not linger.',
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
          'Eventual, with bounded staleness. In the normal case a committed write is visible within about a second in the shared cache (delete on write, then the change stream) and within the local TTL of a few seconds on every server. In the worst case, a lost invalidation, the bound is the entry TTL, plus the local TTL on servers that copied the stale value just before it expired.',
      },
      {
        property: 'Invalidation delivery',
        promise:
          'At least once, made harmless by the row version. The change stream consumer commits its position only after the delete succeeded, so a change is not skipped while it is still within the retention of the stream; a repeated delete or tombstone for the same version changes nothing.',
      },
      {
        property: 'Fill ordering',
        promise:
          'For keys with versioned values, the cached value never moves backwards. The shard accepts a fill only if its version is at least the version of the stored value or tombstone, compared and written in one atomic step on the node. A tombstone is written through the same comparison and keeps the highest version seen, so a late delete never lowers it.',
      },
      {
        property: 'Availability',
        promise:
          'A cache failure makes reads slower, not wrong, except for the failover window listed below. A timeout or a dead shard is treated as a miss, and single flight plus a cap on concurrent loads keeps the misses from overloading the database. When a shard or the whole cluster is cold, that cap fails a share of the reads fast on purpose.',
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
      'Freshness through a failover. Replication is asynchronous, so a promoted replica can miss a recent delete or tombstone and serve the old value until its TTL or until the deletes for its slots are replayed.',
      'That the database commit and the cache delete happen together. They are two writes; the change stream is what repairs a delete that the application never sent.',
      'That an entry stays cached. Eviction, failover and resharding can drop any entry at any time.',
      'That a tombstone survives memory pressure. It is an entry like any other: if it is evicted before the loader’s deadline, a late fill can land, and the entry TTL is the bound.',
      'Exactly one database load per key. The load lock expires, so a slow loader can overlap with a second one; versioned fills make the overlap harmless, and the lock is an optimization, not a correctness mechanism.',
    ],
  },
  failures: [
    {
      scenario: 'A shard primary fails and its replica is promoted.',
      impact:
        'Reads for that shard time out until the failure is detected, the replica is promoted and clients refresh the slot map; the promotion itself typically takes a few seconds on ElastiCache. Those reads are treated as misses. Fills that were not replicated become extra misses. Deletes and tombstones that were not replicated are worse: the old value is back and is served as a hit.',
      detection:
        'The failover event, the replication offset gap at promotion, and a sampled comparison of cached versions against the database that reports a stale-hit rate.',
      recovery:
        'A replayer reads the change topic again from before the replication gap and sends the deletes for keys in the slots of that shard, which is safe because they are idempotent; the main consumer keeps its position. Anything still missed expires with its TTL. A new replica syncs from the new primary.',
    },
    {
      scenario: 'A whole shard is lost, and later comes back.',
      impact:
        'A quarter of the keys move to the neighbors and start cold, so about a quarter of the reads that reach the shards, 10K a second, miss at first. That is far more than the database is allowed to take, so part of those reads fail fast. If the old node only lost its network and returns with its memory intact, it holds entries that missed every delete sent while it was away.',
      detection:
        'Healthy shards 3 / 4, a drop in hit ratio, a rise in loads per second and in load-queue wait time.',
      recovery:
        'Single flight keeps it to about one load per key and the cap on concurrent loads holds the database at about 4K loads a second. Reads over the cap fail fast, about 5% of all reads in the first seconds. Hot keys are warm again within seconds, the long tail within minutes. A node always rejoins the ring empty: it is flushed first, then given its range back, which causes a second, smaller round of misses.',
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
        'Misses are spread over millions of distinct keys, so single flight only helps for the hot ones. The local caches still answer a fifth of the reads, so the database would see about 40K of the 50K reads per second that overloaded it before the cache existed.',
      detection:
        'Hit ratio near zero, the load queue at its cap, database connections and CPU saturated.',
      recovery:
        'The cap on concurrent loads lets about 4K loads a second through and sheds the rest: those reads fail fast instead of piling up on the database. Traffic is shifted to the cold cluster in steps, or shards are restarted one at a time, so only a fraction of the keys is cold at any moment. The cluster ends warm with no repair needed.',
    },
    {
      scenario:
        'A client, or an attacker, requests IDs that do not exist, millions of different ones.',
      impact:
        'Each request is a miss for a key that will never be filled, so it reaches the database. Single flight does not help because every key is different.',
      detection:
        'A rising share of loads that return no row, database reads above plan while the hit ratio drops, and one client or IP behind most of them.',
      recovery:
        'Repeated IDs become hits through the "not found" markers. For a scan of random IDs, rate limits per client cut the source, and a Bloom filter of existing IDs rejects the rest before the database. Nothing is stale afterwards; markers expire in seconds.',
    },
  ],
  capacity: {
    assumptions: [
      '1M users and a peak of 50K reads per second, as in the walkthrough; about 50 reads for every write.',
      'The local caches answer about 20% of the reads (the hottest keys). The shared cache hits on 95% of the rest.',
      '30M cacheable entries of about 1 KB each, counting key, value and per-entry overhead. Default TTL of 10 minutes with jitter; shorter or longer per key family (see the deep dive on TTLs).',
      'A cache node has about 13 GB of memory, like an ElastiCache cache.r7g.large, of which about 10 GB is the data budget; the rest is reserved for fragmentation, replication buffers and background saves.',
      'An application server handles about 500 requests per second.',
    ],
    estimates: [
      {
        label: 'Reads reaching the shards',
        value: '~40K/s',
        math: '50K/s × (1 − 0.20 served locally) = 40K/s, 10K/s per shard. Far below what one node can serve.',
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
        value: '30 GB of data, about 104 GB provisioned',
        math: '30M entries × 1 KB = 30 GB. 3 shards of 10 GB would run 100% full, past the 90% memory alarm, so 4 shards at 7.5 GB each, 75% full; × 2 for replicas = 8 nodes × 13 GB = 104 GB.',
      },
      {
        label: 'Keys moved when a shard is added',
        value: '~20%, not ~80%',
        math: 'Consistent hashing, 4 → 5 shards: 1/5 of 30M = 6M keys move. With hash mod N only the keys where h mod 4 = h mod 5 stay, 4 in 20, so 80% move.',
      },
      {
        label: 'Misses when a shard is lost',
        value: '~10K/s at first',
        math: '40K/s ÷ 4 shards = 10K reads/s start cold, on top of the usual 2K/s: 12K loads/s asked for, about a quarter of the load that used to overload the database. Single flight collapses repeated reads of hot keys to about 6.5K loads/s, the cap admits 4K and the other 2.5K fail fast, 5% of the 50K reads, falling as keys warm up.',
      },
    ],
    implications: [
      'Memory sets the shard count, not throughput: each shard is asked for 10K operations a second and could serve several times that. Scaling out is driven by data size and hit ratio.',
      'The database is sized for about 2K loads per second with headroom up to 4K, which is where the cap on concurrent loads sits, not for 50K. That makes the cache part of the capacity plan, so the stampede and cold-start protections are required, not optional.',
      'Hit ratio is the number to watch. Going from 95% to 90% doubles the database reads, so eviction rate and hit ratio have alarms before latency does.',
      'A lost shard costs about 5% of the reads for a short time (12K loads a second asked for, 4K admitted). A lost cluster fails most of them (40K asked for). Hence replicas, one-at-a-time restarts and a cap on concurrent loads.',
      'With 100 application servers, a local cache of about 1,000 entries of 1 KB costs about 1 MB each and removes a fifth of the network calls. It is cheap, and it is also where the few seconds of extra staleness come from.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one region across three Availability Zones. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'App servers and local cache',
        service: 'Amazon ECS on AWS Fargate, with an in-process LRU',
        why: 'The local cache is a library inside each server, bounded by entries and a TTL of a few seconds; nothing extra to run.',
        watch:
          'Custom: local hit ratio, entries and evictions per server; ECS MemoryUtilization, since the local cache lives in the task’s memory.',
      },
      {
        part: 'Cache shards',
        service:
          'Amazon ElastiCache for Valkey or Redis OSS, cluster mode, 4 shards × 2 nodes, cache.r7g.large',
        why: 'Cluster mode spreads 16,384 hash slots over the shards, the managed form of the ring, and reshards online by moving slots. Each shard has a replica in another zone.',
        watch:
          'CacheHitRate, Evictions, DatabaseMemoryUsagePercentage, EngineCPUUtilization, CurrConnections, NetworkBandwidthOutAllowanceExceeded.',
      },
      {
        part: 'Failover',
        service: 'ElastiCache Multi-AZ with automatic failover',
        why: 'A failed primary is replaced by its replica without an operator; clients refresh the slot map and keep going.',
        watch:
          'ReplicationLag on replicas, and failover events from ElastiCache events in EventBridge.',
      },
      {
        part: 'Single flight and versioned fills',
        service:
          'SET NX with an expiry for the load lock, and a Valkey script or function for the versioned SET',
        why: 'The lock key carries the entry’s key as a hash tag, lock:{item:42}, so both hash to the same slot and each command runs atomically on the shard that owns the key. No extra lock service is needed.',
        watch:
          'Custom: loads per second, load-queue wait time and loads in flight against the cap; fills rejected for an older version.',
      },
      {
        part: 'Database',
        service: 'Amazon Aurora PostgreSQL, a writer and read replicas',
        why: 'The source of truth, sized for about 2K loads a second with headroom up to the 4K cap. Each row carries a version column that only grows.',
        watch:
          'CPUUtilization, DatabaseConnections, ReadIOPS, and AuroraReplicaLag if loaders read from replicas.',
      },
      {
        part: 'Change stream',
        service: 'Aurora logical replication, Debezium on Amazon MSK Connect, an Amazon MSK topic',
        why: 'Every committed write, from any writer, becomes an ordered event per row, retained long enough to replay after a failover.',
        watch:
          'The connector’s lag behind the database, MSK consumer group lag, and the replication slot’s retained WAL on Aurora.',
      },
      {
        part: 'Invalidator',
        service: 'A small consumer on Amazon ECS',
        why: 'Deletes keys and writes tombstones, and commits its offset only after the delete succeeded. After a failover a second instance, the replayer, reads the topic again for the affected slots.',
        watch:
          'Custom: lag in seconds behind the latest commit, deletes that found the key still present, errors.',
      },
      {
        part: 'Security',
        service:
          'Private subnets and security groups, TLS in transit, at-rest encryption with AWS KMS, ElastiCache RBAC users, AWS Secrets Manager',
        why: 'Only the app and the invalidator can connect, each with its own user and allowed commands, and passwords rotate without code changes.',
        watch: 'AuthenticationFailures and CommandAuthorizationFailures on ElastiCache.',
      },
      {
        part: 'Observability and cost',
        service: 'Amazon CloudWatch dashboards and alarms, AWS Cost Explorer',
        why: 'One dashboard with the SLOs and the alarms below. The bill is mostly cache node-hours, doubled by replicas, so memory per entry and TTLs are cost levers, not only freshness levers.',
        watch:
          'The SLO dashboard, and ElastiCache, MSK and Aurora as separate lines in Cost Explorer.',
      },
    ],
    limits: [
      'One key lives in one hash slot on one shard, and a slot cannot be split. A single hot key is capped by one node, however many shards there are; that is what the local cache and key copies are for.',
      'Each cache node has a baseline network bandwidth and a burst allowance. Large values hit the bandwidth limit before CPU or memory; NetworkBandwidthOutAllowanceExceeded shows it.',
      'ElastiCache reserves part of each node’s memory for background work; on a 13 GB node about 10 GB is the data budget, which is what the capacity plan uses.',
      'Replication is asynchronous, so a failover can lose the last writes, deletes included. A replayer reads the change topic again from before that gap for the affected slots.',
      'Cluster mode does not hand the slots of a lost shard to its neighbors, as the generic ring in the walkthrough does. If every node of a shard fails, its slots have no owner until ElastiCache replaces the nodes, and the replacements start empty. The application treats reads for those slots as misses under the load cap.',
      'An Aurora logical replication slot keeps WAL until the connector reads it. A stalled connector fills the database’s storage, so its lag has an alarm.',
    ],
  },
  slos: [
    {
      objective: 'Read latency',
      target: '95% of reads under 5 ms and 99% under 50 ms, hits and misses included',
      measure:
        'Client-side latency of get, measured in the application, split by local hit, shared hit and miss.',
    },
    {
      objective: 'Hit ratio',
      target: 'Shared cache hit ratio at or above 95%',
      measure:
        'The client’s own counter: reads that hit on their first GET, over reads that reach the shards. ElastiCache CacheHitRate is the cross-check and reads lower, because the repeated GETs of requests waiting on a load count as misses. Each point lost adds about 400 loads a second to the database.',
    },
    {
      objective: 'Freshness',
      target: 'Change stream applied within 5 s of commit, 99% of the time',
      measure:
        'The invalidator’s lag behind the latest database commit, in seconds, not in events.',
    },
    {
      objective: 'Database protected',
      target: 'Database reads under 4K a second, twice the planned 2K',
      measure:
        'The loaders’ own counter of loads per second, summed across servers, since each load is one known query. 4K is where the load cap sits: at the cap reads are being shed and the cache is not doing its job.',
    },
  ],
  alarms: [
    {
      name: 'Hit ratio falling',
      metric:
        'Shared hit ratio from the client counter: below 95%, the SLO, warns; below 93% for 10 minutes pages',
      meaning:
        'The working set outgrew memory or a key family stopped caching; the database load is about to double.',
    },
    {
      name: 'Memory full',
      metric: 'Evictions rising with DatabaseMemoryUsagePercentage above 90%',
      meaning:
        'Entries still being read are being evicted; add a shard or cut TTLs and value sizes.',
    },
    {
      name: 'Hot shard',
      metric: 'EngineCPUUtilization above 80% on one shard while the others are low',
      meaning: 'A hot key or a hot slot; check the local cache and consider copies of that key.',
    },
    {
      name: 'Bandwidth limit',
      metric: 'NetworkBandwidthOutAllowanceExceeded above zero',
      meaning:
        'Values are too large for the node’s network; compress them or move to a larger node class.',
    },
    {
      name: 'Stale cache risk',
      metric:
        'Invalidator lag above 5 s, the SLO, warns; above 30 s, or the connector’s lag growing, pages',
      meaning:
        'Writes from other services are not being invalidated; stale reads last up to the TTL, and Aurora is holding WAL.',
    },
    {
      name: 'Not-found storm',
      metric: 'Custom: loads returning no row above 20% of loads for 5 minutes',
      meaning:
        'Something is asking for keys that do not exist; check the top clients and turn on rate limits or the Bloom filter.',
    },
    {
      name: 'Database under a miss storm',
      metric: 'Aurora CPUUtilization above 70% with load-queue wait time rising',
      meaning:
        'A shard was lost or the cluster went cold; the cap on concurrent loads should be shedding the excess.',
    },
  ],
  evolution: {
    mvp: 'One cache node with a replica, cache-aside with a TTL and delete on write in the application. No local cache, no ring, no change stream, no versions. This is enough while the data fits in one node, the application is the only writer and a stale read for one TTL is acceptable.',
    atScale: [
      'Between the MVP and the design above (50K reads/s, 30 GB): the data outgrows one node, so shards and a shared slot map come first. Hot key detection and the local cache follow when one key saturates a shard, the change stream when a writer appears that does not know the cache, and versioned fills for the families where a stale read hurts.',
      'At 10x (500K reads/s, about 300 GB): about 40 shards at the same 75% fill. Resharding stops being an event and becomes routine work, one slot range at a time.',
      'Also at 10x: about 1,000 application servers each holding connections to 40 shards. A proxy tier or a sidecar starts to pay for itself by pooling connections and owning the slot map.',
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
