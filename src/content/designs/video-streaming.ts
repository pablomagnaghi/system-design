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
      'Only signed-in creators upload, through signed URLs that expire within hours; every uploaded file is treated as hostile input, so decoding runs isolated; viewers can fetch only published videos.',
    ],
    outOfScope: [
      'Live streaming, which needs a different ingest and segments produced in real time.',
      'Recommendations, search and comments.',
      'Content moderation and copyright matching, which would read the originals in a separate pipeline and call a takedown.',
      'Private and paid videos with DRM; the design serves public videos with plain cacheable URLs.',
      'Captions, thumbnails chosen by models, and ad insertion.',
    ],
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
        column: 5,
        row: 'bottom',
        appearsAt: 4,
      },
      {
        id: 'viewer',
        title: 'Viewer',
        detail: 'Adaptive player',
        column: 0,
        row: 'bottom',
        appearsAt: 7,
      },
      {
        id: 'cdn',
        title: 'CDN',
        detail: 'Edge caches',
        column: 4,
        row: 'bottom',
        appearsAt: 9,
      },
      {
        id: 'sweeper',
        title: 'Sweeper',
        detail: 'Finds stuck videos',
        column: 5,
        row: 'top',
        appearsAt: 6,
      },
    ],
    edges: [
      ['creator', 'api'],
      ['api', 'meta'],
      ['creator', 'raw', 'parts'],
      ['raw', 'queue'],
      ['queue', 'transcode'],
      ['transcode', 'packager'],
      ['packager', 'segments'],
      ['packager', 'meta', 'ready'],
      ['viewer', 'api'],
      ['viewer', 'cdn', 'segments'],
      ['cdn', 'segments', 'miss'],
      ['viewer', 'segments'],
      ['sweeper', 'meta'],
    ],
    edgeStages: [{ edge: ['viewer', 'segments'], stages: [8] }],
    stages: [
      {
        title: 'Start an upload',
        narration:
          'The creator’s app asks the video API for an upload. The API creates a video record with status "uploading", starts a multipart upload in object storage and returns a signed URL for each part.',
        tradeoff:
          'Signed URLs let the file bypass our servers entirely, so API servers never hold gigabytes in memory or tie up connections for minutes. The cost is that the API must trust storage events to know what arrived, and the URLs must expire quickly.',
        nodes: ['creator', 'api', 'meta'],
        travel: [
          ['creator', 'api'],
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
        nodes: ['creator', 'api', 'meta', 'raw', 'queue'],
        travel: [
          ['creator', 'api'],
          ['api', 'meta'],
          ['raw', 'queue'],
        ],
        short: 'Queue job',
        metrics: { users: '20M', requestsPerSecond: '2K', p95Latency: '120 ms', errorRate: '0%' },
        load: { raw: 40, queue: 25 },
      },
      {
        title: 'Split and transcode in parallel',
        narration:
          'The job splits the original into chunks of a few seconds at keyframes. Many transcoders each take a chunk and encode it into every rung of the base ladder of four, from low resolution to high; higher resolutions are added only once a video passes a view threshold. They run on Spot instances, which are cheap but can be reclaimed, and in an isolated network, because an uploaded file can be crafted to attack a decoder.',
        tradeoff:
          'Transcoding a long video on one machine can take longer than the video itself. Chunks spread the work across hundreds of machines so even long videos are ready in minutes, at the cost of an orchestrator that tracks every chunk and retries failures. Chunks of a few seconds are also what make Spot safe: a reclaimed instance loses one small task, not an hour of encoding.',
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
          'The packager cuts each rendition into segments of a few seconds in CMAF, which HLS and DASH players both read, writes them to segment storage and writes a manifest that lists every rendition.',
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
        title: 'Sweep for stuck videos',
        narration:
          'Every five minutes a sweeper looks for videos that are not moving: complete was called but no job exists, or processing has made no progress for fifteen minutes. If the original is in storage and the last workflow has ended, it queues the video again.',
        tradeoff:
          'Storage events arrive at least once but can, rarely, go missing, and the API can crash between complete and recording the new status. Without a sweeper such a video waits forever. The sweeper adds a small job and a query every few minutes, and a repeated job is harmless because every output key is deterministic.',
        nodes: ['sweeper', 'meta'],
        travel: [['sweeper', 'meta']],
        short: 'Sweeper',
        metrics: { users: '20M', requestsPerSecond: '2K', p95Latency: '120 ms', errorRate: '0%' },
        load: { sweeper: 10, meta: 15 },
      },
      {
        title: 'A viewer presses play',
        narration:
          'The player asks the video API for the video’s metadata and receives its title, status and manifest URL.',
        tradeoff:
          'Metadata is small and read far more than it is written, so it is cached heavily and served from read replicas. Keeping metadata separate from the media means a database hiccup never touches the bytes already flowing from the CDN.',
        nodes: ['viewer', 'api', 'meta'],
        travel: [
          ['viewer', 'api'],
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
        travel: [['viewer', 'segments']],
        short: 'Storage melts',
        metrics: {
          users: '20M',
          requestsPerSecond: '1M',
          p95Latency: '6 s',
          errorRate: '5%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { segments: 98 },
        traffic: [{ edge: ['viewer', 'segments'], kind: 'failed' }],
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
  flows: [
    {
      id: 'upload',
      title: 'Upload a video',
      kind: 'sync',
      summary:
        'Carla uploads a 2 GB video from her laptop. The API only hands out signed URLs; the bytes go in parts straight to S3, and complete is one call at the end.',
      runsOn: 'API on ECS → Aurora → S3 multipart upload with presigned URLs',
      participants: [
        { id: 'app', label: 'Carla’s app', service: 'Client' },
        { id: 'api', label: 'Video API', service: 'ECS Fargate + Cognito' },
        { id: 'db', label: 'Metadata', service: 'Aurora PostgreSQL' },
        { id: 's3', label: 'Raw storage', service: 'S3' },
      ],
      steps: [
        {
          from: 'app',
          to: 'api',
          label: 'POST /videos {title, size 2 GB}',
          note: 'Only a signed-in creator, with a per-creator upload limit. The size picks the part count: 2 GB in parts of 16 MB is 128 parts.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'INSERT video v91, status uploading',
          note: 'The video id is created here and every later key is derived from it.',
        },
        {
          from: 'api',
          to: 's3',
          label: 'CreateMultipartUpload raw/v91',
          note: 'Returns an upload id. The API then signs one URL per part, valid for a few hours.',
        },
        {
          from: 'app',
          to: 's3',
          label: 'PUT part 1..128 with checksum, 4 at a time',
          note: 'S3 rejects a part whose checksum does not match. After a dropped connection the app lists the parts that arrived and sends only the rest.',
        },
        {
          from: 'app',
          to: 'api',
          label: 'POST /videos/v91/complete {parts, checksums}',
          note: 'Keyed by the video id, so a retry after a timeout returns the same answer and never creates a second video.',
        },
        {
          from: 'api',
          to: 's3',
          label: 'CompleteMultipartUpload',
          note: 'S3 assembles the original only on this explicit call and returns once it is stored across zones. Then the API answers Carla, and status moves to processing.',
        },
      ],
    },
    {
      id: 'process',
      title: 'Process the upload',
      kind: 'queue',
      summary:
        'The new original triggers a workflow that splits it into chunks, transcodes every chunk into every rung on Spot instances, packages segments and manifests, and flips the video to ready once.',
      runsOn: 'S3 event → EventBridge → SQS → Step Functions → AWS Batch on EC2 Spot → S3 → Aurora',
      participants: [
        { id: 's3raw', label: 'Raw storage', service: 'S3 + EventBridge' },
        { id: 'sqs', label: 'Job queue', service: 'SQS' },
        { id: 'sfn', label: 'Orchestrator', service: 'Step Functions' },
        { id: 'enc', label: 'Transcoders', service: 'AWS Batch, EC2 Spot' },
        { id: 'seg', label: 'Segment storage', service: 'S3' },
        { id: 'db', label: 'Metadata', service: 'Aurora PostgreSQL' },
      ],
      steps: [
        {
          from: 's3raw',
          to: 'sqs',
          label: 'Object Created raw/v91',
          note: 'Delivered at least once, usually within seconds. The queue buffers a burst of uploads.',
          style: 'async',
        },
        {
          from: 'sqs',
          to: 'sfn',
          label: 'StartExecution name=v91-enc3-1',
          note: 'A small Lambda reads the queue and starts the workflow. The execution name is the video id, the encoding version and the attempt. A duplicate event tries to start the same name and is refused, so a repeated event never starts a second workflow.',
        },
        {
          from: 'sfn',
          to: 'enc',
          label: 'split at keyframes → 50 chunks × 4 rungs',
          note: 'A 200-second video becomes 50 chunks of 4 s. Each chunk and rung is one small task, so 200 tasks run in parallel and a Spot interruption loses only one of them.',
        },
        {
          from: 'enc',
          to: 'seg',
          label: 'PUT v91/enc3/720p/chunk-017',
          note: 'Deterministic keys: a retried task overwrites the same object with an equivalent one. Transcoders run with no internet access, because a crafted file can attack a decoder.',
        },
        {
          from: 'sfn',
          to: 'seg',
          label: 'package: segments + master.m3u8',
          note: 'Segments and manifests go under a versioned path and are never modified, so the CDN can cache them for a long time.',
        },
        {
          from: 'sfn',
          to: 'db',
          label: 'UPDATE status=ready WHERE status=processing',
          note: 'The only path to ready, after every object exists. A repeated publish matches no row and changes nothing.',
        },
      ],
    },
    {
      id: 'play',
      title: 'Press play',
      kind: 'sync',
      summary:
        'Bruno opens the video. One small API call returns the manifest URL; every byte after that comes from the nearest CloudFront edge, and the player picks a rung for each next segment.',
      runsOn: 'API on ECS → ElastiCache / Aurora replica, then CloudFront edges',
      participants: [
        { id: 'player', label: 'Bruno’s player', service: 'Client' },
        { id: 'api', label: 'Video API', service: 'ECS Fargate' },
        { id: 'cache', label: 'Metadata cache', service: 'ElastiCache' },
        { id: 'edge', label: 'Edge', service: 'CloudFront' },
      ],
      steps: [
        {
          from: 'player',
          to: 'api',
          label: 'GET /videos/v91',
          note: '200K of these a second at peak; each is about a kilobyte.',
        },
        {
          from: 'api',
          to: 'cache',
          label: 'GET video:v91 (replica on a miss)',
          note: 'Metadata is read about 2,000 times per write, so the primary never sees plays.',
        },
        {
          from: 'api',
          to: 'player',
          label: '{title, status ready, manifest URL}',
          note: 'From here on the API is out of the path: an API outage does not stop a video that is already playing.',
          style: 'reply',
        },
        {
          from: 'player',
          to: 'edge',
          label: 'GET master.m3u8, then 360p seg 1-2',
          note: 'Starts on a low rung so the first frame appears in about two seconds.',
        },
        {
          from: 'player',
          to: 'player',
          label: 'buffer 12 s, throughput 8 Mbps → 1080p',
          note: 'Adaptive bitrate: the player measures each download and its buffer, and steps up or down for the next 4-second segment.',
        },
        {
          from: 'player',
          to: 'edge',
          label: 'GET 1080p seg 3, 4, …',
          note: 'About one request every 4 s per viewer, 1M requests a second at the peak, 95% answered from the edge cache.',
        },
      ],
    },
    {
      id: 'edge-miss',
      title: 'An edge miss',
      kind: 'sync',
      summary:
        'A video goes viral in a region whose edges never served it. Thousands of misses for the same segment become one read from S3, through the regional shield.',
      runsOn: 'CloudFront edge → Origin Shield → S3 with Origin Access Control',
      participants: [
        { id: 'viewers', label: 'Viewers', service: 'Clients' },
        { id: 'edge', label: 'Edge location', service: 'CloudFront' },
        { id: 'shield', label: 'Regional shield', service: 'CloudFront Origin Shield' },
        { id: 's3', label: 'Segment storage', service: 'S3' },
      ],
      steps: [
        {
          from: 'viewers',
          to: 'edge',
          label: '3,000 × GET 720p seg 1',
          note: 'Concurrent requests for the same object at one edge are collapsed into one request upstream.',
        },
        {
          from: 'edge',
          to: 'shield',
          label: 'one miss',
          note: 'Every edge in the world misses toward the same shield region, so a viral video costs the origin one read per segment, not one per edge.',
        },
        {
          from: 'shield',
          to: 's3',
          label: 'GetObject v91/enc3/720p/seg-0001.m4s',
          note: 'Only CloudFront can read the bucket, through Origin Access Control; the bucket is not public.',
        },
        {
          from: 'shield',
          to: 'edge',
          label: 'segment, Cache-Control: max-age 1 year',
          note: 'Safe to cache for a year because the path is versioned and the object never changes.',
          style: 'reply',
        },
        {
          from: 'edge',
          to: 'viewers',
          label: 'segment ×3,000',
          note: 'The next viewers in that city get it from the edge with no origin call.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'sweep',
      title: 'Find stuck videos',
      kind: 'scheduled',
      summary:
        'Every five minutes a sweeper finds videos whose original exists but that are not moving toward ready, and queues them again. It covers a lost event, a crashed API and a stalled workflow.',
      runsOn: 'EventBridge Scheduler → Lambda → Aurora, S3 → SQS',
      participants: [
        { id: 'sched', label: 'Scheduler', service: 'EventBridge Scheduler' },
        { id: 'sweeper', label: 'Sweeper', service: 'Lambda' },
        { id: 'db', label: 'Metadata', service: 'Aurora PostgreSQL' },
        { id: 's3', label: 'Raw storage', service: 'S3' },
        { id: 'sqs', label: 'Job queue', service: 'SQS' },
      ],
      steps: [
        {
          from: 'sched',
          to: 'sweeper',
          label: 'every 5 min',
          note: 'A few hundred rows at most, well within a Lambda run.',
          style: 'async',
        },
        {
          from: 'sweeper',
          to: 'db',
          label: 'uploading with complete called, or processing > 15 min idle',
          note: 'The age of the oldest stuck video is published as a metric and alarmed.',
        },
        {
          from: 'sweeper',
          to: 's3',
          label: 'HeadObject raw/v91',
          note: 'Only videos whose original really exists are re-queued; the rest are abandoned uploads that the lifecycle rule will clean up.',
        },
        {
          from: 'sweeper',
          to: 'sqs',
          label: 'enqueue v91, attempt 2',
          note: 'Only after checking the last execution: if it is still running nothing is queued; if it failed or timed out, the next attempt starts under a new name, and its deterministic keys overwrite whatever the first attempt left.',
        },
      ],
    },
    {
      id: 'spot',
      title: 'A Spot instance is reclaimed',
      kind: 'direct',
      summary:
        'EC2 reclaims a Spot instance in the middle of a chunk. The chunk is retried elsewhere; a chunk that fails every time ends in a dead-letter state and the video is marked failed.',
      runsOn: 'EC2 Spot → AWS Batch → Step Functions retry → S3',
      participants: [
        { id: 'ec2', label: 'Spot instance', service: 'EC2' },
        { id: 'enc', label: 'Transcoder task', service: 'AWS Batch' },
        { id: 'sfn', label: 'Orchestrator', service: 'Step Functions' },
        { id: 'seg', label: 'Segment storage', service: 'S3' },
      ],
      steps: [
        {
          from: 'ec2',
          to: 'enc',
          label: 'two-minute interruption notice',
          note: 'A 4-second chunk takes seconds to encode, so most tasks finish inside the notice; the rest stop.',
          style: 'async',
        },
        {
          from: 'enc',
          to: 'sfn',
          label: 'task failed',
          note: 'Nothing partial is visible: an S3 PUT either stores the whole object or nothing.',
          style: 'reply',
        },
        {
          from: 'sfn',
          to: 'enc',
          label: 'retry chunk-017 720p (attempt 2 of 3)',
          note: 'On another instance, often of another type, since Batch draws from several Spot pools.',
        },
        {
          from: 'enc',
          to: 'seg',
          label: 'PUT v91/enc3/720p/chunk-017',
          note: 'The same key as the lost attempt. After three failures the video is marked failed, the creator is told, and the original stays for a replay after an encoder fix.',
        },
      ],
    },
  ],
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
    {
      question: 'How do we protect the system from what people upload?',
      options: [
        {
          name: 'Trust the file once the upload is authenticated',
          pros: 'Nothing extra to build.',
          cons: 'Decoders parse untrusted binary formats; a crafted file can exploit one and reach whatever the worker can reach.',
        },
        {
          name: 'Scan uploads with antivirus before processing',
          pros: 'Catches known malware.',
          cons: 'Says little about a malformed video built to break a decoder.',
        },
        {
          name: 'Isolate decoding and limit everything around it',
          pros: 'A compromised transcoder can read its input chunk and write its output key, nothing else.',
          cons: 'Network rules, narrow roles and time limits to maintain.',
        },
      ],
      choice:
        'Isolate. Transcoders run in private subnets with no internet access, with a role that reads raw/ and writes only the video’s output prefix, a size and duration check first, and a timeout per task. Upload URLs are signed per part, expire within hours, and are issued only to signed-in creators under a per-creator limit; the buckets are private and only CloudFront reads segments.',
    },
    {
      question: 'Which streaming format, and how many copies of each segment?',
      options: [
        {
          name: 'HLS with MPEG-TS segments',
          pros: 'Plays on every Apple device and most players.',
          cons: 'Other platforms prefer DASH, so supporting both means two sets of segments.',
        },
        {
          name: 'HLS and DASH, each with its own segments',
          pros: 'Native on every platform.',
          cons: 'Twice the segment storage and half the CDN cache efficiency.',
        },
        {
          name: 'CMAF: one set of fragmented MP4 segments, two manifests',
          pros: 'HLS and DASH players read the same segments, so storage and edge caches hold one copy.',
          cons: 'Very old devices that only play MPEG-TS need a fallback.',
        },
      ],
      choice:
        'CMAF segments of 4 seconds with an HLS and a DASH manifest. One copy of every segment halves storage and doubles the useful size of every edge cache compared with two formats.',
    },
    {
      question: 'Build the pipeline, or use AWS Elemental MediaConvert?',
      options: [
        {
          name: 'MediaConvert',
          pros: 'Managed transcoding with standard ladders and packaging; no fleet to run.',
          cons: 'Billed per minute of output, which at 400 million seconds of video a day is a large bill, and less control over chunking and priorities.',
        },
        {
          name: 'Our own transcoders on Spot instances',
          pros: 'Thousands of cores at a fraction of on-demand price, full control of codecs, ladders and priorities.',
          cons: 'An orchestrator, interruption handling and encoder upgrades to own.',
        },
      ],
      choice:
        'Our own chunked pipeline on Spot at this volume, because compute is the first bottleneck and the largest controllable cost. At MVP volume, MediaConvert or the single worker per video is simpler, and MediaConvert stays useful for rare formats.',
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
      'That an abandoned upload can be resumed forever. Parts without a complete are deleted by the lifecycle rule after 7 days.',
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
        'The Batch task fails or passes its timeout, and Step Functions sees it. Task retry rate and the age of the oldest unfinished chunk are tracked; a chunk that reaches the attempt limit fails the workflow.',
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
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, with processing in one region and delivery from CloudFront edges worldwide. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Video API',
        service:
          'Application Load Balancer and Amazon ECS on AWS Fargate; Amazon Cognito for creators; AWS WAF',
        why: 'Small control requests only: create, complete, metadata. The bytes never pass through it.',
        watch:
          'TargetResponseTime and HTTPCode_Target_5XX_Count; WAF BlockedRequests on upload creation.',
      },
      {
        part: 'Raw storage and uploads',
        service: 'Amazon S3 multipart upload with presigned part URLs; lifecycle rules',
        why: 'Resumable, parallel uploads straight from the creator, checksums per part, durable across zones on complete. A rule aborts incomplete uploads after 7 days and moves originals to a colder class after processing.',
        watch: 'Bytes in incomplete multipart uploads (S3 Storage Lens), 4xx and 5xx on PUT.',
      },
      {
        part: 'Events and job queue',
        service:
          'S3 Event Notifications to Amazon EventBridge, then Amazon SQS with a dead-letter queue',
        why: 'A durable buffer between bursts of uploads and the pipeline; events are at least once, which the workflow names make harmless.',
        watch: 'ApproximateAgeOfOldestMessage, the first sign of a transcoding shortfall.',
      },
      {
        part: 'Orchestrator',
        service:
          'AWS Step Functions, a Distributed Map over chunks and rungs, started by a Lambda that reads the queue',
        why: 'Split, transcode every chunk for every rung, package, publish, with retries and timeouts per task and a visible state per video.',
        watch: 'ExecutionsFailed, ExecutionsTimedOut and ExecutionTime per state machine.',
      },
      {
        part: 'Transcoders',
        service:
          'AWS Batch on Amazon EC2 Spot, several instance types, private subnets with no internet access',
        why: 'Thousands of cores at a fraction of on-demand price; small idempotent chunk tasks make interruptions cheap.',
        watch:
          'Jobs in RUNNABLE (waiting for capacity), Spot interruption rate, task failures per encoder version.',
      },
      {
        part: 'Segment storage',
        service:
          'Amazon S3, keys derived from video id, encoding version, rendition and segment number',
        why: 'Immutable objects under versioned paths, read only by CloudFront; nothing ever lists the bucket.',
        watch: '5xx and 503 Slow Down responses, which mean a prefix is taking too many requests.',
      },
      {
        part: 'Delivery',
        service: 'Amazon CloudFront with Origin Shield, Origin Access Control to the bucket',
        why: 'Terabits of egress from the edge, a regional shield that collapses misses, and a bucket that is not public.',
        watch: 'CacheHitRate, OriginLatency, 5xxErrorRate, and origin requests per second.',
      },
      {
        part: 'Metadata',
        service: 'Amazon Aurora PostgreSQL with read replicas, Amazon ElastiCache in front',
        why: 'About 100 writes a second on one primary (about four status writes per upload at 23 uploads a second); 200K reads a second from cache and replicas.',
        watch: 'AuroraReplicaLag, CommitLatency, and the cache hit rate.',
      },
      {
        part: 'Sweeper and notifications',
        service:
          'Amazon EventBridge Scheduler and AWS Lambda; Amazon SNS for creator notifications',
        why: 'The backstop for lost events and stalled workflows, and the "your video is ready" message, deduplicated by video id.',
        watch: 'A custom metric: age of the oldest stuck video.',
      },
      {
        part: 'Player telemetry',
        service:
          'Player beacons into Amazon Data Firehose, queried with Amazon Athena; key ratios as CloudWatch metrics',
        why: 'Start time and stalls are only visible from the player; they are the SLOs.',
        watch: 'Start time p95 and rebuffer ratio per region, CDN and rung.',
      },
      {
        part: 'Security and cost',
        service: 'IAM roles per stage, AWS KMS for buckets, AWS CloudTrail, AWS Cost Explorer',
        why: 'Each stage reads one prefix and writes another. The bill is egress, then storage, then Spot compute, which is why the ladder starts small and originals go cold.',
        watch: 'CloudFront, S3 and EC2 as separate lines in Cost Explorer.',
      },
    ],
    limits: [
      'An S3 multipart upload has at most 10,000 parts, each at least 5 MB except the last, so part size grows with file size.',
      'A presigned URL lasts at most 7 days when signed with long-term credentials, and no longer than the session when signed with temporary ones; upload URLs here last a few hours.',
      'S3 serves about 3,500 writes and 5,500 reads a second per prefix and scales by prefix, so keys start with the video id; 400M new objects a day is about 4,600 writes a second spread across many prefixes.',
      'A Spot instance gets a two-minute notice before it is reclaimed, which is why tasks are a few seconds of video each.',
      'Step Functions execution names must be unique per state machine for 90 days, which makes a name an idempotency key for starting a workflow.',
      'A Step Functions Distributed Map runs up to 10,000 child executions in parallel, far above the 200 tasks of a typical video.',
      'An Aurora cluster has at most 15 read replicas; with the cache in front, a few are enough.',
    ],
  },
  slos: [
    {
      objective: 'Start time',
      target: '95% of plays show the first frame within 2 s',
      measure: 'Player beacons, per region and CDN.',
    },
    {
      objective: 'Smooth playback',
      target: 'Rebuffering under 0.5% of watch time',
      measure: 'Stall time over watch time, from player beacons.',
    },
    {
      objective: 'Time to ready',
      target: '95% of videos under 10 minutes long are ready within 10 minutes of complete',
      measure: 'Ready time minus complete time from the metadata database.',
    },
    {
      objective: 'Uploads',
      target: '99.5% of started uploads that call complete succeed',
      measure: 'Complete calls against videos that reach processing.',
    },
  ],
  alarms: [
    {
      name: 'Processing falling behind',
      metric: 'SQS ApproximateAgeOfOldestMessage above 5 min, or Batch jobs RUNNABLE above 10 min',
      meaning:
        'The first bottleneck: not enough transcoding capacity, often a Spot shortage; add instance types or on-demand capacity.',
    },
    {
      name: 'Stuck videos',
      metric: 'Custom: oldest video stuck in uploading or processing above 30 min',
      meaning: 'Events lost or workflows stalled faster than the sweeper fixes them.',
    },
    {
      name: 'Failed videos',
      metric: 'Step Functions ExecutionsFailed above 1% of executions for 15 min',
      meaning:
        'Usually a bad encoder release or a new input format; roll back the encoder version.',
    },
    {
      name: 'Edge hit rate',
      metric: 'CloudFront CacheHitRate below 90% for 10 min',
      meaning: 'Origin load is climbing toward S3 limits; check cache headers and the shield.',
    },
    {
      name: 'Viewers stalling',
      metric: 'Rebuffer ratio above 1% in any region for 10 min',
      meaning:
        'A CDN or network problem in that region; consider steering traffic or lowering the starting rung.',
    },
    {
      name: 'Delivery errors',
      metric: 'CloudFront 5xxErrorRate above 1% for 5 min',
      meaning: 'Missing objects or an origin problem; players are retrying and dropping quality.',
    },
  ],
  evolution: {
    mvp: 'One region, one bucket and a managed CDN in front of it. Uploads already use multipart with signed URLs, because that costs little and is hard to retrofit into clients. Processing is one worker per video with a fixed ladder of three renditions, one fewer than the base ladder at scale, pulled from a queue, with no chunking and no orchestrator. Metadata is one database with a replica. This holds for thousands of uploads a day and short videos.',
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
