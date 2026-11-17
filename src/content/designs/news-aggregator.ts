import type { Design } from '../types';

export const newsAggregator: Design = {
  slug: 'news-aggregator',
  title: 'News aggregator',
  summary:
    'Collect fresh articles from thousands of known publishers within minutes, fold the many near-identical copies of each event into one story, and serve the same few hundred category and regional pages to a huge audience from a cache and a CDN, with a light personal touch on top.',
  difficulty: 'Medium',
  minutes: 10,
  requirements: {
    functional: [
      'Ingest new articles from a known list of publisher feeds, and from publishers that push updates.',
      'Group coverage of the same event from many outlets into one story.',
      'Show top stories by category and region, each linking out to the publishers.',
      'Let readers follow topics or sources and hide ones they do not want.',
    ],
    nonFunctional: [
      'An article is visible within a few minutes of being published.',
      'Read-heavy: on the order of a hundred million readers a day against a few million articles.',
      'Pages load in well under a second, including during a breaking news spike.',
      'Publishers are not hammered, and a page a minute stale is fine.',
    ],
    outOfScope: [
      'Discovering new sources by crawling the open web.',
      'Hosting full article text: readers click through.',
    ],
  },
  entities: [
    {
      name: 'Source',
      description:
        'A publisher feed: URL, polling interval, last fetch time, validators for conditional requests and whether it pushes.',
    },
    {
      name: 'Article',
      description:
        'Canonical URL, source, title, snippet, thumbnail, publish time, category, language and a text fingerprint.',
    },
    {
      name: 'Story',
      description:
        'A cluster of articles about one event: a lead article, key entities, region, score and last update.',
    },
    {
      name: 'Page',
      description:
        'A precomputed, ranked list of stories for one category and region, rebuilt every minute or so.',
    },
    {
      name: 'Reader profile',
      description: 'Followed topics and sources, hidden sources and home region.',
    },
  ],
  api: [
    {
      method: 'GET',
      path: '/pages/{category}?region=&cursor=',
      description:
        'A ranked page of stories for a category and region. Same for everyone, so it is cached at the CDN.',
    },
    {
      method: 'GET',
      path: '/stories/{id}',
      description: 'Every article in one story, grouped by outlet and ordered by time.',
    },
    {
      method: 'GET',
      path: '/me/home?cursor=',
      description: 'The home page: shared pages merged and filtered by the reader profile.',
    },
    {
      method: 'PUT',
      path: '/me/follows',
      description: 'Body: topics and sources to follow or hide.',
    },
  ],
  dataFlow: [
    'A scheduler hands due feeds to fetchers, which poll with conditional requests; push sources deliver directly.',
    'New items are dropped if their canonical URL is known, and the rest go onto a durable log.',
    'Workers extract text, fingerprint it to drop near duplicates, and assign each article to a story.',
    'A page builder ranks stories per category and region every minute and writes the pages to a cache.',
    'Readers get pages from the CDN; the home page is the shared pages merged with their profile.',
  ],
  highLevel: {
    label: 'From a publisher feed to a reader page',
    intro:
      'Follow a new article from a publisher feed through deduplication and clustering into a story, then follow a reader opening the front page. The design grows one piece at a time, and a breaking news spike shows why readers are served from cached pages. Numbers are illustrative. Press play, or step through the stages.',
    lanes: { top: 'Ingest and cluster', bottom: 'Serve readers' },
    nodes: [
      {
        id: 'publishers',
        title: 'Publishers',
        detail: 'Feeds and push',
        column: 0,
        row: 'top',
        appearsAt: 1,
      },
      {
        id: 'scheduler',
        title: 'Poll scheduler',
        detail: 'Adaptive intervals',
        column: 0,
        row: 'middle',
      },
      { id: 'fetchers', title: 'Fetchers', detail: 'Conditional GET', column: 1, row: 'top' },
      {
        id: 'push',
        title: 'Push receiver',
        detail: 'Publisher pings',
        column: 1,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'log',
        title: 'Article log',
        detail: 'New items only',
        column: 2,
        row: 'top',
        appearsAt: 1,
      },
      {
        id: 'readers',
        title: 'Readers',
        detail: 'Web and apps',
        column: 2,
        row: 'bottom',
        appearsAt: 6,
      },
      {
        id: 'extract',
        title: 'Extract + dedup',
        detail: 'Text fingerprints',
        column: 3,
        row: 'top',
        appearsAt: 3,
      },
      {
        id: 'profile',
        title: 'Reader profiles',
        detail: 'Follows, hides',
        column: 3,
        row: 'middle',
        appearsAt: 7,
      },
      { id: 'cdn', title: 'CDN', detail: 'Short TTL', column: 3, row: 'bottom', appearsAt: 6 },
      {
        id: 'cluster',
        title: 'Story clusterer',
        detail: 'Assign to stories',
        column: 4,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'db',
        title: 'Story store',
        detail: 'Articles, stories',
        column: 4,
        row: 'middle',
        appearsAt: 4,
      },
      {
        id: 'api',
        title: 'Read API',
        detail: 'Merge, personalize',
        column: 4,
        row: 'bottom',
        appearsAt: 6,
      },
      {
        id: 'ranker',
        title: 'Page builder',
        detail: 'Every minute',
        column: 5,
        row: 'middle',
        appearsAt: 5,
      },
      {
        id: 'cache',
        title: 'Page cache',
        detail: 'Ranked pages',
        column: 5,
        row: 'bottom',
        appearsAt: 5,
      },
    ],
    edges: [
      ['scheduler', 'fetchers', 'due'],
      ['publishers', 'fetchers', 'feed'],
      ['publishers', 'push', 'ping'],
      ['push', 'log'],
      ['fetchers', 'log', 'new items'],
      ['log', 'extract'],
      ['extract', 'cluster'],
      ['cluster', 'db'],
      ['db', 'ranker'],
      ['ranker', 'cache', 'pages'],
      ['readers', 'cdn'],
      ['cdn', 'api', 'miss'],
      ['api', 'cache'],
      ['api', 'profile'],
    ],
    stages: [
      {
        title: 'Poll each source at its own pace',
        narration:
          'The scheduler keeps a next-poll time per source and hands due sources to fetchers. A wire service that publishes every few minutes is polled every minute; a weekly blog is polled every few hours. Each interval adapts to how often the last polls found something new.',
        tradeoff:
          'Polling every source every minute is simple and fresh, and multiplies requests by a hundred for sources that rarely change, which publishers notice. Adaptive intervals cost a little bookkeeping and occasionally miss the first minutes of a quiet source that suddenly gets busy.',
        nodes: ['scheduler', 'fetchers'],
        travel: [['scheduler', 'fetchers', 'due']],
        short: 'Adaptive poll',
        metrics: { requestsPerSecond: '2K', p95Latency: '300 ms', errorRate: '0.5%' },
        load: { scheduler: 20, fetchers: 30 },
      },
      {
        title: 'Fetch, then drop URLs already seen',
        narration:
          'Fetchers send the validators from the last poll, so an unchanged feed answers with a tiny "not modified", and a per-domain limit caps requests to each publisher. Item URLs are canonicalized, known ones are dropped, and new items go onto a durable log.',
        tradeoff:
          'Downloading every feed in full and passing every item downstream is simpler, and makes the expensive steps reprocess the same article on every poll. A URL check is cheap and catches most repeats, and misses the same text under different URLs, which a later step handles.',
        nodes: ['publishers', 'fetchers', 'log'],
        travel: [
          ['publishers', 'fetchers', 'feed'],
          ['fetchers', 'log', 'new items'],
        ],
        short: 'Fetch + filter',
        metrics: { requestsPerSecond: '2K', p95Latency: '300 ms', errorRate: '0.5%' },
        load: { fetchers: 35, log: 15 },
      },
      {
        title: 'Take push where publishers offer it',
        narration:
          'Large publishers and partners notify a push receiver the moment they publish, through a feed hub or a webhook. The receiver verifies the sender and writes the new items straight to the log, and the scheduler stretches the polling of that source to a slow safety net.',
        tradeoff:
          'Push gives the freshest results with no wasted requests, and only some publishers support it, and pings get lost. Keeping a slow poll behind every push source costs a few requests a day and closes that gap.',
        nodes: ['publishers', 'push', 'log'],
        travel: [
          ['publishers', 'push', 'ping'],
          ['push', 'log'],
        ],
        short: 'Push',
        metrics: { requestsPerSecond: '2K', p95Latency: '300 ms', errorRate: '0.5%' },
        load: { push: 15, log: 20 },
      },
      {
        title: 'Extract text and fold near duplicates',
        narration:
          'Workers fetch the article page once, extract the main text, title, thumbnail and language, and compute a similarity fingerprint over the text. A wire story republished by fifty outlets with a changed headline lands on nearly the same fingerprint and is attached to the first copy instead of creating fifty entries.',
        tradeoff:
          'Comparing full texts pairwise is exact and impossible at millions of articles a day. Fingerprints with banded lookups find near matches in near constant time, and the cost is a threshold to tune: too loose merges different articles, too strict lets syndicated copies through.',
        nodes: ['log', 'extract'],
        travel: [['log', 'extract']],
        short: 'Dedup',
        metrics: { requestsPerSecond: '2K', p95Latency: '300 ms', errorRate: '0.5%' },
        load: { log: 20, extract: 55 },
        traffic: [{ edge: ['log', 'extract'], kind: 'heavy' }],
      },
      {
        title: 'Assign each article to a story',
        narration:
          'The clusterer compares a new article with stories active in the last day or two, using its named entities, keywords and a text embedding. It joins the closest story above a threshold or starts a new one, and the story lead and entities are updated in the store.',
        tradeoff:
          'Reclustering everything in a batch every hour gives cleaner groups and makes new stories wait up to an hour. Incremental assignment is fast and drifts over time, so a periodic job merges stories that turned out to be the same event and splits ones that grew too broad.',
        nodes: ['extract', 'cluster', 'db'],
        travel: [
          ['extract', 'cluster'],
          ['cluster', 'db'],
        ],
        short: 'Cluster',
        metrics: { requestsPerSecond: '2K', p95Latency: '300 ms', errorRate: '0.5%' },
        load: { extract: 50, cluster: 45, db: 20 },
      },
      {
        title: 'Build the shared pages every minute',
        narration:
          'A page builder scores recent stories by freshness, number and quality of outlets covering them and region, then writes a ranked list for each category and region pair to the page cache. A few hundred pairs cover almost every visit.',
        tradeoff:
          'Ranking at request time always shows the latest state, and repeats the same work millions of times a minute. Precomputing costs up to a minute of staleness and memory for each page, and turns every read into a cache lookup.',
        nodes: ['db', 'ranker', 'cache'],
        travel: [
          ['db', 'ranker'],
          ['ranker', 'cache', 'pages'],
        ],
        short: 'Build pages',
        metrics: { requestsPerSecond: '2K', p95Latency: '300 ms', errorRate: '0.5%' },
        load: { db: 25, ranker: 40, cache: 15 },
      },
      {
        title: 'Serve readers from the CDN',
        narration:
          'Category and regional pages are identical for everyone in a region, so the CDN caches them for about a minute. A miss reaches the read API, which returns the page from the cache, paged with a cursor that holds the page version.',
        tradeoff:
          'Offset paging over a list that is rebuilt every minute shows duplicates and skips as stories move. A cursor tied to one page version keeps paging stable, at the cost of a reader seeing a slightly older version until they refresh.',
        nodes: ['readers', 'cdn', 'api', 'cache'],
        travel: [
          ['readers', 'cdn'],
          ['cdn', 'api', 'miss'],
          ['api', 'cache'],
        ],
        short: 'CDN',
        metrics: { users: '5M', requestsPerSecond: '50K', p95Latency: '60 ms', errorRate: '0.1%' },
        load: { cdn: 40, api: 15, cache: 20 },
      },
      {
        title: 'Personalize the home page lightly',
        narration:
          'The home page is built at request time: the API reads the reader profile, pulls the shared pages for their region and followed topics, merges them, drops hidden sources and keeps outlets varied. Only this response skips the shared CDN cache.',
        tradeoff:
          'Writing a personal feed per reader on every new article would mean millions of writes per story. Merging a handful of cached pages per request is cheap and good enough, and the cost is coarser personalization than a full per-reader ranking model.',
        nodes: ['api', 'profile', 'cache'],
        travel: [
          ['api', 'profile'],
          ['api', 'cache'],
        ],
        short: 'Personalize',
        metrics: { users: '5M', requestsPerSecond: '50K', p95Latency: '120 ms', errorRate: '0.1%' },
        load: { api: 40, profile: 30, cache: 30 },
      },
      {
        title: 'Breaking news floods the origin',
        narration:
          'A big event breaks and reader traffic jumps tenfold in minutes. Everyone wants the same few pages, and when their short CDN entries expire together, thousands of identical misses reach the read API at once. The API and the page cache saturate, pages slow down and some requests fail.',
        tradeoff:
          'Adding API servers takes minutes to help and still sends every miss to origin. The surge is almost all the same handful of pages, so the cheaper fix is to stop identical requests from reaching origin at all.',
        nodes: ['readers', 'cdn', 'api', 'cache'],
        travel: [
          ['readers', 'cdn'],
          ['cdn', 'api', 'miss'],
        ],
        short: 'News spike',
        metrics: {
          users: '30M',
          requestsPerSecond: '500K',
          p95Latency: '3 s',
          errorRate: '5%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { cdn: 70, api: 98, cache: 85 },
        traffic: [
          { edge: ['readers', 'cdn'], kind: 'heavy' },
          { edge: ['cdn', 'api'], kind: 'failed' },
        ],
      },
      {
        title: 'Survive a breaking news spike',
        narration:
          'Three changes absorb the surge. The CDN keeps serving the last page while one request refreshes it, the API collapses concurrent misses for the same page into one cache read, and the page builder runs an extra pass for the affected categories.',
        tradeoff:
          'Shortening every TTL during a spike would show the story sooner and send the whole surge to origin. Serving a page a minute old while refreshing in the background trades a little freshness for keeping the site up exactly when most people are watching.',
        nodes: ['readers', 'cdn', 'api', 'ranker'],
        travel: [['readers', 'cdn']],
        short: 'Absorb spike',
        metrics: {
          users: '30M',
          requestsPerSecond: '500K',
          p95Latency: '150 ms',
          errorRate: '0.2%',
        },
        load: { cdn: 85, api: 50, cache: 40, ranker: 60 },
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we stay fresh without hammering publishers?',
      options: [
        {
          name: 'Fixed interval for every source',
          pros: 'Trivial to build and reason about.',
          cons: 'Either too slow for busy sources or wasteful for quiet ones; tens of thousands of sources every minute adds up.',
        },
        {
          name: 'Adaptive polling with conditional requests',
          pros: 'Polls each source about as often as it publishes, and most polls cost a tiny "not modified".',
          cons: 'A quiet source that suddenly publishes a lot is caught a little late.',
        },
        {
          name: 'Push from publishers',
          pros: 'Seconds of delay and no wasted requests.',
          cons: 'Only some publishers support it, and a lost ping means a missed article.',
        },
      ],
      choice:
        'Adaptive polling with conditional requests and per-domain limits for every source, plus push where publishers offer it, with a slow poll kept as a safety net behind each push source.',
    },
    {
      question: 'How do we turn many copies into one story?',
      options: [
        {
          name: 'Canonical URL hash',
          pros: 'Exact and cheap; catches the same article seen again in a feed.',
          cons: 'Misses syndicated copies, which have different URLs and slightly different text.',
        },
        {
          name: 'Text fingerprints for near duplicates',
          pros: 'Finds republished wire copy in near constant time with banded lookups.',
          cons: 'Only catches near-identical text; two original reports on the same event look different.',
        },
        {
          name: 'Clustering on entities and embeddings in a time window',
          pros: 'Groups different articles about the same event into one story.',
          cons: 'Thresholds are fuzzy, and incremental assignment drifts and needs periodic cleanup.',
        },
      ],
      choice:
        'All three as layers from cheap to expensive: URL hash at ingest, fingerprints to fold copies, and incremental clustering for stories, with a periodic job that merges and splits stories that drifted.',
    },
    {
      question: 'How do we serve pages to a huge audience?',
      options: [
        {
          name: 'Query and rank per request',
          pros: 'Always the latest state, with nothing extra to store.',
          cons: 'The same expensive query runs millions of times a minute against the store.',
        },
        {
          name: 'Precomputed shared pages behind a CDN',
          pros: 'A few hundred category and region pages serve almost everyone; reads are cache hits.',
          cons: 'Up to a minute of staleness, and no personal touch on its own.',
        },
        {
          name: 'A precomputed feed per reader',
          pros: 'Fully personal and fast to read.',
          cons: 'Every new story fans out to millions of readers, most of whom never open the page.',
        },
      ],
      choice:
        'Precomputed shared pages served from the CDN, with the home page merged per request from a few cached pages and the reader profile. Personal fan-out is not worth it when most readers want the same headlines.',
    },
  ],
  wrapUp:
    'Poll known sources adaptively with conditional requests and accept push where offered, drop known URLs before the log, fold near duplicates by fingerprint and cluster the rest into stories, rebuild a few hundred shared pages every minute, and serve them from a CDN with a light personal merge on the home page.',
};
