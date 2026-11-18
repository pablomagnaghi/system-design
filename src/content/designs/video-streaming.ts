import type { Design } from '../types';

export const videoStreaming: Design = {
  slug: 'video-streaming',
  title: 'Video upload and streaming',
  summary:
    'Let creators upload large video files reliably, turn each one into many qualities in minutes, and let viewers anywhere start playing in a couple of seconds and keep playing smoothly as their connection changes.',
  difficulty: 'Hard',
  minutes: 10,
  requirements: {
    functional: [
      'Upload videos of up to several gigabytes, resuming after a dropped connection.',
      'Process each upload into several resolutions and bitrates for phones, laptops and TVs.',
      'Play a video with quality that adapts to the viewer’s bandwidth.',
      'Show title, description and processing status for each video.',
    ],
    nonFunctional: [
      'Playback starts in about two seconds and rarely stalls.',
      'Views outnumber uploads by thousands to one (about 4 billion plays and 2 million uploads a day); popular videos are watched millions of times.',
      'Originals are not lost once an upload completes: complete is acknowledged only after storage holds the assembled file in several zones.',
      'A typical upload is ready to watch within minutes.',
    ],
    outOfScope: ['Live streaming.', 'Recommendations, search and comments.'],
  },
  entities: [
    {
      name: 'Video',
      description: 'ID, owner, title, status (uploading, processing, ready, failed) and duration.',
    },
    {
      name: 'Upload',
      description: 'A multipart upload session: the parts received so far and their checksums.',
    },
    {
      name: 'Rendition',
      description: 'One resolution and bitrate of a video, cut into segments of a few seconds.',
    },
    {
      name: 'Manifest',
      description: 'The playlist that lists every rendition and the URLs of its segments.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/videos',
      description: 'Creates the video record and returns signed URLs for uploading parts.',
    },
    {
      method: 'POST',
      path: '/videos/{id}/complete',
      description: 'Finishes the multipart upload and starts processing.',
    },
    {
      method: 'GET',
      path: '/videos/{id}',
      description: 'Metadata, status and, once ready, the manifest URL for the player.',
    },
  ],
  dataFlow: [
    'The creator asks the API for an upload and sends parts straight to object storage with signed URLs.',
    'Completing the upload queues a processing job that splits the video and transcodes the pieces in parallel.',
    'A packager writes segments and manifests to storage and marks the video ready.',
    'Viewers get the manifest URL from the API and stream segments from a CDN, switching quality as bandwidth changes.',
  ],
  highLevel: {
    label: 'Upload a video, then watch it',
    intro:
      'Follow a video from the creator’s laptop through storage and the processing pipeline as each part joins, then follow a viewer pressing play, watch every play hit storage, and see a CDN take the load. Numbers are illustrative. Press play, or step through the stages.',
    lanes: { top: 'Upload and processing', bottom: 'Playback' },
    nodes: [
      { id: 'creator', title: 'Creator', detail: 'Uploads a file', column: 0, row: 'top' },
      { id: 'raw', title: 'Raw storage', detail: 'Original files', column: 1, row: 'top' },
      {
        id: 'queue',
        title: 'Job queue',
        detail: 'Processing jobs',
        column: 2,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'transcode',
        title: 'Transcoders',
        detail: 'Chunks in parallel',
        column: 3,
        row: 'top',
        appearsAt: 3,
      },
      {
        id: 'packager',
        title: 'Packager',
        detail: 'Segments, manifests',
        column: 4,
        row: 'top',
        appearsAt: 4,
      },
      { id: 'api', title: 'Video API', detail: 'Uploads, metadata', column: 1, row: 'middle' },
      { id: 'meta', title: 'Metadata DB', detail: 'Videos, status', column: 3, row: 'middle' },
      {
        id: 'segments',
        title: 'Segment storage',
        detail: 'Every rendition',
        column: 4,
        row: 'middle',
        appearsAt: 4,
      },
      {
        id: 'viewer',
        title: 'Viewer',
        detail: 'Adaptive player',
        column: 0,
        row: 'bottom',
        appearsAt: 6,
      },
      {
        id: 'cdn',
        title: 'CDN',
        detail: 'Edge caches',
        column: 4,
        row: 'bottom',
        appearsAt: 8,
      },
    ],
    edges: [
      ['creator', 'api', 'start'],
      ['api', 'meta'],
      ['creator', 'raw', 'parts'],
      ['raw', 'queue', 'complete'],
      ['queue', 'transcode'],
      ['transcode', 'packager'],
      ['packager', 'segments'],
      ['packager', 'meta', 'ready'],
      ['viewer', 'api', 'metadata'],
      ['viewer', 'cdn', 'segments'],
      ['cdn', 'segments', 'miss'],
    ],
    stages: [
      {
        title: 'Start an upload',
        narration:
          'The creator’s app asks the video API for an upload. The API creates a video record with status "uploading", starts a multipart upload in object storage and returns a signed URL for each part.',
        tradeoff:
          'Signed URLs let the file bypass our servers entirely, so API servers never hold gigabytes in memory or tie up connections for minutes. The cost is that the API must trust storage events to know what arrived, and the URLs must expire quickly.',
        nodes: ['creator', 'api', 'meta'],
        travel: [
          ['creator', 'api', 'start'],
          ['api', 'meta'],
        ],
        short: 'Start upload',
        metrics: { users: '20M', requestsPerSecond: '2K', p95Latency: '120 ms', errorRate: '0%' },
        load: { api: 15, meta: 10 },
      },
      {
        title: 'Send parts straight to storage',
        narration:
          'The app splits the file into parts of a few megabytes and uploads several at a time, each with a checksum. A failed part is retried on its own; after a dropped connection the app asks which parts already arrived.',
        tradeoff:
          'Parts make a multi-gigabyte upload resumable and parallel, so a flaky connection costs one part rather than the whole file. The price is more client logic and parts to clean up when an upload is abandoned, which a lifecycle rule handles.',
        nodes: ['creator', 'raw'],
        travel: [['creator', 'raw', 'parts']],
        short: 'Upload parts',
        metrics: { users: '20M', requestsPerSecond: '2K', p95Latency: '120 ms', errorRate: '0%' },
        load: { raw: 40 },
      },
      {
        title: 'Complete and queue processing',
        narration:
          'When every part is in, the app calls complete with the list of parts and their checksums. The API asks storage to assemble the original file, which storage only does on that explicit request, and storage emits an event once the file exists. The event queues a processing job and the status moves to "processing".',
        tradeoff:
          'A durable queue between upload and processing absorbs bursts of uploads and survives worker crashes. It adds a little delay before work starts, which is small next to the minutes transcoding takes.',
        nodes: ['raw', 'queue'],
        travel: [['raw', 'queue', 'complete']],
        short: 'Queue job',
        metrics: { users: '20M', requestsPerSecond: '2K', p95Latency: '120 ms', errorRate: '0%' },
        load: { raw: 40, queue: 25 },
      },
      {
        title: 'Split and transcode in parallel',
        narration:
          'The job splits the original into chunks of a few seconds at keyframes. Many transcoders each take a chunk and encode it into every rung of the quality ladder, from low resolution to high.',
        tradeoff:
          'Transcoding a long video on one machine can take longer than the video itself. Chunks spread the work across hundreds of machines so even long videos are ready in minutes, at the cost of an orchestrator that tracks every chunk and retries failures.',
        nodes: ['queue', 'transcode'],
        travel: [['queue', 'transcode']],
        short: 'Transcode',
        metrics: { users: '20M', requestsPerSecond: '2K', p95Latency: '120 ms', errorRate: '0%' },
        load: { queue: 30, transcode: 85 },
        traffic: [{ edge: ['queue', 'transcode'], kind: 'heavy' }],
      },
      {
        title: 'Package segments and manifests',
        narration:
          'The packager cuts each rendition into segments of a few seconds in a standard adaptive streaming format, writes them to segment storage and writes a manifest that lists every rendition.',
        tradeoff:
          'Small segments let the player switch quality often and start fast, but mean many more files and requests. A few seconds per segment is the usual balance. Storing the full ladder adds roughly the size of the original again, because each rung is encoded at a much lower bitrate than the source.',
        nodes: ['transcode', 'packager', 'segments'],
        travel: [
          ['transcode', 'packager'],
          ['packager', 'segments'],
        ],
        short: 'Package',
        metrics: { users: '20M', requestsPerSecond: '2K', p95Latency: '120 ms', errorRate: '0%' },
        load: { transcode: 60, packager: 45, segments: 30 },
      },
      {
        title: 'Mark the video ready',
        narration:
          'Once every rendition is written, the packager sets the status to "ready" and stores the manifest URL in the metadata database. The creator is notified.',
        tradeoff:
          'Flipping the status only after all renditions exist means viewers never hit a missing segment. A faster alternative publishes the lowest quality first and adds higher ones as they finish, which gets the video out sooner at the cost of a manifest that changes.',
        nodes: ['packager', 'meta'],
        travel: [['packager', 'meta', 'ready']],
        short: 'Ready',
        metrics: { users: '20M', requestsPerSecond: '2K', p95Latency: '120 ms', errorRate: '0%' },
        load: { packager: 20, meta: 15 },
      },
      {
        title: 'A viewer presses play',
        narration:
          'The player asks the video API for the video’s metadata and receives its title, status and manifest URL.',
        tradeoff:
          'Metadata is small and read far more than it is written, so it is cached heavily and served from read replicas. Keeping metadata separate from the media means a database hiccup never touches the bytes already flowing from the CDN.',
        nodes: ['viewer', 'api', 'meta'],
        travel: [
          ['viewer', 'api', 'metadata'],
          ['api', 'meta'],
        ],
        short: 'Press play',
        metrics: { users: '20M', requestsPerSecond: '200K', p95Latency: '120 ms', errorRate: '0%' },
        load: { api: 40, meta: 30 },
      },
      {
        title: 'Every play reads from storage',
        narration:
          'Before any CDN, the player fetches every segment from segment storage in one region. A popular release draws a million viewers at once, storage bandwidth saturates, viewers far away wait seconds for each segment and playback stalls.',
        tradeoff:
          'More bandwidth in one region does not shorten the distance to viewers on other continents, and paying for origin traffic on every view of the same popular segments is wasteful. The same few segments are watched over and over, which is exactly what edge caches are for.',
        nodes: ['viewer', 'segments'],
        travel: [],
        short: 'Storage melts',
        metrics: {
          users: '20M',
          requestsPerSecond: '1M',
          p95Latency: '6 s',
          errorRate: '5%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { segments: 98 },
      },
      {
        title: 'Stream segments from the CDN',
        narration:
          'A CDN joins the playback path. The player downloads the manifest and the first segments from the nearest edge. It measures throughput and buffer level, and picks the rendition for each next segment.',
        tradeoff:
          'Adaptive bitrate starts with a modest quality for a fast start and steps up as the buffer fills, trading peak picture quality for fewer stalls. Serving from the edge keeps latency low and keeps almost all traffic away from our storage.',
        nodes: ['viewer', 'cdn'],
        travel: [['viewer', 'cdn', 'segments']],
        short: 'CDN',
        metrics: { users: '20M', requestsPerSecond: '1M', p95Latency: '400 ms', errorRate: '0.2%' },
        load: { cdn: 55, segments: 20 },
      },
      {
        title: 'Misses go back to storage',
        narration:
          'If the edge does not have a segment, it fetches it from segment storage through a regional shield cache, stores it and serves it. Popular videos stay hot at the edges.',
        tradeoff:
          'A shield layer collapses many edge misses into one origin read, protecting storage when a video suddenly goes viral. The long tail of rarely watched videos is mostly misses, which is acceptable because each of them is cheap and rare.',
        nodes: ['cdn', 'segments'],
        travel: [['cdn', 'segments', 'miss']],
        short: 'Edge miss',
        metrics: { users: '20M', requestsPerSecond: '1M', p95Latency: '400 ms', errorRate: '0.2%' },
        load: { cdn: 60, segments: 25 },
      },
    ],
  },
  deepDives: [
    {
      question: 'How do large files get uploaded reliably?',
      options: [
        {
          name: 'One request through the API servers',
          pros: 'Simplest to build.',
          cons: 'A drop near the end restarts everything, and API servers carry all the bytes.',
        },
        {
          name: 'Multipart upload to storage with signed URLs',
          pros: 'Resumable, parallel, and our servers never touch the bytes.',
          cons: 'More client logic and incomplete uploads to clean up.',
        },
      ],
      choice:
        'Multipart upload with signed URLs. Of the two, it is the one that keeps multi-gigabyte uploads from phones on mobile networks reliable.',
    },
    {
      question: 'How do we make processing fast and robust?',
      options: [
        {
          name: 'One worker per video',
          pros: 'Simple; no coordination.',
          cons: 'Long videos take hours, and a crash restarts the whole job.',
        },
        {
          name: 'Split into chunks, transcode in parallel',
          pros: 'Time to ready grows slowly with length, as long as there are workers to add; a failure retries one chunk.',
          cons: 'Needs an orchestrator and careful splitting at keyframes.',
        },
      ],
      choice:
        'Chunked parallel transcoding, modeled as a small graph of tasks (split, transcode each chunk for each rendition, package, publish), with every task idempotent so retries are safe.',
    },
    {
      question: 'Do we transcode every quality for every video?',
      options: [
        {
          name: 'Full ladder for every upload',
          pros: 'Every video plays well on every device from the start.',
          cons: 'Most videos are rarely watched, so most of that compute and storage is wasted.',
        },
        {
          name: 'A few renditions first, more when a video gets popular',
          pros: 'Compute and storage follow actual demand.',
          cons: 'A video that suddenly takes off plays at lower quality until the rest is ready.',
        },
      ],
      choice:
        'A small base ladder for every upload, and the high-resolution and more efficient encodings only once a video passes a view threshold. The originals are kept, so any rendition can be produced later.',
    },
  ],
  wrapUp:
    'Resumable multipart uploads straight to object storage, a queued pipeline that transcodes chunks in parallel, segments and manifests for adaptive bitrate, metadata kept apart from media, and a CDN with a shield layer serving almost every byte.',
  guarantees: {
    provides: [
      {
        property: 'Durability of originals',
        promise:
          'Once complete returns success, the original is stored in several zones and is never modified or deleted by the pipeline. Each part is accepted only if its checksum matches, and complete names every part, so the assembled file is the one the creator sent. Renditions are derived data and can always be rebuilt from it.',
      },
      {
        property: 'Upload',
        promise:
          'An upload can be resumed and retried safely. Sending a part again replaces the same part number, and complete is keyed by the video id, so a retry after a timeout returns the same result instead of creating a second video.',
      },
      {
        property: 'Processing',
        promise:
          'Every completed upload is processed at least once, made harmless by deterministic output keys (video id, rendition, chunk index, encoding version). A repeated task overwrites the same object with an equivalent one, and a sweeper re-queues any video that is complete in storage but has no job making progress.',
      },
      {
        property: 'Publish consistency',
        promise:
          'A video is shown as ready only after every segment and the manifest of its ladder are in storage. Ready is one conditional write from processing, and segments and manifests are immutable under versioned paths, so a manifest never points at a segment that does not exist and the CDN can cache both for a long time.',
      },
      {
        property: 'Playback availability',
        promise:
          'Playback of a published video depends only on the CDN and segment storage. Once the player has the manifest, an outage of the API, the metadata database or the whole processing pipeline does not interrupt it.',
      },
    ],
    assumes: [
      'Object storage replicates across zones before it acknowledges a write, and a new object is readable right after its write returns.',
      'Storage events arrive at least once, but can be late, duplicated or, rarely, missing. The sweeper covers the missing case.',
      'Chunks are cut at keyframes into closed groups of pictures and encoded with pinned settings, so the output of any attempt at a chunk is interchangeable with any other.',
      'The CDN honors cache headers and collapses concurrent misses for the same object into one origin fetch.',
      'Players retry failed segment requests and can drop to a lower rendition.',
    ],
    doesNotGuarantee: [
      'A hard bound on time to ready. Minutes is the typical case; a burst of uploads turns into queue time.',
      'Exactly-once processing. Tasks and notifications can repeat; the keys above make the repeat harmless.',
      'The full quality ladder from the first view. High resolutions are added only after a video passes the view threshold.',
      'Fresh metadata on every read. Cached and replica reads can lag by seconds, so a video can show as processing briefly after it is ready, and an edit to a title takes a moment to appear.',
      'Stall-free playback. Adaptive bitrate lowers quality to avoid stalls, but cannot fix a connection slower than the lowest rung.',
      'That an abandoned upload can be resumed forever. Parts without a complete are deleted by the lifecycle rule after a few days.',
    ],
  },
  failures: [
    {
      scenario: 'The connection drops in the middle of an upload, or the creator never comes back.',
      impact:
        'The video stays in "uploading". The parts already sent are safe but invisible, and they cost storage for as long as they are kept.',
      detection:
        'The client sees the failed part. On the server side, a count of uploads older than a day that are still in "uploading", and the bytes held in incomplete multipart uploads.',
      recovery:
        'On reconnect the app lists the parts that arrived and sends only the missing ones, with fresh signed URLs if the old ones expired. If nobody returns, the lifecycle rule deletes the parts and a sweeper marks the video record as expired.',
    },
    {
      scenario:
        'Storage assembles the file, but the event is lost or the API crashes before it records the new status.',
      impact:
        'The original exists and is durable, but no job is queued. The video would sit in "uploading" or "processing" forever while the creator waits.',
      detection:
        'A reconciliation job compares records with storage: videos in "uploading" whose assembled object exists, and videos in "processing" with no task progress for several minutes. The age of the oldest such video is an alarmed metric.',
      recovery:
        'The sweeper queues the job again, keyed by the video id. If the first event was only late, the job runs twice and the second run writes the same objects. The video continues to "ready" with a delay of one sweep interval.',
    },
    {
      scenario:
        'A transcoder dies in the middle of a chunk, or one chunk makes the encoder fail every time.',
      impact:
        'One chunk of one rendition is missing, so the video cannot be packaged. A chunk that always fails would block the video forever if retried without limit.',
      detection:
        'The task is not acknowledged before its visibility timeout. Task retry rate and the age of the oldest unfinished chunk are tracked; a chunk that reaches the attempt limit goes to a dead-letter queue.',
      recovery:
        'The orchestrator hands the chunk to another transcoder. An object write is all or nothing, so a half-written chunk is never visible. After the attempt limit the video is marked "failed", the creator is told, and the original is kept so the job can be replayed after an encoder fix.',
    },
    {
      scenario:
        'The packager crashes after writing the segments but before setting the status to "ready".',
      impact:
        'Every segment is in storage but the video still shows "processing". Viewers cannot reach it; nothing is exposed half-finished.',
      detection:
        'The publish task times out and is retried. Time from upload complete to ready, at P95, has an alarm, and the reconciliation job catches a video with all its segments and no ready status.',
      recovery:
        'The retried task writes the same segment and manifest keys, then flips the status with a write that only applies if the status is still "processing". A second flip changes nothing. The creator notification may be sent twice and is deduplicated by video id.',
    },
    {
      scenario: 'A CDN region fails or loses its cache while a popular video is being watched.',
      impact:
        'Viewers are routed to farther edges that do not have the segments, so misses surge toward storage. Start time and stalls rise, and players step down in quality.',
      detection:
        'Edge hit ratio drops and origin requests per second jump. Player telemetry shows the stall ratio and start time by region.',
      recovery:
        'The shield collapses concurrent misses for the same segment into one origin read, and a concurrency limit on origin fetches protects storage. Edges refill within minutes because a popular video is a small set of segments. No data is at risk; the system returns to its normal hit ratio by itself.',
    },
    {
      scenario: 'The primary of the metadata database fails.',
      impact:
        'New uploads cannot start and status changes cannot be written until a replica is promoted. Plays of videos whose metadata is cached or on a replica keep working, and playback already in progress is untouched.',
      detection:
        'Write errors on the API, health checks and replication lag. In the pipeline, a rising count of publish retries.',
      recovery:
        'A replica is promoted. Publish tasks retry until their conditional write succeeds, so finished videos become ready late but none is skipped. Parts already in storage stay valid, and the app retries create and complete with the same ids.',
    },
  ],
  capacity: {
    assumptions: [
      '20 million daily viewers, with 4 million watching at the peak (a popular release) and about 1 million on average.',
      'A viewer starts a new play about every 20 s of watching (short videos, skips and early exits), and each play is one metadata request.',
      'Segments are 4 s long and the average delivered bitrate is 2.5 Mbps.',
      '2 million uploads a day, 200 s long on average at 8 Mbps, with a peak of three times the average rate.',
      'The base ladder is four rungs that add up to about 4.7 Mbps; encoding it costs about 2 core-seconds per second of video.',
      'The CDN serves 95% of segment requests from cache.',
    ],
    estimates: [
      {
        label: 'Plays and metadata reads',
        value: '200K/s at peak, ~4B plays a day',
        math: '4M viewers ÷ 20 s = 200K plays/s at peak. 1M average viewers ÷ 20 s = 50K/s × 86,400 s ≈ 4.3B a day',
      },
      {
        label: 'Read to write ratio',
        value: '~2,000 plays per upload',
        math: '4.3B plays ÷ 2M uploads ≈ 2,150. Uploads are 2M ÷ 86,400 s ≈ 23/s on average, ~70/s at peak',
      },
      {
        label: 'Segment requests and egress',
        value: '1M requests/s, ~10 Tbps at peak',
        math: '4M viewers ÷ 4 s per segment = 1M requests/s. 4M × 2.5 Mbps = 10 Tbps',
      },
      {
        label: 'Origin load behind the CDN',
        value: '~50K requests/s',
        math: '1M requests/s × 5% misses = 50K/s at the edges, before the shield collapses repeated misses',
      },
      {
        label: 'Ingest and storage',
        value: '~37 Gbps in, ~640 TB a day',
        math: '200 s × 8 Mbps ÷ 8 = 200 MB per upload × 2M = 400 TB/day ≈ 37 Gbps. Base ladder: 4.7 ÷ 8 ≈ 0.6 × 400 TB ≈ 240 TB/day',
      },
      {
        label: 'Transcoding compute',
        value: '~9K cores average, ~28K at peak',
        math: '2M uploads × 200 s = 400M s of video/day ÷ 86,400 ≈ 4,600 s of video per second × 2 core-seconds ≈ 9,300 cores, × 3 at peak',
      },
      {
        label: 'Segment objects',
        value: '~400M new objects a day',
        math: '400M s of video ÷ 4 s per segment × 4 rungs = 400M',
      },
    ],
    implications: [
      'Ingest is tens of gigabits a second of long-lived transfers, so the bytes go straight to object storage with signed URLs and the API handles only small control requests.',
      'Peak egress is in the terabits, far beyond one region and mostly repeated bytes. A CDN is required, not an optimization, and the 5% that misses is still 50K requests a second, which is why a shield sits in front of storage.',
      'Metadata is read about 2,000 times per write and each record is around a kilobyte, so it is served from cache and read replicas while one primary takes the writes.',
      'Transcoding needs thousands of cores on average and three times that at peak. That is hundreds of machines, which only pays off if the fleet scales with the queue and can use cheap, interruptible capacity; chunk tasks that are small and idempotent make that safe.',
      'Storage grows by hundreds of terabytes a day and most of it is originals and renditions of videos that are rarely watched. That forces the small base ladder with more rungs only on demand, and a colder storage class for originals once processing is done.',
      'Hundreds of millions of small objects a day make listing useless, so every key is derived from the video id, rendition and segment number, and nothing in the read path ever lists a bucket.',
    ],
  },
  evolution: {
    mvp: 'One region, one bucket and a managed CDN in front of it. Uploads already use multipart with signed URLs, because that costs little and is hard to retrofit into clients. Processing is one worker per video with a fixed ladder of three renditions, pulled from a queue, with no chunking and no orchestrator. Metadata is one database with a replica. This holds for thousands of uploads a day and short videos.',
    atScale: [
      'At 10x uploads, storage cost overtakes everything else. Originals move to a cold class after processing, rarely watched renditions are dropped and rebuilt on demand, and encoding settings are chosen per video so easy content uses fewer bits.',
      'At 10x viewers, one CDN is a single point of failure and of pricing. A second CDN is added, and the player switches between them using its own measurements.',
      'At 10x, creators far from the region see slow uploads. Parts are accepted by storage in the nearest region and the original is copied to the processing region afterwards.',
      'At 100x, the object count and the request rate per video favor one file per rendition, read with byte ranges, over one object per segment.',
      'At 100x, egress dominates cost. Popular videos are re-encoded with more efficient codecs, where the extra compute is paid back by the bytes saved, and caches are placed inside access networks.',
      'At 100x, the metadata database is sharded by video id; until then one primary with replicas and a cache is enough, because writes are around a hundred a second.',
    ],
    firstBottleneck:
      'Transcoding capacity. It is the only tier where a unit of work costs minutes of CPU, and uploads arrive in bursts, so a spike shows up first as queue time and a slower time to ready. Storage and delivery are handed to services that scale horizontally, and metadata is small. The fix is to scale transcoders on the age of the oldest job, and to give short videos and the lowest rungs priority so most creators still see their video within minutes.',
    avoided: [
      'Publishing the lowest rendition first and adding the rest as they finish. It shortens time to ready, but the manifest changes under the players; worth it when time to first view becomes a product goal.',
      'A second CDN with client-side switching. It doubles the integration and testing work; worth it once a single CDN outage is too costly or traffic is large enough to negotiate.',
      'Per-video encoding ladders. They save bits but need an analysis pass per upload; worth it when egress and storage cost more than the extra compute.',
      'Deduplicating identical uploads by content hash. The saving is small for original content and it complicates deletion; worth it if re-uploads become a large share.',
      'Access control on segments (signed playback URLs, encryption). Public videos cache best with plain URLs; needed as soon as private or paid videos exist.',
    ],
  },
};
