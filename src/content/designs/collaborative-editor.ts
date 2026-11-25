import type { Design } from '../types';

export const collaborativeEditor: Design = {
  slug: 'collaborative-editor',
  title: 'Collaborative document editor',
  summary:
    'Let many people type into the same document at once and see each other in well under a second: one session task owns each open document and orders its operations, every entry of the log is a conditional write to the next position, an operation is acknowledged only after that write, a new owner fences the old one with a marker entry, and documents open from a snapshot plus a short tail.',
  difficulty: 'Hard',
  minutes: 14,
  requirements: {
    functional: [
      'Several people edit the same document at the same time, and each sees their own typing at once.',
      'Each editor sees the others’ changes and cursors almost immediately.',
      'Every copy of the document ends up with the same text, whatever the order in which people typed.',
      'An editor that loses its connection for up to an hour reconnects and its pending edits are merged, each of them applied once.',
      'A document opens quickly however long its history is.',
      'Only members of a document can open it: owners and editors can type, viewers can read. A change of role reaches open sessions.',
    ],
    nonFunctional: [
      '600,000 connections open at peak on 240,000 documents, and 30,000 operations a second from the 10,000 people who are typing at any one moment.',
      'An operation is acknowledged within 300 ms of reaching the gateway for 99.9% of operations, and reaches the other editors’ sockets within another 100 ms for 99%. The usual figures are 30 ms and 20 ms.',
      'An acknowledged operation is durable: the acknowledgment is sent only after the operation is stored in the log, which keeps copies in several Availability Zones.',
      'One log per document with one entry per position. That two tasks cannot both write the same position is enforced by a conditional write in the store, not by a lease or a clock.',
      'An operation that is sent again is not applied twice: a resend is recognised by its client id and sequence number.',
      '99.9% of joins get the document within 2 seconds, also for a document with years of edits.',
      'When the task that owns a document dies, the document accepts edits again within 45 seconds, usually in 15 to 23, and nothing that was acknowledged is missing.',
      'A member who is removed loses the open connection within about 30 seconds.',
      'Limits: a document holds up to 1 MB of text and up to 500 connections, and one operation is at most 64 KB.',
    ],
    outOfScope: [
      'Long offline editing that merges hours or days of work. Edits made while disconnected live in the memory of the tab, for up to one hour.',
      'Rich formatting, images, tables, comments and suggestions. The examples use plain text with insert and delete.',
      'Version history for users: named versions, browsing old states and restoring them.',
      'Search inside documents, and a feed of changes for other systems.',
      'The sharing screens, links that give access and groups. Access here is one row per member with a role.',
      'Listing, moving and deleting documents.',
      'Undo and redo, which the editor builds on the client from inverse operations.',
      'More than one Region, and end-to-end encryption of the text.',
    ],
  },
  entities: [
    {
      name: 'Document',
      description:
        'Document id (chosen by the client that creates it), title, creator, creation time, the version of the latest snapshot (0 when there is none yet), and the id of the session task that owns it, present only while the document is loaded, or until a dead owner’s name is replaced at the next open.',
    },
    {
      name: 'Member',
      description:
        'Document id, user id and role: owner, editor or viewer. One row per member; no row means no access.',
    },
    {
      name: 'Operation',
      description:
        'What a client sends: client id, a sequence number that grows by one per operation, the version it was based on, and a list of changes (insert text at a position, delete a length at a position) of at most 64 KB. A client id names one loaded copy of the document in one tab.',
    },
    {
      name: 'Log entry',
      description:
        'One item of a document’s log: document id, version (1, 2, 3 and so on, the position in the log), the task that wrote it, a random entry id, the time it was written, and either one or more operations as they were transformed, each with its client id, sequence number and user, or a marker with no change. The version of a document is the number of its last entry.',
    },
    {
      name: 'Snapshot',
      description:
        'The full text of a document at one version, stored as an object named by document id and version.',
    },
    {
      name: 'Session task',
      description:
        'Task id (never reused), private address, the time its lease runs out, and how many documents it holds. Renewed by a heartbeat every 5 seconds.',
    },
    {
      name: 'Presence',
      description:
        'Who is connected to a document and where each cursor and selection is, with the version it refers to. Held in the memory of the session task and never stored.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/documents',
      description:
        'Body: documentId, title. The document id is the idempotency key: one transaction writes the document row, if no row has that id, and the creator’s member row as owner. A repeat by the same creator returns the same document; the id of someone else’s document is answered 409.',
    },
    {
      method: 'GET',
      path: '/documents/{id}',
      description: 'The title and the caller’s role. 403 without a member row.',
    },
    {
      method: 'PUT',
      path: '/documents/{id}/members/{userId}',
      description:
        'Body: role. By an owner. Writes one member row, so a repeat changes nothing. Open connections follow within about 30 seconds.',
    },
    {
      method: 'DELETE',
      path: '/documents/{id}/members/{userId}',
      description:
        'By an owner. Deletes the member row; a repeat finds nothing to delete. An open connection of that user is closed within about 30 seconds.',
    },
    {
      method: 'WS',
      path: '/documents/{id}/session',
      description:
        'The upgrade request is answered within 5 seconds: 101 once a session task holds the document, 403 without a member row, 409 when the document already has 500 connections, 503 when no owner is ready, after which the client tries again.',
    },
    {
      method: 'WS frame',
      path: 'client to server',
      description:
        'hello {clientId, lastSeenVersion}, first on every socket and again when asked to rejoin, followed by the pending operation exactly as it was first sent; op {clientSeq, baseVersion, changes}, one in flight at a time and at most 4 a second; presence {cursor, selection, version}, at most 2 a second; ping every 20 seconds.',
    },
    {
      method: 'WS frame',
      path: 'server to client',
      description:
        'init {text, version} or catchup {entries} in answer to hello; entry {version, operations} for every log entry, where the author’s own operation is replaced by its sequence number and so is the acknowledgment; presence; rejoin, which asks for a new hello; reload, when the pending edits can no longer be merged; closed with a reason.',
    },
  ],
  dataFlow: [
    'An editor opens a socket. The gateway checks the token and the member row, finds the session task that owns the document in the registry, or asks a task to claim it, and connects the socket to that task.',
    'A task that claims a document loads the latest snapshot, replays the log entries after it, and writes a marker entry at the next position before it serves anyone.',
    'Each burst of typing is applied locally at once and sent as one operation with the version it was based on. A client keeps one operation in flight.',
    'The session task transforms the operation against the entries written since that version, writes it to the next position of the log with a conditional write, and only then acknowledges it and sends it to every other connection.',
    'Other editors transform the incoming entry against their own pending operation and apply it, so every copy reaches the same text.',
    'Every 1,000 entries, and when the last editor has been gone for 60 seconds, the session task stores a snapshot, records its version on the document row and deletes the log entries that the snapshot covers and that are more than 70 minutes old.',
  ],
  highLevel: {
    label: 'Send one keystroke to every editor',
    intro:
      'Follow one edit from the moment it is typed until every other editor shows it. Watch old documents get slow to open, then see snapshots, the conditional append, other editors, cursors, reconnects and trimming join, and finish with the owner of a document dying in the middle of it all. Numbers are illustrative. Press play, or step through the stages to see what happens and what each choice costs.',
    nodes: [
      { id: 'alice', title: 'Editor A', detail: 'Types locally', column: 0, row: 'top' },
      {
        id: 'bob',
        title: 'Editor B',
        detail: 'Same document',
        column: 0,
        row: 'bottom',
        appearsAt: 6,
      },
      {
        id: 'gateway',
        title: 'Socket gateway',
        detail: 'Holds the sockets',
        column: 1,
        row: 'middle',
      },
      { id: 'access', title: 'Access list', detail: 'Role per member', column: 2, row: 'top' },
      {
        id: 'session',
        title: 'Doc session',
        detail: 'One owner per document',
        column: 2,
        row: 'middle',
      },
      {
        id: 'registry',
        title: 'Doc registry',
        detail: 'Owner and task leases',
        column: 2,
        row: 'bottom',
      },
      {
        id: 'snapshots',
        title: 'Snapshots',
        detail: 'Text at a version',
        column: 3,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'oplog',
        title: 'Operation log',
        detail: 'One entry per version',
        column: 3,
        row: 'middle',
        appearsAt: 1,
      },
    ],
    edges: [
      ['alice', 'gateway'],
      ['gateway', 'bob'],
      ['gateway', 'access'],
      ['gateway', 'registry'],
      ['gateway', 'session'],
      ['session', 'access', 'read'],
      ['session', 'registry', 'claim'],
      ['session', 'oplog'],
      ['session', 'snapshots'],
    ],
    stages: [
      {
        title: 'One owner per open document',
        narration:
          'Editor A opens a document. The gateway checks the token, reads A’s member row and asks the registry which session task owns the document. Nobody does, so the gateway picks a live task at random and that task claims the document with a conditional write on its registry row. Every later editor of the document is connected to the same task. The task keeps the document’s access list in memory and reads it again every 30 seconds, together with the registry row, to see that it is still the owner.',
        tradeoff:
          'One task per document is one place that decides the order of edits, which is what makes every copy converge. The costs are state that lives in a task, a pause when that task dies, and a ceiling on how busy one document can be, set here at 500 connections. Any stateless server could take any edit if the order came from the database on every operation, at the price of a transaction per keystroke.',
        nodes: ['alice', 'gateway', 'access', 'registry', 'session'],
        travel: [
          ['alice', 'gateway'],
          ['gateway', 'access'],
          ['gateway', 'registry'],
          ['gateway', 'session'],
          ['session', 'registry', 'claim'],
          ['session', 'access', 'read'],
        ],
        short: 'Owner',
        metrics: {
          p95Latency: '250 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Connections', value: '600K' },
            { label: 'Open documents', value: '240K' },
            { label: 'Joins', value: '400/s' },
            { label: 'Warm join', value: '60 ms' },
          ],
        },
        load: { gateway: 35, access: 15, registry: 20, session: 30 },
      },
      {
        title: 'Old documents open slowly',
        narration:
          'In this first version the session task rebuilds a document by replaying its whole log. That is instant for a new document. A busy document that is two years old has about 2 million entries, 600 MB of log, which the store returns 1 MB at a time: 600 reads, about 30 seconds and 150,000 read units for one open. On a Monday morning many of them open at once, the log table throttles, and joins time out.',
        tradeoff:
          'Replaying the log is always exact and needs nothing but the log. Its cost grows with the age of a document and not with its size, so it gets worse every day without any change in traffic. A faster store or more read capacity only moves the day it hurts.',
        nodes: ['alice', 'gateway', 'session', 'oplog'],
        travel: [
          ['alice', 'gateway'],
          ['gateway', 'session'],
          ['session', 'oplog'],
        ],
        short: 'Slow opens',
        metrics: {
          errorRate: '1%',
          alerts: ['errorRate'],
          custom: [
            { label: 'Open, 2M entries', value: '30 s', alert: true },
            { label: 'Read units, one open', value: '150K', alert: true },
          ],
        },
        load: { gateway: 35, session: 80, oplog: 96 },
        traffic: [{ edge: ['alice', 'gateway'], kind: 'failed' }],
      },
      {
        title: 'Open from a snapshot and a short tail',
        narration:
          'Snapshots join. A snapshot is the full text at one version, and the document row in the registry names the latest one. The task that claims a document reads that snapshot and then only the log entries after it, with a consistent read, and checks that they follow one another without a hole. Before it serves anyone it writes a marker, an entry with no change, at the next position. It then sends the editor the text and the version.',
        tradeoff:
          'Opening now costs one object read and a tail of at most about 1,000 entries, about 250 ms whatever the age of the document. The costs are a second store, a rule for when a snapshot may replace log entries, and one extra log write per load for the marker, which looks wasted until a task dies: the last stage shows what it is for.',
        nodes: ['gateway', 'session', 'registry', 'snapshots', 'oplog'],
        travel: [
          ['gateway', 'session'],
          ['session', 'registry', 'claim'],
          ['session', 'snapshots'],
          ['session', 'oplog'],
        ],
        short: 'Snapshot',
        metrics: {
          p95Latency: '250 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Cold open', value: '250 ms' },
            { label: 'Loads', value: '100/s' },
            { label: 'Warm join', value: '60 ms' },
          ],
        },
        load: { gateway: 35, session: 35, registry: 20, snapshots: 20, oplog: 25 },
      },
      {
        title: 'Type locally, send with a base version',
        narration:
          'Editor A types. The change shows in A’s own copy at once. The client sends it as an operation that carries its client id, a sequence number and the version it was based on. A client keeps one operation in flight and waits at least 250 ms between sends; whatever is typed meanwhile is merged into the next operation. The gateway forwards the operation to the session task over the stream it keeps open to that task.',
        tradeoff:
          'Waiting for the server before showing a keystroke would make typing feel broken. Showing it first means the client must later transform its pending edits against whatever the server ordered before them. One operation in flight keeps that to a single pending operation and a buffer, and caps a typist at 4 operations a second; the cost is that a keystroke can wait up to 250 ms before it leaves.',
        nodes: ['alice', 'gateway', 'session'],
        travel: [
          ['alice', 'gateway'],
          ['gateway', 'session'],
        ],
        short: 'Type',
        metrics: {
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Typing at once', value: '10K' },
            { label: 'Operations', value: '30K/s' },
          ],
        },
        load: { gateway: 40, session: 40 },
      },
      {
        title: 'Transform and order',
        narration:
          'The session task handles one document’s operations one batch at a time. It checks the sender’s role in the access list it holds or, for a connection opened since it last read that list, the role the gateway read at the upgrade and passed with the connection. If entries were written after the operation’s base version, it transforms the operation against them, shifting positions so that it still means what A intended. When two inserts land on the same position, the one already in the log stays to the left. The operation will get the next version of the log.',
        tradeoff:
          'Operational transformation needs one order, which the single owner provides, and transform rules that are easy to get subtly wrong, so client and server share one implementation. A conflict-free replicated data type needs no central order and carries an identifier for every character, with deleted text kept as tombstones. With a server in the middle of every edit anyway, transformation keeps operations and documents compact.',
        nodes: ['session'],
        travel: [],
        short: 'Transform',
        metrics: {
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Per typist', value: '3/s' },
            { label: 'Operations', value: '30K/s' },
          ],
        },
        load: { session: 45 },
      },
      {
        title: 'Write to the log, then acknowledge',
        narration:
          'The session task writes the entry to the log under the document id and the next version, on the condition that no entry exists at that position. Only one append per document is in flight; operations that arrive meanwhile wait and go together in the next entry. When the store confirms the write, the task applies the entry to the text it holds in memory and answers A, whose client can now send its next operation. If the condition fails, another task wrote that position: this task is no longer the owner and drops the document.',
        tradeoff:
          'Acknowledging from memory would save about 5 ms, and a crash would then lose edits that users were told were saved. Writing first costs one write unit per operation, 30,000 a second at peak, the largest cost in the design. The condition on the position is what makes the log a single line: a write that times out is sent again as the same item, 3 attempts in all, and if the outcome is still unknown the task unloads the document without answering, so the next load reads what really happened.',
        nodes: ['session', 'oplog'],
        travel: [['session', 'oplog']],
        short: 'Append',
        metrics: {
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Log appends', value: '30K/s' },
            { label: 'Appends in flight', value: '1 per doc' },
          ],
        },
        load: { session: 45, oplog: 40 },
      },
      {
        title: 'Send the entry to the other editors',
        narration:
          'Editor B joins the picture. After the write, the session task sends the entry once to each gateway that holds sockets of this document, and each gateway writes it to its sockets. Editor B’s client transforms the entry against its own pending operation, with the same rules as the server, and applies it, so both copies hold the same text. Entries carry their version, and a client that sees a version out of sequence says hello again with its last version and gets the entries it missed.',
        tradeoff:
          'Sending the whole text after each change would be simple and far too heavy; an entry is a few hundred bytes. The send is not atomic with the write: a task can die between the two. Nothing is lost by that, because the log already has the entry and every client catches up from its last seen version when it rejoins. The cost is that every client must run the transform rules exactly as the server does.',
        nodes: ['session', 'gateway', 'bob'],
        travel: [['gateway', 'bob']],
        short: 'Broadcast',
        metrics: {
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Entry copies sent', value: '75K/s' },
            { label: 'Fan-out p99', value: '20 ms' },
          ],
        },
        load: { session: 45, gateway: 45 },
      },
      {
        title: 'Cursors on a lossy lane',
        narration:
          'Cursor positions and selections travel on the same socket and stream as operations, at most 2 a second from each client. The session task keeps the latest one per connection in memory, forwards them to the other editors in at most 5 frames a second per document, and never writes them to the log. Each position names the version it refers to, and the receiving client shifts it through the entries it has applied since.',
        tradeoff:
          'Treating cursors as operations would more than double the log with data nobody needs a minute later. Keeping them in memory means a task that dies forgets them, which costs nothing: every client sends its cursor again with its next hello. A separate presence service would keep cursors moving while a document changes owner, and would be one more thing to run and to fail.',
        nodes: ['alice', 'gateway', 'session', 'bob'],
        travel: [
          ['alice', 'gateway'],
          ['gateway', 'session'],
          ['gateway', 'bob'],
        ],
        short: 'Cursors',
        metrics: {
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Presence in', value: '40K/s' },
            { label: 'Presence out', value: '60K/s' },
          ],
        },
        load: { gateway: 50, session: 50 },
      },
      {
        title: 'Reconnect and resend',
        narration:
          'Editor B loses its connection and keeps typing. When a socket opens again, B’s client says hello with its client id and the last version it saw. The session task answers with the entries after that version, from memory or from the log. B’s client applies them like any other incoming entries and sends its pending operation again exactly as it was: same sequence number, same base version. The session task looks through the entries after that base version. If one of them already holds that client id and sequence number, the operation was stored before the connection dropped: the task writes nothing and acknowledges it again. Otherwise it transforms and appends it as usual. What B typed while offline follows as the next operation.',
        tradeoff:
          'Reloading the document on every reconnect would be safe and would throw away what the user typed while offline. Catching up keeps it, and needs the log to still hold the entries after the operation’s base version: entries are kept for at least 70 minutes and a client stops trying 60 minutes after the last frame it received on a socket that has delivered an init, catchup or entry frame, so every client that returns is merged and one that stayed away longer reloads. Resends arrive at least once, made harmless by client id and sequence number.',
        nodes: ['bob', 'gateway', 'session', 'oplog'],
        travel: [
          ['gateway', 'session'],
          ['session', 'oplog'],
          ['gateway', 'bob'],
        ],
        short: 'Reconnect',
        metrics: {
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Client retries for', value: '60 min' },
            { label: 'Entries kept at least', value: '70 min' },
          ],
        },
        load: { gateway: 45, session: 45, oplog: 40 },
        traffic: [{ edge: ['gateway', 'bob'], kind: 'failed' }],
      },
      {
        title: 'Snapshot, record, then trim',
        narration:
          'Every 1,000 entries, and when the last editor has been gone for 60 seconds, the session task copies the text it holds at a known version and stores it as a new snapshot object. Then it records that version on the document row, on the condition that the row still names it as owner and holds a lower one. Only after that does it delete log entries, and only those at or below the recorded version that are more than 70 minutes old. Last, it deletes the previous snapshot object.',
        tradeoff:
          'A separate compaction job would keep this work off the session task and would have to replay and transform the log by itself. The task already holds the text, so a snapshot is one copy and one upload away from the editing path. Deleting entries one by one doubles the write units of the log; the alternative, an expiry time on every entry, would delete on a timer whether or not a snapshot covers the entry. The order of the three steps, with the record open only to the owner, is the whole safety argument: an entry is deleted only when a recorded snapshot contains it, and no snapshot is recorded behind a task that is loading.',
        nodes: ['session', 'snapshots', 'registry', 'oplog'],
        travel: [
          ['session', 'snapshots'],
          ['session', 'registry', 'claim'],
          ['session', 'oplog'],
        ],
        short: 'Trim',
        metrics: {
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Snapshot every', value: '1,000 entries' },
            { label: 'Log deletes', value: '30K/s' },
          ],
        },
        load: { session: 50, snapshots: 30, registry: 25, oplog: 60 },
        traffic: [{ edge: ['session', 'snapshots'], kind: 'heavy' }],
      },
      {
        title: 'The owner dies',
        narration:
          'The task that owns the document dies, and with it 2,667 documents. Each gateway sees its stream break and keeps its sockets. Session tasks renew a lease in the registry every 5 seconds, valid for 15, and a task counts as dead 5 seconds after its lease ran out. From then on, the gateway’s next try, one every 2 seconds with the first after a random wait of up to 2, makes another task claim the document, on the condition that the row still names the dead task. The new owner loads the snapshot and the tail, writes its marker at the next position, and the gateway asks its editors to rejoin: they catch up and resend. If the old task was only paused and wakes up, its next append lands on the position the marker took, the condition fails, and it drops the document.',
        tradeoff:
          'A lease alone would let a paused task write after its lease ran out, because nothing checks a clock at the moment of the write. The marker makes the log itself the fence: a position is written once, and the old owner’s next position is taken. The price of waiting for the lease is 15 to 23 seconds in which the document accepts typing only locally. A shorter lease recovers faster and takes documents away from tasks that were merely slow.',
        nodes: ['gateway', 'session', 'registry', 'snapshots', 'oplog'],
        travel: [
          ['gateway', 'registry'],
          ['gateway', 'session'],
          ['session', 'registry', 'claim'],
          ['session', 'snapshots'],
          ['session', 'oplog'],
        ],
        short: 'Owner dies',
        metrics: {
          healthy: '89 / 90',
          alerts: ['healthy'],
          custom: [
            { label: 'Documents to move', value: '2,667' },
            { label: 'Editing again in', value: '15 to 23 s' },
          ],
        },
        load: { gateway: 45, session: 70, registry: 40, snapshots: 35, oplog: 45 },
        traffic: [{ edge: ['gateway', 'session'], kind: 'failed' }],
      },
    ],
  },
  flows: [
    {
      id: 'open',
      title: 'A user opens a document',
      kind: 'sync',
      summary:
        'Ana opens document D7, which nobody has open. The gateway checks her access, a session task claims the document, loads the snapshot at version 41,000 and the 212 entries after it, writes its marker and sends her the text. A cold open like this takes about 250 ms.',
      runsOn:
        'ALB → Gateway on ECS Fargate → Amazon DynamoDB → Session task on ECS Fargate → Amazon S3 → Amazon DynamoDB',
      participants: [
        { id: 'app', label: 'Ana’s editor', service: 'Browser' },
        { id: 'gw', label: 'Gateway', service: 'ALB + ECS Fargate' },
        { id: 'reg', label: 'Registry and access', service: 'DynamoDB' },
        { id: 'sess', label: 'Session task S14', service: 'ECS Fargate' },
        { id: 's3', label: 'Snapshots', service: 'Amazon S3' },
        { id: 'log', label: 'Operation log', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'gw',
          label: 'GET /documents/D7/session, Upgrade: websocket',
          note: 'Over TLS, through the load balancer and AWS WAF, with Ana’s token. The gateway takes the user id from the token and answers this request within 5 seconds, with 101 or with an error.',
        },
        {
          from: 'gw',
          to: 'reg',
          label: 'GetItem members {D7, ana}, consistent',
          note: 'Her row says editor. No row is answered 403. If the table does not answer, the gateway answers 503: it does not let someone in without knowing their role.',
        },
        {
          from: 'gw',
          to: 'reg',
          label: 'GetItem documents D7, consistent',
          note: 'The row has no owner task. The gateway reads this row only when it has no stream open for D7; otherwise it already knows the owner. After a stream breaks, it makes its first read of the row after a random wait of up to 2 seconds and then one every 2 seconds, so the gateways of one task spread their reads. An upgrade reads the row at most once: when no owner is ready it does not read the row again inside its 5 seconds, and it is answered 101 only if the gateway holds sockets of the document and one of the retries it makes for them finds an owner in time. It picks S14 at random from the live tasks, a list it refreshes from the tasks table every 2 seconds, skipping tasks that hold 5,000 documents.',
        },
        {
          from: 'gw',
          to: 'sess',
          label: 'open D7',
          note: 'Over the stream the gateway keeps to each session task it talks to, with the owner the gateway found on the row. A task that already holds the document skips the next five steps if that owner is itself. If the gateway found nobody or another task, a task that holds the document reads the row itself with a consistent read: named there, as when another gateway’s open got in first, it keeps its copy, and otherwise it drops the copy and loads the document from the claim on. An open that arrives while the task is unloading the document waits for the unload to finish, and the task then loads the document from the claim on.',
        },
        {
          from: 'sess',
          to: 'reg',
          label: 'UpdateItem documents D7 SET ownerTask = S14 IF no ownerTask OR ownerTask = S14',
          note: 'The claim. It returns the row: the latest snapshot is at version 41,000. If two gateways asked two tasks at the same moment, one write wins, the other task answers that S14 owns the document, and its gateway follows. A gateway gives up after 3 such hops and answers 503.',
        },
        {
          from: 'sess',
          to: 's3',
          label: 'GetObject D7/41000',
          note: 'The full text at version 41,000. If the object is missing, the task reads the row again, at most 3 times in one load. That is a guard: the object the row names is deleted only after a newer version is recorded, and after the claim only this task can record one, and it stopped any snapshot routine of an earlier load of D7 when it unloaded it.',
        },
        {
          from: 'sess',
          to: 'log',
          label: 'Query D7, version > 41000, consistent',
          note: 'Entries 41,001 to 41,212, replayed onto the text. The task checks that they start at 41,001 and have no hole, and starts the load again from the row if they do not, at most 3 times in one load like the read for a missing object; after the third it releases the row and answers the open with a retryable error. That check is only a guard, since an empty tail would pass it: what keeps a trim from running behind a load is the condition on the snapshot record, which only the task named on the row can meet, and from the claim on that task is this one.',
        },
        {
          from: 'sess',
          to: 'log',
          label: 'PutItem {D7, 41213, marker, writer S14} IF attribute_not_exists(docId)',
          note: 'The marker takes the next position. From here on, any task that still believes it owns D7 and tries to append at 41,213 is refused. If this write is refused instead, someone appended in between: the task reads the new entries and tries the next position, up to 5 times; after the fifth refusal it releases the row and answers the open with a retryable error. If one of those entries is a marker written by another task, a second loader is at work: this task reads the document row again with a consistent read and gives up the load unless the row still names it.',
        },
        {
          from: 'sess',
          to: 'reg',
          label: 'Query members D7',
          note: 'The access list, kept in memory and read again every 30 seconds together with the document row.',
        },
        {
          from: 'sess',
          to: 'gw',
          label: 'ready',
          note: 'The document is loaded. The session task also starts a trim of old entries, off this path.',
          style: 'reply',
        },
        {
          from: 'gw',
          to: 'app',
          label: '101 Switching Protocols',
          note: 'The socket is open. Had no task been ready within 5 seconds, the answer would be 503 and the client would try again after a pause.',
          style: 'reply',
        },
        {
          from: 'app',
          to: 'sess',
          label: 'hello {clientId: A1}',
          note: 'The first frame on every socket, forwarded by the gateway with the role it read at the upgrade, which the task uses for this connection until it next reads the list. No last seen version, because this copy is new.',
        },
        {
          from: 'sess',
          to: 'app',
          label: 'init {text, version: 41213}',
          note: 'The text and its version, with the cursors of anyone else on the document. Ana’s client pings every 20 seconds, which also keeps the load balancer’s 60-second idle timeout from closing the socket.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'edit',
      title: 'One keystroke reaches every editor',
      kind: 'sync',
      summary:
        'Ana types the letter h. Her editor shows it at once and sends one operation; the session task writes it to the log as entry 41,214, acknowledges it and sends it to Ben. About 30 ms from the gateway receiving it to the acknowledgment leaving.',
      runsOn: 'Gateway on ECS Fargate → Session task on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'ana', label: 'Ana’s editor', service: 'Browser' },
        { id: 'gw', label: 'Gateway', service: 'ECS Fargate' },
        { id: 'sess', label: 'Session task S14', service: 'ECS Fargate' },
        { id: 'log', label: 'Operation log', service: 'DynamoDB' },
        { id: 'ben', label: 'Ben’s editor', service: 'Browser' },
      ],
      steps: [
        {
          from: 'ana',
          to: 'ana',
          label: 'apply insert(5, "h") locally',
          note: 'The letter is on her screen before anything leaves the browser.',
        },
        {
          from: 'ana',
          to: 'gw',
          label: 'op {clientSeq: 1, baseVersion: 41213, insert(5, "h")}',
          note: 'Nothing of hers is in flight and she has sent nothing in the last 250 ms, so it goes now. Until it is acknowledged, what she types next waits in a buffer.',
        },
        {
          from: 'gw',
          to: 'sess',
          label: 'forward, as user ana, client A1',
          note: 'The gateway adds the user id it took from the token and notes the time, which is where the acknowledgment objective starts counting. It refuses a frame over 64 KB.',
        },
        {
          from: 'sess',
          to: 'sess',
          label: 'check role, look for a duplicate, transform',
          note: 'Ana is an editor in the list in memory. No entry was written after 41,213, so there is nothing to transform against and no earlier copy of A1 number 1.',
        },
        {
          from: 'sess',
          to: 'log',
          label: 'PutItem {D7, 41214, [A1 #1], writer S14, entryId} IF attribute_not_exists(docId)',
          note: 'The one durable write. If it times out, the task sends the same item again, up to 3 attempts of 1 second each. A refusal returns the item that is there: the same entry id means an earlier attempt landed, and anything else means another task owns D7.',
        },
        {
          from: 'log',
          to: 'sess',
          label: 'OK',
          note: 'DynamoDB answers after the write is durable. Only now does the operation count as accepted.',
          style: 'reply',
        },
        {
          from: 'sess',
          to: 'sess',
          label: 'apply entry 41214 to the text',
          note: 'The text in memory only ever contains entries that are in the log, which is what lets a snapshot be taken from it.',
        },
        {
          from: 'sess',
          to: 'gw',
          label: 'entry 41214',
          note: 'One copy goes to each gateway that holds sockets of D7. Here one gateway holds both.',
          style: 'async',
        },
        {
          from: 'gw',
          to: 'ana',
          label: 'entry {version: 41214, ack: 1}',
          note: 'Her own operation comes back as its sequence number. Her client marks it acknowledged and sends what is in the buffer.',
          style: 'reply',
        },
        {
          from: 'gw',
          to: 'ben',
          label: 'entry {version: 41214, A1 #1: insert(5, "h")}',
          note: 'If Ben’s socket cannot keep up and its send buffer fills, the gateway closes it, and Ben’s client reconnects and catches up from its last version.',
          style: 'async',
        },
        {
          from: 'ben',
          to: 'ben',
          label: 'transform against pending, apply',
          note: 'Ben has nothing pending, so the insert is applied as it is. His copy is now at version 41,214 with the same text as Ana’s.',
        },
      ],
    },
    {
      id: 'concurrent',
      title: 'Two users type at the same position',
      kind: 'sync',
      summary:
        'The line reads "cat" at version 41,214. Ana adds "s" and Ben adds "!" at position 3 at the same moment. The session task orders Ana first, shifts Ben’s insert by one, and both screens end with "cats!".',
      runsOn: 'Gateway on ECS Fargate → Session task on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'ana', label: 'Ana’s editor', service: 'Browser' },
        { id: 'ben', label: 'Ben’s editor', service: 'Browser' },
        { id: 'sess', label: 'Session task S14', service: 'ECS Fargate' },
        { id: 'log', label: 'Operation log', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'ana',
          to: 'sess',
          label: 'op {A1 #2, baseVersion: 41214, insert(3, "s")}',
          note: 'Her screen already shows "cats". The gateway in between is left out of this diagram.',
        },
        {
          from: 'ben',
          to: 'sess',
          label: 'op {B1 #7, baseVersion: 41214, insert(3, "!")}',
          note: 'His screen shows "cat!". Ben’s copy has been open since before these flows, so his numbers have reached 7. Both operations name the same base version, so neither has seen the other.',
        },
        {
          from: 'sess',
          to: 'log',
          label: 'PutItem {D7, 41215, [A1 #2: insert(3, "s")]} IF attribute_not_exists(docId)',
          note: 'Ana’s operation reached the task first. Its base is the current version, so it is stored as sent.',
        },
        {
          from: 'sess',
          to: 'sess',
          label: 'transform B1 #7 against entry 41215',
          note: 'Ben’s operation is based on 41,214 and the log is now at 41,215. Two inserts at the same position: the one already in the log stays to the left, so Ben’s becomes insert(4, "!").',
        },
        {
          from: 'sess',
          to: 'log',
          label: 'PutItem {D7, 41216, [B1 #7: insert(4, "!")]} IF attribute_not_exists(docId)',
          note: 'The log stores the operation as transformed. Had Ben’s operation arrived while Ana’s write was still in flight, both would sit in one entry, the second transformed against the first.',
        },
        {
          from: 'sess',
          to: 'ben',
          label: 'entry {version: 41215, A1 #2: insert(3, "s")}',
          note: 'Ben’s client still has number 7 pending. It knows the server ordered this entry first, so it applies the "s" at position 3 and moves its own pending insert to position 4. His screen shows "cats!".',
          style: 'async',
        },
        {
          from: 'sess',
          to: 'ana',
          label: 'entry {version: 41216, B1 #7: insert(4, "!")}',
          note: 'Ana, who already got her acknowledgment for number 2, applies it as it is: "cats!". The same rule on both sides is why the two copies agree.',
          style: 'async',
        },
        {
          from: 'sess',
          to: 'ben',
          label: 'entry {version: 41216, ack: 7}',
          note: 'Ben’s acknowledgment. Both copies are at version 41,216.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'reconnect',
      title: 'A client reconnects and resends',
      kind: 'sync',
      summary:
        'Ben’s train enters a tunnel just as his operation number 8 leaves, and it never arrives. He keeps typing. Two minutes later his client reconnects, catches up three entries and resends number 8 unchanged, which the session task transforms and stores.',
      runsOn: 'ALB → Gateway on ECS Fargate → Session task on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'ben', label: 'Ben’s editor', service: 'Browser' },
        { id: 'gw', label: 'Gateway', service: 'ALB + ECS Fargate' },
        { id: 'sess', label: 'Session task S14', service: 'ECS Fargate' },
        { id: 'log', label: 'Operation log', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'ben',
          to: 'ben',
          label: 'socket lost; B1 #8 (base 41216) unacknowledged',
          note: 'A ping gets no answer for 10 seconds and the client treats the socket as dead. It keeps number 8 exactly as sent and collects what Ben types next in the buffer. It tries a new socket after a random wait of up to 10 seconds, then with waits that double up to 30 seconds, for up to 60 minutes counted from the last frame it received on a socket that has delivered an init, catchup or entry frame. A new socket that brings only pongs, a rejoin or a closed frame before its catch-up does not restart that count.',
        },
        {
          from: 'ben',
          to: 'gw',
          label: 'GET /documents/D7/session, Upgrade: websocket',
          note: 'Any gateway will do. It checks the token and Ben’s member row again, finds the owner and answers 101.',
        },
        {
          from: 'ben',
          to: 'sess',
          label: 'hello {clientId: B1, lastSeenVersion: 41216}',
          note: 'The same client id as before, because this is the same loaded copy.',
        },
        {
          from: 'sess',
          to: 'ben',
          label: 'catchup {entries 41217 to 41219}',
          note: 'Ana’s three entries, from the tail the task keeps in memory. For a version older than that tail the task reads the log table. Ben’s client transforms each against its pending number 8 and its buffer, and applies it.',
          style: 'reply',
        },
        {
          from: 'ben',
          to: 'sess',
          label: 'op {B1 #8, baseVersion: 41216, ...} again, unchanged',
          note: 'Same sequence number, same base version, same bytes. The client does not need to know whether the first copy arrived.',
        },
        {
          from: 'sess',
          to: 'sess',
          label: 'scan entries after 41216 for B1 #8',
          note: 'Entries 41,217 to 41,219 hold nothing from client B1 with number 8, so this is not a duplicate. The task transforms it against those three entries.',
        },
        {
          from: 'sess',
          to: 'log',
          label: 'PutItem {D7, 41220, [B1 #8]} IF attribute_not_exists(docId)',
          note: 'Stored once. Had the entries after 41,216 already been trimmed, which takes more than 70 minutes, the task could not tell a duplicate from a new operation and would answer reload instead.',
        },
        {
          from: 'sess',
          to: 'ben',
          label: 'entry {version: 41220, ack: 8}',
          note: 'Ben’s client now sends the buffer as number 9, based on 41,220.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'takeover',
      title: 'The owner task dies and another takes over',
      kind: 'async',
      summary:
        'Session task S14 stops with document D7 at version 41,221. Gateway G8 keeps its sockets, waits until S14 counts as dead, and asks S31 to take the document. S31 claims it, loads it and writes a marker at 41,222, which also stops S14 if it was only paused.',
      runsOn:
        'Gateway on ECS Fargate → Amazon DynamoDB → Session task on ECS Fargate → Amazon S3 → Amazon DynamoDB',
      participants: [
        { id: 'gw', label: 'Gateway G8', service: 'ECS Fargate' },
        { id: 'reg', label: 'Registry', service: 'DynamoDB' },
        { id: 'new', label: 'Session task S31', service: 'ECS Fargate' },
        { id: 's3', label: 'Snapshots', service: 'Amazon S3' },
        { id: 'log', label: 'Operation log', service: 'DynamoDB' },
        { id: 'old', label: 'Session task S14', service: 'ECS Fargate' },
      ],
      steps: [
        {
          from: 'gw',
          to: 'gw',
          label: 'stream to S14 breaks at 12:00:03',
          note: 'A dead task breaks the connection at once. A task that hangs is noticed when the gateway’s pings, one every 5 seconds, go unanswered for 10. Such a task also stops renewing its lease, because the heartbeat is sent by the same loop that serves documents, so a task whose serving loop stops counts as dead like one that crashed. The gateway keeps the editors’ sockets open; they go on typing locally.',
        },
        {
          from: 'gw',
          to: 'reg',
          label: 'GetItem documents D7, consistent',
          note: 'The row still names S14, whose last heartbeat at 12:00:00 set its lease to run out at 12:00:15. A task counts as dead 5 seconds after that, so nothing can be done before 12:00:20. The gateway made this first read after a random wait of up to 2 seconds, so that the gateways that lost S14 do not all read in the same instant, and tries again every 2 seconds, for up to 60 seconds, after which it closes the sockets and the clients reconnect by themselves.',
        },
        {
          from: 'gw',
          to: 'new',
          label: 'open D7',
          note: 'At 12:00:21, on the first try after S14 counts as dead. S31 is a live task picked at random.',
        },
        {
          from: 'new',
          to: 'reg',
          label: 'GetItem tasks S14, consistent',
          note: 'S31 decides for itself: the lease ran out at 12:00:15, more than 5 seconds ago. A missing row counts the same. If the lease were still valid, S31 would answer that S14 owns the document.',
        },
        {
          from: 'new',
          to: 'reg',
          label: 'UpdateItem documents D7 SET ownerTask = S31 IF ownerTask = S14',
          note: 'The condition makes one task win when several gateways asked several tasks. The row says the snapshot is at 41,000. This write routes editors; it is not what stops S14.',
        },
        {
          from: 'new',
          to: 's3',
          label: 'GetObject D7/41000',
          note: 'The same load as on a first open. Each task runs at most 20 loads at a time, so a task that takes over many documents queues them.',
        },
        {
          from: 'new',
          to: 'log',
          label: 'Query D7, version > 41000, consistent',
          note: 'Entries 41,001 to 41,221. Everything S14 acknowledged is here, because S14 acknowledged only after its write.',
        },
        {
          from: 'new',
          to: 'log',
          label: 'PutItem {D7, 41222, marker, writer S31} IF attribute_not_exists(docId)',
          note: 'The fence. If S14 had appended 41,222 after the query, this write would be refused; S31 would read that entry, apply it and put its marker at 41,223. Had the entry been a marker of a third task, S31 would read the row again and give up unless it still named S31.',
        },
        {
          from: 'new',
          to: 'gw',
          label: 'ready',
          note: 'The gateway sends rejoin to its sockets of D7. Each client answers with hello and its last seen version, catches up, and sends its pending operation again. About 250 ms after the claim.',
          style: 'reply',
        },
        {
          from: 'old',
          to: 'log',
          label: 'PutItem {D7, 41222, [B1 #10], writer S14} IF attribute_not_exists(docId)',
          note: 'Suppose S14 was not dead but frozen for 25 seconds, and now resumes an append it had prepared. Position 41,222 is taken. The store refuses the write and returns the item that is there: a marker written by S31.',
        },
        {
          from: 'old',
          to: 'old',
          label: 'drop D7, answer nothing',
          note: 'S14 removes the document from memory and closes its streams for it. Ben’s operation number 10 was never acknowledged, so his client sends it again to S31, which stores it as entry 41,223. A task that has no append to make learns the same thing from its check of the document row every 30 seconds, which it confirms with a consistent read before it drops anything.',
        },
      ],
    },
    {
      id: 'duplicate',
      title: 'A resend after a lost acknowledgment',
      kind: 'sync',
      summary:
        'Ana’s operation number 6 is stored as entry 41,224, and the gateway task that should deliver the acknowledgment dies. Her client reconnects and resends number 6. The session task finds it in the log and acknowledges it again without writing anything.',
      runsOn: 'Gateway on ECS Fargate → Session task on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'ana', label: 'Ana’s editor', service: 'Browser' },
        { id: 'g3', label: 'Gateway G3', service: 'ECS Fargate' },
        { id: 'g8', label: 'Gateway G8', service: 'ECS Fargate' },
        { id: 'sess', label: 'Session task S31', service: 'ECS Fargate' },
        { id: 'log', label: 'Operation log', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'ana',
          to: 'g3',
          label: 'op {A1 #6, baseVersion: 41223, ...}',
          note: 'Her editor shows the change already. G3 forwards the operation to S31.',
        },
        {
          from: 'sess',
          to: 'log',
          label: 'PutItem {D7, 41224, [A1 #6]} IF attribute_not_exists(docId)',
          note: 'Accepted and durable. Ben, on another gateway, receives entry 41,224.',
        },
        {
          from: 'sess',
          to: 'g3',
          label: 'entry {version: 41224, ack: 6}',
          note: 'G3 dies before it writes this to Ana’s socket. The operation is stored and she does not know it.',
          style: 'reply',
        },
        {
          from: 'ana',
          to: 'g8',
          label: 'new socket, hello {clientId: A1, lastSeenVersion: 41223}',
          note: 'Her client noticed the dead socket and reconnected through the load balancer, which sent it to G8.',
        },
        {
          from: 'ana',
          to: 'g8',
          label: 'op {A1 #6, baseVersion: 41223, ...} again, unchanged',
          note: 'Sent right after the hello, without waiting for the catch-up. G8 forwards both to S31.',
        },
        {
          from: 'sess',
          to: 'ana',
          label: 'catchup {entry 41224}',
          note: 'The entry holds client A1, number 6. Her client recognises its own operation: it does not apply it a second time, and counts it as acknowledged.',
          style: 'reply',
        },
        {
          from: 'sess',
          to: 'sess',
          label: 'scan entries after 41223 for A1 #6',
          note: 'Entry 41,224 holds it. The operation is a duplicate: the task transforms nothing and writes nothing.',
        },
        {
          from: 'sess',
          to: 'ana',
          label: 'entry {version: 41224, ack: 6}',
          note: 'The same acknowledgment as the one that was lost. Her client has already cleared number 6 and ignores it. The text holds her change once.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'compact',
      title: 'Snapshot the document and trim the log',
      kind: 'async',
      summary:
        'Document D7 reaches version 42,000, which is 1,000 entries above its snapshot. The session task stores a new snapshot, records it on the document row, deletes the covered entries that are more than 70 minutes old, and removes the old snapshot. Editing continues throughout.',
      runsOn: 'Session task on ECS Fargate → Amazon S3 → Amazon DynamoDB',
      participants: [
        { id: 'sess', label: 'Session task', service: 'ECS Fargate' },
        { id: 's3', label: 'Snapshots', service: 'Amazon S3' },
        { id: 'reg', label: 'Registry', service: 'DynamoDB' },
        { id: 'log', label: 'Operation log', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'sess',
          to: 'sess',
          label: 'copy the text at version 42000',
          note: 'Taken between two appends, so the copy is the text after exactly entries 1 to 42,000. The same steps run when the last editor has been gone for 60 seconds, before the task lets go of the document with a conditional write that removes its name from the row. An open that arrives during that unload waits for it to finish and then starts a load from the claim on.',
        },
        {
          from: 'sess',
          to: 's3',
          label: 'PutObject D7/42000, If-None-Match: *',
          note: 'A new object; the old one is not touched. If an object with that name exists, it holds the same text, because one version has one text, and the task goes on. After 3 failed attempts the task leaves it for the next 1,000 entries; the log is still whole.',
        },
        {
          from: 'sess',
          to: 'reg',
          label:
            'UpdateItem documents D7 SET snapshotVersion = 42000 IF ownerTask = this task AND snapshotVersion < 42000',
          note: 'It returns the old value, 41,000. From now on a load starts at 42,000. If the condition fails, the row names another task or no task, or already holds this version or a newer one, and this task stops here and deletes nothing. The owner’s name is in the condition because a load begins with a claim on this same row: a version cannot be recorded behind a task that has claimed the document and is reading the older snapshot. The name does not tell two loads on the same task apart, so a task that unloads a document stops this routine, and waits for its step in flight to end, before it can load the document again.',
        },
        {
          from: 'sess',
          to: 'log',
          label: 'Query D7 from the lowest version, ascending',
          note: 'It stops at the first entry above 42,000 or younger than 70 minutes. Here that selects entries 41,001 to 41,650.',
        },
        {
          from: 'sess',
          to: 'log',
          label: 'BatchWriteItem: delete 25 entries per call',
          note: 'Only entries at or below the version just recorded. Entries the call reports as unprocessed are left for the next trim. A crash here leaves extra entries, never a missing one. A task that froze after its record and lost the document meanwhile deletes late and harmlessly: the new owner’s claim returned this version, so it loaded this snapshot and reads nothing at or below it.',
        },
        {
          from: 'sess',
          to: 's3',
          label: 'DeleteObject D7/41000',
          note: 'Last, so that the row never names an object that is gone. If the task dies before this step, the old object stays and costs storage only.',
        },
      ],
    },
    {
      id: 'revoke',
      title: 'A member is removed while connected',
      kind: 'scheduled',
      summary:
        'Carla, an owner of D7, removes Ben while he has the document open. The row is deleted at once; Ben’s connection is closed when the session task next reads the access list, within about 30 seconds.',
      runsOn:
        'ALB → Document API on ECS Fargate → Amazon DynamoDB, then Session task on ECS Fargate',
      participants: [
        { id: 'carla', label: 'Carla’s browser', service: 'Browser' },
        { id: 'api', label: 'Document API', service: 'ALB + ECS Fargate' },
        { id: 'reg', label: 'Members table', service: 'DynamoDB' },
        { id: 'sess', label: 'Session task', service: 'ECS Fargate' },
        { id: 'ben', label: 'Ben’s editor', service: 'Browser' },
      ],
      steps: [
        {
          from: 'carla',
          to: 'api',
          label: 'DELETE /documents/D7/members/ben',
          note: 'With Carla’s token. The API reads her own member row with a consistent read and finds the role owner.',
        },
        {
          from: 'api',
          to: 'reg',
          label: 'DeleteItem members {D7, ben}',
          note: 'One write. A repeat of the call deletes nothing and is answered the same way.',
        },
        {
          from: 'api',
          to: 'carla',
          label: '204',
          note: 'From this moment a new socket from Ben is refused with 403, because the gateway reads the row on every upgrade.',
          style: 'reply',
        },
        {
          from: 'ben',
          to: 'sess',
          label: 'op {B1 #11, ...}',
          note: 'Ben’s open connection still works: the list in the task’s memory says editor. This operation is accepted and stays in the document.',
        },
        {
          from: 'sess',
          to: 'reg',
          label: 'Query members D7',
          note: 'The read the task makes every 30 seconds for each document it holds. If the table does not answer, the task keeps the list it has and tries again 30 seconds later.',
        },
        {
          from: 'sess',
          to: 'ben',
          label: 'closed {reason: access removed}',
          note: 'Ben is no longer in the list. That read is eventually consistent, so before it closes anything the task confirms with a consistent GetItem on Ben’s member row, which finds no row. It then closes his connection and drops any operation of his that was waiting. Had his role changed to viewer, the same confirmation would come first, and then the connection would stay and his operations would be refused. If the confirmation gets no answer, the connection stays as it is until the next read of the list.',
          style: 'reply',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'Operational transformation or a CRDT?',
      options: [
        {
          name: 'Operational transformation',
          pros: 'Operations and documents stay compact: an insert is a position and some text, and a snapshot is plain text. A natural fit when a server already orders every edit.',
          cons: 'Needs one order per document, so one owner, and transform rules that are easy to get subtly wrong. Client and server must run exactly the same rules.',
        },
        {
          name: 'CRDT',
          pros: 'Copies converge without a central order, so it suits peer-to-peer editing and long offline work, and any server could accept any edit.',
          cons: 'An identifier for every character and deleted text kept as tombstones, so documents and messages are several times larger, and the server still has to store and authorise every edit.',
        },
      ],
      choice:
        'Operational transformation, because every edit already passes through one session task that can order it, and that same single order gives a simple log, simple snapshots and a simple duplicate check. The rule set is small for plain text: positions shift past earlier inserts and deletes, two inserts at one position keep the logged one on the left, and a delete skips characters that an earlier delete already removed. A CRDT becomes the better fit if long offline editing moves into scope, because then there is no server in the middle to give the order.',
    },
    {
      question: 'How do we route every editor of a document to the same place?',
      options: [
        {
          name: 'Any server, with the order taken from the database',
          pros: 'Stateless servers that are easy to scale and replace, and no ownership to move.',
          cons: 'Every operation needs a transaction to get its place in the order, and every server must then learn about the operations the others accepted before it can transform against them.',
        },
        {
          name: 'Consistent hashing on the document id',
          pros: 'No lookup: every gateway computes the owner from the list of tasks.',
          cons: 'Two gateways with different lists disagree for a while, and adding or removing a task moves documents that are being edited. It still needs something in the store to stop two tasks writing.',
        },
        {
          name: 'A registry row per open document and a lease per task',
          pros: 'Ownership is explicit and changes with one conditional write. A hot document can sit on any task, and a deploy hands documents over one by one.',
          cons: 'A lookup when a gateway first meets a document, a table of task leases to keep, and a wait for the lease when a task dies.',
        },
      ],
      choice:
        'A registry row per open document that names its session task, claimed with a conditional write, and one lease per task, renewed every 5 seconds and valid for 15. A lease per document would cost a write per document every few seconds, 48,000 a second for 240,000 documents; a lease per task costs 18. Gateways cache the owner for as long as their stream to it is open. The registry only routes: what keeps two tasks from writing one log is the conditional append, described next.',
    },
    {
      question: 'How do we keep two session tasks from both writing a document’s log?',
      options: [
        {
          name: 'Trust the lease',
          pros: 'Nothing to add: a task writes while it believes its lease is valid.',
          cons: 'A task that freezes for 30 seconds wakes up believing its lease is valid and writes. Nothing compares a clock at the moment of the write, so two tasks can both append and both acknowledge.',
        },
        {
          name: 'An owner epoch checked in a transaction on every append',
          pros: 'The store refuses an append from any task whose epoch is not the one on the document row. The classic fencing token.',
          cons: 'Every append becomes a transaction that writes the entry and touches the document row. A transactional write costs twice a plain one, so the largest cost in the design at least doubles, and the document row is now on the path of every keystroke.',
        },
        {
          name: 'A conditional write on the next position, and a marker written by every new owner',
          pros: 'One plain write per append. Each position of the log can be written once, so the log is a single line whatever the tasks believe, and the new owner’s marker takes exactly the position the old owner would write next.',
          cons: 'The old owner can still append between the new owner’s read of the tail and its marker. The marker is then refused and the new owner must read again, and a refused task must look at what is there to tell its own retry from someone else’s entry.',
        },
      ],
      choice:
        'The conditional write on the position, plus a marker on every load. The position is the fencing token: a task appends at the version it believes is next, on the condition that nothing is there, and a new owner writes a marker at the position after the last entry it read. If the old owner slipped one more entry in, that entry is in the log, was acknowledged rightly, and the new owner reads it and moves its marker one further, up to 5 times; after the fifth refusal it releases the row and answers the open with a retryable error. If what it reads is a marker of another task, a second loader is at work, and it reads the document row again and gives up unless the row still names it, so it never fences the task that the row names. Once the marker is in, the old owner’s next append is refused, the store returns the marker, and the old owner drops the document. Leases and clocks decide when a takeover starts; they never decide who may write. One rule on the 30-second check of the document row can only stop a task: a session task appends to a document only while its claim, or its last successful check of that document’s row, is less than 10 minutes old. Past that it holds the document’s incoming operations without storing or acknowledging them, and their clients keep them pending and go on typing locally as they do offline, until a check succeeds; then it continues if the row still names it, appending what it held in order, and otherwise drops the document as above, and its editors rejoin. This is for a displaced task that cannot read the documents table, whose next position would be free again once the new owner’s marker is trimmed: the last check that found its name was made before the new owner’s claim, or within the lag of an eventually consistent read after it, so it stops appending about 10 minutes after that claim at the latest, and the marker, written after the claim, is kept for at least 70 minutes.',
    },
    {
      question: 'Where does the log live, and what gives it its order?',
      options: [
        {
          name: 'A partitioned stream, such as a Kafka topic keyed by document',
          pros: 'Appends are cheap and batch well, and consumers can follow the changes.',
          cons: 'A stream orders what it receives and accepts every producer: it has no "append only if this is position N". Fencing would need another mechanism, and reading one document’s tail means scanning a partition shared with thousands of others.',
        },
        {
          name: 'A relational table with a unique key on document and version',
          pros: 'The unique key gives the same guarantee, and one transaction could also update the document row.',
          cons: 'One primary takes 30,000 inserts a second and as many deletes, so it has to be sharded by document, and a failover to a replica that is behind must not lose acknowledged rows.',
        },
        {
          name: 'A key-value table with one item per version',
          pros: 'The key is document and version, a conditional put gives one entry per position, a consistent query returns a document’s tail in order, and the table spreads documents over partitions by itself.',
          cons: 'One write unit per entry and another to delete it later, and a single document cannot pass one partition’s write rate.',
        },
      ],
      choice:
        'One item per version in a key-value table, with the document id as the partition key and the version as the sort key. The order is not assigned by the store: it is the version the single owner chose, and the conditional put makes that choice final. The session task keeps one append in flight per document, so entries never leave a hole, and it reads tails with consistent reads, so it sees every write the store has acknowledged.',
    },
    {
      question: 'When does the server acknowledge an operation?',
      options: [
        {
          name: 'As soon as it is ordered in memory',
          pros: 'The fastest acknowledgment, and writes can be flushed in batches.',
          cons: 'A task that dies loses every operation it acknowledged and had not flushed. Users were told those edits were saved.',
        },
        {
          name: 'After sending it to the other editors, with the write in the background',
          pros: 'Others see the edit a few milliseconds sooner.',
          cons: 'Editors can now hold an entry that the log never got. After a crash the new owner assigns that version to a different operation, and copies diverge.',
        },
        {
          name: 'After the log write is confirmed, and before anything is sent to anyone',
          pros: 'An acknowledged operation is in the log, and so is every entry any editor has ever been sent. A crash at any point leaves the log as the truth.',
          cons: 'Every operation waits for one write, about 5 ms, and the store’s availability is the editor’s availability for saving.',
        },
      ],
      choice:
        'After the write. The order of steps is fixed: write the entry, then apply it to the text in memory, then send it to the author as the acknowledgment and to everyone else. Writing and sending are two steps, and a crash between them is repaired by replay: whoever missed the entry gets it from the log when they rejoin. Group commit keeps the wait short for a busy document: one append is in flight per document, and everything that arrives meanwhile goes into the next entry, up to 256 KB.',
    },
    {
      question: 'How do we make a resent operation apply once?',
      options: [
        {
          name: 'Remember the last sequence number of each client in memory',
          pros: 'One comparison per operation.',
          cons: 'The memory dies with the task. The new owner has to rebuild it from the log, and every snapshot has to carry it, for every client that ever edited the document.',
        },
        {
          name: 'A table of applied operation ids',
          pros: 'Survives any task and is easy to reason about.',
          cons: 'A second write per operation that is not atomic with the log write, so a crash between the two leaves an applied operation that looks new, or the reverse.',
        },
        {
          name: 'Look for the client id and sequence number in the entries after the operation’s base version',
          pros: 'No extra state: the entries after the base version are exactly what the task must read anyway to transform the operation. The log is both the order and the record of what was applied.',
          cons: 'It works only while those entries exist, so it ties resending to how long the log is kept, and it relies on the client resending the operation unchanged.',
        },
      ],
      choice:
        'Scan the entries after the base version. An operation based on version N can only have been stored after N, so if it was stored at all, it is among the entries the task is about to transform against, or among the operations placed before it in the same entry. Found: answer with the same acknowledgment and write nothing. Not found: transform and append. Resends therefore arrive at least once and are made harmless by client id and sequence number. When the entries after the base version have been trimmed, the task cannot tell, and answers reload; entries are kept for at least 70 minutes and clients stop resending 60 minutes after the last frame they received on a socket that has delivered an init, catchup or entry frame.',
    },
    {
      question: 'What do we store: operations, snapshots or both?',
      options: [
        {
          name: 'Only the latest text',
          pros: 'Smallest storage, trivial to load.',
          cons: 'Every keystroke rewrites the document, and a reconnecting client has nothing to catch up from.',
        },
        {
          name: 'Only operations',
          pros: 'Exact replay and nothing else to keep consistent.',
          cons: 'Loading gets slower as the document ages: 2 million entries are 600 MB and about 30 seconds.',
        },
        {
          name: 'Operations plus snapshots',
          pros: 'A load is one object and a short tail, and recent operations are there for clients that reconnect.',
          cons: 'Two stores to keep consistent, and a rule is needed for when an entry may be deleted.',
        },
      ],
      choice:
        'Operations plus snapshots. The log is the truth for everything after the latest snapshot, and it keeps at least the last 70 minutes for reconnects. A snapshot is taken every 1,000 entries and when a document’s last editor has been gone for 60 seconds, so a load replays about 1,000 entries at most in normal operation. Version history for users is out of scope, so entries below the snapshot are deleted and not archived.',
    },
    {
      question: 'Who writes snapshots, and when may a log entry be deleted?',
      options: [
        {
          name: 'A background job that replays the log',
          pros: 'Keeps snapshot work off the task that serves editors.',
          cons: 'A second program that must apply operations exactly like the session task, a queue or a schedule to drive it, and the same question of what it may delete.',
        },
        {
          name: 'Give every entry an expiry time and let the store delete it',
          pros: 'Deletion is free and needs no code.',
          cons: 'The store deletes on a timer, whether or not a snapshot covers the entry. A document whose task crashed and that nobody opens again would lose its tail when the timer runs out.',
        },
        {
          name: 'The owner snapshots from memory, records the version with a conditional write, and deletes only below it',
          pros: 'The owner already holds the text at a known version. Three ordered steps, each safe to repeat, and no timer decides anything about data.',
          cons: 'A delete per entry, which doubles the write units of the log, and snapshot work on the task that serves editors.',
        },
      ],
      choice:
        'The owner does it, in a fixed order: store the snapshot object, then record its version on the document row if the row still names this task as owner and holds a lower version, then delete entries at or below that version that are more than 70 minutes old, then delete the previous object. A crash after any step leaves more than is needed, not less. A task that lost ownership is stopped at the second step: it can store an object, which nothing names, and it can neither record a version nor delete under one. The owner’s name is in the condition because of a loader. A load begins with a claim, a write to the same row that puts the loader’s name on it, so a record by the previous owner either was applied before the claim, and the claim returns its version, or is refused. A task that froze between its record and its trim deletes late, and only at or below a version that every later loader starts from. The condition cannot tell two loads of one document on the same task apart, so a task that unloads a document stops that document’s snapshot routine, and waits for its step in flight to end, before it may load the document again. The loader still checks that its tail starts right after its snapshot and has no hole, as a guard only: an empty tail would pass that check, so nothing rests on it.',
    },
    {
      question: 'How do cursors and presence travel?',
      options: [
        {
          name: 'As operations in the log',
          pros: 'One path, and cursors survive a restart.',
          cons: '40,000 more writes a second for data that is worthless a second later, and cursors would wait behind edits.',
        },
        {
          name: 'A separate presence service with publish and subscribe',
          pros: 'Cursors keep moving while a document changes owner, and the session task does less.',
          cons: 'Another stateful service, another connection from every gateway, and its own failure modes, to carry something users can lose for a few seconds.',
        },
        {
          name: 'Through the session task, in memory only',
          pros: 'No new component. The task already knows who is connected, and it knows the versions that cursor positions refer to.',
          cons: 'Presence stops while a document has no owner and is forgotten when the owner dies.',
        },
      ],
      choice:
        'Through the session task, in memory, as lossy state. Clients send at most 2 updates a second, the task keeps only the latest per connection and forwards at most 5 frames a second per document, and nothing is retried or stored. A cursor names the version it was measured at, and the receiver shifts it through later entries. After a takeover every client sends its cursor again with its hello.',
    },
    {
      question: 'What happens when one document has hundreds of editors?',
      options: [
        {
          name: 'No limit: let the task take what comes',
          pros: 'Nothing to explain to users.',
          cons: 'Every entry goes to every connection, so the work grows with editors times typists, and one very large document starves the thousands of others on the same task.',
        },
        {
          name: 'Split the document into sections, each with its own owner',
          pros: 'Writes to different sections never wait for each other.',
          cons: 'Edits that cross a section, such as a paste or a move, need coordination between owners, and positions are no longer offsets into one text.',
        },
        {
          name: 'One owner, group commit, and a cap on connections',
          pros: 'The single order stays. Group commit means the append rate does not grow with the number of typists, and the cap bounds the fan-out.',
          cons: 'The 501st person is refused, and a full document makes its task busier than its neighbours.',
        },
      ],
      choice:
        'One owner with group commit and a cap of 500 connections per document. With an append taking about 5 to 10 ms, a document writes at most 100 to 200 entries a second however many people type; 500 people typing at once are 1,500 operations a second, about 10 per entry and about 3 write units each, so at most about 600 write units a second, under the 1,000 that one partition takes. A delete is charged by the size of the item it removes, so the deletes that follow 70 minutes later cost 3 units each too, up to 600 more: a document that stays this full for over 70 minutes passes the partition’s rate and is throttled, which is stated as a limit. Each entry goes once to each gateway, which writes it to its own sockets. A join past the cap is answered 409 and does not count as a failure.',
    },
    {
      question: 'How far do offline edits go?',
      options: [
        {
          name: 'Stop the editor when the connection drops',
          pros: 'Nothing to merge and nothing to lose.',
          cons: 'A train tunnel or a sleeping laptop interrupts work, and what was typed in the last second before the drop is in doubt.',
        },
        {
          name: 'Persist edits on the device and merge whenever it returns',
          pros: 'Hours or days of offline work survive a closed tab.',
          cons: 'The log would have to keep entries for as long as any device may be away, or the merge would need a data type built for it. A different design.',
        },
        {
          name: 'Keep typing, hold the edits in the tab, and merge within a fixed window',
          pros: 'Short breaks are invisible, and the same catch-up and resend that handle a moved document handle a reconnect.',
          cons: 'Edits that were not acknowledged are lost if the tab closes, and after the window the client cannot merge.',
        },
      ],
      choice:
        'Keep typing and merge within a window. The client holds one operation in flight and a buffer, in memory. It retries the connection for up to 60 minutes, counted from the last frame it received on a socket that has delivered an init, catchup or entry frame, and the log keeps entries for at least 70, so a client that returns in time always finds the entries it needs. After those 60 minutes nothing is merged: the editor stops retrying, becomes read-only and offers the unsent text for copying, and a client that comes back later is told to reload. Anything longer is out of scope and is where a CRDT would earn its cost.',
    },
    {
      question: 'What happens when someone’s access changes while they are connected?',
      options: [
        {
          name: 'Check access only when the socket opens',
          pros: 'One read per connection.',
          cons: 'A removed member keeps reading and typing for as long as the tab stays open, which can be days.',
        },
        {
          name: 'Read the member row on every operation',
          pros: 'A removal takes effect on the very next operation.',
          cons: '30,000 more reads a second on the typing path, and an outage of the members table would stop all editing.',
        },
        {
          name: 'Check at the upgrade, keep the list in the session task, and read it again every 30 seconds',
          pros: 'One query per open document every 30 seconds, no read on the typing path, and editing continues on the last list if the table is down.',
          cons: 'A removed member can read and type for up to about 30 seconds more, and longer while the table cannot be read.',
        },
      ],
      choice:
        'Check with a consistent read at every upgrade, then let the session task hold the document’s list and read it again every 30 seconds. On each operation the task checks the sender’s role in memory. A connection that opens between two reads of the list brings the role the gateway just read, and the task uses that role for it until its next read, so a member added seconds ago can type at once and a removal is still bounded by the 30 seconds. The refresh is an eventually consistent read and can miss a row written a moment before, so before the task closes a connection or lowers its role it confirms that one member row with a consistent GetItem. Confirmed gone, the connection is closed; confirmed as viewer, its operations are refused. Removals and lowered roles are rare, so these reads leave the capacity figures as they are. Operations accepted before the refresh stay in the document. Pushing the change to the session task would be faster and would be a second write after the row, so the periodic read would still be needed as its repair; here the repair is the only path.',
    },
  ],
  wrapUp:
    'One session task owns each open document and gives its operations one order. Every entry of the log is a conditional write to the next position, and the operation is acknowledged and sent to the other editors only after that write. A new owner loads a snapshot and a short tail and writes a marker, which takes the position the old owner would write next, so leases only decide when a takeover starts. A resend is recognised by client id and sequence number among the entries after its base version. The owner snapshots from memory, records the version, and only then deletes what the snapshot covers. Cursors stay in memory.',
  guarantees: {
    provides: [
      {
        property: 'Durability of acknowledged operations',
        promise:
          'An operation is acknowledged only after its log entry was written to the log table, which confirms a write once it is durable and keeps copies in several Availability Zones. An entry is deleted only when it is at or below a snapshot version recorded on the document row, and that snapshot object was stored before the version was recorded. A version is recorded only by the task the row names as owner, checked in the same write, and a load begins by writing the loader’s name on that row, so after a loader’s claim, and until another task claims the row, nobody else can record a version or trim above the snapshot it starts from, and the loader itself stopped any snapshot routine of an earlier load when it unloaded the document. So an acknowledged operation is in the log or in a recorded snapshot, at every moment and after any crash, and a load reads that snapshot and the whole tail above it.',
      },
      {
        property: 'One log, one entry per position',
        promise:
          'Every append is a put on document id and version that succeeds only if no item exists there. Of any number of tasks that try the same position, the store accepts one, for as long as the entry there has not been trimmed; a trimmed position lies at or below the recorded snapshot, so an entry that a task frozen for over 70 minutes writes there is never read by a load. This holds without any assumption about leases, clocks or which task believes it is the owner. A task that wakes after such a freeze cannot acknowledge from its old copy either: a gateway gives up a stream whose pings go unanswered for 10 seconds, and the open of a new stream makes the task load the document again unless the row still names it. A task that is not frozen but cannot read the documents table does not write to a trimmed position at all: it appends to a document only while its claim or its last successful check of that document’s row is less than 10 minutes old, a rule that rests on the clocks as stated under what the design assumes, and a displaced task’s next position holds the new owner’s marker, which is kept for at least 70 minutes.',
      },
      {
        property: 'A displaced owner stops',
        promise:
          'A task that loads a document writes a marker at the position after the last entry it read, and serves nobody before that write succeeds. The previous owner can append only at the position it believes is next, which is now at or below the marker, so its next append is refused and it drops the document. Entries it wrote before the marker are in the log and are read by the new owner. A loader whose marker is refused and that finds another task’s marker among the entries it then reads, reads the document row again and stops unless the row still names it.',
      },
      {
        property: 'An operation is applied once',
        promise:
          'Clients resend an unacknowledged operation unchanged, so it can arrive more than once: at least once, made harmless by client id and sequence number. Before appending, the session task looks for that pair among the entries after the operation’s base version and among the operations placed before it in the same entry, and answers with the existing acknowledgment if it finds it. If those entries are no longer all in the log, it refuses the operation and tells the client to reload.',
      },
      {
        property: 'Convergence',
        promise:
          'The log gives every document one sequence of transformed operations. The server transforms each operation against the entries after its base version, clients transform each incoming entry against their own pending operation with the same rules, and every copy that has applied the log up to a version, and has nothing pending, holds the same text.',
      },
      {
        property: 'Snapshots are complete',
        promise:
          'A snapshot at version V is the text after exactly entries 1 to V. The task builds it from text that contains only entries it read from the log or wrote successfully, copied between two appends. Two snapshots of the same version hold the same text, and the recorded version only moves forward, because it is written on the condition that the row names the writer as owner and holds a lower one.',
      },
      {
        property: 'Reconnect',
        promise:
          'A client that returns within 60 minutes of the last frame it received on a socket that has delivered an init, catchup or entry frame, which is how long it retries, to a document of which its user is still a member and that still has room, finds every entry after its last seen version and after its pending operation’s base version: those entries are at most about a minute older than that frame, since a socket that brought only pongs, a rejoin or a closed frame does not restart the count, a displaced task that can read the documents table stops answering a document’s sockets within about a minute, at its check of the row, and a gateway closes a socket whose document has had no owner for 60 seconds, and entries are kept at least 70 minutes after they were written. Its pending operation is merged and applied once, and what it typed while offline follows. Two cases fall outside this promise and are listed under what the design does not guarantee: a client left for over 70 minutes on a displaced task that cannot read the documents table, who loses nothing that was acknowledged, and a client that keeps rejoining while appends fail for over an hour.',
      },
      {
        property: 'Access',
        promise:
          'A socket is opened only after a consistent read of the caller’s member row. The gateway passes the role it read to the session task, which uses it for that connection until its next read of the document’s member list. The task reads that list every 30 seconds with an eventually consistent read, and before it closes a connection or lowers its role it confirms that member’s row with a consistent read. It then closes the connection of a member who was removed, and refuses operations from a viewer.',
      },
      {
        property: 'Recovery from a dead task',
        promise:
          'A document whose owner task died can be claimed by another task 20 seconds after the dead task’s last heartbeat, which is 15 to 20 seconds after the crash. With the gateway’s retry every 2 seconds and a load of about 250 ms, editors are usually typing against the new owner 15 to 23 seconds after the crash. The takeover reads the log, so it needs nothing from the dead task.',
      },
    ],
    assumes: [
      'The log and registry tables apply a conditional write to one item atomically, confirm a write only once it is durable, and return every confirmed write to a consistent read.',
      'The snapshot store returns an object to any read that starts after its write was confirmed.',
      'Clients follow the protocol: one operation in flight, a sequence number that is never reused for different content, a resend that is byte for byte the operation first sent, one client id per loaded copy, and no second application of an entry that contains their own operation.',
      'Client and server run the same transform rules, and those rules give the same text when two concurrent operations are applied in either order with the second transformed against the first.',
      'A task id is never used by two tasks, and an entry id is random enough never to repeat within a document.',
      'Server clocks agree within a second; the 10-minute limit on appending without a successful check of the row needs only that two tasks’ clocks do not differ by anything near an hour. Clocks decide when a task counts as dead, which entries are old enough to trim and when that limit stops a task; they do not decide who may write the log.',
      'The token identifies the user, and the member rows say what that user may do.',
    ],
    doesNotGuarantee: [
      'That edits typed while disconnected survive. They live in the memory of the tab: closing it, or staying offline for more than 60 minutes, loses whatever was not acknowledged. After 60 minutes the editor shows the unsent text for copying and does not merge it.',
      'That an edit is saved when it appears on the author’s own screen. It is saved when it is acknowledged, usually 30 ms later. The editor shows unsaved changes while an operation waits.',
      'Instant removal of access. A removed member can read and type for up to about 30 seconds, and for as long as the members table cannot be read, because the session task keeps its last list. What they typed in that time stays in the document.',
      'Editing during a takeover. For 15 to 23 seconds after a task dies, and for about 32 seconds, at most about 40, after a whole zone is lost, the affected documents accept typing only locally.',
      'A takeover while the registry’s tasks table cannot be read. A task claims a dead task’s document only after reading that task’s lease, so during such an outage documents of dead tasks wait. Documents on live tasks are unaffected.',
      'That every editor hears from the same task at every instant. After a takeover that the old owner has not noticed, editors still connected to it see no new entries until it tries to append or runs its 30-second check of the document row. They never see a wrong entry, only a late one.',
      'That a displaced task lets go of its clients while it cannot read the documents table. It keeps its idle readers on their last text until it can read the row again. An edit that reaches it within 10 minutes of its last successful check of the row is refused because of the new owner’s marker, and it drops the document; after those 10 minutes it holds the edit without storing or acknowledging it. Pongs keep such a client’s 60-minute count running, so a client that stays there for over 70 minutes after the takeover and then rejoins can meet a trimmed log and be told to reload: it loses its unacknowledged text, and nothing that was acknowledged is missing.',
      'That a pending operation survives appends that keep failing for over an hour. Every catch-up frame restarts the client’s 60 minutes while the entries after the operation’s base version keep ageing, so a client that kept rejoining can be told to reload and lose its pending text.',
      'Detection of a client whose text has diverged. Convergence rests on the transform rules being right on every client; nothing compares the texts, so a bug in one client build shows up as a wrong document on that screen until it reloads.',
      'Cursors and presence. They are held in memory, sent without retry, and forgotten with the task; a cursor can be missing or a few hundred milliseconds stale.',
      'A place for the 501st connection. A document with 500 connections refuses more, and there is no read-only overflow.',
      'History. Entries below the latest snapshot are deleted once they are 70 minutes old, so the state of a document a day ago cannot be rebuilt.',
      'A tidy store. A crash between steps can leave a snapshot object that no row names, or log entries below the snapshot, and a document that is never opened again keeps up to its last 70 minutes of entries. These cost storage and are never read as data.',
      'That an operation waits for less than the store takes. An append that times out is tried 3 times and then the document is unloaded and reloaded, which the editors see as a pause of a few seconds.',
      'Fairness between documents on one task. A document at its cap makes its task busier than others, and the only limits are 500 connections per document and 5,000 documents per task.',
      'Full speed for a document that stays full for over 70 minutes. 500 people typing at once write up to about 600 units a second, and once those entries are 70 minutes old their deletes cost as much again, about 1,200 against the 1,000 that one partition takes. The partition then throttles that document: a delete that is refused is left for the next trim, an append that is refused is retried like any failed append, and its acknowledgments slow down until fewer people type.',
      'Survival of a Region. Tables and objects live in one Region, in several Availability Zones.',
    ],
  },
  failures: [
    {
      scenario: 'The session task that owns a document crashes.',
      impact:
        'Its 2,667 documents and their 6,667 connections stop getting acknowledgments. Editors keep typing locally. Nothing acknowledged is missing, because every acknowledgment followed a log write.',
      detection:
        'Gateways see the stream break at once. The time from losing an owner to having a new one, measured by the gateways, is alarmed at 35 seconds, and the container service reports the stopped task.',
      recovery:
        'The task’s lease runs out 15 seconds after its last heartbeat and it counts as dead 5 seconds later. Each gateway retries every 2 seconds, a live task claims each document on the condition that the row still names the dead one, loads it, writes its marker, and the gateway asks its editors to rejoin: 15 to 23 seconds in all. Documents with nobody connected stay with the dead task’s name on their row until someone opens them. The container service starts a replacement task with a new id.',
    },
    {
      scenario:
        'The owner task freezes for 25 seconds, another task takes its document, and then it resumes.',
      impact:
        'For a moment two tasks hold the document in memory. Without the conditional append both would write and acknowledge, and the log would fork.',
      detection:
        'The old task’s next append is refused and the store returns a marker written by another task. ConditionalCheckFailedRequests on the log table counts these; a task with nothing to append finds out at its 30-second check of the document row.',
      recovery:
        'The old task drops the document and closes its streams for it, answering none of the operations it held. Their authors’ clients resend them to the new owner. If the old task appended an entry before the marker went in, that entry is in the log, and the new owner read it or was refused and read again. If the old task was in the middle of a snapshot, its record is refused because the row names the new owner, and it deletes nothing; a record that went in before the claim is the snapshot the new owner loaded.',
    },
    {
      scenario:
        'A log write times out and the session task cannot tell whether the entry was stored.',
      impact:
        'One document’s operations wait. Nothing is acknowledged that might not be stored, and nothing is stored twice.',
      detection:
        'Append attempts by outcome, published by the session tasks, and the share of operations not acknowledged within 200 ms, measured by the gateways.',
      recovery:
        'The task sends the same item again, same version and same entry id, up to 3 attempts of 1 second with waits of 100 and 200 ms between them. A refusal that returns its own entry id means an earlier attempt landed, and it continues. After the third failure it unloads the document without answering, and it stops the document’s snapshot routine and waits for its step in flight to end before it loads the document again. The gateways ask again, the task loads the document from the log, which shows whether the entry is there, and the clients resend; an operation that did land is recognised by its client id and sequence number.',
    },
    {
      scenario:
        'A gateway task dies, or a session task dies after its log write and before it sent the entry.',
      impact:
        'An operation is stored and its author was not told. Other editors may not have received the entry.',
      detection:
        'Clients notice a dead socket when a ping goes unanswered for 10 seconds; gateways notice a dead session task by its stream. Reconnects and rejoins are counted by the gateways.',
      recovery:
        'Each client says hello with its last seen version and gets the entries after it from the log. The author resends the operation unchanged, the session task finds its client id and sequence number among the entries after its base version, and answers with the same acknowledgment. The first wait before a reconnect is random, up to 10 seconds, so the 6,667 sockets of a dead gateway do not return in the same second.',
    },
    {
      scenario: 'The log table throttles or is unavailable.',
      impact:
        'No operation is acknowledged. Editors type locally and see unsaved changes. Opening a document fails with 503. Nothing is lost and nothing is acknowledged falsely.',
      detection:
        'ThrottledRequests and SystemErrors on the log table, the share of operations not acknowledged within 200 ms, and the error ratio on the gateway’s load balancer.',
      recovery:
        'Each document with an operation to write is unloaded after its 3 failed attempts. Gateways keep sockets and ask for the document every 2 seconds for up to 60 seconds, then close them, and clients retry with waits of up to 30 seconds for up to 60 minutes. A session task runs at most 20 loads at a time and queues the rest, and a waiting document counts toward the 5,000 at which the task refuses new ones, which bounds the queue and the reads this causes. When the table answers, the pool loads up to 7,200 documents a second, so 240,000 documents are back in about 35 seconds, and clients resend what they hold.',
    },
    {
      scenario: 'The snapshot store is unavailable.',
      impact:
        'Documents that are loaded keep working. A document that is not loaded and has a snapshot cannot be opened, and joins to it get 503. New snapshots fail, so logs grow.',
      detection:
        '5xxErrors on the bucket, failed loads counted by the session tasks, and the largest number of entries above a snapshot, alarmed at 3,000.',
      recovery:
        'A snapshot is tried 3 times and then left for the next 1,000 entries or the unload; a task that unloads without a snapshot leaves the tail in the log. When the store answers, the next trigger writes the snapshot and the trim follows. Loads that failed are retried by the gateways and the clients.',
    },
    {
      scenario: 'A whole Availability Zone is lost.',
      impact:
        '30 of 90 session tasks and 30 of 90 gateway tasks disappear: 80,000 documents lose their owner and 200,000 sockets drop. The 400,000 sockets on surviving gateways stay open, and about a third of them wait for a takeover.',
      detection:
        'The load balancer’s error ratio, the takeover time, and the pool alarm, because the surviving tasks are now at their planned load.',
      recovery:
        'Takeovers start 15 to 20 seconds after the loss. The 60 surviving session tasks load 20 documents at a time each, about 4,800 a second, and have more than that waiting from about 15 seconds on, so the last of the 80,000 is back about 17 seconds after that: about 32 seconds after the loss, at most about 40, and inside the 45-second target. The dropped sockets return over about 10 seconds, 20,000 joins a second, 50 times the usual 400 and spread only by the clients’ random first wait; a join that is not answered 101 in that burst is tried again by its client with the doubling waits. The 60 tasks left in each pool carry the whole peak at exactly their planned load, 4,000 documents and 10,000 sockets, until the container service has started 30 more in the remaining zones.',
    },
    {
      scenario: 'A registry table cannot be read or written.',
      impact:
        'Without the members table, new sockets are refused with 503 and open connections continue on their last access list. Without the documents table, no document can be claimed, released or have a snapshot recorded. A loaded document keeps working for 10 minutes after its claim or its last successful check of the row, so for the first 9.5 to 10 minutes of an outage; after that its editors’ operations wait unacknowledged until the table answers. Nothing acknowledged is lost. Without the tasks table, heartbeats fail and no dead task’s documents can be taken over.',
      detection:
        'SystemErrors and ThrottledRequests on the tables, the age of the oldest access list and the time since the last heartbeat, both published by the session tasks and alarmed, and the load balancer’s error ratio for the refused sockets.',
      recovery:
        'Nothing has to be repaired. A session task keeps its documents while it cannot check them, and at the first check that still names it, it appends in order the operations it held; a snapshot that could not be recorded is tried at the next trigger, and its trim does not run until it is. Gateways keep the list of tasks they had. When the tasks table returns, a live task’s lease can read as run out until its next heartbeat, at most 5 seconds later. A document claimed in that window moves to another task needlessly and safely: the marker stops the old owner and its editors rejoin.',
    },
    {
      scenario: 'Two gateways ask two tasks to open the same unowned document at the same moment.',
      impact:
        'Without the condition on the claim, two tasks would load the document and editors would be split between them.',
      detection:
        'ConditionalCheckFailedRequests on the documents table. One event is normal; the count is the baseline.',
      recovery:
        'One claim succeeds. The other task gets the row back, answers that the first task owns the document, and its gateway connects there. A gateway follows at most 3 such answers and then answers 503, and the client retries.',
    },
    {
      scenario: 'A deploy replaces the session tasks.',
      impact:
        'Each replaced task hands over its documents, and their editors see a pause of a few seconds, the time their round takes to load: up to about 4.4 seconds in a deploy run off-peak, and up to about 6 in the largest round at peak. No takeover wait, because the task releases the documents itself.',
      detection:
        'Rejoins and loads per second, published by the gateways and the session tasks, rise for the length of the deploy. A deploy can fire Operations not acknowledged and Joins failing by itself when its rounds fill 3 consecutive minutes: a round delays one operation of each typist on a moving document, a tenth of the typists or more and so at least about 0.056% of a minute’s operations against a threshold of 0.05%, and a join to a document that is between owners can take longer than 1 s.',
      recovery:
        'The service keeps 100% of the tasks healthy and allows 110%, so 9 new tasks start and 9 old ones are stopped at a time. From SIGTERM on a stopping task takes no document: before it releases anything it starts answering every open for a document it does not hold, or has just released, with a refusal, and the gateway picks another live task. A stopping task finishes its appends, removes its name from each document row with a conditional write, and closes its streams, well inside the 120 seconds it is given. Gateways ask a live task for each document after their random wait of up to 2 seconds: about 24,000 loads in the first round at peak. The task is picked at random, so every round leaves each old task that is still waiting a tenth fuller, and a document can land on a task that is replaced later and move again. At peak that takes the old tasks from 2,667 past the 3,600 of the pool alarm in the fourth round, past the 4,000 plan in the fifth and to the 5,000 at which a task is skipped in the seventh, with up to 45,000 loads in a round. Session deploys therefore run off-peak, when no task holds more than 1,500 documents: the last old tasks then end near 3,540. A document the task did not manage to release is treated like a crash.',
    },
    {
      scenario: 'A client stays disconnected for more than 60 minutes.',
      impact:
        'The entries after its pending operation’s base version may have been trimmed, so the session task could no longer tell a resend from a new operation.',
      detection: 'The client’s own timer. Reload answers are counted by the session tasks.',
      recovery:
        'After 60 minutes the client stops retrying, makes the editor read-only and shows the unsent text for copying. If it does send, the session task finds the entries after the base version incomplete and answers reload. The client loads the document again under a new client id.',
    },
    {
      scenario: 'One client sends frames as fast as it can, or one socket cannot keep up.',
      impact:
        'A flood would fill the session task’s queue for that document; a slow reader would hold entries in the gateway’s memory.',
      detection:
        'Frames refused and sockets closed for a full buffer, both counted by the gateways.',
      recovery:
        'The gateway accepts at most 4 operations and 2 presence frames a second per socket and at most 64 KB per frame, and closes a socket that breaks the limits. A socket whose send buffer fills is closed, and that client reconnects and catches up from its last version.',
    },
  ],
  capacity: {
    assumptions: [
      '600,000 connections at peak on 240,000 open documents, 2.5 per document. Most documents have one or two editors.',
      'A connection lasts 25 minutes on average, and a document stays loaded for 40 minutes.',
      '10,000 connections are typing at any instant, 1 in 60. A typing client sends 3 operations a second on average and at most 4.',
      '20,000 connections are moving a cursor without typing, and each sends 2 presence updates a second.',
      'A log entry with one operation is about 300 bytes. A write costs one write unit per KB, a consistent read one read unit per 4 KB, and an eventually consistent read half of that.',
      'A log write takes about 5 ms. A cold load takes about 250 ms, and a session task runs at most 20 loads at a time.',
      'A session task is planned for 4,000 documents and a gateway task for 10,000 sockets. Both are planning figures to confirm with a load test, not limits of the service. A session task refuses new documents at 5,000.',
      'An access list is under 4 KB, about 40 members.',
      '200 million documents are stored, with 20 KB of text on average.',
    ],
    estimates: [
      {
        label: 'Joins and loads',
        value: '400 joins per second, 100 loads per second',
        math: '600,000 connections ÷ 1,500 s = 400. 240,000 documents ÷ 2,400 s = 100 loads, and as many unloads.',
      },
      {
        label: 'Operations',
        value: '30,000 per second',
        math: '10,000 typists × 3 per second.',
      },
      {
        label: 'Socket frames',
        value: '265,000 per second, about 2,900 per gateway task',
        math: 'In: 30,000 operations + 40,000 presence (20,000 × 2) + 30,000 pings (600,000 ÷ 20 s) = 100,000. Out: 75,000 entry copies (30,000 × 2.5, the author’s copy being the acknowledgment) + 60,000 presence (40,000 × 1.5 other editors) + 30,000 pongs = 165,000. 265,000 ÷ 90 tasks ≈ 2,900.',
      },
      {
        label: 'Log write units',
        value: '~60,200 per second',
        math: '30,000 appends + 100 markers, one per load, = 30,100 writes of one unit. Every entry is deleted once, at least 70 minutes later, one unit each: 30,100 more at a sustained peak.',
      },
      {
        label: 'Log read units',
        value: '~1,300 per second; 54,000 to 81,000 during a mass reload',
        math: 'The trim reads each entry once, with eventual consistency, which is enough to find old entries: 30,100 × 300 bytes ÷ 4 KB ≈ 2,260 units, halved to about 1,130. The tail queries of 100 loads a second add about 150; after a clean unload a tail is empty. A mass reload is different, because a document that lost its task, or was unloaded after failed appends, was not snapshotted on the way out. A loaded document gets 30,000 ÷ 240,000 = 0.125 entries a second and is on average 1,200 s into its 40 minutes, so its tail holds 150 entries on average, or fewer where a snapshot was taken since: 45 KB, about 11 units. A lost zone reads 4,800 × 45 KB ÷ 4 KB = 54,000 units a second for about 17 s, and the 7,200 loads a second after a log outage read 7,200 × 45 ÷ 4 = 81,000, the most any reload can ask, since loads never pass 7,200 a second.',
      },
      {
        label: 'Entries kept',
        value: '~126 million, ~38 GB, for the 70 minutes',
        math: '30,000/s × 4,200 s = 126M; × 300 bytes ≈ 37.8 GB. Older entries wait for their document’s next snapshot, at most about 1,000 per loaded document.',
      },
      {
        label: 'Registry and access reads',
        value:
          '~9,100 read units per second; about 98,100 on the documents table when a zone is lost',
        math: 'Documents table: the 30-second ownership check, 240,000 ÷ 30 s = 8,000/s × 0.5 = 4,000, plus up to 400 consistent reads from joins = 4,400. Members table: the 30-second list read, 8,000/s × 0.5 = 4,000, plus 400 join checks and 50 for the lists read by 100 loads = 4,450. Tasks table: 180 tasks scan 90 rows every 2 s, 90 scans/s × about 3 units = 270. A lost zone adds the gateways’ own reads of the documents table. The 80,000 orphaned documents have 200,000 connections, and the two thirds on surviving gateways, about 133,000 sockets, wait: at most one pair of gateway and document per socket. Each pair reads the row once per 2-second retry, the first time after a random wait inside those 2 seconds, so 133,000 ÷ 2 s ≈ 67,000 consistent reads a second, one unit each, for the 15 to 20 s before takeovers start, and fewer as documents are loaded. The returning sockets add 20,000 joins a second and their retries. A third of the 200,000, about 66,700, belong to orphaned documents that cannot be claimed yet. Such an upgrade reads the row once, does not read it again while it is pending, and is answered 503 after its 5 seconds; the client then waits, 5 s or more on average since its first wait is random up to 10 s and the later ones are longer, so each of them retries at most once in 10 s: 66,700 ÷ 10 s ≈ 6,700 retries a second, each one read on the members table and one on the documents table. On the documents table that is 67,000 + 20,000 + 6,700 + the steady 4,400 ≈ 98,100, and on the members table 20,000 + 6,700 + 4,450 = 31,150. The loads’ own reads are small next to those: each of the 4,800 loads a second reads its access list, half a unit as in steady state, 2,400 units that bring the members table to about 33,550, under its 40,000, and each takeover makes one consistent read of the dead task’s lease, 4,800 a second on the tasks table, under the 12,000 that a new table sustains. A deploy round asks less, one read per pair because the row was released: 24,000 documents × 2.5 = 60,000 pairs ÷ 2 s = 30,000 a second in the first round at peak, and 31,900 × 2.5 ≈ 79,800 ÷ 2 s ≈ 39,900 in the last round of a deploy run off-peak, each on top of at most 4,400. A log outage can ask for more, because a document is unloaded after its 3 failed appends and each of its pairs then reads the row every 2 seconds for up to 60 seconds: the 10,000 people typing when the outage starts are on at most 10,000 documents with about 25,000 sockets, 12,500 reads a second at once, and every other document joins them when someone types in it, up to all 600,000 sockets and 300,000 reads a second if every open document is typed in within the same minute. That is above the table’s 120,000, so such an outage throttles those reads, together with the joins and the ownership checks that read the same table, and all of them are tried again; no document can be loaded while the log is down anyway, and the about 35 seconds of the recovery stand, because a throttled table still answers 120,000 reads a second, so a gateway’s read gets through within a few of its tries, and the pool’s 7,200 loads a second remain what sets the time.',
      },
      {
        label: 'Registry writes',
        value: '~350 write units per second',
        math: '100 claims + 100 releases + 130 snapshot records + 18 heartbeats (90 tasks ÷ 5 s) = 348.',
      },
      {
        label: 'Snapshots',
        value: 'up to 130 puts, 100 gets and 130 deletes per second; ~4 TB stored',
        math: '30,000 entries/s ÷ 1,000 = 30 snapshots a second by count, plus up to 100 at unload. One get per load. Each new snapshot deletes the one before. 200M documents × 20 KB = 4 TB.',
      },
      {
        label: 'Session tasks',
        value: '60 needed, 90 run',
        math: '240,000 ÷ 4,000 = 60. 90 tasks, 30 per zone, hold 2,667 documents each, 67% of the plan. With one zone gone, 60 tasks hold 4,000 each, 100% of the plan and under the 5,000 at which a task refuses.',
      },
      {
        label: 'Gateway tasks',
        value: '60 needed, 90 run',
        math: '600,000 ÷ 10,000 = 60. 90 tasks hold 6,667 sockets each; with one zone gone, 60 tasks hold 10,000 each.',
      },
      {
        label: 'Session task memory',
        value: 'under 1 GB typical, 3.5 GB at the limits',
        math: 'Typical, at today’s 2,667 documents: 2,667 × (20 KB of text + a tail of up to 300 KB) is about 850 MB at most. Every document at 1 MB with a full tail: 2,667 × 1.3 MB ≈ 3.5 GB.',
      },
      {
        label: 'One session task dies',
        value: '2,667 documents and 6,667 connections wait 15 to 23 s',
        math: '240,000 ÷ 90 and × 2.5. Lease 15 s after the last heartbeat + 5 s of grace = 20 s after the last heartbeat, 15 to 20 s after the crash, + up to 2 s for the gateway’s next try + 0.25 s to load.',
      },
      {
        label: 'One zone is lost',
        value:
          '80,000 documents reloaded at 4,800 per second; 200,000 sockets return at 20,000 per second',
        math: '30 tasks × 2,667 = 80,000. 60 tasks × 20 loads ÷ 0.25 s = 4,800/s; 80,000 ÷ 4,800 ≈ 17 s. The 30 dead tasks become claimable spread over the 15 to 20 s after the loss, 80,000 ÷ 5 s = 16,000 documents a second, more than the 4,800 the pool loads, so the pool is full from about 15 s on and the last document is back about 15 + 17 ≈ 32 s after the loss. With every lease at its latest and every gateway’s try at its slowest, the upper bound is 20 + 2 + 17 ≈ 40 s. 30 gateways × 6,667 = 200,000 sockets ÷ 10 s of random wait = 20,000 joins/s.',
      },
      {
        label: 'A deploy',
        value:
          '10 rounds of 9 tasks; ~24,000 loads in the first round at peak, or 60,000 reconnects per round',
        math: '90 × 110% = 99 tasks at most, so 9 at a time. Session tasks: 9 × 2,667 = 24,000 documents released and loaded elsewhere in the first round at peak, about 3 s of loading for the 90 tasks that are not stopping, which load 90 × 20 ÷ 0.25 s = 7,200 a second. Each of those 90 gets a tenth of what one stopping task held, so the old tasks still waiting grow by a factor of 1.1 per round: 2,933, 3,227, 3,549, 3,904, 4,295, 4,724 and then the 5,000 at which a task is skipped, with up to 9 × 5,000 = 45,000 loads in a round, 45,000 ÷ 7,200 ≈ 6 s of loading. Started off-peak from 1,500 per task, the last old tasks end at 1,500 × 1.1^9 ≈ 1,500 × 2.36 ≈ 3,540, and their round loads 9 × 3,540 ≈ 31,900 documents in 31,900 ÷ 7,200 ≈ 4.4 s. Gateways: 9 × 6,667 = 60,000 sockets returning over 10 s = 6,000 joins/s.',
      },
      {
        label: 'A full document',
        value:
          '500 connections, at most 200 entries and about 600 write units per second, about 1,200 once its deletes start',
        math: 'One append in flight at 5 to 10 ms each gives 100 to 200 entries/s. 500 typists × 3 = 1,500 operations/s ÷ 150 entries ≈ 10 per entry ≈ 3 KB = 3 units; 200 × 3 = 600 at most. A delete costs what the item weighs, so deleting those entries, at least 70 minutes later, is 3 units each as well: up to 600 more, about 1,200 in all and above the 1,000 of one partition, for a document that stays full for over 70 minutes. Fan-out: up to 200 × 500 = 100,000 socket writes a second for that one document.',
      },
      {
        label: 'The first version’s slow open',
        value: '2 million entries, 600 MB, about 30 s and 150,000 read units',
        math: '2M × 300 bytes = 600 MB, returned 1 MB per query page: 600 pages × about 50 ms = 30 s. 600 MB ÷ 4 KB = 150,000 consistent read units.',
      },
    ],
    implications: [
      'The log is the cost: 60,200 write units a second against a default table quota of 40,000 and the 4,000 writes a second that a new on-demand table sustains. The quota is raised to 120,000 before launch and the table’s warm throughput to the peak. Everything else in the design is small next to it.',
      'Deleting entries one by one is half of that figure. It is the price of deleting only what a recorded snapshot covers; an expiry time would be free and would delete by the clock.',
      'A lease per task costs 18 writes a second. A lease per document, renewed every 5 seconds, would cost 48,000, more than all the typing.',
      'Tasks are sized by what they hold, not by traffic: 2,900 frames a second per gateway task is light, while 6,667 sockets and 2,667 documents in memory are what a task death or a deploy has to move.',
      'The spare capacity is exactly one zone. 90 tasks at 67% of the plan become 60 at 100% when a zone is lost, with nothing to spare until the container service has started 30 more, so the pool alarm fires in that state on purpose. A deploy adds tasks before it stops any, so the pool never has fewer than 90, but it piles documents onto the tasks not yet replaced, a tenth more each round, which at peak passes the pool alarm in the fourth round and the plan in the fifth: session deploys run off-peak.',
      'Reads are driven by reconnects, not by steady traffic. A lost zone brings 20,000 joins a second, each one consistent read on the members table and at most one on the documents table, on top of 4,450 and 4,400, and about 6,700 retries a second from the sockets whose document has no owner yet, one read on each table. The members table sees about 33,550 with the list reads of the loads and is pre-warmed to 40,000 reads a second, where a new on-demand table sustains 12,000. The documents table takes more: the surviving gateways read the rows of the 80,000 orphaned documents again every 2 seconds, about 67,000 reads a second, which makes about 98,100 with the joins, their retries and the steady reads. Its read quota is therefore raised from the default 40,000 to 120,000 and its warm throughput for reads to the same 120,000 a second. The documents table also takes the writes of every mass reload, a release per unload and a claim per load, where steady traffic is about 330 a second (100 claims + 100 releases + 130 snapshot records). The largest burst is a deploy round: 24,000 releases and as many claims in the first round at peak, and 9 × 3,540 ≈ 31,900 in the last round of a deploy run off-peak. Claims never pass 7,200 a second (90 tasks × 20 loads ÷ 0.25 s), so even with every release of that round inside one second the table sees 31,900 + 7,200 = 39,100 writes. Its warm throughput for writes is therefore raised to 40,000 a second, which is the default table quota, where a new on-demand table sustains 4,000.',
      'Loads are deliberately rationed, 20 at a time per task. That bounds what a mass takeover or a log outage can ask of the stores, 4,800 to 7,200 snapshot reads a second under the 11,000 that one prefix serves and 54,000 to 81,000 read units a second for the tails on the log table, whose read quota is raised to 120,000 and whose warm throughput for reads to 90,000, and it is why a lost zone takes about 32 seconds, at most about 40, and not 23.',
      'A full document’s appends stay under one partition’s 1,000 write units a second because group commit caps its entries at about 200 a second, whatever the number of typists: about 600 units. Its deletes cost as much again 70 minutes later, so a document that stays full for longer than that passes 1,000 and is throttled. The cap of 500 connections is about fan-out, not about the log.',
      'Replaying a whole log costs 150,000 read units for one old document, almost four times the table’s default quota for a second. Snapshots are not an optimisation; without them the oldest and most valuable documents stop opening.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one Region across three Availability Zones. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Socket gateway',
        service:
          'An Application Load Balancer that serves only the gateways, with AWS WAF and the default 60 s idle timeout, in front of Amazon ECS on AWS Fargate: 90 tasks in three zones',
        why: 'The load balancer upgrades HTTP connections to WebSockets and spreads them over the tasks; any gateway can serve any document. A gateway checks the token and the member row, finds or asks for the owner, and relays frames over one stream per session task. It holds sockets and no document state, so losing one costs a reconnect.',
        watch:
          'ALB RequestCount, HTTPCode_Target_5XX_Count, HTTPCode_ELB_5XX_Count, ActiveConnectionCount and NewConnectionCount; ECS CPUUtilization and MemoryUtilization. Custom: joins by outcome and time to the document, operations received and acknowledged within 200 ms and 300 ms, fan-out time, takeover time, sockets per task, and sockets closed by reason.',
      },
      {
        part: 'Doc session',
        service:
          'An Amazon ECS service on AWS Fargate, 90 tasks in three zones, reached by the gateways at their private addresses with no load balancer; stop timeout 120 s; deployments keep 100% healthy and allow 110%',
        why: 'The only stateful part. A task holds the text, the recent tail, the access list and the cursors of each document it owns, orders its operations and is the only writer of its log while it owns it. Everything it holds can be rebuilt from the log and the snapshot.',
        watch:
          'ECS CPUUtilization and MemoryUtilization. Custom, per task: documents loaded, append attempts by outcome and their latency, loads by outcome, the largest number of entries above a snapshot, the age of the oldest access list, seconds since the last successful heartbeat, snapshots by outcome, and reload answers.',
      },
      {
        part: 'Operation log',
        service:
          'Amazon DynamoDB, on-demand: one table keyed by document id and version, with the table quota raised to 120,000 write units and 120,000 read units, and the warm throughput raised to the peak for writes and to 90,000 reads a second',
        why: 'A put with attribute_not_exists is the append: one entry per position, decided by the store. A consistent Query returns a document’s tail in order. DynamoDB confirms a write only once it is durable, and keeps a table’s data in several Availability Zones; that confirmation is what the acknowledgment waits for.',
        watch:
          'ThrottledRequests, WriteThrottleEvents, WriteKeyRangeThroughputThrottleEvents, SystemErrors, ConditionalCheckFailedRequests, ConsumedWriteCapacityUnits, ConsumedReadCapacityUnits and SuccessfulRequestLatency.',
      },
      {
        part: 'Doc registry and access list',
        service:
          'Amazon DynamoDB, on-demand: a documents table keyed by document id, a members table keyed by document id and user id, and a tasks table keyed by task id with time to live; warm throughput of the members table raised to 40,000 reads a second; the documents table’s read quota raised to 120,000 read units, and its warm throughput to 120,000 reads and 40,000 writes a second',
        why: 'The document row holds the owner task and the latest snapshot version, both changed only by conditional writes. The members table is the access list. The tasks table holds one lease per session task, which every gateway and session task scans every 2 seconds to know who is alive.',
        watch:
          'ThrottledRequests, SystemErrors, ConditionalCheckFailedRequests, ConsumedReadCapacityUnits and SuccessfulRequestLatency on each table.',
      },
      {
        part: 'Snapshots',
        service:
          'An Amazon S3 general purpose bucket, S3 Standard, with request metrics turned on; objects named by document id and version',
        why: 'A snapshot is up to 1 MB, more than a DynamoDB item can hold, and is read once per load. S3 returns an object to any read after its write, stores it across at least three Availability Zones, and a write with If-None-Match creates an object only if the name is free.',
        watch: 'Request metrics: 5xxErrors, 4xxErrors, AllRequests and FirstByteLatency.',
      },
      {
        part: 'Document API',
        service:
          'A second Application Load Balancer with AWS WAF, in front of a small Amazon ECS service on AWS Fargate',
        why: 'Creates documents and changes member rows: a few stateless calls, each one conditional write or one transaction. Its own load balancer keeps its error counts apart from the sockets’.',
        watch:
          'ALB RequestCount, TargetResponseTime, HTTPCode_Target_5XX_Count and HTTPCode_ELB_5XX_Count.',
      },
      {
        part: 'Security',
        service:
          'AWS WAF on both load balancers, security groups, IAM roles per service, AWS KMS, AWS CloudTrail',
        why: 'Sockets and calls use TLS and a short-lived token, and the user id always comes from the token. A socket is opened only for a member, and the session task checks the role on every operation. Session tasks accept streams only from the gateways’ security group. Each role reaches only what it needs: gateways read the registry and never write the log, and only session tasks write the log and the snapshots. Tables and the bucket are encrypted with KMS keys. The gateway caps a frame at 64 KB and a socket at 4 operations a second.',
        watch:
          'WAF blocked requests per rule, 403 answers at the upgrade, and frames refused by the gateways.',
      },
      {
        part: 'Observability',
        service: 'Amazon CloudWatch dashboards and alarms',
        why: 'The objectives are measured by the gateways and the load balancer, which are not the parts that fail when a session task or a table does. Metrics that a session task publishes about itself are used for what only it can know, and the alarms on them say what happens when the task is silent.',
        watch: 'The objectives and alarms below.',
      },
    ],
    limits: [
      'An Application Load Balancer supports WebSockets natively: an HTTP/1.1 connection is upgraded and stays open between client and target. Its idle timeout is 60 seconds by default, configurable from 1 to 4,000, and it closes a connection with no data in either direction for that long, which is why clients ping every 20 seconds.',
      'HTTPCode_Target_5XX_Count leaves out the 5xx that the load balancer generates itself, and HTTPCode_ELB_5XX_Count exists per load balancer and is reported only in minutes that have one. The gateways therefore have their own load balancer, and the error ratio adds both counts with an absent count read as zero. RequestCount counts only requests for which a target was chosen, so the ratio is missing only when RequestCount is, and that case counts as breaching.',
      'AWS WAF attaches to an Application Load Balancer and not to a Network Load Balancer, one reason the sockets enter through an Application Load Balancer.',
      'An ECS container gets SIGTERM and then SIGKILL after its stop timeout, 30 seconds by default and at most 120 on Fargate. A stopping session task has to release its documents inside that time; what it does not release is taken over like a crash.',
      'In an ECS deployment, maximumPercent counts running, pending and stopping tasks, and minimumHealthyPercent rounds up. With 90 tasks, 100% and 110% mean 9 tasks are replaced at a time.',
      'A Fargate task’s default limit on open files is 65,535, above the 10,000 sockets a gateway task is planned for.',
      'A DynamoDB item is at most 400 KB. A log entry is capped at 256 KB and an operation at 64 KB; a larger paste is sent as several operations.',
      'A DynamoDB conditional write that fails still consumes write units, and it can return the item that made it fail at no read cost, which is how a refused task sees who wrote the position.',
      'A DynamoDB Query returns at most 1 MB per page. Consistent reads are available on tables; this design uses no secondary index.',
      'BatchWriteItem takes up to 25 puts or deletes and 16 MB, accepts no conditions, is not atomic and returns what it did not process. That is enough for a trim, whose deletes are safe in any order and any number.',
      'A DynamoDB partition takes 1,000 write units and 3,000 read units a second. All entries of one document share a partition key, so one document’s log cannot write faster than that. A delete consumes write units by the size of the item it removes.',
      'A new DynamoDB on-demand table sustains 4,000 writes and 12,000 reads a second and accommodates up to double its previous peak at once; beyond that it can throttle until it has adapted, so the tables are pre-warmed. The default quota per on-demand table is 40,000 read and 40,000 write request units a second and can be raised, and a table can be pre-warmed only up to its quota.',
      'A DynamoDB transaction costs two writes per item. The only transaction here is the creation of a document, which writes the document row and the creator’s member row.',
      'DynamoDB time to live deletes an item within a few days of its expiry, not at it. A task’s death is decided by the lease time in its row, never by waiting for the row to disappear; a missing row counts as run out.',
      'DynamoDB publishes ThrottledRequests only in minutes that have a throttled request, so an alarm on it treats missing data as not breaching.',
      'Amazon S3 gives strong read-after-write consistency for puts and deletes, and supports at least 3,500 writes and 11,000 reads a second per partitioned prefix. A put with If-None-Match fails if the key exists.',
      'S3 request metrics are off until they are turned on for a bucket, arrive at one-minute intervals after some delay, and are delivered on a best-effort basis.',
      'A CloudWatch alarm reads more data points than its evaluation periods, a span called the evaluation range, and uses every real data point in it before it fills in a missing one. So an alarm that counts missing data as breaching fires on silence only once the last real data point has left the range, and one that counts it as not breaching returns to OK only once the breaching points have left it. CloudWatch gives no fixed size for the range, so those delays are written here as a few minutes.',
    ],
  },
  slos: [
    {
      objective: 'Joining a document',
      target:
        '99.9% of upgrade requests from members are answered 101 and get their document within 2 s, over 28 days',
      measure:
        'Errors on the gateways’ own load balancer: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount, with an absent 5XX count read as zero; the ratio is missing only when RequestCount is, and such a minute counts as failed. Time: from the upgrade request to the init or catch-up frame, measured by the gateway, where a socket that never gets its document counts as late. Answers 403 and 409 are not failures. A warm join, to a document that is already loaded, usually takes 60 ms; with 400 joins and 100 loads a second, 1 join in 4 waits for a cold load of about 250 ms, so the usual p95 is about 250 ms.',
    },
    {
      objective: 'Acknowledging an operation',
      target:
        '99.9% of operations acknowledged within 300 ms of reaching the gateway, over 28 days',
      measure:
        'The gateway notes when an operation arrives and when its acknowledgment leaves, on one clock, and counts operations received and operations acknowledged within 300 ms. An operation that is never acknowledged on that socket, because the owner died or the document was unloaded, counts as a miss. The usual p95 is 30 ms. The time a client spends reconnecting to another gateway is not in this figure.',
    },
    {
      objective: 'Reaching the other editors',
      target:
        '99% of entries written to every socket of their document within 100 ms of reaching that gateway, over 28 days',
      measure:
        'From the moment a gateway receives an entry from a session task to the moment it has written it to the last of its sockets for that document, published by the gateways as a percentile. The session task sends an entry to the gateways in the same step as the acknowledgment, so the two figures together cover the server’s part. The usual p99 is 20 ms.',
    },
    {
      objective: 'Recovering from a dead owner',
      target:
        '99% of documents that lose their owner are served by a new one within 45 s, over 28 days',
      measure:
        'From the moment a gateway loses the owner of a document it holds sockets for, to the moment a new owner answers ready, measured by the gateway. A document the gateway gives up on after 60 seconds counts as a miss. One dead task gives 15 to 23 s; a lost zone about 32 s for the last documents, at most about 40.',
    },
    {
      objective: 'Applying access changes',
      target: '99.9% of access-list reads happen within 60 s of the one before, over 28 days',
      measure:
        'The age of a document’s list at the moment the session task reads it again, published per read, and the age of the oldest list a task holds, published every minute. The usual age is 30 s. A removed member keeps access for as long as the list is old. The objective counts reads, so an outage of the members table, however long, is one late read per document; the exposure during it is the age of the oldest list, which the alarm watches.',
    },
  ],
  alarms: [
    {
      name: 'Joins failing',
      metric:
        'On the gateways’ own ALB: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount above 0.04% for 3 consecutive 1-minute periods, with an absent 5XX count read as zero and a missing ratio counted as breaching; or, from the gateways, joins that got their document later than 1 s above 0.04% of joins for 3 consecutive 1-minute periods, missing data not breaching',
      meaning:
        'People cannot open documents: gateways are down or too few, no session task is ready, or a registry table, the log or the snapshot store is failing loads. Each clause lets through at most 0.04%, so both together stay inside the 0.1% the target allows, and 1 s is tighter than the 2 s target. The load balancer publishes the first clause, so it works with every gateway dead, and the ratio is missing only when no request reached a target, which fires it too. One dead session task raises the ratio for a minute or two, while its documents wait for the lease, and does not fire it.',
    },
    {
      name: 'Operations not acknowledged',
      metric:
        'Custom, from the gateways: operations not acknowledged within 200 ms above 0.05% of operations received, for 3 consecutive 1-minute periods; missing data counts as breaching',
      meaning:
        'Typing is not being saved in time: the log table is slow or throttling, session tasks are overloaded, documents are being unloaded and reloaded, or the documents table has not answered for over 10 minutes and session tasks are holding operations. It fires at half the share the target allows and at 200 ms, before the 300 ms target. Gateways measure it, so it does not depend on the session tasks that fail. If every gateway is dead the metric is silent, which fires this alarm a few minutes later, and Joins failing fires from the load balancer.',
    },
    {
      name: 'Log table throttling',
      metric:
        'DynamoDB ThrottledRequests above 0 for 1 minute on the log table, summed over PutItem, Query and BatchWriteItem, or WriteThrottleEvents above 0 for 1 minute on the same table; missing data is not breaching, because ThrottledRequests has a data point only in a minute with a throttled request',
      meaning:
        'Appends, tail reads or trims are being refused. ThrottledRequests counts a BatchWriteItem only when every request in it was throttled, so a trim that is throttled in part shows in WriteThrottleEvents. Usually the table’s warm throughput or quota is below the traffic; WriteKeyRangeThroughputThrottleEvents above 0 says one document passed a partition’s 1,000 write units. A throttled append is retried and delays acknowledgments before it fails them, so this fires ahead of Operations not acknowledged. It returns to OK a few minutes after the last throttled request, once that data point has left the alarm’s evaluation range.',
    },
    {
      name: 'Fan-out slow',
      metric:
        'Custom, from the gateways: p99 of the time from receiving an entry to writing it to the last socket above 60 ms for 3 consecutive 1-minute periods; missing data is not breaching',
      meaning:
        'Entries are queuing inside the gateways: tasks are short of CPU, or a few very large documents sit on the same gateways. It fires at 60 ms, before the 100 ms target. If the gateways are all down it is silent and Joins failing fires.',
    },
    {
      name: 'Takeover slow',
      metric:
        'Custom, from the gateways: p99 of the time from losing a document’s owner to a new owner being ready above 35 s over one 5-minute period; missing data is not breaching, because there is no data while no task dies',
      meaning:
        'Documents of a dead task are waiting longer than a lease and a load: the tasks table cannot be read, the pool is too small to load them, or loads are failing. One dead task gives at most 23 s and does not fire it. A lost zone gives about 32 s for the last documents, at most about 40 and under the 45-second target, so its p99 usually stays under this threshold: a lost zone is reported by Pool nearly full, because every surviving task then sits at 100% of its plan, and this alarm is for takeovers that run long. It returns to OK once the breaching period has left the evaluation range, or sooner if a later period has takeovers under 35 s.',
    },
    {
      name: 'Pool nearly full',
      metric:
        'Custom: the largest number of documents on one session task above 3,600, or the largest number of sockets on one gateway task above 9,000, for 5 minutes; missing data is not breaching',
      meaning:
        'A pool is at 90% of what it was planned for, against the usual 67%. Either traffic has outgrown 90 tasks or tasks are missing, as after a lost zone, when every task sits at 100%. There is then no room for another failure. It protects the join and acknowledgment objectives before they move: a session task refuses documents only at 5,000.',
    },
    {
      name: 'Snapshots behind',
      metric:
        'Custom, from the session tasks: the largest number of entries above a document’s snapshot above 3,000 for 2 consecutive 5-minute periods; missing data is not breaching',
      meaning:
        'Snapshots are failing: the bucket is refusing writes or the document row cannot be updated. Nothing is lost, but logs grow and loads get slower. 3,000 entries are about 1 MB of tail and still load well inside the 2 s join target, so this fires long before joins are late. A dead task publishes nothing, and its documents get a fresh count from whoever loads them.',
    },
    {
      name: 'Access list stale',
      metric:
        'Custom, from the session tasks: the age of the oldest access list above 45 s for 2 consecutive 1-minute periods; missing data is not breaching',
      meaning:
        'Session tasks cannot read the members table, so removed members keep their connections. Two periods above 45 s mean the oldest list is about 2 minutes old when it fires: after the 60 s of a single read, and long before the 28-day budget is spent, because one outage is one late read per document. A task that is dead holds no lists: its documents are loaded elsewhere with a fresh list, so silence here is not a risk.',
    },
    {
      name: 'Leases not renewing',
      metric:
        'Custom, from the session tasks: the longest time since a task’s last successful heartbeat above 10 s for 1 minute; missing data is not breaching',
      meaning:
        'Live tasks cannot write their lease: the tasks table is throttling or unreachable. No document is at risk, because the log is fenced by its own writes, but leases are running out, and when the table returns some live tasks can lose documents to needless takeovers. It warns before Takeover slow can, since takeovers are blocked while the table cannot be read.',
    },
  ],
  evolution: {
    mvp: 'One service whose tasks both hold sockets and own documents: the load balancer sends a socket to any task, and a task that does not own the document relays frames to the one that does, using the same registry row. The conditional append, the marker on every load, the acknowledgment after the write and the client id with a sequence number are all in the first version, because they are what keeps a log single and an acknowledged edit stored, and none of them can be added after a log has forked. Snapshots are in too, taken when a document closes. Left out at first: group commit, with one operation per entry; the trim, with the whole log kept; the separate gateway pool; and the cap of 500 connections.',
    atScale: [
      'At 10x (6 million connections, 300,000 operations a second), the log costs 600,000 write units a second, half of them deletes. The first step is to stop paying per operation: each session task appends the entries of all its documents to one replicated log that only it writes, a few large writes a second, and a new owner fences a dead task by sealing its log before reading it. The registry and the snapshots stay as they are.',
      'At 10x, 900 session tasks and 900 gateways scanning the tasks table every 2 seconds read 180 KB each time. Tasks subscribe to changes of the table, or read a copy that one task refreshes, and the scan becomes the fallback.',
      'At 10x, a lost zone is 800,000 documents to load. Taking over on demand is no longer enough: surviving tasks claim a dead task’s documents in order of how many editors wait, and the 20 loads at a time become a rate the stores were sized for.',
      'At 10x, more documents hit the cap of 500. Connections past the cap join as readers on a second path that follows the log a second behind and never sends operations.',
      'At 100x, one Region is too far from most editors and too large to fail at once. A document gets a home Region, where its log and its owner live; editors elsewhere connect to gateways near them, which relay to the home Region. No log is written from two Regions.',
    ],
    firstBottleneck:
      'The write units of the log. 60,200 a second is already above the default table quota of 40,000, it grows with typing and not with users, and half of it is deletes. The second is the time to move documents when tasks die: 2,667 per task today, and a zone’s 80,000 take about 32 seconds, at most about 40, because loads are rationed.',
    avoided: [
      'A CRDT. One owner per document already gives an order, and plain text with operational transformation stays small. Worth adding when long offline editing or peer-to-peer sync moves into scope.',
      'An owner epoch checked in a transaction on every append. The conditional write on the position does the same job at half the cost or less. Worth revisiting only if the log moves to a store without conditional writes.',
      'A lease per document. One lease per task and a check of the document row every 30 seconds are enough. Worth adding if documents must move off a slow task faster than that check.',
      'A separate compaction job. The owner snapshots from the text it already holds. Worth adding when snapshots of very large documents start to disturb editing on the same task.',
      'An expiry time on log entries. Free deletes, and a timer that deletes whether or not a snapshot covers the entry. Worth it only together with a sweeper that proves coverage first.',
      'A separate presence service. Cursors ride through the session task and are lost with it. Worth adding when presence must survive a takeover or reach far more than 500 people.',
      'A feed of changes for search and history. Nothing reads the log but session tasks. Worth adding as a stream on the log table when search or version history moves into scope.',
      'A checksum of the text in every acknowledgment. It would catch a client whose copy diverged. Worth adding when several client builds with their own transform code are in use.',
      'Edits persisted on the device. They survive a closed tab and need the log kept for as long as a device may be away. Worth adding with the CRDT, not before.',
      'Taking over a dead task’s documents before anyone asks. On demand is simpler and loads only what is in use. Worth adding at the scale where a zone’s documents outnumber what the survivors can load in a lease.',
      'Splitting a document into sections with their own owners. One owner and group commit carry 500 connections. Worth adding only for documents that are really many documents.',
    ],
  },
};
