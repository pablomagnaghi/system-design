import type { Design } from '../types';

export const proximitySearch: Design = {
  slug: 'proximity-search',
  title: 'Proximity search for places',
  summary:
    'Find the places nearest a point in tens of milliseconds: a full copy of a lean geohash index in the memory of every search node, cells read from small to large until the answer is provably complete, a stream from the place table that every node applies by version, snapshots that let a node start or rebuild without missing a change, and a details cache that a late fill cannot roll back.',
  difficulty: 'Hard',
  minutes: 14,
  requirements: {
    functional: [
      'Search places near a point: a latitude, a longitude, a radius from 100 m to 25 km (2 km by default) and an optional category, one of 200. Results come nearest first, with their distance, 20 to a page by default and at most 50.',
      'Page through the results with a cursor, up to 10 pages and 500 results per search.',
      'When the radius holds fewer than 5 matches, widen the search to 2 and then 4 times the radius, at most 50 km, and say how far it went.',
      'Open a place to see its details: name, category, address, opening hours, phone and a photo link.',
      'Owners create, update, move and delete their places. A create carries an idempotency key; an update or a delete carries the version the owner last read.',
    ],
    nonFunctional: [
      '100 million places. About 5 million owner writes a day: about 60 a second on average and 200 at peak.',
      'About 864 million searches a day from 50 million daily users: 10,000 a second on average and 25,000 at peak. Place details: 2,000 reads a second on average and 5,000 at peak.',
      'Reads: 99.9% of searches and details reads answered within 150 ms and without a 5xx, over 28 days. The usual p95 is 25 ms for a search and 10 ms for details.',
      'Within the radius the answer is exact: the nearest places by great-circle distance, ties broken by place id. When a search reaches its limit of 50,000 scanned entries it returns the part it could prove complete and says so.',
      'An acknowledged owner write is durable in the place table before the answer. The search index is derived from that table and can always be rebuilt from it.',
      'Freshness: an acknowledged write is normally in every search node in rotation within 5 seconds. Measured end to end, the index is at most 60 seconds behind the table in 99.5% of the minutes of 28 days. A node more than 30 seconds behind its log leaves rotation.',
      'Details may lag an edit by the same seconds, and by at most the 10-minute cache lifetime when the cache loses an update.',
      'Losing one of three Availability Zones keeps searches inside their objective at peak.',
    ],
    outOfScope: [
      'Ranking by rating, popularity or personal taste. Results are ordered by distance only.',
      'Search by name or free text, and filters other than one category.',
      'Travel time, routes and directions to a place.',
      'Moving objects such as drivers or couriers, and areas such as delivery zones.',
      'Reviews, photo upload and the moderation of what owners write.',
      'Read-your-writes in search. An owner sees an edit in its own answer at once and in search results seconds later.',
      'More than one Region.',
    ],
  },
  entities: [
    {
      name: 'Place',
      description:
        'One item in the place table: placeId (a random 64-bit number, created under a condition that it does not exist and never reused), ownerId, name, category, address, lat, lng, details (hours, phone, photo link), status (active or deleted), version (1 on create, plus 1 on every write), updatedAt, and on a deleted place an expiry 30 days later. About 1 KB.',
    },
    {
      name: 'Idempotency record',
      description:
        'An item keyed by owner and idempotency key that holds the placeId a create made. Written in the same transaction as the place and expired after 24 hours. The relay skips it and its expiry, and the snapshot builder leaves it out.',
    },
    {
      name: 'Cell code',
      description:
        'The 12-character geohash of a point as a 60-bit number: longitude and latitude bits interleaved. A cell of length L is the range of codes that share its first 5 × L bits, so reading a cell is one range scan.',
    },
    {
      name: 'Index entry',
      description:
        'In the memory of a search node: (cell code, placeId) to lat, lng and category, kept in two ordered maps, one by cell code and one by category then cell code, each with a count in every inner node. A place map holds placeId to version, cell code, category, status and a short name of up to 32 bytes.',
    },
    {
      name: 'Tombstone',
      description:
        'A deleted place in the place map: its placeId, its last version and status deleted, with no index entries. It stays until the purge record that follows the table’s own expiry, at least 30 days later.',
    },
    {
      name: 'Change record',
      description:
        'What the relay writes to the change log for each place write: placeId, version, lat, lng, category, status, name and the time of the write. Keyed by placeId. About 100 bytes. A purge record carries only placeId and version; a heartbeat record carries a node id and the time it was written.',
    },
    {
      name: 'Snapshot',
      description:
        'All places as of an export time T, sorted by cell code, in 64 compressed files with a manifest written last. The manifest names T and the log offset of every partition at T minus 5 minutes, where a node starts its replay.',
    },
    {
      name: 'Cursor',
      description:
        'A signed token with the query (point, radius, category, how far it widened) and the last result (its distance in centimetres and its placeId). Valid for 15 minutes.',
    },
  ],
  api: [
    {
      method: 'GET',
      path: '/places?lat=…&lng=…&radius=2000&category=cafe&limit=20',
      description:
        'The nearest matching places within the radius, each with its distance, short name, category and details from the cache. Also: searchedRadius (more than the radius when the search widened), complete (false when the scan limit cut it short) and a cursor while there are more results.',
    },
    {
      method: 'GET',
      path: '/places?cursor=…',
      description:
        'The next page: the places that come after the cursor’s last result in the order (distance, placeId). A cursor older than 15 minutes or with a bad signature is a 400.',
    },
    {
      method: 'GET',
      path: '/places/{id}',
      description:
        'The details of one place, with its version. 410 for a deleted place until it is purged, then 404.',
    },
    {
      method: 'POST',
      path: '/places',
      description:
        'Owners create a place. Header Idempotency-Key: a retry with the same key within 24 hours returns the same placeId and version 1, and creates nothing. Answers 201 after the table has committed the place and the key in one transaction.',
    },
    {
      method: 'PATCH',
      path: '/places/{id}',
      description:
        'Owners update or move a place. Header If-Match: the version they last read. A conditional write sets the fields and adds 1 to the version; a different version is a 412, and the body of a 200 is the new place. A retry after a lost answer gets a 412, and a read shows whether the first attempt applied.',
    },
    {
      method: 'DELETE',
      path: '/places/{id}',
      description:
        'Owners delete a place, with If-Match. The place becomes a tombstone: status deleted, version plus 1, removed by the table 30 days later. Answers 204.',
    },
  ],
  dataFlow: [
    'A user searches near a point. Any of the search nodes answers, because each holds the whole index in memory.',
    'The node reads the 3 × 3 block of cells around the point, starting small and moving to larger cells only until it has enough places it can prove are the nearest, then filters by exact distance and sorts.',
    'It fills one page from the details cache, reading the place table for misses with a fill that cannot overwrite a newer version.',
    'An owner write is one conditional write to the place table. Its change stream feeds a relay, which writes a change record to the change log and the new details to the cache.',
    'Every search node reads every partition of the log and applies a record only when its version is newer than the one it holds. A node that falls behind the log leaves rotation.',
    'Every 6 hours a builder exports the table and writes a snapshot. A new node loads it and replays the log from just before the export; every node reloads one each day and counts any difference.',
  ],
  highLevel: {
    label: 'Search near a point and keep every copy fresh',
    intro:
      'Follow one search from a point on the map to a sorted page of places, then one owner edit from the table to every search node. The design grows a piece at a time: an index in memory, a dense city center that a fixed cell size cannot handle, cells that grow only as far as needed, a details cache, a change stream applied by version, a node that falls behind, snapshots that let a node start without missing a change, and a lost zone. Numbers are illustrative. Press play, or step through the stages to see what happens and what each choice costs.',
    lanes: { top: 'Snapshots and details', bottom: 'Owner writes' },
    nodes: [
      { id: 'users', title: 'Users', detail: 'Point and radius', column: 0, row: 'middle' },
      {
        id: 'search',
        title: 'Search nodes',
        detail: 'Whole index in memory',
        column: 1,
        row: 'middle',
      },
      {
        id: 'cache',
        title: 'Details cache',
        detail: 'Versioned, 10-min TTL',
        column: 2,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'owners',
        title: 'Owners',
        detail: 'Create, move, delete',
        column: 0,
        row: 'bottom',
        appearsAt: 5,
      },
      {
        id: 'api',
        title: 'Place API',
        detail: 'Conditional writes',
        column: 1,
        row: 'bottom',
        appearsAt: 5,
      },
      {
        id: 'db',
        title: 'Place table',
        detail: 'Source of truth',
        column: 2,
        row: 'bottom',
        appearsAt: 5,
      },
      {
        id: 'relay',
        title: 'Change relay',
        detail: 'Reads the stream',
        column: 3,
        row: 'middle',
        appearsAt: 6,
      },
      {
        id: 'log',
        title: 'Change log',
        detail: '12 partitions, 7 days',
        column: 2,
        row: 'middle',
        appearsAt: 6,
      },
      {
        id: 'builder',
        title: 'Snapshot builder',
        detail: 'Export every 6 h',
        column: 1,
        row: 'top',
        appearsAt: 9,
      },
      {
        id: 'snaps',
        title: 'Snapshots',
        detail: 'Index files',
        column: 0,
        row: 'top',
        appearsAt: 9,
      },
    ],
    edges: [
      ['users', 'search'],
      ['search', 'cache'],
      ['owners', 'api'],
      ['api', 'db'],
      ['db', 'relay'],
      ['relay', 'log'],
      ['log', 'search'],
      ['relay', 'cache'],
      ['builder', 'db'],
      ['builder', 'snaps'],
      ['snaps', 'search'],
    ],
    // The relay writes details to the cache from stage 7 on; stage 6 shows only the log path.
    edgeStages: [{ edge: ['relay', 'cache'], stages: [7, 8, 9, 10] }],
    stages: [
      {
        title: 'Search near a point, from memory',
        narration:
          'A user asks for cafés within 2 km. Any of 15 search nodes can answer, because each holds every place in memory: an ordered map of cell code and place id and a place map, about 12 GB in all. This first version picks one cell length from the radius, the longest whose cells are at least 2 km wide and tall at that latitude, here length 5. It reads that cell and its 8 neighbours, which together contain every point within 2 km, keeps the places whose great-circle distance is within the radius and sorts them by distance and then place id.',
        tradeoff:
          'A full copy on every node makes a search a few range scans in memory with no network hop, and any node can serve any part of the map. The cost is that every node must receive every change and needs the memory for all 100 million places. Reading the 8 neighbours fixes the classic geohash miss, a place just across a cell border, at the price of reading 9 cells instead of 1.',
        nodes: ['users', 'search'],
        travel: [['users', 'search']],
        short: 'Search',
        metrics: {
          users: '50M',
          requestsPerSecond: '30K',
          p95Latency: '25 ms',
          errorRate: '0.01%',
          healthy: '15 / 15',
          custom: [{ label: 'Searches', value: '25K/s' }],
        },
        load: { search: 67 },
      },
      {
        title: 'A dense center slows every search',
        narration:
          'In a large city a 2 km search at length 5 reads a block of about 150 km², and across a metro area that holds about 750,000 places. Each one is a distance computation of about 50 ns, so a single search costs about 37 ms of CPU to return 20 places. With 30% of searches in such cities, 7,500 a second need about 280 cores, and the fleet has 120. Requests queue on every node, the p95 climbs past a second, and timeouts reach users everywhere, not only in the city.',
        tradeoff:
          'More nodes would spread the waste but not remove it: each search would still read hundreds of thousands of entries to keep 20. The radius says how far a user is willing to go, not how far the search must look, and in a dense center the 20 nearest places are a few hundred metres away.',
        nodes: ['users', 'search'],
        travel: [['users', 'search']],
        short: 'Dense center',
        metrics: {
          users: '50M',
          requestsPerSecond: '30K',
          p95Latency: '1.8 s',
          errorRate: '3%',
          healthy: '15 / 15',
          alerts: ['p95Latency', 'errorRate'],
          custom: [{ label: 'Scanned per search', value: '750K', alert: true }],
        },
        load: { search: 100 },
        traffic: [{ edge: ['users', 'search'], kind: 'failed' }],
      },
      {
        title: 'Start small, grow only until the answer is proven',
        narration:
          'Now the node starts at length 7, cells of about 150 m, and reads the 3 × 3 block. Any place within the covered radius, the smaller of a cell’s height and its width at the poleward edge of the block, is certainly in the block. The search stops when 20 matches lie within the smaller of the covered radius and the requested radius, since they are then provably the 20 nearest, or when the covered radius reaches the requested radius, since the block then holds the whole circle. Otherwise it moves to the next shorter length, with cells about 32 times larger. The covered radius is taken 1% short, a margin for the flat approximation of a cell. Before it scans a block the node counts it from the counts in the map’s inner nodes; if the larger block holds more than 50,000 entries it adds rings of cells at the current length instead. A search with a category scans the map ordered by category, so it reads only that category.',
        tradeoff:
          'Downtown, the first block holds about 3,000 entries and the search ends there, so the CPU per search falls by more than a hundred times. The price is a little logic, a second ordered map that doubles the memory of the entries, and a few wasted scans when a search steps up a level. A density tree such as a quadtree would get the same effect with a structure that is harder to update in place.',
        nodes: ['users', 'search'],
        travel: [['users', 'search']],
        short: 'Grow cells',
        metrics: {
          users: '50M',
          requestsPerSecond: '30K',
          p95Latency: '25 ms',
          errorRate: '0.01%',
          healthy: '15 / 15',
          custom: [
            { label: 'Scanned downtown', value: '~3,000' },
            { label: 'Scan limit', value: '50,000' },
          ],
        },
        load: { search: 67 },
      },
      {
        title: 'Sparse areas and the edges of the map',
        narration:
          'In the countryside the blocks at lengths 7 and 6 are nearly empty, and the search moves up to length 5, whose covered radius of about 3.5 km passes the 2 km asked for: the block holds the whole circle, so the answer is complete with the 12 or so places inside it. If the radius holds fewer than 5 matches, the node widens to 2 and then 4 times the radius, at most 50 km, and the answer carries searchedRadius. Cells are computed from integer longitude and latitude indexes: a neighbour across 180 degrees of longitude wraps to the other side, and there is no neighbour beyond a pole. When the block reaches a pole, where the width at its poleward edge and so the covered radius fall to zero, the node reads the whole band of latitude the circle touches at length 3: rows about 156 km tall and 256 columns, so one or two rows and at most 512 cells.',
        tradeoff:
          'Widening turns an empty screen into a useful one, at the cost of a few more scans and results farther than the user asked for, which the answer states. Handling the antimeridian and the poles in the neighbour arithmetic keeps one code path for the whole planet; cells built on the faces of a cube would avoid the narrow polar cells, but would replace a simple string prefix with a library the team has to trust.',
        nodes: ['users', 'search'],
        travel: [['users', 'search']],
        short: 'Sparse, edges',
        metrics: {
          users: '50M',
          requestsPerSecond: '30K',
          p95Latency: '25 ms',
          errorRate: '0.01%',
          healthy: '15 / 15',
          custom: [{ label: 'Widen at most', value: '4x, 50 km' }],
        },
        load: { search: 67 },
      },
      {
        title: 'Fill the page from the details cache',
        narration:
          'The index holds only what a search needs: coordinates, category, version and a short name. The 20 results are filled with address, hours and photo from a cache keyed by place id, through pipelined reads grouped by shard; about 95% are there. A miss is a strongly consistent read of the place table, and the fill is a script that writes the value only if the cache holds no newer version. The page ends with a cursor that names its last distance and place id, so the next page is the places that come after it in that order, on any node.',
        tradeoff:
          'Keeping details out of the index saves about 100 GB per node, at the price of a second lookup per page. A fill can race an update: it may read version 6 just before version 7 is written. The version check makes the late fill a no-op whenever the cache already holds 7, and the 10-minute lifetime bounds the remaining case, where the update never reached the cache. If the cache fails, a node answers with names from the index and partial: true rather than sending every read to the table.',
        nodes: ['search', 'cache'],
        travel: [['search', 'cache']],
        short: 'Hydrate',
        metrics: {
          users: '50M',
          requestsPerSecond: '30K',
          p95Latency: '25 ms',
          errorRate: '0.01%',
          healthy: '15 / 15',
          custom: [
            { label: 'Cache lookups', value: '505K/s' },
            { label: 'Hit rate', value: '95%' },
          ],
        },
        load: { search: 67, cache: 35 },
      },
      {
        title: 'An owner moves a place',
        narration:
          'An owner moves a café across the street. The Place API checks the owner and the coordinates and makes one conditional write to the place table: set the new fields and version 8, only if the version is still 7 and the owner matches. A delete is the same write with status deleted and an expiry 30 days later, so the place becomes a tombstone and not a missing row. A create is one transaction that writes the place and the idempotency record, each under a condition that it does not exist yet.',
        tradeoff:
          'The table is the only place an edit is written, so there is no second write to lose or to get out of step. Writing to the index from the API would make edits visible sooner, but a crash between the two writes would leave them disagreeing with nothing to repair them. The version on the write serialises the owner’s edits and later orders them everywhere else, at the cost of a 412 when two editors race.',
        nodes: ['owners', 'api', 'db'],
        travel: [
          ['owners', 'api'],
          ['api', 'db'],
        ],
        short: 'Owner edit',
        metrics: {
          users: '50M',
          requestsPerSecond: '30K',
          p95Latency: '25 ms',
          errorRate: '0.01%',
          healthy: '15 / 15',
          custom: [{ label: 'Owner writes', value: '200/s' }],
        },
        load: { search: 67, api: 10, db: 15 },
      },
      {
        title: 'Every change reaches every node, by version',
        narration:
          'The table’s change stream holds every committed write in order per item. A relay function reads it and writes one compact change record per write to a log of 12 partitions keyed by place id, which each search node reads in full from its own position. A node applies a record only if its version is newer than the one it holds: it removes the old entries, inserts the new ones and updates the place map. Every 5 seconds each node also writes a heartbeat item to the table, and the time it takes for heartbeats to come back through the stream, the relay and the log is the node’s measured index age.',
        tradeoff:
          'Reading the table’s own stream instead of publishing from the API removes the dual write: a commit is in the stream whether the API crashed after it or not. Delivery is at least once, made harmless by the place version: a relay retry writes duplicates, and a node drops any record not newer than what it holds, so repeats and reordering change nothing. The log is a separate system to run, needed because the stream should have at most two readers per shard and here every search node, 15 and one more during a deploy, needs every change.',
        nodes: ['db', 'relay', 'log', 'search'],
        travel: [
          ['db', 'relay'],
          ['relay', 'log'],
          ['log', 'search'],
        ],
        short: 'Change stream',
        metrics: {
          users: '50M',
          requestsPerSecond: '30K',
          p95Latency: '25 ms',
          errorRate: '0.01%',
          healthy: '15 / 15',
          custom: [
            { label: 'Index age', value: '2-8 s' },
            { label: 'Change records', value: '~200/s' },
          ],
        },
        load: { search: 67, db: 15, relay: 10, log: 10 },
      },
      {
        title: 'Keep details fresh without a race',
        narration:
          'For each place write the relay also writes the new details to the cache with the same version script, or a tombstone for a delete. The relay’s cache write is best effort: if the cache refuses it, the relay counts the failure and moves on, so a cache outage never holds up the index. The next search that misses reads the table and fills the current version.',
        tradeoff:
          'Writing the new value is better than deleting the key: a delete lets a fill that read the old row put it back, while a versioned write leaves nothing older than itself to win. What remains is a cache that lost the write, after a failover with asynchronous replication or a refused call, which serves the old details until the 10-minute lifetime ends. A shorter lifetime would tighten that bound and cost more misses on the table.',
        nodes: ['relay', 'cache'],
        travel: [['relay', 'cache']],
        short: 'Cache by version',
        metrics: {
          users: '50M',
          requestsPerSecond: '30K',
          p95Latency: '25 ms',
          errorRate: '0.01%',
          healthy: '15 / 15',
          custom: [{ label: 'Stale at most', value: '10 min' }],
        },
        load: { search: 67, relay: 10, cache: 35 },
      },
      {
        title: 'A node falls behind and leaves rotation',
        narration:
          'One node stalls in a long pause and stops applying records. Each node knows, per partition, the append time of the oldest record it has not applied, and learns the log’s end offsets from every fetch and from a lookup every 10 seconds; at 30 seconds behind, or after 30 seconds with no answer from the log, its health check fails, and after three failed checks 5 seconds apart the load balancer stops sending it searches. It keeps reading, catches up, passes three checks and returns. A node that is merely behind keeps catching up; only a process whose apply loop makes no progress for 120 seconds, neither applying records nor waiting on a fetch, is restarted by a watchdog, so a log that is slow for everyone never restarts the fleet. A record that makes apply throw is retried twice and then skipped and counted; one that makes it hang is skipped after the restart, because the node notes on local disk the offset it is applying. Either way the first daily reload from a snapshot exported after that record repairs the place, up to about a day and a half later, and a reload’s own replay honours the same skip note. A stall of the relay or of the log makes every node old but not behind its log, so they all stay in rotation and the index age alarm pages instead.',
        tradeoff:
          'Measuring a node against its own log takes out exactly the node that is the problem, and never the whole fleet because of a shared stall: stale answers beat no answers, and the requirements allow seconds. The cost is that during a stall upstream every node serves an older index together, which only the index age shows. If the log itself is unreachable every check fails; the target group is set to send traffic to all nodes once fewer than 10 are healthy, the number the peak needs, so the peak is not squeezed onto fewer nodes than can carry it.',
        nodes: ['log', 'search'],
        travel: [['log', 'search']],
        short: 'Node lags',
        metrics: {
          users: '50M',
          requestsPerSecond: '30K',
          p95Latency: '25 ms',
          errorRate: '0.01%',
          healthy: '14 / 15',
          custom: [{ label: 'Node behind log', value: '45 s', alert: true }],
        },
        load: { search: 71, log: 10 },
        traffic: [{ edge: ['log', 'search'], kind: 'heavy' }],
      },
      {
        title: 'Start a node from a snapshot',
        narration:
          'Every 6 hours the builder asks the table for an export at a time T, sorts the places by cell code into 64 files, and writes a manifest last with T and, for each partition, the first offset appended at T minus 5 minutes. A new node loads the newest snapshot whose offsets the log still keeps and replays from those offsets while a launch lifecycle hook holds it out of the load balancer; it completes the hook when it is less than 5 seconds behind, about 5 minutes after it starts, and only then is registered. Once a day each node, one at a time, builds a fresh index the same way next to the one it serves, compares the two at the same offsets, publishes how many places differ, and swaps.',
        tradeoff:
          'The export does not need to line up with the log: a write before T is in the export, a write after T was appended after T, and the 5 minutes of overlap are replayed harmlessly because of versions. That avoids pausing writes or building a consistent cut. The cost is a builder and an export every 6 hours, and double memory during a reload. The daily reload is what repairs drift: a missed record or a bug in apply lasts until the first reload from a snapshot exported after it, at most about a day and a half, because a reload whose replay still covers the record reproduces the error.',
        nodes: ['builder', 'db', 'snaps', 'search'],
        travel: [
          ['builder', 'db'],
          ['builder', 'snaps'],
          ['snaps', 'search'],
        ],
        short: 'Snapshot',
        metrics: {
          users: '50M',
          requestsPerSecond: '30K',
          p95Latency: '25 ms',
          errorRate: '0.01%',
          healthy: '15 / 15',
          custom: [
            { label: 'Start to rotation', value: '~5 min' },
            { label: 'Snapshot size', value: '~3 GB' },
          ],
        },
        load: { search: 67, builder: 40, snaps: 20 },
      },
      {
        title: 'A zone goes down',
        narration:
          'An Availability Zone is lost with its 5 search nodes. The 10 left take 3,000 requests a second each at peak, their full planned load. The lost nodes fail their health checks and leave rotation. The group has zonal shift turned on with zonal autoshift, so while the zone is impaired it launches new capacity only in the healthy zones and does not try to replace nodes inside the impaired one; Search nodes short pages, the on-call adds 5 nodes, and each loads a snapshot before it takes traffic. One of three log brokers is gone; every partition still has two in-sync replicas, so the relay keeps writing. Cache shards whose primary was in that zone promote a replica.',
        tradeoff:
          '15 nodes where 10 carry the peak is the price of losing a zone without shedding load: a third of the fleet idles on a normal day. The cache failover can drop the last writes, which the version script and the 10-minute lifetime bound. A deploy uses the same arithmetic in the other direction: an instance refresh launches a new node, which is held by its launch hook until it is loaded and then warms up for 2 minutes in rotation, before an old one leaves, so the fleet never drops below 15.',
        nodes: ['users', 'search', 'log', 'cache'],
        travel: [
          ['users', 'search'],
          ['log', 'search'],
        ],
        short: 'Lose a zone',
        metrics: {
          users: '50M',
          requestsPerSecond: '30K',
          p95Latency: '30 ms',
          errorRate: '0.02%',
          healthy: '10 / 15',
          alerts: ['healthy'],
          custom: [{ label: 'Per node', value: '3,000/s' }],
        },
        load: { search: 100, log: 15, cache: 50 },
      },
    ],
  },
  flows: [
    {
      id: 'search',
      title: 'A search near a point',
      kind: 'sync',
      summary:
        'Ana looks for cafés within 2 km in a city center. The node proves the 20 nearest from the first block of small cells, fills them from the cache and answers in about 25 ms with a cursor.',
      runsOn:
        'Search ALB with AWS WAF → search node on EC2 (index in memory) → ElastiCache for Valkey → Amazon DynamoDB on a miss',
      participants: [
        { id: 'app', label: 'App', service: 'Phone or browser' },
        { id: 'alb', label: 'Search ALB', service: 'ALB with AWS WAF' },
        { id: 'node', label: 'Search node', service: 'EC2, r7g.2xlarge' },
        { id: 'cache', label: 'Details cache', service: 'ElastiCache for Valkey' },
        { id: 'table', label: 'Place table', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'alb',
          label: 'GET /places?lat=40.4168&lng=-3.7038&radius=2000&category=cafe',
          note: 'With a session token the node checks without a call. A rate rule per source address sits in the firewall in front of the load balancer.',
        },
        {
          from: 'alb',
          to: 'node',
          label: 'forward to a node in rotation',
          note: 'Any node will do: each holds the whole index. Only nodes that pass their health check, which includes being less than 30 seconds behind the change log, receive searches.',
        },
        {
          from: 'node',
          to: 'node',
          label: 'length 7: count, then scan 9 ranges of (cafe, code)',
          note: 'The category map holds about 75 café entries in this block, counted from its inner nodes before the scan. The covered radius here is about 120 m, and 20 cafés lie within it, so the answer is proven at this level and the search stops.',
        },
        {
          from: 'node',
          to: 'node',
          label: 'haversine, keep ≤ 2,000 m, sort by (distance cm, placeId)',
          note: 'Distance on a sphere of radius 6,371 km, rounded to centimetres so that every node orders the same places the same way. Ties go to the lower place id.',
        },
        {
          from: 'node',
          to: 'cache',
          label: 'GET place:{id} × 20, pipelined by shard',
          note: 'Reads go to primaries and replicas alike. A replica can be a moment behind its primary, which the version in each value makes visible.',
        },
        {
          from: 'cache',
          to: 'node',
          label: '19 hits, 1 miss',
          note: 'About 95% hit at peak. Each value starts with its version.',
          style: 'reply',
        },
        {
          from: 'node',
          to: 'table',
          label: 'BatchGetItem ConsistentRead=true [p91]',
          note: 'A strongly consistent read, so the fill holds at least the newest committed version at the time of the read. At most 200 reads in flight per node, each with a 20 ms limit; a result over the limit is returned with its short name only and partial: true.',
        },
        {
          from: 'node',
          to: 'cache',
          label: 'EVALSHA setIfNewer place:p91 v7 EX 600',
          note: 'The script writes only if the key is absent or holds an older version, so a fill that lost a race with the relay’s write of v8 changes nothing.',
          style: 'async',
        },
        {
          from: 'node',
          to: 'app',
          label: '200 {places[20], searchedRadius: 2000, complete: true, cursor}',
          note: 'The cursor is signed and holds the query and the last result: 98 m, place p37. The next page can go to any node.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'next-page',
      title: 'The next page, on another node',
      kind: 'sync',
      summary:
        'Ana scrolls. Her cursor reaches a different node, which runs the search again and returns the 20 places after 98 m and p37 in distance order. No state was kept between the pages.',
      runsOn: 'Search ALB → search node on EC2 → ElastiCache for Valkey',
      participants: [
        { id: 'app', label: 'App', service: 'Phone or browser' },
        { id: 'node', label: 'Another node', service: 'EC2, r7g.2xlarge' },
        { id: 'cache', label: 'Details cache', service: 'ElastiCache for Valkey' },
      ],
      steps: [
        {
          from: 'app',
          to: 'node',
          label: 'GET /places?cursor=…',
          note: 'Through the same load balancer, which can pick any node.',
        },
        {
          from: 'node',
          to: 'node',
          label: 'check signature and age; 15 minutes at most',
          note: 'The signing key is shared by all nodes. A forged or old cursor is a 400, so a client cannot change the radius or the point halfway through.',
        },
        {
          from: 'node',
          to: 'node',
          label: 'search again; keep (distance, id) > (98 m, p37)',
          note: 'The covered radius must now pass the 40th distance, so the node may step up a level. The order is the same on every node because the distance is computed the same way.',
        },
        {
          from: 'node',
          to: 'cache',
          label: 'GET × 20, pipelined',
          note: 'Hydrated like the first page.',
        },
        {
          from: 'node',
          to: 'app',
          label: '200 {places[20], cursor}',
          note: 'Not a snapshot: a café that moved closer between the pages is skipped, and one that moved farther can show again. The app drops repeats by place id. After 10 pages or 500 results there is no cursor.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'details',
      title: 'Open a place',
      kind: 'sync',
      summary:
        'Ana opens one café. The node answers from the cache, or reads the table and fills the cache with a write that cannot replace a newer version.',
      runsOn: 'Search ALB → search node on EC2 → ElastiCache for Valkey → Amazon DynamoDB',
      participants: [
        { id: 'app', label: 'App', service: 'Phone or browser' },
        { id: 'node', label: 'Search node', service: 'EC2, r7g.2xlarge' },
        { id: 'cache', label: 'Details cache', service: 'ElastiCache for Valkey' },
        { id: 'table', label: 'Place table', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'node',
          label: 'GET /places/p91',
          note: 'Details reads share the search load balancer and nodes: they are user reads under the same objective, and they need the same cache client.',
        },
        {
          from: 'node',
          to: 'cache',
          label: 'GET place:p91',
          note: 'A miss here, because the key expired.',
        },
        {
          from: 'node',
          to: 'table',
          label: 'GetItem p91 ConsistentRead=true',
          note: 'Version 7, status active. Had it been deleted, the answer would be 410.',
        },
        {
          from: 'node',
          to: 'cache',
          label: 'EVALSHA setIfNewer place:p91 v7 EX 600',
          note: 'Between the read and this write the owner committed v8 and the relay wrote it to the cache. The script sees v8, keeps it and returns without writing.',
        },
        {
          from: 'node',
          to: 'app',
          label: '200 {place v7}',
          note: 'This one answer is a moment old, as any read that raced a write can be. The next read gets v8 from the cache.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'create',
      title: 'An owner creates a place, and retries',
      kind: 'sync',
      summary:
        'An owner creates a café and loses the answer. The retry with the same idempotency key returns the same place, because the place and the key were written in one transaction.',
      runsOn: 'Owner ALB with AWS WAF → Place API on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'owner', label: 'Owner console', service: 'Browser' },
        { id: 'api', label: 'Place API', service: 'ALB with AWS WAF + ECS Fargate' },
        { id: 'table', label: 'Place table', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'owner',
          to: 'api',
          label: 'POST /places Idempotency-Key: k42 {name, category, lat, lng, …}',
          note: 'The owner is authenticated. The API checks that the latitude is within ±90, the longitude within ±180 and the category one of the 200.',
        },
        {
          from: 'api',
          to: 'table',
          label:
            'TransactWriteItems: Put place p91 v1 IF not exists; Put idem#o7#k42 → p91 IF not exists',
          note: 'Both or neither. p91 is a random 64-bit id; if it already existed, which is very unlikely, the API draws another and tries again, at most 3 times.',
        },
        {
          from: 'table',
          to: 'api',
          label: 'committed',
          note: 'Durable before the answer. The commit is also in the table’s stream, which is all the rest of the design needs.',
          style: 'reply',
        },
        {
          from: 'api',
          to: 'owner',
          label: '201 {placeId: p91, version: 1} (lost)',
          note: 'The connection drops before the owner sees it.',
          style: 'reply',
        },
        {
          from: 'owner',
          to: 'api',
          label: 'POST /places Idempotency-Key: k42 again',
          note: 'Same key and same body, a few seconds later.',
        },
        {
          from: 'api',
          to: 'table',
          label: 'transaction cancelled: idem#o7#k42 exists → GetItem it',
          note: 'The condition on the key fails, so nothing is written. The record names p91, valid for 24 hours.',
        },
        {
          from: 'api',
          to: 'owner',
          label: '201 {placeId: p91, version: 1}',
          note: 'The same place. A retry after 24 hours may create a second one, which is why the key has a stated lifetime.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'move',
      title: 'A move reaches every node, twice',
      kind: 'async',
      summary:
        'An owner moves café p91 to version 8. The relay writes the change record, crashes before it finishes its batch and writes it again; every node applies it one time because the second copy is not newer.',
      runsOn:
        'Place API → Amazon DynamoDB → DynamoDB Streams → AWS Lambda relay → Amazon MSK → search nodes on EC2',
      participants: [
        { id: 'api', label: 'Place API', service: 'ECS Fargate' },
        { id: 'table', label: 'Place table', service: 'DynamoDB + Streams' },
        { id: 'relay', label: 'Change relay', service: 'AWS Lambda' },
        { id: 'log', label: 'Change log', service: 'Amazon MSK' },
        { id: 'cache', label: 'Details cache', service: 'ElastiCache for Valkey' },
        { id: 'node', label: 'Every search node', service: 'EC2, 15 nodes' },
      ],
      steps: [
        {
          from: 'api',
          to: 'table',
          label: 'UpdateItem p91 SET lat, lng, version = 8 IF version = 7 AND ownerId = o7',
          note: 'The owner sent If-Match: 7. Answered 200 with the new place once the table has committed it.',
        },
        {
          from: 'table',
          to: 'relay',
          label: 'stream record MODIFY p91, old and new images',
          note: 'The stream holds each write once, in the order of the writes to that item, for 24 hours. The event source mapping hands a shard’s records to one relay instance at a time, in order.',
          style: 'async',
        },
        {
          from: 'relay',
          to: 'log',
          label: 'produce key=p91 {v8, lat, lng, cafe, active}, acks=all',
          note: 'Acknowledged once every in-sync replica of the partition has it, at least two of the three. The relay then times out before the rest of its batch is written, so the batch fails.',
        },
        {
          from: 'relay',
          to: 'log',
          label: 'retry of the whole batch: p91 v8 again',
          note: 'The mapping retries until it succeeds or the records leave the stream at 24 hours, with the shard waiting behind them. The log now holds v8 twice. At least once, made harmless by the place version.',
        },
        {
          from: 'relay',
          to: 'cache',
          label: 'EVALSHA setIfNewer place:p91 v8 EX 600',
          note: 'Best effort: a refused write is counted and skipped, so a cache outage never blocks the index path.',
          style: 'async',
        },
        {
          from: 'log',
          to: 'node',
          label: 'record p91 v8',
          note: 'Every node reads all 12 partitions. It holds v7, so it removes the old entries from both maps, inserts the new ones and records v8.',
          style: 'async',
        },
        {
          from: 'log',
          to: 'node',
          label: 'record p91 v8, the copy',
          note: 'Not newer than v8: dropped and counted. A v7 that arrived late would be dropped the same way.',
          style: 'async',
        },
      ],
    },
    {
      id: 'delete',
      title: 'A delete, a late update and the purge',
      kind: 'async',
      summary:
        'An owner deletes café p91 at version 9. A copy of version 8 then arrives on one node and is dropped by the tombstone. Thirty days later the table removes the item and every node lets the tombstone go.',
      runsOn:
        'Place API → Amazon DynamoDB (TTL) → DynamoDB Streams → AWS Lambda relay → Amazon MSK → search nodes on EC2',
      participants: [
        { id: 'api', label: 'Place API', service: 'ECS Fargate' },
        { id: 'table', label: 'Place table', service: 'DynamoDB + Streams' },
        { id: 'relay', label: 'Change relay', service: 'AWS Lambda' },
        { id: 'log', label: 'Change log', service: 'Amazon MSK' },
        { id: 'node', label: 'Search node', service: 'EC2' },
      ],
      steps: [
        {
          from: 'api',
          to: 'table',
          label:
            'UpdateItem p91 SET status = deleted, version = 9, expiresAt = +30 d IF version = 8 AND ownerId = o7',
          note: 'Not a DeleteItem: the tombstone keeps the last version in the source of truth, so a snapshot taken in the next 30 days carries it too.',
        },
        {
          from: 'relay',
          to: 'log',
          label: 'p91 v9 deleted',
          note: 'The relay also writes a deleted marker with v9 to the cache, so a late fill of v8 cannot bring the details back.',
        },
        {
          from: 'log',
          to: 'node',
          label: 'p91 v9 deleted',
          note: 'The node removes both index entries and keeps p91 in the place map as a tombstone at v9. Searches no longer see it.',
          style: 'async',
        },
        {
          from: 'log',
          to: 'node',
          label: 'p91 v8, a duplicate from a relay retry',
          note: 'v8 is not newer than the tombstone’s v9, so the café is not brought back. Without the tombstone the node would know nothing of p91 and would insert it.',
          style: 'async',
        },
        {
          from: 'table',
          to: 'relay',
          label: 'after 30 days: REMOVE p91, by the service (TTL)',
          note: 'The table removes expired items within a few days of the expiry. The stream record names the service as the one who removed it, and its old image carries v9.',
          style: 'async',
        },
        {
          from: 'relay',
          to: 'node',
          label: 'purge p91 v9, through the log',
          note: 'The node drops the tombstone only if it is still at v9. No older record of p91 can arrive any more: the log keeps 7 days and the stream 24 hours, and the purge comes at least 30 days after the delete. Place ids are never reused.',
          style: 'async',
        },
      ],
    },
    {
      id: 'bootstrap',
      title: 'A node starts from a snapshot and replays the log',
      kind: 'async',
      summary:
        'A replacement node starts. Held out of the load balancer by a launch hook, it loads the newest snapshot, replays the log from the offsets in its manifest, and joins about 5 minutes later, without missing a change and with the overlap made harmless by versions.',
      runsOn: 'EC2 Auto Scaling → Amazon S3 → Amazon MSK → Search ALB target group',
      participants: [
        { id: 'asg', label: 'Auto Scaling group', service: 'EC2 Auto Scaling' },
        { id: 'node', label: 'New node', service: 'EC2, r7g.2xlarge' },
        { id: 's3', label: 'Snapshots', service: 'Amazon S3' },
        { id: 'log', label: 'Change log', service: 'Amazon MSK' },
        { id: 'alb', label: 'Search ALB', service: 'Target group' },
      ],
      steps: [
        {
          from: 'asg',
          to: 'node',
          label: 'launch in a healthy zone',
          note: 'The group replaces an instance that fails its EC2 status checks. It does not use the load balancer’s check, so a fleet that is out of rotation together is not replaced together. A launch lifecycle hook holds the new instance in Pending:Wait, not yet registered with the load balancer, for up to 15 minutes, and abandons it if the hook is not completed.',
        },
        {
          from: 'node',
          to: 's3',
          label: 'list manifests; GET the newest, T = 05:45',
          note: 'A manifest is written after all 64 files, so one that exists names a complete snapshot. The node skips any manifest whose offsets are older than the log still keeps.',
        },
        {
          from: 's3',
          to: 'node',
          label: '64 files, ~3 GB, sorted by cell code',
          note: 'Read in parallel. The code map is built in one pass because the files are already in order; the category map needs one sort. About 2 minutes of build.',
          style: 'reply',
        },
        {
          from: 'node',
          to: 'log',
          label: 'fetch all 12 partitions from the manifest’s offsets (T − 5 min)',
          note: 'The 06:00 run exported T = 05:45, 15 minutes back. Each offset is the first record appended at or after 05:40. A write committed after 05:45 was appended after 05:45, so it is in this replay. A write before 05:45 is in the export. The five minutes in both are applied twice, harmlessly.',
        },
        {
          from: 'node',
          to: 'node',
          label: 'apply up to about 15 h 20 min of records by version',
          note: 'About 9 h 20 min and 6.8 million records when every run succeeds; with one missed run, which Snapshot old allows, about 15 h 20 min and 11.2 million records at the peak rate, about 2 minutes at 100,000 a second, well inside the 15-minute hook.',
        },
        {
          from: 'node',
          to: 'asg',
          label: 'CompleteLifecycleAction once less than 5 s behind',
          note: 'Only now does the group register the node with the target group and mark it in service. A node that cannot catch up within the 15 minutes is abandoned and replaced.',
        },
        {
          from: 'alb',
          to: 'node',
          label: 'GET /health every 5 s → 200',
          note: 'After any load, the check passes only once the node has been less than 5 s behind; from then on the 30-second rule applies. A newly registered target receives searches after its first passing check. An instance refresh waits a further 2 minutes of warmup before it replaces the next node.',
        },
      ],
    },
    {
      id: 'lag',
      title: 'A node falls behind and comes back',
      kind: 'async',
      summary:
        'Node 7 pauses for 60 seconds. Its health check fails, the load balancer stops sending it searches, it catches up and returns. The other 14 never noticed.',
      runsOn: 'Amazon MSK → search node on EC2 → Search ALB target group → Amazon CloudWatch',
      participants: [
        { id: 'log', label: 'Change log', service: 'Amazon MSK' },
        { id: 'node', label: 'Node 7', service: 'EC2' },
        { id: 'alb', label: 'Search ALB', service: 'Target group' },
        { id: 'cw', label: 'Metrics', service: 'CloudWatch' },
      ],
      steps: [
        {
          from: 'node',
          to: 'node',
          label: 'a long pause: nothing applied for 60 s',
          note: 'Records keep arriving in the log. The node knows the append time of the oldest one it has not applied.',
        },
        {
          from: 'node',
          to: 'cw',
          label: 'NodeBehindLog = 34 s',
          note: 'Published every 10 seconds by every node, with the node as a dimension. 0 when it has applied everything in the log.',
          style: 'async',
        },
        {
          from: 'alb',
          to: 'node',
          label: 'GET /health → 503, three times, 5 s apart',
          note: 'The check fails above 30 seconds behind. After three failures the target is unhealthy and receives no new searches; requests already in flight finish.',
        },
        {
          from: 'log',
          to: 'node',
          label: 'fetch and apply the backlog',
          note: 'A minute of changes at peak is about 12,000 records, a fraction of a second of apply.',
        },
        {
          from: 'alb',
          to: 'node',
          label: 'GET /health → 200, three times',
          note: 'Under 30 seconds the check passes, and three passes put the node back. Had its apply loop stopped altogether, the watchdog would have restarted the process, which then loads a snapshot.',
        },
        {
          from: 'node',
          to: 'cw',
          label: 'IndexAge back to a few seconds',
          note: 'The largest age over its 12 partitions of the newest heartbeat the node has applied, published as one metric with no dimensions, so the data points of all nodes fall into one series. It is published only while the node is in rotation, so it measures what users are served.',
          style: 'async',
        },
      ],
    },
    {
      id: 'rebuild',
      title: 'The scheduled snapshot and the daily reload that repairs drift',
      kind: 'scheduled',
      summary:
        'Every 6 hours a schedule starts the builder, which exports the table and writes a snapshot. Once a day each node, one at a time, builds a fresh index from it, compares it with the one it serves and swaps.',
      runsOn:
        'EventBridge Scheduler → snapshot builder on ECS Fargate → DynamoDB export to Amazon S3 → search nodes on EC2',
      participants: [
        { id: 'sched', label: 'Schedule', service: 'EventBridge Scheduler' },
        { id: 'builder', label: 'Builder', service: 'ECS Fargate task' },
        { id: 'table', label: 'Place table', service: 'DynamoDB export' },
        { id: 's3', label: 'Snapshots', service: 'Amazon S3' },
        { id: 'node', label: 'Search node', service: 'EC2' },
        { id: 'cw', label: 'Metrics', service: 'CloudWatch' },
      ],
      steps: [
        {
          from: 'sched',
          to: 'builder',
          label: 'RunTask at 00:00, 06:00, 12:00 and 18:00 UTC',
          note: 'No retries of its own: the next run is the retry. The builder stops itself after 3 hours, so two runs never overlap.',
        },
        {
          from: 'builder',
          to: 'table',
          label: 'ExportTableToPointInTime at T = now − 15 min',
          note: 'Needs point-in-time recovery on the table. It reads no capacity, so searches and owner writes are not affected. AWS gives no completion time, which the 3-hour stop covers.',
        },
        {
          from: 'builder',
          to: 's3',
          label: 'read the export; write 64 sorted files; write manifest last',
          note: 'Skips heartbeat and idempotency items, keeps tombstones. The manifest holds T and each partition’s first offset appended at or after T − 5 minutes, from the log’s lookup by time.',
        },
        {
          from: 'builder',
          to: 'cw',
          label: 'build duration',
          note: 'Published after the manifest is stored. Snapshot old does not watch the builder: every node lists the manifests every 5 minutes and publishes SnapshotAgeHours, the age of the newest T, so a builder that never runs is noticed too.',
          style: 'async',
        },
        {
          from: 'node',
          to: 's3',
          label: 'daily, staggered: load the newest snapshot beside the live index',
          note: 'Nodes take turns, one about every 96 minutes, with the build held to 2 of 8 cores. A node starts or continues a reload only while at least 14 targets are healthy, which it checks with DescribeTargetHealth every minute: with 14 in rotation each carries about 2,140 reads a second, and the reloading node’s 6 free cores still cover that. The live index keeps serving and applying records throughout.',
        },
        {
          from: 'node',
          to: 'node',
          label: 'replay the new index to offsets O; pause apply; compare; swap',
          note: 'Both copies are at the same offsets, so they must agree on every place and version. The new copy’s replay skips the same noted offset as the live apply loop. The pause lasts a few seconds.',
        },
        {
          from: 'node',
          to: 'cw',
          label: 'IndexDriftPlaces = 0',
          note: 'Any other number means the live index had missed or misapplied something, which the swap has just repaired. The old copy is then freed.',
          style: 'async',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'How do we index places by location?',
      options: [
        {
          name: 'A B-tree on latitude and a B-tree on longitude',
          pros: 'Any database has it, with no new concepts.',
          cons: 'A query can use one of them well: a 2 km search on latitude alone scans a band around the whole planet and filters the rest.',
        },
        {
          name: 'Geohash cells: interleave the bits into one sortable code',
          pros: 'Nearby points share a prefix, a cell of any length is one range of codes, and a place moves with one delete and one insert.',
          cons: 'A fixed grid: neighbours must be read, cells narrow towards the poles and density varies by orders of magnitude between cells.',
        },
        {
          name: 'A quadtree, or cells on the faces of a cube',
          pros: 'A quadtree splits where places are dense, so leaves hold similar numbers. Cube-face cells keep their size from the equator to the poles.',
          cons: 'A quadtree has to be split and merged as places move. Cube-face cells need a geometry library and cover a circle with a set of cells of mixed sizes.',
        },
      ],
      choice:
        'Geohash codes in an ordered map. The density problem is solved per query by choosing the cell length at search time, which gives most of what a quadtree gives without changing the structure as places move, and the polar cells are handled in the neighbour arithmetic. Cube-face cells become worth it if the product moves to areas and polygons.',
    },
    {
      question: 'Which cells does a search read, and how is the cell length chosen?',
      options: [
        {
          name: 'One length from the radius, the 3 × 3 block around the point',
          pros: 'Simple, and complete within the radius: cells at least as large as the radius contain the whole circle.',
          cons: 'In a dense center a 2 km search reads about 750,000 entries to show 20.',
        },
        {
          name: 'Cover the circle with the cells that intersect it, at several lengths',
          pros: 'Reads the least area of any option.',
          cons: 'More cells per query and more geometry to get right, for little gain when the answer is a page of 20 nearest.',
        },
        {
          name: 'Start at length 7 and step to larger cells until the answer is proven',
          pros: 'Downtown it stops at about 3,000 entries; in the countryside it reaches a block that holds the whole circle in three levels. The answer within the covered radius is exact.',
          cons: 'A few wasted scans when it steps up, and a limit of 50,000 entries when a larger block would be too big.',
        },
      ],
      choice:
        'Start small and grow. The proof is one inequality: with the point in the center cell, every place within the smaller of the cell height and the cell width at the poleward edge lies in the 3 × 3 block. When 20 matches are within that distance and within the radius, nothing outside the block can beat them; when that distance reaches the radius, the block holds the whole circle and the answer is complete. The covered radius is taken 1% short, a margin for treating a cell as flat. A block that would hold more than 50,000 entries is replaced by rings at the current length, and if the limit is reached the answer is exact up to the covered radius and says complete: false.',
    },
    {
      question: 'What breaks at the antimeridian and the poles, and how is it handled?',
      options: [
        {
          name: 'Ignore it: neighbours by string arithmetic on the geohash',
          pros: 'No extra code.',
          cons: 'A search near 180 degrees of longitude misses places on the other side, and near a pole the 3 × 3 block can be narrower than a few metres.',
        },
        {
          name: 'Integer cell indexes: wrap longitude, stop latitude, read a band near the poles',
          pros: 'Neighbours are x ± 1 modulo the number of columns and y ± 1 without wrapping. Haversine handles the wrap in the distance. One code path for the whole planet.',
          cons: 'A block across the antimeridian is ranges at both ends of the code space, and a polar search reads a whole band, which is only cheap because almost no places are there.',
        },
        {
          name: 'Switch to cube-face cells',
          pros: 'No narrow cells and no special cases.',
          cons: 'A larger change than the problem, and the edges between cube faces bring their own special cases.',
        },
      ],
      choice:
        'Integer indexes. The covered radius uses the cell width at the poleward edge of the block, so narrow cells make the search step up a level instead of returning a wrong answer. When the block reaches a pole, where the covered radius falls to zero, the node reads every cell of the band of latitude the circle touches at length 3, one or two rows of 256 cells. Distances are on a sphere, which differs from the ellipsoid by under 0.5%, well inside what a user can tell.',
    },
    {
      question: 'Where does the index live, and when does a full copy per node stop fitting?',
      options: [
        {
          name: 'A spatial index in the main database',
          pros: 'One system and no copy to keep fresh.',
          cons: '25,000 searches a second compete with owner writes, and scaling reads means database replicas with their own lag.',
        },
        {
          name: 'A search engine cluster with geo queries',
          pros: 'Geo, text and filters in one query, and sharding built in.',
          cons: 'A cluster to run and tune for a problem that fits in memory, with a refresh interval and its own lag on top of the stream.',
        },
        {
          name: 'A full copy in the memory of every search node',
          pros: 'A search is a few range scans in local memory, any node serves any region, and capacity grows by adding nodes.',
          cons: 'About 16 GB per node and every change applied 15 times. It stops working when the index no longer fits next to a second copy during a reload.',
        },
      ],
      choice:
        'A full copy per node: about 152 bytes per place is 15.2 GB for 100 million, plus about 0.6 GB of tombstones, and a reload needs twice that, inside 64 GiB. Sharding by region would put a hot city on a few shards; with a full copy a festival only adds load spread over every node. At about 200 million places, twice today, the double copy (152 B × 200M × 2 ≈ 61 GB) no longer fits comfortably in 64 GiB, and the next step is shards by cell range with every shard replicated, routed by the cell of the point.',
    },
    {
      question: 'How does an owner edit reach every search node without a dual write?',
      options: [
        {
          name: 'The API writes the table, then publishes the change',
          pros: 'Fast and obvious.',
          cons: 'A crash between the commit and the publish leaves a committed edit that no node ever sees, with nothing to repair it.',
        },
        {
          name: 'Nodes poll the table for changes since a timestamp',
          pros: 'No stream and no log.',
          cons: 'Clocks of concurrent writers do not commit in timestamp order, so a reader that moved past a time can miss a write that becomes visible later.',
        },
        {
          name: 'The table’s change stream, a relay and a log that every node reads',
          pros: 'Every committed write is in the stream, in order per item, whether or not the API survived. The log gives any number of readers their own position and keeps 7 days.',
          cons: 'Two more parts to run, the relay and the log, and a delay of a second or two.',
        },
      ],
      choice:
        'The stream, a relay and a log. The stream should have at most two readers per shard, which is why the nodes read a log and not the stream. The relay retries a failed batch until it succeeds or the records leave the stream after 24 hours, with the shard waiting behind it; the alarm on its iterator age fires within minutes, and a gap after 24 hours is repaired by reloading every node from a snapshot exported after it.',
    },
    {
      question: 'How is a change applied when records repeat, arrive out of order or are missed?',
      options: [
        {
          name: 'Apply records in the order they arrive',
          pros: 'Nothing to store per place.',
          cons: 'A retried batch delivers an old move after a newer one, and the place ends up where it was.',
        },
        {
          name: 'Deltas with a sequence number per place, and stop at a gap',
          pros: 'A missing record is detected at once.',
          cons: 'A node stops applying a place until the gap is filled, and filling it needs a way to fetch the missing record.',
        },
        {
          name: 'Full state in every record, applied only when its version is newer',
          pros: 'Repeats and reordering change nothing, and a missed intermediate record is harmless because the next one carries everything.',
          cons: 'A version and a place map entry per place in memory, and tombstones for deletes.',
        },
      ],
      choice:
        'Full state with a version. Each write in the table adds 1 under a condition, so versions of a place are strictly increasing, and a node keeps the highest it has seen. Deletes are tombstones in both the table and the node, so a late update of a deleted place is not newer and cannot bring it back. The one case versions cannot fix is a last record that never arrives: the first daily reload from a snapshot exported after it repairs it.',
    },
    {
      question: 'How does a new node start without missing or double-applying a change?',
      options: [
        {
          name: 'Replay the whole log from the beginning',
          pros: 'No snapshot to build.',
          cons: 'The log keeps 7 days and the places are years old.',
        },
        {
          name: 'A consistent cut: pause writes, copy, note the offsets, resume',
          pros: 'The snapshot and the offsets describe exactly the same writes.',
          cons: 'Owner writes stop while it runs, and a copy of 100 million items takes far longer than any pause owners would accept.',
        },
        {
          name: 'An export at time T and a replay from offsets a little before T',
          pros: 'Nothing pauses. Every write is in the export, the replay or both, and versions make both harmless.',
          cons: 'Up to about 15 hours 20 minutes of records to replay after one missed run, and a builder to run every 6 hours.',
        },
      ],
      choice:
        'The export and an overlapping replay. A write committed before T is in the export. A write committed after T reaches the log after T, because the relay writes it after the commit, so it is in a replay that starts at the first record appended at T minus 5 minutes; the 5 minutes cover clock differences between the export and the brokers. The node joins only when it is less than 5 seconds behind the log.',
    },
    {
      question: 'How is a node that falls behind taken out of rotation?',
      options: [
        {
          name: 'Health check on the end-to-end index age',
          pros: 'Takes out any node that serves an old index, whatever the cause.',
          cons: 'A stall of the relay or of the log makes every node old at once and takes the whole fleet out.',
        },
        {
          name: 'Health check on how far the node is behind its own log',
          pros: 'Takes out exactly the node that is slow, and leaves the fleet in place when the problem is upstream.',
          cons: 'During an upstream stall every node serves the same older index, and only the end-to-end age shows it.',
        },
        {
          name: 'No health check on freshness',
          pros: 'Simplest.',
          cons: 'A node stuck for an hour keeps serving deleted and moved places while the others are correct.',
        },
      ],
      choice:
        'Behind its own log, at 30 seconds. The end-to-end age, measured by heartbeats that every node writes to the table and reads back from the log, drives the freshness objective and its alarm, not the health check. The Auto Scaling group uses EC2 status checks only, so a fleet that fails its health checks together is not replaced together. If fewer than 10 nodes, the number the peak needs, stay healthy, the target group sends traffic to all of them, which is the right outcome here, rather than concentrating 30,000 reads a second on too few.',
    },
    {
      question: 'How do the details in the cache stay fresh when fills race updates?',
      options: [
        {
          name: 'A time to live only',
          pros: 'Nothing to invalidate.',
          cons: 'Every edit shows stale details for up to the whole lifetime.',
        },
        {
          name: 'Delete the key on every change',
          pros: 'Usually fresh within a second.',
          cons: 'A reader that fetched the old row just before the change writes it back just after the delete, and it stays until the lifetime ends.',
        },
        {
          name: 'Write the new value with a version, and fill only if newer',
          pros: 'A late fill of an older version is refused, so the race above changes nothing.',
          cons: 'A script on every write, a version in every value, and still a stale value if the cache loses the relay’s write.',
        },
      ],
      choice:
        'Versioned writes, kept for 10 minutes. The relay writes the new value or a deleted marker, and fills from searches write only over an older version. Two cases remain, both bounded by the 10 minutes: a relay write the cache refused, which the relay counts and does not retry, and a write lost in a failover, since replication is asynchronous. Fills use strongly consistent reads, so a fill never starts from a replica behind the newest commit.',
    },
    {
      question: 'How are distance-sorted pages returned?',
      options: [
        {
          name: 'Page by offset: skip 40, take 20',
          pros: 'Trivial.',
          cons: 'An edit between pages shifts every result after it, and a deep page still computes all the earlier ones.',
        },
        {
          name: 'Store the full result list for a session',
          pros: 'Pages are stable and cheap after the first.',
          cons: 'State per user on one node, which breaks when the next page lands elsewhere or the node goes away.',
        },
        {
          name: 'A signed cursor with the last (distance, place id)',
          pros: 'Any node can continue it, nothing is stored, and the order is total.',
          cons: 'Not a snapshot: a place edited between pages can be skipped or repeated.',
        },
      ],
      choice:
        'The cursor. Distances are rounded to centimetres and ties go to the lower place id, so every node orders the same set the same way. The cursor also fixes the query and how far it widened, is signed so a client cannot change them, and expires after 15 minutes. Search stops at 10 pages or 500 results, which bounds the cost of a deep page.',
    },
    {
      question: 'What if a search returns too few places?',
      options: [
        {
          name: 'Return what was found',
          pros: 'Fast and predictable.',
          cons: 'Empty screens in rural areas.',
        },
        {
          name: 'Widen the radius in steps, up to a limit',
          pros: 'Useful results almost everywhere.',
          cons: 'More scans for sparse areas, and results farther than asked.',
        },
      ],
      choice:
        'Widen to 2 and then 4 times the radius, at most 50 km, when the radius holds fewer than 5 matches, and say so in searchedRadius. Widening uses the same growing blocks, so a sparse search still scans hundreds to a few thousand entries, and the result is nearest first like any other.',
    },
  ],
  wrapUp:
    'Every search node holds a lean geohash index of all places in memory and reads cells from small to large until it can prove the nearest places, exact within the radius and bounded by a scan limit. Owner writes are conditional writes to one table with a version; the table’s stream, a relay and a log carry them at least once to every node, which applies only newer versions and keeps tombstones for deletes. A node behind its log leaves rotation, a snapshot plus an overlapping replay starts a node without missing a change, a daily reload repairs drift, and details come from a cache whose fills cannot roll back a newer version.',
  guarantees: {
    provides: [
      {
        property: 'Owner writes',
        promise:
          'A 2xx means the place table has committed the write. Every update and delete is conditional on the version the owner read and on the owner, and adds 1 to the version, so a place has one strictly increasing history and a conflicting edit gets a 412. A create is one transaction with its idempotency key, so a retry within 24 hours returns the same place.',
      },
      {
        property: 'Change delivery',
        promise:
          'Every committed write is in the table’s stream. The relay writes it to the log at least once, made harmless by the place version, and keeps retrying a failed batch until it succeeds or the stream drops it after 24 hours. A record acknowledged by the log is on two of three brokers in different Availability Zones.',
      },
      {
        property: 'Apply order',
        promise:
          'A search node changes a place only for a record with a newer version, so repeats and reordering have no effect and an older version never replaces a newer one. A deleted place stays a tombstone in the table and on every node until its purge, at least 30 days later, so a late update cannot bring it back.',
      },
      {
        property: 'Nodes in rotation',
        promise:
          'A node takes searches only while it is less than 30 seconds behind its own log, give or take the three checks 5 seconds apart that it takes to leave or return. A new node joins only after it is less than 5 seconds behind. The exception is a shared failure that leaves fewer than 10 nodes healthy: then the load balancer sends traffic to every node, healthy or not.',
      },
      {
        property: 'Freshness',
        promise:
          'Normally an acknowledged write is in every node in rotation within 5 seconds. Over 28 days the end-to-end index age, measured by heartbeats through the table, the stream, the relay and the log, is at most 60 seconds in 99.5% of minutes, and someone is paged before that budget is spent.',
      },
      {
        property: 'Search correctness',
        promise:
          'Results are the nearest places that match, by great-circle distance on a sphere, in the order (distance in centimetres, place id), as of the node’s index. With complete: true every match within the radius is accounted for; with complete: false the results are exact up to the covered radius the node reached before its 50,000-entry limit.',
      },
      {
        property: 'Details',
        promise:
          'A cached value is replaced only by a newer version. Details lag an edit by the same seconds as the index, and by at most 10 minutes when the cache lost or refused the relay’s write.',
      },
      {
        property: 'Rebuild',
        promise:
          'The index on any node can be rebuilt from the place table at any time. Every node does so once a day and reports how many places differed, so a missed or misapplied record lasts until the first reload from a snapshot exported after it, at most about a day and a half while at least 14 nodes are healthy; with fewer, reloads wait.',
      },
    ],
    assumes: [
      'The table commits a conditional write to one item atomically, keeps what it acknowledged, and puts every committed write in its stream in order per item.',
      'The log keeps an acknowledged record while one in-sync replica survives, never elects a replica that was out of sync, and sets the append time from broker clocks that agree with the table’s clock within 5 minutes.',
      'Place ids are never reused, and nothing deletes a place item except the table’s own expiry.',
      'A snapshot is less than 7 days old when a node loads it, so its offsets are still in the log.',
      'Clocks of the search nodes agree within a second. They decide how old a heartbeat looks, not which version wins.',
      'Every node runs the same distance code during a page sequence, or a cursor could order a tie differently on two versions.',
      'The cache runs the version script atomically on its primary.',
    ],
    doesNotGuarantee: [
      'Searches during a change record that hangs apply on every node. The fleet restarts together once, about 5 minutes without answers, and then skips that record. A node launched later from a snapshot exported before that record has no note, so it restarts once more before it skips it, a bounded cost inside its 15-minute launch hook; once is per node.',
      'Read-your-writes in search. An owner sees the new place in the answer to the write, and in search results seconds later.',
      'That all nodes agree at one instant. Two searches a second apart on two nodes can differ by a recent edit.',
      'Fresh results during a stall of the relay or the log. Every node keeps serving the index it has, all of them equally old, and the index age alarm pages.',
      'A stable result set across pages. A place edited between two pages can be skipped or shown twice.',
      'A complete answer in every dense case. A search that reaches 50,000 scanned entries returns what it can prove and says complete: false.',
      'Details within seconds after a cache failover. Writes the failover lost serve old details for up to 10 minutes.',
      'Full details while the cache is down. Searches return names from the index with partial: true, and details reads go to the table under a limit per node.',
      'Idempotency beyond 24 hours. A create retried later with the same key may create a second place, since the table removes the expired key within a few days of its expiry.',
      'Ranking by anything but distance.',
      'Accuracy to the ellipsoid. Distances are on a sphere, within about 0.5%.',
      'That heartbeats cover every shard of the table’s stream. They land on whatever stream shards their items hash to, so a relay stuck on one shard that carries no heartbeat leaves IndexAge normal; Relay behind, which reads the oldest iterator age across shards, still pages.',
      'Searches during the loss of a second zone at peak. 5 healthy nodes carry half the peak, and with fewer than 10 healthy the load balancer spreads traffic over every registered node, so many requests fail until added nodes are in rotation, about 5 minutes after they start.',
    ],
  },
  failures: [
    {
      scenario: 'The relay crashes or times out after writing part of a batch to the log.',
      impact:
        'The event source mapping retries the whole batch, so the log holds some change records twice. Nodes see the copies.',
      detection:
        'Lambda Errors on the relay, and the duplicate and stale record count published by every node. Nothing user-facing.',
      recovery:
        'None needed. A copy is not newer than what a node holds and is dropped. The shard waits behind the failed batch, so order per place holds.',
    },
    {
      scenario: 'One search node pauses or slows and falls more than 30 seconds behind its log.',
      impact:
        'For up to about 15 more seconds it serves searches from an index that misses the last edits. Then it is out of rotation and the other 14 carry its share.',
      detection:
        'NodeBehindLog for that node, the target becoming unhealthy, and HealthyHostCount on the target group. Search nodes short pages only if fewer than 12 are healthy, two nodes of margin over the 10 the peak needs, the room a node behind its log and one failure take.',
      recovery:
        'It keeps reading and returns after three passing checks. A process whose apply loop makes no progress for 120 seconds is restarted by its watchdog and loads a snapshot, about 5 minutes. A slow log never triggers a restart.',
    },
    {
      scenario: 'The relay stops, or the log refuses writes, for several minutes.',
      impact:
        'Owner writes still succeed. No change reaches any node, so every node serves the same older index and stays in rotation, because none is behind its log. Details keep being filled from the table on misses.',
      detection:
        'Index stale from the nodes’ IndexAge; Relay behind from IteratorAge, which heartbeats keep moving even when owners are quiet; Log unhealthy if the brokers are the cause.',
      recovery:
        'When the relay or the log is back, the relay drains the stream in order and nodes catch up in seconds. If the log is unreachable for every node, every health check fails and, below 10 healthy, the load balancer sends traffic to all of them.',
    },
    {
      scenario:
        'The relay is stuck for more than 24 hours, so stream records expire before it reads them.',
      impact: 'The edits in the gap never reach the log. Every node misses them until it reloads.',
      detection:
        'Relay behind pages within minutes, about a day before any record is lost. After the gap, the daily reloads report differences in IndexDriftPlaces.',
      recovery:
        'Trigger a snapshot after the relay is healthy, then reload every node from it, one at a time. The export holds every write committed before it, including the gap, and the replay covers what came after.',
    },
    {
      scenario: 'A cache fill races an owner update, or a cache failover drops recent writes.',
      impact:
        'The fill is refused when the newer version is already there. When the newer write was lost, readers see the old details, still with the new position in the index, for up to 10 minutes.',
      detection:
        'The relay’s count of refused cache writes, and ElastiCache failover events through SNS. Nothing catches one stale value.',
      recovery: 'The 10-minute lifetime ends it, or the next edit of the place. No manual step.',
    },
    {
      scenario: 'The cache cluster is unavailable.',
      impact:
        'Searches still answer from the index with short names and partial: true. Details reads go to the table, at most 200 in flight per node with a 20 ms limit, so the table sees a bounded load instead of 505,000 reads a second.',
      detection:
        'Cache errors and partial answers counted by every node; ElastiCache metrics and events; ReadThrottleEvents on the table if the limit is set too high.',
      recovery:
        'Nodes stop calling the cache for 30 seconds after errors pass 5% in 10 seconds and then try again. The cache refills from misses when it is back.',
    },
    {
      scenario: 'A search node dies or its instance fails.',
      impact:
        'Searches in flight on it fail and the app retries. The load balancer stops routing to it after three failed checks.',
      detection: 'HealthyHostCount drops, and the EC2 status check fails.',
      recovery:
        'The Auto Scaling group launches a replacement, which loads a snapshot, replays the log and joins about 5 minutes later. 14 nodes carry the peak meanwhile.',
    },
    {
      scenario: 'An Availability Zone is lost.',
      impact:
        '5 of 15 nodes go with it; 10 carry the peak at 3,000 requests a second each, their full plan. One of three brokers is out, and every partition keeps two in-sync replicas. Cache shards fail over and can drop their last writes. One Place API task of three is lost.',
      detection:
        'HealthyHostCount on both target groups, UnderReplicatedPartitions on the log, ElastiCache failover events.',
      recovery:
        'While the zonal shift is active the group launches only in healthy zones; the on-call raises the desired count by 5 after Search nodes short pages, and the new nodes join after loading a snapshot, about 5 minutes. Until they do, a further loss leaves fewer than 10 healthy, the load balancer then spreads traffic over every registered node, healthy or not, and some requests fail.',
    },
    {
      scenario: 'The snapshot builder fails, or the export takes longer than 3 hours.',
      impact:
        'No new snapshot. Nodes that start load an older one and replay more of the log; daily reloads use the older one too. Searches are unaffected.',
      detection:
        'Snapshot old, from the age of the newest manifest that the nodes see, when two scheduled runs in a row have published nothing.',
      recovery:
        'The next run 6 hours later tries again. A snapshot is usable for 7 days, the log’s retention, so there are days to fix the builder before a node cannot start.',
    },
    {
      scenario:
        'A bug in apply, or a record lost by the log, leaves one node wrong about some places.',
      impact:
        'Searches on that node show a moved place in its old cell or a deleted one, until its first reload from a snapshot exported after the record, up to about a day and a half.',
      detection:
        'IndexDriftPlaces above 0 on a daily reload, possibly only on a later one: a reload whose replay still covers the record reproduces the error and reports no drift.',
      recovery:
        'A reload from a snapshot exported after the record swaps in the correct index. Repeated drift on every node points at the apply code or the relay, and is a bug to fix.',
    },
    {
      scenario: 'A poison change record makes apply throw, or hang, on every node at once.',
      impact:
        'A record that throws is retried twice and skipped on each node within a second, and that one place is wrong until the first reload from a snapshot exported after it, up to about a day and a half. A record that hangs stops every apply loop together: after 120 seconds each watchdog restarts its process, every node is out of rotation for about 5 minutes, and searches fail meanwhile. On the replay each node skips the offset it had noted on local disk, so it happens once, not in a loop. A node launched later from a snapshot exported before that record has no note, so it restarts once more before it skips it, a bounded cost inside its 15-minute launch hook; once is per node.',
      detection:
        'Records skipped from RecordsSkipped, and for a hang Search errors, Search nodes short and Index stale together.',
      recovery:
        'Automatic for the fleet: skipped records are counted and the first reload from a snapshot exported after them repairs their places. The record itself, and the code that choked on it, are a bug to fix.',
    },
  ],
  capacity: {
    assumptions: [
      '50 million daily users with about 17 searches each. The peak is 2.5 times the average.',
      'A search shows a page of 20, and about one search in five opens a place.',
      '100 million places in 200 categories. Owner writes: 10% creates, 85% updates, 5% deletes.',
      'A place item is about 1 KB. A change record is about 100 bytes, a snapshot record about 51 bytes.',
      'In memory, per place: two ordered entries of about 40 bytes and a place map entry of about 72 bytes with its short name, about 152 bytes. A tombstone is about 72 bytes.',
      'Densities: about 20,000 places per km² in a downtown core, 5,000 averaged over a large metro, 1 in the countryside. 30% of searches fall in large metros.',
      'A distance check costs about 50 ns. Planning figure, to confirm with a load test: a search node serves 3,000 requests a second of the usual mix, 5 searches to 1 details read.',
      'The details cache hits about 95% at peak with a 10-minute lifetime.',
    ],
    estimates: [
      {
        label: 'Searches',
        value: '864 million a day, 10,000 a second on average, 25,000 at peak',
        math: '50M × 17 = 850M ≈ 864M = 10,000/s × 86,400 s. Peak 2.5 × 10,000 = 25,000/s.',
      },
      {
        label: 'Details reads',
        value: '2,000 a second on average, 5,000 at peak',
        math: '10,000 ÷ 5 = 2,000/s; 25,000 ÷ 5 = 5,000/s. All reads at peak: 30,000/s.',
      },
      {
        label: 'Owner writes',
        value: '5 million a day, about 60 a second on average, 200 at peak',
        math: '5M ÷ 86,400 = 58/s. Deletes: 5% × 5M = 250,000 a day.',
      },
      {
        label: 'Index per node',
        value: 'about 16 GB, about 32 GB during a reload',
        math: '100M × 152 B = 15.2 GB. Tombstones: 250,000 a day × about 33 days, the 30 days plus the few days the table may take to expire them, ≈ 8.3M × 72 B ≈ 0.6 GB. A reload holds two copies: about 32 GB of 64 GiB.',
      },
      {
        label: 'Fixed cell length downtown',
        value: 'about 750,000 entries and 37 ms of CPU per search',
        math: 'Length 5 at 45°: 3 × 3.46 km by 3 × 4.89 km ≈ 150 km² × 5,000/km² = 750,000; × 50 ns = 37.5 ms. 30% × 25,000 = 7,500 searches/s × 37.5 ms ≈ 280 cores, against 15 × 8 = 120.',
      },
      {
        label: 'Growing cells downtown',
        value: 'about 3,000 entries, under 0.2 ms',
        math: 'Length 7 at 45°: 3 × 108 m by 3 × 153 m ≈ 0.15 km² × 20,000 = 3,000. Covered radius 108 m holds π × 0.108² × 20,000 ≈ 730 places, more than 20. 3,000 × 50 ns = 0.15 ms.',
      },
      {
        label: 'Sparse area',
        value: 'about 160 entries over three levels, about 12 results',
        math: 'At 1 place per km²: length 7 holds 0, length 6 about 5 (4.7 km²), length 5 about 150 (150 km²). Its covered radius of 3.46 km passes the 2 km radius, so the answer is complete: the π × 2² ≈ 12.6 places inside the circle.',
      },
      {
        label: 'Search nodes',
        value: '15, of which the peak needs 10',
        math: '30,000 ÷ 3,000 = 10. 15 over three zones run at 2,000/s each, 67% of plan; a lost zone leaves 10 at 100%.',
      },
      {
        label: 'Cache lookups',
        value: '505,000 a second at peak, about 42,000 per cache node',
        math: '25,000 × 20 + 5,000 = 505,000/s; ÷ 12 nodes (4 shards × 3) ≈ 42,000/s.',
      },
      {
        label: 'Table reads on misses',
        value: 'about 25,000 strongly consistent reads a second at peak',
        math: '5% × 505,000 ≈ 25,250 items/s × 1 read unit for a 1 KB item read strongly. The on-demand table is pre-warmed to 50,000 reads a second, above the 12,000 a new one starts with, and its per-table quota is raised from the default 40,000 read request units.',
      },
      {
        label: 'Table writes',
        value: 'about 260 write units a second at peak',
        math: 'Creates 10% × 200 = 20/s × 2 items × 2 for a transaction = 80; updates and deletes 180 × 1 = 180; heartbeats 15 ÷ 5 s = 3. Total ≈ 263.',
      },
      {
        label: 'Change log',
        value: 'about 530 MB a day, 11 GB on the brokers',
        math: '5M writes + 260,000 heartbeats ≈ 5.26M × 100 B ≈ 526 MB a day; × 7 days ≈ 3.7 GB; × 3 replicas ≈ 11 GB.',
      },
      {
        label: 'Heartbeats',
        value: 'one per partition about every 4 seconds',
        math: 'Each node writes one every 5 s and rotates over the 12 partitions: 15 ÷ 5 = 3 a second, so a partition gets one every 12 ÷ 3 = 4 s. With 10 nodes, every 6 s.',
      },
      {
        label: 'Snapshot',
        value: 'about 5.1 GB raw, about 3 GB compressed, in 64 files',
        math: '100M × 51 B = 5.1 GB. The export it comes from is about 100 GB: 100M × 1 KB.',
      },
      {
        label: 'Replay on start',
        value:
          'about 6.8 million records, about a minute; 11.2 million and about 2 minutes after one missed run',
        math: 'The newest snapshot can be 6 hours between runs plus a 3-hour build plus the 15 minutes of export lag old, and the replay starts 5 minutes before T: about 9 h 20 min. 33,600 s × 200/s ≈ 6.7M at the peak rate, plus about 0.1M heartbeats ≈ 6.8M. ÷ 100,000/s ≈ 68 s. With one missed run the snapshot is 6 hours older: 15 h 20 min = 55,200 s × 200/s ≈ 11.0M plus about 0.2M heartbeats ≈ 11.2M, about 112 s.',
      },
      {
        label: 'Freshness budget',
        value: '201 minutes in 28 days',
        math: '28 × 1,440 = 40,320 minutes × 0.5% ≈ 201.',
      },
      {
        label: 'Place API',
        value: '3 tasks, one per zone',
        math: 'A task takes 500 writes/s as a plan; 200 ÷ 500 = 0.4, so one carries the peak and three cover a zone loss.',
      },
    ],
    implications: [
      'Reads outnumber writes 150 to 1, and the index fits in memory: a full copy per node turns every search into local work and every write into 15 small applies.',
      'The radius does not bound the work; density does. Growing cells from small to large and the 50,000-entry limit are what keep a downtown search under a millisecond of index work.',
      'Hydration, not the index, is the largest load: 505,000 cache lookups a second. A 1-point drop in the hit rate adds about 5,000 table reads a second, which is why the table is pre-warmed to twice the normal miss load and nodes cap their reads.',
      'The change stream is small, about 200 records a second, so the log’s job is many readers and 7 days of history, not throughput.',
      'The fleet is 15 nodes where 10 carry the peak, so a zone can go. A deploy replaces one node at a time with an instance refresh at 100% minimum and 110% maximum healthy. A launch hook keeps each new node out of service until it has loaded a snapshot and caught up, and a 2-minute default instance warmup follows, so a new node is in rotation before an old one leaves; a deploy of 15 nodes takes about two hours. The daily reloads happen in place and never take a node out.',
      'A snapshot every 6 hours keeps a start under 5 minutes; the log’s 7 days give the builder days of slack before a node cannot start.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one Region across three Availability Zones. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Search nodes',
        service:
          'Amazon EC2 Auto Scaling group of 15 r7g.2xlarge instances (8 vCPU, 64 GiB), 5 per zone, with EC2 status checks only and zonal shift with zonal autoshift (ignore unhealthy in the impaired zone), behind an Application Load Balancer with AWS WAF',
        why: 'Each instance holds the whole index, about 16 GB, and needs room for a second copy during a reload, which is why these are memory-sized instances and not small tasks. The load balancer checks /health every 5 seconds with 3 checks to leave and 3 to return, and a 30-second deregistration delay. A launch lifecycle hook, completed by the node once it is less than 5 seconds behind its log, keeps a new node out of the load balancer while it loads. Deploys use an instance refresh with 100% minimum and 110% maximum healthy and a 2-minute default instance warmup. A watchdog restarts the search process when its apply loop has not pinged for 120 seconds, which it does only while applying records or waiting on a fetch, and the target group sends traffic to all nodes only when fewer than 10 are healthy, its minimum healthy targets count.',
        watch:
          'ALB RequestCount, TargetResponseTime, HTTPCode_Target_5XX_Count, HTTPCode_ELB_5XX_Count, HealthyHostCount and UnHealthyHostCount; EC2 CPUUtilization and StatusCheckFailed. Custom per node: NodeBehindLog, IndexAge, records dropped as not newer, scan limit hits, partial answers, RecordsSkipped and IndexDriftPlaces.',
      },
      {
        part: 'Place API',
        service:
          'A second Application Load Balancer with AWS WAF, in front of Amazon ECS on AWS Fargate: 3 tasks, minimum healthy 100%, maximum 200%',
        why: 'Owner writes only, on their own load balancer so their errors and latency are measured apart from searches. Stateless tasks that authenticate the owner and make one conditional write or one transaction per request.',
        watch:
          'ALB RequestCount, TargetResponseTime, HTTPCode_Target_5XX_Count, HTTPCode_ELB_5XX_Count and HealthyHostCount; ECS CPUUtilization. Custom: 412 conflicts and idempotent replays.',
      },
      {
        part: 'Place table',
        service:
          'Amazon DynamoDB, on-demand, pre-warmed to 50,000 reads a second with the per-table read quota raised above its default 40,000; partition key placeId; point-in-time recovery on; a stream with new and old images; TTL on expiresAt',
        why: 'The source of truth. Conditional writes give every place a strictly increasing version, the stream carries every committed write in order per item, TTL removes tombstones after 30 days, and point-in-time recovery is what the export needs.',
        watch:
          'ThrottledRequests and SystemErrors per operation, ReadThrottleEvents, ConditionalCheckFailedRequests, TransactionConflict, ConsumedReadCapacityUnits, ConsumedWriteCapacityUnits, SuccessfulRequestLatency and WriteKeyRangeThroughputThrottleEvents.',
      },
      {
        part: 'Change relay',
        service:
          'AWS Lambda with a DynamoDB Streams event source mapping: batch size 100, retries without limit until a record expires, in a VPC with access to the log',
        why: 'Turns each stream record into a change record, a purge record for an expiry by the service, or a heartbeat record on the partition the heartbeat names, and produces it with acks=all. Then writes the details to the cache, best effort. It skips idempotency items and any other item that is neither a place nor a heartbeat, together with their expiries. A failed batch fails the invocation so the mapping retries it in order.',
        watch:
          'IteratorAge, Errors, Duration, Throttles and ConcurrentExecutions. Custom: change records written and cache writes refused.',
      },
      {
        part: 'Change log',
        service:
          'Amazon MSK Provisioned, 3 brokers, one per zone; topic place-changes with 12 partitions, replication factor 3, min.insync.replicas 2, log append time, 7 days of retention, unclean leader election off',
        why: 'Lets every search node, 15 and one more during a deploy, read every change from its own position, and keeps 7 days so that a snapshot up to that age can be replayed. The append time is what a snapshot’s offsets are looked up by.',
        watch:
          'UnderReplicatedPartitions, UnderMinIsrPartitionCount, OfflinePartitionsCount, ActiveControllerCount, KafkaDataLogsDiskUsed, CpuUser and BytesInPerSec. Search nodes read without a consumer group, so their lag is the custom NodeBehindLog.',
      },
      {
        part: 'Details cache',
        service:
          'Amazon ElastiCache for Valkey, cluster mode with 4 shards of cache.r7g.xlarge, one primary and two replicas each across zones, Multi-AZ with automatic failover',
        why: 'Holds the details of the places that are being shown, each value with its version, for 10 minutes. A Lua script compares versions before every write. Reads go to replicas as well as primaries.',
        watch:
          'EngineCPUUtilization (4 vCPUs per node), CacheHits, CacheMisses, Evictions, CurrConnections, ReplicationLag, DatabaseMemoryUsagePercentage, EvalBasedCmds and EvalBasedCmdsLatency.',
      },
      {
        part: 'Snapshot builder and snapshots',
        service:
          'An ECS task on AWS Fargate started by an Amazon EventBridge Scheduler schedule every 6 hours; DynamoDB export to Amazon S3; snapshots in an S3 bucket kept 8 days by a lifecycle rule, a day longer than they are usable',
        why: 'The export reads no table capacity. The builder sorts the export into 64 files and writes the manifest last; S3 returns a stored object to any read that starts after the write, so a node that sees a manifest can read every file it names.',
        watch:
          'ECS task stops and their reasons, EventBridge Scheduler InvocationAttemptCount and TargetErrorCount. Custom: build duration, and SnapshotAgeHours from the search nodes.',
      },
      {
        part: 'Security',
        service:
          'AWS WAF on both load balancers, IAM roles per part, AWS KMS, AWS Secrets Manager for the cursor signing key, and AWS CloudTrail',
        why: 'Owners are authenticated and a write is conditional on the owner. Search nodes can read the table and the bucket, and write only heartbeat items, through a condition on the leading key. Only the Place API writes places, only the relay produces to the log, and only the builder writes snapshots.',
        watch: 'WAF BlockedRequests per rule, and CloudTrail events for changes to roles and keys.',
      },
      {
        part: 'Observability',
        service: 'Amazon CloudWatch dashboards and alarms',
        why: 'Freshness is measured by the nodes that serve searches, from heartbeats that cross the whole path, so a dead relay cannot hide it. Errors and latency come from the load balancers, and log health from the brokers.',
        watch: 'The objectives below and the alarms that guard them.',
      },
    ],
    limits: [
      'DynamoDB Streams keeps records for 24 hours. Each record appears once, in the order of the writes to its item, and no more than two processes should read one shard at the same time, which is why the nodes read a log instead.',
      'A DynamoDB Streams event source mapping retries a failed batch without limit by default, until the record expires; MaximumRetryAttempts and MaximumRecordAgeInSeconds can lower that. One instance processes a shard in order, and ParallelizationFactor, up to 10, keeps the order per item.',
      'IteratorAge is the age of the last record in the batch when the mapping sent it to the function. It is emitted only on invocations, which the heartbeats keep frequent.',
      'DynamoDB export to S3 needs point-in-time recovery, can export any time in its window, consumes no read capacity, and has no guaranteed completion time.',
      'TTL deletes expired items within a few days of the expiry. The stream record of such a delete has userIdentity type Service and principal dynamodb.amazonaws.com.',
      'A DynamoDB partition takes 1,000 write units and 3,000 read units a second. A new on-demand table sustains 4,000 writes and 12,000 reads a second, so this one is pre-warmed. The default per-table quota of an on-demand table is 40,000 read and 40,000 write request units a second, adjustable, so it is raised before the table is warmed to 50,000 reads. A transactional write costs twice, and a strongly consistent read of up to 4 KB costs 1 read unit.',
      'In a BatchGetItem, ThrottledRequests is incremented only if every item in the batch is throttled; each throttled item increments ReadThrottleEvents, which has a TableName dimension. Throttle metrics have a data point only in a minute with a throttle, and an alarm on an AWS/DynamoDB metric defaults to ignoring missing data, so the alarm reads FILL(ReadThrottleEvents, 0) through metric math and never sees a missing point.',
      'An Application Load Balancer health check runs every 5 to 300 seconds, with 2 to 10 checks to change state. By default it sends traffic to all targets only when none is healthy; target_group_health.unhealthy_state_routing.minimum_healthy_targets.count, here 10, raises that threshold, and with cross-zone load balancing on it counts the targets of all zones together. When both a DNS failover and a routing failover threshold are set, the DNS one must be at least the routing one, so this design turns DNS failover off for the group.',
      'Auto Scaling zonal shift, started by hand or by ARC zonal autoshift, makes the group launch new capacity only in healthy zones; with ignore unhealthy, as AWS suggests for a prescaled group, it does not replace instances in the impaired zone. EC2 status checks can stay healthy in a zone impairment, which is why the group does not rely on them there.',
      'HTTPCode_Target_5XX_Count leaves out the 5xx the load balancer generates, HTTPCode_ELB_5XX_Count has only load balancer and zone dimensions and is reported only when nonzero, and RequestCount counts only requests for which a target was chosen. Each API therefore has its own load balancer.',
      'An instance refresh uses MinHealthyPercentage and MaxHealthyPercentage; with no maintenance policy they default to 90% and 100%, so this design sets them. It moves on once a new instance is healthy and its instance warmup has passed, so the warmup and the launch hook are what keep it from counting a node that has not loaded its index.',
      'A launch lifecycle hook holds an instance in Pending:Wait for one hour by default, and the group registers it with the load balancer only after the hook completes. A newly registered target receives traffic after its first passing health check.',
      'With acks=all the leader waits for every in-sync replica, and a write is refused when fewer than min.insync.replicas are in sync. A topic with log append time has each record’s timestamp set by the broker at the append, which is what a lookup of offsets by time uses.',
      'ElastiCache metrics are per node. For nodes with more than 2 vCPUs EngineCPUUtilization is the one to watch. Replication to replicas is asynchronous, so a failover can lose the last writes, and failover events are delivered through SNS.',
      'Amazon S3 returns a stored object to any read or listing that starts after the write was acknowledged, and supports at least 3,500 writes and 11,000 reads a second per prefix.',
      'EventBridge Scheduler starts its targets with 60-second precision.',
      'A CloudWatch alarm reads more data points than its evaluation periods. For an alarm that needs every point to breach and treats missing data as breaching, silence fires it only once the last real point has left that range; an M-of-N alarm can fire sooner, because filled points count toward its M. Those delays are written here as a few minutes.',
      'CloudWatch treats data points published with the same namespace, name and dimensions by many sources as one metric, so the Maximum statistic of a node metric with no dimensions is the largest value any node published in the period. That is why IndexAge, SnapshotAgeHours, IndexDriftPlaces, IndexReloadAgeHours and RecordsSkipped are published without a node dimension: each alarm reads one series and needs no metric math across nodes.',
    ],
  },
  slos: [
    {
      objective: 'Searches and details reads',
      target: '99.9% answered within 150 ms and without a 5xx, over 28 days',
      measure:
        'On the search load balancer: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount for errors, and TargetResponseTime for latency. Absent 5XX counts are read as zero; the ratio is missing only when RequestCount is, and such a minute counts as failed. The usual p95 is 25 ms for a search.',
    },
    {
      objective: 'Owner writes',
      target: '99.9% answered within 300 ms and without a 5xx, over 28 days',
      measure:
        'The same two measures on the Place API’s load balancer, with the same rules for absent and missing data. A 412 is the owner’s conflict, not a failure.',
    },
    {
      objective: 'Index freshness',
      target: 'In 99.5% of minutes the index is at most 60 s behind the table, over 28 days',
      measure:
        'IndexAge: now minus the write time of the newest heartbeat a node has applied, taken on each partition, the largest over its 12 partitions published every 10 seconds by every node in rotation into one metric with no dimensions. A minute is good when the Maximum statistic of that metric, the oldest partition on any node, is at most 60 s; a minute with no data counts as missed. The usual value is 2 to 8 s.',
    },
  ],
  alarms: [
    {
      name: 'Search errors',
      metric:
        'On the search ALB, over 5-minute windows: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount above 0.04% in 2 of the last 3 windows, or the same ratio above 0.05% over a 6-hour period, with absent 5XX counts read as zero and a missing ratio counted as breaching; or p99.96 TargetResponseTime above 120 ms in one window',
      meaning:
        'Searches or details reads are failing or slow: too few nodes, the scan limit set too high, or the cache and the table both slow. The fast clause pages on a burst of errors that lasts, and asking for 2 of 3 windows almost always keeps one node crash from paging: it fails searches for about 15 seconds, about 30,000 requests and 0.33% of one window, about 0.003% of a day’s reads. 0.04% of a window is about 3,600 requests, 1.8 seconds of that node’s traffic, so a crash that straddles a window boundary with more than 1.8 seconds on each side, about 4% of crashes, does page. Single bad windows that the fast clause lets pass are caught by the slow clause, which pages whenever 6 hours average more than 0.05% errors. Without a page, errors stay at or under 0.05% and slow answers under 0.04%, together inside the 0.1% the objective allows, and 120 ms is tighter than 150. Planned exits do not fail requests: the group deregisters a node and waits the 30-second delay before it terminates it.',
    },
    {
      name: 'Owner write errors',
      metric:
        'On the Place API ALB, over 5 minutes: the same ratio above 0.04% with the same rules while RequestCount is at least 2,500, or p99.96 TargetResponseTime above 250 ms',
      meaning:
        'Owners cannot save: tasks are down or the table refuses or throttles writes. 250 ms is tighter than the 300 ms target. The minimum count matters only below 2,500 requests in 5 minutes, where a single 5xx would pass 0.04%; in the usual few thousand one 5xx stays under the threshold anyway. A missing ratio still counts as breaching. The quietest hours still carry about 10 writes a second, about 3,000 in 5 minutes, so the ratio clause is on except in an unusual lull, when the latency clause still watches.',
    },
    {
      name: 'Index stale',
      metric:
        'Custom, from the search nodes: the Maximum statistic of IndexAge, one metric with no dimensions that every node in rotation publishes into, above 30 s for 5 consecutive 1-minute periods, or above 60 s in 7 of the last 1,440 1-minute periods; missing data counts as breaching',
      meaning:
        'Edits are not reaching the nodes: the relay, the log or the stream is stalled, or every node is behind. The first clause pages on a stall that lasts. The second catches repeated short ones: it allows 6 missed minutes a day, at most 168 in 28 days, inside the 201 the objective allows. The nodes publish it, so a dead relay cannot silence it. The objective counts a silent minute as missed, but the second clause can absorb a few silent minutes in its evaluation range; a fleet that stops publishing is caught by the first clause, with missing data as breaching, a few minutes later. It returns to OK once the age is back under 30 s and fewer than 7 bad minutes remain in the last day.',
    },
    {
      name: 'Relay behind',
      metric:
        'Lambda IteratorAge Maximum for the relay above 60 s for 5 consecutive 1-minute periods; missing data counts as breaching',
      meaning:
        'The relay is failing a batch again and again or cannot keep up, and the shard waits behind it. Heartbeats put a record in the stream every few hundred milliseconds, so silence means the relay is not running. It pages about a day before records could leave the stream, and returns to OK once the age is under 60 s.',
    },
    {
      name: 'Search nodes short',
      metric:
        'HealthyHostCount summed over zones for the search target group below 12 for 5 consecutive 1-minute periods; missing data counts as breaching',
      meaning:
        'More than 3 nodes are out of rotation. 12 leaves two nodes of margin over the 10 the peak needs, the room a node behind its log and one failure normally take; a deploy launches before it terminates and does not lower the count; below 12, two more failures put the peak above the plan. The load balancer publishes it, so it works with every node dead. It returns to OK once 12 or more are healthy again.',
    },
    {
      name: 'Log unhealthy',
      metric:
        'MSK UnderMinIsrPartitionCount above 0 or OfflinePartitionsCount above 0 for 2 minutes, or KafkaDataLogsDiskUsed above 70% on any broker; both per-broker metrics, UnderMinIsrPartitionCount and KafkaDataLogsDiskUsed, are read as a metric-math maximum over the three brokers, so one dead broker’s missing series does not fire it; missing data counts as breaching',
      meaning:
        'Some partitions refuse writes, so the relay stalls on them, or a disk is filling. One broker down does not fire it; a second one does. It returns to OK a few minutes after every partition is back in sync and every disk is below 70%.',
    },
    {
      name: 'Snapshot old',
      metric:
        'Custom, from the search nodes: the Maximum statistic of SnapshotAgeHours, one metric with no dimensions, above 16 for 15 consecutive 1-minute periods; missing data counts as breaching',
      meaning:
        'Two scheduled runs in a row published nothing: the export is slow, the builder fails, or the schedule is off. The newest snapshot normally reaches about 9 hours of age, 6 hours between runs plus up to 3 of build and the 15 minutes of export lag, and one missed run about 15. Nodes can still start from an older snapshot for up to 7 days. It returns to OK a few minutes after a new manifest appears.',
    },
    {
      name: 'Index drift',
      metric:
        'Custom, from the search nodes, each one metric with no dimensions read with the Maximum statistic: IndexDriftPlaces above 0 in a 1-hour period, or IndexReloadAgeHours above 30; missing data counts as not breaching',
      meaning:
        'A daily reload found places the live index had wrong, which the reload has already repaired; a record still inside a reload’s replay window is reproduced rather than found, so drift can show only on a later reload. The second clause sees reloads that stopped: each node publishes the hours since its last successful reload. A ticket, not a page. It returns to OK after an hour in which no reload reported a difference and every node has reloaded within 30 hours.',
    },
    {
      name: 'Records skipped',
      metric:
        'Custom, from the search nodes: Sum of RecordsSkipped, one metric with no dimensions, above 0 in a 5-minute period; missing data counts as not breaching',
      meaning:
        'A change record made apply throw or hang and was skipped, so its place is wrong on the nodes that skipped it until their first reload from a snapshot exported after it, up to about a day and a half. A ticket, not a page: the record and the code are a bug to fix. It returns to OK after a 5-minute period with no skip.',
    },
    {
      name: 'Table reads throttled',
      metric:
        'DynamoDB ReadThrottleEvents on the place table (TableName), read as FILL(ReadThrottleEvents, 0) through metric math so that a minute without throttles is a 0, above 0 in 3 of 5 1-minute periods',
      meaning:
        'Cache misses exceed what the table was warmed for, usually after a cache flush or failover. ReadThrottleEvents counts each throttled item of a BatchGetItem, which ThrottledRequests would count only if every item of the batch were throttled. Nodes cap their reads, so users see partial answers, not errors. It returns to OK when a few minutes pass without throttles.',
    },
  ],
  evolution: {
    mvp: 'One search service with the whole index in memory on 3 nodes, a fixed cell length per radius, and reads of details straight from the table. Present from day one because they are hard to add once data exists: the version on every place, deletes as tombstones, the table’s stream as the only path to the index, and a rebuild from an export. Left out at first: the category map, the scan limit, widening, the details cache and the daily drift comparison.',
    atScale: [
      'At 10x searches (250,000 a second at peak), the fleet grows to about 150 nodes, 100 for the peak and half again for a zone, and the cache to many more shards. Edge caching of popular areas becomes worth its staleness for anonymous first pages.',
      'At 2x places (about 200 million), the double copy during a reload, about 61 GB, no longer fits comfortably in 64 GiB. The index is split by cell range into shards, each with its own replicated set of nodes, and a router sends a search to the shards its block touches.',
      'At 10x owner writes, the change log stays small, but the 10x search fleet of about 150 nodes, each applying every change and each a reader of the log, becomes the cost; shards help here too, since a node applies only its range.',
      'At 100x, one Region is too far from most users. Each Region runs its own table replica, relay, log and nodes, and an edit reaches other Regions through table replication with its version intact.',
    ],
    firstBottleneck:
      'Hydration. 505,000 cache lookups a second at peak dwarf the index work, and the table behind the cache sees every point of hit rate lost. The second is the memory of a node: the full copy is attractive exactly until a second copy during a reload stops fitting.',
    avoided: [
      'A results cache by area. A search is under a millisecond of index work, and a cached page would be stale and, for a point near a cell edge, wrong. Worth adding at the edge for anonymous first pages at 10x traffic.',
      'Sharding the index. 16 GB fits in a node, and a full copy has no hot shards. Worth adding near 200 million places.',
      'A quadtree or cube-face cells. Growing geohash blocks handle density, and integer neighbours handle the antimeridian and the poles. Worth revisiting for polygons and areas.',
      'A search engine cluster. Geo plus one category does not need it. Worth adding with text search.',
      'Publishing changes from the API. It is a dual write. The table’s stream is the only path.',
      'Deltas with sequence numbers. Full state with a version makes gaps harmless instead of fatal.',
      'A pause or a consistent cut for snapshots. The overlapping replay makes them unnecessary.',
      'A verifier that samples places against every node. The daily reload compares everything, for free.',
    ],
  },
};
