import type { FieldNote } from '../types';

export const spotifyDataLake: FieldNote = {
  slug: 'spotify-data-lake',
  company: 'Spotify',
  title: 'Point queries straight from the data lake',
  summary:
    'Spotify keeps exabytes of event data as Parquet files in its lake, built for batch analytics. An external index from key to file and row lets online services and AI agents fetch one user’s data with a few parallel reads, without copying it into a key-value store.',
  minutes: 8,
  source: {
    title: 'Indexing the Data Lake for Online Point Queries',
    url: 'https://engineering.atspotify.com/2026/7/indexing-the-data-lake-for-online-point-queries',
    year: 2026,
  },
  context: [
    'Spotify collects events from its apps and services through an event delivery pipeline on Google Cloud. A 2019 post on that pipeline describes a front service that checks each event and publishes it to Pub/Sub, one stream per event type, and an ETL that writes immutable hourly buckets to Cloud Storage for BigQuery and other batch tools. At the end of Q1 2019 that pipeline peaked at more than 8M events per second.',
    'Event data such as listening history ends up in the data lake, and the lake is huge. According to the 2026 post, petabytes live in Bigtable for online use, but exabytes sit in the Cloud Storage lake as Parquet files shared by ML pipelines, notebooks and batch analytics. Keeping everything in a key-value store costs too much per GB, so teams had to choose which data was worth serving online.',
    'Online services and AI agents need the opposite of a batch scan: one user’s rows, fast. Storage was not the slow part, since a Cloud Storage request takes 30 to 100 ms. The slow parts were the SQL engines, which add seconds of scheduling and planning even for one row, and the chain of dependent reads needed to find a key inside a big Parquet file.',
  ],
  walkthrough: {
    label: 'Serve point queries from the lake',
    intro:
      'Start with events flowing into the lake and online reads served from a key-value store, then watch an external index and a direct reader join. Metric values are quoted from Spotify’s posts (the latency slot shows the per-request figures the post gives, not a measured p95). Load bars are approximate. Press play, or step through the stages.',
    nodes: [
      {
        id: 'clients',
        title: 'Apps and services',
        detail: 'Emit events',
        column: 0,
        row: 'middle',
      },
      {
        id: 'delivery',
        title: 'Event delivery',
        detail: 'Pub/Sub, hourly buckets',
        column: 1,
        row: 'middle',
      },
      {
        id: 'lake',
        title: 'Data lake',
        detail: 'Parquet on Cloud Storage',
        column: 2,
        row: 'middle',
      },
      {
        id: 'builder',
        title: 'Index builder',
        detail: 'Runs with each pipeline',
        column: 2,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'index',
        title: 'External index',
        detail: 'Key to file and rows',
        column: 3,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'reader',
        title: 'Lake reader',
        detail: 'Parallel ranged reads',
        column: 3,
        row: 'middle',
        appearsAt: 5,
      },
      {
        id: 'sql',
        title: 'SQL engine',
        detail: 'Trino, BigQuery',
        column: 3,
        row: 'bottom',
      },
      {
        id: 'meta',
        title: 'Metadata cache',
        detail: 'Footers, page offsets',
        column: 4,
        row: 'top',
        appearsAt: 5,
      },
      {
        id: 'app',
        title: 'Service or agent',
        detail: 'Needs one user’s data',
        column: 5,
        row: 'middle',
      },
      {
        id: 'kv',
        title: 'Bigtable',
        detail: 'Hot data only',
        column: 5,
        row: 'top',
      },
    ],
    edges: [
      ['clients', 'delivery', 'events'],
      ['delivery', 'lake', 'files'],
      ['app', 'kv', 'hot keys'],
      ['app', 'sql', 'SQL'],
      ['sql', 'lake', 'scan'],
      ['lake', 'builder', 'footers'],
      ['builder', 'index', 'append'],
      ['app', 'reader', 'lookup'],
      ['reader', 'index', 'key'],
      ['reader', 'meta', 'pages'],
      ['reader', 'lake', 'ranged reads'],
    ],
    stages: [
      {
        title: 'Events land in the lake',
        narration:
          'Apps and backend services send events to the delivery pipeline, which keeps each event type in its own stream and closes immutable hourly buckets on Cloud Storage. Data like listening history ends up in the lake as large daily Parquet files that analysts, notebooks and ML pipelines all share.',
        tradeoff:
          'Big, columnar, append-only files are cheap to store and fast to scan in bulk. The same layout makes it slow to pull out one user’s handful of rows, because nothing tells you where those rows are.',
        nodes: ['clients', 'delivery', 'lake'],
        travel: [
          ['clients', 'delivery'],
          ['delivery', 'lake'],
        ],
        short: 'Events in',
        metrics: { requestsPerSecond: '8M+ events' },
        load: { clients: 40, delivery: 60, lake: 30 },
        traffic: [{ edge: ['clients', 'delivery'], kind: 'heavy' }],
      },
      {
        title: 'Online reads need a key-value store',
        narration:
          'A service that shows a user’s history reads from Bigtable, which answers lookups by key quickly. Only a selected slice of the data is copied there: petabytes in Bigtable, against exabytes in the lake.',
        tradeoff:
          'A key-value store gives fast lookups, but it is a second copy with its own storage bill and pipeline. The per-GB cost forces teams to pick what deserves to be online, so older history and long-tail data stay out of reach.',
        nodes: ['app', 'kv'],
        travel: [['app', 'kv']],
        short: 'KV copy',
        load: { app: 30, kv: 70 },
      },
      {
        title: 'Ask the lake through SQL',
        narration:
          'For anything not in Bigtable, the service could query the lake through Trino or BigQuery. Even a single-row lookup pays for job scheduling and query planning before any file is read, which costs seconds.',
        tradeoff:
          'A distributed SQL engine handles any question over the whole lake, which is right for analytics. For an interactive point query, its fixed startup cost is far larger than the storage reads themselves.',
        nodes: ['app', 'sql', 'lake'],
        travel: [
          ['app', 'sql'],
          ['sql', 'lake'],
        ],
        short: 'SQL lookup',
        metrics: { p95Latency: 'Seconds', alerts: ['p95Latency'] },
        load: { app: 30, sql: 95, lake: 45 },
        traffic: [{ edge: ['sql', 'lake'], kind: 'heavy' }],
      },
      {
        title: 'Pruning picks files, not rows',
        narration:
          'Splitting each day into buckets by key, plus Bloom filters cached outside the files, cuts the candidate files to a few. Inside each file the reader still walks a chain: read the footer, parse row group metadata, scan the key column, then use page indexes to find the value pages. Each step waits for the one before.',
        tradeoff:
          'File pruning is standard and cheap, and it helps any engine. It does nothing for the work inside a file, where every dependent round trip to cloud storage costs tens of milliseconds and competes for IOPS with other queries.',
        nodes: ['sql', 'lake'],
        travel: [['sql', 'lake']],
        short: 'Read chain',
        metrics: { p95Latency: 'Seconds', alerts: ['p95Latency'] },
        load: { sql: 90, lake: 70 },
        traffic: [{ edge: ['sql', 'lake'], kind: 'failed' }],
      },
      {
        title: 'Build an external index',
        narration:
          'An index builder reads the footers and page locations of the columns to serve, scans the key columns and writes entries of key, file and row numbers, with an optional value count for paging. Each pipeline run appends a new fragment instead of rewriting old ones.',
        tradeoff:
          'The index is exact, unlike Bloom filters, so a lookup never scans. It is one more artifact to build and keep in sync with the files, though small: the post’s rule of thumb is gigabytes of index per terabytes of data.',
        nodes: ['lake', 'builder', 'index'],
        travel: [
          ['lake', 'builder'],
          ['builder', 'index'],
        ],
        short: 'Index',
        metrics: { p95Latency: 'Seconds', alerts: ['p95Latency'] },
        load: { lake: 40, builder: 60, index: 30, sql: 90 },
      },
      {
        title: 'Look up, then read in parallel',
        narration:
          'The new reader looks the key up in the index, maps row numbers to page offsets with cached file metadata, and fires ranged reads for exactly those pages, all at once. No SQL engine sits in the path, and no read waits for another, so the query costs about one storage round trip.',
        tradeoff:
          'Dropping the engine removes seconds of overhead, but the reader only answers lookups by indexed key. On files written the usual way it still fetches whole pages, which the post says can mean a 4 MB page to return 100 bytes.',
        nodes: ['app', 'reader', 'index', 'meta', 'lake'],
        travel: [
          ['app', 'reader'],
          ['reader', 'index'],
          ['reader', 'meta'],
          ['reader', 'lake'],
        ],
        short: 'Direct read',
        metrics: { p95Latency: '30–100 ms' },
        load: { app: 30, reader: 45, index: 30, meta: 25, lake: 40, sql: 20 },
        traffic: [{ edge: ['reader', 'lake'], kind: 'request' }],
      },
      {
        title: 'Write files with lookups in mind',
        narration:
          'Pipelines sort or hash-bucket by key so a key’s rows sit together. The writer can start a new page, or a new ZSTD frame, at each key boundary, so the index can point at the exact bytes. The files stay standard Parquet that every other reader understands.',
        tradeoff:
          'Reads get small and precise. The cost is in the writer: one page per key adds roughly 20 bytes of header per key, and per-key frames rule out delta and run-length encodings, which can make some columns larger.',
        nodes: ['lake', 'builder', 'index'],
        travel: [
          ['lake', 'builder'],
          ['builder', 'index'],
        ],
        short: 'Prepared files',
        metrics: { p95Latency: '30–100 ms' },
        load: { lake: 35, builder: 55, index: 30 },
      },
      {
        title: 'Cut the reads to one, or none',
        narration:
          'Fields read together can live in one blob or variant column, or be interleaved so all of a key’s columns sit side by side in one byte range. Small values and per-key aggregates can be copied into the index itself, so the lookup answers without touching storage.',
        tradeoff:
          'Fewer reads per key is the biggest win, but each trick shifts cost to analytics: a blob loses per-field pruning, interleaving makes single-column scans read extra bytes, and hoisted values grow the index.',
        nodes: ['app', 'reader', 'index'],
        travel: [
          ['app', 'reader'],
          ['reader', 'index'],
        ],
        short: 'One read',
        metrics: { p95Latency: '30–100 ms' },
        load: { app: 30, reader: 35, index: 40, lake: 20 },
      },
      {
        title: 'One copy, two access patterns',
        narration:
          'BigQuery keeps scanning the same files for reports while services and agents read single keys through the index. Extra lookup dimensions get their own secondary index over the same entries, added or dropped without rewriting any data.',
        tradeoff:
          'There is no second store, ETL or storage bill, so history and long-tail data become cheap to serve online. The layout still favors the key the files were sorted by, so lookups on other keys touch more files.',
        nodes: ['sql', 'lake', 'reader', 'index'],
        travel: [
          ['sql', 'lake'],
          ['reader', 'lake'],
        ],
        short: 'Shared lake',
        metrics: { p95Latency: '30–100 ms' },
        load: { sql: 50, lake: 45, reader: 40, index: 30, kv: 40 },
      },
    ],
  },
  tradeoffs: [
    'The index is a new artifact every pipeline must produce and keep consistent with the files it points at.',
    'The best results need write-time changes (sorting, per-key pages or frames, blobs, interleaving), and each one gives up something for batch readers.',
    'Lookups are fast only on indexed keys; other dimensions need secondary indexes and may scatter across more files.',
    'A point query still pays a cloud storage round trip unless the value is hoisted into the index, so a key-value store remains faster for the hottest data.',
  ],
  takeaways: [
    'When a lookup is slow, list the dependent round trips. Replacing a chain of reads with one precomputed lookup and parallel reads helps on any storage tier.',
    'An exact external index (key to file and offset) lets cheap object storage answer point queries, so not every online read needs a copy in a database.',
    'Layout decides read cost: sort or bucket by key, keep a key’s data contiguous, and store what is read together, together.',
    'Weigh each storage change against both workloads; a choice that speeds lookups often slows scans.',
  ],
  related: ['ad-click-aggregator', 'metrics-monitoring'],
};
