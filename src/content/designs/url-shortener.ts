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
      'Only authenticated, rate-limited callers create links; only the owner sees stats; only the owner, or the trust team through an audited admin role, deletes a link. An acknowledged takedown stops redirects within a minute while the cache accepts writes; if it does not, the bound is the 6-hour cache TTL.',
    ],
    outOfScope: [
      'Spam and malware scanning of target URLs (a separate pipeline would check them and call the takedown path).',
      'Editing the target of an existing link, which would break the rule that links are immutable and safe to cache for hours.',
      'Custom domains per customer, QR codes and link-in-bio pages.',
      'Rich analytics such as unique visitors, referrers and funnels; the design counts clicks per link with coarse context.',
      'Accounts, plans and billing.',
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
      description:
        'Redirects to the long URL with a 302. Returns 404 if the code never existed, and 410 Gone if it expired or was deleted; the store can tell them apart because expired and deleted links stay as tombstones.',
    },
    {
      method: 'DELETE',
      path: '/links/{code}',
      description:
        'Owner, or the trust team through an audited admin role. Marks the link deleted, clears its URL and keeps the code as a tombstone, then invalidates it in the cache; redirects stop within seconds, and the takedown is verified within a minute.',
    },
    {
      method: 'GET',
      path: '/links/{code}/stats',
      description: 'Owner only. Click counts, a few seconds behind real time.',
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
      'First follow a new link from the request to the store. Then follow a click, watch a viral link overload the store, and see the cache and the click stream join the design as it grows, and take a harmful link down. Numbers are illustrative. Press play, or step through the stages.',
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
      { id: 'ids', title: 'ID allocator', detail: 'Leases ID ranges', column: 1, row: 'top' },
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
      { id: 'store', title: 'Link store', detail: 'Key-value, by code', column: 4, row: 'top' },
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
      ['gateway', 'shorten'],
      ['shorten', 'ids'],
      ['shorten', 'store'],
      ['gateway', 'redirect', 'click'],
      ['redirect', 'store'],
      ['shorten', 'cache', 'invalidate'],
      ['redirect', 'cache'],
      ['cache', 'store', 'miss'],
      ['redirect', 'clicks', 'event'],
      ['clicks', 'counts'],
    ],
    edgeStages: [
      { edge: ['redirect', 'store'], stages: [3, 4] },
      { edge: ['shorten', 'cache'], stages: [9] },
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
          ['gateway', 'shorten'],
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
        travel: [['shorten', 'ids']],
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
          'Someone opens the short link. The gateway sends the request to the redirect service, a stateless fleet that does nothing but turn codes into URLs. For now it reads the code straight from the link store.',
        tradeoff:
          'Keeping the redirect path tiny and stateless makes it cheap to scale out and easy to keep up, even when link creation is having trouble. The price is a little duplicated plumbing, such as auth and config, across two services.',
        nodes: ['client', 'gateway', 'redirect', 'store'],
        travel: [
          ['client', 'gateway'],
          ['gateway', 'redirect', 'click'],
          ['redirect', 'store'],
        ],
        short: 'Click',
        metrics: { users: '100K', requestsPerSecond: '1K', p95Latency: '30 ms', errorRate: '0%' },
        load: { redirect: 15, store: 20 },
      },
      {
        title: 'A link goes viral',
        narration:
          'One link is shared widely and clicks climb to about 100K a second, the peak the design is sized for (about 2.5 times its 40K average). Every click is still a read on the link store, and the partition that holds the viral code saturates: latency climbs and some redirects time out.',
        tradeoff:
          'Adding store nodes barely helps, because every one of those reads targets the same key on the same partition. Reads outnumber writes by orders of magnitude and a few codes take most of them, which is exactly the shape a cache is built for.',
        nodes: ['gateway', 'redirect', 'store'],
        travel: [
          ['client', 'gateway'],
          ['gateway', 'redirect', 'click'],
          ['redirect', 'store'],
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
        traffic: [
          { edge: ['gateway', 'redirect'], kind: 'failed' },
          { edge: ['redirect', 'store'], kind: 'failed' },
        ],
      },
      {
        title: 'Hit: answer from the cache',
        narration:
          'A cache joins the read path. The redirect service looks the code up in memory first, and because link popularity is very skewed, a modest cache holding the hottest codes answers the large majority of clicks. Each redirect server also keeps the hottest codes in its own memory for a few seconds, so even the cache node that owns a viral code sees one read per server every few seconds.',
        tradeoff:
          'Links almost never change, so caching them is safe and staleness is barely a concern. The cost is memory and one more system to run; a deleted link keeps redirecting until its cached entry is invalidated, or for the 6-hour TTL if the invalidation is lost. Expiry needs no invalidation, because the expiry time is cached with the entry and checked on every read.',
        nodes: ['redirect', 'cache'],
        travel: [['redirect', 'cache']],
        short: 'Cache hit',
        metrics: {
          users: '10M',
          requestsPerSecond: '100K',
          p95Latency: '8 ms',
          errorRate: '0.01%',
        },
        load: { redirect: 45, cache: 35, store: 8 },
      },
      {
        title: 'Miss: read the store and fill',
        narration:
          'On a miss, the code is read from the link store and written into the cache. Unknown codes are cached too, as a short-lived "not found", so repeated bad codes do not reach the store.',
        tradeoff:
          'Read-through keeps the cache filled with exactly what people click. Negative caching protects the store from scanners guessing codes, at the risk of a brand new link answering 404 for up to 30 seconds if someone guessed it before it was created.',
        nodes: ['cache', 'store'],
        travel: [['cache', 'store', 'miss']],
        short: 'Cache miss',
        metrics: {
          users: '10M',
          requestsPerSecond: '100K',
          p95Latency: '9 ms',
          errorRate: '0.01%',
        },
        load: { cache: 38, store: 12 },
      },
      {
        title: 'Answer with a temporary redirect',
        narration:
          'The service returns a 302 with the long URL in the Location header. Expired and deleted links answer 410 Gone, and codes that never existed answer 404.',
        tradeoff:
          'A permanent 301 lets browsers and edges cache the redirect, which saves load but hides every repeat click from analytics and makes expiry unreliable. A 302 keeps every click visible and expiry honest, at the cost of serving every click ourselves.',
        nodes: ['redirect', 'client'],
        travel: [],
        short: 'Redirect',
        metrics: {
          users: '10M',
          requestsPerSecond: '100K',
          p95Latency: '9 ms',
          errorRate: '0.01%',
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
          p95Latency: '9 ms',
          errorRate: '0.01%',
        },
        load: { redirect: 45, clicks: 40, counts: 20 },
      },
      {
        title: 'Take a link down',
        narration:
          'A link turns out to point at a phishing page. The owner, or the trust team through an audited admin role, deletes it. The shorten service first queues a delayed follow-up message, then marks the link deleted in the store, then overwrites its cache entry with a "deleted" marker instead of removing the key. Redirects answer 410 Gone once the local caches age out, within seconds. Ten seconds later a worker takes the follow-up, writes the marker again and confirms the 410 with a request through the redirect path.',
        tradeoff:
          'Caching links for 6 hours is what makes redirects cheap, so a takedown needs its own careful path. Overwriting instead of removing the key means a fill racing with the delete finds the key present and cannot bring the old URL back, because fills only add absent keys. The store write and the cache write are two steps that a crash can separate, so the follow-up is queued before either. It is delivered at least once, made harmless because the marker write and the check are idempotent, and it alarms when its retries run out, since a lost invalidation would let the link work until the TTL ends.',
        nodes: ['gateway', 'shorten', 'store', 'cache'],
        travel: [
          ['gateway', 'shorten'],
          ['shorten', 'store'],
          ['shorten', 'cache', 'invalidate'],
        ],
        short: 'Takedown',
        metrics: {
          users: '10M',
          requestsPerSecond: '100K',
          p95Latency: '9 ms',
          errorRate: '0.01%',
        },
        load: { shorten: 15, store: 12, cache: 38 },
      },
      {
        title: 'Expire old links',
        narration:
          'Links past their expiry are rejected at read time with 410 Gone. The item is never removed from the store: a delete clears the long URL at once, a slow background sweep clears it for expired links, and the code and its state stay behind as a tombstone, with no store TTL on the item. Codes are not reused.',
        tradeoff:
          'Checking expiry on read means correctness never depends on the sweep running on time. The tombstone is what keeps the 410 true and the code taken: if the store removed the item, as DynamoDB TTL would, the code would look like one that never existed, answer 404, and a custom alias would pass the put-if-absent again. The cost is a small item per dead link forever and a sliver of the code space, which buys that an old printed link never silently points somewhere new.',
        nodes: ['store', 'cache'],
        travel: [],
        short: 'Expire',
        metrics: {
          users: '10M',
          requestsPerSecond: '100K',
          p95Latency: '9 ms',
          errorRate: '0.01%',
        },
      },
    ],
  },
  flows: [
    {
      id: 'create',
      title: 'Create a short link',
      kind: 'sync',
      summary:
        'Ana shortens a long product URL. The shorten service takes the next ID from the range it holds, shuffles and encodes it, and stores the link with a put-if-absent.',
      runsOn: 'ALB → shorten service on ECS Fargate → DynamoDB (allocator item, links table)',
      participants: [
        { id: 'ana', label: 'Ana’s app', service: 'Client' },
        { id: 'alb', label: 'Gateway', service: 'ALB + Cognito' },
        { id: 'svc', label: 'Shorten service', service: 'ECS Fargate' },
        { id: 'alloc', label: 'ID allocator', service: 'DynamoDB item' },
        { id: 'links', label: 'Link store', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'ana',
          to: 'alb',
          label: 'POST /links {url, expiry}',
          note: 'Creation needs a signed-in user or an API key, and is rate limited per caller so one script cannot flood the store or burn ranges.',
        },
        {
          from: 'alb',
          to: 'svc',
          label: 'forward with user id',
          note: 'The service applies the per-caller rate limit on the verified user ID, since an ALB does not rate limit and the WAF rule in front only caps each source IP. It then validates and normalizes the URL: scheme http or https only, length capped.',
        },
        {
          from: 'svc',
          to: 'alloc',
          label: 'UpdateItem ADD hwm 10000 (range used up)',
          note: 'Only once every 10,000 links, about every 25 seconds across the fleet. The atomic add returns the new mark, and the range below it belongs to this server alone. A retried add only wastes a range.',
        },
        {
          from: 'svc',
          to: 'svc',
          label: 'id 1,048,577 → shuffle → base 62 → "k3XbQ9a"',
          note: 'The shuffle is a reversible permutation, so distinct IDs still give distinct codes, but neighbors no longer look alike.',
        },
        {
          from: 'svc',
          to: 'links',
          label: 'PutItem code=k3XbQ9a if attribute_not_exists',
          note: 'The same conditional write settles a custom alias race. If a generated code hits an existing alias, the server skips that ID and takes the next. DynamoDB acknowledges once a quorum of its replicas, which sit in different zones, has the write.',
        },
        {
          from: 'svc',
          to: 'ana',
          label: '201 sho.rt/k3XbQ9a',
          note: 'A timed-out create retried without an idempotency key gets a new code; the first link, if it was written, is a harmless orphan.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'redirect-hit',
      title: 'Follow a link (cache hit)',
      kind: 'sync',
      summary:
        'Bruno taps the link. The redirect service finds the code in its local memory or in the shared cache, checks expiry and answers 302 in a few milliseconds; the click is recorded after the answer.',
      runsOn: 'CloudFront → ALB → redirect service on ECS → ElastiCache → Kinesis Data Streams',
      participants: [
        { id: 'bruno', label: 'Bruno’s browser', service: 'Client' },
        { id: 'edge', label: 'Edge', service: 'CloudFront + WAF' },
        { id: 'redir', label: 'Redirect service', service: 'ECS Fargate' },
        { id: 'cache', label: 'Shared cache', service: 'ElastiCache for Valkey' },
        { id: 'stream', label: 'Click stream', service: 'Kinesis Data Streams' },
      ],
      steps: [
        {
          from: 'bruno',
          to: 'edge',
          label: 'GET /k3XbQ9a',
          note: 'TLS ends at the edge. WAF rate rules slow down scanners walking the code space. The 302 is not cached at the edge in this version, so every click reaches the service and is counted.',
        },
        {
          from: 'edge',
          to: 'redir',
          label: 'forward via the ALB',
          note: 'The redirect fleet is separate from the shorten service, so a problem in creation never touches clicks.',
        },
        {
          from: 'redir',
          to: 'cache',
          label: 'GET link:k3XbQ9a (local miss)',
          note: 'The local cache holds the hottest codes for a few seconds; this code is not one of them. The shared cache answers about 95% of what reaches it.',
        },
        {
          from: 'cache',
          to: 'redir',
          label: '{url, expiresAt}',
          note: 'The expiry is part of the cached value and compared with the clock on every read, so an expired link answers 410 even from cache.',
          style: 'reply',
        },
        {
          from: 'redir',
          to: 'bruno',
          label: '302 Location: long URL',
          note: 'A temporary redirect, so the next click comes back to us and is counted, and a takedown takes effect.',
          style: 'reply',
        },
        {
          from: 'redir',
          to: 'stream',
          label: 'PutRecords batch {code, time, country}',
          note: 'After the answer, from a small bounded buffer, aggregated into large records. If the stream is slow and the buffer fills, events are dropped; the redirect never waits.',
          style: 'async',
        },
      ],
    },
    {
      id: 'redirect-miss',
      title: 'Follow a link (cache miss)',
      kind: 'sync',
      summary:
        'A link created a minute ago is clicked for the first time. Concurrent misses for it collapse into one store read, and the result is cached, including a short "not found" for codes that do not exist.',
      runsOn: 'Redirect service on ECS → ElastiCache → DynamoDB',
      participants: [
        { id: 'redir', label: 'Redirect service', service: 'ECS Fargate' },
        { id: 'cache', label: 'Shared cache', service: 'ElastiCache for Valkey' },
        { id: 'links', label: 'Link store', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'redir',
          to: 'cache',
          label: 'GET link:Zq81mPw',
          note: 'Neither the local cache nor the shared cache has the code: it was created a minute ago and nobody has clicked it yet.',
        },
        {
          from: 'redir',
          to: 'redir',
          label: 'one read per code in flight',
          note: 'If fifty requests for the same code miss at once on this server, one reads the store and the others wait for it. A cap on in-flight store reads sheds the excess as fast errors when the cache is cold.',
        },
        {
          from: 'redir',
          to: 'links',
          label: 'GetItem code=Zq81mPw, ConsistentRead',
          note: 'A strongly consistent read, so a link created a moment ago is never cached as "not found". At about 5K misses a second the doubled read cost is small.',
        },
        {
          from: 'links',
          to: 'redir',
          label: '{url, expiresAt} or nothing',
          note: 'Partitioned by code, so the lookup is one item from one partition.',
          style: 'reply',
        },
        {
          from: 'redir',
          to: 'cache',
          label: 'SET NX link:Zq81mPw, TTL 6 h (or "none", TTL 30 s)',
          note: 'Only adds a key that is absent, so a late fill can never overwrite a "deleted" marker written by a takedown.',
        },
      ],
    },
    {
      id: 'count',
      title: 'Count clicks',
      kind: 'queue',
      summary:
        'Aggregators read the click stream, sum clicks per code over a few seconds and write the totals together with the stream position they reached, in one transaction that commits only if the position has not moved.',
      runsOn: 'Kinesis Data Streams → aggregator on ECS (KCL) → Aurora PostgreSQL → stats endpoint',
      participants: [
        { id: 'stream', label: 'Click stream', service: 'Kinesis Data Streams' },
        { id: 'agg', label: 'Aggregator', service: 'ECS, one worker per shard' },
        { id: 'db', label: 'Click counts', service: 'Aurora PostgreSQL' },
        { id: 'ana', label: 'Ana’s dashboard', service: 'Client' },
      ],
      steps: [
        {
          from: 'stream',
          to: 'agg',
          label: 'GetRecords from shard 7 after seq 4411',
          note: 'Events are spread over shards at random, not by code, so a viral link cannot make one shard hot.',
          style: 'async',
        },
        {
          from: 'agg',
          to: 'agg',
          label: 'sum by code for 5 s',
          note: 'Thousands of clicks on one viral code become one row update.',
        },
        {
          from: 'agg',
          to: 'db',
          label: 'BEGIN; upsert counts; UPDATE offsets SET seq=:new WHERE seq=:start; COMMIT',
          note: 'The stream position advances in the same transaction as the counts, and only if it still equals the position this batch started from (WHERE shard=:s AND seq=:start). Two workers can hold one shard for a moment while it moves between them; the slower one updates zero rows and rolls back, so a batch is never added twice. After a crash the worker resumes from the stored position and skips records at or below it, so none is skipped either.',
        },
        {
          from: 'ana',
          to: 'db',
          label: 'GET /links/k3XbQ9a/stats',
          note: 'Served from the counts table through the shorten service, owner only, a few seconds behind real time.',
        },
      ],
    },
    {
      id: 'takedown',
      title: 'Delete or take down a link',
      kind: 'async',
      summary:
        'A link turns out to point at a phishing page. The delete queues a delayed follow-up, marks the link in the store and writes a "deleted" marker over the cached entry. The follow-up repeats the marker and checks a few seconds later that the redirect now fails.',
      runsOn: 'Shorten service on ECS → SQS (delayed follow-up) → DynamoDB → ElastiCache',
      participants: [
        { id: 'owner', label: 'Owner or trust team', service: 'Client' },
        { id: 'svc', label: 'Shorten service', service: 'ECS Fargate' },
        { id: 'links', label: 'Link store', service: 'DynamoDB' },
        { id: 'cache', label: 'Shared cache', service: 'ElastiCache for Valkey' },
        { id: 'retry', label: 'Follow-up queue', service: 'SQS' },
      ],
      steps: [
        {
          from: 'owner',
          to: 'svc',
          label: 'DELETE /links/k3XbQ9a',
          note: 'Only the owner, or the trust team through an audited admin role, usually acting on a report from the scanning pipeline. Every takedown is logged.',
        },
        {
          from: 'svc',
          to: 'retry',
          label: 'SendMessage {code}, delay 10 s',
          note: 'Queued before the store write, so a crash after that write cannot lose the follow-up. If this send fails, the delete fails and nothing has changed.',
        },
        {
          from: 'svc',
          to: 'links',
          label: 'UpdateItem deleted=true, remove url',
          note: 'The store before the cache, so any later miss reads the deleted state. The item stays as a tombstone: the code answers 410 and is never reused.',
        },
        {
          from: 'svc',
          to: 'cache',
          label: 'SET link:k3XbQ9a "deleted"',
          note: 'Overwrites instead of removing the key, so a fill racing with the delete finds the key present and cannot bring the old URL back. If this write fails, the follow-up repeats it.',
        },
        {
          from: 'retry',
          to: 'svc',
          label: 'after 10 s: SET marker again, GET /k3XbQ9a expects 410',
          note: 'A worker reads the row with a consistent read; if it is not deleted, the delete failed and the message is dropped. Otherwise it writes the marker again and requests the code through the redirect path, where local caches have aged out by then. The message is removed only on a 410, so it is delivered at least once, made harmless because both actions are idempotent. Retries exhausted raise an alarm, since the fallback bound is the 6-hour TTL.',
          style: 'async',
        },
      ],
    },
  ],
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
    {
      question: 'How do we keep the shortener from being used for abuse?',
      options: [
        {
          name: 'Open creation, react to reports',
          pros: 'No friction for users.',
          cons: 'Spammers use the trusted short domain to hide phishing links, and the domain ends up on blocklists that break every link.',
        },
        {
          name: 'Scan every URL before answering',
          pros: 'Bad targets never get a code.',
          cons: 'Puts a slow external check inside every create, and new phishing pages pass scans anyway.',
        },
        {
          name: 'Authenticated, rate-limited creation plus asynchronous scanning and fast takedown',
          pros: 'Creation stays fast; abuse is tied to an account and a limit; bad links stop working within a minute of detection.',
          cons: 'A bad link works for the minutes between creation and detection.',
        },
      ],
      choice:
        'Authenticated and rate-limited creation, a scanning pipeline that reads new links after the fact and calls the takedown path, and a takedown that is verified through the redirect path. Codes are public by design: a scanner can walk them, so WAF rate rules slow it down and negative caching keeps it off the store, and private links need long random tokens.',
    },
    {
      question: 'Which store holds the links?',
      options: [
        {
          name: 'A relational database',
          pros: 'Unique index, transactions and easy queries by owner.',
          cons: '32 TB of rows, 95 TB with our own replicas, and thousands of reads a second mean sharding it ourselves.',
        },
        {
          name: 'A self-managed wide-column store such as Cassandra',
          pros: 'Scales horizontally with tunable consistency.',
          cons: 'A cluster to run, and lightweight transactions for put-if-absent are slow.',
        },
        {
          name: 'A managed key-value store (DynamoDB)',
          pros: 'Partitioned by code, conditional writes, each write acknowledged by a quorum of replicas spread over three zones, and no servers to run.',
          cons: 'One partition serves about 3,000 reads a second, so a viral key needs the cache; queries by owner need a secondary index.',
        },
      ],
      choice:
        'DynamoDB, keyed by code, with a secondary index by owner for "my links" and no TTL on the table, because expired and deleted links stay as tombstones. The relational database is the MVP and the right choice until sharding it becomes the work.',
    },
    {
      question: 'Could redirects run at the edge instead?',
      options: [
        {
          name: 'CloudFront KeyValueStore with CloudFront Functions',
          pros: 'Redirects answered in the edge location, no servers.',
          cons: 'A key value store holds at most 5 MB, millions of times too small for billions of links.',
        },
        {
          name: 'Lambda@Edge reading DynamoDB',
          pros: 'Runs near the user with full code.',
          cons: 'A cache miss still crosses to the table’s region, and per-invocation cost at 100K a second is high.',
        },
        {
          name: 'Regional redirect fleet, with the edge in front',
          pros: 'One place to count, cache and take down; the edge adds TLS and, later, short caching.',
          cons: 'Users far from the region pay the round trip.',
        },
      ],
      choice:
        'A regional fleet behind CloudFront. At 10x, caching hot 302s at the edge for a few seconds and replicating the table to more regions bring redirects close to users without giving up the single place where clicks and takedowns are handled.',
    },
  ],
  wrapUp:
    'Leased ID ranges encoded in base 62 for collision-free codes, a key-value store by code, a read-through cache with negative entries in front of it, 302 redirects from a stateless fleet, and click counting through a stream that never slows a redirect.',
  guarantees: {
    provides: [
      {
        property: 'Code uniqueness',
        promise:
          'A code maps to at most one link, forever. The allocator records the new high-water mark with an atomic increment acknowledged by a quorum of replicas before it returns a range, so ranges are disjoint; the shuffle is a bijection, so distinct IDs give distinct codes. Every insert, generated or custom, is a put-if-absent, which settles alias races and catches a generated code that lands on an existing alias: the server skips that ID and takes the next one. Expired and deleted links stay in the store as tombstones, so the same put-if-absent keeps rejecting their codes and no code, generated or alias, is ever reused.',
      },
      {
        property: 'Durability of a created link',
        promise:
          'A link is acknowledged only after the store has written it to a quorum of replicas in different zones. A create that fails or times out may or may not exist, and a retry gets a new code rather than a duplicate of the old one.',
      },
      {
        property: 'Redirect freshness',
        promise:
          'Redirects are eventually consistent with bounded staleness. Expiry is enforced on every read, cached or not, to within clock skew. A deleted link stops redirecting once the shared entry is invalidated and the local caches age out, which is seconds; if the cache cannot be written and the queued follow-up runs out of retries, the bound is the shared TTL of 6 hours.',
      },
      {
        property: 'Click counting',
        promise:
          'Best effort into the stream: the redirect server emits each event at most once and drops it if the stream is unavailable. From the stream to the counts, events are processed at least once, made harmless by advancing each shard position in the same transaction as the counts it produced, and only if the position is still where the batch started. Counts can therefore run low, never high.',
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
      'Instant takedown. A deleted link can redirect for a few seconds, and for up to the 6-hour TTL in the worst case of an invalidation that never lands.',
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
        'A node loss affects only that shard’s slots, and its replica takes over with whatever was replicated. Local caches keep the hottest codes for a few seconds, each redirect server collapses concurrent misses for one code into a single store read, and a cap on in-flight store reads sheds the excess as fast errors. The cache refills from clicks within minutes; no data is lost because the cache holds nothing the store does not.',
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
        'Shorten servers keep creating from the ranges they already hold, which at 400 creates a second lasts tens of seconds, a minute or two at best, then creates fail; redirects are unaffected. If the high-water mark were replicated asynchronously, the new primary could issue a range a second time.',
      detection:
        'Lease error rate and lease latency for the outage. For a reissued range, a counter of put-if-absent conflicts on generated codes, which is otherwise near zero and alarms on any burst.',
      recovery:
        'Because every increment is acknowledged by a quorum, the new primary continues from the last recorded mark. If a range is reissued anyway, the conditional insert rejects each duplicate, the server abandons the range and leases another, and no link is overwritten.',
    },
    {
      scenario:
        'A link is deleted, and the cache invalidation is lost or races with a fill from a reader that saw the old row.',
      impact:
        'The link keeps redirecting from the shared cache, for up to the 6-hour TTL. For a takedown of a harmful target, that is the worst case that matters.',
      detection:
        'The queued follow-up of the delete flow, which requests the code through the redirect path about ten seconds later and expects a 410, plus a count of follow-ups that exhausted their retries.',
      recovery:
        'The delete queues its follow-up before it touches the store, so a crash between the store write and the cache write cannot lose the invalidation. It then marks the row deleted in the store and overwrites the cache entry with a "deleted" marker instead of removing the key, and fills only add a key that is absent, so a late fill cannot replace the marker. The follow-up writes the marker again and is retried until the redirect path answers 410. Local caches clear on their own within seconds.',
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
        'A restarted consumer resumes from the offset stored with the counts, so a batch that was applied is not applied again and one that was not is replayed. If two workers hold the same shard for a moment, the conditional offset update lets only one of them commit. Lag is worked off by adding consumers up to the partition count.',
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
        math: '63B links × 500 bytes ≈ 32 TB; × 3 replicas ≈ 95 TB. The estimate counts every link ever created, because expired and deleted links stay as tombstones. A managed store bills the logical 32 TB; the 95 TB applies only when we run the replicas ourselves.',
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
        math: '100,000 events/s × 100 bytes = 10 MB/s. 3.5B/day × 100 bytes = 350 GB/day × 7 days ≈ 2.5 TB before replication. 100K/s ÷ ~10K/s per consumer = 10, rounded up to 16 for headroom and so the stream can later double by splitting every shard in two.',
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
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one region across three Availability Zones. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Edge',
        service: 'Amazon Route 53, Amazon CloudFront and AWS WAF',
        why: 'The short domain, TLS close to users, and rate rules that slow scanners walking the code space. 302s are not cached at the edge until 10x.',
        watch: 'CloudFront Requests and 5xxErrorRate, WAF BlockedRequests.',
      },
      {
        part: 'Gateway',
        service:
          'Application Load Balancer with path rules and an AWS WAF rate-based rule; Amazon Cognito for creators',
        why: 'POST /links goes to the shorten service and /{code} to the redirect fleet, so the two scale and fail separately. An ALB does not rate limit, so the limit has two layers: the WAF rule caps each source IP, and the shorten service enforces the per-caller limit on the verified user ID or API key.',
        watch: 'TargetResponseTime and HTTPCode_Target_5XX_Count per target group.',
      },
      {
        part: 'Shorten service',
        service: 'Amazon ECS on AWS Fargate, a few tasks',
        why: 'About 400 creates a second; each task holds one leased range.',
        watch: 'Create latency and errors, and leased IDs against links stored.',
      },
      {
        part: 'ID allocator',
        service: 'One Amazon DynamoDB item updated with an atomic ADD',
        why: 'A durable counter: each add is acknowledged by a quorum of replicas in different zones before it answers. Touched about every 25 seconds; nothing to run.',
        watch: 'Errors on the lease call, and the high-water mark growing at the expected pace.',
      },
      {
        part: 'Link store',
        service:
          'Amazon DynamoDB, partition key code, a secondary index by owner, no TTL on the table',
        why: 'One access pattern, lookup by code; conditional puts for uniqueness; expired and deleted items stay as tombstones, so their codes keep answering 410 and can never be registered again.',
        watch:
          'ReadThrottleEvents, SuccessfulRequestLatency, ConditionalCheckFailedRequests (alias races, or a reissued range).',
      },
      {
        part: 'Redirect service',
        service:
          'About 30 Amazon ECS tasks on Fargate across three zones, each with a local LRU cache',
        why: 'Stateless and tiny, so it scales on request count; losing one zone still leaves 20 tasks for the peak.',
        watch: 'p95 and p99 redirect latency from the service, 5xx count, dropped click events.',
      },
      {
        part: 'Shared cache',
        service:
          'Amazon ElastiCache for Valkey, cluster mode, 4 shards of cache.r7g.large with one replica each',
        why: 'About 30 GB of active codes fits in four nodes of about 10 GB usable each; NX writes and markers give the takedown its safety.',
        watch: 'CacheHitRate, EngineCPUUtilization per shard (a viral key), Evictions.',
      },
      {
        part: 'Click stream',
        service:
          'Amazon Kinesis Data Streams, 16 shards, 7-day retention, producer-side aggregation',
        why: 'A durable, ordered log per shard that aggregators read at their own pace and replay after a crash.',
        watch:
          'GetRecords.IteratorAgeMilliseconds (aggregator lag), WriteProvisionedThroughputExceeded, and dropped events on the producers.',
      },
      {
        part: 'Aggregator and counts',
        service: 'Kinesis Client Library workers on Amazon ECS writing to Amazon Aurora PostgreSQL',
        why: 'Counts and the stream position commit in one transaction, conditional on the position the batch started from, which is what makes replays and overlapping workers harmless.',
        watch: 'Aurora CommitLatency and the counts lag behind the stream.',
      },
      {
        part: 'Security',
        service:
          'Amazon Cognito, IAM roles per service, AWS KMS, AWS CloudTrail, SQS for takedown follow-ups',
        why: 'Creators are authenticated; only the redirect fleet reads the cache and only the shorten service writes links; the trust team deletes through an audited admin role; takedowns are logged, and a queued follow-up repeats the invalidation until the redirect path confirms it.',
        watch:
          'Takedown follow-ups that exhausted retries, takedown verification failures, and CloudTrail for admin deletes.',
      },
      {
        part: 'Observability and cost',
        service: 'Amazon CloudWatch dashboards and alarms, AWS Cost Explorer',
        why: 'One dashboard with the SLOs. The bill is mostly DynamoDB storage, billed on the logical size of about 32 TB after five years, and the read path; the cache is what keeps the second small.',
        watch: 'The SLO dashboard, and DynamoDB storage and read cost as separate lines.',
      },
    ],
    limits: [
      'One DynamoDB partition serves about 3,000 reads a second, so a viral code at 100K a second can only be served by the cache, never by adding table capacity.',
      'A strongly consistent DynamoDB read costs twice an eventually consistent one; it is used only on cache misses, about 5K a second.',
      'DynamoDB TTL removes the whole item, typically within a few days of its expiry, and a removed item cannot be told from a code that never existed. The links table therefore has no TTL: expiry is checked on every read and the item stays as a tombstone.',
      'A Kinesis shard accepts 1 MB or 1,000 records a second; 100K events a second over 16 shards is about 6,000 events per shard, so events are packed many to a record.',
      'Kinesis keeps data 24 hours by default; retention is raised to 7 days so an aggregator outage of days loses nothing.',
      'A CloudFront KeyValueStore holds at most 5 MB, which rules it out as the link store.',
      'ElastiCache reserves part of each node’s memory, so a 13 GB cache.r7g.large holds about 10 GB of entries.',
    ],
  },
  slos: [
    {
      objective: 'Redirect latency',
      target: '95% of redirects under 10 ms and 99% under 50 ms at the service',
      measure: 'Redirect service latency, split into local hits, cache hits and misses.',
    },
    {
      objective: 'Redirect availability',
      target: '99.99% of redirects for existing links answered 302',
      measure: 'ALB 5XX on the redirect target group over all redirect requests.',
    },
    {
      objective: 'Link creation',
      target: '99.9% of creates succeed within 200 ms',
      measure: 'ALB metrics on the shorten target group.',
    },
    {
      objective: 'Stats freshness and takedown',
      target: '99% of clicks counted within 60 s; 99% of takedowns verified within 1 min',
      measure: 'Aggregator lag behind the stream, and the takedown verification result.',
    },
  ],
  alarms: [
    {
      name: 'Cache hit rate falling',
      metric: 'ElastiCache CacheHitRate below 90% for 5 min',
      meaning:
        'A lost shard, a cold restart or a scanner; every lost point is about 1,000 store reads a second at peak.',
    },
    {
      name: 'Store throttling',
      metric: 'DynamoDB ReadThrottleEvents above 0 on the links table',
      meaning: 'A hot key is getting past the caches, or the miss rate is far above plan.',
    },
    {
      name: 'Redirect errors',
      metric: 'HTTPCode_Target_5XX_Count above 0.1% of redirects for 2 min',
      meaning: 'The read path is failing users; check the cache and the in-flight read cap first.',
    },
    {
      name: 'Counts falling behind',
      metric: 'Kinesis GetRecords.IteratorAgeMilliseconds above 60 s for 5 min; pages above 5 min',
      meaning:
        'Aggregators are down or too few; the 60-second freshness objective is being missed and stats are stale, but nothing is lost within 7 days.',
    },
    {
      name: 'Clicks being dropped',
      metric: 'Custom: dropped click events above 0.1% for 5 min',
      meaning: 'The stream is slow or throttled; counts for this window will be low.',
    },
    {
      name: 'Code conflicts',
      metric: 'Custom: generated codes rejected by the conditional put, any burst',
      meaning:
        'A range may have been issued twice; the put-if-absent is protecting links, but the allocator needs a look.',
    },
    {
      name: 'Takedown not holding',
      metric:
        'Custom: takedown follow-ups that exhausted retries, or a failed takedown verification, above 0',
      meaning:
        'A deleted link may keep redirecting for up to the 6-hour TTL; fix the cache entry by hand.',
    },
  ],
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
