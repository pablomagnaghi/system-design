import type { FieldNote } from '../types';

export const figmaMultiplayer: FieldNote = {
  slug: 'figma-multiplayer',
  company: 'Figma',
  title: 'Multiplayer editing without operational transforms',
  summary:
    'Figma lets many people edit one design file live. Instead of operational transforms, it uses a central server per document and simple rules borrowed from CRDTs: the last write wins per property, and children are ordered by fractions.',
  minutes: 8,
  source: {
    title: "How Figma's multiplayer technology works",
    url: 'https://www.figma.com/blog/how-figmas-multiplayer-technology-works/',
    year: 2019,
  },
  context: [
    'Figma wanted every editor of a file to see the same design, live, without exporting or emailing copies. The usual answer for live editing was operational transforms, the approach behind collaborative text editors. The team judged it too complex for their case: it is hard to reason about when edits arrive in different orders, and its power is aimed at long text, which a design file is not.',
    'A design file is a tree of objects such as pages, frames and shapes, each with properties like position, color or name. Two people often change the same file at the same time, sometimes the same object. The system has to keep every client converging on one state, stay responsive while edits are in flight, and still work for a client that went offline for a while.',
    'The post gives no traffic or latency figures, so this note tells the story through the rules that appear one by one rather than through numbers.',
  ],
  walkthrough: {
    label: 'Two clients editing one file',
    intro:
      'Follow two clients editing the same file and see each rule join the design as a conflict shows up. The post gives no traffic or latency numbers, so no metrics are shown; load bars are approximate. Press play, or step through the stages.',
    nodes: [
      {
        id: 'pending',
        title: 'Unacked edits',
        detail: "A's changes in flight",
        column: 0,
        row: 'top',
        appearsAt: 4,
      },
      { id: 'a', title: 'Client A', detail: 'Browser, WebSocket', column: 0, row: 'middle' },
      {
        id: 'ids',
        title: 'Object IDs',
        detail: 'Client ID inside each ID',
        column: 0,
        row: 'bottom',
        appearsAt: 5,
      },
      {
        id: 'props',
        title: 'Property map',
        detail: 'Object, property, value',
        column: 2,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'server',
        title: 'Document server',
        detail: 'One process per file',
        column: 2,
        row: 'middle',
      },
      {
        id: 'tree',
        title: 'Parent + position',
        detail: 'One property, a fraction',
        column: 2,
        row: 'bottom',
        appearsAt: 6,
      },
      { id: 'b', title: 'Client B', detail: 'Browser, WebSocket', column: 4, row: 'middle' },
      {
        id: 'undo',
        title: 'Undo history',
        detail: 'Kept on each client',
        column: 4,
        row: 'bottom',
        appearsAt: 9,
      },
    ],
    edges: [
      ['a', 'server', 'edit'],
      ['server', 'b', 'broadcast'],
      ['b', 'server', 'edit'],
      ['server', 'a', 'broadcast'],
      ['server', 'props', 'latest value'],
      ['a', 'pending'],
      ['a', 'ids'],
      ['server', 'tree'],
      ['b', 'undo'],
    ],
    stages: [
      {
        title: 'One server owns each file',
        narration:
          'Each client downloads a copy of the file and opens a WebSocket to the server process for that document. Every editor of the file talks to the same process, which holds the authoritative state and forwards each change to the others.',
        tradeoff:
          'A single authority per document makes ordering trivial: whatever the server applied is the truth. The cost is that every edit takes a round trip through one process, and that process has to be placed, kept alive and recovered on failure.',
        nodes: ['a', 'server', 'b'],
        travel: [
          ['a', 'server', 'edit'],
          ['server', 'b', 'broadcast'],
        ],
        short: 'Authority',
        load: { server: 20 },
      },
      {
        title: 'Simpler than transforms',
        narration:
          'Both clients edit at the same moment. Operational transforms would rewrite each edit against the other so both can apply, which gets complicated fast. Figma borrows ideas from CRDTs instead, data structures that merge concurrent edits automatically, but drops their decentralized machinery because its server already decides the order.',
        tradeoff:
          'Leaning on a central server lets Figma keep only the cheap parts of CRDTs and skip the overhead they need without one. In return it gives up peer-to-peer editing and rich merging of concurrent text, which a design tool rarely needs.',
        nodes: ['a', 'server', 'b'],
        travel: [
          ['a', 'server', 'edit'],
          ['b', 'server', 'edit'],
        ],
        short: 'Not OT',
        load: { server: 30 },
      },
      {
        title: 'The file as a property map',
        narration:
          'The server sees the document as a map from object ID to a map from property to value. For each property of each object it keeps the latest value any client sent. A new feature usually means a new property, not a new kind of operation.',
        tradeoff:
          'A flat table of object, property and value is easy to sync and easy to extend. It treats every value as a unit, so the structure only works because most design edits replace a whole value, like a color or a position.',
        nodes: ['server', 'props'],
        travel: [
          ['a', 'server', 'edit'],
          ['server', 'props', 'latest value'],
        ],
        short: 'Property map',
        load: { server: 30, props: 20 },
      },
      {
        title: 'Same property: last write wins',
        narration:
          'A and B change the same property of the same shape. The server keeps the value it received last and sends it to everyone, so A sees its own change replaced. Edits to different properties, or to different objects, never conflict at all.',
        tradeoff:
          'Last writer wins per property is cheap and always converges. The price is that two edits to one value are never merged: if two people rename the same layer at once, one name survives whole and the other is lost.',
        nodes: ['a', 'server', 'b', 'props'],
        travel: [
          ['a', 'server', 'edit'],
          ['b', 'server', 'edit'],
          ['server', 'props', 'latest value'],
          ['server', 'a', 'broadcast'],
        ],
        short: 'Last write wins',
        load: { server: 40, props: 30 },
        traffic: [{ edge: ['a', 'server'], kind: 'failed' }],
      },
      {
        title: 'Ignore stale echoes',
        narration:
          'A client applies its own edits at once so the editor feels instant. While an edit is unacknowledged, an older value from the server could arrive and briefly paint over it. So the client drops incoming updates to any property it has changed and not yet heard back about.',
        tradeoff:
          "The client's pending value is its best guess of the final state, so dropping conflicting echoes removes flicker at no cost to convergence: the server's answer arrives right after. The client has to track which properties are in flight, which adds a little bookkeeping.",
        nodes: ['a', 'pending', 'server'],
        travel: [
          ['a', 'pending'],
          ['a', 'server', 'edit'],
          ['server', 'a', 'broadcast'],
        ],
        short: 'No flicker',
        load: { server: 35, props: 25 },
        traffic: [{ edge: ['server', 'a'], kind: 'failed' }],
      },
      {
        title: 'Create objects offline',
        narration:
          'Creating a shape has to work without the server, so the server cannot hand out IDs. Each client has its own client ID and puts it inside the IDs of objects it creates, so two clients can never pick the same one. Creating and deleting are explicit; a deleted object is erased on the server and kept only in the undo buffer of the client that deleted it.',
        tradeoff:
          'Client-made IDs remove a round trip and make offline creation possible. Erasing deleted objects keeps long-lived files from growing on the server, but restoring one depends on the deleting client still holding it in its undo buffer.',
        nodes: ['a', 'ids', 'server'],
        travel: [
          ['a', 'ids'],
          ['a', 'server', 'edit'],
          ['server', 'b', 'broadcast'],
        ],
        short: 'Unique IDs',
        load: { server: 35, props: 30 },
      },
      {
        title: 'Move objects with a parent link',
        narration:
          'Each child stores a link to its parent as an ordinary property, so moving an object is just a property change. Two concurrent moves of one object resolve like any other property and never leave two copies. If two moves would form a cycle, the server rejects the one that closes it.',
        tradeoff:
          'Storing the parent on the child keeps moves from clashing with other edits and keeps object identity stable. A client that has not heard the rejection yet briefly hides the objects caught in the cycle until the server answer puts them back, a rare glitch the team accepted.',
        nodes: ['a', 'server', 'b', 'tree'],
        travel: [
          ['a', 'server', 'edit'],
          ['b', 'server', 'edit'],
          ['server', 'tree'],
        ],
        short: 'Reparenting',
        load: { server: 40, props: 30, tree: 30 },
        traffic: [{ edge: ['b', 'server'], kind: 'failed' }],
      },
      {
        title: 'Order siblings with fractions',
        narration:
          'Each object has a position among its siblings, a fraction strictly between 0 and 1, and siblings sort by it. To place an object between two others, the client picks a value between theirs, such as their average. Parent and position live in one property, so a move updates both at once.',
        tradeoff:
          'Fractional positions let an insert touch only the moved object, with no renumbering of its siblings. Positions need more precision each time objects keep landing in the same gap, so the representation has to allow very fine fractions.',
        nodes: ['a', 'server', 'tree'],
        travel: [
          ['a', 'server', 'edit'],
          ['server', 'tree'],
          ['server', 'b', 'broadcast'],
        ],
        short: 'Fractions',
        load: { server: 35, props: 30, tree: 35 },
      },
      {
        title: 'Reconnect after going offline',
        narration:
          'A client that lost its connection downloads a fresh copy of the file, reapplies the edits it made offline on top, and opens a new WebSocket. From then on its changes flow like those of any other client.',
        tradeoff:
          'Starting from a fresh copy keeps reconnection simple and reuses the same rules as live editing. Offline edits that touch properties others changed meanwhile still go through last writer wins, so some offline work can lose to newer edits from others.',
        nodes: ['a', 'server', 'pending'],
        travel: [
          ['server', 'a', 'broadcast'],
          ['a', 'server', 'edit'],
        ],
        short: 'Offline',
        load: { server: 40, props: 30, tree: 30 },
        traffic: [{ edge: ['server', 'a'], kind: 'heavy' }],
      },
      {
        title: 'Undo that respects others',
        narration:
          'Undo is per client. When B undoes, the redo entry records the current values at that moment, and a redo records the undo entry the same way. The rule the team set is that undoing a lot, copying something and redoing back should leave the file unchanged.',
        tradeoff:
          'Recording history at the moment of undo or redo keeps a redo from wiping out what others changed in between. The cost is a less obvious model than single-player undo, and the history lives only on the client that made the edits.',
        nodes: ['b', 'undo', 'server'],
        travel: [
          ['b', 'undo'],
          ['b', 'server', 'edit'],
          ['server', 'a', 'broadcast'],
        ],
        short: 'Undo',
        load: { server: 30, props: 30, tree: 30 },
      },
    ],
  },
  tradeoffs: [
    'Edits to one value are never merged: concurrent changes to the same property keep only one, so fine-grained text collaboration is out of scope.',
    'Every document depends on one server process for ordering, which has to be placed, kept alive and recovered.',
    'Rare edge cases are accepted rather than solved, such as objects that briefly disappear when two moves would form a cycle.',
    'Comments, users and projects live in a separate system on Postgres, so the product runs two sync paths with different rules.',
  ],
  takeaways: [
    'If you have a central server, you do not need full CRDTs or operational transforms: let the server order edits and keep the simple merge rules.',
    'Model the document as object, property and value, and resolve conflicts per property with last writer wins.',
    'Let clients create IDs that embed a client ID, so creation works offline and never collides.',
    'Store order as fractions between neighbors, so an insert or move changes only the moved item.',
  ],
  related: ['collaborative-editor', 'file-sync'],
};
