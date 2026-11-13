import type { Design } from '../types';

export const fileSync: Design = {
  slug: 'file-sync',
  title: 'File sync and storage',
  summary:
    'Keep a folder in sync across every device a user owns: upload only the parts of a file that changed, store each chunk once, tell other devices within seconds, and never silently lose an edit when two devices change the same file.',
  difficulty: 'Hard',
  requirements: {
    functional: [
      'Users upload and download files of any size, up to tens of gigabytes.',
      'A change on one device appears on every other device of the same user automatically.',
      'Users share a folder with other people, who see the same files.',
      'Users can restore an earlier version of a file.',
    ],
    nonFunctional: [
      'Durable: a file that was acknowledged is never lost.',
      'Changes reach other online devices within a few seconds.',
      'Large uploads survive flaky networks and resume where they stopped.',
      'Scale to hundreds of millions of users and petabytes of data.',
    ],
    outOfScope: [
      'Editing documents in the browser in real time.',
      'Virus scanning and content moderation.',
    ],
  },
  entities: [
    {
      name: 'File',
      description:
        'Path inside a namespace (a personal folder or a shared one), owner, current version.',
    },
    {
      name: 'Version',
      description: 'An ordered list of chunk hashes, size and the version it was based on.',
    },
    {
      name: 'Chunk',
      description: 'A piece of a file of a few megabytes, stored once and addressed by its hash.',
    },
    {
      name: 'Change log entry',
      description:
        'One committed change in a namespace, with a sequence number devices use as a cursor.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/files/{path}/versions',
      description:
        'Body: chunk hashes, size, baseVersion. Returns the missing chunks with upload URLs, or 409 if the base version is stale.',
    },
    {
      method: 'GET',
      path: '/namespaces/{id}/changes?cursor=…',
      description:
        'Changes after the cursor and a new cursor; waits briefly when there is nothing new.',
    },
    {
      method: 'GET',
      path: '/files/{path}/versions/{v}',
      description: 'The chunk list of a version, with short-lived download URLs.',
    },
  ],
  dataFlow: [
    'The client splits a changed file into chunks, hashes them and asks which ones the server lacks.',
    'It uploads only the missing chunks straight to blob storage.',
    'It commits the new version against the version it started from; the commit lands in the change log.',
    'Other devices are told there is news, read the log from their cursor and download the chunks they lack.',
  ],
  highLevel: {
    label: 'Sync one edit across devices',
    intro:
      'Follow one edited file from the laptop where it changed to a phone that has it a few seconds later, including what happens when both changed it. Press play, or step through the stages.',
    nodes: [
      {
        id: 'client',
        title: 'Desktop client',
        detail: 'Watches a folder',
        column: 0,
        row: 'middle',
      },
      { id: 'blobs', title: 'Blob storage', detail: 'Chunks by hash', column: 1, row: 'top' },
      { id: 'api', title: 'Sync API', detail: 'Auth, upload URLs', column: 1, row: 'middle' },
      {
        id: 'metadata',
        title: 'Metadata DB',
        detail: 'Files and versions',
        column: 2,
        row: 'middle',
      },
      {
        id: 'gc',
        title: 'History and GC',
        detail: 'Old versions, orphans',
        column: 2,
        row: 'bottom',
      },
      {
        id: 'changelog',
        title: 'Change log',
        detail: 'Per namespace, ordered',
        column: 3,
        row: 'middle',
      },
      { id: 'notify', title: 'Notifier', detail: 'Long poll per device', column: 4, row: 'middle' },
      { id: 'cdn', title: 'CDN', detail: 'Popular chunks', column: 4, row: 'top' },
      {
        id: 'device',
        title: 'Other devices',
        detail: 'Pull from cursor',
        column: 5,
        row: 'middle',
      },
    ],
    edges: [
      ['client', 'api'],
      ['client', 'blobs', 'chunks'],
      ['api', 'metadata'],
      ['metadata', 'changelog'],
      ['changelog', 'notify'],
      ['notify', 'device', 'changes'],
      ['blobs', 'cdn'],
      ['cdn', 'device', 'chunks'],
      ['metadata', 'gc'],
    ],
    stages: [
      {
        title: 'Chunk and hash on the device',
        narration:
          'The client notices a file changed, splits it into chunks of a few megabytes and hashes each one. Most edits touch only a few chunks of a large file.',
        tradeoff:
          'Uploading the whole file on every save is simple, but a one-line change to a large file would cost the full upload. Chunking costs client CPU and a manifest per version, and in exchange only changed chunks travel and uploads can resume chunk by chunk.',
        nodes: ['client'],
        travel: [],
      },
      {
        title: 'Ask which chunks are missing',
        narration:
          'The client sends the list of chunk hashes and the version it started from. The server checks which hashes it already stores and returns upload URLs only for the rest.',
        tradeoff:
          'Content addressing means a chunk shared by two versions, or by two users, is stored once, which saves a lot of space and bandwidth. The cost is that a hash must never be trusted across tenants without proof the uploader has the data, or a known hash could be used to read a file that belongs to someone else.',
        nodes: ['client', 'api', 'metadata'],
        travel: [
          ['client', 'api'],
          ['api', 'metadata'],
        ],
      },
      {
        title: 'Upload straight to blob storage',
        narration:
          'The client uploads the missing chunks directly to blob storage with short-lived signed URLs. Each chunk is verified against its hash on arrival, and a failed chunk is simply sent again.',
        tradeoff:
          'Streaming file bytes through the API servers would make them a bandwidth bottleneck and tie up connections for minutes. Signed URLs keep the API on small metadata calls; the cost is that the client must finish uploads before it commits, and orphaned chunks need cleaning up later.',
        nodes: ['client', 'blobs'],
        travel: [['client', 'blobs', 'chunks']],
      },
      {
        title: 'Commit against a base version',
        narration:
          'Once every chunk is stored, the client commits the new version. The metadata database accepts it only if the file is still at the base version the client started from.',
        tradeoff:
          'A conditional write is optimistic concurrency: no locks are held while a large file uploads, and most commits never conflict. The price is that the rare loser has to handle a rejection instead of waiting its turn.',
        nodes: ['client', 'api', 'metadata'],
        travel: [
          ['client', 'api'],
          ['api', 'metadata'],
        ],
      },
      {
        title: 'Conflicts keep both copies',
        narration:
          'If two devices edited the same file offline, the second commit is rejected. Its client saves its version beside the original as a conflicted copy, so the user sees both and decides.',
        tradeoff:
          'Last writer wins would be invisible to the user and would silently throw one edit away. Merging automatically only works for formats the system understands. A conflicted copy is clumsy but never loses data, which matters more for arbitrary files.',
        nodes: ['metadata'],
        travel: [],
      },
      {
        title: 'Append to the change log',
        narration:
          'The same transaction that writes the version appends an entry to the namespace change log with the next sequence number. Each device remembers the last sequence it applied.',
        tradeoff:
          'A per-namespace log with a cursor turns sync into "give me everything after N", which is easy to resume after days offline. It needs ordering within a namespace, which is why the metadata is partitioned by namespace rather than by file.',
        nodes: ['metadata', 'changelog'],
        travel: [['metadata', 'changelog']],
      },
      {
        title: 'Wake up the other devices',
        narration:
          'Each online device holds a long poll on the notifier. When the namespace log moves, the notifier answers and the device reads the new entries from its cursor.',
        tradeoff:
          'Frequent polling from millions of idle devices wastes requests; pushing full changes over a socket couples delivery to state. A long poll that only says "there is news" is cheap, and the cursor read stays the single way to get changes, online or after a week away.',
        nodes: ['changelog', 'notify', 'device'],
        travel: [
          ['changelog', 'notify'],
          ['notify', 'device', 'changes'],
        ],
      },
      {
        title: 'Download only what is missing',
        narration:
          'The device compares the new chunk list with what it has locally and downloads only the missing chunks, through a CDN for files many people fetch, such as a shared folder.',
        tradeoff:
          'Serving every download from origin storage is simpler but slower far from the region and costly for popular files. A CDN adds a cache to invalidate, which is easy here because chunks are immutable: a new version means new hashes, never a changed chunk.',
        nodes: ['blobs', 'cdn', 'device'],
        travel: [
          ['blobs', 'cdn'],
          ['cdn', 'device', 'chunks'],
        ],
      },
      {
        title: 'Keep history, collect garbage',
        narration:
          'Old versions are kept for a retention window so users can restore them. A background job then drops expired versions and deletes chunks no version references anymore.',
        tradeoff:
          'Deleting chunks as soon as a version goes away is risky, because a new upload may be about to reference the same hash. A delayed, reference-counted sweep with a grace period is slower to reclaim space, and it never deletes a chunk that is still needed.',
        nodes: ['metadata', 'gc'],
        travel: [['metadata', 'gc']],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we split files into chunks?',
      options: [
        {
          name: 'Whole file',
          pros: 'No manifest, trivial to implement.',
          cons: 'Every small edit re-uploads everything; a broken upload restarts from zero.',
        },
        {
          name: 'Fixed-size chunks',
          pros: 'Simple, fast, and enough for files edited in place.',
          cons: 'Inserting a byte near the start shifts every chunk boundary, so all chunks look new.',
        },
        {
          name: 'Content-defined chunks',
          pros: 'Boundaries follow the content, so an insertion only changes the chunks around it.',
          cons: 'More CPU on the client and variable chunk sizes to manage.',
        },
      ],
      choice:
        'Content-defined chunks with a target size of a few megabytes. Clients pay a little CPU, and both bandwidth and storage drop for the common case of small edits to large files.',
    },
    {
      question: 'How do devices learn about changes?',
      options: [
        {
          name: 'Poll every few seconds',
          pros: 'Stateless and simple to scale behind a load balancer.',
          cons: 'Most polls find nothing; slow polling means slow sync, fast polling means huge load.',
        },
        {
          name: 'Push full changes over a socket',
          pros: 'Lowest latency.',
          cons: 'A missed message means a device silently drifts; it still needs a catch-up path.',
        },
        {
          name: 'Long poll for a signal, then read from a cursor',
          pros: 'Fast when online, and the same cursor read recovers any gap after being offline.',
          cons: 'Many open connections on the notifier tier.',
        },
      ],
      choice:
        'Long poll for a signal, then read the change log from the device cursor. Delivery can be lossy because correctness lives in the log, not in the notification.',
    },
    {
      question: 'What happens when two devices edit the same file?',
      options: [
        {
          name: 'Last writer wins',
          pros: 'No user interaction.',
          cons: 'One edit disappears without anyone noticing.',
        },
        {
          name: 'Lock the file while editing',
          pros: 'Prevents conflicts up front.',
          cons: 'Does not work offline, and a crashed device leaves files locked.',
        },
        {
          name: 'Reject the stale commit and keep a conflicted copy',
          pros: 'Never loses data, and works for any file format.',
          cons: 'The user has to merge the two copies by hand.',
        },
      ],
      choice:
        'Reject commits whose base version is stale and keep a conflicted copy. For a generic file store, never losing an edit beats a smooth but lossy merge.',
    },
  ],
  wrapUp:
    'Split files into content-defined chunks stored once by hash, upload them directly to blob storage, commit metadata with a base-version check that turns conflicts into copies, and drive every device from an ordered change log and a cursor.',
};
