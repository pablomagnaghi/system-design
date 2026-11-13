import type { Design } from '../types';

export const urlShortener: Design = {
  slug: 'url-shortener',
  title: 'URL shortener',
  summary:
    'Turn long links into short codes and redirect every click in a few milliseconds, with codes that never collide, reads that scale far beyond writes and click counts that never slow a redirect down.',
  difficulty: 'Easy',
  requirements: {
    functional: [
      'Create a short link for a long URL, optionally with a custom alias and an expiry date.',
      'Redirect anyone who opens the short link to the original URL.',
      'Show the owner how many times a link was clicked.',
    ],
    nonFunctional: [
      'Redirects in a few milliseconds at the server, at hundreds of thousands per second.',
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
      'First follow a new link from the request to the store, then follow a click from the browser to the redirect, and see how analytics stay off the hot path. Press play, or step through the stages.',
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
      { id: 'cache', title: 'Cache', detail: 'Hot codes in memory', column: 3, row: 'middle' },
      { id: 'store', title: 'Link store', detail: 'Key-value, by code', column: 4, row: 'middle' },
      {
        id: 'clicks',
        title: 'Click stream',
        detail: 'Durable event log',
        column: 3,
        row: 'bottom',
      },
      {
        id: 'counts',
        title: 'Click counts',
        detail: 'Aggregated per link',
        column: 4,
        row: 'bottom',
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
      },
      {
        title: 'Take the next ID from a leased range',
        narration:
          'Each shorten server leases a block of, say, ten thousand IDs from the allocator and hands them out locally. The next free ID is encoded in base 62, so seven characters cover trillions of links.',
        tradeoff:
          'A counter guarantees uniqueness without checking the store, and leasing ranges means the allocator is touched once every ten thousand links. The cost is that codes are sequential and guessable, and a crashed server wastes the rest of its range; both are usually acceptable, and a reversible shuffle can hide the order.',
        nodes: ['shorten', 'ids'],
        travel: [['shorten', 'ids', 'lease']],
      },
      {
        title: 'Store the mapping',
        narration:
          'The service writes code, long URL, owner and expiry to a key-value store partitioned by code, and returns the short link. A custom alias uses a conditional insert that fails if the code already exists.',
        tradeoff:
          'A key-value store fits the single access pattern, lookup by code, and partitions evenly. It gives up rich queries, so listing links by owner needs a small secondary index. The conditional insert is the only place where two writers can race, and the store settles it.',
        nodes: ['shorten', 'store'],
        travel: [['shorten', 'store']],
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
      },
      {
        title: 'Hit: answer from the cache',
        narration:
          'The redirect service looks the code up in an in-memory cache. Link popularity is very skewed, so a modest cache holding the hottest codes answers the large majority of clicks.',
        tradeoff:
          'Links almost never change, so caching them is safe and staleness is barely a concern. The cost is memory and one more system to run; a TTL of hours bounds how long an expired or deleted link can keep redirecting.',
        nodes: ['redirect', 'cache'],
        travel: [['redirect', 'cache']],
      },
      {
        title: 'Miss: read the store and fill',
        narration:
          'On a miss, the code is read from the link store and written into the cache. Unknown codes are cached too, as a short-lived "not found", so repeated bad codes do not reach the store.',
        tradeoff:
          'Read-through keeps the cache filled with exactly what people click. Negative caching protects the store from scanners guessing codes, at the risk of a brand new link answering 404 for a few seconds if someone guessed it first.',
        nodes: ['cache', 'store'],
        travel: [['cache', 'store', 'miss']],
      },
      {
        title: 'Answer with a temporary redirect',
        narration:
          'The service returns a 302 with the long URL in the Location header. Expired links answer 404 or 410 instead.',
        tradeoff:
          'A permanent 301 lets browsers and edges cache the redirect, which saves load but hides every repeat click from analytics and makes expiry unreliable. A 302 keeps every click visible and expiry honest, at the cost of serving every click ourselves.',
        nodes: ['redirect', 'client'],
        travel: [],
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
      },
      {
        title: 'Expire old links',
        narration:
          'Links past their expiry are rejected at read time, and a background job deletes them from the store in batches. Codes are not reused.',
        tradeoff:
          'Checking expiry on read means correctness never depends on the cleanup job running on time. Never reusing codes wastes a sliver of the code space, but prevents an old printed link from silently pointing somewhere new.',
        nodes: ['store', 'cache'],
        travel: [],
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
          pros: 'Every click is counted, and expiry or takedown works at once.',
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
          cons: 'A deleted link may keep redirecting for the local TTL.',
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
};
