import type { Design } from '../types';

export const fitnessTracking: Design = {
  slug: 'fitness-tracking',
  title: 'Fitness activity tracking',
  summary:
    'Record runs and rides on a phone with no signal, upload each one exactly once, turn raw GPS points into stats and a map, match the track against millions of segments with a spatial index, keep segment leaderboards, and show friends’ activities in a feed.',
  difficulty: 'Medium',
  minutes: 10,
  requirements: {
    functional: [
      'Start, pause and stop an activity; the phone records GPS points, time, distance and pace.',
      'Save and upload finished activities, including ones recorded fully offline.',
      'View an activity with its map, splits and stats.',
      'See the fastest times on popular stretches of road or trail (segments), overall and among friends.',
      'See friends’ recent activities in a feed.',
    ],
    nonFunctional: [
      'Recording never depends on the network, and a saved activity is never lost or duplicated.',
      'Around 100 million users and 10 million activities a day, with weekend mornings at several times the average.',
      'An uploaded activity shows its stats within seconds; segments and the feed can follow within a minute.',
      'Activities are written once and read many times; a one-hour track is a few thousand points.',
    ],
    outOfScope: [
      'Live tracking for spectators during an activity.',
      'Comments, kudos and payments.',
    ],
  },
  entities: [
    {
      name: 'Activity',
      description:
        'Owner, type, start time, summary stats, a simplified polyline and a pointer to the raw track. Its id is generated on the phone.',
    },
    {
      name: 'Track',
      description: 'The raw GPS points of one activity, compressed, in object storage.',
    },
    {
      name: 'Segment',
      description:
        'A stretch of road or trail: a path with a start and an end zone, indexed by the map cells it covers.',
    },
    {
      name: 'Segment effort',
      description: 'One athlete’s elapsed time on one segment during one activity.',
    },
  ],
  api: [
    {
      method: 'PUT',
      path: '/activities/{clientActivityId}',
      description:
        'Body: type, start time, compressed track. Creates the activity or returns the existing one, so a retry never duplicates it. Returns 202 while processing.',
    },
    {
      method: 'GET',
      path: '/activities/{id}',
      description: 'Returns stats, splits, the simplified map and segment efforts.',
    },
    {
      method: 'GET',
      path: '/feed?cursor=',
      description: 'Returns friends’ recent activities, newest first, one page at a time.',
    },
    {
      method: 'GET',
      path: '/segments/{id}/leaderboard?scope=all|friends&cursor=',
      description: 'Returns the best time per athlete on a segment, fastest first.',
    },
  ],
  dataFlow: [
    'The phone records points into local storage and computes live stats without the server.',
    'On finish, it uploads the track under an id it generated, so retries are harmless.',
    'A processor cleans the track, computes stats and a simplified map, and saves the activity.',
    'A segment matcher finds the segments the track crossed, records efforts and updates leaderboards.',
    'A fan-out step puts the activity into followers’ feeds.',
  ],
  highLevel: {
    label: 'Record a run, then share it',
    intro:
      'Follow one run from a phone with no signal to an upload, through processing and segment matching, and into a friend’s feed and a leaderboard. The design grows as the run moves: watch a weekend peak time out uploads until a work queue joins, then matching, boards and feeds appear. Numbers are illustrative. Press play, or step through the stages.',
    lanes: { top: 'Durable records', bottom: 'Feed and reads' },
    nodes: [
      { id: 'phone', title: 'Phone app', detail: 'Records offline', column: 0, row: 'middle' },
      {
        id: 'friend',
        title: 'Friend',
        detail: 'Reads feed, boards',
        column: 0,
        row: 'bottom',
        appearsAt: 9,
      },
      {
        id: 'api',
        title: 'Activity API',
        detail: 'Idempotent by id',
        column: 1,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'tracks',
        title: 'Track storage',
        detail: 'Raw points',
        column: 2,
        row: 'top',
        appearsAt: 1,
      },
      {
        id: 'queue',
        title: 'Work queue',
        detail: 'Uploads to process',
        column: 2,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'activities',
        title: 'Activity DB',
        detail: 'Stats, polyline',
        column: 3,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'processor',
        title: 'Processor',
        detail: 'Clean, summarize',
        column: 3,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'fanout',
        title: 'Feed fan-out',
        detail: 'Per follower',
        column: 3,
        row: 'bottom',
        appearsAt: 8,
      },
      {
        id: 'cells',
        title: 'Segment index',
        detail: 'Cell to segments',
        column: 4,
        row: 'top',
        appearsAt: 5,
      },
      {
        id: 'matcher',
        title: 'Segment matcher',
        detail: 'Precise check',
        column: 4,
        row: 'middle',
        appearsAt: 5,
      },
      {
        id: 'feeds',
        title: 'Feed lists',
        detail: 'Capped, in memory',
        column: 4,
        row: 'bottom',
        appearsAt: 8,
      },
      {
        id: 'efforts',
        title: 'Efforts DB',
        detail: 'Source of truth',
        column: 5,
        row: 'top',
        appearsAt: 6,
      },
      {
        id: 'boards',
        title: 'Leaderboards',
        detail: 'One sorted set each',
        column: 5,
        row: 'middle',
        appearsAt: 7,
      },
    ],
    edges: [
      ['phone', 'api', 'upload'],
      ['api', 'tracks', 'raw track'],
      ['api', 'queue', 'job'],
      ['queue', 'processor'],
      ['tracks', 'processor', 'points'],
      ['processor', 'activities', 'summary'],
      ['processor', 'matcher', 'created'],
      ['matcher', 'cells', 'cells crossed'],
      ['matcher', 'efforts', 'effort'],
      ['matcher', 'boards', 'best time'],
      ['processor', 'fanout', 'created'],
      ['fanout', 'feeds'],
      ['friend', 'api', 'read'],
      ['api', 'feeds', 'feed'],
      ['api', 'activities'],
      ['api', 'boards', 'board'],
      ['api', 'efforts', 'friends'],
    ],
    stages: [
      {
        title: 'Record on the phone',
        narration:
          'The app samples GPS about once a second and writes each point to a local database on the phone. Distance, pace and elapsed time are computed on the device, so the athlete sees live numbers in a forest with no signal.',
        tradeoff:
          'Streaming points to the server as they are recorded would make the backend part of every run and lose data whenever the signal drops. Recording locally keeps the server off the hot path; the cost is that nothing is visible to others until the athlete saves, which suits this product.',
        nodes: ['phone'],
        travel: [],
        short: 'Record',
        metrics: { users: '1M', requestsPerSecond: '500', p95Latency: '250 ms', errorRate: '0%' },
        load: { phone: 20 },
      },
      {
        title: 'Upload once, under a client id',
        narration:
          'When the athlete saves, the phone generates an activity id and uploads the compressed track with a PUT to that id. The API writes the raw track to object storage and creates the activity row. If the phone retries after a timeout, the same id finds the existing activity and nothing is created twice.',
        tradeoff:
          'A server-generated id would turn every lost response into a possible duplicate run. A client-generated id makes the upload idempotent by construction; the cost is trusting ids from devices, so the API scopes them to the owner and rejects malformed ones.',
        nodes: ['phone', 'api', 'tracks'],
        travel: [
          ['phone', 'api', 'upload'],
          ['api', 'tracks', 'raw track'],
        ],
        short: 'Upload',
        metrics: { users: '1M', requestsPerSecond: '500', p95Latency: '250 ms', errorRate: '0.1%' },
        load: { api: 25, tracks: 15 },
      },
      {
        title: 'A weekend morning peak',
        narration:
          'At first the API cleans the track, matches segments and writes the feed inside the upload request. On a sunny Sunday morning millions of runs end within the same hour, every upload holds an API server for seconds, and the API runs out of workers: uploads time out and phones retry, adding more load.',
        tradeoff:
          'Adding API servers for the peak hour would leave most of them idle the rest of the week, and retries still pile on while they start. The upload only needs the track to be safely stored; everything after that can wait a few seconds, which calls for separating accepting a run from processing it.',
        nodes: ['phone', 'api', 'tracks'],
        travel: [
          ['phone', 'api', 'upload'],
          ['api', 'tracks', 'raw track'],
        ],
        short: 'Weekend peak',
        metrics: {
          users: '5M',
          requestsPerSecond: '5K',
          p95Latency: '9 s',
          errorRate: '7%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { api: 98, tracks: 45 },
        traffic: [{ edge: ['phone', 'api'], kind: 'failed' }],
      },
      {
        title: 'Accept now, process later',
        narration:
          'A work queue joins. The API now answers 202 as soon as the track is stored and a job is on the work queue. Weekend morning peaks fill the queue, and processors drain it at a steady pace.',
        tradeoff:
          'Processing inside the request would make the upload slow and sizing the fleet for the peak hour would waste money all week. A queue absorbs the peak and lets processors scale on its depth; the cost is a few seconds before stats appear, which the app covers with its own local numbers.',
        nodes: ['api', 'queue', 'processor'],
        travel: [
          ['api', 'queue', 'job'],
          ['queue', 'processor'],
        ],
        short: 'Work queue',
        metrics: { users: '5M', requestsPerSecond: '5K', p95Latency: '300 ms', errorRate: '0.1%' },
        load: { api: 35, tracks: 40, queue: 70, processor: 85 },
      },
      {
        title: 'Clean the track and summarize it',
        narration:
          'The processor reads the raw points, drops GPS jumps and impossible speeds, computes stats and splits, and simplifies the path to a few hundred points for the map. It saves the summary and the simplified polyline to the activity database.',
        tradeoff:
          'Storing every raw point in the database would bloat rows that list views read constantly. Keeping raw points in cheap object storage and only a summary in the database keeps reads fast; the cost is a second store, and the raw track remains available for reprocessing when the algorithms improve.',
        nodes: ['tracks', 'processor', 'activities'],
        travel: [
          ['tracks', 'processor', 'points'],
          ['processor', 'activities', 'summary'],
        ],
        short: 'Clean + stats',
        metrics: { users: '5M', requestsPerSecond: '5K', p95Latency: '300 ms', errorRate: '0.1%' },
        load: { tracks: 40, processor: 80, activities: 35, queue: 55 },
        traffic: [{ edge: ['tracks', 'processor'], kind: 'heavy' }],
      },
      {
        title: 'Find candidate segments by cell',
        narration:
          'The processor publishes an activity-created event. The segment matcher converts the track into the set of map cells it passes through and looks each cell up in the segment index, which maps a cell to the segments that start in it.',
        tradeoff:
          'Comparing a track with millions of segments is impossible, and a general spatial query per point is too slow. A cell index turns the search into a few dozen key lookups that return a short candidate list; the cost is keeping the index in sync as segments are created, which is rare.',
        nodes: ['processor', 'matcher', 'cells'],
        travel: [
          ['processor', 'matcher', 'created'],
          ['matcher', 'cells', 'cells crossed'],
        ],
        short: 'Find segments',
        metrics: { users: '5M', requestsPerSecond: '5K', p95Latency: '300 ms', errorRate: '0.1%' },
        load: { processor: 70, matcher: 50, cells: 30 },
      },
      {
        title: 'Match precisely, record efforts',
        narration:
          'For each candidate, the matcher checks that the track enters the start zone, leaves through the end zone and stays within a tolerance of the segment path. Each match becomes an effort with its elapsed time in the efforts database.',
        tradeoff:
          'Matching only on start and end points is cheap but credits someone who took a shortcut. The path check costs more computation per candidate, and since only a handful of candidates survive the cell lookup, it is affordable and keeps times honest.',
        nodes: ['matcher', 'efforts'],
        travel: [['matcher', 'efforts', 'effort']],
        short: 'Match',
        metrics: { users: '5M', requestsPerSecond: '5K', p95Latency: '300 ms', errorRate: '0.1%' },
        load: { matcher: 60, efforts: 30 },
      },
      {
        title: 'Update the leaderboard',
        narration:
          'The matcher writes the effort to a sorted set per segment, keyed by athlete and scored by time, keeping only the lower of the old and new time. The board now answers "fastest first" and "my rank" directly.',
        tradeoff:
          'Sorting efforts in the database on every leaderboard view would be slow on popular segments with millions of efforts. A sorted set gives fast ranked reads; the cost is a second copy that must be rebuilt from the efforts table when an activity is deleted or flagged as cheating.',
        nodes: ['matcher', 'boards'],
        travel: [['matcher', 'boards', 'best time']],
        short: 'Leaderboard',
        metrics: { users: '5M', requestsPerSecond: '5K', p95Latency: '300 ms', errorRate: '0.1%' },
        load: { matcher: 55, boards: 35 },
      },
      {
        title: 'Fan out to followers',
        narration:
          'The same event reaches the feed fan-out, which adds the activity id to the feed list of each follower. Lists are capped to the most recent few hundred entries. Athletes with a very large following are skipped and merged in at read time instead.',
        tradeoff:
          'Merging every friend’s activities at read time is slow for someone who follows hundreds of people. Fan-out on write makes reading one list lookup; the cost is many writes for popular athletes, which the read-time exception avoids.',
        nodes: ['processor', 'fanout', 'feeds'],
        travel: [
          ['processor', 'fanout', 'created'],
          ['fanout', 'feeds'],
        ],
        short: 'Fan-out',
        metrics: { users: '5M', requestsPerSecond: '5K', p95Latency: '300 ms', errorRate: '0.1%' },
        load: { processor: 60, fanout: 55, feeds: 40 },
      },
      {
        title: 'Read the feed and a leaderboard',
        narration:
          'A friend opens the app. The API reads their feed list and loads those summaries from the activity database, cutting privacy zones such as the area around a home from each map. The overall leaderboard is a range read from the sorted set; the friends board fetches each followed athlete’s best effort from the efforts table and sorts the small result.',
        tradeoff:
          'A sorted set per reader for friends boards would multiply storage, and baking privacy zones into stored tracks would mean rewriting old activities whenever a zone changes. Doing both at read time costs a little work per view and stays cheap because a follow list is small.',
        nodes: ['friend', 'api', 'feeds', 'activities', 'boards', 'efforts'],
        travel: [
          ['friend', 'api', 'read'],
          ['api', 'feeds', 'feed'],
          ['api', 'activities'],
          ['api', 'boards', 'board'],
          ['api', 'efforts', 'friends'],
        ],
        short: 'Read feed',
        metrics: { users: '5M', requestsPerSecond: '50K', p95Latency: '120 ms', errorRate: '0.1%' },
        load: { api: 55, feeds: 50, activities: 45, boards: 35, efforts: 30 },
      },
    ],
  },
  deepDives: [
    {
      question: 'How does an activity survive no signal and repeated uploads?',
      options: [
        {
          name: 'Stream points to the server while recording',
          pros: 'The server has the activity as it happens, and live tracking comes for free.',
          cons: 'Gaps whenever the signal drops, constant battery and data use, and the backend is on the path of every run.',
        },
        {
          name: 'Record locally, upload once at the end with a client id',
          pros: 'Works with no signal at all, and a retry with the same id is a no-op.',
          cons: 'Nothing is visible until the athlete saves, and an uninstalled app loses unsaved runs.',
        },
        {
          name: 'Record locally, sync batches during the activity',
          pros: 'Partial progress reaches the server and can feed live tracking.',
          cons: 'More client and server logic to merge batches, for little benefit when nobody is watching live.',
        },
      ],
      choice:
        'Record locally and upload once under a client-generated id. Batched sync every few tens of seconds is added only for athletes who opt in to live tracking.',
    },
    {
      question: 'How do we match a track against millions of segments?',
      options: [
        {
          name: 'Compare with every segment',
          pros: 'Trivial to write.',
          cons: 'Millions of comparisons per activity, ten million times a day.',
        },
        {
          name: 'Bounding box query in a spatial database',
          pros: 'A standard tree index returns segments whose box overlaps the track’s box.',
          cons: 'A long ride has a huge box that overlaps far too many segments, and the database becomes a shared bottleneck.',
        },
        {
          name: 'Cell index, then a precise path check',
          pros: 'Each cell the track crosses is a key lookup, the candidate list is short, and the index fits in memory.',
          cons: 'Cell size needs tuning, and segments near a cell edge must be listed in neighboring cells too.',
        },
      ],
      choice:
        'Index segments by the cells their start zone covers, look up the cells the track crosses, then run the precise start, end and path check only on candidates. Matching is asynchronous, so a minute of delay is acceptable.',
    },
    {
      question: 'How do leaderboards stay fast and correct?',
      options: [
        {
          name: 'Query the efforts table on every view',
          pros: 'Always consistent with the source of truth.',
          cons: 'Sorting millions of efforts on a popular segment for each view is slow and costly.',
        },
        {
          name: 'Sorted set per segment, rebuilt from efforts',
          pros: 'Ranked reads and rank lookups in milliseconds; writes per segment are modest.',
          cons: 'A second copy to keep correct when activities are deleted, edited or flagged.',
        },
        {
          name: 'Precomputed tables per period',
          pros: 'Cheap reads for fixed views such as this year or this month.',
          cons: 'Stale between runs, and every new filter needs a new batch job.',
        },
      ],
      choice:
        'A sorted set per segment for overall boards, written by the matcher, with the efforts table as the source of truth. Deletions and cheating flags trigger a rebuild of the affected boards from efforts. Friends boards are computed on demand from the efforts table.',
    },
  ],
  wrapUp:
    'Record on the phone with no dependency on the network, upload once under a client-generated id, keep raw tracks in object storage and summaries in the database, match segments through a cell index and a precise path check, rank efforts in a sorted set per segment backed by an efforts table, and fan activities out to followers’ feeds.',
};
