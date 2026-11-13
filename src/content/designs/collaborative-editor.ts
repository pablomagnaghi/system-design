import type { Design } from '../types';

export const collaborativeEditor: Design = {
  slug: 'collaborative-editor',
  title: 'Collaborative document editor',
  summary:
    'Let many people type into the same document at once and see each other within a fraction of a second: one ordered stream of operations per document, transformed so every copy converges, saved before it is acknowledged, and rebuilt quickly from snapshots.',
  difficulty: 'Hard',
  requirements: {
    functional: [
      'Several people edit the same document at the same time.',
      "Each editor sees the others' changes and cursors almost immediately.",
      'Every copy of the document ends up identical, whatever the order of typing.',
      'An editor that drops off for a while reconnects without losing its edits.',
    ],
    nonFunctional: [
      'Changes appear for other editors in well under a second.',
      'An acknowledged edit is never lost.',
      'Tens of editors per document; millions of documents, most of them idle.',
      'Opening a long-lived document stays fast after years of edits.',
    ],
    outOfScope: [
      'Long offline editing that merges days of work.',
      'Comments, suggestions and permissions management.',
    ],
  },
  entities: [
    {
      name: 'Document',
      description: 'Id, title, current version number and the latest snapshot reference.',
    },
    {
      name: 'Operation',
      description:
        'One edit (insert or delete at a position), its author, the version it was based on and the version it was given.',
    },
    {
      name: 'Snapshot',
      description: 'The full content of a document at a given version, used as a starting point.',
    },
    {
      name: 'Presence',
      description: 'Who is in the document and where their cursor is. Kept in memory only.',
    },
  ],
  api: [
    {
      method: 'GET',
      path: '/documents/{id}',
      description: 'The latest snapshot and the operations after it, plus the current version.',
    },
    {
      method: 'WS',
      path: '/documents/{id}/session',
      description:
        "Client sends operations with their base version; server sends acknowledgements, other editors' operations and presence.",
    },
  ],
  dataFlow: [
    'An editor opens the document and connects to the one server that owns its session.',
    'Each keystroke becomes an operation sent with the version it was based on.',
    'The session server transforms it against anything newer, gives it the next version and appends it to the log.',
    'It acknowledges the author and broadcasts the operation to everyone else, who apply it to their copy.',
  ],
  highLevel: {
    label: 'Send one keystroke to every editor',
    intro:
      'Follow one edit from the moment it is typed until every other editor shows it, and see how the document stays fast to open and safe after a disconnect. Press play, or step through the stages.',
    nodes: [
      { id: 'alice', title: 'Editor A', detail: 'Types locally', column: 0, row: 'top' },
      { id: 'bob', title: 'Editor B', detail: 'Same document', column: 0, row: 'bottom' },
      {
        id: 'gateway',
        title: 'Socket gateway',
        detail: 'Routes by document',
        column: 1,
        row: 'middle',
      },
      { id: 'presence', title: 'Presence', detail: 'Cursors, in memory', column: 2, row: 'top' },
      {
        id: 'session',
        title: 'Document session',
        detail: 'Orders + transforms',
        column: 2,
        row: 'middle',
      },
      {
        id: 'registry',
        title: 'Session registry',
        detail: 'Owner per document',
        column: 2,
        row: 'bottom',
      },
      { id: 'snapshots', title: 'Snapshots', detail: 'Every N operations', column: 3, row: 'top' },
      { id: 'oplog', title: 'Operation log', detail: 'Append-only', column: 3, row: 'middle' },
      { id: 'feed', title: 'Change feed', detail: 'Search, history', column: 4, row: 'middle' },
    ],
    edges: [
      ['alice', 'gateway'],
      ['bob', 'gateway'],
      ['gateway', 'registry', 'lookup'],
      ['gateway', 'session'],
      ['gateway', 'presence'],
      ['session', 'snapshots', 'load'],
      ['session', 'oplog', 'append'],
      ['oplog', 'snapshots', 'compact'],
      ['oplog', 'feed'],
    ],
    stages: [
      {
        title: 'One owner per document',
        narration:
          'When an editor opens a document, the gateway asks the registry which server owns its session. If none does, one server takes a lease on it. Every editor of that document is routed to the same session.',
        tradeoff:
          'A single owner gives one place that decides the order of edits, which makes convergence much simpler. The cost is a hot spot per document and a short pause when the owner fails and another takes over the lease. Documents rarely have more than a few dozen editors, so one server per document is enough.',
        nodes: ['alice', 'gateway', 'registry'],
        travel: [
          ['alice', 'gateway'],
          ['gateway', 'registry', 'lookup'],
        ],
      },
      {
        title: 'Load from a snapshot',
        narration:
          'The session loads the latest snapshot and replays only the operations written after it. The editor receives the content and the current version number.',
        tradeoff:
          'Replaying every operation since the document was created is exact but gets slower every day. Snapshots add a background job and extra storage, and in exchange opening a document costs one snapshot read plus a short tail of operations.',
        nodes: ['gateway', 'session', 'snapshots'],
        travel: [
          ['gateway', 'session'],
          ['session', 'snapshots', 'load'],
        ],
      },
      {
        title: 'Apply locally, send with a base version',
        narration:
          'Editor A types. The change appears in its own copy at once, and an operation goes to the server with the version it was based on. A keeps at most one operation in flight and buffers the rest.',
        tradeoff:
          'Waiting for the server before showing a keystroke would make typing feel broken. Applying optimistically gives instant feedback, and the price is that the client must later transform its pending edits against whatever the server says happened first.',
        nodes: ['alice', 'gateway', 'session'],
        travel: [
          ['alice', 'gateway'],
          ['gateway', 'session'],
        ],
      },
      {
        title: 'Transform and order',
        narration:
          "If other operations were accepted after A's base version, the session transforms A's operation against them, shifting its position so it still means what A intended. Then it gives the operation the next version number.",
        tradeoff:
          'Operational transformation needs a central order, which the single session provides, and transform rules that are easy to get subtly wrong. A conflict-free replicated data type avoids a central order but carries per-character metadata. With a server in the middle anyway, transformation keeps documents compact.',
        nodes: ['session'],
        travel: [],
      },
      {
        title: 'Save before acknowledging',
        narration:
          'The session appends the operation to the log with its version as the key. Only after the write succeeds does it acknowledge A, who can then send its next buffered operation.',
        tradeoff:
          'Acknowledging from memory would shave a few milliseconds, and a crash would then lose edits users believe were saved. Writing first costs one append per operation, which batching across a burst of keystrokes keeps cheap.',
        nodes: ['session', 'oplog'],
        travel: [['session', 'oplog', 'append']],
      },
      {
        title: 'Broadcast to other editors',
        narration:
          'The session sends the versioned operation to every other editor through the gateway. Editor B transforms it against its own unacknowledged edits and applies it, so both copies converge.',
        tradeoff:
          'Sending the whole document after each change would be simple and far too heavy. Sending operations is small and fast, and it requires every client to run the same transform rules as the server, so client and server share one implementation.',
        nodes: ['session', 'gateway', 'bob'],
        travel: [],
      },
      {
        title: 'Cursors on a separate path',
        narration:
          'Cursor positions and who is online go to a presence service in memory, are throttled to a few updates a second, and are never written to the log.',
        tradeoff:
          'Treating cursors as operations would flood the log with data nobody needs tomorrow. Keeping presence ephemeral means a restart forgets it, which is fine because every client re-announces itself within a second.',
        nodes: ['gateway', 'presence'],
        travel: [['gateway', 'presence']],
      },
      {
        title: 'Reconnect and resend',
        narration:
          "If B loses its connection, it reconnects with the last version it saw and resends its unacknowledged operations. The session sends the operations B missed and transforms B's against them. Each operation carries a client id and counter, so a resend is never applied twice.",
        tradeoff:
          "Reloading the whole document on every reconnect is safe and throws away the user's pending edits. Catching up from the log keeps them, at the cost of retaining enough recent operations; past that window the client falls back to a full reload.",
        nodes: ['bob', 'gateway', 'session', 'oplog'],
        travel: [
          ['bob', 'gateway'],
          ['gateway', 'session'],
        ],
      },
      {
        title: 'Compact and publish',
        narration:
          'Every few hundred operations, a background job writes a new snapshot from the log. The log also feeds a change stream for search indexing and version history.',
        tradeoff:
          'Snapshotting inside the session would slow down editing; doing it in the background keeps the hot path short and lets the snapshot lag a little. Consumers read the log asynchronously, so indexing and history never slow down typing.',
        nodes: ['oplog', 'snapshots', 'feed'],
        travel: [
          ['oplog', 'snapshots', 'compact'],
          ['oplog', 'feed'],
        ],
      },
    ],
  },
  deepDives: [
    {
      question: 'Operational transformation or a CRDT?',
      options: [
        {
          name: 'Operational transformation',
          pros: 'Compact operations and documents; a natural fit when a server already orders edits.',
          cons: 'Needs a central order, and the transform rules are tricky to get right.',
        },
        {
          name: 'CRDT',
          pros: 'Converges without a central server, so it suits peer-to-peer and long offline edits.',
          cons: 'Extra metadata for every character and deleted text kept as tombstones.',
        },
      ],
      choice:
        'Operational transformation, because the design already routes each document to one session that can order edits. A CRDT becomes the better fit if long offline editing moves into scope.',
    },
    {
      question: 'How do we route every editor of a document to the same place?',
      options: [
        {
          name: 'Any server, shared state in a database',
          pros: 'Stateless servers that are easy to scale and replace.',
          cons: 'Every operation needs a database round trip or lock to get its order.',
        },
        {
          name: 'Consistent hashing on the document id',
          pros: 'No lookup; every gateway computes the owner.',
          cons: 'Adding or removing servers moves documents mid-session unless handled carefully.',
        },
        {
          name: 'Registry with a lease per document',
          pros: 'Explicit ownership, easy to move a hot document, clean failover when a lease expires.',
          cons: 'One more component, and a short pause while a new owner takes over.',
        },
      ],
      choice:
        'A registry with leases, using a fencing number on every log write so a stale owner cannot append after losing its lease.',
    },
    {
      question: 'What do we store: operations, snapshots or both?',
      options: [
        {
          name: 'Only the latest content',
          pros: 'Smallest storage, trivial to load.',
          cons: 'No history, and reconnecting clients cannot catch up.',
        },
        {
          name: 'Only operations',
          pros: 'Full history and exact replay.',
          cons: 'Loading gets slower as the document ages.',
        },
        {
          name: 'Operations plus periodic snapshots',
          pros: 'Fast loads, catch-up for reconnects and history for restore.',
          cons: 'Two stores to keep consistent, and old operations need a retention policy.',
        },
      ],
      choice:
        'Operations plus periodic snapshots. Recent operations stay for reconnects; older ones are folded into named versions for history and then archived.',
    },
  ],
  wrapUp:
    'Route every editor of a document to one session that orders and transforms operations, save each one before acknowledging it, broadcast it to the others, keep cursors in memory, and load quickly from snapshots plus a short tail of the log.',
};
