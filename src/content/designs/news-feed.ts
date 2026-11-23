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
      'Edit or delete your own posts, and block another account.',
    ],
    nonFunctional: [
      'Feed loads in a few hundred milliseconds, even for users who follow thousands of accounts.',
      'A new post shows up in followers’ feeds within about a minute.',
      'Hundreds of millions of daily users, tens of millions of them online at peak, with reads far outnumbering posts.',
      'Some accounts have tens of millions of followers.',
      'Private accounts are visible only to approved followers, a blocked user stops seeing the blocker’s posts within seconds, a minute at worst, and every request is authenticated.',
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
      description:
        'Creates a post for the signed-in user and returns its ID. The request carries an idempotency key chosen by the client, so a retry returns the first post’s ID instead of storing a second post.',
    },
    {
      method: 'PUT · DELETE',
      path: '/follows/{userId}',
      description: 'Follows or unfollows an account.',
    },
    {
      method: 'PATCH · DELETE',
      path: '/posts/{id}',
      description: 'Edits or deletes one of the signed-in user’s own posts.',
    },
    {
      method: 'PUT · DELETE',
      path: '/blocks/{userId}',
      description: 'Blocks or unblocks an account.',
    },
    {
      method: 'GET',
      path: '/feed?cursor={cursor}&limit=20',
      description: 'A page of hydrated posts plus the cursor for the next page.',
    },
  ],
  dataFlow: [
    'A new post is stored and the author gets an answer at once; a relay reads the store’s change stream and queues the fan-out.',
    'Fan-out workers page through the author’s followers and add the post ID to the head of each follower’s feed.',
    'Authors with huge audiences get no fan-out task; their posts are merged in when a follower reads.',
    'Reading a feed fetches the precomputed IDs, merges in posts from big accounts, and hydrates them from a post cache, where deleted, hidden and blocked posts are dropped.',
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
      ['api', 'posts', 'new'],
      ['posts', 'postStore'],
      ['postStore', 'queue', 'relay'],
      ['queue', 'fanout'],
      ['fanout', 'graph', 'followers'],
      ['fanout', 'feeds', 'prepend'],
      ['api', 'feedSvc', 'read'],
      ['feedSvc', 'feeds'],
      ['feedSvc', 'postCache', 'get'],
      ['feedSvc', 'postStore', 'old'],
    ],
    edgeStages: [{ edge: ['feedSvc', 'postStore'], stages: [9] }],
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
          ['api', 'posts', 'new'],
          ['posts', 'postStore'],
        ],
        short: 'Store post',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '40 ms',
          errorRate: '0.01%',
        },
        load: { api: 30, posts: 30, postStore: 25 },
      },
      {
        title: 'Hand off the fan-out',
        narration:
          'The post service answers the author as soon as the post is stored. A relay reads the store’s change stream and puts a fan-out task on a queue. Delivering the post to followers happens in the background.',
        tradeoff:
          'The author never waits for thousands of feed writes, and a spike of posts just makes the queue longer. The cost is that followers see the post seconds later instead of instantly, which suits a feed. Storing the post and queuing the event must not drift apart, so the event comes from the store itself: its change stream records every committed post, acting as the outbox, and a relay turns each INSERT record into a fan-out task, as long as it reads the stream within its 24-hour retention; the MODIFY records that edits and deletes leave in the same stream start no fan-out.',
        nodes: ['posts', 'postStore', 'queue'],
        travel: [['postStore', 'queue', 'relay']],
        short: 'Queue',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '40 ms',
          errorRate: '0.01%',
        },
        load: { posts: 30, postStore: 25, queue: 20 },
      },
      {
        title: 'Page through the followers',
        narration:
          'A fan-out worker takes the task and reads the author’s followers from the follow graph in pages of 5,000. A large list becomes one task per page: after reading a page, the worker queues the task for the next one.',
        tradeoff:
          'Splitting the work lets many workers share one big fan-out and makes each task cheap to retry. Storing the graph in both directions doubles its size, but both "who follows me" and "whom do I follow" become single lookups.',
        nodes: ['queue', 'fanout', 'graph'],
        travel: [
          ['queue', 'fanout'],
          ['fanout', 'graph', 'followers'],
        ],
        short: 'Followers',
        metrics: { users: '50M', requestsPerSecond: '200K', p95Latency: '2 s', errorRate: '0.01%' },
        load: { queue: 25, fanout: 35, graph: 30 },
      },
      {
        title: 'Prepend the post to each feed',
        narration:
          'For each follower, the worker adds the post ID to that follower’s feed, a set ordered by post time in an in-memory store, and trims it to the newest few hundred entries.',
        tradeoff:
          'Fan-out on write turns every feed read into a single sorted set lookup, at the cost of one write per follower per post. Storing only IDs keeps each feed to a few kilobytes; the cap bounds memory, and older pages fall back to a slower path. Because the feed is keyed by post ID, a retried task adds nothing twice.',
        nodes: ['fanout', 'feeds'],
        travel: [['fanout', 'feeds', 'prepend']],
        short: 'Prepend',
        metrics: { users: '50M', requestsPerSecond: '200K', p95Latency: '2 s', errorRate: '0.01%' },
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
          p95Latency: '4 min',
          errorRate: '0.01%',
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
          'If the author has more than a threshold of followers, say a hundred thousand, the relay creates no fan-out task. Those posts stay only in the post store. One job owns the list of accounts over the threshold and publishes it to the relay and to the feed service that the next stages add; an account is on the list for a minute before the relay stops pushing it, so no post falls between push and pull.',
        tradeoff:
          'One post from an account with tens of millions of followers would mean tens of millions of writes, delaying everyone else’s fan-out. Skipping it moves that cost to read time, where it is paid only by followers who actually open the app.',
        nodes: ['posts', 'postStore'],
        travel: [['posts', 'postStore']],
        short: 'Skip large',
        metrics: { users: '50M', requestsPerSecond: '200K', p95Latency: '2 s', errorRate: '0.01%' },
        load: { posts: 30, postStore: 25, queue: 25, fanout: 35, graph: 30, feeds: 30 },
      },
      {
        title: 'Read the precomputed feed',
        narration:
          'A reader opens the app. The feed service reads the first page of post IDs from the reader’s feed, a sorted set, in a single lookup.',
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
          errorRate: '0.01%',
        },
        load: { api: 35, feedSvc: 30, feeds: 35 },
      },
      {
        title: 'Merge in posts from large accounts',
        narration:
          'The feed service intersects the reader’s following list, cached next to the feed with a one-minute expiry and rewritten on each follow or unfollow, with the published list of accounts over the threshold, which is small enough to keep in every task’s memory. It fetches their recent posts from the post cache, where each such account’s list of recent posts is an entry that lives only a few seconds, and merges them with the precomputed IDs by time.',
        tradeoff:
          'This hybrid keeps writes bounded and still shows posts from huge accounts within about a minute. It makes reads a little more complex, but accounts over the threshold are a small share of those a reader follows, their recent posts come back in one batched call, and they are among the most cached objects in the system.',
        nodes: ['feedSvc', 'postCache'],
        travel: [['feedSvc', 'postCache', 'get']],
        short: 'Merge large',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '50 ms',
          errorRate: '0.01%',
        },
        load: { feedSvc: 40, postCache: 45 },
      },
      {
        title: 'Hydrate the page',
        narration:
          'With the merged list of IDs, the feed service fetches post bodies and author details for the newest 20 in one batched call to the post cache. Only now can it drop deleted, hidden or blocked posts, because a feed entry holds no author; it fills the gaps from the spare IDs it fetched and returns the page.',
        tradeoff:
          'Keeping IDs in feeds and content in one cache means an edit or deletion is made in one place and reaches every feed as soon as that cache entry is replaced. The post service replaces it after the write commits, and the relay rewrites it again from the MODIFY record in the stream; these two writes are not drawn here, and the delete flow shows them. Every edit or delete raises the post’s version number, and both writers keep the copy with the higher version, so the entry can live for hours, with that TTL as the backstop. The cost is a second round trip per page, kept small by batching and a very high hit rate on recent posts.',
        nodes: ['feedSvc', 'postCache', 'api', 'client'],
        travel: [['feedSvc', 'postCache', 'get']],
        short: 'Hydrate',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '60 ms',
          errorRate: '0.01%',
        },
        load: { feedSvc: 40, postCache: 50, api: 35 },
      },
      {
        title: 'Scroll with a cursor',
        narration:
          'Each page returns a cursor holding the time and ID of its last post. The next request continues strictly after it, even if new posts arrived in between. Past the cached window, the feed service pulls older posts from the post store, author by author.',
        tradeoff:
          'Offsets shift when new posts are prepended, so users would see duplicates. A cursor is stable, at the cost of not allowing a jump to an arbitrary page, which a feed does not need. The pull for old pages is slower than a cached page, which is the price of capping each feed at a few hundred entries.',
        nodes: ['client', 'feedSvc', 'feeds', 'postStore'],
        travel: [
          ['feedSvc', 'feeds'],
          ['feedSvc', 'postStore', 'old'],
        ],
        short: 'Cursor',
        metrics: {
          users: '50M',
          requestsPerSecond: '200K',
          p95Latency: '60 ms',
          errorRate: '0.01%',
        },
        load: { feedSvc: 40, feeds: 35, postStore: 30 },
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
          note: 'The request carries Ana’s token, an idempotency key her app chose, and the text plus references to media already uploaded to S3.',
        },
        {
          from: 'svc',
          to: 'db',
          label: 'Put post author=ana, sk=time#postId, with the key if absent',
          note: 'Partitioned by author, so "Ana’s recent posts" is one query, which the pull path for large accounts relies on. One transaction writes the post and, in a separate table, an item for Ana’s idempotency key that holds the post ID, on the condition that the key item is absent. If Ana’s app timed out and retries with the same key, the condition fails, nothing is stored, and the service returns the post ID read from the key item. Key items expire after a day.',
        },
        {
          from: 'db',
          to: 'stream',
          label: 'stream record',
          note: 'Every committed write appears in the table’s stream. This is the outbox without an outbox table: the post and its event cannot diverge, as long as the relay reads the stream within its 24-hour retention.',
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
        'Ana’s post reaches the feeds of her followers who were active in the last few weeks, in pages of 5,000.',
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
          note: 'A Lambda reads the stream and starts a fan-out only on an INSERT record; a MODIFY record, left by an edit or a delete, starts none and only rewrites that post’s entry in the post cache. For an INSERT it checks whether Ana is on the published list of accounts over the 100K threshold. She has 200 followers, so her post is pushed.',
          style: 'async',
        },
        {
          from: 'relay',
          to: 'sqs',
          label: 'task {postId, page 1}',
          note: 'Every fan-out starts on the first-page queue, so the relay needs no follower count. Later pages go to a second queue, so a large fan-out cannot delay thousands of small ones.',
        },
        {
          from: 'worker',
          to: 'graph',
          label: 'followers of ana, active only',
          note: 'Followers are read in pages of 5,000. If the page is not the last, the worker queues a task for the next page, carrying the position where it starts, before it writes any feed; a redelivered task queues it again, which the idempotent adds make harmless. Each follower edge carries an active flag, set when the user returns and cleared by a sweep after a few weeks without a read; inactive users and, for a private account, unapproved followers are skipped. The sweep and a rebuild both claim the user’s activity record with a conditional write that raises its version. The claim is released at the end and expires otherwise, so one left by a crashed task can be taken over, and every flag write is a transaction that checks that version, so a task that lost its claim changes no flag. The sweep deletes the cached feed before it clears the flags.',
        },
        {
          from: 'worker',
          to: 'feeds',
          label: 'add postId to feed:u if it exists; trim to 500',
          note: 'Each follower’s feed is a sorted set keyed by post ID, so a retried task adds nothing twice, and the trim keeps memory bounded. The add is a small script that runs only if the feed key exists, so a feed that was evicted or lost is never recreated with one entry; it is rebuilt whole by pull on its next read.',
        },
        {
          from: 'worker',
          to: 'sqs',
          label: 'delete message',
          note: 'Only after every write of the page succeeded and the next page was queued. A worker that dies leaves the message to reappear for another worker.',
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
          note: 'A single lookup returns the newest pushed IDs, whatever the number of accounts Bruno follows. It fetches 40 IDs for a page of 20, so there are spare candidates after merging and after hydration drops blocked, deleted or hidden posts.',
        },
        {
          from: 'feedsvc',
          to: 'pcache',
          label: 'recent posts of the 3 large accounts he follows',
          note: 'Posts from accounts over the threshold were never pushed; they are among the most cached objects in the system, fetched in one batched call. Each such account’s list of recent posts is a cache entry that expires after a few seconds and is refilled with one query to the author’s partition, with concurrent misses coalesced, so a new post shows up in it without any write from the publish path.',
        },
        {
          from: 'feedsvc',
          to: 'feedsvc',
          label: 'merge by time, dedupe by ID',
          note: 'Pushed and pulled posts are merged newest first and duplicates removed by post ID. Nothing is filtered yet: a feed entry is only an ID and a timestamp, so the author of a pushed post is unknown until hydration.',
        },
        {
          from: 'feedsvc',
          to: 'pcache',
          label: 'batched GET of the newest 20 candidates',
          note: 'One batched round, pipelined per shard because the keys live on different shards; the few misses are read from the post store with concurrent misses for the same post coalesced. Each body carries its author and visibility, so tombstones, hidden posts and posts from authors who blocked Bruno are dropped here, and one more batched round hydrates spare candidates to fill the gaps. If the page is still short after that round, it is returned short.',
        },
        {
          from: 'feedsvc',
          to: 'bruno',
          label: 'up to 20 posts + cursor(time, id)',
          note: 'The cursor holds the time and ID of the last post returned, so the next page continues strictly after it even if new posts arrive.',
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
          note: 'A tombstone, not a plain delete: cache fills only add a key that is absent, so a fill racing the delete cannot bring the old copy back. The delete raised the post’s version number and the tombstone carries it; a cache write replaces an entry only with a higher version, so a late write from an earlier edit cannot replace the tombstone. Marking the post deleted left a MODIFY record in the stream, so the relay writes the same tombstone again within seconds if this SET failed.',
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
          label: 'whom does Carla follow; set active on those edges',
          note: 'The graph is stored in both directions, so this is one lookup. The feed service claims Carla’s activity record with a conditional write, then sets the active flag on her follow edges before anything is cached. The writes are idempotent and retried a few times; if they still fail, or the sweep or another rebuild holds an unexpired claim on the record, the page is served by pull, nothing is cached and the next read starts over.',
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
          label: 'store her feed, then add posts made during the rebuild',
          note: 'Fan-out includes Carla from the moment her flags are set, but its add is skipped while her feed does not exist. So after storing the feed, the service pulls once more the posts created since just before the rebuild began and adds them; adds are idempotent. The feed is stored with a one-minute expiry; the service then reads the activity record again, removes the expiry if it still holds its claim and deletes the feed if the claim was taken over meanwhile, so neither a stalled rebuild nor one that crashes before this check can leave a feed without flags. A crash before this step leaves flags without a feed, which the next read rebuilds, never a feed that some authors skip. A feed with no posts is stored with a placeholder entry, so it exists and is not rebuilt on every read.',
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
        'Only for users active in the last few weeks. A returning user gets one slower load built by pull, after which their feed is kept up to date by push again. A rebuild sets the active flags before it stores the feed, and the sweep that retires an inactive user deletes the feed before it clears the flags, so a cached feed is not left without its flags, and after a feed cache failover the sweep’s recent deletes are run again in case one was lost; both work under a versioned claim on the user’s activity record, and a rebuild that lost its claim deletes the feed it stored, which expires within a minute if the rebuild crashes before that check.',
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
        'Both. Fan-out pushes a private account’s post only to approved followers, read from the same follow graph. On read, hydration drops posts whose author has blocked the reader or whose visibility no longer allows them, using a small per-user block set and the reader’s following list, both cached next to the feed. A block is committed to the store and then replaces the blocked user’s cached set, so it takes effect within seconds; a fill can race that update, so the set also expires after a minute and is reloaded from the store. The following list has the same one-minute expiry and reload, so a follow, an unfollow or a removed follower whose cache rewrite failed is still picked up within a minute. Unfollows are cleaned up in the background, and the post cache holds visibility with each post, so a post made private is an edit and takes effect within seconds. An account that goes private changes one flag on its author record, which is cached with the author details that hydration already reads and is replaced when the change commits, and hydration drops a private author’s posts for a reader whose following list does not hold that author, so no post is rewritten. The account’s existing followers stay approved, so the flag matters only for entries left in the feed of a follower removed later; if replacing the cached author entry fails, the flag waits for that entry to expire.',
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
        'Pull from at most a few hundred of the large accounts the reader follows, those that posted most recently, known because the published list carries each account’s last post time, which the job that owns the list refreshes about once a minute, in one batched call, and cache the merged pulled list per reader for about a minute; scrolling pages read from it. Readers who follow more than a few hundred large accounts are rare, and a minute matches the freshness target for pushed posts anyway.',
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
        'Replicate posts and the follow graph, with DynamoDB global tables, and let each region fan out into its own feed cache for the users who live there. Each user is assigned a home region for writes, so a follow or a post is written in one place. The two directions of a follow are atomic only in the region that wrote them; another region can see one before the other for a moment. Derived data is rebuilt locally, never copied.',
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
          'At least once, made harmless by the post ID. The store’s change stream records every committed post, so a stored post always produces an event, as long as the relay reads the stream within its 24-hour retention; tasks are acknowledged only after their feed writes succeed, and adding a post ID that a feed already holds changes nothing.',
      },
      {
        property: 'Feed freshness',
        promise:
          'Eventual. A pushed post reaches the feeds of active followers within about a minute while the queue keeps up; this is an objective measured from post time to feed write, not a hard bound. Posts from accounts over the threshold are read from the author’s recent posts at read time, so they do not depend on fan-out at all; they are at most about a minute stale because of the per-reader merge cache, plus the few seconds of the shared recent-post list and of the local cache in each feed service task.',
      },
      {
        property: 'Pagination',
        promise:
          'Within one scroll, no post is returned twice and no page shifts when new posts arrive, because each request continues strictly after a cursor of post time and post ID, and pushed and pulled posts are merged and deduplicated by post ID.',
      },
      {
        property: 'Deletes and edits',
        promise:
          'A deleted or edited post changes in every feed within seconds: the post service replaces the cache entry after the write commits, and the relay, which sees every committed change as a MODIFY record, rewrites the entry or its tombstone again, at least once. Every edit or delete raises the post’s version number in the store, and both writers replace a cache entry only with a higher version, so a repeated or late write from either changes nothing. Staleness therefore follows the relay’s lag, whose IteratorAge is alarmed at 10 s, and the entry’s TTL of hours is only the backstop. A delete writes a tombstone to the cache and fills only add a key that is absent, so a fill racing the delete cannot bring the old copy back.',
      },
    ],
    assumes: [
      'Feed writes are idempotent: the feed is a set keyed by post ID, never an append-only list.',
      'The fan-out queue redelivers unacknowledged tasks, and the store’s change stream keeps 24 hours of records, so the posts of a recent window can be fanned out again.',
      'Post IDs are unique and roughly time ordered, and server clocks agree to within tens of milliseconds.',
      'Any feed can be rebuilt by pull from the follow graph and the post store, so losing feed cache memory costs latency, not data. Fan-out adds only to a feed that exists, so a lost feed is rebuilt whole instead of being left partial.',
      'The follow graph read by a fan-out task may be seconds stale; an account followed during a fan-out, or a reader whose active flag was set during it, can miss that one post; the hourly sampling job counts it only when the follow preceded the post.',
      'The relay and every feed service task read the same published list of accounts over the threshold, and an account is on that list for a minute before the relay stops pushing it. Both refresh the list every few seconds and, before using a copy older than 30 s, reload it, so while reloads succeed every task that serves reads has the account on its list before the relay stops pushing it. A relay or a task that cannot reload keeps using its last copy, and the job that owns the list makes no threshold change while the list is unreadable, so an outage of the list moves no account between push and pull. A relay on an old copy is safe: on the way up it keeps pushing an account that readers already pull, and the merge deduplicates by post ID; on the way down it resumes pushing late, which the one-day pull covers. A task that alone cannot reload is the accepted gap listed below. Each task and the relay publish the age of the copy they used, alarmed above 30 s to inform the operator. On the way down the relay, whose copy has the same 30 s refresh bound while its reloads succeed, pushes the account again, and feed service tasks keep pulling it for a day counted from the leaving mark plus that bound.',
    ],
    doesNotGuarantee: [
      'A total order across authors. Order follows creation timestamps, so two posts made within clock skew of each other can appear in either order.',
      'That a post delivered late is seen in the current scroll. If it is newer than a cursor the reader has already passed, it appears on the next load from the top.',
      'That the author’s followers see a post at the same moment, or that the server shows authors their own post instantly; the client inserts it locally.',
      'Immediate removal after an unfollow or a block. Entries already pushed are filtered at read time for blocks, within seconds and within the block set’s one-minute TTL at worst, and cleaned up in the background for unfollows.',
      'A complete history. The cached feed holds a few hundred entries; older pages come from a slower pull.',
      'Posts from every large account for a reader who follows more than a few hundred of them. The pull takes the few hundred that posted most recently; the rest are neither pushed nor pulled for that reader, and the sampling job does not measure them.',
      'The newest posts of an account that just joined the list of accounts over the threshold, for readers served by a feed service task that cannot reload the list. The relay stops pushing a minute after the account is listed, and that task does not pull the account until a reload succeeds.',
      'A full page every time. A page that loses more posts to deletes, blocks and visibility than one extra hydration round can replace is returned short.',
    ],
  },
  failures: [
    {
      scenario: 'The relay that turns stream records into fan-out tasks stops or falls behind.',
      impact:
        'Posts are stored and the authors see them, but no follower receives them. If the outage outlasted the stream’s retention, those events would be lost.',
      detection:
        'The relay’s IteratorAge, the age of the last record in each batch when the relay is invoked, alarmed at 10 s, far below the 24-hour retention. A relay that is never invoked publishes nothing, so the alarm treats missing data as breaching.',
      recovery:
        'The relay resumes from its last checkpoint in the stream and publishes everything after it. The event may then be published twice; the post ID makes the second fan-out a no-op. The post ends up in every feed once. A record that fails every time would block its stream shard, so the relay retries a failing batch a few times, splits it to isolate the record, sends that record’s position to an on-failure queue and moves on; the queue is alarmed and the post is replayed from the stream.',
    },
    {
      scenario: 'A fan-out worker dies partway through a page of followers.',
      impact:
        'Some followers in the page have the post and the rest do not, until the task runs again. A task that always fails would block those followers for good.',
      detection:
        'Redelivery count per task and the depth of the dead-letter queue, which should stay at zero and is alarmed above zero.',
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
        'Posts created in a window before the failover are re-read from the store’s change stream, which keeps 24 hours of records, and fanned out again; idempotent adds fill only the gaps. The sweep’s feed deletes of the same window are run again for users who are still inactive, because a delete lost in the failover would bring back a feed whose flags are already cleared. A feed that is missing entirely is rebuilt by pull on its next read, with rebuilds rate limited so they cannot overload the post store. Both paths converge to the same feed.',
    },
    {
      scenario:
        'Fan-out falls behind: a burst of posts, or many accounts just under the threshold posting together.',
      impact:
        'Posts reach feeds minutes late and the freshness objective is missed. Nothing is lost and reads stay fast, but they serve older content.',
      detection:
        'Age of the oldest task, alarmed at 30 s on the first-page queue and at a few seconds on the later-pages queue, which is a scaling signal, and the time from post creation to the last feed write, alarmed at 45 s, below the 60 s target, both as a p99 over all posts and as a maximum over multi-page fan-outs.',
      recovery:
        'Workers scale on queue age. First pages and later pages use separate queues so one large job cannot delay thousands of small ones, and the push threshold can be lowered for a while so more authors are pulled at read time; the change goes through the published list, so those authors are pulled before the relay stops pushing them, and when the threshold is raised back they leave the list like any account that drops below it. The backlog drains and feeds converge.',
    },
    {
      scenario: 'The post cache is cold or unavailable, for example after a restart.',
      impact:
        'Every page turns into about twenty post store reads. At peak that is millions of lookups a second against a store sized for a small miss rate, so latency rises and timeouts start to cascade.',
      detection:
        'Post cache hit rate, alarmed below 98.5%, post store read latency, and the feed service timeout rate.',
      recovery:
        'The feed service coalesces concurrent misses for the same post, sheds load by returning shorter pages, and stops hydrating behind a circuit breaker before the store saturates. The cache warms from live traffic; it holds only derived data, so nothing needs repair. While it is down the relay’s rewrites of edited and deleted posts fail, and fan-out on that stream shard waits behind the failing batch until its records are set aside; they go to the on-failure queue and are replayed from the stream once the cache is back.',
    },
    {
      scenario: 'An account crosses the push threshold, in either direction.',
      impact:
        'Going up, recent posts exist in feeds and in the pull path at once. Going down, posts made while the account was large were never pushed, so they vanish from feeds when readers stop pulling.',
      detection:
        'A sampling job rebuilds a few thousand feeds by pull each hour and compares them with the cached ones, reporting missing and extra entries. It compares only posts created after the reader followed their author, because a follow does not backfill older posts, ignores entries of unfollowed authors that await cleanup, and ignores posts created between the time their author joined the published pull list and the time it was marked as leaving plus the relay’s 30 s refresh bound, both times recorded on the list and kept, after the account comes off it, in a record the job reads for as long as a rebuild can still return those posts, because those are never expected in a pushed feed; posts made after that mark plus the bound are pushed again, so they are compared.',
      recovery:
        'An account joins the published pull list a minute before the relay stops pushing it, and the merge deduplicates by post ID, which covers the way up. The threshold has hysteresis. On the way down the list marks the account as leaving: the relay, whose copy of the list has the same 30 s refresh bound as the feed service tasks while its reloads succeed, pushes its new posts again from the mark plus that bound, and feed service tasks keep pulling it for one more day counted from the mark plus that bound before it comes off the list, so no post falls between pull and push; a relay that cannot reload resumes later, still inside that day. Posts it made before the relay resumed were never pushed, so they leave readers’ feeds when that day ends, about a day old or more, which is accepted.',
    },
  ],
  capacity: {
    assumptions: [
      '300M daily users, 50M online at peak, and 500M users active in the last few weeks.',
      'Each daily user loads about 30 feed pages of 20 posts, most of them the first page again on a later visit; one user in three publishes a post each day.',
      'A typical author has 200 followers, about half of them active recently. Accounts over 100K followers are not pushed.',
      'A feed holds up to 500 post IDs at about 16 bytes each (ID and timestamp) in the sorted set’s compact encoding, and a stored post is about 1 KB with media kept elsewhere.',
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
        value: '~4 TB, about 134 nodes with replicas',
        math: '500 IDs × 16 B = 8 KB per feed × 500M active users = 4 TB; ÷ 60 GB of feeds per node, 80% of the ~75 GB usable on a 105 GB node (cache.r7g.4xlarge), ≈ 67 primaries, × 2 for one replica each',
      },
      {
        label: 'One post from a huge account, if pushed to every follower',
        value: '~4 minutes of all spare fan-out capacity',
        math: '30M followers ÷ 120K spare writes/s (350K provisioned minus 230K peak) = 250 s; pushing only to the active half, 15M, would still take 125 s',
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
      'A single 30M-follower post would use every spare write for about four minutes, or two if only its active followers were written, and delay all other posts, so accounts over the threshold are pulled at read time. The largest pushed post is then at most 100K writes, under a second of spare capacity.',
      'The feed cache is sized by memory, not by throughput: 430K operations/s over 67 primaries is about 6K each. The two levers are therefore the 500-entry cap and the active-user window, not faster nodes.',
      '4M post lookups a second cannot go to the post store, so hydration is one batched call to a cache, and a 1% miss rate still means 40K store reads a second; the store is provisioned for about twice that, 80K, and the alarm fires at a 1.5% miss rate, 60K. That hit rate needs a post entry that lives for hours: of the 200 accounts a reader follows about 60 are daily users and one in three of those posts each day, about 20 new posts a day, so a typical post stays in the top 20 for about a day and its author’s 100 active followers, about 60 of them daily users loading 30 pages a day, look it up about once a minute over that time, roughly 1,800 lookups. An entry that expired after 5 minutes would be refilled about every seven lookups, a miss rate of about 15% and roughly 600K store reads a second; one that lives for hours is filled at most a few times in those 1,800 lookups, a few tenths of a percent at most, so edits and deletes are applied by rewriting the entry, not by a short expiry. Recent posts are a few hundred gigabytes, which fits in memory.',
      'A hundred gigabytes a day outgrows one machine within weeks, so at this scale the post store is partitioned, by author because that is how the pull path reads it.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one region across three Availability Zones. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'API',
        service:
          'One Application Load Balancer per service, Amazon Cognito tokens, Amazon ECS on AWS Fargate',
        why: 'Stateless post and feed services scaling on request count, each behind its own load balancer so the errors a load balancer generates itself are counted per service.',
        watch:
          'ALB TargetResponseTime, RequestCount, HTTPCode_Target_5XX_Count and HTTPCode_ELB_5XX_Count, per service.',
      },
      {
        part: 'Post store',
        service:
          'Amazon DynamoDB: author as partition key, time and post ID as sort key; a second table holds the idempotency keys, with a one-day TTL',
        why: 'Partitioned by author as the pull path reads it, durable across three zones, and its writes feed a change stream.',
        watch:
          'WriteThrottleEvents (a prolific author’s partition), SuccessfulRequestLatency, ConsumedReadCapacityUnits during rebuild waves.',
      },
      {
        part: 'Outbox',
        service: 'DynamoDB Streams read by an AWS Lambda relay',
        why: 'Every committed post appears in the stream, so the post and its fan-out event cannot diverge while the relay reads the stream within its 24-hour retention, without a separate outbox table.',
        watch:
          'Lambda IteratorAge on the stream, the post-to-event delay; Errors and Throttles on the relay; ApproximateNumberOfMessagesVisible on its on-failure queue.',
      },
      {
        part: 'Fan-out queues and workers',
        service:
          'Two Amazon SQS queues, one for first pages and one for later pages of a fan-out, consumed by workers on Amazon ECS',
        why: 'At-least-once delivery that idempotent adds make harmless; separate queues keep a large fan-out from delaying small ones.',
        watch:
          'ApproximateAgeOfOldestMessage per queue, ApproximateNumberOfMessagesVisible on the dead-letter queue, worker RunningTaskCount.',
      },
      {
        part: 'Follow graph',
        service:
          'Amazon DynamoDB: one item per direction, written together with TransactWriteItems',
        why: '"Who follows me" and "whom do I follow" are each one query; the two directions never disagree in the region that wrote them.',
        watch:
          'ConsumedReadCapacityUnits, which follows fan-out pages, and throttling on very large follower lists.',
      },
      {
        part: 'Feed cache',
        service:
          'Amazon ElastiCache for Valkey, cluster mode, about 67 shards of cache.r7g.4xlarge with one replica each',
        why: 'A sorted set per active user, about 8 KB, sharded by user; adds are idempotent and the trim keeps memory bounded.',
        watch:
          'DatabaseMemoryUsagePercentage, Evictions, EngineCPUUtilization per shard, ReplicationLag.',
      },
      {
        part: 'Post cache',
        service:
          'A separate Amazon ElastiCache cluster for post bodies, author details and tombstones',
        why: 'Recent posts are a few hundred gigabytes and are read 4M times a second, so hydration must hit memory.',
        watch:
          'CacheHitRate, which must stay near 99% and is alarmed below 98.5%, and the post store reads it lets through.',
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
      'DynamoDB Streams keep records for 24 hours, so a relay outage longer than that would lose events; the relay’s IteratorAge has an alarm far below that. Lambda publishes IteratorAge only when it invokes the relay, so the alarm treats missing data as breaching.',
      'By default a stream record that keeps failing blocks its shard until it expires, so the relay’s event source mapping is set to retry a few times, split the failing batch, and send the record’s position to an on-failure queue.',
      'HTTPCode_Target_5XX_Count leaves out the responses a load balancer generates itself, and HTTPCode_ELB_5XX_Count is reported per load balancer, not per target group, so each service has its own load balancer and its error rate adds both counts.',
      'One DynamoDB partition takes about 1,000 write units a second and a post is written in a transaction, which costs two units per kilobyte, so while a post item stays within 1 KB an author’s partition takes about 500 posts a second, far above any human author, but a bot posting in a loop is throttled there first.',
      'An SQS message is at most 1 MiB, so a task carries a post ID and the position of one follower page, never the follower list itself.',
      'ElastiCache reserves part of each node’s memory, so a 105 GB node holds about 75 GB of data. The capacity plan fills 60 GB of that with feeds, 80%, which leaves room under the 85% memory alarm for the following lists, block sets and merged lists cached next to them; those expire after a minute, so only users reading right now hold them.',
      'ElastiCache allows 90 nodes per cluster by default with cluster mode enabled; 67 shards with one replica each are 134 nodes, so the feed cache needs a quota increase.',
      'A sorted set lives on one shard, so a single feed is capped by one node; with 8 KB feeds sharded by user that is never the limit.',
      'A sorted set keeps its compact encoding only up to 128 entries by default (zset-max-listpack-entries), so that limit is raised to 500; otherwise each entry would cost several times the 16 bytes the capacity plan uses.',
    ],
  },
  slos: [
    {
      objective: 'Feed load',
      target: '99% of first pages served from a cached feed within 200 ms',
      measure:
        'A latency metric the feed service emits per request, tagged first page or later and cached or rebuilt, which the load balancer cannot tell apart, with failed requests counted as slow. A rebuilt first page takes a few hundred milliseconds, once per returning user, and is tracked on its own. ALB TargetResponseTime on the feed service mixes all four kinds, so it is only a cross-check on the dashboard.',
    },
    {
      objective: 'Freshness',
      target: '99% of pushed posts in followers’ feeds within 60 s',
      measure: 'Time from post creation to the last feed write of its fan-out, sampled per post.',
    },
    {
      objective: 'Publishing',
      target: '99.9% of requests to the post service succeed',
      measure:
        '(HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) ÷ RequestCount on the post service’s load balancer. The target count alone leaves out the responses the load balancer generates when the service is down. RequestCount counts only requests for which a target was chosen, so the ratio slightly overstates errors, which is the safe side.',
    },
    {
      objective: 'Feed correctness',
      target: 'Under 0.1% of entries missing in sampled feeds',
      measure:
        'The hourly job that rebuilds a few thousand feeds by pull and compares them with the cached ones, counting only posts created after the reader followed their author and ignoring posts created while their author was on the published pull list and not yet past its leaving mark plus the relay’s 30 s refresh bound.',
    },
  ],
  alarms: [
    {
      name: 'Fan-out falling behind',
      metric:
        'SQS ApproximateAgeOfOldestMessage above 30 s on the first-page queue or above a few seconds on the later-pages queue',
      meaning:
        'The first bottleneck: posts will miss the freshness target; scale workers or lower the push threshold for a while. The later-pages threshold is lower because a fan-out waits on that queue once per page after the first: the largest pushed account, just under 100K followers, is 20 pages of 5,000, so 19 waits. It is set above the time one page takes to process, because the age includes a message a worker is still processing, and it is a scaling signal, not a bound: the age is per message, and a 20-page fan-out goes through 19 of them one after another, so the total can pass 45 s with no message over the threshold; those fan-outs are bounded by the freshness alarm’s maximum over multi-page fan-outs.',
    },
    {
      name: 'Events not leaving the store',
      metric:
        'Lambda IteratorAge on the posts stream above 10 s, with missing data treated as breaching',
      meaning:
        'The relay is failing, throttled or not invoked at all, in which case Lambda publishes no IteratorAge; posts are stored but nobody is being told. For a one-page fan-out, which is nearly every post because a typical author has 200 followers, this and the 30 s first-page queue alarm add up to 40 s, under the 45 s freshness alarm and the 60 s target; a fan-out of more pages is bounded by the freshness alarm’s maximum over multi-page fan-outs, not by the queue alarms.',
    },
    {
      name: 'Freshness close to its target',
      metric:
        'Custom: time from post creation to the last feed write, p99 over all posts above 45 s or maximum over multi-page fan-outs above 45 s, with missing data treated as breaching',
      meaning:
        'The 60 s freshness SLO is about to be missed, whichever step is slow: the relay, a queue or the workers. Multi-page fan-outs can be too few to move the p99, and the queue alarms look at one message at a time, so their maximum is alarmed on its own. The workers publish this metric, so silence means no fan-out is finishing.',
    },
    {
      name: 'Stale threshold list',
      metric:
        'Custom: age of the published list copy that a feed service task or the relay used, maximum above 30 s',
      meaning:
        'A reload of the list of accounts over the threshold has been failing somewhere, which only informs the operator, because a task or a relay that cannot reload keeps using its last copy; missing data is not breaching, since whatever publishes nothing is using no copy.',
    },
    {
      name: 'Post cache misses',
      metric:
        'ElastiCache CacheHitRate below 98.5% on any node of the post cache, with missing data treated as breaching',
      meaning:
        'Hydration is leaking to the post store; at 4M lookups a second every point is 40K store reads, so the alarm fires by 60K, before the 80K the store is provisioned for.',
    },
    {
      name: 'Feed cache memory',
      metric: 'DatabaseMemoryUsagePercentage above 85% or Evictions above zero on the feed cache',
      meaning:
        'Nodes are planned at 80%, so memory has grown past the plan, or feeds are being evicted and rebuilt by pull; add shards or shorten the active-user window.',
    },
    {
      name: 'Rebuild wave',
      metric: 'Custom: feed rebuilds per second above twice the baseline',
      meaning:
        'A feed shard was lost or many users returned at once; the rebuild rate limit should be protecting the post store.',
    },
    {
      name: 'Feeds drifting',
      metric:
        'Custom: missing entries in sampled feeds above 0.05%, with missing data treated as breaching',
      meaning:
        'Half of the 0.1% correctness budget is used: fan-out is dropping writes, or a threshold change left gaps; find the cause before it spreads. The hourly job publishes this metric, so silence means the job itself is down.',
    },
    {
      name: 'Tasks set aside',
      metric:
        'SQS ApproximateNumberOfMessagesVisible above 0 on the fan-out dead-letter queue or on the relay’s on-failure queue',
      meaning:
        'A fan-out page or a stream record failed every retry, so some followers are missing a post until it is replayed. This fires long before the hourly sample can show drift, and clears once the on-call engineer has fixed the cause and replayed the messages, which empties the queue.',
    },
    {
      name: 'Feed pages slowing',
      metric:
        'Custom: p99 latency of first pages served from a cached feed, emitted by the feed service, above 150 ms, with missing data treated as breaching',
      meaning:
        'First pages are heading for the 200 ms target: look at the feed cache, the post cache hit rate and the rebuild rate. The feed service publishes this metric, so silence means it is serving nothing.',
    },
    {
      name: 'API errors',
      metric:
        '(HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) ÷ RequestCount above 0.05% on the post service’s or the feed service’s load balancer, with missing data treated as breaching',
      meaning:
        'Half of the 0.1% publishing error budget is being burned, or feed reads are failing. The load balancer’s own count is included because target counts leave out the errors it returns when a service is down. The load balancer’s own 5XX count is reported only in minutes that have errors, so an absent count is read as zero; RequestCount counts only requests for which a target was chosen, so the ratio slightly overstates errors, which is the safe side, and it is missing only when no target is registered, which counts as breaching.',
    },
  ],
  evolution: {
    mvp: 'One relational database and no feed store. A feed read selects the newest posts whose author is in the reader’s following list, using an index on author and creation time, with the same cursor. There is no queue, no fan-out and nothing to keep consistent, and it works while following lists are short and reads are a few hundred a second.',
    atScale: [
      'At 10x, reads dominate the database. Add read replicas and a post cache first, then move the merge to write time: a queue, fan-out workers and an in-memory feed per user. The pull query stays, as the rebuild path and for old pages.',
      'Also at 10x, the first accounts with very large audiences appear and fan-out lag becomes visible. Add the follower threshold and the read-time merge, and give the later pages of a large fan-out their own queue.',
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
