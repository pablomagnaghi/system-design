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
      'Only signed-in creators upload, through signed URLs that expire within an hour; every uploaded file is treated as hostile input, so decoding runs isolated; viewers can fetch only published videos.',
    ],
    outOfScope: [
      'Live streaming, which needs a different ingest and segments produced in real time.',
      'Recommendations, search and comments.',
      'Content moderation and copyright matching, which would read the originals in a separate pipeline and take a video down by marking it so no upgrade can swap its manifest again, deleting its paths in storage and invalidating them at the CDN.',
      'Private and paid videos with DRM; the design serves public videos with plain cacheable URLs.',
      'Captions, thumbnails chosen by models, and ad insertion.',
    ],
  },
  entities: [
    {
      name: 'Video',
      description:
        'ID, owner, title, description, status (uploading, processing, ready, failed), duration and, once ready, the manifest path.',
    },
    {
      name: 'Upload',
      description: 'A multipart upload session: the parts received so far and their checksums.',
    },
    {
      name: 'Rendition',
      description: 'One resolution and bitrate of a video, cut into segments of 4 seconds.',
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
      description:
        'Creates the video record and returns signed URLs for uploading parts. An idempotency key makes a retry return the same video.',
    },
    {
      method: 'GET',
      path: '/videos/{id}/upload',
      description:
        'The parts received so far and fresh signed URLs for the rest, to resume an upload.',
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
    'Completing the upload queues a processing job that plans the video as one-minute tasks and transcodes them in parallel.',
    'A packager checks the segments, writes the manifests and marks the video ready.',
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
        detail: 'Jobs and tasks',
        column: 2,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'transcode',
        title: 'Transcoders',
        detail: 'Tasks in parallel',
        column: 3,
        row: 'top',
        appearsAt: 3,
      },
      {
        id: 'packager',
        title: 'Packager',
        detail: 'Manifests, publish',
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
      ['api', 'raw'],
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
    edgeStages: [
      { edge: ['viewer', 'segments'], stages: [8] },
      { edge: ['api', 'raw'], stages: [0, 2] },
    ],
    stages: [
      {
        title: 'Start an upload',
        narration:
          'The creator’s app asks the video API for an upload. The API creates a video record with status "uploading", starts a multipart upload in object storage and returns a signed URL for each part.',
        tradeoff:
          'Signed URLs let the file bypass our servers entirely, so API servers never hold gigabytes in memory or tie up connections for minutes. The cost is that the API must trust storage events to know what arrived, and the URLs must expire quickly.',
        nodes: ['creator', 'api', 'meta', 'raw'],
        travel: [
          ['creator', 'api'],
          ['api', 'meta'],
          ['api', 'raw'],
        ],
        short: 'Start upload',
        metrics: { users: '20M', requestsPerSecond: '300', p95Latency: '120 ms', errorRate: '0%' },
        load: { api: 15, meta: 10 },
      },
      {
        title: 'Send parts straight to storage',
        narration:
          'The app splits the file into parts of 16 MB and uploads several at a time, each with a checksum. A failed part is retried on its own; after a dropped connection the app asks the API which parts already arrived.',
        tradeoff:
          'Parts make a multi-gigabyte upload resumable and parallel, so a flaky connection costs one part rather than the whole file. The price is more client logic and parts to clean up when an upload is abandoned, which a lifecycle rule handles.',
        nodes: ['creator', 'raw'],
        travel: [['creator', 'raw', 'parts']],
        short: 'Upload parts',
        metrics: { users: '20M', requestsPerSecond: '300', p95Latency: '120 ms', errorRate: '0%' },
        load: { raw: 40 },
      },
      {
        title: 'Complete and queue processing',
        narration:
          'When every part is in, the app calls complete with the list of parts and their checksums. The API records the status "processing" and the complete time, then asks storage to assemble the original file, which storage only does on that explicit request. Storage emits an event once the file exists, and the event queues a processing job.',
        tradeoff:
          'Queues between upload and transcoding absorb bursts of uploads and survive worker crashes: the job waits in one queue until a workflow starts, and its tasks wait in another until a transcoder is free. They add a little delay before work starts, which is small next to the minutes transcoding takes.',
        nodes: ['creator', 'api', 'meta', 'raw', 'queue'],
        travel: [
          ['creator', 'api'],
          ['api', 'meta'],
          ['api', 'raw'],
          ['raw', 'queue'],
        ],
        short: 'Queue job',
        metrics: { users: '20M', requestsPerSecond: '300', p95Latency: '120 ms', errorRate: '0%' },
        load: { raw: 40, queue: 25 },
      },
      {
        title: 'Split and transcode in parallel',
        narration:
          'The job first writes a plan: the video as 4-second ranges of frames, grouped into tasks of about a minute. Transcoders pull tasks from a queue. Each task names the original and a range; the transcoder seeks to the source keyframe before the range, decodes, and encodes the range into the four rungs of the base ladder, 240p to 720p, with a keyframe forced at every 4-second boundary so all rungs switch at the same points. Audio is encoded once per video in its own task, and 1080p is added only once a video passes a view threshold. Transcoders run on Spot instances, which are cheap but can be reclaimed, and in an isolated network, because an uploaded file can be crafted to attack a decoder.',
        tradeoff:
          'Transcoding a long video on one machine can take longer than the video itself. Tasks spread the work across hundreds of machines so even long videos are ready in minutes, at the cost of an orchestrator that tracks every task and retries failures. Tasks of about a minute are also what make Spot safe: a task encodes in about half a minute, so a reclaimed instance usually finishes it inside the notice and at worst loses one task per worker, not an hour.',
        nodes: ['queue', 'transcode'],
        travel: [['queue', 'transcode']],
        short: 'Transcode',
        metrics: { users: '20M', requestsPerSecond: '300', p95Latency: '120 ms', errorRate: '0%' },
        load: { queue: 30, transcode: 85 },
        traffic: [{ edge: ['queue', 'transcode'], kind: 'heavy' }],
      },
      {
        title: 'Package segments and manifests',
        narration:
          'The output of every task is CMAF segments of 4 seconds, which HLS and DASH players both read, kept under a path that belongs to this attempt and contains a random token. When every task is done, the packager checks that every segment is there and writes the manifests that list every rendition.',
        tradeoff:
          'Small segments let the player switch quality often and start fast, but mean many more files and requests. A few seconds per segment is the usual balance. Storing the base ladder adds about 60% of the size of the original, because each rung is encoded at a much lower bitrate than the source.',
        nodes: ['transcode', 'packager', 'segments'],
        travel: [
          ['transcode', 'packager'],
          ['packager', 'segments'],
        ],
        short: 'Package',
        metrics: { users: '20M', requestsPerSecond: '300', p95Latency: '120 ms', errorRate: '0%' },
        load: { transcode: 60, packager: 45, segments: 30 },
      },
      {
        title: 'Mark the video ready',
        narration:
          'Once every segment and manifest is written, the packager sets the status to "ready" and stores the manifest path in the metadata database, in one conditional write. Only then can a viewer learn the path. The creator is notified.',
        tradeoff:
          'Flipping the status only after all renditions exist means viewers never hit a missing segment. A faster alternative publishes the lowest quality first and adds higher ones as they finish, which gets the video out sooner at the cost of a manifest that changes.',
        nodes: ['packager', 'meta'],
        travel: [['packager', 'meta', 'ready']],
        short: 'Ready',
        metrics: { users: '20M', requestsPerSecond: '300', p95Latency: '120 ms', errorRate: '0%' },
        load: { packager: 20, meta: 15 },
      },
      {
        title: 'Sweep for stuck videos',
        narration:
          'Every five minutes a sweeper queries the metadata database for videos in "processing" that are not moving: no workflow started two minutes after complete, or no stage finished for fifteen minutes. The first has its job put back on the job queue, unless that queue is backed up behind a starter that is down; after three tries with no workflow the video is marked failed. The second waits until the stalled workflow has ended, which task timeouts force, and then starts the next attempt; after three attempts in all the video is marked failed.',
        tradeoff:
          'Storage events arrive at least once but can be late, and we assume one can be lost on the way to the queue; the API can also crash between recording "processing" and asking storage to assemble the file. Without a sweeper such a video waits forever. The sweeper adds a small job and a query every few minutes, and a second run is harmless because each attempt writes under its own path and only one publish can win.',
        nodes: ['sweeper', 'meta'],
        travel: [['sweeper', 'meta']],
        short: 'Sweeper',
        metrics: { users: '20M', requestsPerSecond: '300', p95Latency: '120 ms', errorRate: '0%' },
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
          'Before any CDN, the player fetches every segment from segment storage in one region. A popular release draws four million viewers at once, storage bandwidth saturates, viewers far away wait seconds for each segment and playback stalls.',
        tradeoff:
          'More bandwidth in one region does not shorten the distance to viewers on other continents, and paying for origin traffic on every view of the same popular segments is wasteful. The same few segments are watched over and over, which is exactly what edge caches are for.',
        nodes: ['viewer', 'segments'],
        travel: [['viewer', 'segments']],
        short: 'Storage melts',
        metrics: {
          users: '20M',
          requestsPerSecond: '2M',
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
        metrics: { users: '20M', requestsPerSecond: '2M', p95Latency: '400 ms', errorRate: '0.2%' },
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
        metrics: { users: '20M', requestsPerSecond: '2M', p95Latency: '400 ms', errorRate: '0.2%' },
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
          label: 'POST /videos {title, size 2 GB, idempotency key}',
          note: 'Only a signed-in creator, with a per-creator upload limit. A retry with the same key returns the same video. The size picks the part count: 2 GB in parts of 16 MB is 125 parts.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'INSERT video v91, status uploading',
          note: 'The video id is created here, one per idempotency key, and every later key is derived from it. A retried create returns the same video and starts the multipart upload if the record has none yet.',
        },
        {
          from: 'api',
          to: 's3',
          label: 'CreateMultipartUpload raw/v91',
          note: 'Returns an upload id. The API then signs one URL per part, valid for an hour at most; GET /videos/v91/upload returns fresh ones.',
        },
        {
          from: 'app',
          to: 's3',
          label: 'PUT part 1..125 with checksum, 4 at a time',
          note: 'S3 rejects a part whose checksum does not match. After a dropped connection the app asks the API which parts arrived and sends only the rest.',
        },
        {
          from: 'app',
          to: 'api',
          label: 'POST /videos/v91/complete {parts, checksums}',
          note: 'Keyed by the video id, so a retry after a timeout never creates a second video: it finds the record below and, if raw/v91 exists, returns the same answer. If the original is not there yet, it repeats the assemble; an answer of NoSuchUpload means the first call may still be finishing, so the API checks for the original again and does not treat it as a refusal.',
        },
        {
          from: 'api',
          to: 'db',
          label: 'UPDATE status=processing WHERE status=uploading',
          note: 'Written before storage is called, with the complete time and the part list, so a crash after this line leaves a record the sweeper can finish.',
        },
        {
          from: 'api',
          to: 's3',
          label: 'CompleteMultipartUpload',
          note: 'S3 assembles the original only on this explicit call. The answer can carry an error after a 200, so the API reads its body, and answers Carla only once the object is stored across zones. If S3 refuses the part list (InvalidPart, InvalidPartOrder or EntityTooSmall), the API puts the status back to uploading with a conditional write and drops the saved list and the complete time, so the app can correct it and call complete again.',
        },
      ],
    },
    {
      id: 'process',
      title: 'Process the upload',
      kind: 'queue',
      summary:
        'The new original triggers a workflow that plans the video as one-minute tasks, transcodes every task into every rung on Spot instances, writes the manifests, and flips the video to ready once.',
      runsOn:
        'S3 event → EventBridge → SQS → Lambda → Step Functions → SQS task queue → ECS on EC2 Spot → S3 → Aurora',
      participants: [
        { id: 's3raw', label: 'Raw storage', service: 'S3 + EventBridge' },
        { id: 'sqs', label: 'Job queue', service: 'SQS' },
        { id: 'sfn', label: 'Orchestrator', service: 'Step Functions' },
        { id: 'enc', label: 'Transcoders', service: 'ECS on EC2 Spot' },
        { id: 'seg', label: 'Segment storage', service: 'S3' },
        { id: 'db', label: 'Metadata', service: 'Aurora PostgreSQL' },
      ],
      steps: [
        {
          from: 's3raw',
          to: 'sqs',
          label: 'Object Created raw/v91',
          note: 'Delivered at least once, usually within seconds. A message the starter cannot handle ends in a dead-letter queue.',
          style: 'async',
        },
        {
          from: 'sqs',
          to: 'sfn',
          label: 'StartExecution name=v91-enc3-1',
          note: 'A small Lambda reads the queue, starts a Standard workflow and records the start on the video. The name is the video id, the encoding version and the attempt. A duplicate message gets the running execution back, or an error once it has closed, so it never starts a second workflow.',
        },
        {
          from: 'sfn',
          to: 'enc',
          label: 'plan: 500 segments → 34 video tasks + 1 audio',
          note: 'A 2,000-second video is 500 segments of 4 s. A task is 15 segments, one minute of video, in all four rungs. Tasks wait in a second queue with a callback token and a timeout of 30 minutes from the moment they are queued; transcoders pull them, and a Spot interruption loses at most one task per worker. The queue keeps a message for the same 30 minutes, so a task whose workflow has timed out is not encoded later.',
        },
        {
          from: 'enc',
          to: 'seg',
          label: 'PUT v91/enc3-k7p2/720p/seg-0017.m4s',
          note: 'The path carries a random token chosen by this attempt, and the write is conditional (If-None-Match): S3 refuses it if the object exists, so a retried task never replaces a segment. Decoding runs in a sandbox with no network, because a crafted file can attack a decoder.',
        },
        {
          from: 'sfn',
          to: 'seg',
          label: 'package: check segments, write manifests',
          note: 'The packager checks that all 2,500 segments exist (500 in each of four rungs and in audio), with the init segment of each of the five tracks, and writes an HLS and a DASH manifest. Nothing under the path changes afterwards, so the CDN can cache it for a long time.',
        },
        {
          from: 'sfn',
          to: 'db',
          label: 'UPDATE ready + manifest WHERE status=processing',
          note: 'The only path to ready, after every object exists. A retried publish finds its own manifest already recorded and succeeds; an attempt that lost the race finds another manifest and stops.',
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
          note: 'There are about 2,000 plays per upload, so the primary never sees plays. An entry lives 30 s while a video is processing and a few minutes once it is ready.',
        },
        {
          from: 'api',
          to: 'player',
          label: '{title, status ready, manifest URL}',
          note: 'The manifest URL contains the token and is returned only for a ready video. From here on the API is out of the path: an API outage does not stop a video that is already playing.',
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
          label: 'buffer 6 s, throughput 8 Mbps → 720p',
          note: 'Adaptive bitrate: the player measures each download and its buffer, and steps up or down for the next 4-second segment. 720p is the top rung until this video earns 1080p.',
        },
        {
          from: 'player',
          to: 'edge',
          label: 'GET 720p seg 3, 4, …',
          note: 'Two requests every 4 s per viewer, one video segment and one audio segment: 2M requests a second at the peak, 95% answered from the edge cache.',
        },
      ],
    },
    {
      id: 'edge-miss',
      title: 'An edge miss',
      kind: 'sync',
      summary:
        'A video goes viral in a region whose edges never served it. Thousands of misses for the same segment become as little as one read from S3, through the regional shield.',
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
          note: 'Every edge in the world misses toward the same shield region, so a viral video costs the origin as little as one read per segment, not one per edge.',
        },
        {
          from: 'shield',
          to: 's3',
          label: 'GetObject v91/enc3-k7p2/720p/seg-0001.m4s',
          note: 'Only CloudFront can read the bucket, through Origin Access Control; the bucket is not public.',
        },
        {
          from: 'shield',
          to: 'edge',
          label: 'segment, Cache-Control: max-age 1 year',
          note: 'Safe to cache for a year because the path belongs to one attempt and its objects are never replaced.',
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
        'Every five minutes a sweeper finds videos in processing that are not moving toward ready, and queues them again. It covers a lost event, an API that crashed in the middle of complete and a workflow that died.',
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
          label: 'processing: no workflow after 2 min, or no stage for 15 min',
          note: 'The age of the oldest such video is published as a metric and alarmed. An upload still in uploading after 7 days is marked failed, when the lifecycle rule deletes its parts. The same query finds a 1080p upgrade that started more than 15 minutes ago and has not finished; once its last execution has ended, the sweeper starts it again, up to three times.',
        },
        {
          from: 'sweeper',
          to: 's3',
          label: 'HeadObject raw/v91',
          note: 'For a video with no workflow. If the original exists, the event was lost and the job is queued as attempt 1, the name a late event would use. If it is missing, the API crashed before storage assembled the file, and the sweeper repeats the complete with the saved part list, checking for the original first if S3 answers NoSuchUpload. While the oldest message in the job queue is older than two minutes the starter is down, so the sweeper queues nothing and counts nothing; otherwise each try is counted on the video, and after three tries with no workflow the video is marked failed.',
        },
        {
          from: 'sweeper',
          to: 'sqs',
          label: 'enqueue v91, attempt 2',
          note: 'For a stalled video, and only after its last execution has ended. The attempt number is raised with a conditional write, so two sweeper runs cannot start two attempts. If the sweeper crashes between that write and the enqueue, the next run finds an attempt with no execution and queues that same attempt again; the execution name makes the repeat harmless. After three attempts in all the video is marked failed. The path of an attempt that did not publish is deleted only once the video is ready on another path, or failed.',
        },
      ],
    },
    {
      id: 'spot',
      title: 'A Spot instance is reclaimed',
      kind: 'direct',
      summary:
        'EC2 reclaims a Spot instance in the middle of a task. The worker hands its unfinished task back to the queue and another worker takes it, without counting as an encoder error. A task that fails in the encoder three times fails the workflow, and the video is marked failed.',
      runsOn: 'EC2 Spot → ECS worker → SQS task queue → another worker → S3',
      participants: [
        { id: 'ec2', label: 'Spot instance', service: 'EC2' },
        { id: 'queue', label: 'Task queue', service: 'SQS' },
        { id: 'enc', label: 'Transcoder', service: 'ECS on EC2 Spot' },
        { id: 'seg', label: 'Segment storage', service: 'S3' },
        { id: 'sfn', label: 'Orchestrator', service: 'Step Functions' },
      ],
      steps: [
        {
          from: 'ec2',
          to: 'enc',
          label: 'two-minute interruption notice',
          note: 'The worker stops taking tasks. A one-minute task encodes in about 30 s, so most finish inside the notice. A task that will not finish is handed back: the worker sets the visibility timeout of its message to zero.',
          style: 'async',
        },
        {
          from: 'queue',
          to: 'enc',
          label: 'task 17 visible again at once',
          note: 'The message was never deleted, so the queue hands it to a worker on another instance. A worker that dies with no notice cannot hand anything back; its task reappears when the visibility timeout of 2 minutes ends. A worker extends that timeout while it is still encoding, so a long audio task is not handed out twice. Nothing partial is visible: an S3 PUT stores the whole object or nothing.',
          style: 'async',
        },
        {
          from: 'enc',
          to: 'seg',
          label: 'PUT v91/enc3-k7p2/720p/seg-0241.m4s',
          note: 'Task 17 is segments 241 to 255. Those the first worker already wrote are refused as existing and skipped; the rest are written under the same path.',
        },
        {
          from: 'enc',
          to: 'sfn',
          label: 'SendTaskSuccess with the callback token',
          note: 'An interruption is never reported as an error. An encoder error is: after three on the same task the workflow fails, the video is marked failed, the creator is told, and the original stays for a replay after an encoder fix. A task delivered five times, interruptions included, goes to a dead-letter queue, where a small consumer calls SendTaskFailure so the workflow fails at once.',
          style: 'reply',
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
          name: 'Split into one-minute tasks, transcode in parallel',
          pros: 'Time to ready grows slowly with length, as long as there are workers to add; a failure retries one task.',
          cons: 'Needs an orchestrator, and segment boundaries that match across rungs.',
        },
      ],
      choice:
        'Parallel transcoding of one-minute tasks, modeled as a small graph (plan, transcode each minute of video into every rung, encode audio, package, publish), with every task safe to repeat: a segment write never replaces an existing object, and publish is one conditional write.',
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
        'A small base ladder for every upload (240p, 360p, 480p and 720p), and 1080p and more efficient encodings only once a video passes a view threshold. Plays are counted from player beacons in hourly batches. Past the threshold a second workflow writes the new rungs under a new encoding version with its own manifest, and one conditional write swaps the manifest path; players already running keep the old manifest. The new manifest lists the base rungs where they already are and the new rung under the new path, so nothing is encoded twice or copied, and a path is deleted only when no published manifest points into it. The upgrade is recorded on the video with its start time; the sweeper starts again one that has not finished after fifteen minutes, once its last execution has ended and up to three times; then the upgrade is dropped. A failed upgrade never changes the status, so the video stays ready on its base ladder. The originals are kept, so any rendition can be produced later.',
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
          pros: 'A compromised decoder can read its input and write its output on local disk, nothing else.',
          cons: 'Network rules, narrow roles and time limits to maintain.',
        },
      ],
      choice:
        'Isolate. The decoder runs in a sandbox with no network. The worker around it fetches the input and stores the output with short-lived credentials scoped to that video’s original and that attempt’s output path. Workers sit in private subnets with no internet access, with a size and duration check first and a timeout per task. Upload URLs are signed per part, expire within an hour, and are issued only to signed-in creators under a per-creator limit. The buckets are private: only CloudFront reads segments, under a path with a random token that the API reveals once the video is ready.',
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
          cons: 'Billed per minute of output, and four rungs over 400 million seconds of video a day are about 27 million output minutes a day; less control over task size and priorities.',
        },
        {
          name: 'Our own transcoders on Spot instances',
          pros: 'Thousands of cores at a fraction of on-demand price, full control of codecs, ladders and priorities.',
          cons: 'An orchestrator, interruption handling and encoder upgrades to own.',
        },
      ],
      choice:
        'Our own pipeline of one-minute tasks on Spot at this volume, because compute is the first bottleneck, and a price per output minute would turn it from the smallest line of the bill into one of the largest. At MVP volume, MediaConvert or the single worker per video is simpler, and MediaConvert stays useful for rare formats.',
    },
  ],
  wrapUp:
    'Resumable multipart uploads straight to object storage, a queued pipeline that transcodes one-minute tasks in parallel, segments and manifests for adaptive bitrate, metadata kept apart from media, and a CDN with a shield layer serving almost every byte.',
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
          'An upload can be resumed and retried safely. Create carries an idempotency key, sending a part again replaces the same part number, and complete is keyed by the video id: a retry after a timeout checks that the original exists and returns the same result instead of creating a second video. A complete whose part list storage refuses puts the video back in uploading, so a corrected retry works.',
      },
      {
        property: 'Processing',
        promise:
          'Every completed upload is processed at least once, made harmless by two rules: each attempt writes under its own path (video id, encoding version, random token) with writes that never replace an existing object, and only one attempt can publish. A sweeper re-queues any video in "processing" that has no workflow or whose workflow died; after three tries with no workflow, or three attempts in all, the video is marked failed.',
      },
      {
        property: 'Publish consistency',
        promise:
          'A video is shown as ready only after every segment and the manifest of its ladder are in storage. Ready is one conditional write from processing that records the manifest path, and segments and manifests are never replaced once written, so a manifest never points at a segment that does not exist and the CDN can cache both for a long time. The path is unguessable until that write, so nothing unpublished can be fetched.',
      },
      {
        property: 'Playback availability',
        promise:
          'Playback of a published video depends only on the CDN and segment storage. Once the player has the manifest, an outage of the API, the metadata database or the whole processing pipeline does not interrupt it.',
      },
    ],
    assumes: [
      'Object storage replicates across zones before it acknowledges a write, and a new object is readable right after its write returns.',
      'Storage events arrive at least once and can be late or duplicated. We also assume one can be lost on the way to the queue; the sweeper covers that case.',
      'Every transcoder decodes from the source keyframe before its range and encodes with pinned settings, a forced keyframe every 4 s and closed groups of pictures, so segments made by different tasks, or by a retry, join cleanly.',
      'The CDN honors cache headers and collapses concurrent misses for the same object into one origin fetch.',
      'Players retry failed segment requests and can drop to a lower rendition.',
    ],
    doesNotGuarantee: [
      'A hard bound on time to ready. Minutes is the typical case; a burst of uploads turns into queue time, and a backlog longer than the 30-minute task timeout turns into failed workflows and new attempts.',
      'Exactly-once processing. Tasks and notifications can repeat; conditional writes make the repeat harmless.',
      'The full quality ladder from the first view. 1080p is added only after a video passes the view threshold.',
      'Fresh metadata on every read. A cached entry lives 30 s while a video is processing and a few minutes once it is ready, and publish deletes it; a fill that races the delete is bounded by the same 30 s. So a video can show as processing briefly after it is ready, and an edit to a title takes minutes to appear.',
      'Stall-free playback. Adaptive bitrate lowers quality to avoid stalls, but cannot fix a connection slower than the lowest rung.',
      'That an abandoned upload can be resumed forever. Parts without a complete are deleted by the lifecycle rule after 7 days, and the video is marked failed.',
    ],
  },
  failures: [
    {
      scenario: 'The connection drops in the middle of an upload, or the creator never comes back.',
      impact:
        'The video stays in "uploading". The parts already sent are safe but invisible, and they cost storage for as long as they are kept.',
      detection:
        'The client sees the failed part. On the server side, a count of uploads older than a day that are still in "uploading", and the bytes held in incomplete multipart uploads, reported daily.',
      recovery:
        'On reconnect the app asks the API which parts arrived, gets fresh signed URLs, and sends only the missing parts. If nobody returns, the lifecycle rule deletes the parts after 7 days and the sweeper marks the video "failed".',
    },
    {
      scenario:
        'The API crashes after recording "processing" but before storage assembles the file, or storage assembles it and the event never reaches the queue.',
      impact:
        'The video shows "processing" but no workflow exists. It would sit there forever while the creator waits.',
      detection:
        'The sweeper finds videos in "processing" with no workflow started two minutes after complete. The age of the oldest such video is an alarmed metric.',
      recovery:
        'If the original exists, the sweeper queues the job under the name a late event would use, so the two cannot start two workflows. If it does not, the sweeper repeats the complete with the saved part list. Tries are not counted while the job queue is backed up behind a starter that is down; after three tries with no workflow the video is marked "failed". Otherwise the video continues to "ready" two to seven minutes late: the two-minute rule plus up to one sweep interval.',
    },
    {
      scenario:
        'A transcoder dies in the middle of a task, or one task makes the encoder fail every time.',
      impact:
        'Some segments are missing, so the video cannot be packaged. A task that always fails would block the video forever if retried without limit.',
      detection:
        'A worker with a notice hands its task back at once; a task lost without notice reappears when its visibility timeout of 2 minutes ends; an encoder error is reported to Step Functions. The retry rate and the age of the oldest waiting task are tracked; a task that reaches its limit fails the workflow.',
      recovery:
        'Another transcoder takes the task. An object write is all or nothing, so a half-written segment is never visible, and segments that already exist are skipped. An interruption is not an encoder error. After three encoder errors on a task the workflow fails. A task that kills its worker never reports anything, so the queue counts deliveries, interruptions included, which is why that limit is five and not three: at the fifth the task goes to a dead-letter queue and a small consumer reports the failure to Step Functions. Either way the video is marked "failed", the creator is told, and the original is kept so the job can be replayed after an encoder fix.',
    },
    {
      scenario:
        'The packager crashes after writing the segments but before setting the status to "ready".',
      impact:
        'Every segment is in storage but the video still shows "processing". Viewers cannot reach it; nothing is exposed half-finished.',
      detection:
        'The publish task times out and is retried. Time from complete to ready, at P95, has an alarm at 7 minutes, and the sweeper catches a workflow that died with all its segments written.',
      recovery:
        'The retried task finds the segments and manifests in place, then flips the status with a write that only applies if the status is still "processing". A second flip changes nothing. If the whole workflow died, the next attempt encodes again under a new path, and the old path is deleted only once the video is ready on another path, or failed. The creator notification may be sent twice and is deduplicated by video id.',
    },
    {
      scenario: 'A CDN region fails or loses its cache while a popular video is being watched.',
      impact:
        'Viewers are routed to farther edges that do not have the segments, so misses surge toward storage. Start time and stalls rise, and players step down in quality.',
      detection:
        'Edge hit ratio drops and GET requests on the segment bucket jump. Player telemetry shows the stall ratio and start time by region.',
      recovery:
        'The shield collapses concurrent misses for the same segment into as little as one origin read. If one prefix is still pushed too fast, storage answers 503 Slow Down and players retry. Edges refill within minutes because a popular video is a small set of segments. No data is at risk; the system returns to its normal hit ratio by itself.',
    },
    {
      scenario: 'The primary of the metadata database fails.',
      impact:
        'New uploads cannot start and status changes cannot be written until a replica is promoted. Plays of videos whose metadata is cached or on a replica keep working, and playback already in progress is untouched.',
      detection:
        'Write errors on the API, health checks and replication lag. In the pipeline, a rising count of publish retries.',
      recovery:
        'A replica is promoted. Publish tasks retry until their conditional write succeeds, so finished videos become ready late but none is skipped. Parts already in storage stay valid, and the app retries create and complete with the same idempotency key and video id.',
    },
  ],
  capacity: {
    assumptions: [
      '20 million daily viewers, with 4 million watching at the peak (a popular release) and about 1 million on average.',
      'A viewer starts a new play about every 20 s of watching (short videos, skips and early exits), and each play is one metadata request.',
      'Segments are 4 s long and the average delivered bitrate is 2.5 Mbps: popular videos, which have 1080p at about 5 Mbps, carry most of the watch time, and phones on 360p and 480p pull the average down.',
      '2 million uploads a day, 200 s long on average at 8 Mbps, sent in parts of 16 MB, with a peak of three times the average rate.',
      'The base ladder is four video rungs (240p at 0.3 Mbps, 360p at 0.7, 480p at 1.2 and 720p at 2.4) and one audio track at 128 kbps, about 4.7 Mbps in all; encoding it costs about 2 core-seconds per second of video.',
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
        math: '4.3B plays ÷ 2M uploads ≈ 2,150. Uploads are 2M ÷ 86,400 s ≈ 23/s on average, ~70/s at peak. Seven metadata writes per upload ≈ 160 writes/s, so about 300 reads per write',
      },
      {
        label: 'Segment requests and egress',
        value: '2M requests/s, ~10 Tbps at peak',
        math: '4M viewers × 2 tracks (video and audio) ÷ 4 s per segment = 2M requests/s. 4M × 2.5 Mbps = 10 Tbps',
      },
      {
        label: 'Origin load behind the CDN',
        value: '~100K requests/s',
        math: '2M requests/s × 5% misses = 100K/s at the edges, before the shield collapses repeated misses',
      },
      {
        label: 'Ingest and storage',
        value: '~37 Gbps in, ~640 TB a day',
        math: '200 s × 8 Mbps ÷ 8 = 200 MB per upload × 2M = 400 TB/day ≈ 37 Gbps, in 200 ÷ 16 ≈ 13 parts × 23 uploads/s ≈ 300 part uploads/s. Base ladder: 4.7 ÷ 8 ≈ 0.6 × 400 TB ≈ 240 TB/day',
      },
      {
        label: 'Transcoding compute',
        value: '~9K cores average, ~28K at peak',
        math: '2M uploads × 200 s = 400M s of video/day ÷ 86,400 ≈ 4,600 s of video per second × 2 core-seconds ≈ 9,300 cores, × 3 at peak',
      },
      {
        label: 'Transcode tasks',
        value: '~100 tasks/s, ~300/s at peak',
        math: '400M s of video ÷ 60 s per task ≈ 6.7M video tasks + 2M audio tasks ≈ 8.7M a day ÷ 86,400 ≈ 100/s. One task is 60 s × 2 core-seconds = 120 core-seconds, about 30 s on four cores',
      },
      {
        label: 'Segment objects',
        value: '~500M new objects a day',
        math: '400M s of video ÷ 4 s per segment × 5 tracks (four video rungs and audio) = 500M ≈ 5,800 writes/s. Init segments and manifests add about a dozen small objects per video, 24M more',
      },
    ],
    implications: [
      'Ingest is tens of gigabits a second of long-lived transfers, so the bytes go straight to object storage with signed URLs and the API handles only small control requests.',
      'Peak egress is in the terabits, far beyond one region and mostly repeated bytes. A CDN is required, not an optimization, and the 5% that misses is still 100K requests a second, which is why a shield sits in front of storage.',
      'There are about 2,000 plays per upload and each record is around a kilobyte, so metadata is served from cache and read replicas while one primary takes the writes.',
      'Transcoding needs thousands of cores on average and three times that at peak. That is hundreds of machines, which only pays off if the fleet scales with the queue and can use cheap, interruptible capacity; tasks of a minute that are safe to repeat make that possible. A hundred tasks a second is also too many to launch one container each, so long-running workers pull them from a queue.',
      'Storage grows by hundreds of terabytes a day and most of it is originals and renditions of videos that are rarely watched. That forces the small base ladder with more rungs only on demand, and a colder storage class for originals after 30 days.',
      'Hundreds of millions of small objects a day make listing useless, so every key is derived from the attempt’s path, the rendition and the segment number, and nothing in the read path ever lists a bucket.',
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
        why: 'Small control requests only: create, resume, complete, metadata. The bytes never pass through it.',
        watch:
          'TargetResponseTime and HTTPCode_Target_5XX_Count; WAF BlockedRequests on upload creation.',
      },
      {
        part: 'Raw storage and uploads',
        service: 'Amazon S3 multipart upload with presigned part URLs; lifecycle rules',
        why: 'Resumable, parallel uploads straight from the creator, checksums per part, durable across zones on complete. One rule aborts incomplete uploads after 7 days; another moves originals to S3 Standard-IA 30 days after upload, because lifecycle rules act on age, not on processing.',
        watch:
          'Bytes in incomplete multipart uploads (S3 Storage Lens, reported daily); 4xxErrors and 5xxErrors from S3 request metrics, which are turned on per bucket.',
      },
      {
        part: 'Events and queues',
        service:
          'S3 Event Notifications to Amazon EventBridge, then an Amazon SQS start queue; a second SQS queue for transcode tasks; a dead-letter queue behind each',
        why: 'The start queue outlives a failing starter, and the task queue is the buffer between bursts of uploads and the transcoders. Events are at least once, which the workflow names make harmless.',
        watch:
          'ApproximateAgeOfOldestMessage on the task queue, the first sign of a transcoding shortfall. On the start queue the same metric shows a starter that stopped. Both have alarms.',
      },
      {
        part: 'Orchestrator',
        service:
          'AWS Step Functions Standard workflows, started by a Lambda that reads the start queue; tasks sent to SQS with a callback token',
        why: 'Plan, transcode every minute of video into every rung, package, publish, with retries per task, a timeout of 30 minutes per task counted from the moment it is queued, a progress timestamp per stage and a visible state per video.',
        watch:
          'ExecutionsFailed, ExecutionsTimedOut, ExecutionThrottled and ExecutionTime per state machine.',
      },
      {
        part: 'Transcoders',
        service:
          'Amazon ECS on Amazon EC2 Spot, several instance types, private subnets with no internet access',
        why: 'Thousands of cores at a fraction of on-demand price. Long-running workers pull one-minute tasks, so an interruption costs at most one task per worker, about half a minute of work, and the fleet scales on the age of the oldest task.',
        watch:
          'Spot interruption rate, task failures per encoder version, tasks in the dead-letter queue.',
      },
      {
        part: 'Plan and package',
        service: 'The same ECS workers on a small on-demand capacity provider',
        why: 'Two short steps every video runs once: probe the original and write the plan, then check the segments and write the manifests. On-demand, so an interruption never delays a whole video.',
        watch: 'Duration of the plan and package steps.',
      },
      {
        part: 'Segment storage',
        service:
          'Amazon S3, keys made of video id, encoding version and attempt token, then rendition and segment number',
        why: 'Objects are written once, with conditional writes, and read only by CloudFront; nothing in the read path lists the bucket.',
        watch:
          '503 Slow Down responses, counted in 5xxErrors, which mean a prefix is taking requests faster than S3 has scaled for; GetRequests as the origin load.',
      },
      {
        part: 'Delivery',
        service: 'Amazon CloudFront with Origin Shield, Origin Access Control to the bucket',
        why: 'Terabits of egress from the edge, a regional shield that collapses misses, and a bucket that is not public.',
        watch:
          'CacheHitRate and OriginLatency, which are additional metrics turned on per distribution; 4xxErrorRate and 5xxErrorRate. CloudFront metrics are global, so views by region come from player beacons.',
      },
      {
        part: 'Metadata',
        service: 'Amazon Aurora PostgreSQL with read replicas, Amazon ElastiCache in front',
        why: 'About 160 writes a second on one primary (seven per upload at 23 uploads a second: create, complete, workflow start, three stage timestamps and ready); 200K reads a second from cache and replicas.',
        watch: 'AuroraReplicaLag, CommitLatency, and the cache hit rate.',
      },
      {
        part: 'Sweeper and notifications',
        service:
          'Amazon EventBridge Scheduler and AWS Lambda; Amazon SNS for creator notifications',
        why: 'The backstop for lost events, a complete that crashed halfway and dead workflows; it also deletes the paths of attempts that did not publish, once the video is ready on another path or failed. SNS carries the "your video is ready" message, deduplicated by video id.',
        watch:
          'Custom metrics: age of the oldest stuck video, time from complete to ready, and videos marked failed against videos completed.',
      },
      {
        part: 'Player telemetry',
        service:
          'Player beacons into Amazon Data Firehose, queried with Amazon Athena; key ratios as CloudWatch metrics',
        why: 'Start time and stalls are only visible from the player; they are the SLOs. Plays per video, counted hourly, drive the view threshold for 1080p.',
        watch:
          'Start time p95 and rebuffer ratio per region, CDN and rung; segment requests answered 403 or 404, per video.',
      },
      {
        part: 'Security and cost',
        service:
          'IAM roles per stage with a session policy per task, AWS KMS for the raw bucket, AWS CloudTrail, AWS Cost Explorer',
        why: 'Each task reads one original and writes one attempt path. The bill is egress, then storage, then Spot compute, which is why the ladder starts small and originals move to a colder class.',
        watch: 'CloudFront, S3 and EC2 as separate lines in Cost Explorer.',
      },
    ],
    limits: [
      'An S3 multipart upload has at most 10,000 parts, each at least 5 MiB except the last, so part size grows with file size; parts of 16 MB cover files up to 160 GB, and the 2 GB example is 125 parts.',
      'A presigned URL lasts at most 7 days when signed with long-term credentials, and dies with the credentials when signed with temporary ones. The API signs with its task role, whose credentials rotate every 1 to 6 hours, so upload URLs are valid for an hour at most and the app asks for fresh ones when one is refused.',
      'S3 serves at least 3,500 writes and 11,000 reads a second per partitioned prefix and adds partitions as traffic grows, answering 503 Slow Down in the meantime. A slash in a key means nothing to it; keys here start with the video id, so requests spread over many prefixes. 500M new objects a day is about 5,800 writes a second.',
      'A Spot instance gets a two-minute notice before it is reclaimed, which is why a task is one minute of video and encodes in about 30 s. The visibility timeout on the task queue is 2 minutes, below the 3-minute backlog alarm; a worker extends it while it encodes and, with a notice, hands its task back at once. The queue keeps a message for 30 minutes, the same as the task timeout.',
      'Starting a Standard workflow again with the same name and input returns the running execution, and fails with ExecutionAlreadyExists once it has closed; the name can be reused only 90 days later. That makes the name an idempotency key for starting a workflow.',
      'An inline Map state runs at most 40 iterations at once, so a two-hour video (120 tasks) runs 40 tasks at a time. A Distributed Map runs 10,000, but only 1,000 Map Runs can be open per account, fewer than the videos in flight here.',
      'By default Step Functions accepts about 300 new Standard executions a second in the three largest regions and 150 elsewhere; the peak of 70 uploads a second fits. The tighter quotas are per task: SendTaskSuccess refills at 500 a second in the largest regions and 300 elsewhere, against 300 tasks a second at peak, and state transitions at 5,000 and 800 a second, against a few per task. All three can be raised.',
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
      measure: 'Ready time minus complete time from the metadata database, published as a metric.',
    },
    {
      objective: 'Uploads',
      target: '99.5% of complete calls succeed',
      measure:
        'Answers to complete at the API, leaving out client errors such as a wrong part list.',
    },
    {
      objective: 'Processing',
      target: '99% of completed uploads reach ready',
      measure:
        'Among videos with a complete time, ready against failed, from the metadata database. Abandoned uploads never completed, so they are left out.',
    },
  ],
  alarms: [
    {
      name: 'Processing falling behind',
      metric: 'SQS ApproximateAgeOfOldestMessage on the task queue above 3 min for 5 min',
      meaning:
        'The first bottleneck: not enough transcoding capacity, often a Spot shortage; add instance types or on-demand capacity. It fires while the 10-minute target can still be met.',
    },
    {
      name: 'Slow time to ready',
      metric:
        'Custom: P95 of ready time minus complete time, for videos under 10 minutes long, above 7 min for 15 min',
      meaning:
        'The time-to-ready SLO is at risk without a task backlog: slow plan or package steps, or a throttled workflow.',
    },
    {
      name: 'Stuck videos',
      metric:
        'Custom: oldest video in processing with no workflow or no stage progress, above 30 min',
      meaning: 'Events lost or workflows dying faster than the sweeper fixes them.',
    },
    {
      name: 'Starter stopped',
      metric: 'SQS ApproximateAgeOfOldestMessage on the start queue above 2 min for 5 min',
      meaning:
        'The Lambda that starts workflows is failing or throttled, so nothing new is processed; the sweeper holds its re-queues and counts no tries until the queue drains. No other metric moves, because no video becomes ready.',
    },
    {
      name: 'Failed videos',
      metric: 'Custom: videos marked failed above 0.5% of videos completed, over 15 min',
      meaning:
        'Half the error budget of the processing SLO. Usually a bad encoder release or a new input format; roll back the encoder version. ExecutionsFailed and ExecutionsTimedOut show which attempts died.',
    },
    {
      name: 'Uploads failing',
      metric: 'Custom: complete calls answered with a server error above 0.3% for 10 min',
      meaning:
        'Storage or the metadata primary is refusing writes, so uploads that finished cannot be completed.',
    },
    {
      name: 'Edge hit rate',
      metric: 'CloudFront CacheHitRate below 90% for 10 min',
      meaning: 'Origin load is climbing toward S3 limits; check cache headers and the shield.',
    },
    {
      name: 'Slow starts',
      metric: 'Start time P95 from player beacons above 1.7 s in any region for 10 min',
      meaning:
        'The start-time SLO is close to its 2 s limit: a slow metadata read, or cold edges serving the manifest and first segments.',
    },
    {
      name: 'Viewers stalling',
      metric: 'Rebuffer ratio above 0.4% in any region for 10 min',
      meaning:
        'A CDN or network problem in that region; consider steering traffic or lowering the starting rung.',
    },
    {
      name: 'Delivery errors',
      metric: 'CloudFront 5xxErrorRate above 1% for 5 min',
      meaning:
        'An origin problem, such as storage answering 503 Slow Down; players are retrying and dropping quality.',
    },
    {
      name: 'Missing objects',
      metric:
        'Player beacons: segment requests answered 403 or 404 above 5% for any one ready video, for 5 min',
      meaning:
        'Published segments or manifests are not there: behind Origin Access Control, S3 answers 403 for a missing object. Check for a path deleted while still published. CloudFront 4xxErrorRate covers all videos at once, so at 2M requests a second it only moves when many videos are affected.',
    },
  ],
  evolution: {
    mvp: 'One region, one bucket and a managed CDN in front of it. Uploads already use multipart with signed URLs, because that costs little and is hard to retrofit into clients. Processing is one worker per video with a fixed ladder of three renditions, one fewer than the base ladder at scale, pulled from a queue, with no split into tasks and no orchestrator. Metadata is one database with a replica. This holds for thousands of uploads a day and short videos.',
    atScale: [
      'At 10x uploads, storage cost overtakes everything else. Renditions of rarely watched videos are dropped and rebuilt on demand from the originals, and encoding settings are chosen per video so easy content uses fewer bits.',
      'At 10x viewers, one CDN is a single point of failure and of pricing. A second CDN is added, and the player switches between them using its own measurements.',
      'At 10x, creators far from the region see slow uploads. Parts are accepted by storage in the nearest region and the original is copied to the processing region afterwards.',
      'At 100x, the object count and the request rate per video favor one file per rendition, read with byte ranges, over one object per segment.',
      'At 100x, egress dominates cost. Popular videos are re-encoded with more efficient codecs, where the extra compute is paid back by the bytes saved, and caches are placed inside access networks.',
      'At 100x, the metadata database is sharded by video id; until then one primary with replicas and a cache is enough, because writes are a few hundred a second.',
    ],
    firstBottleneck:
      'Transcoding capacity. It is the only tier where a unit of work costs minutes of CPU, and uploads arrive in bursts, so a spike shows up first as tasks waiting in the queue and a slower time to ready. Storage and delivery are handed to services that scale horizontally, and metadata is small. The fix is to scale transcoders on the age of the oldest task, and to give short videos priority so most creators still see their video within minutes.',
    avoided: [
      'Publishing the lowest rendition first and adding the rest as they finish. It shortens time to ready, but the manifest changes under the players; worth it when time to first view becomes a product goal.',
      'A second CDN with client-side switching. It doubles the integration and testing work; worth it once a single CDN outage is too costly or traffic is large enough to negotiate.',
      'Per-video encoding ladders. They save bits but need an analysis pass per upload; worth it when egress and storage cost more than the extra compute.',
      'Deduplicating identical uploads by content hash. The saving is small for original content and it complicates deletion; worth it if re-uploads become a large share.',
      'Access control on segments (signed playback URLs, encryption). Public videos cache best with plain URLs; needed as soon as private or paid videos exist.',
    ],
  },
};
