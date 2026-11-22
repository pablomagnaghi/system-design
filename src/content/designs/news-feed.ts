import type { Design } from '../types';

export const newsFeed: Design = {
  slug: 'news-feed',
  title: 'News feed',
  summary:
    'Show every user the latest posts from the accounts they follow in a fraction of a second, by precomputing feeds when posts are written, without letting an account with millions of followers turn one post into millions of writes.',
  difficulty: 'Medium',
  minutes: 9,
  requirements: {
    functional: [
      'Publish a post with text and links to media.',
      'Follow and unfollow other accounts.',
      'Read a feed of posts from followed accounts, newest first, with infinite scroll.',
    ],
    nonFunctional: [
      'Feed loads in a few hundred milliseconds, even for users who follow thousands of accounts.',
      'A new post shows up in followers’ feeds within about a minute.',
      'Hundreds of millions of daily users, tens of millions of them online at peak, with reads far outnumbering posts.',
      'Some accounts have tens of millions of followers.',
      'Private accounts are visible only to approved followers, a blocked user never sees the blocker’s posts, and every request is authenticated.',
    ],
    outOfScope: [
      'Ranking by predicted interest (the design orders by time; a ranker could reorder the same candidates).',
      'Likes, comments and ads.',
      'Uploading and processing media: posts carry references to media already stored.',
      'Notifications and search.',
    ],
  },
  entities: [
    { name: 'User', description: 'An account, with follower and following counts.' },
    {
      name: 'Follow',
      description: 'An edge from follower to followee, stored in both directions.',
    },
    { name: 'Post', description: 'Author, text, media references and creation time.' },
    {
      name: 'Feed',
      description:
        'Per user: a capped set of recent post IDs, keyed by post ID and ordered newest first.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/posts',
      description: 'Creates a post for the signed-in user and returns its ID.',
    },
    {
      method: 'PUT · DELETE',
      path: '/follows/{userId}',
      description: 'Follows or unfollows an account.',
    },
    {
      method: 'GET',
      path: '/feed?cursor={cursor}&limit=20',
      description: 'A page of hydrated posts plus the cursor for the next page.',
    },
  ],
  dataFlow: [
    'A new post is stored and an event is queued for fan-out; the author gets an answer at once.',
    'Fan-out workers page through the author’s followers and add the post ID to the head of each follower’s feed.',
    'Authors with huge audiences are skipped; their posts are merged in when a follower reads.',
    'Reading a feed fetches the precomputed IDs, merges in posts from big accounts, and hydrates them from a post cache.',
  ],
  highLevel: {
    label: 'Publish a post, then read a feed',
    intro:
      'Follow a post from the author to the feeds of their followers, then follow a reader loading the first page of their feed. The design grows one piece at a time, and a post from a huge account shows why fan-out has a limit. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      { id: 'client', title: 'Clients', detail: 'Apps and web', column: 0, row: 'middle' },
      { id: 'api', title: 'API gateway', detail: 'Auth, routing', column: 1, row: 'middle' },
      { id: 'posts', title: 'Post service', detail: 'Writes posts', column: 2, row: 'top' },
      { id: 'postStore', title: 'Post store', detail: 'By author', column: 3, row: 'top' },
      {
        id: 'queue',
        title: 'Fan-out queue',
        detail: 'Post events',
        column: 3,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'fanout',
        title: 'Fan-out workers',
        detail: 'Write feed entries',
        column: 4,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'graph',
        title: 'Follow graph',
        detail: 'Followers by user',
        column: 4,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'feedSvc',
        title: 'Feed service',
        detail: 'Builds pages',
        column: 2,
        row: 'bottom',
        appearsAt: 6,
      },
      {
        id: 'feeds',
        title: 'Feed cache',
        detail: 'Post IDs per user',
        column: 3,
        row: 'bottom',
        appearsAt: 3,
      },
      {
        id: 'postCache',
        title: 'Post cache',
        detail: 'Bodies, authors',
        column: 1,
        row: 'bottom',
        appearsAt: 7,
      },
    ],
    edges: [
      ['client', 'api'],
      ['api', 'posts', 'publish'],
      ['posts', 'postStore'],
      ['posts', 'queue', 'event'],
      ['queue', 'fanout'],
      ['fanout', 'graph', 'followers'],
      ['fanout', 'feeds', 'prepend'],
      ['api', 'feedSvc', 'read'],
      ['feedSvc', 'feeds'],
      ['feedSvc', 'postCache', 'hydrate'],
    ],
    stages: [
      {
        title: 'Store the post',
        narration:
          'The author’s post goes through the gateway to the post service, which writes it to a post store partitioned by author and returns the new ID.',
        tradeoff:
          'Partitioning by author keeps "recent posts by this account" in one place, which the read path needs for large accounts. A very prolific author makes one partition busier, a cost that is small next to the reads it saves.',
        nodes: ['client', 'api', 'posts', 'postStore'],
        travel: [
          ['client', 'api'],
          ['api', 'posts', 'publish'],
          ['posts', 'postStore'],
        ],
        short: 'Store post',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '80 ms',
          errorRate: '0.1%',
        },
        load: { api: 30, posts: 30, postStore: 25 },
      },
      {
        title: 'Hand off the fan-out',
        narration:
          'The post service puts a "new post" event on a queue and answers the author immediately. Delivering the post to followers happens in the background.',
        tradeoff:
          'The author never waits for thousands of feed writes, and a spike of posts just makes the queue longer. The cost is that followers see the post seconds later instead of instantly, which suits a feed. Storing the post and queuing the event must not drift apart, so the event comes from the store itself: its change stream records every committed post, acting as the outbox, and a relay turns each record into a fan-out task.',
        nodes: ['posts', 'queue'],
        travel: [['posts', 'queue', 'event']],
        short: 'Queue',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '40 ms',
          errorRate: '0.1%',
        },
        load: { posts: 30, queue: 20 },
      },
      {
        title: 'Page through the followers',
        narration:
          'A fan-out worker takes the event and reads the author’s followers from the follow graph in pages of a few thousand, splitting large lists into many smaller tasks.',
        tradeoff:
          'Splitting the work lets many workers share one big fan-out and makes each task cheap to retry. Storing the graph in both directions doubles its size, but both "who follows me" and "whom do I follow" become single lookups.',
        nodes: ['queue', 'fanout', 'graph'],
        travel: [
          ['queue', 'fanout'],
          ['fanout', 'graph', 'followers'],
        ],
        short: 'Followers',
        metrics: { users: '50M', requestsPerSecond: '200K', p95Latency: '2 s', errorRate: '0.1%' },
        load: { queue: 25, fanout: 35, graph: 30 },
      },
      {
        title: 'Prepend the post to each feed',
        narration:
          'For each follower, the worker adds the post ID to that follower’s feed, a set ordered by post time in an in-memory store, and trims it to the newest few hundred entries.',
        tradeoff:
          'Fan-out on write turns every feed read into a single list lookup, at the cost of one write per follower per post. Storing only IDs keeps each feed to a few kilobytes; the cap bounds memory, and older pages fall back to a slower path. Because the feed is keyed by post ID, a retried task adds nothing twice.',
        nodes: ['fanout', 'feeds'],
        travel: [['fanout', 'feeds', 'prepend']],
        short: 'Prepend',
        metrics: { users: '50M', requestsPerSecond: '200K', p95Latency: '2 s', errorRate: '0.1%' },
        load: { fanout: 40, feeds: 35 },
      },
      {
        title: 'A huge account posts',
        narration:
          'An account with thirty million followers posts. Fan-out on write turns that one post into thirty million feed writes: the workers spend minutes on it, the queue backs up behind it, and posts from everyone else reach their followers minutes late.',
        tradeoff:
          'More workers shorten the burst but pay for capacity that sits idle between such posts, and the feed cache still takes the whole write storm. Much of the work is wasted too, since most of those followers will not open the app before the post is old.',
        nodes: ['queue', 'fanout', 'graph', 'feeds'],
        travel: [
          ['queue', 'fanout'],
          ['fanout', 'feeds', 'prepend'],
        ],
        short: 'Huge account',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '5 min',
          errorRate: '0.1%',
          alerts: ['p95Latency'],
        },
        load: { queue: 95, fanout: 98, graph: 60, feeds: 85 },
        traffic: [
          { edge: ['queue', 'fanout'], kind: 'heavy' },
          { edge: ['fanout', 'feeds'], kind: 'heavy' },
        ],
      },
      {
        title: 'Skip the very large accounts',
        narration:
          'If the author has more than a threshold of followers, say a hundred thousand, the worker does not fan out at all. Those posts stay only in the post store.',
        tradeoff:
          'One post from an account with tens of millions of followers would mean tens of millions of writes, delaying everyone else’s fan-out. Skipping it moves that cost to read time, where it is paid only by followers who actually open the app.',
        nodes: ['fanout', 'graph'],
        travel: [['fanout', 'graph', 'followers']],
        short: 'Skip large',
        metrics: { users: '50M', requestsPerSecond: '200K', p95Latency: '2 s', errorRate: '0.1%' },
        load: { queue: 25, fanout: 35, graph: 30, feeds: 30 },
      },
      {
        title: 'Read the precomputed feed',
        narration:
          'A reader opens the app. The feed service reads the first page of post IDs from the reader’s feed list in a single lookup.',
        tradeoff:
          'The expensive work was done ahead of time, so the read is fast and its cost does not grow with the number of accounts followed. The price is memory for a feed per user and work wasted on feeds nobody opens.',
        nodes: ['client', 'api', 'feedSvc', 'feeds'],
        travel: [
          ['client', 'api'],
          ['api', 'feedSvc', 'read'],
          ['feedSvc', 'feeds'],
        ],
        short: 'Read feed',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '30 ms',
          errorRate: '0.1%',
        },
        load: { api: 35, feedSvc: 30, feeds: 35 },
      },
      {
        title: 'Merge in posts from large accounts',
        narration:
          'The feed service looks up which large accounts the reader follows, fetches their recent posts from the post cache, and merges them with the precomputed IDs by time.',
        tradeoff:
          'This hybrid keeps writes bounded and still shows posts from huge accounts within seconds. It makes reads a little more complex, but accounts over the threshold are a small share of those a reader follows, their recent posts come back in one batched call, and they are among the most cached objects in the system.',
        nodes: ['feedSvc', 'postCache'],
        travel: [['feedSvc', 'postCache', 'hydrate']],
        short: 'Merge large',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '50 ms',
          errorRate: '0.1%',
        },
        load: { feedSvc: 40, postCache: 45 },
      },
      {
        title: 'Hydrate the page',
        narration:
          'With the final list of IDs, the feed service fetches post bodies and author details in one batched call to the post cache, drops deleted or hidden posts, and returns the page.',
        tradeoff:
          'Keeping IDs in feeds and content in one cache means an edit or deletion is made in one place and reaches every feed as soon as that cache entry is replaced, with a short TTL as the backstop. The cost is a second round trip per page, kept small by batching and a very high hit rate on recent posts.',
        nodes: ['feedSvc', 'postCache', 'api', 'client'],
        travel: [['feedSvc', 'postCache', 'hydrate']],
        short: 'Hydrate',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '60 ms',
          errorRate: '0.1%',
        },
        load: { feedSvc: 40, postCache: 50, api: 35 },
      },
      {
        title: 'Scroll with a cursor',
        narration:
          'Each page returns a cursor holding the time and ID of its last post. The next request continues strictly after it, even if new posts arrived in between.',
        tradeoff:
          'Offsets shift when new posts are prepended, so users would see duplicates. A cursor is stable, at the cost of not allowing a jump to an arbitrary page, which a feed does not need. Past the cached window, the service builds older pages by pulling from followed authors.',
        nodes: ['client', 'feedSvc', 'feeds'],
        travel: [['feedSvc', 'feeds']],
        short: 'Cursor',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '60 ms',
          errorRate: '0.1%',
        },
        load: { feedSvc: 40, feeds: 35 },
      },
    ],
  },
  flows: [
    {
      id: 'publish',
      title: 'Publish a post',
      kind: 'sync',
      summary:
        'Ana, with 200 followers, posts a photo caption. She gets an answer as soon as the post is durable; delivering it to her followers happens after.',
      runsOn: 'ALB → post service on ECS → DynamoDB → DynamoDB Streams',
      participants: [
        { id: 'ana', label: 'Ana’s app', service: 'Client' },
        { id: 'svc', label: 'Post service', service: 'ECS Fargate' },
        { id: 'db', label: 'Post store', service: 'DynamoDB' },
        { id: 'stream', label: 'Change stream', service: 'DynamoDB Streams' },
      ],
      steps: [
        {
          from: 'ana',
          to: 'svc',
          label: 'POST /posts',
          note: 'The request carries Ana’s token and text plus references to media already uploaded to S3.',
        },
        {
          from: 'svc',
          to: 'db',
          label: 'PutItem author=ana, sk=time#postId',
          note: 'Partitioned by author, so "Ana’s recent posts" is one query, which the pull path for large accounts relies on.',
        },
        {
          from: 'db',
          to: 'stream',
          label: 'stream record',
          note: 'Every committed write appears in the table’s stream. This is the outbox without an outbox table: the post and its event cannot diverge.',
          style: 'async',
        },
        {
          from: 'svc',
          to: 'ana',
          label: '201 {postId}',
          note: 'Ana sees her post at once because her app inserts it locally; followers will see it within about a minute.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'fan-out',
      title: 'Fan out to followers',
      kind: 'queue',
      summary:
        'Ana’s post reaches the feeds of her followers who were active in the last few weeks, in pages of a few thousand.',
      runsOn:
        'DynamoDB Streams → Lambda → SQS → fan-out workers on ECS → follow graph → ElastiCache sorted sets',
      participants: [
        { id: 'stream', label: 'Change stream', service: 'DynamoDB Streams' },
        { id: 'relay', label: 'Relay', service: 'Lambda' },
        { id: 'sqs', label: 'Fan-out queue', service: 'SQS' },
        { id: 'worker', label: 'Fan-out worker', service: 'ECS' },
        { id: 'graph', label: 'Follow graph', service: 'DynamoDB' },
        { id: 'feeds', label: 'Feed cache', service: 'ElastiCache' },
      ],
      steps: [
        {
          from: 'stream',
          to: 'relay',
          label: 'new post by ana',
          note: 'A Lambda reads the stream and checks Ana’s follower count against the 100K threshold. She is far below it, so her post is pushed.',
          style: 'async',
        },
        {
          from: 'relay',
          to: 'sqs',
          label: 'task {postId, page 1}',
          note: 'Small fan-outs go to their own queue, so a large one cannot delay thousands of small ones.',
        },
        {
          from: 'worker',
          to: 'graph',
          label: 'followers of ana, active only',
          note: 'Followers are read in pages of a few thousand; inactive users and, for a private account, unapproved followers are skipped.',
        },
        {
          from: 'worker',
          to: 'feeds',
          label: 'ZADD feed:u postId; trim to 500',
          note: 'Each follower’s feed is a sorted set keyed by post ID, so a retried task adds nothing twice, and the trim keeps memory bounded.',
        },
        {
          from: 'worker',
          to: 'sqs',
          label: 'delete message',
          note: 'Only after every write of the page succeeded. A worker that dies leaves the message to reappear for another worker.',
        },
      ],
    },
    {
      id: 'read',
      title: 'Read the feed',
      kind: 'sync',
      summary:
        'Bruno opens the app. One lookup gets his precomputed IDs, posts from the large accounts he follows are merged in, and one batched call hydrates the page.',
      runsOn: 'ALB → feed service on ECS → ElastiCache feed and post caches → DynamoDB on a miss',
      participants: [
        { id: 'bruno', label: 'Bruno’s app', service: 'Client' },
        { id: 'feedsvc', label: 'Feed service', service: 'ECS Fargate' },
        { id: 'feeds', label: 'Feed cache', service: 'ElastiCache' },
        { id: 'pcache', label: 'Post cache', service: 'ElastiCache' },
        { id: 'db', label: 'Post store', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'bruno',
          to: 'feedsvc',
          label: 'GET /feed?limit=20',
          note: 'No cursor: the first page.',
        },
        {
          from: 'feedsvc',
          to: 'feeds',
          label: 'ZREVRANGE feed:bruno 0..39',
          note: 'A single lookup returns the newest pushed IDs, whatever the number of accounts Bruno follows. It fetches 40 IDs for a page of 20, so the page stays full after merging and after dropping blocked or deleted posts.',
        },
        {
          from: 'feedsvc',
          to: 'pcache',
          label: 'recent posts of the 3 large accounts he follows',
          note: 'Posts from accounts over the threshold were never pushed; they are among the most cached objects in the system, fetched in one batched call.',
        },
        {
          from: 'feedsvc',
          to: 'feedsvc',
          label: 'merge by time, dedupe by ID, drop blocked',
          note: 'Pushed and pulled posts are merged newest first, duplicates removed by post ID, and posts from authors who blocked Bruno are dropped.',
        },
        {
          from: 'feedsvc',
          to: 'pcache',
          label: 'MGET 20 post bodies',
          note: 'One batched call; the few misses are read from the post store with concurrent misses for the same post coalesced.',
        },
        {
          from: 'feedsvc',
          to: 'bruno',
          label: '20 posts + cursor(time, id)',
          note: 'The cursor holds the time and ID of the last post, so the next page continues strictly after it even if new posts arrive.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'delete',
      title: 'Delete a post',
      kind: 'sync',
      summary:
        'Ana deletes a post that already sits in 100 feeds. Only one place changes: the feeds keep the ID, and hydration drops it.',
      runsOn: 'Post service on ECS → DynamoDB → ElastiCache post cache tombstone',
      participants: [
        { id: 'ana', label: 'Ana’s app', service: 'Client' },
        { id: 'svc', label: 'Post service', service: 'ECS Fargate' },
        { id: 'db', label: 'Post store', service: 'DynamoDB' },
        { id: 'pcache', label: 'Post cache', service: 'ElastiCache' },
      ],
      steps: [
        {
          from: 'ana',
          to: 'svc',
          label: 'DELETE /posts/{id}',
          note: 'Only the author can delete; the service checks ownership.',
        },
        {
          from: 'svc',
          to: 'db',
          label: 'mark deleted',
          note: 'The post store is the source of truth, so the delete commits there first.',
        },
        {
          from: 'svc',
          to: 'pcache',
          label: 'SET tombstone',
          note: 'A tombstone, not a plain delete: cache fills only add a key that is absent, so a fill racing the delete cannot bring the old copy back.',
        },
        {
          from: 'pcache',
          to: 'pcache',
          label: 'readers drop it',
          note: 'Every feed that still holds the ID hydrates a tombstone and skips it. No fan-out of deletes to a hundred feeds is needed.',
        },
      ],
    },
    {
      id: 'returning',
      title: 'A returning user',
      kind: 'sync',
      summary:
        'Carla has not opened the app for two months, so no feed was kept for her. Her first load is built by pull; after that, push keeps it current.',
      runsOn: 'Feed service on ECS → follow graph and post store in DynamoDB → ElastiCache',
      participants: [
        { id: 'carla', label: 'Carla’s app', service: 'Client' },
        { id: 'feedsvc', label: 'Feed service', service: 'ECS Fargate' },
        { id: 'graph', label: 'Follow graph', service: 'DynamoDB' },
        { id: 'db', label: 'Post store', service: 'DynamoDB' },
        { id: 'feeds', label: 'Feed cache', service: 'ElastiCache' },
      ],
      steps: [
        {
          from: 'carla',
          to: 'feedsvc',
          label: 'GET /feed → no cached feed',
          note: 'About half of a typical author’s followers are inactive, so skipping them halves fan-out writes; the price is this one slower load.',
        },
        {
          from: 'feedsvc',
          to: 'graph',
          label: 'whom does Carla follow',
          note: 'The graph is stored in both directions, so this is one lookup.',
        },
        {
          from: 'feedsvc',
          to: 'db',
          label: 'recent posts per author, in parallel',
          note: 'The pull path, the same query the MVP used for every read, with rebuilds rate limited so a wave of returning users cannot overload the store.',
        },
        {
          from: 'feedsvc',
          to: 'feeds',
          label: 'store her feed, mark active',
          note: 'From now on fan-out includes Carla again.',
        },
        {
          from: 'feedsvc',
          to: 'carla',
          label: 'first page',
          note: 'A few hundred milliseconds instead of tens, once.',
          style: 'reply',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'Push, pull or a hybrid?',
      options: [
        {
          name: 'Fan-out on read (pull)',
          pros: 'Writes are cheap and nothing is computed for inactive users.',
          cons: 'Every read queries many authors and merges; slow for users following thousands.',
        },
        {
          name: 'Fan-out on write (push)',
          pros: 'Reads are one lookup.',
          cons: 'A post from a huge account becomes millions of writes.',
        },
        {
          name: 'Hybrid by follower count',
          pros: 'Push for the many normal accounts, pull for the few huge ones.',
          cons: 'Two code paths and a threshold to tune.',
        },
      ],
      choice:
        'The hybrid. Most posts come from accounts with modest audiences and are cheap to push; the few huge accounts are cheap to pull because every reader shares the same cached recent posts.',
    },
    {
      question: 'How do we paginate a feed that keeps changing?',
      options: [
        {
          name: 'Page number or offset',
          pros: 'Simple and familiar.',
          cons: 'New posts shift every page, so users see duplicates and miss posts.',
        },
        {
          name: 'Cursor on time and post ID',
          pros: 'Stable while new posts arrive; cheap to resume.',
          cons: 'No jumping to page fifty.',
        },
      ],
      choice:
        'A cursor on time and post ID. The ID breaks ties between posts created in the same millisecond.',
    },
    {
      question: 'Do we precompute feeds for users who rarely log in?',
      options: [
        {
          name: 'Precompute for everyone',
          pros: 'Every user gets a fast first load.',
          cons: 'Most fan-out writes land in feeds nobody reads.',
        },
        {
          name: 'Only for recently active users, rebuild on return',
          pros: 'Fan-out cost tracks real readers.',
          cons: 'A returning user’s first load is slower while the feed is rebuilt by pulling.',
        },
      ],
      choice:
        'Only for users active in the last few weeks. A returning user gets one slower load built by pull, after which their feed is kept up to date by push again.',
    },
    {
      question: 'How do we respect private accounts and blocks?',
      options: [
        {
          name: 'Filter only at write time',
          pros: 'Reads stay a plain lookup.',
          cons: 'A block or a revoked follow after the push leaves posts already sitting in the feed.',
        },
        {
          name: 'Filter only at read time',
          pros: 'Always current: every page is checked against the latest blocks and follows.',
          cons: 'A check per post on every page, and private posts would still be copied into feeds they should never reach.',
        },
        {
          name: 'Both: push only to allowed followers, check again on read',
          pros: 'Private posts never land where they should not, and late changes are caught on read.',
          cons: 'Two places that must agree on the rules.',
        },
      ],
      choice:
        'Both. Fan-out pushes a private account’s post only to approved followers, read from the same follow graph. On read, hydration drops posts whose author has blocked the reader or whose visibility no longer allows them, using a small per-user block set cached next to the feed. Unfollows are cleaned up in the background, and the post cache holds visibility with each post, so a change made private takes effect on the next page.',
    },
    {
      question: 'What about the posts every reader of a huge account asks for?',
      options: [
        {
          name: 'Serve them from the post cache as usual',
          pros: 'No extra mechanism.',
          cons: 'A key lives on one shard, so millions of readers asking for the same new post saturate that one node.',
        },
        {
          name: 'A short local cache in each feed service task',
          pros: 'The hottest posts and each large account’s recent-post list are served from the task’s own memory.',
          cons: 'A few seconds of staleness for those keys, and memory on every task.',
        },
        {
          name: 'Copies of the key across shards',
          pros: 'Spreads one key over several nodes.',
          cons: 'Every edit or delete must reach every copy.',
        },
      ],
      choice:
        'A local cache of a few seconds in every feed service task for the recent-post lists of accounts over the threshold and for posts detected as hot, in front of the shared post cache. A delete still wins within those few seconds, because the tombstone is read on the next refresh. Key copies across shards are kept for the rare post that still overloads one node.',
    },
    {
      question: 'What if a reader follows hundreds of huge accounts?',
      options: [
        {
          name: 'Pull every one of them on every page',
          pros: 'Always fresh.',
          cons: 'Hundreds of lookups and a large merge on every page, for every such reader.',
        },
        {
          name: 'Cache the merged pull result per reader for a minute',
          pros: 'One merge per minute instead of one per page; scrolling reuses it.',
          cons: 'Posts from those accounts can be up to a minute late for that reader.',
        },
      ],
      choice:
        'Pull at most the large accounts the reader follows, in one batched call, and cache the merged pulled list per reader for about a minute; scrolling pages read from it. Readers who follow more than a few hundred large accounts are rare, and a minute matches the freshness target for pushed posts anyway.',
    },
    {
      question: 'What changes with several regions?',
      options: [
        {
          name: 'One region serves everyone',
          pros: 'One copy of everything.',
          cons: 'Readers far away pay a cross-region round trip on every page.',
        },
        {
          name: 'Replicate the feeds across regions',
          pros: 'Every region reads locally.',
          cons: 'Feeds are the largest and most rewritten data in the system; copying them costs far more than rebuilding them.',
        },
        {
          name: 'Replicate posts and the graph, build feeds per region',
          pros: 'Only the source data crosses regions; each region runs its own fan-out into its own feed cache.',
          cons: 'Fan-out work is repeated per region, and a post appears in a far region after replication lag.',
        },
      ],
      choice:
        'Replicate posts and the follow graph, with DynamoDB global tables, and let each region fan out into its own feed cache for the users who live there. Each user is assigned a home region for writes, so a follow or a post is written in one place. Derived data is rebuilt locally, never copied.',
    },
    {
      question: 'How would we add ranking?',
      options: [
        {
          name: 'Keep time order',
          pros: 'No model, no features, predictable and easy to debug.',
          cons: 'Users who follow more than they can read miss the posts they care about most.',
        },
        {
          name: 'Rank the candidates the feed already has',
          pros: 'The cached IDs plus the pulled posts are a ready candidate set; a ranker only reorders a few hundred items.',
          cons: 'A feature store, a model and per-session state so pages stay stable while scrolling.',
        },
        {
          name: 'Rank the whole network',
          pros: 'Can recommend posts from accounts the user does not follow.',
          cons: 'A separate retrieval system; a different product from a following feed.',
        },
      ],
      choice:
        'Time order first, and when ranking is needed, rank the candidates the feed already has. On the first page of a session the feed service sends the few hundred candidate IDs to a ranker with per-user and per-post features, stores the ranked list for that session, and pages through it with the same cursor, so scrolling stays stable. Fan-out, the threshold and hydration do not change; ranking is a step between reading IDs and hydrating them.',
    },
  ],
  wrapUp:
    'Posts stored by author, asynchronous fan-out of post IDs into capped per-user feeds, large accounts pulled and merged at read time, hydration from a shared post cache, cursor pagination, and feeds kept only for users who actually read them.',
  guarantees: {
    provides: [
      {
        property: 'Post durability',
        promise:
          'A post is acknowledged only after the post store has replicated it synchronously within the author’s partition. The post store is the only source of truth; feeds and caches are derived from it and can be rebuilt.',
      },
      {
        property: 'Fan-out delivery',
        promise:
          'At least once, made harmless by the post ID. The store’s change stream records every committed post, so a stored post always produces an event; tasks are acknowledged only after their feed writes succeed, and adding a post ID that a feed already holds changes nothing.',
      },
      {
        property: 'Feed freshness',
        promise:
          'Eventual. A pushed post reaches the feeds of active followers within about a minute while the queue keeps up; this is an objective measured from post time to feed write, not a hard bound. Posts from accounts over the threshold are read from the author’s recent posts on every page, so they do not depend on fan-out at all.',
      },
      {
        property: 'Pagination',
        promise:
          'Within one scroll, no post is returned twice and no page shifts when new posts arrive, because each request continues strictly after a cursor of post time and post ID, and pushed and pulled posts are merged and deduplicated by post ID.',
      },
      {
        property: 'Deletes and edits',
        promise:
          'A deleted or edited post changes in every feed within seconds, and within the post cache TTL of a few minutes at worst. A delete writes a tombstone to the cache and fills only add a key that is absent, so a fill racing the delete cannot bring the old copy back.',
      },
    ],
    assumes: [
      'Feed writes are idempotent: the feed is a set keyed by post ID, never an append-only list.',
      'The fan-out queue redelivers unacknowledged tasks and keeps events for a few hours, so a window can be replayed.',
      'Post IDs are unique and roughly time ordered, and server clocks agree to within tens of milliseconds.',
      'Any feed can be rebuilt by pull from the follow graph and the post store, so losing feed cache memory costs latency, not data.',
      'The follow graph read by a fan-out task may be seconds stale; an account followed during a fan-out can miss that one post.',
    ],
    doesNotGuarantee: [
      'A total order across authors. Order follows creation timestamps, so two posts made within clock skew of each other can appear in either order.',
      'That a post delivered late is seen in the current scroll. If it lands below a cursor the reader has already passed, it appears on the next load from the top.',
      'That the author’s followers see a post at the same moment, or that the server shows authors their own post instantly; the client inserts it locally.',
      'Immediate removal after an unfollow or a block. Entries already pushed are filtered at read time for blocks and cleaned up in the background for unfollows.',
      'A complete history. The cached feed holds a few hundred entries; older pages come from a slower pull.',
    ],
  },
  failures: [
    {
      scenario: 'The relay that turns stream records into fan-out tasks stops or falls behind.',
      impact:
        'Posts are stored and the authors see them, but no follower receives them. If the outage outlasted the stream’s retention, those events would be lost.',
      detection:
        'The relay’s IteratorAge, the age of the oldest unread stream record, alarmed at 30 s, far below the 24-hour retention, and a count of posts with no fan-out record.',
      recovery:
        'The relay resumes from its last checkpoint in the stream and publishes everything after it. The event may then be published twice; the post ID makes the second fan-out a no-op. The post ends up in every feed once.',
    },
    {
      scenario: 'A fan-out worker dies partway through a page of followers.',
      impact:
        'Some followers in the page have the post and the rest do not, until the task runs again. A task that always fails would block those followers for good.',
      detection:
        'Redelivery count per task and the depth of the dead-letter queue, which should stay at zero.',
      recovery:
        'The task is never acknowledged, so the queue hands it to another worker after the visibility timeout. Repeated adds are no-ops. After a few attempts the task moves to the dead-letter queue and is replayed once the cause is fixed; every follower in the page ends with one copy of the post.',
    },
    {
      scenario:
        'A feed cache node fails and its replica, which replicates asynchronously, takes over.',
      impact:
        'Feeds on that shard lose the last second or so of adds. If both copies are lost, those users have no cached feed at all.',
      detection:
        'The failover event itself, replication lag at the time of failover, and the rate of feed misses and rebuilds on that shard.',
      recovery:
        'Fan-out events from a window before the failover are replayed from the queue; idempotent adds fill only the gaps. A feed that is missing entirely is rebuilt by pull on its next read, with rebuilds rate limited so they cannot overload the post store. Both paths converge to the same feed.',
    },
    {
      scenario:
        'Fan-out falls behind: a burst of posts, or many accounts just under the threshold posting together.',
      impact:
        'Posts reach feeds minutes late and the freshness objective is missed. Nothing is lost and reads stay fast, but they serve older content.',
      detection:
        'Age of the oldest event in the queue, and the p99 time from post creation to feed write, alarmed against the one-minute target.',
      recovery:
        'Workers scale on queue age. Small and large fan-outs use separate queues so one large job cannot delay thousands of small ones, and the push threshold can be lowered for a while so more authors are pulled at read time. The backlog drains and feeds converge.',
    },
    {
      scenario: 'The post cache is cold or unavailable, for example after a restart.',
      impact:
        'Every page turns into about twenty post store reads. At peak that is millions of lookups a second against a store sized for a small miss rate, so latency rises and timeouts start to cascade.',
      detection: 'Post cache hit rate, post store read latency, and the feed service timeout rate.',
      recovery:
        'The feed service coalesces concurrent misses for the same post, sheds load by returning shorter pages, and stops hydrating behind a circuit breaker before the store saturates. The cache warms from live traffic; it holds only derived data, so nothing needs repair.',
    },
    {
      scenario: 'An account crosses the push threshold, in either direction.',
      impact:
        'Going up, recent posts exist in feeds and in the pull path at once. Going down, posts made while the account was large were never pushed, so they would vanish from feeds the moment readers stop pulling.',
      detection:
        'A sampling job rebuilds a few thousand feeds by pull each hour and compares them with the cached ones, reporting missing and extra entries.',
      recovery:
        'The merge deduplicates by post ID, which covers the way up. The threshold has hysteresis, and an account that drops below it stays in the pull set for as long as the feed window lasts, so its unpushed posts age out instead of disappearing.',
    },
  ],
  capacity: {
    assumptions: [
      '300M daily users, 50M online at peak, and 500M users active in the last few weeks.',
      'Each daily user loads about 30 feed pages of 20 posts; one user in three publishes a post each day.',
      'A typical author has 200 followers, about half of them active recently. Accounts over 100K followers are not pushed.',
      'A feed holds up to 500 post IDs at about 16 bytes each (ID and timestamp), and a stored post is about 1 KB with media kept elsewhere.',
      'Peak traffic is about twice the daily average, and fan-out workers are provisioned for about 350K feed writes a second.',
    ],
    estimates: [
      {
        label: 'Feed reads',
        value: '~100K pages/s average, ~200K at peak',
        math: '300M users × 30 pages ÷ 86,400 s ≈ 104K/s; × 2 at peak ≈ 200K/s, which is 4M post lookups/s at 20 posts a page',
      },
      {
        label: 'Posts and read to write ratio',
        value: '~1.2K posts/s, about 90 reads per post',
        math: '300M ÷ 3 = 100M posts/day ÷ 86,400 s ≈ 1.2K/s; 9B page loads ÷ 100M posts = 90',
      },
      {
        label: 'Fan-out writes',
        value: '~115K feed writes/s average, ~230K at peak',
        math: '100M posts × 200 followers × 50% active = 10B writes/day ÷ 86,400 s ≈ 115K/s; × 2 at peak',
      },
      {
        label: 'Feed cache memory and nodes',
        value: '~4 TB, about 110 nodes with replicas',
        math: '500 IDs × 16 B = 8 KB per feed × 500M active users = 4 TB; ÷ ~75 GB usable on a 105 GB node (cache.r7g.4xlarge) ≈ 55 primaries, × 2 for one replica each',
      },
      {
        label: 'One post from a huge account, if pushed',
        value: '~5 minutes of all spare fan-out capacity',
        math: '30M followers ÷ ~100K spare writes/s (350K provisioned minus 230K peak, rounded) = 300 s',
      },
      {
        label: 'Post storage',
        value: '~100 GB a day, ~110 TB a year replicated',
        math: '100M posts × 1 KB = 100 GB/day × 365 ≈ 36 TB/year; × 3 replicas ≈ 110 TB',
      },
    ],
    implications: [
      'Reads outnumber posts 90 to 1 and must answer in tens of milliseconds, so the merge is done ahead of time: fan-out on write, one lookup per read.',
      'Fan-out writes (230K/s) exceed feed reads (200K/s) even though posts are rare. The cost of this design is write amplification, which is why inactive users are skipped: pushing to every follower would double it.',
      'A single 30M-follower post would use every spare write for five minutes and delay all other posts, so accounts over the threshold are pulled at read time. The largest pushed post is then 100K writes, about a second of spare capacity.',
      'The feed cache is sized by memory, not by throughput: 430K operations/s over 55 primaries is about 8K each. The two levers are therefore the 500-entry cap and the active-user window, not faster nodes.',
      '4M post lookups a second cannot go to the post store, so hydration is one batched call to a cache, and a 1% miss rate still means 40K store reads a second. Recent posts are a few hundred gigabytes, which fits in memory.',
      'A hundred gigabytes a day outgrows one machine within weeks, so the post store is partitioned from the start, by author because that is how the pull path reads it.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one region across three Availability Zones. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'API',
        service: 'Application Load Balancer, Amazon Cognito tokens, Amazon ECS on AWS Fargate',
        why: 'Stateless post and feed services behind one load balancer, scaling on request count.',
        watch: 'ALB TargetResponseTime and HTTPCode_Target_5XX_Count, per service.',
      },
      {
        part: 'Post store',
        service: 'Amazon DynamoDB: author as partition key, time and post ID as sort key',
        why: 'Partitioned by author as the pull path reads it, durable across three zones, and its writes feed a change stream.',
        watch:
          'WriteThrottleEvents (a prolific author’s partition), SuccessfulRequestLatency, ConsumedReadCapacityUnits during rebuild waves.',
      },
      {
        part: 'Outbox',
        service: 'DynamoDB Streams read by an AWS Lambda relay',
        why: 'Every committed post appears in the stream, so the post and its fan-out event cannot diverge without a separate outbox table.',
        watch:
          'Lambda IteratorAge on the stream, the post-to-event delay; Errors and Throttles on the relay.',
      },
      {
        part: 'Fan-out queues and workers',
        service:
          'Two Amazon SQS queues, small and large fan-outs, consumed by workers on Amazon ECS',
        why: 'At-least-once delivery that idempotent adds make harmless; separate queues keep a large fan-out from delaying small ones.',
        watch:
          'ApproximateAgeOfOldestMessage per queue, the dead-letter queue depth, worker RunningTaskCount.',
      },
      {
        part: 'Follow graph',
        service:
          'Amazon DynamoDB: one item per direction, written together with TransactWriteItems',
        why: '"Who follows me" and "whom do I follow" are each one query; the two directions never disagree.',
        watch:
          'ConsumedReadCapacityUnits, which follows fan-out pages, and throttling on very large follower lists.',
      },
      {
        part: 'Feed cache',
        service:
          'Amazon ElastiCache for Valkey, cluster mode, about 55 shards of cache.r7g.4xlarge with one replica each',
        why: 'A sorted set per active user, about 8 KB, sharded by user; adds are idempotent and the trim keeps memory bounded.',
        watch:
          'DatabaseMemoryUsagePercentage, Evictions, EngineCPUUtilization per shard, ReplicationLag.',
      },
      {
        part: 'Post cache',
        service:
          'A separate Amazon ElastiCache cluster for post bodies, author details and tombstones',
        why: 'Recent posts are a few hundred gigabytes and are read 4M times a second, so hydration must hit memory.',
        watch: 'CacheHitRate, which must stay near 99%, and the post store reads it lets through.',
      },
      {
        part: 'Media',
        service: 'Amazon S3 and Amazon CloudFront',
        why: 'Posts carry media references; clients fetch media from the edge, never through the feed service.',
        watch: 'CloudFront 5xxErrorRate and CacheHitRate.',
      },
      {
        part: 'Security',
        service: 'Amazon Cognito, IAM roles per service, AWS KMS',
        why: 'Every request carries a user token; services reach only their own tables and caches; data is encrypted at rest.',
        watch:
          'Rejected tokens at the ALB and the rate of posts dropped by visibility checks at read time.',
      },
      {
        part: 'Observability and cost',
        service: 'Amazon CloudWatch dashboards and alarms, AWS Cost Explorer',
        why: 'One dashboard with the SLOs. The bill is mostly the feed cache’s memory and DynamoDB writes, so the 500-entry cap and the active-user window are cost levers.',
        watch:
          'The SLO dashboard, and ElastiCache and DynamoDB as separate lines in Cost Explorer.',
      },
    ],
    limits: [
      'DynamoDB Streams keep records for 24 hours, so a relay outage longer than that would lose events; the relay’s IteratorAge has an alarm far below that.',
      'One DynamoDB partition takes about 1,000 writes a second, far above any human author, but a bot posting in a loop is throttled there first.',
      'An SQS message is at most 256 KB, so a task carries a post ID and a follower page, never the follower list itself.',
      'ElastiCache reserves part of each node’s memory, so a 105 GB node holds about 75 GB of feeds, which is what the capacity plan uses.',
      'A sorted set lives on one shard, so a single feed is capped by one node; with 8 KB feeds sharded by user that is never the limit.',
    ],
  },
  slos: [
    {
      objective: 'Feed load',
      target: '99% of first pages within 200 ms',
      measure: 'Feed service latency from the ALB, split into cached feeds and rebuilds.',
    },
    {
      objective: 'Freshness',
      target: '99% of pushed posts in followers’ feeds within 60 s',
      measure: 'Time from post creation to the last feed write of its fan-out, sampled per post.',
    },
    {
      objective: 'Publishing',
      target: '99.9% of POST /posts succeed',
      measure: 'ALB 5XX count on the post service.',
    },
    {
      objective: 'Feed correctness',
      target: 'Under 0.1% of entries missing in sampled feeds',
      measure:
        'The hourly job that rebuilds a few thousand feeds by pull and compares them with the cached ones.',
    },
  ],
  alarms: [
    {
      name: 'Fan-out falling behind',
      metric: 'SQS ApproximateAgeOfOldestMessage above 30 s on the small queue',
      meaning:
        'The first bottleneck: posts will miss the freshness target; scale workers or lower the push threshold for a while.',
    },
    {
      name: 'Events not leaving the store',
      metric: 'Lambda IteratorAge on the posts stream above 30 s',
      meaning: 'The relay is failing or throttled; posts are stored but nobody is being told.',
    },
    {
      name: 'Post cache misses',
      metric: 'ElastiCache CacheHitRate below 97% on the post cache',
      meaning:
        'Hydration is leaking to the post store; at 4M lookups a second every point is 40K store reads.',
    },
    {
      name: 'Feed cache memory',
      metric: 'DatabaseMemoryUsagePercentage above 85% or Evictions above zero on the feed cache',
      meaning:
        'Feeds are being evicted and rebuilt by pull; add shards or shorten the active-user window.',
    },
    {
      name: 'Rebuild wave',
      metric: 'Custom: feed rebuilds per second above twice the baseline',
      meaning:
        'A feed shard was lost or many users returned at once; the rebuild rate limit should be protecting the post store.',
    },
    {
      name: 'Feeds drifting',
      metric: 'Custom: missing entries in sampled feeds above 0.1%',
      meaning:
        'Fan-out is dropping writes, or the threshold change left gaps; find the cause before it spreads.',
    },
  ],
  evolution: {
    mvp: 'One relational database and no feed store. A feed read selects the newest posts whose author is in the reader’s following list, using an index on author and creation time, with the same cursor. There is no queue, no fan-out and nothing to keep consistent, and it works while following lists are short and reads are a few hundred a second.',
    atScale: [
      'At 10x, reads dominate the database. Add read replicas and a post cache first, then move the merge to write time: a queue, fan-out workers and an in-memory feed per user. The pull query stays, as the rebuild path and for old pages.',
      'Also at 10x, the first accounts with very large audiences appear and fan-out lag becomes visible. Add the follower threshold and the read-time merge, and split the queue by fan-out size.',
      'At 100x, memory is the cost. Keep feeds only for recently active users, shard the feed cache by user, and partition the post store by author and the follow graph by user.',
      'At 100x and several regions, each region keeps its own feed cache built from replicated posts and follows (see the deep dive on regions), because rebuilding derived feeds locally is cheaper than replicating them across regions.',
    ],
    firstBottleneck:
      'Fan-out writes into the feed cache. Every other load grows with requests, while this one grows with posts times followers, so it rises faster than users do as the graph gets denser. It shows up as queue age long before any read latency moves, which is why queue age is the first alarm to add.',
    avoided: [
      'Ranking. Time order needs no model, no feature store and no per-user state. It becomes worth adding when users follow more than they can read; the cached IDs then become the candidate set for a ranker.',
      'A durable feed store. Feeds live in memory with one replica because they can be rebuilt. A disk-backed store is worth it when rebuilds after a failure cost more than the storage, for example with very long feed windows.',
      'Pushing new posts to open clients over a persistent connection. Polling on refresh is enough for a one-minute freshness target; live push earns its connection tier only when seconds matter.',
      'A third tier for mid-size accounts, such as pushing only to followers who are online. One threshold is simple to reason about; add tiers when accounts just under it dominate fan-out lag.',
      'Tracking which posts each user has seen. The cursor gives stable paging without it. Per-user seen state is needed only once ranking can resurface old posts.',
    ],
  },
};
