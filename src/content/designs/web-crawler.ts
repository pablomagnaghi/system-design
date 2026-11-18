import type { Design } from '../types';

export const webCrawler: Design = {
  slug: 'web-crawler',
  title: 'Web crawler',
  summary:
    'Fetch billions of pages from seed URLs, follow their links, and store the content for later processing, while staying polite to every site, skipping duplicates, and surviving machines that crash mid-crawl.',
  difficulty: 'Hard',
  minutes: 9,
  requirements: {
    functional: [
      'Start from a list of seed URLs and crawl outward by following links.',
      'Fetch each page, store its raw content, and extract the links it contains.',
      'Respect each site’s robots rules and crawl delay.',
      'Revisit pages over time so stored content does not go stale.',
    ],
    nonFunctional: [
      'Crawl on the order of ten billion pages in a few weeks: thousands of fetches per second.',
      'Polite: one request at a time to a host, with a delay after each request finishes.',
      'Fault tolerant: a crashed worker loses no progress beyond the pages it had in flight, which are fetched again.',
      'Avoid wasting fetches on duplicate URLs and duplicate content.',
    ],
    outOfScope: [
      'Indexing, ranking and search over the content.',
      'Rendering pages that need a full browser to run scripts.',
    ],
  },
  entities: [
    {
      name: 'URL record',
      description: 'Normalized URL, host, last fetch time, next due time, status, content hash.',
    },
    {
      name: 'Host record',
      description: 'Host name, cached robots rules, crawl delay, next allowed fetch time.',
    },
    {
      name: 'Page',
      description:
        'Raw content stored in blob storage, keyed by URL and crawl cycle, with the fetch time as metadata.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/crawls',
      description: 'Body: seed URLs, scope rules, max depth. Starts a crawl and returns its id.',
    },
    {
      method: 'internal',
      path: 'frontier.next(workerId) / frontier.add(urls)',
      description:
        'Workers take the next URL whose host is allowed to be fetched now, and push newly found links back.',
    },
    {
      method: 'GET',
      path: '/crawls/{id}/stats',
      description: 'Pages fetched, errors, queue depth and fetch rate per host.',
    },
  ],
  dataFlow: [
    'Seed URLs enter the frontier, a set of queues grouped by host.',
    'A fetcher takes a URL whose host is due, checks robots rules, resolves DNS and downloads the page.',
    'The raw page goes to blob storage; a parser extracts links and normalizes them.',
    'New links pass a seen-URL filter and go back into the frontier for later fetching.',
  ],
  highLevel: {
    label: 'Crawl one page and enqueue its links',
    intro:
      'Follow one URL from the frontier through fetching, storing and parsing, until its outgoing links are queued for their own turn. Watch DNS lookups stall the fetchers until a cache joins, and see each part appear as the crawl grows. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      { id: 'seeds', title: 'Seed URLs', detail: 'Start of crawl', column: 0, row: 'middle' },
      { id: 'frontier', title: 'URL frontier', detail: 'Queues by host', column: 1, row: 'middle' },
      {
        id: 'hosts',
        title: 'Host table',
        detail: 'Robots, next fetch',
        column: 1,
        row: 'top',
        appearsAt: 1,
      },
      {
        id: 'fetchers',
        title: 'Fetchers',
        detail: 'Download pages',
        column: 2,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'dns',
        title: 'DNS cache',
        detail: 'Resolve hosts',
        column: 2,
        row: 'top',
        appearsAt: 3,
      },
      {
        id: 'blobs',
        title: 'Blob storage',
        detail: 'Raw pages',
        column: 3,
        row: 'top',
        appearsAt: 5,
      },
      {
        id: 'parsers',
        title: 'Parsers',
        detail: 'Extract links',
        column: 3,
        row: 'middle',
        appearsAt: 6,
      },
      {
        id: 'dedup',
        title: 'Seen filter',
        detail: 'URLs and content',
        column: 2,
        row: 'bottom',
        appearsAt: 7,
      },
      {
        id: 'urls',
        title: 'URL store',
        detail: 'State per URL',
        column: 1,
        row: 'bottom',
        appearsAt: 8,
      },
    ],
    edges: [
      ['seeds', 'frontier'],
      ['hosts', 'frontier'],
      ['frontier', 'fetchers'],
      ['dns', 'fetchers'],
      ['fetchers', 'blobs'],
      ['fetchers', 'parsers'],
      ['parsers', 'dedup'],
      ['dedup', 'urls'],
      ['dedup', 'frontier', 'new links'],
    ],
    stages: [
      {
        title: 'Seed the frontier',
        narration:
          'The crawl starts with a list of seed URLs. Each one is normalized and placed in the frontier, which keeps a separate queue per host.',
        tradeoff:
          'One big global queue is simpler, but it would hand out ten URLs from the same site in a row and hammer it. Queues per host make politeness a property of the data structure, at the cost of managing millions of small queues.',
        nodes: ['seeds', 'frontier'],
        travel: [['seeds', 'frontier']],
        short: 'Seed',
        metrics: { requestsPerSecond: '10K', p95Latency: '5 ms', errorRate: '0%' },
        load: { frontier: 15 },
      },
      {
        title: 'Pick a host that is ready',
        narration:
          'The frontier keeps hosts ordered by their next allowed fetch time. A fetcher asks for work and gets a URL from a host whose time has come. That host is marked in flight and handed to nobody else; when the fetch completes or its lease expires, the next allowed time is set to that moment plus the crawl delay.',
        tradeoff:
          'Scheduling by host readiness enforces politeness without any locks between fetchers. Counting the delay from the end of a fetch, not from the hand-out, keeps a slow response from overlapping the next request. Big sites with many pages are crawled slowly by design, so priority between hosts must be tuned to avoid starving important ones.',
        nodes: ['hosts', 'frontier'],
        travel: [['hosts', 'frontier']],
        short: 'Ready host',
        metrics: { requestsPerSecond: '10K', p95Latency: '5 ms', errorRate: '0%' },
        load: { hosts: 20, frontier: 20 },
      },
      {
        title: 'DNS lookups stall the fetchers',
        narration:
          'Fetchers start pulling URLs, and each fetch first resolves its host through a shared upstream resolver. At thousands of fetches a second the resolver throttles and answers slowly, so fetchers spend most of their time waiting on lookups and many fetches time out before a byte is downloaded.',
        tradeoff:
          'Adding fetchers only sends more lookups to the same slow resolver. Most fetches go to hosts that were resolved moments ago, so remembering the answers locally removes nearly all of that traffic.',
        nodes: ['frontier', 'fetchers'],
        travel: [['frontier', 'fetchers']],
        short: 'DNS stall',
        metrics: {
          requestsPerSecond: '1K',
          p95Latency: '4 s',
          errorRate: '12%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { frontier: 20, fetchers: 95 },
        traffic: [{ edge: ['frontier', 'fetchers'], kind: 'failed' }],
      },
      {
        title: 'Check robots and resolve DNS',
        narration:
          'A DNS cache joins the fetchers. Before fetching, the fetcher checks the cached robots rules for the host and resolves its address through that local cache.',
        tradeoff:
          'Caching robots rules and DNS answers for hours saves a round trip on nearly every fetch, and DNS is often the hidden bottleneck of a crawler. The cost is reacting late when a site changes its rules or its address.',
        nodes: ['frontier', 'fetchers', 'dns'],
        travel: [
          ['frontier', 'fetchers'],
          ['dns', 'fetchers'],
        ],
        short: 'Robots + DNS',
        metrics: { requestsPerSecond: '10K', p95Latency: '600 ms', errorRate: '1%' },
        load: { frontier: 30, fetchers: 60, dns: 25 },
      },
      {
        title: 'Fetch with strict limits',
        narration:
          'The fetcher downloads the page with a timeout, a size cap and a limit on redirects. Errors and slow responses are recorded against the host so it can be backed off.',
        tradeoff:
          'Hard limits protect the crawler from slow servers and endless pages, at the cost of skipping some legitimate large documents. Fetchers are mostly waiting on the network, so each one runs many requests concurrently on async I/O.',
        nodes: ['fetchers'],
        travel: [],
        short: 'Fetch',
        metrics: { requestsPerSecond: '10K', p95Latency: '600 ms', errorRate: '1%' },
        load: { fetchers: 65 },
      },
      {
        title: 'Store the raw page first',
        narration:
          'The response body is written to blob storage, keyed by URL and crawl cycle, before any parsing happens. A repeated fetch of the same URL in the same cycle overwrites the same object.',
        tradeoff:
          'Storing first means a parser bug never costs a refetch: the page can be reprocessed from storage. It uses more space than keeping only extracted text, but storage is cheap compared to fetching the web again.',
        nodes: ['fetchers', 'blobs'],
        travel: [['fetchers', 'blobs']],
        short: 'Store raw',
        metrics: { requestsPerSecond: '10K', p95Latency: '600 ms', errorRate: '1%' },
        load: { fetchers: 65, blobs: 45 },
        traffic: [{ edge: ['fetchers', 'blobs'], kind: 'heavy' }],
      },
      {
        title: 'Parse and normalize links',
        narration:
          'A parser reads the page, extracts every link, resolves relative links, and normalizes them: lower-case host, removed fragments, sorted or dropped tracking parameters.',
        tradeoff:
          'Parsing in a separate stage lets fetchers stay network-bound and parsers stay CPU-bound, each scaled on its own. Normalization is a judgment call: too loose and the same page is crawled many times, too strict and distinct pages are merged.',
        nodes: ['fetchers', 'parsers'],
        travel: [['fetchers', 'parsers']],
        short: 'Parse',
        metrics: { requestsPerSecond: '10K', p95Latency: '600 ms', errorRate: '1%' },
        load: { fetchers: 65, parsers: 70 },
      },
      {
        title: 'Drop what was already seen',
        narration:
          'Each link is checked against a seen-URL filter. Each page also gets a content hash, so mirrors and copies of the same content are recognized even under different URLs.',
        tradeoff:
          'A Bloom filter answers "seen before?" for ten billion URLs in about 12 GB of memory at a 1% false positive rate, split across nodes. A false positive means a new URL is skipped, so about 1% of new URLs are never crawled; for a crawl of this size that is an acceptable loss, and more bits per URL lower it.',
        nodes: ['parsers', 'dedup'],
        travel: [['parsers', 'dedup']],
        short: 'Seen filter',
        metrics: { requestsPerSecond: '10K', p95Latency: '600 ms', errorRate: '1%' },
        load: { parsers: 70, dedup: 40 },
      },
      {
        title: 'Record state and enqueue new links',
        narration:
          'New URLs are written to the URL store with their status and next due time, and then pushed into the frontier under their host. A periodic scan of the store for due URLs that are not queued covers a crash between the two writes. The loop continues from there.',
        tradeoff:
          'Keeping URL state in a durable store means a crashed worker only loses the pages it had in flight, and recrawl times can be scheduled per URL. The frontier itself can be rebuilt from the store, at the cost of a slow restart.',
        nodes: ['dedup', 'urls', 'frontier'],
        travel: [
          ['dedup', 'urls'],
          ['dedup', 'frontier'],
        ],
        short: 'Enqueue',
        metrics: { requestsPerSecond: '10K', p95Latency: '600 ms', errorRate: '1%' },
        load: { dedup: 40, urls: 35, frontier: 35 },
      },
      {
        title: 'Recrawl on a schedule',
        narration:
          'Each URL gets a next due time based on how often its content has changed before. Pages that change often are revisited sooner; pages that never change drift to rare visits.',
        tradeoff:
          'Adaptive recrawl spends fetches where content actually changes. It needs history per URL and can miss a sudden change on a page that was quiet for months, so very important pages get a minimum revisit rate.',
        nodes: ['urls', 'frontier'],
        travel: [],
        short: 'Recrawl',
        metrics: { requestsPerSecond: '10K', p95Latency: '600 ms', errorRate: '1%' },
        load: { urls: 35, frontier: 35 },
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we enforce politeness across thousands of fetchers?',
      options: [
        {
          name: 'Global rate limiter per host',
          pros: 'Any fetcher can take any URL; limits are checked centrally.',
          cons: 'Every fetch pays a call to the limiter, and fetchers keep picking URLs they are not allowed to fetch.',
        },
        {
          name: 'Assign each host to one fetcher',
          pros: 'One owner per host enforces the delay locally, with no coordination.',
          cons: 'Rebalancing is needed when fetchers come and go, and a huge host pins one fetcher.',
        },
        {
          name: 'Frontier hands out only ready hosts',
          pros: 'Politeness lives in the scheduler; fetchers stay stateless.',
          cons: 'The frontier becomes a critical, stateful service that must be partitioned itself.',
        },
      ],
      choice:
        'A frontier partitioned by host hash that only hands out ready hosts. Fetchers stay stateless and simple, and each frontier partition enforces the delay for the hosts it owns.',
    },
    {
      question: 'How do we avoid crawler traps?',
      options: [
        {
          name: 'Depth and URL length limits',
          pros: 'Cheap; stops endless calendars and path loops.',
          cons: 'Can cut off legitimately deep sites.',
        },
        {
          name: 'Per-host page budgets',
          pros: 'Caps damage from any single site no matter how it generates URLs.',
          cons: 'Large real sites need their budget raised by hand or by reputation.',
        },
        {
          name: 'Content-similarity detection',
          pros: 'Spots many URLs serving near-identical pages.',
          cons: 'Costs extra computation per page and only reacts after fetching.',
        },
      ],
      choice:
        'Depth and length limits plus a per-host budget scaled by how useful the host has been. Similarity detection then lowers the budget of hosts that keep returning the same content.',
    },
    {
      question: 'How do we recover when a fetcher dies mid-crawl?',
      options: [
        {
          name: 'Restart the crawl',
          pros: 'No state to manage.',
          cons: 'Unacceptable for a crawl that runs for weeks.',
        },
        {
          name: 'Lease URLs to fetchers',
          pros: 'A URL taken but not completed returns to the frontier when its lease expires.',
          cons: 'A slow fetch past its lease may be repeated by another fetcher.',
        },
      ],
      choice:
        'Lease URLs with a timeout longer than the fetch timeout, so a fetcher has given up on a request before another one can be handed the same host, and make storing a page idempotent by URL and crawl cycle. A rare duplicate fetch costs one request; a lost URL would silently shrink the crawl.',
    },
  ],
  wrapUp:
    'A frontier of per-host queues that only hands out ready hosts, stateless fetchers with DNS and robots caches, raw pages stored before parsing, Bloom-filter deduplication, durable URL state with leases, and adaptive recrawl.',
};
