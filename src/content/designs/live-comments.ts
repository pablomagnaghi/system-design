import type { Design } from '../types';

export const liveComments: Design = {
  slug: 'live-comments',
  title: 'Live comments',
  summary:
    'Show comments on a live video to everyone watching within a second or two: comments are stored once, published on a channel per video, and pushed over long-lived connections to servers that only listen for the videos their viewers are watching.',
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Viewers post comments on a live video.',
      'Everyone watching sees new comments in near real time.',
      'Viewers who join late see the most recent comments.',
      'Viewers can scroll back to older comments.',
    ],
    nonFunctional: [
      'New comments reach viewers in under about two seconds.',
      'Scale to millions of concurrent viewers, with single videos watched by hundreds of thousands.',
      'Availability over strict ordering: viewers may see comments in slightly different orders.',
      'A posted comment is never lost once the poster sees it accepted.',
    ],
    outOfScope: [
      'Moderation, spam filtering and ranking of comments.',
      'Reactions, replies and the video stream itself.',
    ],
  },
  entities: [
    { name: 'Live video', description: 'A stream that is currently broadcasting.' },
    {
      name: 'Comment',
      description: 'Video, author, text and creation time, with an id that sorts by time.',
    },
    { name: 'Viewer', description: 'A user watching a video, who may also post comments.' },
    {
      name: 'Connection',
      description: 'A long-lived stream from one viewer to one real-time server, for one video.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/videos/{id}/comments',
      description: 'Body: text, idempotencyKey. Stores the comment and returns it with its id.',
    },
    {
      method: 'GET',
      path: '/videos/{id}/comments?before=…',
      description: 'A page of older comments, newest first, for joining late or scrolling back.',
    },
    {
      method: 'GET',
      path: '/videos/{id}/comments/stream',
      description: 'A server-sent events stream of new comments for this video.',
    },
  ],
  dataFlow: [
    'A viewer posts a comment; the API stores it durably.',
    'The API publishes the comment on the channel of that video.',
    'Real-time servers subscribed to that channel push it to their connected viewers.',
    'A viewer who joins late loads recent comments from a cache, then follows the stream.',
  ],
  highLevel: {
    label: 'Deliver a comment to every viewer',
    intro:
      'Follow one comment from the poster to every viewer of the same live video, and see how late joiners catch up. Press play, or step through the stages.',
    nodes: [
      { id: 'poster', title: 'Commenter', detail: 'Posts a comment', column: 0, row: 'middle' },
      { id: 'api', title: 'Comment API', detail: 'Validate, store', column: 1, row: 'middle' },
      { id: 'store', title: 'Comment store', detail: 'By video and time', column: 2, row: 'top' },
      { id: 'pubsub', title: 'Pub/sub', detail: 'Channel per video', column: 2, row: 'middle' },
      { id: 'cache', title: 'Recent cache', detail: 'Last few hundred', column: 3, row: 'top' },
      {
        id: 'realtime',
        title: 'Real-time servers',
        detail: 'Hold SSE streams',
        column: 3,
        row: 'middle',
      },
      { id: 'history', title: 'History API', detail: 'Pages by cursor', column: 4, row: 'top' },
      { id: 'router', title: 'Router', detail: 'Groups by video', column: 4, row: 'bottom' },
      { id: 'viewers', title: 'Viewers', detail: 'Watching live', column: 5, row: 'middle' },
    ],
    edges: [
      ['poster', 'api'],
      ['api', 'store', 'write'],
      ['api', 'pubsub', 'publish'],
      ['pubsub', 'realtime', 'by video'],
      ['realtime', 'viewers', 'push'],
      ['viewers', 'router', 'connect'],
      ['router', 'realtime'],
      ['viewers', 'history', 'join late'],
      ['history', 'cache'],
      ['cache', 'store', 'miss'],
    ],
    stages: [
      {
        title: 'Post a comment',
        narration:
          'A viewer posts a comment over a normal HTTP request with an idempotency key. The API checks length and rate limits for the author.',
        tradeoff:
          'Posting over the same long-lived stream would save a connection, but a plain request is easier to retry, authenticate and rate limit. Writes are rare compared to reads, so their cost barely matters.',
        nodes: ['poster', 'api'],
        travel: [['poster', 'api']],
      },
      {
        title: 'Store it durably first',
        narration:
          'The comment is written to a store partitioned by video, with an id that sorts by time. Only then does the poster get a success.',
        tradeoff:
          'Publishing first and storing later would shave a few milliseconds, and risk showing comments that are then lost. Storing first makes every accepted comment durable, and a write-optimized store keeps the extra latency small.',
        nodes: ['api', 'store'],
        travel: [['api', 'store', 'write']],
      },
      {
        title: 'Publish on the video channel',
        narration:
          'The API publishes the comment on a pub/sub channel named after the video. Pub/sub here is fire and forget: it does not keep messages for later.',
        tradeoff:
          'A durable log per video would allow replay, but adds storage and offset tracking for data that is already stored. Fire-and-forget pub/sub is fast and simple, and a viewer who misses a message can always reload recent comments from the store.',
        nodes: ['api', 'pubsub'],
        travel: [['api', 'pubsub', 'publish']],
      },
      {
        title: 'Viewers open a stream',
        narration:
          'Each viewer opens a server-sent events stream for the video. A router sends viewers of the same video to the same few real-time servers, using the video id.',
        tradeoff:
          'Spreading connections at random balances load perfectly, but then every server needs every popular channel. Grouping by video means each server listens to far fewer channels; the cost is uneven load that the router must rebalance for very popular videos.',
        nodes: ['viewers', 'router', 'realtime'],
        travel: [
          ['viewers', 'router', 'connect'],
          ['router', 'realtime'],
        ],
      },
      {
        title: 'Servers subscribe only to what they need',
        narration:
          'A real-time server subscribes to a channel when its first viewer of that video connects, and unsubscribes when the last one leaves.',
        tradeoff:
          'Broadcasting every comment to every server is simpler, but most servers would throw most messages away. Subscribing per video keeps traffic proportional to what is watched, at the cost of tracking subscriptions on each server.',
        nodes: ['pubsub', 'realtime'],
        travel: [['pubsub', 'realtime', 'by video']],
      },
      {
        title: 'Push to every viewer',
        narration:
          'The server writes the comment to every open stream for that video. Clients place it by its id, so small reorderings across servers are fixed on screen.',
        tradeoff:
          'Guaranteeing one global order would need a single sequencer per video and slow everything down. Sorting by a time-based id on the client is good enough for a chat that scrolls past in seconds.',
        nodes: ['realtime', 'viewers'],
        travel: [['realtime', 'viewers', 'push']],
      },
      {
        title: 'Join late from a cache',
        narration:
          'A viewer who joins mid-stream first loads the last few hundred comments. A cache keeps them per video, so a crowd joining at once does not hit the store.',
        tradeoff:
          'Reading the store on every join is simple but a popular video can bring thousands of joins per second. A small cache per video absorbs them, at the cost of keeping it in sync with new comments.',
        nodes: ['viewers', 'history', 'cache'],
        travel: [
          ['viewers', 'history', 'join late'],
          ['history', 'cache'],
        ],
      },
      {
        title: 'Scroll back further',
        narration:
          'Older pages are read from the store with a cursor on the comment id. Few viewers scroll back, so these reads are rare.',
        tradeoff:
          'Cursor pagination on a time-sorted id stays fast however deep the viewer goes, unlike page offsets that get slower and shift as new comments arrive. It only allows next and previous, which is all a comment list needs.',
        nodes: ['history', 'cache', 'store'],
        travel: [
          ['history', 'cache'],
          ['cache', 'store', 'miss'],
        ],
      },
      {
        title: 'Very busy videos',
        narration:
          'When a video gets more comments than anyone can read, servers batch them every half second and, above a threshold, send a sample instead of every comment.',
        tradeoff:
          'Sending everything is complete but floods clients with text nobody can read. Batching and sampling keep the stream readable and the servers cheap, at the cost that not every viewer sees every comment live, though all remain in the store.',
        nodes: ['realtime', 'viewers'],
        travel: [['realtime', 'viewers', 'push']],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do new comments reach the viewer?',
      options: [
        {
          name: 'Polling every few seconds',
          pros: 'Works everywhere, with plain HTTP.',
          cons: 'Millions of mostly empty requests, and up to a full interval of delay.',
        },
        {
          name: 'WebSockets',
          pros: 'Low latency in both directions.',
          cons: 'Two-way connections are more work for proxies and load balancers, and we only need one way.',
        },
        {
          name: 'Server-sent events',
          pros: 'One-way push over plain HTTP, with automatic reconnect built into browsers.',
          cons: 'Text only and one direction; posting still needs a separate request.',
        },
      ],
      choice:
        'Server-sent events for receiving and plain requests for posting. The traffic is almost all one-way, which is exactly what they are for.',
    },
    {
      question: 'How does a comment find the servers holding its viewers?',
      options: [
        {
          name: 'Send every comment to every server',
          pros: 'Trivial to build.',
          cons: 'Traffic grows with comments times servers; most of it is wasted.',
        },
        {
          name: 'Pub/sub channel per video',
          pros: 'Servers receive only the videos their viewers watch.',
          cons: 'Many channels to manage, and a popular video still reaches many servers.',
        },
        {
          name: 'Pub/sub plus routing viewers by video',
          pros: 'Viewers of one video share few servers, so each comment reaches few servers.',
          cons: 'Load becomes uneven and the router needs to spread out very popular videos.',
        },
      ],
      choice:
        'A channel per video, with the router grouping viewers by video. Very popular videos are spread across a fixed set of servers so no single server holds them all.',
    },
    {
      question: 'What do we do when a video gets thousands of comments per second?',
      options: [
        {
          name: 'Deliver every comment',
          pros: 'Complete.',
          cons: 'Unreadable for viewers and expensive to send.',
        },
        {
          name: 'Batch on a short interval',
          pros: 'Far fewer writes per connection, with little added delay.',
          cons: 'Still too many comments to read on the busiest videos.',
        },
        {
          name: 'Batch and sample above a threshold',
          pros: 'Readable and cheap at any volume.',
          cons: 'Viewers do not see every comment live.',
        },
      ],
      choice:
        'Batch always, and sample only above a threshold. Every comment is still stored and appears when scrolling back.',
    },
  ],
  wrapUp:
    'Store every comment once, publish it on a channel per video, and push it over server-sent events from servers that only listen for the videos their viewers watch; batch and sample when a video gets too busy to read.',
};
