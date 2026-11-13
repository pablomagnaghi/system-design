import type { Design } from '../types';

export const proximitySearch: Design = {
  slug: 'proximity-search',
  title: 'Proximity search for places',
  summary:
    'Find the places near a point in tens of milliseconds: a geohash index small enough to keep in memory on every search node, an exact distance filter on a handful of candidates, and owner edits streamed into the index within minutes.',
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Users search for places near a location, within a radius, optionally by category.',
      'Users open a place to see its details.',
      'Owners add, update and remove their places.',
    ],
    nonFunctional: [
      'Search answers in under about 200 ms.',
      'Read heavy: searches outnumber edits by a hundred to one or more.',
      'Scale to around a hundred million places and hundreds of millions of searches a day.',
      'Edits can take a few minutes to appear in search.',
    ],
    outOfScope: [
      'Reviews, ratings and personalized ranking.',
      'Directions and travel time to each place.',
    ],
  },
  entities: [
    {
      name: 'Place',
      description: 'Name, category, address, coordinates and owner.',
    },
    {
      name: 'Geo cell',
      description: 'A geohash prefix: a rectangle on the map that groups the places inside it.',
    },
    { name: 'Category', description: 'A type of place used as a search filter.' },
    { name: 'Owner', description: 'The account allowed to edit a place.' },
  ],
  api: [
    {
      method: 'GET',
      path: '/places?lat=…&lng=…&radius=…&category=…',
      description: 'Places within the radius, nearest first, with a cursor for the next page.',
    },
    {
      method: 'GET',
      path: '/places/{id}',
      description: 'The details of one place.',
    },
    {
      method: 'POST',
      path: '/places',
      description: 'Owners create a place; PATCH and DELETE on /places/{id} update or remove it.',
    },
  ],
  dataFlow: [
    'The user sends a point and a radius; popular areas are answered from a cache.',
    'The search service reads the geohash cells that cover the circle from an in-memory index.',
    'Candidates are filtered by exact distance and category, sorted, and hydrated with details.',
    'Owner edits go to the place database and reach the index through a change stream.',
  ],
  highLevel: {
    label: 'Search for places nearby',
    intro:
      'Follow one search from a point on the map to a sorted list of places, then follow an owner edit until it shows up in results. Press play, or step through the stages.',
    nodes: [
      { id: 'user', title: 'User', detail: 'Point and radius', column: 0, row: 'middle' },
      { id: 'owner', title: 'Owner', detail: 'Edits a place', column: 0, row: 'bottom' },
      { id: 'cache', title: 'Results cache', detail: 'By cell and filter', column: 1, row: 'top' },
      { id: 'api', title: 'Search API', detail: 'Stateless', column: 1, row: 'middle' },
      { id: 'writes', title: 'Place API', detail: 'Owner writes', column: 1, row: 'bottom' },
      { id: 'geo', title: 'Geo index', detail: 'Geohash, in memory', column: 2, row: 'middle' },
      { id: 'db', title: 'Place database', detail: 'Source of truth', column: 2, row: 'bottom' },
      {
        id: 'filter',
        title: 'Filter and sort',
        detail: 'Exact distance',
        column: 3,
        row: 'middle',
      },
      { id: 'cdc', title: 'Change stream', detail: 'From the database', column: 3, row: 'bottom' },
      {
        id: 'details',
        title: 'Details cache',
        detail: 'Hydrate results',
        column: 4,
        row: 'middle',
      },
    ],
    edges: [
      ['user', 'api'],
      ['api', 'cache', 'popular areas'],
      ['api', 'geo', 'cells'],
      ['geo', 'filter', 'candidates'],
      ['filter', 'details'],
      ['owner', 'writes'],
      ['writes', 'db'],
      ['db', 'cdc'],
      ['cdc', 'geo', 'update cells'],
      ['cdc', 'details', 'invalidate'],
    ],
    stages: [
      {
        title: 'Search near a point',
        narration:
          'The user sends a latitude, a longitude, a radius and maybe a category. The search API is stateless and sits behind a load balancer.',
        tradeoff:
          'Keeping the API stateless lets it scale by adding copies, at the cost of looking everything up on each request. With reads this cheap, that is the right trade.',
        nodes: ['user', 'api'],
        travel: [['user', 'api']],
      },
      {
        title: 'Cache popular areas',
        narration:
          'The point is rounded to a geo cell, and the cell, radius and category form a cache key. City centers and common searches are answered without touching the index.',
        tradeoff:
          'Rounding the point means nearby users share a cache entry, which raises the hit rate a lot. The cost is that results are for the cell, not the exact point, so the final distance sort still runs on the user point.',
        nodes: ['api', 'cache'],
        travel: [['api', 'cache', 'popular areas']],
      },
      {
        title: 'Cover the circle with cells',
        narration:
          'On a miss, the service picks a geohash length whose cells are about the size of the radius, and reads the cell of the point plus its eight neighbors. Each cell lists the places inside it.',
        tradeoff:
          'Reading only the cell of the point misses places just across its edge. Adding the neighbors fixes that at the cost of reading nine cells, which is still a handful of lookups in memory.',
        nodes: ['api', 'geo'],
        travel: [['api', 'geo', 'cells']],
      },
      {
        title: 'Filter by exact distance',
        narration:
          'The cells return candidates with their coordinates. The service drops those outside the real circle or in the wrong category, then sorts by distance.',
        tradeoff:
          'Cells are squares and the search is a circle, so cells alone return extra places. Computing the exact distance on a few hundred candidates is cheap, and keeps the index simple instead of trying to make it exact.',
        nodes: ['geo', 'filter'],
        travel: [['geo', 'filter', 'candidates']],
      },
      {
        title: 'Hydrate the results',
        narration:
          'The top results are filled in with names, addresses and photos from a details cache backed by the place database.',
        tradeoff:
          'Storing all details in the index would avoid this step, but would make the index too large to keep in memory everywhere. Keeping the index lean (id, coordinates, category) and hydrating only one page of results gives the best of both.',
        nodes: ['filter', 'details'],
        travel: [['filter', 'details']],
      },
      {
        title: 'An owner edits a place',
        narration:
          'An owner moves a place or changes its category. The write goes to the place database, the source of truth, with normal validation and authorization.',
        tradeoff:
          'Writing to the index directly would make edits visible sooner but create two sources of truth that drift. One database as the only writer keeps things correct; the index is derived from it and can always be rebuilt.',
        nodes: ['owner', 'writes', 'db'],
        travel: [
          ['owner', 'writes'],
          ['writes', 'db'],
        ],
      },
      {
        title: 'Stream changes into the index',
        narration:
          'A change stream from the database feeds every search node, which moves the place from its old cell to its new one.',
        tradeoff:
          'Rebuilding the whole index on a schedule is simpler but makes edits wait hours. Streaming changes keeps the delay to seconds or minutes, at the cost of handling missed or reordered events, which a periodic full rebuild also covers.',
        nodes: ['db', 'cdc', 'geo'],
        travel: [
          ['db', 'cdc'],
          ['cdc', 'geo', 'update cells'],
        ],
      },
      {
        title: 'Invalidate stale details',
        narration:
          'The same change stream removes the edited place from the details cache, so the next search reads it fresh.',
        tradeoff:
          'A short time to live alone would serve old details for its whole length. Invalidating on change is more precise, and the time to live remains as a safety net if an event is lost.',
        nodes: ['cdc', 'details'],
        travel: [['cdc', 'details', 'invalidate']],
      },
      {
        title: 'Dense cities and empty countryside',
        narration:
          'In a dense center the nine cells hold thousands of places; in the countryside they may hold none. The service shortens the cells and caps candidates in dense areas, and widens the search step by step where results are few.',
        tradeoff:
          'A fixed cell size is easy but wrong at both extremes. Adapting the cell length per query costs a little logic and keeps both cases fast and useful; a tree that splits by density is the heavier alternative if this is not enough.',
        nodes: ['api', 'geo'],
        travel: [['api', 'geo', 'cells']],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we index places by location?',
      options: [
        {
          name: 'Index on latitude and longitude',
          pros: 'No new concepts; any database does it.',
          cons: 'It can only use one column efficiently, so it scans a wide band of the map.',
        },
        {
          name: 'Geohash',
          pros: 'Turns two dimensions into one sortable string; nearby means a shared prefix.',
          cons: 'Fixed grid: neighbors must be read, and density varies a lot between cells.',
        },
        {
          name: 'Quadtree',
          pros: 'Splits cells by density, so every leaf holds a similar number of places.',
          cons: 'More complex to build and to update when places move.',
        },
      ],
      choice:
        'Geohash, with neighbor cells and a precision chosen from the radius. It is simple, easy to update incrementally, and good enough with adaptive cell length.',
    },
    {
      question: 'Where does the index live?',
      options: [
        {
          name: 'Spatial index inside the main database',
          pros: 'One system, always consistent.',
          cons: 'Search load competes with writes, and scaling reads means more database replicas.',
        },
        {
          name: 'A search engine with geo queries',
          pros: 'Geo, text and filters in one query.',
          cons: 'Another cluster to run, larger than this problem needs.',
        },
        {
          name: 'Full copy in memory on every search node',
          pros: 'Fastest possible reads; scale by adding nodes.',
          cons: 'Only works while the index fits in memory, and every node must receive every change.',
        },
      ],
      choice:
        'A full copy in memory on every node. A hundred million places with id, coordinates and category is a few gigabytes, which fits, so no sharding is needed.',
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
          name: 'Widen the radius step by step',
          pros: 'Useful results almost everywhere.',
          cons: 'Several lookups for sparse areas, and results may be farther than asked.',
        },
      ],
      choice:
        'Widen the search in steps up to a limit, and tell the user the results are farther than the requested radius.',
    },
  ],
  wrapUp:
    'A lean geohash index in memory on every node finds candidates, an exact distance check sorts them, a details cache fills them in, and a change stream keeps the index a few minutes behind the database at most.',
};
