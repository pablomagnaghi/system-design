import type { Design } from '../types';

export const chatMessaging: Design = {
  slug: 'chat-messaging',
  title: 'Chat messaging',
  summary:
    'Deliver one-to-one and group messages in real time to millions of connected devices, keep them in order, never lose one when a phone is offline or a server dies, and let every device catch up where it left off.',
  difficulty: 'Hard',
  minutes: 10,
  requirements: {
    functional: [
      'Send messages in one-to-one chats and in groups of up to a few hundred members.',
      'Deliver instantly to online devices, and on reconnect to devices that were offline.',
      'Keep history so a user can scroll back and use several devices.',
      'Show sent, delivered and read status.',
    ],
    nonFunctional: [
      'Delivery to an online recipient in a couple of hundred milliseconds.',
      'No message is lost once the sender sees it as sent; order is preserved within a chat.',
      'Hundreds of millions of users, tens of millions connected at once.',
      'Losing a server only causes a reconnect, never missing messages.',
    ],
    outOfScope: [
      'End-to-end encryption key management (the design carries opaque payloads).',
      'Voice and video calls.',
    ],
  },
  entities: [
    {
      name: 'Conversation',
      description: 'A one-to-one or group chat, with its members and a sequence counter.',
    },
    {
      name: 'Message',
      description:
        'Conversation, sequence number, sender, client message ID, body and a timestamp.',
    },
    { name: 'Device', description: 'A user’s phone or browser, with its last synced cursors.' },
    {
      name: 'Inbox',
      description: 'Per user: which conversations have messages the user has not synced yet.',
    },
  ],
  api: [
    {
      method: 'WS',
      path: 'send { conversationId, clientMessageId, body }',
      description: 'Over the open socket. The server replies with an ack carrying the sequence.',
    },
    {
      method: 'WS',
      path: 'push { message } · ack { conversationId, seq }',
      description: 'Server pushes new messages; the device acks what it has stored.',
    },
    {
      method: 'GET',
      path: '/conversations/{id}/messages?after={seq}',
      description: 'Catch-up and history paging, used on reconnect and when scrolling back.',
    },
  ],
  dataFlow: [
    'Every device keeps a WebSocket open to a chat gateway, which records where the user is connected.',
    'A sent message gets the next sequence number in its conversation and is stored before the sender gets an ack.',
    'The message service marks each member’s inbox and publishes the message on each member’s channel.',
    'Gateways holding those members’ sockets push it; offline members get a push notification and sync on reconnect.',
  ],
  highLevel: {
    label: 'Send a message to a group',
    intro:
      'Follow one message from the sender’s phone, through ordering and storage, to every member of the group, online or not. The design grows as the message service, the store, inboxes, pub/sub and push join, and then a whole zone of gateways fails. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      { id: 'devices', title: 'Devices', detail: 'Phones and browsers', column: 0, row: 'middle' },
      { id: 'lb', title: 'Load balancer', detail: 'Long-lived sockets', column: 1, row: 'middle' },
      {
        id: 'gateway',
        title: 'Chat gateways',
        detail: 'Hold WebSockets',
        column: 2,
        row: 'middle',
      },
      { id: 'presence', title: 'Presence', detail: 'User to gateway', column: 2, row: 'top' },
      {
        id: 'messages',
        title: 'Message service',
        detail: 'Orders and stores',
        column: 3,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'pubsub',
        title: 'Pub/sub',
        detail: 'A channel per user',
        column: 3,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'store',
        title: 'Message store',
        detail: 'By conversation',
        column: 4,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'inbox',
        title: 'Inboxes',
        detail: 'Unsynced chats',
        column: 4,
        row: 'bottom',
        appearsAt: 3,
      },
      {
        id: 'push',
        title: 'Push sender',
        detail: 'Offline devices',
        column: 5,
        row: 'bottom',
        appearsAt: 6,
      },
    ],
    edges: [
      ['devices', 'lb'],
      ['lb', 'gateway'],
      ['gateway', 'presence', 'online'],
      ['gateway', 'messages', 'send'],
      ['messages', 'store', 'append'],
      ['messages', 'inbox'],
      ['messages', 'pubsub', 'publish'],
      ['pubsub', 'gateway', 'deliver'],
      ['inbox', 'push', 'offline'],
    ],
    stages: [
      {
        title: 'Hold a socket open',
        narration:
          'Each device opens a WebSocket through a layer 4 load balancer to one chat gateway. The gateway authenticates it, subscribes to the user’s channel and records the user as online with a heartbeat that expires.',
        tradeoff:
          'A persistent socket lets the server push in milliseconds, where polling would add latency and empty requests. The cost is stateful servers holding about a hundred thousand connections each, which makes deploys and rebalancing harder than for stateless HTTP.',
        nodes: ['devices', 'lb', 'gateway', 'presence'],
        travel: [
          ['devices', 'lb'],
          ['lb', 'gateway'],
          ['gateway', 'presence', 'online'],
        ],
        short: 'Connect',
        metrics: {
          users: '50M',
          requestsPerSecond: '500K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          healthy: '500 / 500',
        },
        load: { lb: 30, gateway: 55, presence: 30 },
        traffic: [{ edge: ['gateway', 'presence'], kind: 'health' }],
      },
      {
        title: 'Send with a client message ID',
        narration:
          'The sender’s app shows the message as pending and sends it with a client message ID it generated. The gateway forwards it to the message service.',
        tradeoff:
          'Networks drop acks, so the app will retry. The client message ID lets the server recognize a retry and return the original result instead of storing a duplicate. It costs a unique key on conversation and client message ID, written atomically with the message, so a retry that arrives hours later is still recognized.',
        nodes: ['devices', 'gateway', 'messages'],
        travel: [['gateway', 'messages', 'send']],
        short: 'Send',
        metrics: {
          users: '50M',
          requestsPerSecond: '500K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          healthy: '500 / 500',
        },
        load: { gateway: 55, messages: 35 },
      },
      {
        title: 'Order and store before acking',
        narration:
          'The message service gives the message the next sequence number in its conversation and appends it to a store partitioned by conversation ID. Only after the write is durable does the sender get an ack, and the pending mark turns into sent.',
        tradeoff:
          'A per-conversation sequence gives one order every member agrees on, without a global clock. It needs one writer per conversation at a time, which can become a hot spot for very busy groups. The store enforces it: the append is a conditional write that succeeds only if the sequence is still the next one, so two servers that both believe they own the conversation cannot both win. Acking only after storage adds a few milliseconds and is what makes "sent" mean "will not be lost".',
        nodes: ['messages', 'store'],
        travel: [['messages', 'store', 'append']],
        short: 'Order + store',
        metrics: {
          users: '50M',
          requestsPerSecond: '500K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          healthy: '500 / 500',
        },
        load: { messages: 40, store: 35 },
      },
      {
        title: 'Mark every member’s inbox',
        narration:
          'For each member, the service records in their inbox that the conversation has a new sequence. This small record is how any device later learns what it missed.',
        tradeoff:
          'Writing one inbox entry per member is fan-out on write: cheap for small groups, heavy for groups of thousands. Capping group size keeps it predictable; very large channels would switch to members pulling from the conversation instead. The append and the fan-out are separate steps, so the append also leaves a pending marker, and a sweeper finishes any fan-out that a crash interrupted.',
        nodes: ['messages', 'inbox'],
        travel: [['messages', 'inbox']],
        short: 'Inboxes',
        metrics: {
          users: '50M',
          requestsPerSecond: '500K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          healthy: '500 / 500',
        },
        load: { messages: 40, inbox: 30 },
      },
      {
        title: 'Publish to each member’s channel',
        narration:
          'The message is published on a pub/sub channel per member. Every gateway subscribes to the channels of the users connected to it, so the message reaches exactly the right gateways.',
        tradeoff:
          'Channels per user mean the message service never needs to know which gateway holds which socket. The cost is a pub/sub layer that must handle tens of millions of subscriptions; a lookup in the presence registry plus a direct call is the alternative, with more coupling.',
        nodes: ['messages', 'pubsub', 'gateway'],
        travel: [
          ['messages', 'pubsub', 'publish'],
          ['pubsub', 'gateway', 'deliver'],
        ],
        short: 'Publish',
        metrics: {
          users: '50M',
          requestsPerSecond: '500K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          healthy: '500 / 500',
        },
        load: { messages: 40, pubsub: 45, gateway: 55 },
      },
      {
        title: 'Push to online devices',
        narration:
          'The gateway writes the message down each recipient socket. The device stores it and acks the highest sequence it holds with no gap before it, which moves its cursor and lets the sender see delivered.',
        tradeoff:
          'Pub/sub is fire and forget, so a message can be lost between the bus and the device. That is acceptable because the store and the inbox are the source of truth: a missed push becomes a gap the device fills on its next sync.',
        nodes: ['gateway', 'devices'],
        travel: [],
        short: 'Deliver',
        metrics: {
          users: '50M',
          requestsPerSecond: '500K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          healthy: '500 / 500',
        },
        load: { gateway: 55 },
      },
      {
        title: 'Notify offline devices',
        narration:
          'If an inbox entry is not acked within a few seconds, or the user has no live socket, a push notification is sent through the phone platform’s push service.',
        tradeoff:
          'Waiting a moment avoids notifying a phone that is about to receive the message over its socket. Platform push is best effort and rate limited, so it only wakes the app; the message itself always comes from our own sync.',
        nodes: ['inbox', 'push'],
        travel: [['inbox', 'push', 'offline']],
        short: 'Notify offline',
        metrics: {
          users: '50M',
          requestsPerSecond: '500K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          healthy: '500 / 500',
        },
        load: { inbox: 30, push: 25 },
      },
      {
        title: 'Catch up on reconnect',
        narration:
          'When a device comes back, it reads its inbox to find conversations with new messages and fetches each one after its last acked sequence.',
        tradeoff:
          'Sequence cursors make catch-up exact on any number of devices: the cursor advances only to the highest sequence with no gap before it, a gap is fetched from the store, and anything at or below the cursor is dropped as a duplicate. The cost is storing a cursor per device per active conversation, and a burst of reads when many phones reconnect at once.',
        nodes: ['devices', 'gateway', 'inbox', 'store'],
        travel: [],
        short: 'Catch up',
        metrics: {
          users: '50M',
          requestsPerSecond: '500K',
          p95Latency: '80 ms',
          errorRate: '0.01%',
          healthy: '500 / 500',
        },
        load: { gateway: 55, inbox: 40, store: 45 },
      },
      {
        title: 'A zone of gateways fails',
        narration:
          'One zone fails and takes fifty of the five hundred gateways with it, so five million sockets drop at once. Every app reconnects immediately, so they all hit the remaining gateways in the same second: handshakes queue, some connections time out and retry, and the retries add to the pile.',
        tradeoff:
          'Spare gateway capacity absorbs a slow trickle of reconnects, not a wall of them arriving together. Running every gateway half empty to survive this would double the fleet, so the fix belongs in how clients come back, not only in how many servers wait for them.',
        nodes: ['devices', 'lb', 'gateway'],
        travel: [
          ['devices', 'lb'],
          ['lb', 'gateway'],
        ],
        short: 'Zone loss',
        metrics: {
          users: '50M',
          requestsPerSecond: '500K',
          p95Latency: '2.5 s',
          errorRate: '4%',
          healthy: '450 / 500',
          alerts: ['p95Latency', 'errorRate', 'healthy'],
        },
        load: { lb: 75, gateway: 96, presence: 60 },
        traffic: [
          { edge: ['lb', 'gateway'], kind: 'failed' },
          { edge: ['devices', 'lb'], kind: 'failed' },
        ],
      },
      {
        title: 'When gateways die',
        narration:
          'Devices reconnect with backoff and jitter, so they spread over a minute instead of a second. Each one lands on another gateway, resubscribes and runs the same catch-up, and replacement gateways start and take their share of new connections.',
        tradeoff:
          'Because no message lives only in a gateway, losing one costs a reconnect and nothing else. Jittered backoff matters: without it, millions of devices reconnecting in the same second can knock over the gateways that are left.',
        nodes: ['devices', 'lb', 'gateway', 'presence'],
        travel: [
          ['devices', 'lb'],
          ['lb', 'gateway'],
        ],
        short: 'Reconnect',
        metrics: {
          users: '50M',
          requestsPerSecond: '500K',
          p95Latency: '90 ms',
          errorRate: '0.05%',
          healthy: '500 / 500',
        },
        load: { lb: 40, gateway: 65, presence: 40, inbox: 45, store: 50 },
      },
    ],
  },
  deepDives: [
    {
      question: 'How does the server push to devices?',
      options: [
        {
          name: 'Short polling',
          pros: 'Plain HTTP, trivial to scale.',
          cons: 'Seconds of latency and most requests come back empty.',
        },
        {
          name: 'Long polling',
          pros: 'Near real time over plain HTTP.',
          cons: 'A new request after every message, and awkward for sending.',
        },
        {
          name: 'WebSockets',
          pros: 'One connection carries both directions with millisecond latency.',
          cons: 'Stateful servers, careful load balancing and draining on deploys.',
        },
      ],
      choice:
        'WebSockets for foreground apps, with platform push notifications to wake backgrounded phones. Long polling stays as a fallback for networks that block sockets.',
    },
    {
      question: 'How do we route a message to the right gateway?',
      options: [
        {
          name: 'Presence lookup and a direct call',
          pros: 'Exact routing; easy to reason about.',
          cons: 'The message service must track gateway addresses and handle stale entries.',
        },
        {
          name: 'Pub/sub channel per user',
          pros: 'Gateways subscribe for their users; senders stay unaware of topology.',
          cons: 'A large subscription count and one more system to operate.',
        },
        {
          name: 'Pin users to gateways by consistent hashing',
          pros: 'No lookup: the user ID gives the gateway.',
          cons: 'Rebalancing moves many sockets, and one user’s devices must share a gateway.',
        },
      ],
      choice:
        'A pub/sub channel per user. It decouples senders from gateways, and since storage is the source of truth, a lost publish only delays a message until the next sync.',
    },
    {
      question: 'How do we keep messages in order?',
      options: [
        {
          name: 'Client timestamps',
          pros: 'Free; no coordination.',
          cons: 'Device clocks drift, so members can see different orders.',
        },
        {
          name: 'Globally unique, time-sortable IDs',
          pros: 'Generated anywhere without coordination.',
          cons: 'Only roughly ordered across servers, and gaps cannot be detected.',
        },
        {
          name: 'Per-conversation sequence numbers',
          pros: 'One order for everyone, and a missing number reveals a gap.',
          cons: 'Each conversation needs a single writer at a time.',
        },
      ],
      choice:
        'Per-conversation sequence numbers, assigned by the service that owns the conversation’s partition and enforced by a conditional write on the next sequence. Gap detection is what makes reconnect sync reliable.',
    },
  ],
  wrapUp:
    'WebSockets to stateful gateways, a per-conversation sequence written durably before the ack, inbox entries plus a pub/sub channel per user for fan-out, push notifications for offline phones, and cursor-based catch-up so a lost push or a dead server never loses a message.',
  guarantees: {
    provides: [
      {
        property: 'Durability',
        promise:
          'A message shown as sent survives the loss of any single node. The ack is returned only after the append is replicated to a quorum of the conversation’s partition; a message still shown as pending carries no promise.',
      },
      {
        property: 'Ordering',
        promise:
          'One total order per conversation, the same for every member and device. Sequence numbers have no gaps and no repeats because the append is a conditional write on the next sequence, checked by the store, not by whichever server believes it owns the conversation.',
      },
      {
        property: 'Send',
        promise:
          'At least once from the client, made harmless by the pair of conversation and client message ID. That pair is a unique key written in the same atomic write as the message, so a retry returns the original sequence however late it arrives.',
      },
      {
        property: 'Delivery to devices',
        promise:
          'At least once, made harmless by the sequence number. Every device of every member eventually holds every message in order: pushes may be lost, repeated or reordered, but the cursor advances only over a run with no gap, gaps are read from the store, and anything at or below the cursor is dropped.',
      },
      {
        property: 'Gateway failure',
        promise:
          'Losing any number of gateways costs reconnects and latency, never messages. Gateways hold sockets and subscriptions only; everything a device needs to resume is its own cursor, the inbox and the store.',
      },
    ],
    assumes: [
      'The message store offers quorum replication and conditional writes that are atomic within one conversation’s partition.',
      'Fan-out is redriven: the append leaves a pending marker, and a sweeper repeats inbox marks and publishes until they are confirmed. Inbox marks keep the highest sequence, so repeats are harmless.',
      'A device stores a message durably before acking it, and keeps a pending message with its client message ID across app restarts until it is acked.',
      'Client message IDs are random and large enough not to collide within a conversation.',
      'Membership changes take a sequence number in the conversation like any message, so who should receive a given message is well defined.',
      'History is kept at least as long as a device may stay offline; a device that returns later than that does a full resync.',
    ],
    doesNotGuarantee: [
      'Delivery time. A couple of hundred milliseconds is an objective for online devices; a lost publish is repaired by sync, seconds later.',
      'That order matches when people pressed send. Order is the order of arrival at the store, so a message from a slow network can land after one typed later.',
      'Any order across conversations, or between a message and its delivered and read marks, which are eventually consistent.',
      'That a platform push notification arrives. It is a best-effort hint to wake the app and never carries the only copy of a message.',
      'Accurate presence. A crashed device or gateway can show a user as online until the heartbeat expires.',
    ],
  },
  failures: [
    {
      scenario:
        'The append commits but the ack never reaches the sender: the socket drops, the message service crashes, or the store’s partition leader fails over and the write times out.',
      impact:
        'The message stays pending on the sender’s screen although it may already be stored and delivered. The sender cannot tell which.',
      detection:
        'Send timeout rate and leader elections per partition on the server; the age of the oldest pending message on the client; the rate of duplicate-key hits on retries.',
      recovery:
        'The app retries with the same client message ID. If the first write committed, the unique key rejects the second and the service returns the original sequence; if it did not, the retry is a normal send. Either way there is one stored message and the sender sees sent.',
    },
    {
      scenario:
        'The message service crashes after the append and before the inbox marks and publishes.',
      impact:
        'The sender has an ack and the message is durable, but no recipient learns of it. Online members see nothing, and offline members get no notification.',
      detection:
        'The age of the oldest pending fan-out marker, alarmed above a few seconds, and a count of markers redriven by the sweeper.',
      recovery:
        'The sweeper reads the message, marks every member’s inbox and publishes again, then clears the marker. A fan-out that was half done is repeated in full: inbox marks keep the highest sequence and devices drop repeats by sequence. Every member ends with the message once.',
    },
    {
      scenario:
        'Two message service instances both act as writer for one conversation, after a rebalance or a long pause.',
      impact:
        'Without a check in the store, both would assign the same sequence to different messages and members would see different histories.',
      detection:
        'The conditional write conflict rate. It is near zero when each conversation is routed to one owner, so a spike points to split ownership.',
      recovery:
        'One conditional write wins and the other is rejected. The loser reloads the latest sequence and retries with the next one, or hands the request to the current owner; the client message ID keeps that retry from storing twice. The log has no repeat and no gap.',
    },
    {
      scenario: 'Pub/sub drops a publish, or a pub/sub node restarts and loses its subscriptions.',
      impact:
        'An online device misses a message. If it is the latest in the conversation, no later sequence arrives to reveal the gap, so the device would stay behind until it reconnects.',
      detection:
        'Inbox entries not acked within a few seconds, tracked as a count and an age; resubscribe events on gateways; gaps counted by devices.',
      recovery:
        'The unacked timer sends the device a sync signal, over its socket if it has one and through platform push otherwise. After a pub/sub restart, gateways resubscribe and tell their devices to check their inboxes. The device reads from its cursor and ends at the latest sequence.',
    },
    {
      scenario: 'A zone is lost and a tenth of the gateways go with it.',
      impact:
        'Millions of sockets drop. Messages for those users queue as unsynced inbox entries, presence shows them online until heartbeats expire, and a reconnect wave threatens the remaining gateways and the store.',
      detection:
        'A step drop in open connections, handshake queue time and failures on the remaining gateways, and the healthy gateway count.',
      recovery:
        'Devices reconnect with jittered backoff, gateways refuse handshakes above a set rate with a retry delay, and catch-up reads are rate limited per device. Stale presence entries expire, and unacked inbox entries trigger notifications in the meantime. Each device syncs from its cursor; no message state was on the lost gateways.',
    },
  ],
  capacity: {
    assumptions: [
      '300M daily users, 50M devices connected at peak, and each user sends about 20 messages a day.',
      'A message goes to 4 other members on average across one-to-one chats and groups, and about 2.5 of their devices are online to receive it.',
      'A stored message is about 300 bytes with metadata; media is stored elsewhere and referenced.',
      'A gateway holds about 100K sockets at about 20 KB of memory each. Peak traffic is twice the daily average.',
    ],
    estimates: [
      {
        label: 'Messages sent',
        value: '~70K/s average, ~140K/s at peak',
        math: '300M users × 20 = 6B messages/day ÷ 86,400 s ≈ 70K/s; × 2 at peak',
      },
      {
        label: 'Traffic through the gateways',
        value: '~500K messages/s at peak',
        math: '140K sends + 140K × 2.5 online deliveries = 140K + 350K ≈ 500K/s, before acks and heartbeats',
      },
      {
        label: 'Fan-out writes',
        value: '~560K inbox marks and publishes/s at peak',
        math: '140K messages/s × 4 members = 560K/s, four times the write rate of the message store',
      },
      {
        label: 'Gateways',
        value: '~500, with about 2 GB of socket state each',
        math: '50M sockets ÷ 100K per gateway = 500; 100K × 20 KB = 2 GB',
      },
      {
        label: 'Reconnects after losing a zone',
        value: '~11K handshakes/s per gateway at once, ~185/s with jitter',
        math: '50 gateways × 100K = 5M sockets ÷ 450 gateways ≈ 11K each if all return in one second; ÷ 60 s ≈ 185/s each',
      },
      {
        label: 'Message storage',
        value: '~1.8 TB a day, ~2 PB a year replicated',
        math: '6B × 300 B = 1.8 TB/day; × 3 replicas = 5.4 TB/day × 365 ≈ 2 PB',
      },
    ],
    implications: [
      'Connections, not requests, size the gateway tier: 500 machines that are mostly idle memory. That is why gateways do nothing but hold sockets, and ordering and storage live in a separate stateless service that can deploy without dropping them.',
      'Each message is written once and fanned out four times, so the inbox store and pub/sub carry the highest rates in the system. An inbox mark must be a single cheap upsert of the latest sequence per user and conversation, never a copy of the message.',
      'A group of a few hundred turns one send into a few hundred marks, about a hundred times the average. That is acceptable only because group size is capped; past that size, members pull.',
      '50M sockets with a 30 s heartbeat would be about 1.7M presence writes a second if each were forwarded, so heartbeats stop at the gateway, which refreshes presence for its users in batches.',
      'A reconnect wave differs by a factor of 60 between everyone at once and jitter over a minute. Client backoff with jitter and handshake rate limits on gateways are part of the capacity plan, not a nicety.',
      'Two petabytes a year means a store partitioned by conversation with old messages on cheaper storage. Reads are by conversation and sequence range, so that key serves both catch-up and scrolling back.',
    ],
  },
  evolution: {
    mvp: 'A few servers that both hold WebSockets and handle messages, and one relational database. The messages table has unique keys on conversation with sequence and on conversation with client message ID, and the sequence is assigned in a transaction that locks the conversation row. Servers relay to each other through a simple pub/sub, and a reconnecting device asks for messages after its cursor in each of its conversations. No inbox, no presence service, no push sender beyond one call to the platform.',
    atScale: [
      'At 10x, deploys hurt first: every release of message logic drops every socket. Split thin gateways from a stateless message service, and add the per-user pub/sub channel so the service does not track gateways.',
      'At 10x, the reconnect query over all of a user’s conversations gets expensive. Materialize it as the inbox, written at send time.',
      'At 100x, one database cannot take the writes. Move messages to a store partitioned by conversation with conditional appends, shard pub/sub by user, and batch presence updates per gateway.',
      'At 100x, failures are routine: add jittered reconnects, handshake rate limits, the fan-out sweeper, and spare gateway capacity for one zone.',
      'Across regions, devices connect to the nearest gateways, and each conversation is sequenced in one home region, so order still comes from a single conditional write.',
    ],
    firstBottleneck:
      'Fan-out, in the inbox store. Sockets scale by adding gateways and appends scale by adding partitions, but every message becomes one write per member, so this path runs at several times the send rate and takes the full weight of large groups. It shows first as a growing age of pending fan-out markers and late notifications, while sends still look healthy.',
    avoided: [
      'A durable ordered log per user between the message service and the gateways. The store and the cursors already make delivery reliable, so the bus can stay lossy and cheap. It is worth adding if repairs by sync become a visible share of traffic.',
      'Consensus across regions for sequencing. A home region per conversation keeps one writer and a simple conditional write; multi-region writes are worth it only if a region outage must not pause sends.',
      'Channels with many thousands of members. They need a pull model without per-member inbox writes, which is a second fan-out path to build and test; add it when the product needs broadcast-style groups.',
      'Per-member read receipts in large groups. They multiply writes by group size again; an aggregate count is enough until users ask for names.',
      'Pinning users to gateways by hashing. It removes the pub/sub layer but ties rebalancing to user identity; it pays off only if the subscription count becomes the limit.',
    ],
  },
};
