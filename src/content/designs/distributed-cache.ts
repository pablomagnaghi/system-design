import type { Design } from '../types';

export const distributedCache: Design = {
  slug: 'distributed-cache',
  title: 'Distributed cache',
  summary:
    'Put a shared, in-memory cache in front of a database so reads take a millisecond instead of tens, without serving data that stays wrong, melting the database on a miss storm or losing everything when a node dies.',
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Get, set and delete values by key, with an optional time to live.',
      'Serve reads for many application servers from one logical cache.',
      'Keep cached data close to the database: changes show up quickly.',
    ],
    nonFunctional: [
      'Reads in about a millisecond at hundreds of thousands of requests per second.',
      'Scale out by adding nodes, moving as few keys as possible.',
      'Stay available when a node fails, and never let a miss storm take the database down.',
      'Bounded staleness: seconds, not hours.',
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
      'Follow one read from the application to the cache and, on a miss, to the database; then see how writes, evictions and failures keep the cache honest. Press play, or step through the stages.',
    nodes: [
      { id: 'local', title: 'Local cache', detail: 'Hottest keys, seconds', column: 0, row: 'top' },
      { id: 'app', title: 'App servers', detail: 'Cache-aside client', column: 0, row: 'middle' },
      { id: 'ring', title: 'Hash ring', detail: 'Picks the shard', column: 1, row: 'middle' },
      { id: 'shardA', title: 'Shard A', detail: 'Primary + replica', column: 2, row: 'top' },
      { id: 'shardB', title: 'Shard B', detail: 'Primary + replica', column: 2, row: 'middle' },
      { id: 'shardC', title: 'Shard C', detail: 'Primary + replica', column: 2, row: 'bottom' },
      {
        id: 'loader',
        title: 'Single flight',
        detail: 'One load per key',
        column: 3,
        row: 'middle',
      },
      { id: 'db', title: 'Database', detail: 'Source of truth', column: 4, row: 'middle' },
      {
        id: 'changes',
        title: 'Change stream',
        detail: 'Every write, any writer',
        column: 4,
        row: 'bottom',
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
        title: 'Check the local cache first',
        narration:
          'Each application server keeps a tiny in-process cache for the hottest keys, with a TTL of a few seconds. Most reads of a viral item never leave the server.',
        tradeoff:
          'A local cache removes the network hop and absorbs hot keys, but every server holds its own copy, so it costs memory and can be a few seconds stale. Keeping it small and short-lived limits both.',
        nodes: ['app', 'local'],
        travel: [['app', 'local']],
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
      },
      {
        title: 'Hit: answer from memory',
        narration:
          'The shard has the key and answers from memory in well under a millisecond. Each shard has a replica that can take over or serve reads.',
        tradeoff:
          'Replicas give failover and extra read capacity. Replication is asynchronous to keep writes fast, so right after a failover a few recent writes can be missing; for a cache that only means a few extra misses.',
        nodes: ['shardA', 'shardB', 'shardC'],
        travel: [
          ['ring', 'shardA'],
          ['ring', 'shardC'],
        ],
      },
      {
        title: 'Miss: only one request loads',
        narration:
          'On a miss, requests for the same key are coalesced: one of them takes a short lock and loads from the database, and the others wait for its result.',
        tradeoff:
          'Without coalescing, a popular key expiring sends thousands of identical queries to the database at once. A per-key lock adds a little latency for the waiters, and turns a stampede into a single query.',
        nodes: ['shardB', 'loader'],
        travel: [['shardB', 'loader']],
      },
      {
        title: 'Load and fill with a jittered TTL',
        narration:
          'The loader reads from the database, writes the value into the cache with a TTL, and returns it. Each TTL gets a small random jitter.',
        tradeoff:
          'A TTL bounds how stale an entry can get even if an invalidation is lost; shorter TTLs mean fresher data and more misses. Jitter avoids thousands of keys written together expiring together.',
        nodes: ['loader', 'db'],
        travel: [['loader', 'db']],
      },
      {
        title: 'Writes delete, they do not update',
        narration:
          'When the application changes data, it writes the database first and then deletes the cached key. The next read loads the new value.',
        tradeoff:
          'Updating the cache in place looks faster, but two concurrent writers can leave the older value in the cache for its whole TTL. Deleting costs one extra miss and cannot leave a wrong value behind.',
        nodes: ['app', 'db'],
        travel: [],
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
      },
      {
        title: 'Evict when memory is full',
        narration:
          'Each shard has a fixed memory budget. When it fills up, the least recently used entries are evicted first.',
        tradeoff:
          'LRU is simple and fits most read patterns. LFU keeps steadily popular keys better but adapts slower when popularity shifts. Watching the eviction rate tells you when the cache is simply too small.',
        nodes: ['shardA', 'shardB', 'shardC'],
        travel: [],
      },
      {
        title: 'When a shard dies',
        narration:
          'If a primary fails, its replica is promoted. If the whole shard is lost, its keys move to the neighbors on the ring and start cold, while the single-flight loads keep the database from being flooded.',
        tradeoff:
          'Replicas double the memory bill in exchange for fast failover. Without them, losing a node is still safe, but the database absorbs a burst of misses until the keys warm up again.',
        nodes: ['ring', 'shardA', 'shardC', 'loader'],
        travel: [],
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
          pros: 'A fill carrying an older version than the stored one is rejected.',
          cons: 'Needs a version or timestamp from the database on every row.',
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
};
