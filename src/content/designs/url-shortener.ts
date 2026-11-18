import type { Design } from '../types';

export const urlShortener: Design = {
  slug: 'url-shortener',
  title: 'URL shortener',
  summary:
    'Turn long links into short codes and redirect every click in about ten milliseconds, with codes that never collide, reads that scale far beyond writes and click counts that never slow a redirect down.',
  difficulty: 'Easy',
  minutes: 8,
  requirements: {
    functional: [
      'Create a short link for a long URL, optionally with a custom alias and an expiry date.',
      'Redirect anyone who opens the short link to the original URL.',
      'Show the owner how many times a link was clicked.',
    ],
    nonFunctional: [
      'Redirects in about ten milliseconds at the server (p95), at a peak of about a hundred thousand per second.',
      'Reads outnumber writes by about a hundred to one; billions of links stored over time.',
      'Codes are unique and short: seven characters or fewer.',
      'Redirects stay up even when link creation or analytics are degraded.',
    ],
    outOfScope: [
      'Spam and malware scanning of target URLs (a separate pipeline would check them).',
      'Editing the target of an existing link.',
    ],
  },
  entities: [
    {
      name: 'Link',
      description: 'Short code, long URL, owner, creation time and an optional expiry.',
    },
    { name: 'ID range', description: 'A block of numeric IDs leased to one server at a time.' },
    { name: 'Click', description: 'A code, a timestamp and coarse context such as country.' },
  ],
  api: [
    {
      method: 'POST',
      path: '/links',
      description: 'Body: long URL, optional alias and expiry. Returns the short code.',
    },
    {
      method: 'GET',
      path: '/{code}',
      description: 'Redirects to the long URL, or returns 404 if the code is unknown or expired.',
    },
    {
      method: 'GET',
      path: '/links/{code}/stats',
      description: 'Click counts for the owner, a few seconds behind real time.',
    },
  ],
  dataFlow: [
    'On create, the shorten service takes the next ID from its leased range, encodes it in base 62 and stores the mapping.',
    'On a click, the redirect service looks the code up in a cache and falls back to the store on a miss.',
    'It answers with a redirect and emits a click event without waiting for it.',
    'A consumer aggregates click events into per-link counts for the stats endpoint.',
  ],
  highLevel: {
    label: 'Create a link, then follow a click',
    intro:
      'First follow a new link from the request to the store. Then follow a click, watch a viral link overload the store, and see the cache and the click stream join the design as it grows. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      { id: 'client', title: 'Clients', detail: 'Browsers and apps', column: 0, row: 'middle' },
      { id: 'gateway', title: 'Gateway', detail: 'Routing, rate limits', column: 1, row: 'middle' },
      {
        id: 'shorten',
        title: 'Shorten service',
        detail: 'Creates links',
        column: 2,
        row: 'top',
      },
      { id: 'ids', title: 'ID allocator', detail: 'Leases ID ranges', column: 3, row: 'top' },
      {
        id: 'redirect',
        title: 'Redirect service',
        detail: 'Code to URL',
        column: 2,
        row: 'middle',
      },
      {
        id: 'cache',
        title: 'Cache',
        detail: 'Hot codes in memory',
        column: 3,
        row: 'middle',
        appearsAt: 5,
      },
      { id: 'store', title: 'Link store', detail: 'Key-value, by code', column: 4, row: 'middle' },
      {
        id: 'clicks',
        title: 'Click stream',
        detail: 'Durable event log',
        column: 3,
        row: 'bottom',
        appearsAt: 8,
      },
      {
        id: 'counts',
        title: 'Click counts',
        detail: 'Aggregated per link',
        column: 4,
        row: 'bottom',
        appearsAt: 8,
      },
    ],
    edges: [
      ['client', 'gateway'],
      ['gateway', 'shorten', 'create'],
      ['shorten', 'ids', 'lease'],
      ['shorten', 'store'],
      ['gateway', 'redirect', 'click'],
      ['redirect', 'cache'],
      ['cache', 'store', 'miss'],
      ['redirect', 'clicks', 'event'],
      ['clicks', 'counts'],
    ],
    stages: [
      {
        title: 'Ask for a short link',
        narration:
          'A client posts a long URL to the gateway, which checks the caller and its rate limit and forwards the request to the shorten service. The service validates the URL and normalizes it.',
        tradeoff:
          'Rate limiting at the gateway keeps one script from burning through the code space or flooding the store. Putting create and redirect behind separate services lets the read path scale on its own, at the cost of two deployments instead of one.',
        nodes: ['client', 'gateway', 'shorten'],
        travel: [
          ['client', 'gateway'],
          ['gateway', 'shorten', 'create'],
        ],
        short: 'Create',
        metrics: { users: '10K', requestsPerSecond: '20', p95Latency: '40 ms', errorRate: '0%' },
        load: { shorten: 10 },
      },
      {
        title: 'Take the next ID from a leased range',
        narration:
          'Each shorten server leases a block of, say, ten thousand IDs from the allocator and hands them out locally. The next free ID is encoded in base 62, so seven characters cover trillions of links.',
        tradeoff:
          'A counter guarantees uniqueness without checking the store, as long as the allocator durably records each lease before it hands the range out, and leasing ranges means the allocator is touched once every ten thousand links. The cost is that codes are sequential and guessable, and a crashed server wastes the rest of its range; both are usually acceptable, and a reversible shuffle can hide the order.',
        nodes: ['shorten', 'ids'],
        travel: [['shorten', 'ids', 'lease']],
        short: 'Next ID',
        metrics: { users: '10K', requestsPerSecond: '20', p95Latency: '40 ms', errorRate: '0%' },
        load: { shorten: 12, ids: 3 },
      },
      {
        title: 'Store the mapping',
        narration:
          'The service writes code, long URL, owner and expiry to a key-value store partitioned by code, and returns the short link. A custom alias uses a conditional insert that fails if the code already exists.',
        tradeoff:
          'A key-value store fits the single access pattern, lookup by code, and partitions evenly. It gives up rich queries, so listing links by owner needs a small secondary index. The conditional insert is the only place where two writers can race, and the store settles it.',
        nodes: ['shorten', 'store'],
        travel: [['shorten', 'store']],
        short: 'Store',
        metrics: { users: '10K', requestsPerSecond: '20', p95Latency: '40 ms', errorRate: '0%' },
        load: { shorten: 12, store: 5 },
      },
      {
        title: 'A click arrives',
        narration:
          'Someone opens the short link. The gateway sends the request to the redirect service, a stateless fleet that does nothing but turn codes into URLs.',
        tradeoff:
          'Keeping the redirect path tiny and stateless makes it cheap to scale out and easy to keep up, even when link creation is having trouble. The price is a little duplicated plumbing, such as auth and config, across two services.',
        nodes: ['client', 'gateway', 'redirect'],
        travel: [
          ['client', 'gateway'],
          ['gateway', 'redirect', 'click'],
        ],
        short: 'Click',
        metrics: { users: '100K', requestsPerSecond: '1K', p95Latency: '30 ms', errorRate: '0%' },
        load: { redirect: 15, store: 20 },
      },
      {
        title: 'A link goes viral',
        narration:
          'One link is shared widely and clicks jump a hundredfold. Every click is still a read on the link store, and the partition that holds the viral code saturates: latency climbs and some redirects time out.',
        tradeoff:
          'Adding store nodes barely helps, because every one of those reads targets the same key on the same partition. Reads outnumber writes by orders of magnitude and a few codes take most of them, which is exactly the shape a cache is built for.',
        nodes: ['gateway', 'redirect', 'store'],
        travel: [
          ['client', 'gateway'],
          ['gateway', 'redirect', 'click'],
        ],
        short: 'Viral link',
        metrics: {
          users: '10M',
          requestsPerSecond: '100K',
          p95Latency: '1.8 s',
          errorRate: '6%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { redirect: 70, store: 98 },
        traffic: [{ edge: ['gateway', 'redirect'], kind: 'failed' }],
      },
      {
        title: 'Hit: answer from the cache',
        narration:
          'A cache joins the read path. The redirect service looks the code up in memory first, and because link popularity is very skewed, a modest cache holding the hottest codes answers the large majority of clicks.',
        tradeoff:
          'Links almost never change, so caching them is safe and staleness is barely a concern. The cost is memory and one more system to run; a deleted link keeps redirecting until its cached entry is invalidated, or for the TTL of hours if the invalidation is lost. Expiry needs no invalidation, because the expiry time is cached with the entry and checked on every read.',
        nodes: ['redirect', 'cache'],
        travel: [['redirect', 'cache']],
        short: 'Cache hit',
        metrics: { users: '10M', requestsPerSecond: '100K', p95Latency: '8 ms', errorRate: '0.1%' },
        load: { redirect: 45, cache: 35, store: 8 },
      },
      {
        title: 'Miss: read the store and fill',
        narration:
          'On a miss, the code is read from the link store and written into the cache. Unknown codes are cached too, as a short-lived "not found", so repeated bad codes do not reach the store.',
        tradeoff:
          'Read-through keeps the cache filled with exactly what people click. Negative caching protects the store from scanners guessing codes, at the risk of a brand new link answering 404 for a few seconds if someone guessed it first.',
        nodes: ['cache', 'store'],
        travel: [['cache', 'store', 'miss']],
        short: 'Cache miss',
        metrics: {
          users: '10M',
          requestsPerSecond: '100K',
          p95Latency: '12 ms',
          errorRate: '0.1%',
        },
        load: { cache: 38, store: 12 },
      },
      {
        title: 'Answer with a temporary redirect',
        narration:
          'The service returns a 302 with the long URL in the Location header. Expired links answer 404 or 410 instead.',
        tradeoff:
          'A permanent 301 lets browsers and edges cache the redirect, which saves load but hides every repeat click from analytics and makes expiry unreliable. A 302 keeps every click visible and expiry honest, at the cost of serving every click ourselves.',
        nodes: ['redirect', 'client'],
        travel: [],
        short: 'Redirect',
        metrics: {
          users: '10M',
          requestsPerSecond: '100K',
          p95Latency: '12 ms',
          errorRate: '0.1%',
        },
        load: { redirect: 45 },
      },
      {
        title: 'Record the click off the hot path',
        narration:
          'After answering, the redirect service emits a click event to a durable stream. A consumer aggregates events into per-link counts every few seconds.',
        tradeoff:
          'Writing a counter row on every click would put a database write inside each redirect and create hot rows for viral links. The stream decouples them: redirects stay fast, and counts lag by a few seconds. If the stream is down, events are dropped rather than failing redirects.',
        nodes: ['redirect', 'clicks', 'counts'],
        travel: [
          ['redirect', 'clicks', 'event'],
          ['clicks', 'counts'],
        ],
        short: 'Count clicks',
        metrics: {
          users: '10M',
          requestsPerSecond: '100K',
          p95Latency: '12 ms',
          errorRate: '0.1%',
        },
        load: { redirect: 45, clicks: 40, counts: 20 },
      },
      {
        title: 'Expire old links',
        narration:
          'Links past their expiry are rejected at read time, and a background job deletes them from the store in batches. Codes are not reused.',
        tradeoff:
          'Checking expiry on read means correctness never depends on the cleanup job running on time. Never reusing codes wastes a sliver of the code space, but prevents an old printed link from silently pointing somewhere new.',
        nodes: ['store', 'cache'],
        travel: [],
        short: 'Expire',
        metrics: {
          users: '10M',
          requestsPerSecond: '100K',
          p95Latency: '12 ms',
          errorRate: '0.1%',
        },
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we generate unique short codes?',
      options: [
        {
          name: 'Hash the long URL and truncate',
          pros: 'The same URL can map to the same code; no coordination needed.',
          cons: 'Truncated hashes collide, so every insert needs a check and a retry.',
        },
        {
          name: 'Random code with a collision check',
          pros: 'Codes are unguessable and spread evenly.',
          cons: 'Every insert is a conditional write, and retries grow as the space fills.',
        },
        {
          name: 'Counter with leased ranges, base 62',
          pros: 'Unique by construction, short, and the allocator is rarely touched.',
          cons: 'Sequential codes leak volume unless shuffled; crashed servers waste IDs.',
        },
      ],
      choice:
        'A counter with leased ranges, passed through a reversible shuffle before encoding. It never collides, needs no read before write, and the shuffle hides the order. Custom aliases use the conditional insert path.',
    },
    {
      question: 'Permanent or temporary redirects?',
      options: [
        {
          name: '301 permanent',
          pros: 'Browsers and edges cache it; repeat clicks never reach us.',
          cons: 'Repeat clicks are invisible to analytics, and an expired link may keep working.',
        },
        {
          name: '302 temporary',
          pros: 'Every click reaches us, so it can be counted, and expiry or takedown takes effect once cached entries are invalidated or expire.',
          cons: 'Every click costs a request to our servers.',
        },
      ],
      choice:
        '302 by default, because analytics and takedowns are part of the product. The cache makes each redirect cheap enough that serving them all is affordable.',
    },
    {
      question: 'How do we survive a viral link?',
      options: [
        {
          name: 'Rely on the shared cache',
          pros: 'Nothing extra; one hot key is a single cache read.',
          cons: 'All traffic for that code lands on one cache node.',
        },
        {
          name: 'Small local cache in each redirect server',
          pros: 'The hot code is served from process memory everywhere.',
          cons: 'A deleted link may keep redirecting for the local TTL, since local entries cannot be invalidated.',
        },
        {
          name: 'Short edge caching of the 302',
          pros: 'Absorbs bursts close to users.',
          cons: 'Clicks served at the edge must be counted from edge logs instead.',
        },
      ],
      choice:
        'A local cache of a few seconds in every redirect server. It flattens hot keys with almost no cost in freshness, and keeps all counting in one place.',
    },
  ],
  wrapUp:
    'Leased ID ranges encoded in base 62 for collision-free codes, a key-value store by code, a read-through cache with negative entries in front of it, 302 redirects from a stateless fleet, and click counting through a stream that never slows a redirect.',
  guarantees: {
    provides: [
      {
        property: 'Code uniqueness',
        promise:
          'A code maps to at most one link, forever. The allocator records the new high-water mark with a synchronously replicated, conditional write before it returns a range, so ranges are disjoint; the shuffle is a bijection, so distinct IDs give distinct codes. Every insert, generated or custom, is a put-if-absent, which settles alias races and catches a generated code that lands on an existing alias: the server skips that ID and takes the next one.',
      },
      {
        property: 'Durability of a created link',
        promise:
          'A link is acknowledged only after the store has written it to a quorum of replicas in different zones. A create that fails or times out may or may not exist, and a retry gets a new code rather than a duplicate of the old one.',
      },
      {
        property: 'Redirect freshness',
        promise:
          'Redirects are eventually consistent with bounded staleness. Expiry is enforced on every read, cached or not, to within clock skew. A deleted link stops redirecting once the shared entry is invalidated and the local caches age out, which is seconds; if the invalidation is lost, the bound is the shared TTL of hours.',
      },
      {
        property: 'Click counting',
        promise:
          'Best effort into the stream: the redirect server emits each event at most once and drops it if the stream is unavailable. From the stream to the counts, events are processed at least once, made harmless by storing each partition offset in the same transaction as the counts it produced. Counts can therefore run low, never high.',
      },
      {
        property: 'Redirect availability',
        promise:
          'The redirect path depends only on the cache and the link store. An outage of the shorten service, the allocator, the click stream or the aggregator does not fail a redirect.',
      },
    ],
    assumes: [
      'The allocator keeps its high-water mark in a store with consensus or synchronous replication, so a failover never rolls it back.',
      'The link store offers a conditional insert and quorum writes across at least three zones.',
      'Server clocks are synchronized to well under a second, since expiry is compared against local time.',
      'Links are immutable apart from deletion and expiry, which is what makes hours-long caching safe.',
      'Link popularity is heavily skewed, so a cache far smaller than the store answers most clicks.',
    ],
    doesNotGuarantee: [
      'Unguessable codes. The shuffle hides creation order but is not a secret; private links need long random tokens or an access check.',
      'Exact click counts. Events are dropped when the stream is down or a redirect server dies with events still in memory, so counts are not fit for billing.',
      'Instant takedown. A deleted link can redirect for a few seconds, and for hours in the worst case of a lost invalidation.',
      'One code per URL. Shortening the same URL twice, or retrying a timed-out create, gives two codes.',
      'Dense IDs. A crashed or restarted server abandons the rest of its range.',
    ],
  },
  failures: [
    {
      scenario: 'A shared cache node is lost, or the whole cache restarts cold.',
      impact:
        'The clicks that node answered become store reads. Losing the entire cache sends close to the full click rate to a store sized for the miss rate, so latency climbs and some redirects time out, as in the viral stage.',
      detection:
        'Cache hit ratio falling below its normal band, with store read latency and throttled reads rising at the same time.',
      recovery:
        'Consistent hashing limits a node loss to that node’s share of keys. Local caches keep the hottest codes for a few seconds, each redirect server collapses concurrent misses for one code into a single store read, and a cap on in-flight store reads sheds the excess as fast errors. The cache refills from clicks within minutes; no data is lost because the cache holds nothing the store does not.',
    },
    {
      scenario:
        'A shorten server crashes between taking an ID and answering the client, before or after the store write.',
      impact:
        'Before the write, the ID is wasted along with the rest of the range. After the write, the link exists but the client never learns its code and retries, which creates a second link for the same URL.',
      detection:
        'A gap between IDs leased and links stored, tracked as a ratio. It needs no alarm unless it grows, which would point at a crash loop burning ranges.',
      recovery:
        'The restarted server leases a fresh range; the old one is never reissued. The orphan link is valid and harmless and stays until it expires. A caller that cannot tolerate duplicates sends an idempotency key, stored with the link and checked on retry.',
    },
    {
      scenario: 'The allocator fails over to a replica.',
      impact:
        'Shorten servers keep creating from the ranges they already hold, which lasts minutes at peak rates, then creates fail; redirects are unaffected. If the high-water mark were replicated asynchronously, the new primary could issue a range a second time.',
      detection:
        'Lease error rate and lease latency for the outage. For a reissued range, a counter of put-if-absent conflicts on generated codes, which is otherwise near zero and alarms on any burst.',
      recovery:
        'With synchronous replication the new primary continues from the last recorded mark. If a range is reissued anyway, the conditional insert rejects each duplicate, the server abandons the range and leases another, and no link is overwritten.',
    },
    {
      scenario:
        'A link is deleted, and the cache invalidation is lost or races with a fill from a reader that saw the old row.',
      impact:
        'The link keeps redirecting from the shared cache, for up to the TTL of hours. For a takedown of a harmful target, that is the worst case that matters.',
      detection:
        'A verification step in the delete flow that requests the code through the redirect path a few seconds later and expects a 404, plus a count of invalidations that exhausted their retries.',
      recovery:
        'The delete marks the row deleted in the store first, then overwrites the cache entry with a "deleted" marker instead of removing the key, and fills only add a key that is absent, so a late fill cannot replace the marker. Failed invalidations are retried from a queue. Local caches clear on their own within seconds.',
    },
    {
      scenario: 'The click stream is unavailable or slow to accept events.',
      impact:
        'Redirects are unaffected. Events queue in a small bounded buffer on each redirect server and are dropped when it fills, so counts for that window are low.',
      detection:
        'A dropped-events counter on the redirect servers and the produce error rate. Comparing daily counts against gateway request logs shows the size of the gap.',
      recovery:
        'Counting resumes when the stream returns. The gap is permanent unless it is backfilled from the request logs, which is a batch job run only for outages large enough to matter.',
    },
    {
      scenario: 'The aggregator crashes after reading a batch of clicks, or falls far behind.',
      impact:
        'Stats stop advancing or lag by minutes instead of seconds. No redirect is affected and no event is lost while the stream retains it.',
      detection:
        'Consumer lag per partition, alarmed well before it approaches the stream’s retention period.',
      recovery:
        'A restarted consumer resumes from the offset stored with the counts, so a batch that was applied is not applied again and one that was not is replayed. Lag is worked off by adding consumers up to the partition count.',
    },
  ],
  capacity: {
    assumptions: [
      'About 400 new links per second on average, and 100 clicks for every link created.',
      'Peak click rate is about 2.5 times the average, driven by viral links rather than time of day.',
      'A stored link takes about 500 bytes (a long URL, metadata and store overhead), kept for five years with three replicas.',
      'About 100 million distinct codes are clicked on a given day, and a cached entry takes about 300 bytes.',
      'A click event is about 100 bytes and the stream retains seven days.',
      'A redirect server handles about 5,000 requests per second when most are cache hits.',
    ],
    estimates: [
      {
        label: 'Redirect rate',
        value: '~40K per second average, ~100K peak',
        math: '400 creates/s × 100 = 40,000 clicks/s; × 2.5 peak factor = 100,000/s. About 3.5 billion clicks per day.',
      },
      {
        label: 'Code space',
        value: '~63 billion links in five years, under 2% of seven characters',
        math: '400/s × 86,400 s ≈ 35M links/day × 365 × 5 ≈ 63B. 62^7 ≈ 3.5 trillion, so 63B ÷ 3.5T ≈ 1.8%.',
      },
      {
        label: 'Link storage',
        value: '~32 TB logical, ~95 TB replicated',
        math: '63B links × 500 bytes ≈ 32 TB; × 3 replicas ≈ 95 TB.',
      },
      {
        label: 'Cache memory',
        value: '~30 GB for a day of active codes',
        math: '100M distinct codes × 300 bytes = 30 GB, against 63B × 500 bytes in the store: about 0.1% of the data.',
      },
      {
        label: 'Store reads at peak',
        value: '~5K per second with the cache, 100K without',
        math: '100,000 clicks/s × 5% miss rate = 5,000 reads/s.',
      },
      {
        label: 'Click stream',
        value: '~10 MB/s at peak, ~2.5 TB retained, 16 partitions',
        math: '100,000 events/s × 100 bytes = 10 MB/s. 3.5B/day × 100 bytes = 350 GB/day × 7 days ≈ 2.5 TB before replication. 100K/s ÷ ~10K/s per consumer = 10, rounded up to 16.',
      },
      {
        label: 'Redirect fleet',
        value: '~30 servers across three zones',
        math: '100,000/s ÷ 5,000/s per server = 20 servers; × 1.5 so that losing one zone of three still leaves 20.',
      },
    ],
    implications: [
      'Reads outnumber writes 100 to 1 and the active set is about 0.1% of the data, so a cache that fits on a few nodes takes about 95% of the read load. The store is sized for storage and the miss rate, not for the click rate.',
      'The store must survive a cold cache badly but not fatally: 100K reads per second against capacity planned for 5K is why miss coalescing and load shedding exist.',
      'Five years of links use under 2% of the seven-character space, so codes are never reused and abandoned ranges cost nothing that matters.',
      'At 400 creates per second and 10,000 IDs per lease, the allocator sees one request every 25 seconds. It can be a single small replicated counter, and it never needs to scale.',
      'Clicks are the largest write stream by two orders of magnitude (40K per second against 400), which is why they go to a log and are aggregated in batches rather than written as rows.',
      'One viral link can be most of the click stream. Counts are sums, so events are spread across partitions at random rather than keyed by code, and the aggregator groups by code; no partition becomes hot.',
    ],
  },
  evolution: {
    mvp: 'One service and one relational database: a table keyed by code with a unique index, IDs from a database sequence, a small in-process cache, and click counts updated from request logs by a periodic job. That serves a few thousand redirects per second and has almost nothing to operate. The code format, the 302 and the rule that codes are never reused are fixed from day one, because they are the parts that cannot change later.',
    atScale: [
      'At 10x (about a million redirects per second at peak), one region is no longer close enough to users or large enough to be the only copy. The link store replicates to several regions and redirects are served locally; creates stay in one home region, or each region leases its own disjoint ranges from the allocator.',
      'At 10x, hot codes are worth caching at the edge for a few seconds. That gives up counting in one place: clicks served at the edge are counted from edge logs and merged in the aggregator.',
      'At 100x, the click pipeline is the dominant cost at hundreds of billions of events per day. Redirect servers pre-aggregate counts per code in memory and emit totals every second, and raw events are sampled for anything beyond counts.',
      'At 100x, most stored links are cold. Links not clicked for months move to cheaper storage behind the same lookup, accepting a slower first redirect for them.',
    ],
    firstBottleneck:
      'Reads on the link store, and specifically the one partition that holds a viral code, because adding nodes does not spread a single key. The cache removes it, and the pressure then moves to the single cache node that owns the hot key, which the local caches remove. After that the next limit is the click pipeline, since it is the only write that grows with the click rate.',
    avoided: [
      'Deduplicating by long URL. It needs a second index and a read before every write, and links with different owners and expiries are different links anyway. Worth adding only if storage cost or abuse by repeated shortening becomes a real problem.',
      'Random unguessable codes. They turn every insert into a possible retry and are unnecessary for public links. Worth adding as a separate, longer token format when private links become a feature.',
      'Multi-region writes. Creates are 1% of traffic and tolerate a cross-region hop, so a single home for writes avoids conflict handling. Worth adding when create latency or a regional outage of creation becomes a product concern.',
      'Exact click counting, with acknowledged emits and deduplication by event ID. It would put a wait or a local durable buffer on the redirect path. Worth adding when counts drive billing.',
      'A filter of all known codes in front of the cache. Negative caching already absorbs repeated bad codes; a filter earns its memory only when scanners send mostly distinct codes.',
    ],
  },
};
