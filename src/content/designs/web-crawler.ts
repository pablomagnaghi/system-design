import type { Design } from '../types';

export const webCrawler: Design = {
  slug: 'web-crawler',
  title: 'Web crawler',
  summary:
    'Fetch billions of pages from seed URLs, follow their links, and store the content for later processing, while staying polite to every site, skipping duplicates, and surviving machines that crash mid-crawl.',
  difficulty: 'Hard',
  requirements: {
    functional: [
      'Start from a list of seed URLs and crawl outward by following links.',
      'Fetch each page, store its raw content, and extract the links it contains.',
      'Respect each site’s robots rules and crawl delay.',
      'Revisit pages over time so stored content does not go stale.',
    ],
    nonFunctional: [
      'Crawl on the order of ten billion pages in a few weeks: thousands of fetches per second.',
      'Polite: never more than one request at a time to a host, with a delay between requests.',
      'Fault tolerant: a crashed worker loses no progress beyond the page it was fetching.',
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
      description: 'Raw content stored in blob storage, keyed by URL and fetch time.',
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
      'Follow one URL from the frontier through fetching, storing and parsing, until its outgoing links are queued for their own turn. Press play, or step through the stages.',
    nodes: [
      { id: 'seeds', title: 'Seed URLs', detail: 'Start of crawl', column: 0, row: 'middle' },
      { id: 'frontier', title: 'URL frontier', detail: 'Queues by host', column: 1, row: 'middle' },
      { id: 'hosts', title: 'Host table', detail: 'Robots, next fetch', column: 1, row: 'top' },
      { id: 'fetchers', title: 'Fetchers', detail: 'Download pages', column: 2, row: 'middle' },
      { id: 'dns', title: 'DNS cache', detail: 'Resolve hosts', column: 2, row: 'top' },
      { id: 'blobs', title: 'Blob storage', detail: 'Raw pages', column: 3, row: 'top' },
      { id: 'parsers', title: 'Parsers', detail: 'Extract links', column: 3, row: 'middle' },
      { id: 'dedup', title: 'Seen filter', detail: 'URLs and content', column: 4, row: 'middle' },
      { id: 'urls', title: 'URL store', detail: 'State per URL', column: 5, row: 'middle' },
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
      },
      {
        title: 'Pick a host that is ready',
        narration:
          'The frontier keeps hosts ordered by their next allowed fetch time. A fetcher asks for work and gets a URL from a host whose time has come, then that host is pushed back by its crawl delay.',
        tradeoff:
          'Scheduling by host readiness enforces politeness without any locks between fetchers. Big sites with many pages are crawled slowly by design, so priority between hosts must be tuned to avoid starving important ones.',
        nodes: ['hosts', 'frontier'],
        travel: [['hosts', 'frontier']],
      },
      {
        title: 'Check robots and resolve DNS',
        narration:
          'Before fetching, the fetcher checks the cached robots rules for the host and resolves its address through a local DNS cache.',
        tradeoff:
          'Caching robots rules and DNS answers for hours saves a round trip on nearly every fetch, and DNS is often the hidden bottleneck of a crawler. The cost is reacting late when a site changes its rules or its address.',
        nodes: ['frontier', 'fetchers', 'dns'],
        travel: [
          ['frontier', 'fetchers'],
          ['dns', 'fetchers'],
        ],
      },
      {
        title: 'Fetch with strict limits',
        narration:
          'The fetcher downloads the page with a timeout, a size cap and a limit on redirects. Errors and slow responses are recorded against the host so it can be backed off.',
        tradeoff:
          'Hard limits protect the crawler from slow servers and endless pages, at the cost of skipping some legitimate large documents. Fetchers are mostly waiting on the network, so each one runs many requests concurrently on async I/O.',
        nodes: ['fetchers'],
        travel: [],
      },
      {
        title: 'Store the raw page first',
        narration:
          'The response body is written to blob storage, keyed by URL and fetch time, before any parsing happens.',
        tradeoff:
          'Storing first means a parser bug never costs a refetch: the page can be reprocessed from storage. It uses more space than keeping only extracted text, but storage is cheap compared to fetching the web again.',
        nodes: ['fetchers', 'blobs'],
        travel: [['fetchers', 'blobs']],
      },
      {
        title: 'Parse and normalize links',
        narration:
          'A parser reads the page, extracts every link, resolves relative links, and normalizes them: lower-case host, removed fragments, sorted or dropped tracking parameters.',
        tradeoff:
          'Parsing in a separate stage lets fetchers stay network-bound and parsers stay CPU-bound, each scaled on its own. Normalization is a judgment call: too loose and the same page is crawled many times, too strict and distinct pages are merged.',
        nodes: ['fetchers', 'parsers'],
        travel: [['fetchers', 'parsers']],
      },
      {
        title: 'Drop what was already seen',
        narration:
          'Each link is checked against a seen-URL filter. Each page also gets a content hash, so mirrors and copies of the same content are recognized even under different URLs.',
        tradeoff:
          'A Bloom filter answers "seen before?" for billions of URLs in a few gigabytes of memory. It has rare false positives, which means a few new URLs are skipped; for a crawl of this size that is an acceptable loss.',
        nodes: ['parsers', 'dedup'],
        travel: [['parsers', 'dedup']],
      },
      {
        title: 'Record state and enqueue new links',
        narration:
          'New URLs are written to the URL store with their status and next due time, and pushed into the frontier under their host. The loop continues from there.',
        tradeoff:
          'Keeping URL state in a durable store means a crashed worker only loses its current page, and recrawl times can be scheduled per URL. The frontier itself can be rebuilt from the store, at the cost of a slow restart.',
        nodes: ['dedup', 'urls', 'frontier'],
        travel: [
          ['dedup', 'urls'],
          ['dedup', 'frontier'],
        ],
      },
      {
        title: 'Recrawl on a schedule',
        narration:
          'Each URL gets a next due time based on how often its content has changed before. Pages that change often are revisited sooner; pages that never change drift to rare visits.',
        tradeoff:
          'Adaptive recrawl spends fetches where content actually changes. It needs history per URL and can miss a sudden change on a page that was quiet for months, so very important pages get a minimum revisit rate.',
        nodes: ['urls', 'frontier'],
        travel: [],
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
        'Lease URLs with a timeout and make storing a page idempotent by URL and fetch time. A rare duplicate fetch costs one request; a lost URL would silently shrink the crawl.',
    },
  ],
  wrapUp:
    'A frontier of per-host queues that only hands out ready hosts, stateless fetchers with DNS and robots caches, raw pages stored before parsing, Bloom-filter deduplication, durable URL state with leases, and adaptive recrawl.',
};
