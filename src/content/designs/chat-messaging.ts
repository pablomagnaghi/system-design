import type { Design } from '../types';

export const chatMessaging: Design = {
  slug: 'chat-messaging',
  title: 'Chat messaging',
  summary:
    'Deliver one-to-one and group messages in real time to millions of connected devices, keep them in order, never lose one when a phone is offline or a server dies, and let every device catch up where it left off.',
  difficulty: 'Hard',
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
      'Follow one message from the sender’s phone, through ordering and storage, to every member of the group, online or not; then see what happens when a gateway fails. Press play, or step through the stages.',
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
      },
      { id: 'pubsub', title: 'Pub/sub', detail: 'A channel per user', column: 3, row: 'top' },
      {
        id: 'store',
        title: 'Message store',
        detail: 'By conversation',
        column: 4,
        row: 'middle',
      },
      { id: 'inbox', title: 'Inboxes', detail: 'Unsynced chats', column: 4, row: 'bottom' },
      { id: 'push', title: 'Push sender', detail: 'Offline devices', column: 5, row: 'bottom' },
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
          'A persistent socket lets the server push in milliseconds, where polling would add latency and empty requests. The cost is stateful servers holding hundreds of thousands of connections each, which makes deploys and rebalancing harder than for stateless HTTP.',
        nodes: ['devices', 'lb', 'gateway', 'presence'],
        travel: [
          ['devices', 'lb'],
          ['lb', 'gateway'],
          ['gateway', 'presence', 'online'],
        ],
      },
      {
        title: 'Send with a client message ID',
        narration:
          'The sender’s app shows the message as pending and sends it with a client message ID it generated. The gateway forwards it to the message service.',
        tradeoff:
          'Networks drop acks, so the app will retry. The client message ID lets the server recognize a retry and return the original result instead of storing a duplicate. It costs a small dedup check per conversation, kept for a few minutes.',
        nodes: ['devices', 'gateway', 'messages'],
        travel: [['gateway', 'messages', 'send']],
      },
      {
        title: 'Order and store before acking',
        narration:
          'The message service gives the message the next sequence number in its conversation and appends it to a store partitioned by conversation ID. Only after the write is durable does the sender get an ack, and the pending mark turns into sent.',
        tradeoff:
          'A per-conversation sequence gives one order every member agrees on, without a global clock. It needs a single writer per conversation, which can become a hot spot for very busy groups. Acking only after storage adds a few milliseconds and is what makes "sent" mean "will not be lost".',
        nodes: ['messages', 'store'],
        travel: [['messages', 'store', 'append']],
      },
      {
        title: 'Mark every member’s inbox',
        narration:
          'For each member, the service records in their inbox that the conversation has a new sequence. This small record is how any device later learns what it missed.',
        tradeoff:
          'Writing one inbox entry per member is fan-out on write: cheap for small groups, heavy for groups of thousands. Capping group size keeps it predictable; very large channels would switch to members pulling from the conversation instead.',
        nodes: ['messages', 'inbox'],
        travel: [['messages', 'inbox']],
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
      },
      {
        title: 'Push to online devices',
        narration:
          'The gateway writes the message down each recipient socket. The device stores it and acks the sequence, which moves its cursor and lets the sender see delivered.',
        tradeoff:
          'Pub/sub is fire and forget, so a message can be lost between the bus and the device. That is acceptable because the store and the inbox are the source of truth: a missed push becomes a gap the device fills on its next sync.',
        nodes: ['gateway', 'devices'],
        travel: [],
      },
      {
        title: 'Notify offline devices',
        narration:
          'If an inbox entry is not acked within a few seconds, or the user has no live socket, a push notification is sent through the phone platform’s push service.',
        tradeoff:
          'Waiting a moment avoids notifying a phone that is about to receive the message over its socket. Platform push is best effort and rate limited, so it only wakes the app; the message itself always comes from our own sync.',
        nodes: ['inbox', 'push'],
        travel: [['inbox', 'push', 'offline']],
      },
      {
        title: 'Catch up on reconnect',
        narration:
          'When a device comes back, it reads its inbox to find conversations with new messages and fetches each one after its last acked sequence.',
        tradeoff:
          'Sequence cursors make catch-up exact: no gaps and no duplicates, on any number of devices. The cost is storing a cursor per device per active conversation, and a burst of reads when many phones reconnect at once.',
        nodes: ['devices', 'gateway', 'inbox', 'store'],
        travel: [],
      },
      {
        title: 'When a gateway dies',
        narration:
          'The sockets on a failed gateway drop. Devices reconnect with backoff and jitter to another gateway, resubscribe and run the same catch-up.',
        tradeoff:
          'Because no message lives only in a gateway, losing one costs a reconnect and nothing else. Jittered backoff matters: without it, a hundred thousand devices reconnecting in the same second can knock over the next gateway.',
        nodes: ['devices', 'lb', 'gateway', 'presence'],
        travel: [
          ['devices', 'lb'],
          ['lb', 'gateway'],
        ],
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
        'Per-conversation sequence numbers, assigned by the service that owns the conversation’s partition. Gap detection is what makes reconnect sync reliable.',
    },
  ],
  wrapUp:
    'WebSockets to stateful gateways, a per-conversation sequence written durably before the ack, inbox entries plus a pub/sub channel per user for fan-out, push notifications for offline phones, and cursor-based catch-up so a lost push or a dead server never loses a message.',
};
