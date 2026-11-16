import type { Design } from '../types';

export const photoSharing: Design = {
  slug: 'photo-sharing',
  title: 'Photo sharing',
  summary:
    'Let people post photos that their followers see in a scrolling feed: upload straight to storage, turn each photo into a few sizes before anyone sees it, serve every image from a CDN, and store who follows whom so both directions are one lookup.',
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Post one or more photos with a caption.',
      'Follow and unfollow other accounts.',
      'Scroll a feed of recent posts from followed accounts, with images that load quickly on any screen.',
    ],
    nonFunctional: [
      'Hundreds of millions of daily users and tens of millions of new photos a day.',
      'Images appear in a fraction of a second anywhere in the world; reads outnumber uploads by orders of magnitude.',
      'A photo is never lost once the post is published.',
      'A new post reaches followers within about a minute.',
    ],
    outOfScope: [
      'Video (see the video upload and streaming design).',
      'Private accounts and per-viewer access to images, which would need signed CDN URLs.',
      'Likes, comments, search and recommendations.',
    ],
  },
  entities: [
    { name: 'User', description: 'An account, with follower and following counts.' },
    {
      name: 'Post',
      description: 'Author, caption, photo IDs, creation time and status: pending or published.',
    },
    {
      name: 'Photo',
      description:
        'One uploaded image: the key of the original, its dimensions and the keys of its variants.',
    },
    {
      name: 'Variant',
      description:
        'One size and format of a photo, such as a small thumbnail or a feed-width WebP.',
    },
    {
      name: 'Follow',
      description: 'An edge from follower to followee, stored in both directions.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/posts',
      description:
        'Body: caption and photo count. Creates a pending post and returns one short-lived upload URL per photo.',
    },
    {
      method: 'PUT',
      path: '{presigned upload URL}',
      description: 'Sends the photo bytes straight to object storage, not through our servers.',
    },
    {
      method: 'PUT · DELETE',
      path: '/follows/{userId}',
      description: 'Follows or unfollows an account.',
    },
    {
      method: 'GET',
      path: '/feed?cursor={cursor}',
      description: 'A page of posts, each with a CDN URL, width and height for every variant.',
    },
  ],
  dataFlow: [
    'The app creates a pending post and receives presigned URLs, then uploads each photo straight to storage.',
    'A storage event queues a job that checks the image and writes a few sizes in modern formats.',
    'When every photo is processed the post is published and fanned out to followers’ feeds.',
    'A viewer reads the feed, picks the variant that fits the screen and loads it from the CDN.',
  ],
  highLevel: {
    label: 'Post a photo, then see it in a feed',
    intro:
      'Follow a photo from the author’s phone through storage and resizing, onto followers’ feeds, and then onto another person’s screen from the CDN. Press play, or step through the stages.',
    nodes: [
      { id: 'author', title: 'Author', detail: 'Posts a photo', column: 0, row: 'top' },
      { id: 'raw', title: 'Originals', detail: 'Private bucket', column: 1, row: 'top' },
      { id: 'resize', title: 'Resizers', detail: 'Queued jobs', column: 2, row: 'top' },
      { id: 'variants', title: 'Variants', detail: 'Public bucket', column: 3, row: 'top' },
      { id: 'api', title: 'App API', detail: 'Posts, follows', column: 1, row: 'middle' },
      { id: 'posts', title: 'Posts DB', detail: 'Pending, published', column: 2, row: 'middle' },
      { id: 'cold', title: 'Cold tier', detail: 'Aged objects', column: 3, row: 'middle' },
      { id: 'cdn', title: 'CDN', detail: 'Edge + shield', column: 4, row: 'middle' },
      { id: 'graph', title: 'Follow graph', detail: 'Both directions', column: 2, row: 'bottom' },
      { id: 'feed', title: 'Feed service', detail: 'Fan-out, reads', column: 3, row: 'bottom' },
      { id: 'viewer', title: 'Viewer', detail: 'Scrolls the feed', column: 5, row: 'bottom' },
    ],
    edges: [
      ['author', 'api', 'new post'],
      ['api', 'posts'],
      ['author', 'raw', 'presigned PUT'],
      ['raw', 'resize', 'uploaded'],
      ['resize', 'variants', 'sizes'],
      ['resize', 'posts', 'ready'],
      ['api', 'graph', 'follow'],
      ['posts', 'feed', 'publish'],
      ['feed', 'graph', 'followers'],
      ['viewer', 'feed', 'feed'],
      ['viewer', 'cdn', 'images'],
      ['cdn', 'variants', 'miss'],
      ['variants', 'cold', 'age out'],
    ],
    stages: [
      {
        title: 'Create a pending post',
        narration:
          'The app sends the caption and the number of photos. The API stores a post with status "pending" and returns one presigned upload URL per photo, each bound to a key, a content type and a maximum size, and valid for a few minutes.',
        tradeoff:
          'Creating the post first gives every upload a home and lets the app retry against a known ID. The cost is pending posts whose uploads never finish, which a sweep deletes after an hour along with any orphaned objects.',
        nodes: ['author', 'api', 'posts'],
        travel: [
          ['author', 'api', 'new post'],
          ['api', 'posts'],
        ],
      },
      {
        title: 'Upload straight to storage',
        narration:
          'The app shrinks the photo on the phone to a sensible maximum, a few thousand pixels wide, and PUTs it to the presigned URL. The bytes go to a private bucket of originals and never touch our servers.',
        tradeoff:
          'Proxying uploads through the API would tie up servers and bandwidth for every slow mobile connection. Presigned URLs push that work onto object storage; the cost is that the API only learns what arrived from storage events, and the URLs must be scoped tightly so they cannot be reused for other files.',
        nodes: ['author', 'raw'],
        travel: [['author', 'raw', 'presigned PUT']],
      },
      {
        title: 'Check the image and make variants',
        narration:
          'The storage event queues a job. A resizer decodes the file to prove it is really an image, fixes rotation, strips location metadata, and writes a thumbnail, a feed size and a full size, each in WebP or AVIF with a JPEG fallback, to a public bucket under a content-based key.',
        tradeoff:
          'Producing a handful of sizes up front multiplies storage per photo several times, and in exchange every viewer downloads a file close to their screen size instead of a full original. Decoding in an isolated worker also keeps malformed or malicious files away from anything else.',
        nodes: ['raw', 'resize', 'variants'],
        travel: [
          ['raw', 'resize', 'uploaded'],
          ['resize', 'variants', 'sizes'],
        ],
      },
      {
        title: 'Publish only when every photo is ready',
        narration:
          'When the last photo of a post has its variants, the resizer records their keys and dimensions and flips the post from "pending" to "published" with a conditional update. Only a published post can enter feeds.',
        tradeoff:
          'Publishing at once and filling images in later would show followers broken tiles. Waiting for processing adds a few seconds before the post is visible, which is invisible next to the minute allowed for fan-out.',
        nodes: ['resize', 'posts'],
        travel: [['resize', 'posts', 'ready']],
      },
      {
        title: 'Store follows in both directions',
        narration:
          'Following someone writes two rows: one under the follower, listing who they follow, and one under the followee, listing who follows them. Each table is partitioned by its owner and sorted by time.',
        tradeoff:
          'One table answers only one of the two questions cheaply; the other becomes a scan. Writing both doubles the writes and needs a retry so the two sides never disagree for long, and in exchange "who do I follow" and "who follows me" are each a single partition read.',
        nodes: ['api', 'graph'],
        travel: [['api', 'graph', 'follow']],
      },
      {
        title: 'Fan the post out to followers',
        narration:
          'Publishing emits an event. The feed service pages through the author’s followers and adds the post ID to each follower’s feed list; very large accounts are skipped and merged at read time, as in the news feed design.',
        tradeoff:
          'Here the feed only moves IDs, never images, so fan-out stays cheap even with heavy media. The cost is a hydrate step at read time to turn IDs into captions and image URLs, which a post cache makes fast.',
        nodes: ['posts', 'feed', 'graph'],
        travel: [
          ['posts', 'feed', 'publish'],
          ['feed', 'graph', 'followers'],
        ],
      },
      {
        title: 'Return image URLs, not images',
        narration:
          'A viewer opens the app and asks for a page of the feed. Each post comes back with its caption and, for every photo, the CDN URL, width and height of each variant plus a tiny color placeholder. The app picks the variant that fits the screen and its pixel density.',
        tradeoff:
          'Letting the client choose keeps the API free of device rules and lets the layout reserve space before images load. The cost is a slightly larger response that lists several URLs per photo.',
        nodes: ['viewer', 'feed'],
        travel: [['viewer', 'feed', 'feed']],
      },
      {
        title: 'Load images from the CDN',
        narration:
          'The app fetches each chosen variant from the nearest CDN edge. Because the key changes whenever the content changes, every URL is immutable and cached for a year, both at the edge and on the phone.',
        tradeoff:
          'Immutable URLs mean no purges and almost no revalidation, so popular images cost the origin nothing after the first request. The cost is that editing a photo means writing a new variant and updating the post, never overwriting a file in place.',
        nodes: ['viewer', 'cdn'],
        travel: [['viewer', 'cdn', 'images']],
      },
      {
        title: 'Misses go through a shield to storage',
        narration:
          'An edge that lacks a variant asks a regional shield cache, and only the shield reads from the variants bucket. A post that goes viral becomes one origin read per region instead of one per edge.',
        tradeoff:
          'The shield adds a hop on a miss and its own cost. It pays off because storage requests and egress from the bucket are billed per request and per byte, and most photos are only read in the first days after posting.',
        nodes: ['cdn', 'variants'],
        travel: [['cdn', 'variants', 'miss']],
      },
      {
        title: 'Move old photos to a cheaper tier',
        narration:
          'Lifecycle rules move originals and large variants that have not been read for months to an infrequent-access tier. Thumbnails and feed sizes stay in the standard tier because old profiles are still browsed.',
        tradeoff:
          'Storage grows forever, so tiering cuts the biggest line of the bill. The cost is slower and pricier reads on the rare old photo, and originals are kept rather than deleted so a new format or size can be produced later.',
        nodes: ['variants', 'cold'],
        travel: [['variants', 'cold', 'age out']],
      },
    ],
  },
  deepDives: [
    {
      question: 'When do we produce image variants?',
      options: [
        {
          name: 'All sizes eagerly at upload',
          pros: 'Every request is a plain cached file; nothing is computed on the read path.',
          cons: 'Storage for sizes that are rarely requested, and a reprocessing job for every new size.',
        },
        {
          name: 'On demand at the edge, cached after the first request',
          pros: 'Any size can be added at any time, and unused sizes cost nothing.',
          cons: 'The first viewer of each size waits for a resize, and open size parameters invite abuse.',
        },
        {
          name: 'Eager for the few common sizes, on demand for the rest',
          pros: 'The feed path is always cached files; rare sizes stay cheap.',
          cons: 'Two paths to operate.',
        },
      ],
      choice:
        'Eager for the three or four sizes the apps use in the feed, and on demand from an allowlist of sizes for everything else. The allowlist stops anyone from requesting a million distinct sizes.',
    },
    {
      question: 'How do we store the follow graph?',
      options: [
        {
          name: 'One relational table with an index on each column',
          pros: 'Simple, transactional, and both questions are an index lookup.',
          cons: 'Billions of edges outgrow one database, and sharding by one column makes the other index cross every shard.',
        },
        {
          name: 'Two key-value tables, by follower and by followee',
          pros: 'Each question is one partition read and both scale horizontally.',
          cons: 'Two writes per follow, and the followee partition of a huge account is very large.',
        },
        {
          name: 'A graph database',
          pros: 'Good at multi-hop queries such as friends of friends.',
          cons: 'This product only needs one hop, and graph stores are harder to scale and operate.',
        },
      ],
      choice:
        'Two key-value tables, written together with a retry so they converge. Large follower lists are paged, and follower counts live in separate counters instead of being counted from the rows.',
    },
    {
      question: 'How do we keep image delivery fast and affordable?',
      options: [
        {
          name: 'One large JPEG per photo for every device',
          pros: 'Simple: one file, one URL.',
          cons: 'Phones download several times more bytes than they show, which is slow and costly.',
        },
        {
          name: 'Several sizes in modern formats, with immutable URLs',
          pros: 'Much smaller downloads and near-perfect cache hit rates.',
          cons: 'More storage per photo and a resizing pipeline to run.',
        },
        {
          name: 'Short cache lifetimes with purges on change',
          pros: 'URLs stay stable when a photo is edited.',
          cons: 'More revalidation traffic to the origin and a purge system to maintain.',
        },
      ],
      choice:
        'Several sizes in modern formats behind immutable, content-keyed URLs with long cache lifetimes and an origin shield, plus lifecycle tiering for old objects. Bandwidth is the largest cost, so shrinking bytes per view matters more than the extra storage.',
    },
  ],
  wrapUp:
    'Pending posts with presigned uploads straight to storage, a queued resizer that validates and writes a few sizes in modern formats, publish only when every photo is ready, a follow graph stored in both directions, fan-out of post IDs only, and immutable variant URLs served from a CDN with a shield and tiered storage behind it.',
};
