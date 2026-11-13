import type { Design } from '../types';

export const videoStreaming: Design = {
  slug: 'video-streaming',
  title: 'Video upload and streaming',
  summary:
    'Let creators upload large video files reliably, turn each one into many qualities in minutes, and let viewers anywhere start playing in a couple of seconds and keep playing smoothly as their connection changes.',
  difficulty: 'Hard',
  requirements: {
    functional: [
      'Upload videos of up to several gigabytes, resuming after a dropped connection.',
      'Process each upload into several resolutions and bitrates for phones, laptops and TVs.',
      'Play a video with quality that adapts to the viewer’s bandwidth.',
      'Show title, description and processing status for each video.',
    ],
    nonFunctional: [
      'Playback starts in about two seconds and rarely stalls.',
      'Views outnumber uploads by thousands to one; popular videos are watched millions of times.',
      'Originals are never lost once an upload completes.',
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
      'Follow a video from the creator’s laptop through storage and the processing pipeline, then follow a viewer pressing play. Press play, or step through the stages.',
    lanes: { top: 'Upload and processing', bottom: 'Playback' },
    nodes: [
      { id: 'creator', title: 'Creator', detail: 'Uploads a file', column: 0, row: 'top' },
      { id: 'raw', title: 'Raw storage', detail: 'Original files', column: 1, row: 'top' },
      { id: 'queue', title: 'Job queue', detail: 'Processing jobs', column: 2, row: 'top' },
      {
        id: 'transcode',
        title: 'Transcoders',
        detail: 'Chunks in parallel',
        column: 3,
        row: 'top',
      },
      { id: 'packager', title: 'Packager', detail: 'Segments, manifests', column: 4, row: 'top' },
      { id: 'api', title: 'Video API', detail: 'Uploads, metadata', column: 1, row: 'middle' },
      { id: 'meta', title: 'Metadata DB', detail: 'Videos, status', column: 3, row: 'middle' },
      {
        id: 'segments',
        title: 'Segment storage',
        detail: 'Every rendition',
        column: 4,
        row: 'middle',
      },
      { id: 'viewer', title: 'Viewer', detail: 'Adaptive player', column: 0, row: 'bottom' },
      { id: 'cdn', title: 'CDN', detail: 'Edge caches', column: 4, row: 'bottom' },
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
      },
      {
        title: 'Send parts straight to storage',
        narration:
          'The app splits the file into parts of a few megabytes and uploads several at a time, each with a checksum. A failed part is retried on its own; after a dropped connection the app asks which parts already arrived.',
        tradeoff:
          'Parts make a multi-gigabyte upload resumable and parallel, so a flaky connection costs one part rather than the whole file. The price is more client logic and parts to clean up when an upload is abandoned, which a lifecycle rule handles.',
        nodes: ['creator', 'raw'],
        travel: [['creator', 'raw', 'parts']],
      },
      {
        title: 'Complete and queue processing',
        narration:
          'When every part is in, storage assembles the original file and emits an event. A processing job is queued and the status moves to "processing".',
        tradeoff:
          'A durable queue between upload and processing absorbs bursts of uploads and survives worker crashes. It adds a little delay before work starts, which is small next to the minutes transcoding takes.',
        nodes: ['raw', 'queue'],
        travel: [['raw', 'queue', 'complete']],
      },
      {
        title: 'Split and transcode in parallel',
        narration:
          'The job splits the original into chunks of a few seconds at keyframes. Many transcoders each take a chunk and encode it into every rung of the quality ladder, from low resolution to high.',
        tradeoff:
          'Transcoding a long video on one machine can take longer than the video itself. Chunks spread the work across hundreds of machines so even long videos are ready in minutes, at the cost of an orchestrator that tracks every chunk and retries failures.',
        nodes: ['queue', 'transcode'],
        travel: [['queue', 'transcode']],
      },
      {
        title: 'Package segments and manifests',
        narration:
          'The packager cuts each rendition into segments of a few seconds in a standard adaptive streaming format, writes them to segment storage and writes a manifest that lists every rendition.',
        tradeoff:
          'Small segments let the player switch quality often and start fast, but mean many more files and requests. A few seconds per segment is the usual balance. Storing every rendition multiplies storage several times over the original.',
        nodes: ['transcode', 'packager', 'segments'],
        travel: [
          ['transcode', 'packager'],
          ['packager', 'segments'],
        ],
      },
      {
        title: 'Mark the video ready',
        narration:
          'Once every rendition is written, the packager sets the status to "ready" and stores the manifest URL in the metadata database. The creator is notified.',
        tradeoff:
          'Flipping the status only after all renditions exist means viewers never hit a missing segment. A faster alternative publishes the lowest quality first and adds higher ones as they finish, which gets the video out sooner at the cost of a manifest that changes.',
        nodes: ['packager', 'meta'],
        travel: [['packager', 'meta', 'ready']],
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
      },
      {
        title: 'Stream segments from the CDN',
        narration:
          'The player downloads the manifest and the first segments from the nearest CDN edge. It measures throughput and buffer level, and picks the rendition for each next segment.',
        tradeoff:
          'Adaptive bitrate starts with a modest quality for a fast start and steps up as the buffer fills, trading peak picture quality for fewer stalls. Serving from the edge keeps latency low and keeps almost all traffic away from our storage.',
        nodes: ['viewer', 'cdn'],
        travel: [['viewer', 'cdn', 'segments']],
      },
      {
        title: 'Misses go back to storage',
        narration:
          'If the edge does not have a segment, it fetches it from segment storage through a regional shield cache, stores it and serves it. Popular videos stay hot at the edges.',
        tradeoff:
          'A shield layer collapses many edge misses into one origin read, protecting storage when a video suddenly goes viral. The long tail of rarely watched videos is mostly misses, which is acceptable because each of them is cheap and rare.',
        nodes: ['cdn', 'segments'],
        travel: [['cdn', 'segments', 'miss']],
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
        'Multipart upload with signed URLs. It is the only option that makes multi-gigabyte uploads from phones on mobile networks reliable.',
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
          pros: 'Minutes regardless of length; a failure retries one chunk.',
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
};
