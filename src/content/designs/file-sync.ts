import type { Design } from '../types';

export const fileSync: Design = {
  slug: 'file-sync',
  title: 'File sync and storage',
  summary:
    'Keep a folder in sync across every device a user owns: upload only the chunks of a file that changed, store each chunk once per namespace, commit with one conditional write against the version the device started from, and drive every device from an ordered change log and a cursor, so that two edits of the same file end as two files and a deleted chunk is never one that a commit still needs.',
  difficulty: 'Hard',
  minutes: 14,
  requirements: {
    functional: [
      'Users upload and download files of up to 50 GB. An edit uploads only the chunks that changed, and an upload that is interrupted resumes where it stopped.',
      'A change on one device appears on every other device that follows the same namespace: a user’s personal folder, or a shared folder.',
      'Two devices that edit the same file from the same version both keep their work: one becomes the next version and the other a conflict copy next to it.',
      'Users share a folder with other people as editors or viewers, and remove them again.',
      'Users restore an earlier version of a file, or a deleted file, for 30 days.',
      'Each account has a quota, and a commit that would pass it is refused.',
    ],
    nonFunctional: [
      '20 million users with 50 million devices, 10 million of them online at peak. About 100 million commits a day: 1,160 a second on average and 3,500 at peak.',
      'Durable: a commit is acknowledged only after every chunk it lists was found in blob storage, which keeps objects in at least three Availability Zones, and after one transaction wrote its metadata.',
      'No dangling version: a kept version lists only chunks that exist. The collector deletes a chunk with a conditional write that requires zero references, and every upload holds its references before it commits.',
      'An online device reads a change within 10 seconds of its commit for 99% of changes. A lost hint is repaired by the read that every device makes every 5 minutes.',
      'A commit request can be repeated safely: the upload id is the idempotency key, and the same id returns the same version.',
      'About 100 TB of new bytes a day go straight from devices to blob storage, 28 Gbit/s at peak, and never through the API servers.',
      'A hot namespace, a failed hint channel or a stopped collector slows only its own work: commits do not wait for hints or for collection.',
    ],
    outOfScope: [
      'Editing a document in the browser by several people at once. This design syncs whole files.',
      'Merging two versions of a file. A conflict is kept as two files and a person merges them.',
      'Moving or renaming a folder as one atomic step. A rename is a new file with the same chunk list and a delete of the old path, and it uploads no bytes.',
      'Turning an existing folder into a shared one. A shared folder starts empty, and files copied into it are uploaded again, because chunks are not shared between namespaces.',
      'Sign-up, sign-in and linking a device. Every request arrives with a short-lived token from an identity provider.',
      'Search, previews, thumbnails, virus scanning and content moderation.',
      'Public links, link passwords and permissions on a single file.',
      'End-to-end encryption with keys only the user holds.',
      'A second region. The design runs in one region across three Availability Zones.',
    ],
  },
  entities: [
    {
      name: 'Namespace',
      description:
        'A personal folder or a shared folder, the unit of ordering and of deduplication: an id, the owner account that pays for its bytes, and seq, the sequence number of its last change.',
    },
    {
      name: 'Member',
      description: 'One per namespace and user: the role, which is owner, editor or viewer.',
    },
    {
      name: 'File',
      description:
        'One per namespace and path: the current version number, the upload that holds its chunk list, the size, a deleted flag and the id of the last operation applied. A deleted file stays as a tombstone with its own version number for 90 days, as long as the log entry of its delete, so a stale device cannot bring the path back by accident; a device away longer than that gets a 410 and takes a snapshot.',
    },
    {
      name: 'Version',
      description:
        'One per file and version number: the upload it came from, the size, the device, the commit time and the sequence number it got. Kept while it is current and for 30 days after it is replaced or deleted.',
    },
    {
      name: 'Upload',
      description:
        'The id the client chose, the path, the base version, the size, the chunk list in parts of up to 90 chunks, and a status: open, committed, superseded, expired or aborted. Three counters, reserved, released and collected, say how many parts have taken their references, given them back, and had their chunks checked for deletion. A due time, 7 days after creation for an open upload and 30 days after a version is replaced, is when the collector looks at it.',
    },
    {
      name: 'Chunk',
      description:
        'One row per namespace and SHA-256 hash: refs, the number of times open uploads and kept versions list it, a stored flag set once the object was seen in blob storage, the size, and a random suffix chosen when the row is created. The object key is the namespace, the hash and that suffix, so a row created again later never reuses the key of an earlier one.',
    },
    {
      name: 'Change log entry',
      description:
        'One per commit in a namespace, keyed by a sequence number with no holes: the path, the version, the kind (put, delete, mount or unmount), the size, the upload, the device and the commit time. Kept 90 days.',
    },
    {
      name: 'Cursor',
      description:
        'Kept by each device, one per namespace it follows: the sequence number of the last entry it has applied. The server stores none.',
    },
    {
      name: 'Account',
      description:
        'Used bytes and quota bytes, and the list of namespaces the user owns or was invited to.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/namespaces/{id}/uploads',
      description:
        'Body: uploadId (chosen by the client, the idempotency key), path, baseVersion, size and the first 90 chunks as hash and size. One transaction stores the upload and adds a reference to every chunk listed. Answers 201 with the chunks that storage does not have yet, each with an upload URL valid for 1 hour. A repeat with the same uploadId returns the same answer and takes no reference twice. 409 if the file is no longer at baseVersion, 413 if the size difference does not fit the quota; both are early checks, and the commit decides.',
    },
    {
      method: 'PUT',
      path: '/namespaces/{id}/uploads/{uploadId}/parts/{k}',
      description:
        'The next 90 chunks of a large file. Part k is accepted only when parts 0 to k − 1 are, and a repeat of a part already accepted returns its answer again.',
    },
    {
      method: 'GET',
      path: '/namespaces/{id}/uploads/{uploadId}',
      description:
        'How a device resumes: the API checks storage for the chunks not yet marked stored, marks those that arrived and returns the rest with fresh URLs. 410 within 2 hours of the upload’s due time, when no URL is issued any more: the client starts a new upload.',
    },
    {
      method: 'POST',
      path: '/namespaces/{id}/uploads/{uploadId}/commit',
      description:
        'Checks that the sizes of the listed chunks add up to the declared size, which a list with a part still to come does not, and that every chunk is in storage, then one transaction makes the upload the next version of the file if the file is still at baseVersion. Answers 200 with version and seq, and the same again on a repeat. 409 with the current version if the base is stale, 409 with the missing chunks and their URLs if some are not stored, 422 if the chunk sizes do not add up to the declared size, 410 if the upload expired or was aborted, or if chunks are missing within 2 hours of its due time, when no URL is issued any more, 413 over quota, 503 with Retry-After when the namespace is too busy.',
    },
    {
      method: 'DELETE',
      path: '/namespaces/{id}/uploads/{uploadId}',
      description:
        'Aborts an open upload. Its references are given back by the collector 2 hours later, when its last URL has expired.',
    },
    {
      method: 'DELETE',
      path: '/namespaces/{id}/files/{path}',
      description:
        'Body: baseVersion and an operation id. One transaction leaves a tombstone with the next version number, adds a delete entry to the log and gives the bytes back to the quota. A repeat with the same operation id returns the same answer; 409 if the file moved on.',
    },
    {
      method: 'GET',
      path: '/namespaces/{id}/changes?cursor={seq}&trigger={hint|timer|start}',
      description:
        'The entries after the cursor in order, up to 500, read consistently, with a grant for the notifier: the device and the namespace, signed by the Sync API and valid for 1 hour. A read made while the device is still applying entries adds seen={seq}, the highest sequence number it has already been handed, and the API counts only the entries above it for the sync objective. 410 if the entry right after the cursor has been trimmed, which the API sees as a number that is not the cursor plus one or as no entry while the namespace is ahead: the device then takes a snapshot.',
    },
    {
      method: 'GET',
      path: '/namespaces/{id}/files',
      description:
        'A snapshot for a new device or one whose cursor was trimmed: the sequence number read before the listing starts, then every file and every tombstone with its current version, in pages.',
    },
    {
      method: 'GET',
      path: '/namespaces/{id}/files/{path}/versions/{v}',
      description:
        'The chunk list of a version in pages, and one signed download policy that covers every chunk of the namespace for 1 hour. Without {v}, the kept versions of the file. With verify={hash}, the API looks for that chunk in storage itself and counts a confirmed miss. 404 once a version has been released.',
    },
    {
      method: 'PUT',
      path: '/namespaces/{id}/members/{userId}',
      description:
        'Owner only. One transaction writes the member row with its role, adds the namespace to the user’s list and appends a mount entry to the log of the user’s personal namespace. DELETE removes the member and appends an unmount entry.',
    },
    {
      method: 'WSS',
      path: '/notify',
      description:
        'A socket per device. The device names the namespaces it follows and presents for each the grant that its last changes read returned. The notifier checks the signature and the expiry of a grant without reading a table, confirms the subscription, and sends {namespace, seq} when that namespace moves, until the grant expires or the device presents a newer one. A hint carries no change: the device reads the log.',
    },
  ],
  dataFlow: [
    'The client cuts a changed file into chunks, hashes them and opens an upload with the list. The Sync API takes a reference on every chunk and answers which ones storage lacks.',
    'The client uploads those chunks straight to blob storage with signed URLs, and blob storage checks each body against the SHA-256 sent with it.',
    'The client commits. The API confirms the chunks are in storage, and one transaction moves the file to the new version if it is still at the base version, appends the change to the namespace’s log and updates the quota.',
    'The API publishes the namespace and its new sequence number as a hint. The notifier passes it to the devices that follow the namespace, and each device also reads its cursors every 5 minutes in case a hint was lost.',
    'A device reads the log from its cursor, fetches the chunk list of each new version, downloads through the CDN only the chunks it does not have, and then saves the cursor.',
    'A replaced version is kept 30 days. Then the collector gives its references back and deletes each chunk whose count reached zero, with a conditional write.',
  ],
  highLevel: {
    label: 'Sync one edit across devices',
    intro:
      'Follow one edited file from the laptop where it changed to a phone that has it a few seconds later, including what happens when both changed it. The design grows as it needs to: watch polling devices overload the servers until a notifier joins, then a CDN and a collector. Numbers are illustrative. Press play, or step through the stages to see what happens and what each choice costs.',
    nodes: [
      {
        id: 'client',
        title: 'Desktop client',
        detail: 'Watches a folder',
        column: 0,
        row: 'middle',
      },
      {
        id: 'blobs',
        title: 'Blob storage',
        detail: 'Chunks by hash',
        column: 1,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'api',
        title: 'Sync API',
        detail: 'Reserve, commit',
        column: 1,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'metadata',
        title: 'Metadata DB',
        detail: 'Files, uploads, chunk refs',
        column: 2,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'gc',
        title: 'Collector',
        detail: 'Releases, then deletes',
        column: 2,
        row: 'bottom',
        appearsAt: 10,
      },
      {
        id: 'changelog',
        title: 'Change log',
        detail: 'Per namespace, no holes',
        column: 3,
        row: 'middle',
        appearsAt: 5,
      },
      {
        id: 'bus',
        title: 'Hint channel',
        detail: 'Pub/sub, may drop',
        column: 3,
        row: 'bottom',
        appearsAt: 7,
      },
      {
        id: 'notify',
        title: 'Notifier',
        detail: 'A socket per device',
        column: 4,
        row: 'middle',
        appearsAt: 7,
      },
      { id: 'cdn', title: 'CDN', detail: 'Signed, cached', column: 4, row: 'top', appearsAt: 8 },
      {
        id: 'device',
        title: 'Other devices',
        detail: 'Read from a cursor',
        column: 5,
        row: 'middle',
        appearsAt: 6,
      },
    ],
    edges: [
      ['client', 'api'],
      ['client', 'blobs', 'PUT'],
      ['api', 'blobs'],
      ['api', 'metadata'],
      ['metadata', 'changelog'],
      ['changelog', 'bus', 'seq'],
      ['bus', 'notify'],
      ['notify', 'device', 'hint'],
      ['blobs', 'cdn'],
      ['cdn', 'device', 'GET'],
      ['metadata', 'gc'],
    ],
    // The API first talks to blob storage when it commits, one stage after the client uploads.
    edgeStages: [{ edge: ['api', 'blobs'], stages: [3, 4, 5, 6, 7, 8, 9, 10] }],
    stages: [
      {
        title: 'Chunk and hash on the device',
        narration:
          'The client notices that a 12 MB spreadsheet changed. It cuts the file where a rolling hash of the content says so, into chunks of about 4 MB, none under 1 MB or over 8 MB, and names each chunk by its SHA-256. Two of the three chunks have the same hash as in the version the client already has.',
        tradeoff:
          'Uploading the whole file on every save is simple, but a one-line change to a large file would cost the full upload. Chunking costs client CPU and a chunk list per version, and in exchange only changed chunks travel and an upload can resume chunk by chunk. Cutting by content and not at fixed offsets costs more CPU still, and keeps the chunks after an insertion unchanged.',
        nodes: ['client'],
        travel: [],
        short: 'Chunk',
        metrics: {
          users: '20M',
          requestsPerSecond: '7K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Chunk size', value: '~4 MB' }],
        },
        load: { client: 30 },
      },
      {
        title: 'Reserve the chunks, learn which are missing',
        narration:
          'The client opens an upload: an id it chose, the path, the version it started from and the list of chunk hashes. In one transaction the Sync API stores the upload with its list and adds one reference to the row of every chunk on it, creating the rows that do not exist yet. It answers with the chunks that storage does not have, here one of three, each with an upload URL. Chunks are looked up only inside the caller’s namespace.',
        tradeoff:
          'Taking references before any byte travels costs writes that an abandoned upload wastes until it expires after 7 days. It is what lets the collector decide with one conditional write: a chunk on any open upload has a count above zero. Deduplicating inside one namespace gives up the savings of storing a popular file once for everyone, and in exchange an upload that finishes at once cannot tell anyone that a stranger has the same file.',
        nodes: ['client', 'api', 'metadata'],
        travel: [
          ['client', 'api'],
          ['api', 'metadata'],
        ],
        short: 'Reserve',
        metrics: {
          users: '20M',
          requestsPerSecond: '7K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Chunks to upload', value: '1 of 3' }],
        },
        load: { api: 15, metadata: 20 },
      },
      {
        title: 'Upload straight to blob storage',
        narration:
          'The client sends the missing chunk straight to blob storage with a signed URL that is valid for 1 hour and fixes the key and the chunk’s SHA-256, which the client sends in a signed checksum header along with the body. Storage computes the checksum of what arrives, refuses a body that does not match and keeps the checksum with the object, where the API reads it before the commit. A URL can therefore only store the bytes it was issued for. A chunk that fails is tried again, three attempts per URL; after that the client asks for fresh URLs once, and if the chunk fails with those too, it leaves the file pending for its next 5-minute cycle.',
        tradeoff:
          'Streaming file bytes through the API servers would make them a bandwidth bottleneck, 28 Gbit/s at peak, and tie up connections for minutes. Signed URLs keep the API on small metadata calls. The cost is that the server learns nothing from the upload itself and has to ask storage before it commits, and that a chunk whose upload is never committed occupies space until its upload expires.',
        nodes: ['client', 'blobs'],
        travel: [['client', 'blobs', 'PUT']],
        short: 'Upload',
        metrics: {
          users: '20M',
          requestsPerSecond: '7K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Upload at peak', value: '28 Gbit/s' }],
        },
        load: { client: 40, blobs: 30 },
        traffic: [{ edge: ['client', 'blobs'], kind: 'heavy' }],
      },
      {
        title: 'Commit against a base version',
        narration:
          'The client asks to commit. The Sync API first asks blob storage for every chunk on the list that is not yet marked stored, and marks the ones it finds. Then one transaction does the rest: it moves the file from version 7 to 8 only if it is still at 7, writes the version, turns the upload into committed, starts the 30-day clock of the version it replaces and adds the size difference to the owner’s used bytes if that stays inside the quota. The answer, version 8, is stored on the upload, so a repeat of the commit returns it again.',
        tradeoff:
          'A conditional write is optimistic concurrency: no lock is held while a large file uploads, and most commits never conflict. The price is that the rare loser has to handle a rejection instead of waiting its turn. Putting the quota and the version in one transaction means neither can be counted twice or left half done; it also means every commit of a namespace passes through the same few rows, so one namespace takes about 20 commits a second.',
        nodes: ['client', 'api', 'blobs', 'metadata'],
        travel: [
          ['client', 'api'],
          ['api', 'blobs'],
          ['api', 'metadata'],
        ],
        short: 'Commit',
        metrics: {
          users: '20M',
          requestsPerSecond: '7K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Commits at peak', value: '3.5K/s' }],
        },
        load: { api: 20, blobs: 30, metadata: 30 },
      },
      {
        title: 'Conflicts keep both copies',
        narration:
          'A tablet edited the same spreadsheet offline, also from version 7. Its commit arrives second, the condition on the file fails, and the API answers 409 with the current version, 8. The tablet commits its chunks again under a new path next to the original, named as a conflict copy with the device and the date, and then downloads version 8. Nothing is uploaded twice: its chunks are already stored and referenced.',
        tradeoff:
          'Letting the last writer win would be invisible to the user and would throw one edit away without a trace. Merging automatically only works for formats the system understands. A conflict copy is clumsy, a person has to compare two files, and it keeps both edits for any kind of file. It relies on the client: a client that answered a 409 by committing again on top of version 8 would overwrite the other edit, with version 8 still in the history for 30 days.',
        nodes: ['client', 'api', 'metadata'],
        travel: [
          ['client', 'api'],
          ['api', 'metadata'],
        ],
        short: 'Conflict',
        metrics: {
          users: '20M',
          requestsPerSecond: '7K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Commits answered 409', value: 'under 0.1%' }],
        },
        load: { api: 20, metadata: 30 },
      },
      {
        title: 'Append to the change log',
        narration:
          'The transaction that writes the version also appends an entry to the namespace’s change log. It moves the namespace’s sequence number from 4,812 to 4,813 only if it is still 4,812 and writes the entry under 4,813, so the numbers have no holes and no two entries share one. Each device remembers the last number it has applied: its cursor.',
        tradeoff:
          'A log per namespace with a cursor turns sync into "give me everything after 4,812", which works the same after a second or after three weeks. Numbers without holes let a reader tell a trimmed log from a quiet one. The cost is the ordering itself: two commits in one namespace that read the same number cannot both win, and the loser is tried again by the API, three tries in all, before the client is told to come back.',
        nodes: ['metadata', 'changelog'],
        travel: [['metadata', 'changelog']],
        short: 'Change log',
        metrics: {
          users: '20M',
          requestsPerSecond: '7K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Per namespace', value: '~20 commits/s' }],
        },
        load: { metadata: 30, changelog: 15 },
      },
      {
        title: 'Every device polls for news',
        narration:
          'With no way to hear about changes, every online device asks the Sync API every 5 seconds whether each namespace it follows has moved; the diagram draws these polls on the arrow from the client. 10 million devices follow 12 million namespaces, so 2.4 million polls a second reach the API and the metadata database, and nearly all of them answer "nothing new". Commits slow down and some time out.',
        tradeoff:
          'Polling less often cuts the load and makes sync feel slow: at one poll a minute the load is still 200,000 a second and a change takes up to a minute to show. The work is spent on devices that have nothing to fetch, which calls for a way to tell a device only when its namespace has changed.',
        nodes: ['device', 'client', 'api', 'metadata'],
        travel: [
          ['client', 'api'],
          ['api', 'metadata'],
        ],
        short: 'Polling storm',
        metrics: {
          users: '20M',
          requestsPerSecond: '2.4M',
          p95Latency: '2.5 s',
          errorRate: '4%',
          alerts: ['p95Latency', 'errorRate'],
          custom: [{ label: 'Polls with news', value: 'under 1%' }],
        },
        load: { api: 97, metadata: 95, changelog: 20 },
        traffic: [{ edge: ['client', 'api'], kind: 'failed' }],
      },
      {
        title: 'A hint, then the cursor',
        narration:
          'A notifier joins. Each online device keeps one socket open to it and names the namespaces it follows. After a commit the Sync API publishes the namespace and its new sequence number on a pub/sub channel, the notifier passes it to the sockets that follow that namespace, and each device reads the log from its cursor. The diagram draws the publish from the change log, where the new number comes from, and the device’s read of the log on the arrow from the client to the Sync API. The hint carries no change, and it can be lost, so every device also reads each cursor every 5 minutes, hint or not.',
        tradeoff:
          'Pushing the changes themselves over the socket would be faster by one request, and a single dropped message would leave a device behind without knowing it. A hint that only says "there is news" can be dropped at no cost to correctness, because the cursor read is the one way to get changes, online or after weeks away. The publish happens after the commit and is not retried, so the price of a lost hint is a delay of up to 5 minutes, and the timer reads are now the largest load on the API, 40,000 of its 54,000 requests a second.',
        nodes: ['changelog', 'bus', 'notify', 'device'],
        travel: [
          ['changelog', 'bus', 'seq'],
          ['bus', 'notify'],
          ['notify', 'device', 'hint'],
        ],
        short: 'Hint',
        metrics: {
          users: '20M',
          requestsPerSecond: '54K',
          p95Latency: '70 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Sockets open', value: '10M' },
            { label: 'Commit to read p99', value: '2 s' },
          ],
        },
        load: { api: 60, metadata: 45, changelog: 30, bus: 25, notify: 65, device: 10 },
      },
      {
        title: 'Download only what is missing',
        narration:
          'The phone reads entry 4,813, asks for the chunk list of version 8 and compares it with the chunks of the version it has. It downloads the one chunk it lacks through a CDN, with a signed policy that covers the namespace for 1 hour, checks its SHA-256 and replaces the file only if the local copy has not changed meanwhile. Then it saves the cursor.',
        tradeoff:
          'Serving every download from origin storage is simpler, but slower far from the region and costly for a shared folder that hundreds of devices fetch. A CDN adds a cache, which is easy to keep correct here because a chunk never changes: a new version means new hashes. The cost is that a deleted chunk can be served from an edge until its cache lifetime of 24 hours ends, to someone who still holds a valid signed policy.',
        nodes: ['blobs', 'cdn', 'device'],
        travel: [
          ['blobs', 'cdn'],
          ['cdn', 'device', 'GET'],
        ],
        short: 'Download',
        metrics: {
          users: '20M',
          requestsPerSecond: '54K',
          p95Latency: '70 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Chunks to download', value: '1 of 3' },
            { label: 'Download at peak', value: '28 Gbit/s' },
          ],
        },
        load: { blobs: 35, cdn: 50, device: 20 },
        traffic: [{ edge: ['cdn', 'device'], kind: 'heavy' }],
      },
      {
        title: 'Interrupted, repeated, weeks away',
        narration:
          'Three things go wrong every day. A 2 GB upload loses its network after 180 of 500 chunks: the client asks the API which chunks are still missing and sends only those. The answer to a commit is lost: the client commits again with the same upload id and gets the same version back. A tablet returns after three weeks with cursor 4,102: it reads 711 entries in two pages, keeps the last entry of each path and downloads only those. A cursor older than the 90 days the log is kept gets a 410, and the device takes a snapshot of the namespace.',
        tradeoff:
          'All three lean on state the server keeps for a while: the upload with its references for 7 days, the result of a commit on the upload, the log for 90 days. That is storage and rows to clean up. In exchange the client needs no special recovery code: it repeats the request it was making, and the answer is the same as it would have been the first time.',
        nodes: ['client', 'api', 'metadata', 'changelog'],
        travel: [
          ['client', 'api'],
          ['api', 'metadata'],
          ['metadata', 'changelog'],
        ],
        short: 'Resume',
        metrics: {
          users: '20M',
          requestsPerSecond: '54K',
          p95Latency: '70 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Timer reads', value: '40K/s' },
            { label: 'Log kept', value: '90 days' },
          ],
        },
        load: { api: 60, metadata: 45, changelog: 30 },
      },
      {
        title: 'Keep history, collect garbage',
        narration:
          'A replaced version is kept 30 days so a user can restore it. Then a collector finds its upload through its due time and gives its references back, one part of the chunk list per transaction, with a counter on the upload so that no part is given back twice. Each chunk of that part is then deleted from the index with a write that succeeds only if its count is zero, and only after that from blob storage; the collector’s call to blob storage is not drawn. An open upload that passes 7 days is first set to expired with a conditional write, and then treated the same way.',
        tradeoff:
          'Deleting chunks as soon as a version goes away would be simpler and would race an upload that is about to list the same hash. A grace period alone only makes that race unlikely. Here the race has one winner: an upload takes its references before it commits, the collector deletes a row only at zero, and the two writes cannot both succeed. Counting references costs two extra writes per chunk and version, and a crash between the row and the object leaves work that the next pass repeats. A row created again for the same hash gets a new object key, so a late delete of the old key cannot remove new bytes.',
        nodes: ['metadata', 'gc'],
        travel: [['metadata', 'gc']],
        short: 'History + GC',
        metrics: {
          users: '20M',
          requestsPerSecond: '54K',
          p95Latency: '70 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Released per day', value: '60M uploads' },
            { label: 'History held', value: '1.8 PB' },
          ],
        },
        load: { metadata: 50, gc: 40 },
        traffic: [{ edge: ['metadata', 'gc'], kind: 'heavy' }],
      },
    ],
  },
  flows: [
    {
      id: 'upload-commit',
      title: 'Upload a changed file and commit it',
      kind: 'sync',
      summary:
        'Ana saves a 12 MB spreadsheet on her laptop. One of its three chunks changed, so one chunk travels, and one transaction makes the result version 8 of the file and entry 4,813 of her namespace.',
      runsOn:
        'ALB → Sync API on ECS Fargate → Amazon DynamoDB → Amazon S3 → ElastiCache for Valkey',
      participants: [
        { id: 'device', label: 'Laptop', service: 'Sync client' },
        { id: 'api', label: 'Sync API', service: 'ALB + ECS Fargate' },
        { id: 'chunks', label: 'Chunk index', service: 'DynamoDB' },
        { id: 's3', label: 'Blob storage', service: 'Amazon S3' },
        { id: 'meta', label: 'Metadata table', service: 'DynamoDB' },
        { id: 'bus', label: 'Hint channel', service: 'ElastiCache for Valkey' },
      ],
      steps: [
        {
          from: 'device',
          to: 'device',
          label: 'cut into chunks c1, c2, c3; SHA-256 each',
          note: 'Content-defined cuts at about 4 MB. The client keeps the chunk list of version 7, so it already knows that only c3 is new to it. It still sends the whole list: the server decides what is missing.',
        },
        {
          from: 'device',
          to: 'api',
          label:
            'POST /namespaces/ns-ana/uploads {uploadId: u-91, path, baseVersion: 7, size, chunks}',
          note: 'The upload id is a random id the client made and wrote to its local journal before the call, so every repeat carries the same one. The API checks the token and reads the member row: Ana is the owner.',
        },
        {
          from: 'api',
          to: 'meta',
          label: 'GetItem file row, account row',
          note: 'Two early checks that save a wasted upload: the file is still at version 7, and the size difference fits the free quota. Neither is binding, because both can change before the commit, which checks them again inside its transaction.',
        },
        {
          from: 'api',
          to: 'chunks',
          label: 'BatchGetItem (ns-ana, c1), (ns-ana, c2), (ns-ana, c3), consistent',
          note: 'Rows are keyed by namespace and hash, so only chunks of this namespace can match. c1 and c2 exist and are marked stored. c3 has no row.',
        },
        {
          from: 'api',
          to: 'chunks',
          label: 'TransactWriteItems: upload u-91, part 0, refs + 1 on c1, c2, new row c3',
          note: 'One transaction over two tables. Put upload u-91 with status open and a due time 7 days ahead, if it does not exist. Put part 0 of its chunk list. Add 1 to refs of c1 and c2 if their suffix is the one just read. Put c3 with refs 1, stored false and a new random suffix, if it does not exist. If a row changed since the read, the API reads again and retries, three tries in all, then answers 503. A hash listed twice in a part is one action that adds 2.',
        },
        {
          from: 'api',
          to: 'device',
          label: '201 {upload: [c3 → signed PUT URL]}',
          note: 'The URL is signed for the object key of c3, the namespace, the hash and the suffix, and for the checksum header with that hash, and is valid for 1 hour. From this moment the collector cannot delete c1, c2 or c3: their counts are above zero until this upload commits, is aborted or expires.',
          style: 'reply',
        },
        {
          from: 'device',
          to: 's3',
          label: 'PUT ns-ana/c3.suffix, x-amz-checksum-sha256',
          note: 'Straight to storage. S3 computes the SHA-256 of the body and rejects the request if it differs from the header. The header is one of the signed headers of the URL, so a request with another value fails the signature. A failed PUT is repeated with backoff, three attempts per URL; after that the client asks the API for fresh URLs once, and if those fail too, it leaves the file pending for its next 5-minute cycle.',
        },
        {
          from: 's3',
          to: 'device',
          label: '200',
          note: 'The object is stored across at least three Availability Zones before this answer.',
          style: 'reply',
        },
        {
          from: 'device',
          to: 'api',
          label: 'POST /namespaces/ns-ana/uploads/u-91/commit',
          note: 'No body: everything the commit needs is on the upload. The API reads the parts and the chunk rows and requires the sizes on those rows to add up to the size declared at create; a list with a part missing, or a declared size that is not that sum, is answered 422.',
        },
        {
          from: 'api',
          to: 's3',
          label: 'HeadObject ns-ana/c3.suffix, ChecksumMode=ENABLED',
          note: 'For every chunk of the list whose row is not marked stored. The object must exist with the listed size and a stored SHA-256 equal to the hash; then the API sets stored on the row. A chunk that is not there ends the request with 409 and a fresh URL, or with 410 when the upload’s due time is less than 2 hours away and no URL is issued. The check is stable: nothing deletes an object whose row has references, and this upload holds one, and a later PUT through a URL that is still valid can only store the same bytes, because the URL signs the checksum.',
        },
        {
          from: 'api',
          to: 'meta',
          label:
            'TransactWriteItems: seq 4812 → 4813, file 7 → 8, version, log entry, uploads, quota',
          note: 'Seven writes, all or nothing. Namespace row: seq = 4813 if seq = 4812. File row: version 8 and upload u-91 if version = 7. Put version 8. Put log entry 4813 if it does not exist. Upload u-91: committed, with version 8 and seq 4813, no due time, if status = open. Upload u-64, behind version 7: superseded, due in 30 days. Account row: add the size difference if used bytes are at most the quota minus that difference and the quota is the one just read. If this row fails, the API reads the account again: a quota that changed, as after a plan change, gets one more try with the new value, and otherwise the answer is 413.',
        },
        {
          from: 'api',
          to: 'bus',
          label: 'SPUBLISH ns-ana 4813',
          note: 'After the transaction, once, with a 50 ms timeout and no retry. If it fails the commit is still done, and the devices find entry 4,813 on their next timer read.',
          style: 'async',
        },
        {
          from: 'api',
          to: 'device',
          label: '200 {version: 8, seq: 4813}',
          note: 'The client records version 8 as its base for the next edit. Any failure before this answer leaves the client to repeat the commit, which is safe.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'second-device',
      title: 'A second device learns of the change and downloads one chunk',
      kind: 'async',
      summary:
        'Ana’s phone is online with a socket open. It gets a hint two seconds after the commit, reads the log from its cursor and downloads the one chunk it does not have.',
      runsOn:
        'ElastiCache for Valkey → Notifier on ECS Fargate → Sync API → Amazon DynamoDB → Amazon CloudFront → Amazon S3',
      participants: [
        { id: 'bus', label: 'Hint channel', service: 'ElastiCache for Valkey' },
        { id: 'notifier', label: 'Notifier', service: 'ALB + ECS Fargate' },
        { id: 'phone', label: 'Phone', service: 'Sync client' },
        { id: 'api', label: 'Sync API', service: 'ALB + ECS Fargate' },
        { id: 'meta', label: 'Metadata table', service: 'DynamoDB' },
        { id: 'cdn', label: 'CDN', service: 'CloudFront + S3' },
      ],
      steps: [
        {
          from: 'bus',
          to: 'notifier',
          label: 'message on channel ns-ana: 4813',
          note: 'The notifier task that holds the phone’s socket subscribed to this channel when the phone named the namespace. Pub/sub delivers at most once: a task that was reconnecting at this moment gets nothing.',
          style: 'async',
        },
        {
          from: 'notifier',
          to: 'phone',
          label: '{namespace: ns-ana, seq: 4813}',
          note: 'Over the socket the phone opened. The notifier holds no cursor and reads no table: it forwards what the channel says to the sockets that asked for that namespace with a grant signed by the Sync API that has not expired.',
          style: 'async',
        },
        {
          from: 'phone',
          to: 'api',
          label: 'GET /namespaces/ns-ana/changes?cursor=4812&trigger=hint',
          note: 'The phone’s cursor is 4,812, lower than the hint, so there is something to read. A hint at or below the cursor is ignored.',
        },
        {
          from: 'api',
          to: 'meta',
          label: 'Query log entries after 4812, consistent',
          note: 'After the member row confirms that Ana may read. The read is consistent, so an entry committed before the hint is always in the answer. The first entry must be 4,813, the cursor plus one; a later number, or no entry at all while the namespace’s seq is above the cursor, would mean the log was trimmed, and the answer would be 410.',
        },
        {
          from: 'api',
          to: 'phone',
          label: '200 [{seq: 4813, path, version: 8, kind: put, upload: u-91}]',
          note: 'The API also records that this entry was read through a hint, 2 seconds after its commit time. That number is the sync objective.',
          style: 'reply',
        },
        {
          from: 'phone',
          to: 'api',
          label: 'GET /namespaces/ns-ana/files/{path}/versions/8',
          note: 'The API reads the parts of upload u-91 and returns the chunk list with each object key, plus one signed policy for the prefix of the namespace, valid for 1 hour.',
        },
        {
          from: 'phone',
          to: 'phone',
          label: 'compare with the chunks of version 7',
          note: 'The phone has c1 and c2 from the version it holds. Only c3 is missing.',
        },
        {
          from: 'phone',
          to: 'cdn',
          label: 'GET ns-ana/c3.suffix + signed policy',
          note: 'CloudFront checks the signature and the expiry, serves the chunk from the edge if it has it and otherwise reads the private bucket through origin access control.',
        },
        {
          from: 'cdn',
          to: 'phone',
          label: '200, 4 MB',
          note: 'The phone checks the SHA-256 of what it received against the hash in the list.',
          style: 'reply',
        },
        {
          from: 'phone',
          to: 'phone',
          label: 'assemble, replace the file, save cursor 4813',
          note: 'The new file is built beside the old one and swapped in only if the local file is still version 7 untouched. If it has a local edit, that edit is committed with base 7 later and becomes a conflict copy. The cursor is saved last, so a crash before it repeats this work and changes nothing.',
        },
      ],
    },
    {
      id: 'conflict',
      title: 'Two devices edit the same file offline and both commit',
      kind: 'sync',
      summary:
        'Ana’s laptop and her tablet both edited version 7 while offline. Both reserve, upload and commit. One transaction wins, and the other device keeps its work as a conflict copy.',
      runsOn: 'Sync API on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'laptop', label: 'Laptop', service: 'Sync client' },
        { id: 'tablet', label: 'Tablet', service: 'Sync client' },
        { id: 'api', label: 'Sync API', service: 'ALB + ECS Fargate' },
        { id: 'meta', label: 'Metadata table', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'laptop',
          to: 'api',
          label: 'POST /uploads/u-91/commit (base 7)',
          note: 'Both devices came online in the same minute. Both opened an upload while the file was at version 7, so both passed the early check, and both uploaded their chunks.',
        },
        {
          from: 'tablet',
          to: 'api',
          label: 'POST /uploads/u-92/commit (base 7)',
          note: 'A different upload, a different chunk list, the same base. It can land on another API task at the same instant.',
        },
        {
          from: 'api',
          to: 'meta',
          label: 'TransactWriteItems for u-91: file 7 → 8 IF version = 7',
          note: 'Succeeds. The file is at version 8 and the namespace at 4,813.',
        },
        {
          from: 'api',
          to: 'meta',
          label: 'TransactWriteItems for u-92: file 7 → 8 IF version = 7',
          note: 'Cancelled. The reasons come back one per write. Here both the sequence number and the file row fail their conditions, and the file row reason wins over the sequence reason: a stale base, with no retry. Had the two transactions overlapped, this one would have been cancelled with a TransactionConflict, been retried by the API like a sequence loss, and then failed on the file row. Either way nothing of u-92 was written.',
        },
        {
          from: 'api',
          to: 'tablet',
          label: '409 {reason: stale_base, currentVersion: 8}',
          note: 'Not an error to retry. The tablet’s upload u-92 is still open and still holds its references, so its chunks are safe.',
          style: 'reply',
        },
        {
          from: 'tablet',
          to: 'api',
          label:
            'POST /uploads {uploadId: u-93, path: "budget (conflict, Tablet, 2026-11-24).xlsx", baseVersion: 0, same chunks}',
          note: 'A new file next to the original. The API takes a second reference on each chunk; all of them are stored, so the answer lists nothing to upload. If version 8 had the same chunk list as the tablet’s edit, the client would skip this and just take version 8.',
        },
        {
          from: 'tablet',
          to: 'api',
          label: 'POST /uploads/u-93/commit',
          note: 'Version 1 of the conflict copy, entry 4,814. Base 0 means the path has neither a file nor a live tombstone; the condition is that the file row is absent or is a tombstone past its 90 days, which time to live can leave in place a few days longer. A create at a path deleted in the last 90 days names the version of its tombstone as the base, which a device has from the delete entry or from a snapshot. A 409 whose current version is a tombstone is answered with a new upload of the same chunks against that version, never with a conflict copy.',
        },
        {
          from: 'tablet',
          to: 'api',
          label: 'DELETE /uploads/u-92',
          note: 'The losing upload is aborted with a conditional write on status open. The collector gives its references back 2 hours later. If the tablet dies before this call, the upload expires on its own after 7 days.',
        },
        {
          from: 'tablet',
          to: 'api',
          label: 'GET /changes?cursor=4812',
          note: 'Entries 4,813 and 4,814. The tablet downloads version 8 into the original path, and the laptop, on its own read, receives the conflict copy. Both devices end with both files.',
        },
      ],
    },
    {
      id: 'resume',
      title: 'An upload is interrupted and resumes',
      kind: 'sync',
      summary:
        'A 2 GB video is 500 chunks in six parts. The network drops after 180 chunks are in storage, in the middle of a part call. The client repeats the call, asks what is still missing and sends the other 320.',
      runsOn: 'Sync API on ECS Fargate → Amazon DynamoDB → Amazon S3',
      participants: [
        { id: 'device', label: 'Laptop', service: 'Sync client' },
        { id: 'api', label: 'Sync API', service: 'ALB + ECS Fargate' },
        { id: 'chunks', label: 'Chunk index', service: 'DynamoDB' },
        { id: 's3', label: 'Blob storage', service: 'Amazon S3' },
        { id: 'meta', label: 'Metadata table', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'device',
          to: 'api',
          label: 'POST /uploads {uploadId: u-95, chunks 0 to 89}, then PUT /parts/1, /parts/2',
          note: 'Each call is one transaction: the part of the list, a reference on each of its chunks, and the upload’s reserved counter moved from k to k + 1 only if it is k. The client uploads the chunks of a part while it sends the next one.',
        },
        {
          from: 'device',
          to: 's3',
          label: 'PUT chunks, 4 at a time',
          note: '180 chunks arrive. Then the laptop loses its network.',
        },
        {
          from: 'device',
          to: 'api',
          label: 'PUT /uploads/u-95/parts/3 (no answer)',
          note: 'The request reached the API and its transaction committed, but the answer was lost with the connection.',
        },
        {
          from: 'device',
          to: 'api',
          label: 'PUT /uploads/u-95/parts/3, again',
          note: 'Twenty minutes later, with the same chunks. The reserved counter is already 4, so the condition "reserved = 3" would fail: the API sees that part 3 is stored with the same list and answers as the first time, without touching a reference. The client then sends parts 4 and 5.',
        },
        {
          from: 'device',
          to: 'api',
          label: 'GET /namespaces/ns-ana/uploads/u-95',
          note: 'The client’s journal knows which PUTs were answered, but a crash can lose the journal, so it asks.',
        },
        {
          from: 'api',
          to: 'chunks',
          label: 'BatchGetItem per part, consistent',
          note: 'Six reads of up to 90 rows. Every chunk of the list has a row, because the parts created them. None is marked stored yet: that mark is set only after the API has seen the object.',
        },
        {
          from: 'api',
          to: 's3',
          label: 'HeadObject for each chunk not marked stored',
          note: 'Up to 100 at a time. 180 objects exist with the right size and checksum, and their rows are marked stored. 320 do not.',
        },
        {
          from: 'api',
          to: 'device',
          label: '200 {missing: 320 chunks with fresh URLs}',
          note: 'URLs are issued only while the upload’s due time is more than 2 hours away, so no URL outlives the upload it belongs to. Inside those last 2 hours a request that would need a URL is answered 410, as for an expired upload, and the client starts a new upload, whose reserve finds the chunks already stored.',
          style: 'reply',
        },
        {
          from: 'device',
          to: 's3',
          label: 'PUT the 320 missing chunks',
          note: 'Nothing that arrived before the interruption is sent again.',
        },
        {
          from: 'device',
          to: 'api',
          label: 'POST /uploads/u-95/commit',
          note: 'The API checks the 320 new objects, and the commit transaction is the same writes as for a small file, seven at most. The chunk list is not copied: the version points at the upload.',
        },
        {
          from: 'api',
          to: 'meta',
          label: 'TransactWriteItems: commit u-95',
          note: 'If the file moved on during the hours the upload took, this is a 409 and the video becomes a conflict copy, with nothing to upload again.',
        },
      ],
    },
    {
      id: 'duplicate-commit',
      title: 'A duplicate commit after a lost reply',
      kind: 'sync',
      summary:
        'The commit of upload u-91 succeeds, but the answer does not reach the laptop. The laptop commits again and receives the same version, and nothing is written twice.',
      runsOn: 'Sync API on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'device', label: 'Laptop', service: 'Sync client' },
        { id: 'api', label: 'Sync API', service: 'ALB + ECS Fargate' },
        { id: 'meta', label: 'Metadata table', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'device',
          to: 'api',
          label: 'POST /uploads/u-91/commit',
          note: 'The first attempt, as in the upload flow: the API checks the new chunk in storage and runs the transaction.',
        },
        {
          from: 'api',
          to: 'meta',
          label: 'TransactWriteItems: commit u-91',
          note: 'Succeeds: version 8, entry 4,813, quota updated, and the upload row now says committed with version 8 and seq 4813. The API task is stopped by a deploy before it answers.',
        },
        {
          from: 'device',
          to: 'api',
          label: 'POST /uploads/u-91/commit, again',
          note: 'After a timeout of 30 seconds. The client makes up to five attempts with waits of 1, 2, 4 and 8 seconds between them; after that the file stays marked as pending and is tried again on the next 5-minute cycle.',
        },
        {
          from: 'api',
          to: 'meta',
          label: 'GetItem upload u-91, consistent',
          note: 'Every commit starts with this read. The status is committed, so there is nothing to do.',
        },
        {
          from: 'api',
          to: 'device',
          label: '200 {version: 8, seq: 4813}',
          note: 'The stored result, the same as the first answer would have been. Had the repeat arrived while the first was still running, its transaction would have been cancelled by the condition "status = open" on the upload, and the API would have read the row again and answered the same. The quota was added once, in the one transaction that succeeded.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'delete-collect',
      title: 'A delete, and 30 days later the collection of its chunks',
      kind: 'scheduled',
      summary:
        'Ana deletes the spreadsheet. The file can be restored for 30 days. Then the collector gives back the references of its last version and deletes the one chunk that nothing else lists.',
      runsOn: 'Sync API → Amazon DynamoDB; Collector on ECS Fargate → Amazon DynamoDB → Amazon S3',
      participants: [
        { id: 'device', label: 'Laptop', service: 'Sync client' },
        { id: 'api', label: 'Sync API', service: 'ALB + ECS Fargate' },
        { id: 'meta', label: 'Metadata table', service: 'DynamoDB' },
        { id: 'collector', label: 'Collector', service: 'ECS Fargate' },
        { id: 'chunks', label: 'Chunk index', service: 'DynamoDB' },
        { id: 's3', label: 'Blob storage', service: 'Amazon S3' },
      ],
      steps: [
        {
          from: 'device',
          to: 'api',
          label: 'DELETE /namespaces/ns-ana/files/{path} {baseVersion: 8, opId: op-17}',
          note: 'A delete is a commit without an upload.',
        },
        {
          from: 'api',
          to: 'meta',
          label:
            'TransactWriteItems: seq + 1, tombstone 9 IF version = 8, log entry, upload u-91 superseded, quota − 12 MB',
          note: 'The file row becomes a tombstone with version 9 and remembers op-17, so a repeat of this request is answered from the row. Upload u-91 gets a due time 30 days ahead. Its chunks keep their references, so the file can be restored by committing its chunk list again.',
        },
        {
          from: 'api',
          to: 'device',
          label: '200 {version: 9, seq: 4815}',
          note: 'Other devices read a delete entry and remove their copy. Thirty days pass.',
          style: 'reply',
        },
        {
          from: 'collector',
          to: 'meta',
          label: 'Query due index: shard 37, due before now',
          note: 'The index has 64 shard keys and is sorted by due time. Each collector task walks the shards in a random order, about once a minute. It finds u-91 with status superseded. An open upload found here is first set to expired, if its status is still open, which is the write that a late commit of it would lose to.',
          style: 'async',
        },
        {
          from: 'collector',
          to: 'chunks',
          label:
            'TransactWriteItems: upload released 0 → 1 IF released = 0, refs − 1 on c1, c2, c3',
          note: 'One transaction per part of the chunk list. The counter on the upload is what stops a second collector task, or this one after a crash, from giving the same references back twice.',
        },
        {
          from: 'collector',
          to: 'chunks',
          label: 'DeleteItem c1, c2, c3 IF refs = 0 AND suffix = the one in the list',
          note: 'c3 is at zero and its row is deleted. c1 and c2 are still listed by a copy of the file, so their conditions fail and they stay. An upload that wants c3 at this moment either added its reference first, and this delete fails, or finds no row afterwards and creates one with a new suffix and uploads the bytes again.',
        },
        {
          from: 'collector',
          to: 's3',
          label: 'DeleteObjects [ns-ana/c3.suffix]',
          note: 'Only now, and for every chunk of the part whose row is gone or has another suffix, whoever deleted it. The key belongs to that one row, so deleting it twice or late removes nothing that a newer row points at. A key that is no longer there is reported as deleted.',
        },
        {
          from: 'collector',
          to: 'meta',
          label:
            'UpdateItem upload collected 0 → 1 IF collected = 0; then delete part, version and upload rows',
          note: 'A crash before this write leaves the upload in the index, and the next pass repeats the deletes of this part, which is harmless. The upload row goes last, so the work stays findable until it is done.',
        },
      ],
    },
    {
      id: 'catch-up',
      title: 'A device that was offline for weeks catches up',
      kind: 'sync',
      summary:
        'Ana’s tablet was in a drawer for three weeks. Its cursor is 4,102 and the namespace is at 4,813. It reads 711 entries in two pages, keeps the last one per path and downloads only those.',
      runsOn: 'Sync API on ECS Fargate → Amazon DynamoDB → Amazon CloudFront',
      participants: [
        { id: 'tablet', label: 'Tablet', service: 'Sync client' },
        { id: 'api', label: 'Sync API', service: 'ALB + ECS Fargate' },
        { id: 'meta', label: 'Metadata table', service: 'DynamoDB' },
        { id: 'cdn', label: 'CDN', service: 'CloudFront + S3' },
      ],
      steps: [
        {
          from: 'tablet',
          to: 'api',
          label: 'GET /namespaces/ns-ana/changes?cursor=4102&trigger=start',
          note: 'The first thing a client does when it starts or wakes, before it opens its socket. Reads marked start are left out of the sync objective, because the device was not online when these changes were committed.',
        },
        {
          from: 'api',
          to: 'meta',
          label: 'Query log entries after 4102, limit 500, consistent',
          note: 'The first entry is 4,103, the cursor plus one, so nothing was trimmed: the log keeps 90 days and the oldest entry here is three weeks old.',
        },
        {
          from: 'api',
          to: 'tablet',
          label: '200 entries 4103 to 4602, more: true',
          note: 'The numbers in a page have no holes. The tablet asks again with cursor 4,602 and receives 4,603 to 4,813. The first answer carries the grant, so the tablet opens its socket then, before it applies anything, and reads once more, again marked start, when the notifier confirms the subscription; here that read returns nothing after 4,813.',
          style: 'reply',
        },
        {
          from: 'tablet',
          to: 'tablet',
          label: 'keep the last entry per path: 711 entries, 140 paths',
          note: 'A file saved 40 times in three weeks is downloaded once. Paths whose last entry is a delete are removed locally. An unmount entry in the personal namespace makes the tablet drop that shared folder.',
        },
        {
          from: 'tablet',
          to: 'api',
          label: 'GET /files/{path}/versions/{v} for each changed path',
          note: 'The last entry of a path names its current version, or one replaced after the tablet read the log and therefore kept for 30 more days. The chunk list is there in both cases.',
        },
        {
          from: 'tablet',
          to: 'cdn',
          label: 'GET the chunks it lacks',
          note: 'Compared against the chunks of the old versions it still holds, so a large file with a small edit costs one chunk.',
        },
        {
          from: 'tablet',
          to: 'tablet',
          label: 'save cursor 4813',
          note: 'Only after every path is applied. A crash on the way repeats the read from 4,102, and files already at the listed version are skipped. Had the cursor been older than the log, the first answer would have been 410: the tablet would then read the sequence number and the list of files with GET /files, apply that list, and continue from that number.',
        },
      ],
    },
    {
      id: 'lost-hint',
      title: 'A hint is lost and the timer read repairs it',
      kind: 'async',
      summary:
        'A node of the hint channel fails over at the moment of a commit. The commit succeeds, no hint arrives, and the phone finds the change on its next 5-minute read.',
      runsOn: 'Sync API on ECS Fargate → ElastiCache for Valkey → Notifier; then phone → Sync API',
      participants: [
        { id: 'api', label: 'Sync API', service: 'ALB + ECS Fargate' },
        { id: 'bus', label: 'Hint channel', service: 'ElastiCache for Valkey' },
        { id: 'notifier', label: 'Notifier', service: 'ALB + ECS Fargate' },
        { id: 'phone', label: 'Phone', service: 'Sync client' },
        { id: 'meta', label: 'Metadata table', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'api',
          to: 'bus',
          label: 'SPUBLISH ns-ana 4813 (times out)',
          note: 'The commit transaction has already succeeded. The publish gets 50 ms and one attempt; the API counts the failure and answers the laptop 200. A commit never waits for the channel.',
          style: 'async',
        },
        {
          from: 'bus',
          to: 'notifier',
          label: 'connection reset, resubscribe',
          note: 'A replica is promoted. Each notifier task reconnects and subscribes again to the channels of its sockets. Messages published in between are gone: the channel keeps nothing.',
          style: 'async',
        },
        {
          from: 'phone',
          to: 'api',
          label: 'GET /namespaces/ns-ana/changes?cursor=4812&trigger=timer',
          note: 'Up to 5 minutes later. Every device reads each of its cursors every 5 minutes at a time offset of its own, whether or not hints arrive, so 12 million subscriptions make a steady 40,000 reads a second and never a burst.',
        },
        {
          from: 'api',
          to: 'meta',
          label: 'Query log entries after 4812, consistent',
          note: 'Entry 4,813 is there: the log does not depend on the hint.',
        },
        {
          from: 'api',
          to: 'phone',
          label: '200 [{seq: 4813, ...}]',
          note: 'The API records an entry read minutes after its commit, which counts as a miss for the sync objective. A rising share of such entries is how a failing hint path shows up.',
          style: 'reply',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'How do we split files into chunks?',
      options: [
        {
          name: 'Whole file, as one multipart upload',
          pros: 'No chunk list. The storage service already resumes a multipart upload part by part.',
          cons: 'Every small edit uploads the whole file again, nothing is shared between versions, and an upload that is never finished keeps its parts until someone aborts it.',
        },
        {
          name: 'Fixed-size chunks',
          pros: 'Simple and fast, and enough for files that are edited in place.',
          cons: 'Inserting a byte near the start shifts every boundary after it, so all the later chunks look new.',
        },
        {
          name: 'Content-defined chunks',
          pros: 'Boundaries follow the content, so an insertion changes only the chunks around it.',
          cons: 'More CPU on the client, and chunk sizes vary, so they need a minimum and a maximum.',
        },
      ],
      choice:
        'Content-defined chunks: a rolling hash over a sliding window cuts where its low bits are zero, with a target of 4 MB, a minimum of 1 MB and a maximum of 8 MB. Each chunk is named by its SHA-256, and a version is an ordered list of those names. A 50 GB file is about 12,500 chunks, sent to the API in 139 parts of 90. Clients pay a little CPU, and both bandwidth and storage drop for the common case of a small edit to a large file.',
    },
    {
      question: 'Where does deduplication stop, and what does it leak?',
      options: [
        {
          name: 'One chunk store for all users, upload skipped when the hash is known',
          pros: 'The largest saving: a popular file is stored and uploaded once for everyone.',
          cons: 'An upload that finishes at once tells the uploader that someone already has that file, and a person who learns a hash can claim the file without having its bytes, unless every skip is backed by a proof of possession.',
        },
        {
          name: 'One chunk store for all users, bytes always uploaded',
          pros: 'Storage is still shared, and timing reveals nothing.',
          cons: 'No bandwidth saved, a reference count that spans every user, and a single index that every commit and every collection in the system contends on.',
        },
        {
          name: 'Deduplicate inside a namespace only',
          pros: 'The server can skip an upload only for bytes that the caller could already download, so there is nothing to leak and nothing to prove.',
          cons: 'The same file in two users’ folders is stored twice.',
        },
      ],
      choice:
        'Inside a namespace only. Chunk rows are keyed by namespace and hash, and object keys start with the namespace, so a lookup cannot reach another namespace even by mistake. This keeps the saving that matters most, between versions of a file and between copies and renames in one folder, where a new path with the same chunk list uploads nothing. It gives up the saving across users, and it is why a file copied into a shared folder is uploaded again. A member of a shared folder can learn that a chunk is already in that folder, which they are allowed to read anyway.',
    },
    {
      question: 'How does a commit stay clear of the collector?',
      options: [
        {
          name: 'Check that the chunks exist when committing',
          pros: 'One existence check per chunk, no counters.',
          cons: 'The collector can delete a chunk between the check and the commit, and the new version lists a chunk that is gone.',
        },
        {
          name: 'A grace period: collect only chunks unreferenced for some days',
          pros: 'No coordination between the commit and the collector.',
          cons: 'A timer makes the race unlikely, not impossible: a client told to skip a chunk on the last day of its grace can commit after the sweep picked it.',
        },
        {
          name: 'Take the references inside the commit transaction',
          pros: 'The count and the version change together.',
          cons: 'A transaction holds 100 writes and a 50 GB file lists about 12,500 chunks, so the largest files could not commit.',
        },
        {
          name: 'The upload takes the references before it commits',
          pros: 'References are added part by part, each part in its own transaction, and the collector deletes a chunk row only with a write that requires a count of zero. One of the two writes fails.',
          cons: 'Two transactional writes per chunk and version, and an abandoned upload pins its chunks until it expires after 7 days.',
        },
      ],
      choice:
        'The upload takes the references. Each part of the chunk list is one transaction that stores the part, adds to refs on up to 90 chunk rows and moves the upload’s reserved counter, on the condition that the upload is open and the counter is where the part expects it, so a repeated part cannot count twice and an expired upload cannot take new references. A chunk row is created by the first upload that lists it, before any byte is sent, so there is never an object without a row that counts its references. The commit then needs only the upload: its condition, status = open, is the same field the collector flips to expired before it gives references back, so an upload cannot both commit and be released. Existence is checked against storage once per chunk and remembered in the stored flag, and the check cannot go stale: objects are deleted only after their row, a row with references is not deleted, and an upload URL signs the chunk’s checksum header, so a PUT repeated through it within its hour stores the same bytes or is refused.',
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
          cons: 'Does not work offline, and a device that crashes or goes into a drawer leaves the file locked unless the lock expires, at which point two writers are possible again.',
        },
        {
          name: 'Commit against a base version, keep the loser as a conflict copy',
          pros: 'One conditional write decides, with no lock held during the upload, and both edits survive for any file format.',
          cons: 'The user has to merge the two copies by hand.',
        },
      ],
      choice:
        'Commit against a base version. The commit is one transaction of up to seven writes: the sequence number of the namespace, the file row with the condition version = base, the version, the log entry, the upload turned to committed, the replaced upload given its 30-day due time, which a new path does not have, and the owner’s used bytes. The reasons of a cancelled transaction say which condition failed. The upload row means a repeat and is looked at first. The file row means a stale base and a 409, and it wins over the sequence reason when both fail. The sequence number alone means another commit in the namespace got there first, and the API tries again, three tries in all, before answering 503 with Retry-After; a TransactionConflict, which an overlapping transaction causes, is retried like a sequence loss. The account row means the quota. The client that gets the 409 commits the same chunks under a conflict path, uploading nothing, unless the winning version has the same chunk list, or is a tombstone, which the client commits against instead.',
    },
    {
      question: 'How is the change log ordered, and who keeps the cursor?',
      options: [
        {
          name: 'Order by commit timestamp',
          pros: 'No counter to contend on.',
          cons: 'Two servers’ clocks differ, so an entry can be written with a time earlier than one a device has already passed, and that device never sees it.',
        },
        {
          name: 'One global sequence for all namespaces',
          pros: 'A single cursor per device.',
          cons: 'Every commit in the system contends on one counter, and a device reads past everyone else’s changes.',
        },
        {
          name: 'A sequence per namespace with no holes, cursor on the device',
          pros: 'Commits contend only within a namespace, and a reader can tell a missing entry from a quiet log.',
          cons: 'A device that follows several namespaces keeps several cursors, and one namespace is limited to about 20 commits a second.',
        },
      ],
      choice:
        'A sequence per namespace. The commit moves seq from n to n + 1 with a condition on n and writes the entry under n + 1 in the same transaction, so every number is used once and none is skipped. The device keeps the cursor and saves it only after it has applied every path it read, so the server stores nothing per device and a crash repeats work instead of skipping it. Reads are consistent. Entries expire after 90 days, and the store removes expired rows in no particular order, so the API trusts the numbers and not the absence of rows: if the first entry after the cursor is not the cursor plus one, or a page has a hole, the log was trimmed and the answer is 410. The namespace’s own row sorts right after its entries and comes back in the same query, so an empty page while seq is above the cursor is also a 410. The device then takes a snapshot whose starting number is read before the listing begins.',
    },
    {
      question: 'How do devices learn about changes?',
      options: [
        {
          name: 'Poll every few seconds',
          pros: 'Stateless and simple to scale behind a load balancer.',
          cons: 'Nearly every poll finds nothing: 2.4 million requests a second at a 5-second interval, and a slower interval is slower sync.',
        },
        {
          name: 'Push the changes themselves over a socket',
          pros: 'Lowest latency, one step less.',
          cons: 'Delivery becomes part of correctness: a dropped message leaves a device behind, so it still needs the cursor read as a second path.',
        },
        {
          name: 'A managed WebSocket gateway with a table of connections',
          pros: 'No socket servers to run.',
          cons: 'A connection row per device to keep and to clean, a lookup and a call per device on every commit, and connections that the gateway closes after 2 hours.',
        },
        {
          name: 'A hint over a socket, then the cursor read, plus a timer read',
          pros: 'The hint may be lost at no cost to correctness, and one read path serves a device that was away a second or a month.',
          cons: 'Ten million open sockets to hold, and a read every 5 minutes per subscription as the price of not trusting the hint.',
        },
      ],
      choice:
        'A hint, then the cursor. Each device holds one socket to a notifier task and names its namespaces; the task subscribes to one pub/sub channel per namespace. The Sync API publishes {namespace, seq} after the commit transaction, once, waiting at most 50 ms. That is a commit followed by a separate publish, which can lose the publish, and the repair is the read every device makes of each cursor every 5 minutes, at an offset of its own. A device that starts, wakes or changes network reads at once, opens its socket as soon as that read returns the grant and before it applies anything, and reads once more when the notifier confirms the subscription, so a change committed between the first read and the subscription does not wait for the timer. A device whose socket was closed by the server reconnects with a backoff from 1 second up to 5 minutes and reads nothing extra, so a notifier deploy causes no burst of reads; a change committed during the gap waits for the timer.',
    },
    {
      question: 'How does an upload survive interruptions and repeats?',
      options: [
        {
          name: 'Start over',
          pros: 'No state on the server.',
          cons: 'A 50 GB upload on a home connection may never finish.',
        },
        {
          name: 'The client remembers what it sent',
          pros: 'No server call to resume.',
          cons: 'The journal is lost with a crash or a reinstall, and the server cannot tell an upload in progress from garbage.',
        },
        {
          name: 'An upload on the server, keyed by an id the client chose',
          pros: 'Any call can be repeated: the id finds the same upload, the part counter refuses a second count, and the API can say which chunks are still missing.',
          cons: 'An upload row and its parts to store for up to 7 days, and a check against storage for each chunk not yet seen.',
        },
      ],
      choice:
        'An upload on the server. The id is the idempotency key of everything: creating it twice returns the first one, part k is counted only when the reserved counter is k, and a commit of a committed upload returns the stored version and sequence number. Resuming is a GET that checks storage for the chunks not yet marked stored and returns the rest with new URLs. Bounds: a chunk gets three attempts per URL and fresh URLs once, and then its file waits for the next cycle; a call to the API is tried five times with waits of 1 to 8 seconds and then the file waits, marked pending, for the next 5-minute cycle; an upload not committed 7 days after it was created expires, and the client starts a new one, whose reserve finds whatever chunks are still stored.',
    },
    {
      question: 'How does the collector find and delete garbage?',
      options: [
        {
          name: 'Delete a version’s chunks when the version is replaced',
          pros: 'Space is freed at once, no background work.',
          cons: 'No history to restore, and the delete races every upload that lists one of those hashes.',
        },
        {
          name: 'Mark and sweep: read every chunk list, delete what none of them names',
          pros: 'No counters to keep right.',
          cons: 'Each pass reads the whole namespace, and a commit that lands during the sweep needs a fence of its own.',
        },
        {
          name: 'Release references when a due time passes, delete at zero',
          pros: 'The collector looks only at chunks one of whose references was just given back, and each delete is one conditional write.',
          cons: 'A count per chunk that every commit and every release must keep exact.',
        },
      ],
      choice:
        'Release at a due time, delete at zero. Uploads carry a due time in a sparse index with 64 shard keys: 7 days after creation while open, 2 hours after an abort, 30 days after the version was replaced or the file deleted. A current version has none. For each due upload the collector first settles the status with a conditional write, open to expired, and then works part by part: a transaction subtracts the part’s references and moves the released counter, a conditional delete removes each chunk row whose count is zero and whose suffix is the one in the list, a batch delete removes the objects of the rows that are gone, and the collected counter moves. Every step is conditional or repeatable, so two collector tasks on the same upload, or a crash at any point, cost repeated work and nothing else. The object key ends in the row’s random suffix, so a delete that arrives late cannot hit an object that a newer row for the same hash points at.',
    },
    {
      question: 'How is quota counted?',
      options: [
        {
          name: 'Count the bytes actually stored, after deduplication and with history',
          pros: 'Matches the bill.',
          cons: 'The number moves when the collector runs or when another file drops a shared chunk, which no user can predict.',
        },
        {
          name: 'A counter updated after the commit',
          pros: 'The commit is smaller.',
          cons: 'A crash between the two leaves the counter wrong, and a retry can add the same file twice.',
        },
        {
          name: 'The size of current versions, changed inside the commit transaction',
          pros: 'The counter and the version change together or not at all, and the condition refuses a commit that would pass the quota.',
          cons: 'History and uploads in progress are not counted, and all commits charged to one account touch one row.',
        },
      ],
      choice:
        'Current versions, inside the commit. The transaction adds the new size minus the size of the base version to the owner’s used bytes. The new size is the one declared at create, and the commit accepts it only when it equals the sum of the sizes on the rows of the listed chunks, each of which was compared with its object in storage, so a client is not charged for less than its list holds. A condition cannot do arithmetic, so the API computes the highest value that still fits, the quota minus the difference, and the write requires used bytes to be at most that and the quota to be the one it read. A delete subtracts with no condition. A shared folder is charged to its owner. What the user sees is therefore exact and never counted twice; what is stored can be more, because a replaced version stays 30 days and an open upload up to 7.',
    },
    {
      question: 'How do version history and restore work?',
      options: [
        {
          name: 'Keep every version forever',
          pros: 'Nothing to expire.',
          cons: 'Storage grows with every save: a file saved daily keeps hundreds of versions of its changed chunks.',
        },
        {
          name: 'Keep the last few versions of each file',
          pros: 'Bounded per file.',
          cons: 'An autosaving program burns through them in minutes, and yesterday’s good version is gone.',
        },
        {
          name: 'Keep replaced versions for 30 days, restore by committing again',
          pros: 'A time window users can reason about, and restore needs no path of its own.',
          cons: 'A file rewritten often holds up to 30 days of its changed chunks, outside the quota.',
        },
      ],
      choice:
        'Thirty days, and restore is an ordinary commit. The client reads the chunk list of the old version and opens an upload with it against the current version, or against the tombstone if the file was deleted. The reserve takes new references; every chunk is still stored, so nothing is uploaded, and the commit makes a new version with the old content. Versions are never changed or revived, so the collector needs no fence against restore: if a restore and the release of the old version cross, the parts reserved first hold their chunks, a later part finds a chunk gone and asks for bytes the client does not have, and the client aborts and reports that the version has expired.',
    },
    {
      question: 'Who can read what, and what protects the bytes?',
      options: [
        {
          name: 'Copy shared files into every member’s own folder',
          pros: 'No permission check at read time.',
          cons: 'Every edit has to be copied to every member, and two members’ edits have no common history to conflict in.',
        },
        {
          name: 'A permission list on every file',
          pros: 'Fine-grained.',
          cons: 'A check per file on every listing, and a log per user that mixes files from everywhere.',
        },
        {
          name: 'A shared folder is a namespace with members',
          pros: 'One member row answers every request, and the folder has its own log, sequence and chunks.',
          cons: 'Sharing is by folder, and a file moved between namespaces is uploaded again.',
        },
      ],
      choice:
        'A namespace with members. Every request carries a short-lived token, and the API reads the member row of the caller before anything else: viewers read, editors commit, the owner manages members. Adding a member is one transaction that also appends a mount entry to the log of that user’s personal namespace, so their devices learn of the folder through the cursor they already follow. Bytes are reached only through signed URLs: an upload URL is for one object key and one SHA-256 for 1 hour, and a download policy covers one namespace prefix for 1 hour. The bucket is private and encrypted at rest, and the CDN reads it with its own identity. A removed member is refused by the API on the next request, and can still fetch chunks whose keys they already know until their policy expires, at most 1 hour later. Their socket also keeps receiving hints for that namespace, a sequence number and no content, until its grant for the notifier expires, also at most 1 hour later. A web application firewall rate-limits by address in front of the API and the notifier, and requests are logged with ids and sizes, never with paths or signed URLs.',
    },
  ],
  wrapUp:
    'Cut files into content-defined chunks named by their hash and stored once per namespace; let an upload take a reference on every chunk before a byte travels; send bytes straight to blob storage; commit with one transaction that checks the base version, appends to a log without holes and updates the quota; tell devices with a hint they can afford to lose, and have them read from a cursor; keep replaced versions 30 days, and delete a chunk only with a write that requires zero references.',
  guarantees: {
    provides: [
      {
        property: 'Durability of a commit',
        promise:
          'A commit is acknowledged only after every chunk on its list was found in blob storage with the right size and SHA-256, and after one transaction wrote the version, the log entry and the quota. Blob storage keeps each object in at least three Availability Zones, and the transaction is acknowledged by the table only once it is durable. An acknowledged version is then kept while it is current and for 30 days after.',
      },
      {
        property: 'No dangling version',
        promise:
          'A kept version lists only chunks that exist. An upload holds a reference on every chunk before it can commit, a chunk row is deleted only by a write that requires zero references, an object is deleted only after its row, and a row created again gets a new object key. An upload cannot both commit and be released, because both are conditional on its status.',
      },
      {
        property: 'One winner per base version',
        promise:
          'Of any number of commits that name the same base version of a file, at most one succeeds. The others are answered 409 and nothing of theirs is written. The server never replaces a version that the committing device had not seen.',
      },
      {
        property: 'A complete, ordered log',
        promise:
          'Each namespace’s entries are numbered without holes in commit order, in the same transaction as the change they describe. A device that reads consistently from its cursor and saves the cursor after applying sees every change, or is told with a 410 that its cursor is older than the 90 days the log keeps.',
      },
      {
        property: 'Idempotent requests',
        promise:
          'Creating an upload, sending a part, committing and deleting can each be repeated. The upload id, the part number and the operation id make the repeat return the first result, for as long as the upload row exists: until the version is released, or 7 days for one never committed. A delete has no upload row: its operation id is on the file row, and a repeat gets the first result until the next operation on that path.',
      },
      {
        property: 'Exact quota',
        promise:
          'Used bytes are the sum of the sizes of current versions in the namespaces an account owns. They change only inside the transaction that changes a version, so a repeated or failed commit counts nothing twice, and a commit that would pass the quota is refused.',
      },
      {
        property: 'Hints are optional',
        promise:
          'A commit does not wait for the hint channel or the notifier. A change whose hint is lost reaches an online device on its next timer read, at most 5 minutes later plus the read itself.',
      },
      {
        property: 'No leak between namespaces',
        promise:
          'The server skips an upload only for a chunk already stored in the namespace the caller is a member of. Whether a chunk exists anywhere else cannot be observed.',
      },
    ],
    assumes: [
      'The table supports transactions over several tables, conditional writes and consistent reads, and blob storage answers a read of an object’s metadata consistently after a write.',
      'Clients follow the protocol: they answer a 409 with a conflict copy, reuse the upload id when they repeat, check the SHA-256 of what they download and save the cursor only after applying.',
      'SHA-256 does not collide for two different chunks.',
      'Clocks of API and collector tasks agree within an hour. No correctness rule depends on this; it only keeps an upload URL, valid for 1 hour and not issued in the last 2 hours before a due time, from outliving its upload.',
      'A device is offline for less than 90 days, or accepts a snapshot.',
      'A namespace sees fewer than about 20 commits a second, and clients send the commits of one namespace one at a time.',
    ],
    doesNotGuarantee: [
      'A merge. Two edits of one version end as two files, and a person decides.',
      'That a misbehaving client keeps both edits. A client that answers a 409 by committing on top of the new version replaces it; the replaced version can be restored for 30 days.',
      'Delivery of a hint. A hint is published once after the commit and can be lost with an API task, a channel node or a socket; the bound is the 5-minute timer read.',
      'A change committed while a device’s socket was reconnecting within 10 seconds. It waits for the timer.',
      'An atomic rename or folder move. A rename is two commits, a new path and a delete, and a device can see the moment between them.',
      'Order between namespaces. Each has its own sequence, and a device applies them independently.',
      'A restore after 30 days, or of a version whose release has started.',
      'A log for a device away longer than 90 days. It takes a snapshot, and files it deleted locally in the meantime are compared by hand.',
      'More than about 20 commits a second in one namespace. Above that the API answers 503 with Retry-After, and a first sync of a folder with many small files is paced by it.',
      'Quota that reflects what is stored. History for 30 days and open uploads for 7 take space that no quota counts.',
      'Instant removal of bytes. A deleted file’s chunks stay 30 days, then until the collector reaches them, and up to 24 hours more in an edge cache.',
      'Instant removal of access. A removed member can download chunks whose keys they already hold for up to 1 hour, and receives hints for the namespace, sequence numbers with no content, for up to 1 hour.',
      'That no object is ever orphaned. An upload URL used after its chunk row was collected writes an object that no row points at; it takes a clock error of over an hour, and it wastes space without breaking any version.',
      'Detection of a missing chunk that nobody downloads. The count of confirmed misses sees only chunks that a device asked for.',
      'Deduplication across namespaces. The same file in two folders is stored twice.',
    ],
  },
  failures: [
    {
      scenario: 'A device loses its network in the middle of a large upload.',
      impact:
        'The upload stops. Chunks already in storage stay, pinned by the upload’s references. The file shows as pending on that device and nothing has changed for anyone else.',
      detection:
        'Nothing to detect on the server: an open upload is normal. The count of open uploads older than a day is a baseline worth a graph, not a page.',
      recovery:
        'When the network returns, the client repeats the call it was making and asks which chunks are missing. It sends only those and commits. If it never returns, the collector sets the upload to expired 7 days after its creation and gives its references back.',
    },
    {
      scenario:
        'The answer to a commit is lost, or an API task is stopped after its transaction succeeded.',
      impact:
        'The file is committed, but the client does not know. The hint for it may not have been published either.',
      detection:
        'Nothing to detect for one event. Commits answered from the stored result are counted, and their share is the baseline of repeats.',
      recovery:
        'The client commits again with the same upload id, up to five times and then on its next 5-minute cycle. The API reads the upload, finds it committed and returns the stored version and sequence number. Other devices get the change by hint or, if the hint was the casualty, by timer.',
    },
    {
      scenario: 'Two commits name the same base version, or two commits in one namespace overlap.',
      impact:
        'One transaction succeeds. A commit that lost on the file row is a conflict; one that lost only on the sequence number lost a race with an unrelated file.',
      detection:
        'The API counts 409 answers and sequence retries. A namespace with many sequence retries is close to its limit of about 20 commits a second.',
      recovery:
        'A conflict goes back to the client, which commits a conflict copy without uploading. A sequence loss, or a TransactionConflict, is tried again by the API with the new number, three tries in all, then answered 503 with Retry-After of 1 second; the client’s own five attempts follow, and after them the file waits for the next cycle. Nothing is lost at any of these steps: the upload stays open with its references.',
    },
    {
      scenario:
        'The hint channel fails over, or an API task dies between the commit and the publish.',
      impact:
        'Hints for commits in that window never arrive. Those changes reach online devices up to 5 minutes late. Commits and reads are unaffected.',
      detection:
        'The share of entries that online devices read by timer, measured by the Sync API, and the count of failed publishes. The failover itself arrives as an event from the cache service.',
      recovery:
        'Each notifier task reconnects and subscribes again. Nothing is replayed: every device reads each cursor on its own 5-minute timer and finds what it missed. The timer reads are already part of the steady load, so a channel outage adds none.',
    },
    {
      scenario:
        'A notifier deploy closes a tenth of the sockets per wave, and the loss of an Availability Zone a third.',
      impact:
        'About 1 million devices in each wave of a deploy, or 3.3 million when a zone is lost, lose their socket and get no hints until they reconnect, seconds for most of them. Changes committed in that gap are read by timer.',
      detection:
        'ActiveConnectionCount and HealthyHostCount on the notifier’s load balancer, which the load balancer publishes itself, and the share of entries read by timer.',
      recovery:
        'Devices reconnect with a backoff from 1 second to 5 minutes and a random factor. The notifier runs 300 tasks at 33,000 sockets each, and a task takes 50,000, so the 200 tasks left after a zone is lost hold all 10 million. A reconnect triggers no read, so the API sees no burst.',
    },
    {
      scenario:
        'The collector crashes between deleting a chunk row and deleting its object, or stops for a day.',
      impact:
        'An object without a row, or due uploads piling up. Space is held longer. No version is affected, because the collector only ever removes what has zero references.',
      detection:
        'The age of the oldest due upload, published by the collector every minute and alarmed at 6 hours with missing data counted as breaching, so a collector that is down fires it by its silence.',
      recovery:
        'The upload stays in the due index until its collected counter has passed every part, so the next pass repeats the part: rows already gone are skipped and their objects are deleted again by key. An upload that makes the collector fail every time stays at the head of its shard and keeps the alarm on until a person looks at it; the other uploads of the shard are still processed.',
    },
    {
      scenario: 'Blob storage rejects writes or is slow for a prefix that is growing fast.',
      impact:
        'Chunk uploads get 503 and take longer. Commits that need to check new chunks wait or fail. Commits with nothing new to upload, deletes and cursor reads are unaffected.',
      detection:
        '5xxErrors and TotalRequestLatency in the bucket’s request metrics, and the Sync API’s count of commits that could not check a chunk.',
      recovery:
        'The client repeats a failed PUT with backoff, three attempts per URL, asks for fresh URLs once and tries those, and then leaves the file pending for the next cycle. The upload and the chunks already stored stay for 7 days. The API answers 503 for a commit whose check failed, and the client repeats it.',
    },
    {
      scenario:
        'The metadata table throttles: a table not warmed for the peak, or one very busy namespace.',
      impact:
        'Some commits and reads are answered 503 with Retry-After. In the second case only that namespace is slow.',
      detection:
        'ThrottledRequests on the tables, WriteThrottleEvents on the due index, and WriteKeyRangeThroughputThrottleEvents, which says that one partition is the cause.',
      recovery:
        'Clients back off and repeat; files stay pending on the device and nothing is lost. A table below its peak is fixed by raising its warm throughput. A namespace above its limit stays slow until its traffic drops: splitting a busy shared folder into several is a product decision, not something the system does.',
    },
    {
      scenario: 'A device asks for a chunk that a kept version lists and storage does not have it.',
      impact:
        'That version of that file cannot be downloaded in full. This should not happen: it means a bug in the collector or a loss in storage.',
      detection:
        'The device calls the version read with verify and the hash. The API looks in storage itself, and if the object is missing while the version is kept it counts a confirmed miss. The alarm pages on the first one.',
      recovery:
        'The on-call stops the collector and clears the stored flag on that chunk row, so the next upload that lists the hash is asked for the bytes. A device that still holds the file is told by support to scan it again, which commits it and uploads the chunk. If no device has the bytes, that version is lost and the earlier versions of the last 30 days are what remains.',
    },
    {
      scenario: 'A device comes back after four months with a cursor the log no longer covers.',
      impact:
        'The entries after its cursor have expired. Reading on from the next surviving entry would skip changes.',
      detection:
        'The API compares the first entry after the cursor with the cursor plus one. They differ, so it answers 410.',
      recovery:
        'The device reads the sequence number and then the list of files, applies the list and continues from that number. Entries committed while it was listing come after that number and are applied again harmlessly, because each names a version and a file already at that version is skipped.',
    },
    {
      scenario: 'An owner removes a member while that member’s device is syncing.',
      impact:
        'The device’s next API request for that namespace is refused. Downloads it had already started can finish, and for up to 1 hour it can fetch other chunks whose keys it already has. Its socket still receives hints for the namespace, numbers with no content, for at most the same hour.',
      detection:
        'Nothing to detect: the window is the stated one. Member changes are logged with who made them.',
      recovery:
        'The device reads an unmount entry in the log of its personal namespace and removes the folder. An upload it had open in the shared folder can no longer be committed and expires after 7 days.',
    },
  ],
  capacity: {
    assumptions: [
      '20 million users with 50 million devices. 10 million devices are online at peak, and each follows 1.2 namespaces on average: 12 million subscriptions.',
      '100 million commits a day, with a peak 3 times the average.',
      'An average commit lists 3 chunks and uploads 1 new chunk of about 1 MB. Chunks target 4 MB, and the largest file is 50 GB.',
      '60% of commits replace an earlier version, whose one changed chunk is freed 30 days later. Each commit is downloaded by one other device on average, which is online and gets a hint.',
      'Rows are under 1 KB: a plain write costs 1 write unit and a write inside a transaction 2; a consistent read of a row or of a short log page is counted as 1 read unit and an eventually consistent read as half.',
      'A Sync API task is planned for 1,000 requests a second and a notifier task for 50,000 sockets. Both are planning figures to confirm with a load test.',
      'A commit transaction takes about 15 ms from reading the sequence number to the write.',
    ],
    estimates: [
      {
        label: 'Commits',
        value: '~1,160 per second on average, 3,500 at peak',
        math: '100M ÷ 86,400 s = 1,157/s. Peak is 3 × the average ≈ 3,500/s.',
      },
      {
        label: 'New bytes',
        value: '100 TB a day, 28 Gbit/s at peak, straight to blob storage',
        math: '100M × 1 MB = 100 TB/day. 3,500/s × 1 MB = 3.5 GB/s × 8 = 28 Gbit/s. Downloads are the same: one device per commit.',
      },
      {
        label: 'Growth and history',
        value: '40 TB of net growth a day, ~14.6 PB a year; 1.8 PB of history held',
        math: '60% of 100M = 60M versions replaced a day, each freeing 1 MB after 30 days: 60 TB/day. 100 − 60 = 40 TB/day × 365 = 14.6 PB. 60 TB × 30 days = 1.8 PB waiting for release.',
      },
      {
        label: 'Polling against a timer',
        value: '2.4M requests a second when polling every 5 s, 40,000 with a 5-minute timer',
        math: '12M subscriptions ÷ 5 s = 2.4M/s. 12M ÷ 300 s = 40,000/s.',
      },
      {
        label: 'Sync API at peak',
        value: '~54,000 requests a second on 90 tasks',
        math: 'Commits 3,500/s × 2 calls (create, commit) = 7,000. Timer reads 40,000. Reads after a hint 3,500 and version reads 3,500. Total 54,000 ÷ 90 tasks = 600 each, 60% of the 1,000 planned.',
      },
      {
        label: 'Table writes per commit',
        value:
          '28 write units for a commit that replaces a version: 16 on the metadata table, 3 on its due index, 7 on the chunk index, 2 on the accounts table',
        math: 'Create: a transaction of 5 writes (upload, part, 3 chunk rows) = 10, of which 4 metadata and 6 chunks, plus 1 index write for the due time. Commit: 1 plain write of the stored flag, and a transaction of 7 writes = 14, of which 12 metadata and 2 accounts, plus 2 index writes as one upload leaves the index and the replaced one enters. 10 + 1 + 1 + 14 + 2 = 28. The 40% of commits that replace no version have 6 writes in the transaction and 1 index write, 25 in all; the peak figures count every commit at 28.',
      },
      {
        label: 'Table writes at peak',
        value:
          '~109,000 write units a second: metadata 60,200, due index 11,200, chunk index 30,800, accounts 7,000',
        math: 'Commits: 3,500/s × 28 = 98,000. Collector: 60M releases/day ÷ 86,400 ≈ 700/s × 16 = 11,200, around the clock. A release costs a transaction of 4 writes (the counter, 3 chunk rows) = 8, 3 conditional deletes of chunk rows, which cost a unit also when the condition fails, 1 for the collected counter, 3 deletes (part, version, upload) and 1 index write: metadata 6, chunks 9, index 1. Metadata 3,500 × 16 + 700 × 6 = 60,200; index 3,500 × 3 + 700 = 11,200; chunks 3,500 × 7 + 700 × 9 = 30,800; accounts 3,500 × 2 = 7,000.',
      },
      {
        label: 'Table reads at peak',
        value: '~120,000 read units a second',
        math: 'Timer reads 40,000/s × 1.5 (the log query and the member row) = 60,000. Commits 3,500/s × about 14 (5.5 at create: member, file, account and 3 chunk rows; 8.5 at commit: upload, part, 3 chunk rows, sequence, file, account, member) = 49,000. Hint and version reads 7,000/s × 1.5 = 10,500.',
      },
      {
        label: 'Due index per shard key',
        value: '175 write units a second, of 1,000',
        math: '11,200/s ÷ 64 shard keys = 175, 17.5% of what one partition takes.',
      },
      {
        label: 'One namespace',
        value: 'about 20 commits a second',
        math: 'At 20/s, 20 × 0.015 s = 0.3 other commits land in a commit’s 15 ms window, so a try loses on the sequence number about 1 time in 4 and three tries in a row under 2% of the time. Those are answered 503. Its partition takes 20 × 16 = 320 of 1,000 write units.',
      },
      {
        label: 'Largest file',
        value: '50 GB: 12,500 chunks, 139 part calls, a commit of about 4 s',
        math: '50 GB ÷ 4 MB = 12,500. ÷ 90 = 139 parts, each a transaction of 92 writes. The commit checks 12,500 objects, 100 at a time at about 30 ms a round: 125 × 30 ms ≈ 3.8 s. One chunk list in one row would be 12,500 × 60 bytes = 750 KB, over the 400 KB a row can hold.',
      },
      {
        label: 'Notifier',
        value: '300 tasks at 33,000 sockets each; 3,500 hints a second',
        math: '10M ÷ 300 = 33,333 per task, two thirds of the 50,000 planned. One hint per commit. 12M channel subscriptions ÷ 3 shards = 4M per shard.',
      },
      {
        label: 'Change log',
        value: '9 billion entries, about 1.8 TB',
        math: '100M/day × 90 days = 9B entries × about 0.2 KB.',
      },
    ],
    implications: [
      'File bytes are three orders of magnitude more than metadata: 100 TB a day against a few hundred gigabytes of rows. They must not pass through the API, which is why uploads use signed URLs and downloads a CDN.',
      'Polling would cost 2.4 million requests a second to deliver 3,500 changes. The hint removes that, and the 5-minute timer that makes hints safe to lose is then the largest load left, 40,000 of 54,000 requests. The timer interval is the dial between cost and the worst delay after a lost hint.',
      'The metadata table peaks at 60,200 write units a second and a new on-demand table starts at 4,000, with a default quota of 40,000. Its quota is raised and all three tables are warmed to their peak before launch. The chunk index, keyed by namespace and hash together, spreads evenly; the metadata table is keyed by namespace, so one namespace is one partition and its limit is what bounds a single folder.',
      'Sync API: 90 tasks, 30 in each of three zones, deployed with a minimum healthy percent of 100 and a maximum of 125, so a deploy never runs below 90. A lost zone leaves 60 tasks at 900 requests each, 90% of the plan, until the container service starts replacements in the other zones.',
      'Notifier: 300 tasks, deployed 10% at a time with a minimum healthy percent of 100. Each wave closes 30 × 33,333 = 1 million sockets, which reconnect within seconds and trigger no reads. A lost zone moves 3.3 million sockets to the 200 remaining tasks, 50,000 each, exactly the planned limit, which is why the fleet is sized at 300 and not 200.',
      'The collector runs 4 tasks for 700 releases a second, 175 each; with one task lost the other three take 233 each. It can stop for hours with no effect on users: the cost is space, 60 TB for every day it is behind.',
      'Reference counting costs 7 of the 28 write units of a commit and 9 of the 16 of a release, all of them on the chunk index. That is the price of deleting with one conditional write, and it is the first thing to look at when the table bill matters more than the storage bill.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one region across three Availability Zones. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Sync API',
        service:
          'An Application Load Balancer that serves only this API, with AWS WAF, and Amazon ECS on AWS Fargate: 90 tasks over three zones',
        why: 'Stateless tasks that check the token and the member row, run the reserve and commit transactions, sign upload URLs and download policies, and publish hints. They carry no file bytes.',
        watch:
          'ALB TargetResponseTime, RequestCount, HTTPCode_Target_5XX_Count and HTTPCode_ELB_5XX_Count; ECS CPUUtilization. Custom: commits by outcome, sequence retries, failed publishes, entries read by trigger and by time since commit, confirmed missing chunks.',
      },
      {
        part: 'Metadata DB: files, versions, uploads and the change log',
        service:
          'Amazon DynamoDB, one on-demand table keyed by namespace, warmed to its peak, with a sparse global secondary index on a shard key and the due time, and time to live on log entries and tombstones at 90 days',
        why: 'One partition key per namespace puts the sequence number, the file, the version, the log entry and the upload in one transaction, and a consistent query reads the log in order. The index is how the collector finds due uploads without scanning.',
        watch:
          'ThrottledRequests, WriteKeyRangeThroughputThrottleEvents, SystemErrors, ConsumedWriteCapacityUnits, SuccessfulRequestLatency, TransactionConflict and ConditionalCheckFailedRequests; WriteThrottleEvents with the GlobalSecondaryIndexName dimension for the index; TimeToLiveDeletedItemCount.',
      },
      {
        part: 'Metadata DB: chunk index',
        service:
          'Amazon DynamoDB, an on-demand table keyed by namespace and hash together, warmed to its peak',
        why: 'One row per chunk with its reference count, stored flag and suffix. The key spreads rows evenly, so a 50 GB upload that touches 12,500 rows does not load the partition of its namespace. The delete at zero references is a conditional write here.',
        watch:
          'ThrottledRequests, ConsumedWriteCapacityUnits, TransactionConflict and SystemErrors.',
      },
      {
        part: 'Metadata DB: accounts',
        service: 'Amazon DynamoDB, an on-demand table keyed by account',
        why: 'Used bytes and quota in one row that the commit transaction updates with a condition, next to the list of namespaces a user can open.',
        watch: 'ThrottledRequests and ConditionalCheckFailedRequests.',
      },
      {
        part: 'Blob storage',
        service:
          'Amazon S3, one general purpose bucket with public access blocked, default encryption, request metrics turned on and no lifecycle rule that expires objects',
        why: 'Chunks are written once and read many times, at any size up to 8 MB. Clients upload with presigned URLs and an SHA-256 checksum that S3 validates and stores, and the API reads it back with HeadObject. Objects are deleted only by the collector.',
        watch:
          'Request metrics AllRequests, PutRequests, HeadRequests, 4xxErrors, 5xxErrors, FirstByteLatency and TotalRequestLatency.',
      },
      {
        part: 'CDN',
        service:
          'Amazon CloudFront in front of the bucket, with origin access control and signed URLs under a custom policy',
        why: 'Downloads end close to the device, and a shared folder’s chunks are cached at the edge. One policy with a wildcard covers every chunk of a namespace, so the API signs once per version read and not once per chunk.',
        watch:
          'Requests, BytesDownloaded, 4xxErrorRate, 5xxErrorRate and TotalErrorRate, and the additional metrics CacheHitRate and OriginLatency.',
      },
      {
        part: 'Hint channel',
        service:
          'Amazon ElastiCache for Valkey, cluster mode with 3 shards, each a primary and a replica in different zones, using sharded pub/sub',
        why: 'A channel per namespace that keeps nothing: a message goes to the notifier tasks subscribed at that moment and is then gone. That is all a hint needs, and the timer read covers what it drops.',
        watch:
          'Per node: CPUUtilization, CurrConnections, NetworkBytesOut, PubSubBasedCmds and PubSubShardChannels.',
      },
      {
        part: 'Notifier',
        service:
          'An Application Load Balancer of its own with AWS WAF, and Amazon ECS on AWS Fargate: 300 tasks holding WebSocket connections',
        why: 'A task keeps a map from namespace to sockets and a subscription per namespace. It reads no table: a socket is added to a namespace only with a grant that the Sync API signed for that device and namespace, valid for 1 hour, whose signature and expiry the task checks itself. It sends a small message on every socket each 30 seconds, so no connection is idle for the load balancer’s 60-second timeout.',
        watch:
          'ALB ActiveConnectionCount (Sum), NewConnectionCount, HealthyHostCount and RejectedConnectionCount; ECS MemoryUtilization. Custom: sockets per task.',
      },
      {
        part: 'Collector',
        service: 'An Amazon ECS service on AWS Fargate, 4 tasks',
        why: 'Each task walks the 64 shard keys of the due index in a random order about once a minute. Nothing assigns shards: two tasks on one upload race on a conditional counter, and one of them skips the part.',
        watch:
          'Custom, published every minute also when zero: age of the oldest due upload. Also uploads released, chunk rows deleted and objects deleted.',
      },
      {
        part: 'Security',
        service: 'AWS WAF, IAM roles per service, AWS CloudTrail',
        why: 'WAF rate-based rules limit requests per address on both load balancers and on the distribution. Only the Sync API role can sign uploads, and only the collector role can delete objects. The Sync API role has s3:GetObject for its HeadObject checks and never downloads; devices read only through CloudFront. Changes to members and to roles leave a trail.',
        watch:
          'The count of requests blocked by the rate rules, and CloudTrail events for member changes.',
      },
      {
        part: 'Observability',
        service: 'Amazon CloudWatch dashboards and alarms',
        why: 'The alarms that protect an objective read load balancer, bucket and distribution metrics where they can, because those do not depend on the tasks they watch. Alarms on a metric that a task publishes about itself treat missing data as breaching.',
        watch: 'The five objectives, the missing-chunk count and the collector’s age metric.',
      },
    ],
    limits: [
      'A single S3 PUT takes up to 5 GB, far above a chunk of at most 8 MB, so chunks need no multipart upload. A multipart upload has parts of 5 MiB to 5 GiB and at most 10,000 of them, and the parts of one that is never completed are billed until it is aborted, which is part of why a file is not one multipart upload here.',
      'An S3 presigned URL is valid for at most 7 days, and one signed with temporary credentials stops working when those credentials expire, even if its own expiry is later. Task role credentials rotate every few hours, so a 1-hour URL can die early; the client then asks for a fresh one.',
      'S3 validates a checksum sent with an upload against the body and rejects a mismatch. A presigned URL made with Signature Version 4 can carry a SHA-256 checksum header, and every x-amz header a presigned request sends must be among the headers the URL signed, so an upload URL fixes the SHA-256 its body must have and cannot overwrite an object with other bytes. HeadObject returns the stored checksum only when ChecksumMode is ENABLED, which the commit check sets.',
      'S3 reads are strongly consistent after a write, for the object and for its metadata, so a HeadObject right after a PUT sees the chunk.',
      'S3 takes at least 3,500 writes and 11,000 reads a second per partitioned prefix, scales prefixes gradually and can answer 503 Slow Down while it does. Keys start with the namespace, so the peak of 3,500 PUTs a second is spread over many key prefixes, which lets S3 partition them as traffic grows.',
      'DeleteObjects takes up to 1,000 keys in one request and reports a key that does not exist as deleted, which is what makes the collector’s object delete safe to repeat.',
      'An S3 Lifecycle rule selects objects by prefix, tags and size and acts on their age. It knows nothing of references, so the chunk bucket has no rule that expires objects.',
      'S3 request metrics must be turned on with a metrics configuration, arrive at 1-minute intervals after a delay and are best effort: a data point can be late or missing. The upload alarm therefore treats missing data as not breaching and has a second signal in the API.',
      'A DynamoDB transaction holds up to 100 actions and 4 MB, cannot touch the same item twice, and performs two underlying writes per item, which are consumed even when it is cancelled. Hence parts of 90 chunks, and a hash listed twice in a part counted in one action.',
      'A DynamoDB item is at most 400 KB, and BatchGetItem returns up to 100 items. The chunk list of a 50 GB file does not fit one item, and a part of 90 chunks is read back in one call.',
      'A DynamoDB condition has no arithmetic and compares an attribute with a value. The quota check therefore compares used bytes with a limit the API computed, and also requires the quota it read. A write whose condition fails still consumes write capacity.',
      'A DynamoDB partition takes 1,000 write units and 3,000 read units a second. A namespace is one partition key, which together with the sequence number sets the limit of about 20 commits a second per namespace.',
      'A DynamoDB on-demand table has a default quota of 40,000 write and 40,000 read request units a second, for the table and for each of its indexes, and a new one sustains 4,000 writes and 12,000 reads a second until its warm throughput is raised, which cannot be lowered afterwards. The metadata table’s peak of 60,200 writes needs its quota raised first, and so does its read quota, because most of the 120,000 reads a second are on that table.',
      'A global secondary index is eventually consistent, so the collector can see a due upload a moment late, which does not matter. An index that is throttled throttles writes to its table, which does: the due index has 64 shard keys to stay far from one partition’s limit.',
      'DynamoDB time to live deletes an item within a few days of its expiry, without consuming write capacity and in no promised order. The API therefore decides that a log is trimmed from the sequence numbers, never from which rows happen to be left, and treats a tombstone past its expiry as absent.',
      'A CloudFront signed URL with a custom policy can use a wildcard in its resource, and CloudFront removes the Policy, Signature, Key-Pair-Id and Expires parameters before it forwards a request to the origin. The default lifetime of a cached object is 86,400 seconds.',
      'CloudFront metrics live in the US East (N. Virginia) Region with the Region dimension Global; error rates are percentages, and CacheHitRate and OriginLatency are additional metrics at extra cost.',
      'An Application Load Balancer supports WebSockets natively and closes a connection on which no data moved for its idle timeout, 60 seconds by default and at most 4,000. Its targets finish deregistering after 300 seconds by default.',
      'HTTPCode_Target_5XX_Count leaves out the 5xx that the load balancer generates itself, and HTTPCode_ELB_5XX_Count exists per load balancer and is reported only in minutes that have one, so the Sync API has its own load balancer and the error ratio adds both counts with an absent count read as zero. RequestCount counts only requests for which a target was chosen, so the ratio is missing only when RequestCount is, and that case counts as breaching.',
      'Pub/sub in Valkey delivers a message at most once and keeps none. ElastiCache replication is asynchronous, a failed primary is replaced by the replica with the least lag, and the failover is reported as an ElastiCache:FailoverComplete event through Amazon SNS.',
      'ElastiCache metrics are per node. For a node with 2 vCPUs or fewer the one to watch is CPUUtilization, where a single busy engine thread shows as about 90% divided by the number of vCPUs, 45% on the 2-vCPU nodes used here.',
      'An API Gateway WebSocket API closes a connection after 2 hours or after 10 idle minutes and by default accepts 500 new connections a second per account and Region, which is part of why the notifier holds its own sockets.',
      'An AWS WAF rate-based rule counts requests per address over 1, 2, 5 or 10 minutes with a limit of at least 10. A web ACL attaches to an Application Load Balancer and to a CloudFront distribution.',
      'In an ECS deployment the maximum percent counts running, pending and stopping tasks, and the minimum healthy percent is rounded up.',
      'A CloudWatch alarm looks at more data points than its evaluation periods when data is missing, so the time at which an alarm on missing data fires or clears is a few minutes, not an exact count.',
    ],
  },
  slos: [
    {
      objective: 'Sync API',
      target: '99.9% of requests answered without a 5xx, and 99% within 500 ms, each over 28 days',
      measure:
        'On the Sync API’s own load balancer: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount for errors, because the target count leaves out the 5xx the load balancer answers itself when tasks are down, and TargetResponseTime for latency. An absent 5XX count is read as zero. The ratio is missing only when RequestCount is, and such a minute counts as failed. A 409 for a stale base and a 413 over quota are answers, not errors; a 503 for a busy namespace is counted.',
    },
    {
      objective: 'Sync to an online device',
      target: '99% of changes read by an online device within 10 s of their commit, over 28 days',
      measure:
        'Counted by the Sync API on every changes read whose trigger is hint or timer: entries returned within 10 seconds of their commit time, over all entries returned. An entry at or below the seen number of its read was handed to that device before and is not counted again. Reads with the trigger start are left out, because that device was offline. A change whose hint was lost is read by timer minutes later and counts as a miss, so a dead hint channel or notifier drives the ratio toward zero. The expected p99 is 2 seconds.',
    },
    {
      objective: 'Chunk uploads',
      target: '99.9% of requests to the chunk bucket answered without a 5xx, over 28 days',
      measure:
        'The Average of 5xxErrors in the bucket’s request metrics, which is the error rate. These metrics are best effort, so the Sync API’s count of commit checks that failed against storage is the second signal.',
    },
    {
      objective: 'Chunk downloads',
      target: '99.9% of requests to the CDN answered without a 5xx, over 28 days',
      measure: 'CloudFront 5xxErrorRate on the distribution, published by CloudFront.',
    },
    {
      objective: 'Collection',
      target: 'Every due upload released within 24 hours of its due time, over 28 days',
      measure:
        'The age of the oldest upload in the due index whose due time has passed, published by the collector every minute, also when it is zero. The expected value is a few minutes.',
    },
  ],
  alarms: [
    {
      name: 'Sync API failing',
      metric:
        'On the Sync API’s own ALB, each over 5 minutes: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount above 0.05%, with an absent 5XX count read as zero and a missing ratio counted as breaching, or p99 TargetResponseTime above 300 ms. The load balancer publishes these, not the API',
      meaning:
        'Commits or reads are failing or slow: tasks are down, a table is throttling or erroring, or storage cannot be checked. 0.05% is half of what the 99.9% target allows and 300 ms is tighter than 500 ms, so it fires before either is missed. The ratio is missing only when RequestCount is, as when no task is registered, and that fires it too. Devices keep their files pending and repeat.',
    },
    {
      name: 'Sync slow',
      metric:
        'Custom, from the Sync API: entries read for the first time by hint or timer within 10 s of their commit, over all such entries, below 99.5% for 5 minutes; missing data counts as breaching',
      meaning:
        'Online devices are getting changes late, at half of the misses the 99% target allows. Hints are not being published, not crossing the channel or not reaching sockets; check failed publishes, the channel’s nodes and the notifier’s healthy tasks. The Sync API publishes this about another part, and at 3,500 commits a second it is never legitimately empty, so no data means the API itself is not reporting and fires it a few minutes later.',
    },
    {
      name: 'Notifier short of tasks',
      metric:
        'ALB HealthyHostCount (minimum) on the notifier’s target group below 250 for 2 minutes; missing data counts as breaching',
      meaning:
        'The notifier has lost more than a sixth of its 300 tasks. 200 can hold the peak, so this fires while there is still room. A lost zone leaves 200 and fires it. Devices without a socket still sync, by timer, up to 5 minutes late. The load balancer publishes the count, so it works when every task is dead.',
    },
    {
      name: 'Hint channel saturating',
      metric:
        'ElastiCache CPUUtilization above 35% on any node of the hint channel for 5 minutes; missing data is not breaching',
      meaning:
        'A node’s engine thread is near its limit, which shows at about 45% on a 2-vCPU node. Publishes will start to time out and hints to drop. Add shards. Nothing is lost meanwhile; changes arrive by timer.',
    },
    {
      name: 'Missing chunk',
      metric:
        'Custom, from the Sync API: confirmed missing chunks above 0 in 1 minute; missing data is not breaching',
      meaning:
        'A kept version lists a chunk that storage does not have: the one thing this design promises cannot happen. Stop the collector and find out how the reference count reached zero. The alarm returns to OK a few minutes after the last confirmed miss; the incident stays open until the chunk is uploaded again or the version is declared lost.',
    },
    {
      name: 'Uploads failing',
      metric:
        'S3 5xxErrors (average) on the chunk bucket above 0.05% for 5 minutes; missing data is not breaching, because these metrics are best effort',
      meaning:
        'Storage is rejecting requests, at half of the rate the 99.9% target allows. Usually 503 Slow Down while a prefix scales. Clients make three attempts per URL for each PUT, ask for fresh URLs once, and then keep the file pending; uploads keep their chunks for 7 days.',
    },
    {
      name: 'Downloads failing',
      metric: 'CloudFront 5xxErrorRate on the distribution above 0.05% for 5 minutes',
      meaning:
        'The CDN cannot read the bucket or is failing itself, at half of the rate the target allows. Devices repeat a failed chunk and do not move their cursor until a file is complete, so nothing is skipped.',
    },
    {
      name: 'Collector behind',
      metric:
        'Custom, from the collector every minute: age of the oldest due upload above 6 hours; missing data counts as breaching',
      meaning:
        'Due uploads are not being released, with 18 hours left before the 24-hour target is missed. The collector publishes this about itself, so no data means it is down, and that fires the alarm a few minutes later. One upload that fails on every pass also keeps it on: read the collector’s log for that upload. It returns to OK a few minutes after the oldest due upload is younger than 6 hours again.',
    },
    {
      name: 'Table throttling',
      metric:
        'DynamoDB ThrottledRequests above 0 for 1 minute, summed over the write operations of the metadata table, the chunk index or the accounts table, or WriteThrottleEvents above 0 on the due index; missing data is not breaching',
      meaning:
        'Commits are being refused and answered 503. Usually a table whose warm throughput is below the peak. WriteKeyRangeThroughputThrottleEvents above 0 says it is one partition instead: a single namespace above its limit, which slows only that namespace. It returns to OK a few minutes after throttling stops.',
    },
  ],
  evolution: {
    mvp: 'One Sync API service, the three tables and one bucket. Devices poll each cursor every 30 seconds, which a few hundred thousand devices can afford, so there is no notifier and no hint channel. Downloads come straight from the bucket with presigned URLs, and nothing is collected: every version is kept. Chunking, the upload that takes its references before it commits, the commit against a base version and the log without holes are there from the first version, because they decide what a version is and none of them can be added once files exist without them.',
    atScale: [
      'At 10x (35,000 commits a second, 100 million devices online), the timer reads are 400,000 a second and the largest cost. The timer goes to 15 minutes, and to keep a lost hint from costing that long, hints are fed from the table’s change stream by a small relay, so a publish that was missed is replayed.',
      'At 10x, the storage bill dominates everything else: about 146 PB of growth a year. Chunks that are not read for months move to a colder storage class, and chunks under 128 KB, which automatic tiering leaves out, are packed into larger objects.',
      'At 10x, the due index takes 1,750 write units a second per shard key, over one partition’s limit, so it goes from 64 shard keys to 256, and the collector from 4 tasks to 40.',
      'At 10x, first syncs of large folders hit the limit of 20 commits a second per namespace. A commit call that carries up to 15 files in one transaction raises it without changing the ordering.',
      'At 100x, one region is too far from most devices and too large to fail at once. Each namespace has a home region that orders its commits and stores its chunks; devices upload to and read from that region, and a second region holds a copy of the tables and the bucket for disaster recovery, not for writes.',
    ],
    firstBottleneck:
      'The sequence number of a namespace. Everything else spreads over keys, tasks or prefixes, but every commit of one namespace passes through one conditional write, so a shared folder with hundreds of active editors, or the first sync of a folder with a hundred thousand small files, is paced at about 20 commits a second long before any table, bucket or fleet is near its limit. The second is cost, not capacity: 40,000 timer reads a second that exist only because a hint can be lost.',
    avoided: [
      'Deduplication across users. It saves the most storage and it leaks which files exist, or needs a proof of possession on every skipped upload. Worth adding, on the server side only, when the same large files in many accounts become a real share of the bill.',
      'Sending the difference inside a chunk. A changed chunk travels whole, up to 8 MB. Worth adding when most edits change a few bytes of large chunks and devices are on slow links.',
      'Hints that cannot be lost, fed from the table’s change stream. The timer read already bounds the loss at 5 minutes with no extra part. Worth adding when the timer becomes too expensive to keep short.',
      'A batch commit of many files in one transaction. One file per commit keeps every failure about one file. Worth adding when first syncs dominate.',
      'Merging conflicting edits on the server. It needs to understand each file format. Worth adding for a format that is most of the conflicts, such as plain text.',
      'A mark and sweep that audits the reference counts. The counts are exact by construction, and the missing-chunk alarm watches the one failure that matters. Worth adding as a periodic check when the collector’s code changes often.',
      'A second region that takes writes. Ordering per namespace is exact only inside one table in one region. Worth adding only together with a home region per namespace.',
    ],
  },
};
