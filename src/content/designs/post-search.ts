import type { Design } from '../types';

export const postSearch: Design = {
  slug: 'post-search',
  title: 'Post search',
  summary:
    'Let people search billions of short posts by keyword and get results sorted by newest or most liked: an inverted index fed by a stream, sharded by post, with like counts kept fresh enough without rewriting the index on every like.',
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Users search posts by one or more keywords.',
      'Results can be sorted by newest first or by number of likes.',
      'A new post is searchable within about a minute.',
      'Results are paginated so users can keep scrolling.',
    ],
    nonFunctional: [
      'Search answers in a few hundred milliseconds at the tail.',
      'Scale to billions of posts, hundreds of millions of new posts a day and thousands of searches a second.',
      'Many more likes than posts: like counts can lag by a little.',
      'Search can be eventually consistent; it is never the source of truth for a post.',
    ],
    outOfScope: [
      'Personalized ranking and relevance models.',
      'Fuzzy matching, typos and search in images or video.',
    ],
  },
  entities: [
    {
      name: 'Post',
      description: 'Id, author, text, creation time and like count, owned by the post service.',
    },
    {
      name: 'Posting list',
      description:
        'For one term, the ids of the posts that contain it, kept sorted by time and by likes.',
    },
    {
      name: 'Index shard',
      description: 'A slice of posts with the full inverted index for that slice.',
    },
  ],
  api: [
    {
      method: 'GET',
      path: '/search?q=…&sort=recent|likes&cursor=…',
      description: 'Up to a page of post ids with snippets, plus a cursor for the next page.',
    },
    {
      method: 'internal',
      path: 'post.created · post.liked · post.deleted',
      description: 'Events from the post service that keep the index up to date.',
    },
  ],
  dataFlow: [
    'A new post or a like is published as an event on a stream.',
    'Indexers tokenize posts and update the posting lists of the shard that owns each post.',
    'A search checks a cache of popular queries, then fans out to every shard for its top results.',
    'A broker merges the partial results, sorts them and returns one page with a cursor.',
  ],
  highLevel: {
    label: 'Index a post, then find it',
    intro:
      'Follow one post from the moment it is written until it shows up in a search, and see how likes, popular queries and years of old posts are handled. Press play, or step through the stages.',
    nodes: [
      { id: 'user', title: 'User', detail: 'Types a query', column: 0, row: 'middle' },
      { id: 'posts', title: 'Post service', detail: 'Source of truth', column: 0, row: 'bottom' },
      { id: 'cache', title: 'Query cache', detail: 'Popular queries', column: 1, row: 'top' },
      { id: 'api', title: 'Search API', detail: 'Parse + cursor', column: 1, row: 'middle' },
      { id: 'stream', title: 'Event stream', detail: 'Posts and likes', column: 1, row: 'bottom' },
      {
        id: 'broker',
        title: 'Query broker',
        detail: 'Fan out, merge top K',
        column: 2,
        row: 'middle',
      },
      { id: 'indexer', title: 'Indexers', detail: 'Tokenize, update', column: 2, row: 'bottom' },
      { id: 'cold', title: 'Cold index', detail: 'Old posts, on disk', column: 3, row: 'top' },
      {
        id: 'shards',
        title: 'Index shards',
        detail: 'Recent, in memory',
        column: 3,
        row: 'middle',
      },
    ],
    edges: [
      ['posts', 'stream'],
      ['stream', 'indexer'],
      ['indexer', 'shards'],
      ['user', 'api'],
      ['api', 'cache'],
      ['api', 'broker'],
      ['broker', 'shards'],
      ['broker', 'cold'],
      ['shards', 'cold', 'age out'],
    ],
    stages: [
      {
        title: 'Publish posts as events',
        narration:
          'When a user posts, the post service stores it in its own database and publishes an event. The search system never writes to the post database; it only consumes the stream.',
        tradeoff:
          'Having the post service call the indexer directly would make posting fail or slow down whenever search is struggling. A stream decouples them and lets indexers replay from any point to rebuild, at the cost of a delay of seconds before a post is searchable.',
        nodes: ['posts', 'stream'],
        travel: [['posts', 'stream']],
      },
      {
        title: 'Build the inverted index',
        narration:
          'Indexers split the text into terms, normalize them and append the post id to the posting list of every term. Posting lists are kept in time order, so the newest matches sit at the front.',
        tradeoff:
          'Scanning every post for a keyword is fine for thousands of posts and hopeless for billions. An inverted index makes a lookup touch only the posts that contain the term, and costs extra storage and a write per term for every post.',
        nodes: ['stream', 'indexer', 'shards'],
        travel: [
          ['stream', 'indexer'],
          ['indexer', 'shards'],
        ],
      },
      {
        title: 'Shard by post, not by term',
        narration:
          'Each shard owns a slice of posts, chosen by hashing the post id, and holds a complete inverted index for that slice. Each shard is replicated so reads spread out and a lost machine is not lost data.',
        tradeoff:
          'Sharding by term sends a query to few shards, but popular terms create giant hot shards and multi-word queries must join lists across machines. Sharding by post spreads load evenly and keeps every lookup local to a shard, and in exchange every query fans out to all shards.',
        nodes: ['shards'],
        travel: [],
      },
      {
        title: 'Batch the likes',
        narration:
          'Likes arrive far more often than posts. Indexers add them up per post for a short window and update the stored count only when it crosses a meaningful step, such as the next power of two.',
        tradeoff:
          'Updating the index on every like would multiply the write load by the like rate. Batching and thresholds keep writes small, and the cost is that the like order in results is approximate. Exact counts are fetched from the post service for the final page.',
        nodes: ['stream', 'indexer', 'shards'],
        travel: [
          ['stream', 'indexer'],
          ['indexer', 'shards'],
        ],
      },
      {
        title: 'Check the query cache',
        narration:
          'A user searches. The API normalizes the query and looks it up in a cache of recent results for the first page of popular queries, kept for a few seconds to a minute.',
        tradeoff:
          'A small share of queries makes up a large share of traffic, especially during news events, so caching them removes most of the fan-out work. The cost is a short window where a brand new post is missing from a cached result, which is acceptable for search.',
        nodes: ['user', 'api', 'cache'],
        travel: [
          ['user', 'api'],
          ['api', 'cache'],
        ],
      },
      {
        title: 'Fan out and merge',
        narration:
          'On a miss, the broker sends the query to one replica of every shard. Each shard intersects the posting lists of the terms and returns only its top results for the requested sort. The broker merges them into one sorted page.',
        tradeoff:
          'Every query touching every shard means the slowest shard sets the latency. Asking each shard only for its top results keeps responses small, and sending a backup request when a shard is slow trims the tail at the cost of some duplicate work.',
        nodes: ['api', 'broker', 'shards'],
        travel: [
          ['api', 'broker'],
          ['broker', 'shards'],
        ],
      },
      {
        title: 'Paginate with a cursor',
        narration:
          'The response carries a cursor: the last sort key returned, such as a timestamp and post id. The next page asks each shard for results after that key.',
        tradeoff:
          'Page numbers with an offset are simple but get slower deeper in and shift when new posts arrive. A cursor makes every page as cheap as the first and keeps results stable while the user scrolls, and in exchange users cannot jump straight to page 50.',
        nodes: ['user', 'api', 'broker'],
        travel: [
          ['user', 'api'],
          ['api', 'broker'],
        ],
      },
      {
        title: 'Age old posts into a cold index',
        narration:
          'Most searches only want recent posts. Shards keep recent weeks in memory and periodically move older segments into a cold index on cheaper storage. The broker searches the cold index only when the hot results do not fill the page.',
        tradeoff:
          'Keeping everything in memory would be fastest and very expensive for years of posts that are rarely read. Tiering costs a slower path for deep or old searches, which is an acceptable price for the rare user who scrolls that far back.',
        nodes: ['shards', 'cold', 'broker'],
        travel: [
          ['shards', 'cold', 'age out'],
          ['broker', 'cold'],
        ],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we partition the index?',
      options: [
        {
          name: 'By term',
          pros: 'A one-word query touches a single shard.',
          cons: 'Popular terms make hot shards, and multi-word queries need cross-shard joins.',
        },
        {
          name: 'By post',
          pros: 'Even load and storage; every query is answered locally on each shard.',
          cons: 'Every query fans out to all shards, so tail latency matters.',
        },
        {
          name: 'By time, then by post',
          pros: 'Recent data, which most queries want, lives on a small hot set of shards.',
          cons: 'More moving parts to roll time windows from hot to cold.',
        },
      ],
      choice:
        'By time, then by post: recent windows hashed by post id on hot shards, older windows on the cold tier. Queries sorted by recency often stop after the newest window.',
    },
    {
      question: 'How do we sort by likes when likes change all the time?',
      options: [
        {
          name: 'Update the index on every like',
          pros: 'Always exact.',
          cons: 'Write load equal to the like rate, mostly for posts nobody searches.',
        },
        {
          name: 'Batched updates at thresholds',
          pros: 'Few writes, and the order is close to right.',
          cons: 'A post just past a threshold can rank slightly wrong for a while.',
        },
        {
          name: 'Fetch counts at query time',
          pros: 'Exact counts for the results shown.',
          cons: 'A lookup per candidate, too many to rank a large result set.',
        },
      ],
      choice:
        'Batched updates at thresholds to rank, then exact counts fetched for the page that is shown. The ranking is approximate and the numbers on screen are right.',
    },
    {
      question: 'Build the index ourselves or use a search engine?',
      options: [
        {
          name: 'Off-the-shelf search engine',
          pros: 'Tokenizing, posting lists, replication and sharding come built in.',
          cons: 'Costly to run at this write rate, and its defaults rarely fit the hot and cold split.',
        },
        {
          name: 'Custom index on a key-value store',
          pros: 'Full control over layout, tiering and cost.',
          cons: 'A lot to build and operate, including recovery and rebalancing.',
        },
      ],
      choice:
        'Start with an off-the-shelf engine using time-based indexes, and build custom pieces only where scale proves the defaults too costly. In an interview, explain the inverted index either way.',
    },
  ],
  wrapUp:
    'Stream posts and likes into an inverted index sharded by post and tiered by time, batch like counts, cache popular queries, and answer each search by fanning out for top results, merging them and paginating with a cursor.',
};
