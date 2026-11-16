import type { Design } from '../types';

export const datingMatches: Design = {
  slug: 'dating-matches',
  title: 'Dating app matching',
  summary:
    'Show each user a stack of nearby profiles that fit both people’s preferences, precompute those stacks so swiping never waits, never show a profile twice with a Bloom filter per user, record billions of swipes a day, and detect a mutual like atomically so both people get the match exactly once.',
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Create a profile with photos, location and preferences: age range, distance, who to see.',
      'See a stack of nearby profiles that match those preferences, one at a time.',
      'Swipe right to like or left to pass.',
      'When two people like each other, both learn about the match right away.',
    ],
    nonFunctional: [
      'A mutual like always becomes a match, exactly once, even when both swipe at the same instant.',
      'Swipes feel instant and the next profile is always ready.',
      'Around 20 million daily users at about 100 swipes each: billions of swipes a day, peaks near 100,000 per second.',
      'A profile someone already swiped on is not shown to them again.',
    ],
    outOfScope: [
      'Chat after a match.',
      'Ranking models in depth, payments and subscriptions.',
      'Photo moderation and fake profile detection.',
    ],
  },
  entities: [
    {
      name: 'Profile',
      description:
        'Age, gender, photos, a coarse location cell and preferences. Owned by one user.',
    },
    {
      name: 'Stack',
      description:
        'A precomputed, ordered list of candidate profile ids for one user, with an expiry.',
    },
    {
      name: 'Swipe',
      description: 'Swiper, target, like or pass, and a timestamp. Written once, never changed.',
    },
    {
      name: 'Seen filter',
      description: 'A Bloom filter per user holding every profile id they have swiped on.',
    },
    {
      name: 'Match',
      description: 'Two user ids stored under one pair key, so a pair can only match once.',
    },
  ],
  api: [
    {
      method: 'PUT',
      path: '/profile',
      description: 'Updates profile fields, preferences or location.',
    },
    {
      method: 'GET',
      path: '/stack?cursor=',
      description: 'Returns the next page of candidate profiles from the precomputed stack.',
    },
    {
      method: 'POST',
      path: '/swipes',
      description:
        'Body: targetId, decision. Returns whether this swipe completed a match. Repeating a swipe changes nothing.',
    },
    {
      method: 'push',
      path: 'match notification',
      description: 'Sent to the other user when a match is created, carrying the match id.',
    },
  ],
  dataFlow: [
    'Profile changes stream into a candidate index that supports location and attribute filters.',
    'A background builder queries the index, drops already-seen profiles and stores a stack per user.',
    'The app pages through its stack and asks for a refill before it runs out.',
    'A like runs one atomic step on the pair key that records it and checks for the other like.',
    'A mutual like creates a match, answers the swiper and pushes a notification to the other user.',
  ],
  highLevel: {
    label: 'From a stack of profiles to a match',
    intro:
      'Follow a profile into the candidate index, a stack being built and served, and then a right swipe that turns out to be mutual. Press play, or step through the stages.',
    lanes: { top: 'Building stacks', bottom: 'Matches' },
    nodes: [
      { id: 'user', title: 'User', detail: 'Swipes', column: 0, row: 'middle' },
      { id: 'other', title: 'Other user', detail: 'Liked earlier', column: 0, row: 'bottom' },
      { id: 'profiles', title: 'Profile DB', detail: 'Source of truth', column: 1, row: 'top' },
      { id: 'api', title: 'App API', detail: 'Stateless', column: 1, row: 'middle' },
      { id: 'index', title: 'Candidate index', detail: 'Cell and filters', column: 2, row: 'top' },
      { id: 'stacks', title: 'Stack cache', detail: 'Ids per user', column: 2, row: 'middle' },
      { id: 'builder', title: 'Stack builder', detail: 'In background', column: 3, row: 'top' },
      { id: 'pairs', title: 'Like store', detail: 'Keyed by pair', column: 3, row: 'middle' },
      { id: 'matches', title: 'Matches DB', detail: 'Unique per pair', column: 3, row: 'bottom' },
      { id: 'seen', title: 'Seen filters', detail: 'Bloom per user', column: 4, row: 'top' },
      { id: 'log', title: 'Swipe log', detail: 'Durable, ordered', column: 4, row: 'middle' },
      { id: 'notify', title: 'Notifier', detail: 'Push, idempotent', column: 4, row: 'bottom' },
      { id: 'swipes', title: 'Swipes DB', detail: 'Wide-column', column: 5, row: 'middle' },
    ],
    edges: [
      ['user', 'api'],
      ['api', 'profiles', 'profile'],
      ['profiles', 'index', 'changes'],
      ['builder', 'index', 'query'],
      ['builder', 'seen', 'filter'],
      ['builder', 'stacks', 'fill'],
      ['api', 'stacks', 'next page'],
      ['api', 'builder', 'refill'],
      ['api', 'pairs', 'like'],
      ['api', 'log', 'swipe'],
      ['log', 'swipes'],
      ['log', 'seen', 'add'],
      ['pairs', 'matches', 'mutual'],
      ['matches', 'notify'],
      ['notify', 'other', 'push'],
    ],
    stages: [
      {
        title: 'Index profiles by place and traits',
        narration:
          'A profile edit or a location update is written to the profile database. A change stream copies it into a candidate index that can filter by location cell, age, gender and the profile’s own preferences. Locations are stored as coarse cells, never exact points.',
        tradeoff:
          'Querying the profile database directly would put heavy search load on the source of truth. A separate index is built for these filters; the cost is a few seconds of lag after an edit, which nobody notices while swiping.',
        nodes: ['user', 'api', 'profiles', 'index'],
        travel: [
          ['user', 'api'],
          ['api', 'profiles', 'profile'],
          ['profiles', 'index', 'changes'],
        ],
      },
      {
        title: 'Build a stack in the background',
        narration:
          'When a user opens the app, a stack builder queries the index for profiles in nearby cells that fit the user’s preferences and whose own preferences include the user. It ranks the few hundred results, for example by recent activity and distance.',
        tradeoff:
          'Running this query on every swipe would hit the index tens of thousands of times a second. Building a batch ahead of time turns that into one query per few hundred swipes; the cost is a stack that can be minutes old, so someone who just changed their profile may appear slightly out of date.',
        nodes: ['builder', 'index'],
        travel: [['builder', 'index', 'query']],
      },
      {
        title: 'Drop profiles already seen',
        narration:
          'Before storing the stack, the builder checks each candidate against the user’s seen filter, a Bloom filter of every profile id they have swiped on. Anything the filter reports as seen is dropped.',
        tradeoff:
          'Looking up each candidate in the swipes database would cost hundreds of reads per stack. A Bloom filter answers in memory from a few tens of kilobytes; its cost is false positives, which hide a small fraction of unseen profiles, and it never lets a swiped profile through.',
        nodes: ['builder', 'seen'],
        travel: [['builder', 'seen', 'filter']],
      },
      {
        title: 'Serve the stack page by page',
        narration:
          'The builder stores the ordered ids in a stack cache with an expiry. The app fetches a page of profiles at a time, preloads their photos from a CDN, and shows the next card instantly after each swipe.',
        tradeoff:
          'Returning the whole stack at once wastes work if the user closes the app after three swipes. Paging costs a request every few dozen cards, and preloading the next page hides it completely.',
        nodes: ['builder', 'stacks', 'api', 'user'],
        travel: [
          ['builder', 'stacks', 'fill'],
          ['user', 'api'],
          ['api', 'stacks', 'next page'],
        ],
      },
      {
        title: 'Refill before it runs out',
        narration:
          'When fewer than a page of ids remain, or the user moves far or changes preferences, the API asks the builder for a new stack. The old one keeps serving until the new one is ready.',
        tradeoff:
          'Waiting until the stack is empty would make the user stare at a spinner. Refilling early costs some candidates that are built and never shown, a cheap price for never blocking a swipe.',
        nodes: ['api', 'builder'],
        travel: [['api', 'builder', 'refill']],
      },
      {
        title: 'Record a like on the pair key',
        narration:
          'A right swipe runs one atomic script on an in-memory store, under a key made of the two user ids in sorted order. The script records "this user likes the other" and, in the same step, reads whether the other like is already there.',
        tradeoff:
          'Writing a swipe and then reading the opposite one from another shard lets two people who swipe at the same instant both miss the match. Putting both directions on one key makes the check and the write a single atomic operation; the cost is a store that must be replicated, since it decides matches.',
        nodes: ['user', 'api', 'pairs'],
        travel: [
          ['user', 'api'],
          ['api', 'pairs', 'like'],
        ],
      },
      {
        title: 'Log every swipe durably',
        narration:
          'Every swipe, like or pass, is appended to a durable log before the app hears back. Consumers write it to a wide-column swipes database partitioned by swiper and add the target to the swiper’s seen filter.',
        tradeoff:
          'Writing billions of swipes a day straight to a relational database would need heavy sharding and indexes nobody reads. An append-only log with a write-optimized store absorbs the volume cheaply; the cost is that the seen filter lags by a moment, which the app covers by remembering what it showed in this session.',
        nodes: ['api', 'log', 'swipes', 'seen'],
        travel: [
          ['api', 'log', 'swipe'],
          ['log', 'swipes'],
          ['log', 'seen', 'add'],
        ],
      },
      {
        title: 'A mutual like becomes a match',
        narration:
          'When the script finds both likes, it writes a match under the same pair key with a create-if-absent insert, and the swiper’s response says "it is a match" so the screen changes at once.',
        tradeoff:
          'Creating the match from two separate events could create it twice or not at all. A create-if-absent insert on the pair key makes every retry harmless and guarantees one match per pair; the cost is a unique key that every write must check, which is a single-row operation.',
        nodes: ['pairs', 'matches', 'api', 'user'],
        travel: [['pairs', 'matches', 'mutual']],
      },
      {
        title: 'Tell the other person',
        narration:
          'A new match triggers a push notification to the other user, carrying the match id. The next time their app opens, it also fetches recent matches, so a lost push only delays the news.',
        tradeoff:
          'Relying on push alone would lose matches when a device is offline or a provider drops a message. Pairing push with a fetch on open costs one extra read per launch, and deduplicating by match id stops a retried push from celebrating the same match twice.',
        nodes: ['matches', 'notify', 'other'],
        travel: [
          ['matches', 'notify'],
          ['notify', 'other', 'push'],
        ],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we detect a mutual like exactly once?',
      options: [
        {
          name: 'Write the swipe, then read the opposite swipe',
          pros: 'Simple, and works with any sharded store.',
          cons: 'Two simultaneous likes land on different shards, each reads before the other writes, and the match is lost.',
        },
        {
          name: 'A transaction across both swipe rows',
          pros: 'Correct in a relational database.',
          cons: 'Cross-shard transactions and locks at a hundred thousand swipes a second are slow and fragile.',
        },
        {
          name: 'One atomic operation on a pair key',
          pros: 'Both directions live on one key, so recording and checking are one step with no race.',
          cons: 'The key store decides matches and must be replicated and durable enough to trust.',
        },
      ],
      choice:
        'An atomic script on a key made of the two sorted user ids, followed by a create-if-absent match insert. A single-partition conditional write in a wide-column store keyed by the pair is an equally valid version.',
    },
    {
      question: 'How do we never show a profile the user already swiped on?',
      options: [
        {
          name: 'Query the swipes database per candidate',
          pros: 'Exact.',
          cons: 'Hundreds of reads per stack, and it grows with every swipe the user ever made.',
        },
        {
          name: 'An exact set of swiped ids in a cache',
          pros: 'Exact and fast to check.',
          cons: 'Heavy users accumulate tens of thousands of ids, which adds up across millions of users.',
        },
        {
          name: 'A Bloom filter per user',
          pros: 'About ten bits per id: fifty thousand swipes fit in roughly sixty kilobytes at a one percent false positive rate.',
          cons: 'False positives hide a few unseen profiles, and the filter cannot remove an id, so it is rebuilt from the swipes database when it fills.',
        },
      ],
      choice:
        'A Bloom filter per user, sized for their swipe volume and rebuilt from the swipes database when it gets full. Hiding one percent of unseen profiles is harmless; showing a swiped one again is not, and the filter never does.',
    },
    {
      question: 'How do we keep the next profile ready without overloading search?',
      options: [
        {
          name: 'Query the index on every request',
          pros: 'Always fresh.',
          cons: 'Tens of thousands of geo and filter queries a second, and a slow query stalls a swipe.',
        },
        {
          name: 'Precompute a stack per active user and refill early',
          pros: 'One query per few hundred swipes, and swipes never wait on search.',
          cons: 'Stacks can be minutes stale and some built candidates are never shown.',
        },
        {
          name: 'Precompute stacks for everyone overnight',
          pros: 'Predictable batch load.',
          cons: 'Wastes work on users who never open the app, and is useless after someone travels.',
        },
      ],
      choice:
        'Precompute on demand for active users and refill before the stack runs out, invalidating it when the user moves far or changes preferences. Dense cities use smaller cells so each query stays small.',
    },
  ],
  wrapUp:
    'Stream profiles into a candidate index, build stacks in the background, drop seen profiles with a Bloom filter per user, serve stacks page by page, record each like with one atomic step on a pair key, log every swipe durably, and create each match once with a create-if-absent insert before pushing it to the other person.',
};
