import type { Design } from '../types';

export const newsFeed: Design = {
  slug: 'news-feed',
  title: 'News feed',
  summary:
    'Show every user the latest posts from the accounts they follow in a fraction of a second, by precomputing feeds when posts are written, without letting an account with millions of followers turn one post into millions of writes.',
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Publish a post with text and links to media.',
      'Follow and unfollow other accounts.',
      'Read a feed of posts from followed accounts, newest first, with infinite scroll.',
    ],
    nonFunctional: [
      'Feed loads in a few hundred milliseconds, even for users who follow thousands of accounts.',
      'A new post shows up in followers’ feeds within about a minute.',
      'Hundreds of millions of daily users, with reads far outnumbering posts.',
      'Some accounts have tens of millions of followers.',
    ],
    outOfScope: [
      'Ranking by predicted interest (the design orders by time; a ranker could reorder the same candidates).',
      'Likes, comments and ads.',
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
      description: 'Per user: a capped list of recent post IDs, newest first.',
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
    'Fan-out workers page through the author’s followers and prepend the post ID to each follower’s feed.',
    'Authors with huge audiences are skipped; their posts are merged in when a follower reads.',
    'Reading a feed fetches the precomputed IDs, merges in posts from big accounts, and hydrates them from a post cache.',
  ],
  highLevel: {
    label: 'Publish a post, then read a feed',
    intro:
      'Follow a post from the author to the feeds of their followers, then follow a reader loading the first page of their feed. Press play, or step through the stages.',
    nodes: [
      { id: 'client', title: 'Clients', detail: 'Apps and web', column: 0, row: 'middle' },
      { id: 'api', title: 'API gateway', detail: 'Auth, routing', column: 1, row: 'middle' },
      { id: 'posts', title: 'Post service', detail: 'Writes posts', column: 2, row: 'top' },
      { id: 'postStore', title: 'Post store', detail: 'By author', column: 3, row: 'top' },
      { id: 'queue', title: 'Fan-out queue', detail: 'Post events', column: 3, row: 'middle' },
      {
        id: 'fanout',
        title: 'Fan-out workers',
        detail: 'Write feed entries',
        column: 4,
        row: 'middle',
      },
      { id: 'graph', title: 'Follow graph', detail: 'Followers by user', column: 4, row: 'top' },
      { id: 'feedSvc', title: 'Feed service', detail: 'Builds pages', column: 2, row: 'bottom' },
      { id: 'feeds', title: 'Feed cache', detail: 'Post IDs per user', column: 3, row: 'bottom' },
      {
        id: 'postCache',
        title: 'Post cache',
        detail: 'Bodies, authors',
        column: 1,
        row: 'bottom',
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
      },
      {
        title: 'Hand off the fan-out',
        narration:
          'The post service puts a "new post" event on a queue and answers the author immediately. Delivering the post to followers happens in the background.',
        tradeoff:
          'The author never waits for thousands of feed writes, and a spike of posts just makes the queue longer. The cost is that followers see the post seconds later instead of instantly, which suits a feed.',
        nodes: ['posts', 'queue'],
        travel: [['posts', 'queue', 'event']],
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
      },
      {
        title: 'Prepend the post to each feed',
        narration:
          'For each follower, the worker prepends the post ID to that follower’s feed list in an in-memory store and trims the list to the newest few hundred entries.',
        tradeoff:
          'Fan-out on write turns every feed read into a single list lookup, at the cost of one write per follower per post. Storing only IDs keeps each feed to a few kilobytes; the cap bounds memory, and older pages fall back to a slower path.',
        nodes: ['fanout', 'feeds'],
        travel: [['fanout', 'feeds', 'prepend']],
      },
      {
        title: 'Skip the very large accounts',
        narration:
          'If the author has more than a threshold of followers, say a hundred thousand, the worker does not fan out at all. Those posts stay only in the post store.',
        tradeoff:
          'One post from an account with tens of millions of followers would mean tens of millions of writes, delaying everyone else’s fan-out. Skipping it moves that cost to read time, where it is paid only by followers who actually open the app.',
        nodes: ['fanout', 'graph'],
        travel: [],
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
      },
      {
        title: 'Merge in posts from large accounts',
        narration:
          'The feed service looks up which large accounts the reader follows, fetches their recent posts from the post cache, and merges them with the precomputed IDs by time.',
        tradeoff:
          'This hybrid keeps writes bounded and still shows posts from huge accounts within seconds. It makes reads a little more complex, but a reader follows only a handful of such accounts, and their recent posts are among the most cached objects in the system.',
        nodes: ['feedSvc', 'postCache'],
        travel: [['feedSvc', 'postCache', 'hydrate']],
      },
      {
        title: 'Hydrate the page',
        narration:
          'With the final list of IDs, the feed service fetches post bodies and author details in one batched call to the post cache, drops deleted or hidden posts, and returns the page.',
        tradeoff:
          'Keeping IDs in feeds and content in one cache means an edit or deletion shows up everywhere at once. The cost is a second round trip per page, kept small by batching and a very high hit rate on recent posts.',
        nodes: ['feedSvc', 'postCache', 'api', 'client'],
        travel: [['feedSvc', 'postCache', 'hydrate']],
      },
      {
        title: 'Scroll with a cursor',
        narration:
          'Each page returns a cursor holding the time and ID of its last post. The next request continues strictly after it, even if new posts arrived in between.',
        tradeoff:
          'Offsets shift when new posts are prepended, so users would see duplicates. A cursor is stable, at the cost of not allowing a jump to an arbitrary page, which a feed does not need. Past the cached window, the service builds older pages by pulling from followed authors.',
        nodes: ['client', 'feedSvc', 'feeds'],
        travel: [['feedSvc', 'feeds']],
      },
    ],
  },
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
  ],
  wrapUp:
    'Posts stored by author, asynchronous fan-out of post IDs into capped per-user feeds, large accounts pulled and merged at read time, hydration from a shared post cache, cursor pagination, and feeds kept only for users who actually read them.',
};
