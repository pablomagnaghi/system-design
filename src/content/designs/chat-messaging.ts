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
      'Edit or delete a sent message everywhere it was delivered.',
      'Add and remove group members, and show who is typing and who is online.',
    ],
    nonFunctional: [
      'Delivery to an online recipient in a couple of hundred milliseconds.',
      'No message is lost once the sender sees it as sent; order is preserved within a chat.',
      'Hundreds of millions of users, tens of millions connected at once.',
      'Losing a server only causes a reconnect, never missing messages.',
      'Only members of a conversation can send to it, read it or receive it; every connection is authenticated and encrypted in transit.',
    ],
    outOfScope: [
      'End-to-end encryption key management (the design carries opaque payloads).',
      'Voice and video calls.',
      'Full-text search over message history in the first version (see the deep dive on adding it).',
      'Broadcast channels with many thousands of members in the first version (see the deep dive on adding them).',
      'Spam and abuse classification beyond rate limits and size caps.',
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
          'Each device opens a WebSocket over TLS through a layer 4 load balancer to one chat gateway, one of our own servers that holds sockets. The load balancer only spreads connections and drops unhealthy gateways. The gateway checks a short-lived access token, subscribes to the user’s channel and records the user as online with a heartbeat that expires.',
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
          'The message service checks that the sender is a member of the conversation, gives the message the next sequence number and appends it to a store partitioned by conversation ID. Only after the write is durable does the sender get an ack, and the pending mark turns into sent.',
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
          'Writing one inbox entry per member is fan-out on write: cheap for small groups, heavy for groups of thousands. Capping group size keeps it predictable; very large channels would switch to members pulling from the conversation instead. The append and the fan-out are separate steps, so the append writes a pending fan-out marker in the same atomic write as the message, an outbox, and a sweeper finishes any fan-out that a crash interrupted.',
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
          'Pub/sub is fire and forget, so a message can be lost between the bus and the device. That is acceptable because the store and the inbox are the source of truth. A missed push in the middle shows up as a gap when the next message arrives; a missed last message leaves no gap, so an inbox entry still unacked after a few seconds sends the device a sync signal and it reads from its cursor.',
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
          'One of the five zones fails and takes a hundred of the five hundred gateways with it, so ten million sockets drop at once. Every app reconnects immediately, so they all hit the remaining gateways in the same second: handshakes queue, some connections time out and retry, and the retries add to the pile.',
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
          healthy: '400 / 500',
          alerts: ['p95Latency', 'errorRate', 'healthy'],
        },
        load: { lb: 75, gateway: 96, presence: 60 },
        traffic: [
          { edge: ['lb', 'gateway'], kind: 'failed' },
          { edge: ['devices', 'lb'], kind: 'failed' },
        ],
      },
      {
        title: 'Reconnect with jitter',
        narration:
          'Devices reconnect with backoff and jitter, so they spread over a minute instead of a second, and gateways refuse handshakes above a set rate with a retry delay. Each device lands on another gateway, resubscribes and runs the same catch-up, rate limited per device so the store is not flooded. Replacement gateways start in the other zones over the next minutes.',
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
          healthy: '400 / 500',
        },
        load: { lb: 40, gateway: 65, presence: 40, inbox: 45, store: 50 },
      },
    ],
  },
  flows: [
    {
      id: 'connect',
      title: 'Connect',
      kind: 'sync',
      summary:
        'Alice opens the app. Her phone holds one WebSocket to one gateway for as long as the app is in the foreground.',
      runsOn: 'NLB → Gateway on EC2 → Cognito token check → Redis',
      participants: [
        { id: 'app', label: 'Alice’s phone', service: 'App' },
        { id: 'nlb', label: 'Load balancer', service: 'NLB, layer 4' },
        { id: 'gw', label: 'Gateway', service: 'EC2' },
        { id: 'redis', label: 'Pub/sub', service: 'ElastiCache Redis' },
      ],
      steps: [
        {
          from: 'app',
          to: 'nlb',
          label: 'WebSocket over TLS',
          note: 'The app connects to one address. The load balancer only picks a healthy gateway and forwards the TCP connection; it never reads messages.',
        },
        {
          from: 'nlb',
          to: 'gw',
          label: 'TCP connection',
          note: 'TLS ends on the gateway, one of our own servers. It is not Amazon API Gateway, which would charge per message and close sockets after two hours.',
        },
        {
          from: 'gw',
          to: 'gw',
          label: 'verify access token',
          note: 'The gateway checks a short-lived token issued by Cognito, so a stolen token expires within minutes.',
        },
        {
          from: 'gw',
          to: 'redis',
          label: 'SUBSCRIBE user:alice',
          note: 'From now on, anything published on Alice’s channel reaches this gateway, wherever the sender is.',
        },
        {
          from: 'gw',
          to: 'redis',
          label: 'presence, batched',
          note: 'Alice is marked online with a TTL. Heartbeats stop at the gateway, which refreshes presence for all its users in one batch.',
          style: 'async',
        },
        {
          from: 'gw',
          to: 'app',
          label: 'connected',
          note: 'The socket stays open. Everything that follows travels over it in both directions.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'send',
      title: 'Send a message',
      kind: 'sync',
      summary:
        'Alice sends "Dinner?". This is the only path the user waits on, so it is short: check, sequence, one transaction, ack.',
      runsOn: 'Gateway on EC2 → Message service on ECS Fargate → DynamoDB transaction',
      participants: [
        { id: 'app', label: 'Alice’s phone', service: 'App' },
        { id: 'gw', label: 'Gateway', service: 'EC2' },
        { id: 'msg', label: 'Message service', service: 'ECS Fargate' },
        { id: 'db', label: 'Message store', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'gw',
          label: 'send {clientMsgId: a7f3}',
          note: 'The app shows the message as pending and sends it with an ID it generated. A retry will reuse the same ID.',
        },
        {
          from: 'gw',
          to: 'msg',
          label: 'forward',
          note: 'The gateway decides nothing; it hands the message to the stateless service that owns ordering.',
        },
        {
          from: 'msg',
          to: 'msg',
          label: 'member? next seq = 42',
          note: 'The service checks that Alice is a member of the conversation and takes the next sequence number.',
        },
        {
          from: 'msg',
          to: 'db',
          label: 'TransactWriteItems',
          note: 'One transaction writes the message only if sequence 42 does not exist yet, the unique client message ID, and a pending fan-out marker. All three or none.',
        },
        {
          from: 'db',
          to: 'msg',
          label: 'committed in 3 zones',
          note: 'The write is durable. If two servers raced for 42, only one transaction committed; the other rereads and retries as 43.',
          style: 'reply',
        },
        {
          from: 'msg',
          to: 'app',
          label: 'ack {seq: 42}',
          note: 'Only now Alice sees sent. If this ack is lost, the app retries with a7f3 and gets 42 back instead of a duplicate.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'fan-out',
      title: 'Fan-out',
      kind: 'async',
      summary:
        'Right after the ack, the same service tells every member. Nobody waits on this part, and every step can be repeated safely.',
      runsOn: 'Message service on ECS → DynamoDB inboxes → Redis → Bob’s gateway',
      participants: [
        { id: 'msg', label: 'Message service', service: 'ECS Fargate' },
        { id: 'inbox', label: 'Inboxes', service: 'DynamoDB' },
        { id: 'redis', label: 'Pub/sub', service: 'ElastiCache Redis' },
        { id: 'gw', label: 'Bob’s gateway', service: 'EC2' },
        { id: 'bob', label: 'Bob’s phone', service: 'App' },
      ],
      steps: [
        {
          from: 'msg',
          to: 'inbox',
          label: 'upsert (bob, conv) = 42',
          note: 'One small row per member says the conversation has a new sequence. It is not a copy of the message, and repeating it is harmless.',
          style: 'async',
        },
        {
          from: 'msg',
          to: 'redis',
          label: 'PUBLISH user:bob',
          note: 'The service publishes on Bob’s channel without knowing which gateway holds his socket.',
          style: 'async',
        },
        {
          from: 'redis',
          to: 'gw',
          label: 'deliver',
          note: 'Only the gateway subscribed to user:bob receives it. Pub/sub is fire and forget; the store and inbox stay the source of truth.',
          style: 'async',
        },
        {
          from: 'gw',
          to: 'bob',
          label: 'push {seq: 42}',
          note: 'The gateway writes the message down Bob’s socket, about a hundred milliseconds after Alice pressed send.',
        },
        {
          from: 'bob',
          to: 'gw',
          label: 'ack 42',
          note: 'Bob’s phone stores it and acks the highest sequence with no gap before it. That moves his cursor.',
          style: 'reply',
        },
        {
          from: 'msg',
          to: 'msg',
          label: 'clear outbox marker',
          note: 'With the fan-out done, the pending marker is removed. If the service had crashed before this, the sweeper would finish the job.',
        },
      ],
    },
    {
      id: 'sweeper',
      title: 'Repair a cut fan-out',
      kind: 'scheduled',
      summary:
        'The message service crashed after the ack and before the fan-out. A scheduled worker finds the marker and finishes it.',
      runsOn: 'Sweeper task on ECS → DynamoDB sparse index → inboxes and Redis',
      participants: [
        { id: 'fn', label: 'Sweeper', service: 'ECS task' },
        { id: 'db', label: 'Store and inboxes', service: 'DynamoDB' },
        { id: 'redis', label: 'Pub/sub', service: 'ElastiCache Redis' },
      ],
      steps: [
        {
          from: 'fn',
          to: 'fn',
          label: 'every few seconds',
          note: 'A small always-on task wakes up every few seconds. A scheduled rule could not do this: EventBridge schedules run at most once a minute.',
        },
        {
          from: 'fn',
          to: 'db',
          label: 'query pending markers',
          note: 'Pending markers sit in a sparse index, so the query reads only unfinished fan-outs, older than a few seconds.',
        },
        {
          from: 'db',
          to: 'fn',
          label: 'seq 42, conv alice-bob',
          note: 'The marker written in the same transaction as the message proves the fan-out never finished.',
          style: 'reply',
        },
        {
          from: 'fn',
          to: 'db',
          label: 'upsert inboxes again',
          note: 'The whole fan-out is repeated. Inbox marks keep the highest sequence, so members already marked see no change.',
        },
        {
          from: 'fn',
          to: 'redis',
          label: 'PUBLISH again',
          note: 'Devices that already hold 42 drop the repeat by sequence; the rest receive it now.',
          style: 'async',
        },
        {
          from: 'fn',
          to: 'db',
          label: 'clear marker',
          note: 'The alarm on the oldest marker’s age goes quiet. This age is also the first sign of the fan-out bottleneck.',
        },
      ],
    },
    {
      id: 'push',
      title: 'Notify an offline phone',
      kind: 'queue',
      summary:
        'Bob’s phone has no socket, or did not ack within a few seconds. A queue and a worker send a push that only wakes the app.',
      runsOn: 'Message service → SQS → push worker on ECS → APNs or FCM',
      participants: [
        { id: 'msg', label: 'Message service', service: 'ECS Fargate' },
        { id: 'sqs', label: 'Push queue', service: 'SQS' },
        { id: 'worker', label: 'Push worker', service: 'ECS' },
        { id: 'apns', label: 'Phone platform', service: 'APNs / FCM' },
        { id: 'bob', label: 'Bob’s phone', service: 'App' },
      ],
      steps: [
        {
          from: 'msg',
          to: 'sqs',
          label: 'inbox unacked after N s',
          note: 'Waiting a moment avoids notifying a phone that was about to receive the message over its socket.',
          style: 'async',
        },
        {
          from: 'sqs',
          to: 'worker',
          label: 'poll',
          note: 'The queue absorbs bursts and retries, so slow or rate-limited platform calls never block sending.',
        },
        {
          from: 'worker',
          to: 'apns',
          label: 'push "New message"',
          note: 'The push carries a hint, not the only copy of the message. Platforms are best effort and may drop it.',
        },
        {
          from: 'apns',
          to: 'bob',
          label: 'wake the app',
          note: 'The phone wakes up, connects, and runs the normal catch-up. The message itself always comes from our store.',
          style: 'async',
        },
      ],
    },
    {
      id: 'receipts',
      title: 'Delivered and read',
      kind: 'async',
      summary:
        'Receipts are cursors per member, not a row per message, so one update covers every earlier message.',
      runsOn: 'Gateway → Message service → DynamoDB cursors, batched → Alice’s gateway',
      participants: [
        { id: 'bob', label: 'Bob’s phone', service: 'App' },
        { id: 'gw', label: 'Gateway', service: 'EC2' },
        { id: 'msg', label: 'Message service', service: 'ECS Fargate' },
        { id: 'db', label: 'Cursors', service: 'DynamoDB' },
        { id: 'alice', label: 'Alice’s phone', service: 'App' },
      ],
      steps: [
        {
          from: 'bob',
          to: 'gw',
          label: 'ack 42 · read 42',
          note: 'The delivered cursor moves when a device stores the message, and the read cursor when Bob opens the chat.',
        },
        {
          from: 'gw',
          to: 'msg',
          label: 'cursor updates',
          note: 'The gateway forwards the cursor positions, not one event per message.',
          style: 'async',
        },
        {
          from: 'msg',
          to: 'db',
          label: 'batched every few seconds',
          note: 'Batching keeps busy groups from turning into receipt storms. Receipts are eventually consistent on purpose.',
          style: 'async',
        },
        {
          from: 'msg',
          to: 'alice',
          label: 'delivered ✓✓ · read',
          note: 'Every message at or below Bob’s cursor shows delivered or read for Alice. Large groups show counts, and names on request.',
          style: 'async',
        },
      ],
    },
    {
      id: 'catch-up',
      title: 'Catch up on reconnect',
      kind: 'sync',
      summary:
        'Bob’s laptop was off. When it connects, it asks what changed and fetches exactly what it is missing.',
      runsOn: 'Gateway → Message service → DynamoDB inbox read and range query',
      participants: [
        { id: 'laptop', label: 'Bob’s laptop', service: 'App, cursor 41' },
        { id: 'gw', label: 'Gateway', service: 'EC2' },
        { id: 'msg', label: 'Message service', service: 'ECS Fargate' },
        { id: 'db', label: 'Inbox and store', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'laptop',
          to: 'gw',
          label: 'connect, then sync',
          note: 'The laptop connects like any device, with jittered backoff if many reconnect at once.',
        },
        {
          from: 'gw',
          to: 'msg',
          label: 'read Bob’s inbox',
          note: 'The inbox lists conversations with new sequences: alice-bob is at 42.',
        },
        {
          from: 'msg',
          to: 'db',
          label: 'Query conv, seq > 41',
          note: 'Partition key conversation and sort key sequence make this one range read. The same key serves scrolling back.',
        },
        {
          from: 'db',
          to: 'laptop',
          label: 'messages 42',
          note: 'Anything at or below the cursor is dropped as a duplicate, and a gap would be fetched the same way.',
          style: 'reply',
        },
        {
          from: 'laptop',
          to: 'gw',
          label: 'ack 42',
          note: 'The laptop’s cursor moves to 42. It is now exactly as up to date as Bob’s phone.',
        },
      ],
    },
    {
      id: 'typing',
      title: 'Typing indicator',
      kind: 'direct',
      summary:
        'Typing is a hint that is stale in seconds, so it skips the message service and is never stored.',
      runsOn: 'Gateway → Redis → the other gateway, no store',
      participants: [
        { id: 'alice', label: 'Alice’s phone', service: 'App' },
        { id: 'gw1', label: 'Alice’s gateway', service: 'EC2' },
        { id: 'redis', label: 'Pub/sub', service: 'ElastiCache Redis' },
        { id: 'gw2', label: 'Bob’s gateway', service: 'EC2' },
        { id: 'bob', label: 'Bob’s phone', service: 'App' },
      ],
      steps: [
        {
          from: 'alice',
          to: 'gw1',
          label: 'typing {conv}',
          note: 'The app sends at most one typing event every few seconds per conversation.',
          style: 'async',
        },
        {
          from: 'gw1',
          to: 'redis',
          label: 'PUBLISH user:bob',
          note: 'No sequence, no store, no inbox. Under load these are the first events dropped.',
          style: 'async',
        },
        {
          from: 'redis',
          to: 'gw2',
          label: 'deliver',
          note: 'If this is lost, nothing is repaired: the next typing event replaces it.',
          style: 'async',
        },
        {
          from: 'gw2',
          to: 'bob',
          label: '“Alice is typing…”',
          note: 'The indicator expires on its own after a few seconds unless a new event arrives.',
          style: 'async',
        },
      ],
    },
    {
      id: 'media',
      title: 'Send a photo',
      kind: 'direct',
      summary:
        'The file never passes through our servers. The message carries only the object key.',
      runsOn: 'Message service signs → S3 upload → normal send → CloudFront download',
      participants: [
        { id: 'alice', label: 'Alice’s phone', service: 'App' },
        { id: 'msg', label: 'Message service', service: 'ECS Fargate' },
        { id: 's3', label: 'Media', service: 'S3' },
        { id: 'cdn', label: 'Edge', service: 'CloudFront' },
        { id: 'bob', label: 'Bob’s phone', service: 'App' },
      ],
      steps: [
        {
          from: 'alice',
          to: 'msg',
          label: 'request upload URL',
          note: 'The service checks that Alice is a member of the conversation before it signs anything.',
        },
        {
          from: 'msg',
          to: 'alice',
          label: 'presigned URL',
          note: 'A URL valid for a few minutes and for one object key, so the phone can upload without AWS credentials.',
          style: 'reply',
        },
        {
          from: 'alice',
          to: 's3',
          label: 'PUT photo',
          note: 'The phone uploads straight to S3, so gateways and the message service never carry megabytes.',
        },
        {
          from: 'alice',
          to: 'msg',
          label: 'send {s3Key}',
          note: 'A normal send with the key instead of the bytes: it gets a sequence, is stored before the ack, and Alice sees sent.',
        },
        {
          from: 'msg',
          to: 'bob',
          label: 'push {seq, s3Key}',
          note: 'The usual fan-out, through Bob’s inbox, pub/sub and his gateway. Bob’s phone now knows a photo exists.',
          style: 'async',
        },
        {
          from: 'bob',
          to: 'cdn',
          label: 'GET via signed URL',
          note: 'Bob’s phone asks the nearest CloudFront edge. A signed URL keeps the photo private to members.',
        },
        {
          from: 'cdn',
          to: 's3',
          label: 'fetch on a cache miss',
          note: 'Only the first request at an edge reaches S3; later ones are served from the edge cache.',
        },
        {
          from: 's3',
          to: 'cdn',
          label: 'photo',
          note: 'S3 returns the object once, and the edge keeps a copy.',
          style: 'reply',
        },
        {
          from: 'cdn',
          to: 'bob',
          label: 'photo',
          note: 'Bob sees the photo. Thumbnails can be generated after upload the same way, as separate objects.',
          style: 'reply',
        },
      ],
    },
  ],
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
        'A pub/sub channel per user. It decouples senders from gateways, and since storage is the source of truth, a lost publish only delays a message until its unacked inbox entry triggers a sync, a few seconds later.',
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
    {
      question: 'How do we show delivered and read?',
      options: [
        {
          name: 'A receipt row per member per message',
          pros: 'Exact status for every person on every message.',
          cons: 'Multiplies writes by group size again, and busy groups produce receipt storms.',
        },
        {
          name: 'Cursors per member',
          pros: 'One small update per member covers every earlier message; the delivered cursor already exists for sync.',
          cons: 'Showing names in a large group means reading every member’s cursor.',
        },
        {
          name: 'Aggregate counts only',
          pros: 'Cheapest: one counter per message.',
          cons: 'Can never answer who has read a message.',
        },
      ],
      choice:
        'Cursors per member. A delivered cursor is the highest sequence any of the member’s devices acked, and a read cursor is the highest sequence the member opened; a message is delivered or read for that member once the cursor passes it. Cursor updates are batched every few seconds and are eventually consistent. In large groups the sender sees counts, and names only on request.',
    },
    {
      question: 'How do edits and deletes work?',
      options: [
        {
          name: 'Rewrite the stored message in place',
          pros: 'Simple reads, one row per message.',
          cons: 'Devices that already hold the old copy never hear about it: a cursor only moves forward.',
        },
        {
          name: 'Edits and deletes as new events',
          pros: 'They take a sequence number, so they travel through the same fan-out, sync and ordering, and every device converges.',
          cons: 'Clients apply events on top of the original message, and history keeps tombstones.',
        },
      ],
      choice:
        'Events. An edit or a delete is a new entry with its own sequence that points at the message it changes; devices apply it when they sync, and the original text is purged from the store. Retention works the same way: a background job removes messages older than the conversation’s window and leaves a tombstone, so a device that syncs later knows the gap is intentional.',
    },
    {
      question: 'What would we run each part on?',
      options: [
        {
          name: 'Wide-column store, Cassandra style',
          pros: 'High write throughput; partition by conversation and read sequence ranges naturally.',
          cons: 'Conditional writes are slow lightweight transactions, and it is a cluster to operate.',
        },
        {
          name: 'Key-value store with conditional writes, DynamoDB style',
          pros: 'A conditional put on the next sequence is native; conversation as partition key and sequence as sort key.',
          cons: 'One partition caps a conversation near a thousand writes a second, and fan-out writes drive the bill.',
        },
        {
          name: 'Sharded relational database',
          pros: 'Transactions and unique keys out of the box, and familiar to every team.',
          cons: 'Resharding at petabyte scale is heavy, and every shard is a failover to manage.',
        },
      ],
      choice:
        'A key-value store with conditional writes for messages and inboxes, an in-memory pub/sub such as Redis sharded by user for the channels, the phone platforms’ push services for notifications, and object storage for media. Any store with quorum replication and conditional appends fits the design; the choice is about operations and cost, not correctness.',
    },
    {
      question: 'How do typing indicators and online status work?',
      options: [
        {
          name: 'Store them like messages',
          pros: 'One path for everything, and they survive reconnects.',
          cons: 'Typing events outnumber messages, and storing a signal that is stale in seconds wastes the busiest write path.',
        },
        {
          name: 'Ephemeral events over pub/sub only',
          pros: 'No storage and no sequence; a lost event costs nothing because the next one replaces it.',
          cons: 'No history and no guarantee; a device that connects later never sees an old indicator.',
        },
        {
          name: 'Broadcast every status change to every contact',
          pros: 'Contacts always see an up-to-date online dot.',
          cons: 'One status change fans out to hundreds of contacts, most of whom are not looking.',
        },
      ],
      choice:
        'Ephemeral events over the same per-user channels. A typing event carries the conversation, expires after a few seconds and is sent at most once every few seconds per conversation; it skips the message service and the store. Online status is read on demand for the conversation on screen and refreshed while it stays open, instead of being pushed to every contact.',
    },
    {
      question: 'What happens when someone joins or leaves a group?',
      options: [
        {
          name: 'A new member sees the full history',
          pros: 'Context for whoever joins.',
          cons: 'Exposes messages written before they were invited, which members may not expect.',
        },
        {
          name: 'A new member sees from the moment they joined',
          pros: 'Matches what members agreed to when they wrote.',
          cons: 'The newcomer lacks context unless someone shares it.',
        },
      ],
      choice:
        'Joins and leaves are events in the conversation with their own sequence. A member’s access is the range of sequences between their join and their leave: fan-out uses the member list as of each sequence, and history reads are clipped to that range, so a newcomer starts at the join and a removed member receives nothing after the removal. Admins can opt a group into showing recent history to newcomers. With end-to-end encryption, a membership change would also rotate the group key.',
    },
    {
      question: 'What happens if a whole region fails?',
      options: [
        {
          name: 'Pause sends until the region returns',
          pros: 'No risk of two writers or lost acked messages.',
          cons: 'Every conversation homed there stops for the whole outage.',
        },
        {
          name: 'Asynchronous replication with a declared failover',
          pros: 'Sends resume in another region within minutes, with no cross-region wait on each send.',
          cons: 'Messages acked in the last seconds before the failure may not have replicated yet.',
        },
        {
          name: 'Synchronous replication across regions',
          pros: 'An acked message survives the loss of a region.',
          cons: 'Every send waits a cross-region round trip, tens of milliseconds or more, and a slow region slows everyone.',
        },
      ],
      choice:
        'Asynchronous replication with a declared failover. Each conversation has a home region and a standby. When the home region is declared down, the standby takes over with a higher epoch, and every append is conditional on that epoch, so a recovering old home cannot write over it. Messages acked but not yet replicated are reconciled when the region returns; clients still hold them as sent and can resend with the same client message ID. Recovery point: seconds; recovery time: minutes.',
    },
    {
      question: 'How do we keep conversations private?',
      options: [
        {
          name: 'TLS in transit and encryption at rest',
          pros: 'The server can search, filter spam and restore full history on a new device.',
          cons: 'The operator, or anyone who breaches the servers, can read messages.',
        },
        {
          name: 'End-to-end encryption',
          pros: 'Only members’ devices can read; a server breach exposes metadata, not content.',
          cons: 'No server-side search or content moderation, keys per device, and history is lost with the device unless backed up.',
        },
      ],
      choice:
        'TLS on every hop and encryption at rest in the first version, with membership checked on every send, history read and subscription. The payload already travels opaque, so end-to-end encryption can be added later without changing ordering or delivery.',
    },
    {
      question: 'How would we add search over history?',
      options: [
        {
          name: 'Query the message store',
          pros: 'No new system.',
          cons: 'The store is keyed by conversation and sequence; a text search would scan everything a user can read.',
        },
        {
          name: 'A server-side search index',
          pros: 'Fast full-text search across every conversation and device, ranked and filtered.',
          cons: 'A copy of every message in another system, and it only works while the server can read messages.',
        },
        {
          name: 'Search on the device',
          pros: 'Works with end-to-end encryption, and nothing new leaves the phone.',
          cons: 'Only finds what the device has synced, and each device builds its own index.',
        },
      ],
      choice:
        'Server-side while messages are readable by the server: a consumer of the message stream indexes each message with its conversation and sequence into OpenSearch, partitioned by conversation, and every query is filtered by the conversations the user belongs to at that sequence, the same membership rule as history reads. Edits and deletes are events, so they update or remove the indexed copy. With end-to-end encryption the index moves to the device, which is the same privacy trade-off as the deep dive above.',
    },
    {
      question: 'How would we add broadcast channels with many thousands of members?',
      options: [
        {
          name: 'Reuse the group path',
          pros: 'One code path for everything.',
          cons: 'A post to 100K members becomes 100K inbox writes and publishes; the first bottleneck, multiplied.',
        },
        {
          name: 'A pull model for channels',
          pros: 'One write per post; subscribers read the channel log from their own cursor.',
          cons: 'A second fan-out path to build and test, and unread counts are computed on read instead of stored.',
        },
      ],
      choice:
        'Pull for channels above a size threshold. A post is appended once to the channel’s log with its sequence; subscribers do not get inbox entries. Online members see it through a channel-wide pub/sub topic that gateways subscribe to once per channel, not once per member, and devices read the log from their cursor when they open the channel. Notifications are batched and rate limited per channel. Groups stay on the push path, so the cost of each path matches its size.',
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
        property: 'Access',
        promise:
          'Only current members can send to a conversation, read its history or receive its messages. Membership is checked on every send, history read and subscription, and a removed member receives nothing sequenced after the removal.',
      },
      {
        property: 'Gateway failure',
        promise:
          'Losing any number of gateways costs reconnects and latency, never messages. Gateways hold sockets and subscriptions only; everything a device needs to resume is its own cursor, the inbox and the store.',
      },
    ],
    assumes: [
      'The message store offers quorum replication and conditional writes that are atomic within one conversation’s partition.',
      'Fan-out is redriven: the append writes a pending marker in the same atomic write as the message, and a sweeper repeats inbox marks and publishes until they are confirmed. Inbox marks keep the highest sequence, so repeats are harmless.',
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
      'Durability through the loss of a whole region for messages acked in the seconds before it. Replication across regions is asynchronous; those messages are reconciled when the region returns or resent by clients with the same client message ID.',
      'Typing indicators or online status at all. They are ephemeral hints that may be dropped.',
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
      scenario: 'A phone is lost, or a device’s token is stolen.',
      impact:
        'Someone else can read new messages and send as the user from that device until its access is cut.',
      detection:
        'The user reports it, or sign-ins appear from a new device or an unusual location.',
      recovery:
        'Revoking the device invalidates its refresh token and closes its socket on the gateway; any access token still held expires within minutes. Other devices keep working, and the user can sign in again on a new one.',
    },
    {
      scenario: 'A zone is lost and a fifth of the gateways go with it.',
      impact:
        'Millions of sockets drop. Messages for those users queue as unsynced inbox entries, presence shows them online until heartbeats expire, and a reconnect wave threatens the remaining gateways and the store.',
      detection:
        'A step drop in open connections, handshake queue time and failures on the remaining gateways, and the healthy gateway count.',
      recovery:
        'Devices reconnect with jittered backoff, gateways refuse handshakes above a set rate with a retry delay, and catch-up reads are rate limited per device. Stale presence entries expire, and unacked inbox entries trigger notifications in the meantime. Each device syncs from its cursor; no message state was on the lost gateways.',
    },
    {
      scenario: 'A whole region fails, with the conversations homed in it.',
      impact:
        'Sends to those conversations fail until failover. Messages acked in the last seconds may exist only in the failed region.',
      detection:
        'Health checks from other regions, replication lag per region, and send error rates by home region. Failover is declared by an operator or an automated runbook, not by a single timeout.',
      recovery:
        'The standby region takes over with a higher epoch, devices reconnect to the nearest healthy gateways and sync, and appends resume within minutes. When the old region returns, its unreplicated tail is compared by client message ID: messages already resent are dropped, and the rest are appended with new sequences and flagged as late.',
    },
  ],
  capacity: {
    assumptions: [
      '300M daily users, 50M devices connected at peak, and each user sends about 20 messages a day.',
      'A message goes to 4 other members on average across one-to-one chats and groups, and about 2.5 of their devices are online to receive it.',
      'A stored message is about 300 bytes with metadata. Media is uploaded straight to object storage with a signed URL, and the message carries only the reference.',
      'A gateway runs at about 100K sockets, at about 20 KB of memory each, and can hold about 150K. Gateways are spread evenly over five zones, so the ones left after a zone loss can take its users. Peak traffic is twice the daily average.',
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
        math: '50M sockets ÷ 100K per gateway = 500; 100K × 20 KB = 2 GB; after losing a zone of 100, 50M ÷ 400 = 125K each, under the 150K ceiling',
      },
      {
        label: 'Reconnects after losing a zone',
        value: '~25K handshakes/s per gateway at once, ~420/s with jitter',
        math: '100 gateways × 100K = 10M sockets ÷ 400 gateways = 25K each if all return in one second; ÷ 60 s ≈ 420/s each',
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
      'Typing events can match or exceed message traffic, so they are throttled per conversation, never stored and dropped first under load.',
      'A reconnect wave differs by a factor of 60 between everyone at once and jitter over a minute. Client backoff with jitter and handshake rate limits on gateways are part of the capacity plan, not a nicety.',
      'Two petabytes a year means a store partitioned by conversation with old messages on cheaper storage. Reads are by conversation and sequence range, so that key serves both catch-up and scrolling back.',
      'One writer per conversation caps a single conversation at roughly a thousand appends a second on one partition, far above any human group. A hot conversation is handled by batching: the writer assigns a range of sequences in one conditional write. Broadcast-style channels move to the pull model instead.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS in a single region with five Availability Zones. The zones in the walkthrough are Availability Zones; the services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Load balancer',
        service: 'Network Load Balancer, TCP listener',
        why: 'Layer 4 forwarding for long-lived sockets at low cost per connection; TLS terminates on the gateways so a socket is one TCP connection end to end.',
        watch:
          'ActiveFlowCount (open sockets), NewFlowCount (a jump is a reconnect wave), UnHealthyHostCount, PortAllocationErrorCount.',
      },
      {
        part: 'Chat gateways',
        service: 'Amazon EC2 in an Auto Scaling group over five AZs',
        why: 'Stateful servers holding about 100K sockets each need tuned file-descriptor and memory limits and connection draining on deploys, which is simpler on instances than on serverless. They are not Amazon API Gateway: its WebSocket APIs charge per message and per connection minute and close connections after two hours, which at 50M always-on sockets costs more and forces reconnects.',
        watch:
          'Custom: sockets per instance, handshakes per second, handshake queue time and rejections; Auto Scaling GroupInServiceInstances against GroupDesiredCapacity.',
      },
      {
        part: 'Message service',
        service: 'Amazon ECS on AWS Fargate',
        why: 'Stateless and deployed often; it scales on CPU without touching the sockets.',
        watch:
          'ECS CPUUtilization and MemoryUtilization; custom: ack latency p99, send errors, duplicate client message ID hits.',
      },
      {
        part: 'Message store',
        service: 'Amazon DynamoDB: conversation as partition key, sequence as sort key',
        why: 'A conditional put on the next sequence and the unique client message ID fit in one TransactWriteItems call, together with the pending fan-out marker.',
        watch:
          'SuccessfulRequestLatency, TransactionConflict and ConditionalCheckFailedRequests (two writers), WriteThrottleEvents; Contributor Insights for hot conversations.',
      },
      {
        part: 'Inboxes',
        service: 'Amazon DynamoDB: user as partition key, conversation as sort key',
        why: 'An inbox mark is a single upsert of the latest sequence. Pending fan-out markers sit in a sparse index, so the sweeper reads only what is unfinished.',
        watch:
          'ConsumedWriteCapacityUnits, about four times the message table, and WriteThrottleEvents; custom: age of the oldest pending fan-out marker.',
      },
      {
        part: 'Fan-out sweeper',
        service: 'A small always-on Amazon ECS task',
        why: 'Every few seconds it queries the sparse index of pending markers and redrives them. EventBridge schedules run at most once a minute, too coarse for a fan-out that should finish in seconds.',
        watch:
          'ECS RunningTaskCount for the sweeper; custom: markers redriven per minute and the age of the oldest marker.',
      },
      {
        part: 'Pub/sub and presence',
        service: 'Amazon ElastiCache for Redis, cluster mode, sharded pub/sub',
        why: 'Channels per user spread over shards by key, and presence is a key with a TTL that gateways refresh in batches.',
        watch:
          'EngineCPUUtilization per shard, CurrConnections, NetworkBytesOut, DatabaseMemoryUsagePercentage.',
      },
      {
        part: 'Push sender',
        service: 'Amazon SQS queue feeding a worker that calls APNs and FCM',
        why: 'The queue absorbs bursts and retries without blocking the message path; Amazon SNS mobile push is the managed alternative.',
        watch:
          'ApproximateAgeOfOldestMessage (late notifications), ApproximateNumberOfMessagesVisible, and the depth of the dead-letter queue.',
      },
      {
        part: 'Media',
        service: 'Amazon S3 with presigned URLs, served through Amazon CloudFront',
        why: 'Uploads go straight to storage and downloads come from the edge; messages carry only the object key.',
        watch:
          'S3 4xxErrors, 5xxErrors and FirstByteLatency with request metrics on; CloudFront 5xxErrorRate and CacheHitRate.',
      },
      {
        part: 'Identity and keys',
        service: 'Amazon Cognito tokens, AWS KMS, AWS Secrets Manager',
        why: 'Short-lived access tokens for the handshake, encryption at rest for tables and buckets, and no secrets in code.',
        watch: 'Cognito SignInSuccesses and TokenRefreshSuccesses; KMS throttling on decrypt.',
      },
      {
        part: 'Old messages and observability',
        service: 'DynamoDB Standard-IA table class, TTL, Amazon CloudWatch',
        why: 'Cold history costs less, retention deletes itself with TTL, and alarms watch handshake rate, pending marker age and partition throttling.',
        watch:
          'A dashboard with the SLOs, the alarms below, and Cost Explorer, where DynamoDB fan-out writes and the gateway fleet dominate.',
      },
    ],
    limits: [
      'A DynamoDB partition takes about 1,000 writes a second, which is where the "roughly a thousand appends a second per conversation" ceiling comes from. Batching sequences into one write raises it for a hot conversation.',
      'With client IP preservation turned off, a Network Load Balancer opens at most about 55K connections to each target IP and port. A gateway holding 100K sockets either keeps client IP preservation on or registers on two ports; watch the port allocation error metric.',
      'AWS WAF does not attach to a Network Load Balancer, so per-user rate limits and handshake limits live in the gateways, with AWS Shield covering network-level floods.',
      'TransactWriteItems handles up to 100 items, so the message, its unique client message ID and the pending marker go in one transaction, while the per-member inbox marks happen after it.',
      'A region with only three Availability Zones turns a zone loss into a third of the fleet: 50M ÷ 333 is right at the 150K ceiling. Use a region with five or more zones, or run more gateways.',
    ],
  },
  slos: [
    {
      objective: 'Delivery to an online device',
      target: '99% within 500 ms, over 28 days',
      measure:
        'Time from the store append to the device ack, from server timestamps and device acks.',
    },
    {
      objective: 'Send acknowledged',
      target: '99.9% of sends acked within 1 s',
      measure: 'Ack latency and send errors at the message service, split by home region.',
    },
    {
      objective: 'Fan-out completes',
      target: 'Oldest pending fan-out marker under 10 s',
      measure:
        'The age of the oldest marker in the sparse index, the first sign of the inbox bottleneck.',
    },
    {
      objective: 'Connection success',
      target: '99.9% of handshakes succeed on the first or second try',
      measure:
        'Handshake success and queue time at the gateways, which a reconnect wave burns first.',
    },
    {
      objective: 'No gaps left behind',
      target: 'Under 0.01% of devices hold a gap after 30 s',
      measure: 'Gaps reported by devices and repaired by sync, a check that delivery converges.',
    },
  ],
  alarms: [
    {
      name: 'Fan-out falling behind',
      metric: 'Custom: oldest pending fan-out marker older than 10 s',
      meaning:
        'The inbox path, the first bottleneck, is saturating while sends still look healthy.',
    },
    {
      name: 'Slow delivery',
      metric: 'Custom: delivery to online devices p99 above 500 ms',
      meaning: 'The main SLO is burning its error budget; check pub/sub shards and gateway load.',
    },
    {
      name: 'Slow or failing sends',
      metric: 'Custom: ack latency p99 above 1 s, or send errors above 0.1%',
      meaning:
        'The only path users wait on is in trouble: the store, the message service or a hot partition.',
    },
    {
      name: 'Reconnect wave',
      metric: 'NLB NewFlowCount spike with gateway handshake rejections',
      meaning:
        'A zone or a deploy dropped sockets; jitter and handshake limits should be spreading the return.',
    },
    {
      name: 'Gateways lost',
      metric: 'NLB UnHealthyHostCount above a few, or HealthyHostCount below 450',
      meaning: 'Capacity is gone; the survivors move toward the 150K socket ceiling.',
    },
    {
      name: 'Hot partition',
      metric: 'DynamoDB WriteThrottleEvents above zero for 5 minutes',
      meaning:
        'A conversation or the inbox table hit a partition limit; batch sequences or check Contributor Insights.',
    },
    {
      name: 'Late notifications',
      metric: 'SQS ApproximateAgeOfOldestMessage above 60 s',
      meaning: 'Offline phones are not being woken; check the push worker and APNs or FCM errors.',
    },
    {
      name: 'Port limit',
      metric: 'NLB PortAllocationErrorCount above zero',
      meaning:
        'A gateway hit the 55K connection limit per target IP and port; register it on another port.',
    },
  ],
  evolution: {
    mvp: 'A few servers that both hold WebSockets and handle messages, and one relational database. The messages table has unique keys on conversation with sequence and on conversation with client message ID, and the sequence is assigned in a transaction that locks the conversation row. Servers relay to each other through a simple pub/sub, and a reconnecting device asks for messages after its cursor in each of its conversations. No inbox, no presence service, no push sender beyond one call to the platform.',
    atScale: [
      'At 10x, deploys hurt first: every release of message logic drops every socket. Split thin gateways from a stateless message service, and add the per-user pub/sub channel so the service does not track gateways.',
      'At 10x, the reconnect query over all of a user’s conversations gets expensive. Materialize it as the inbox, written at send time.',
      'At 10x, abuse shows up: add per-user send rate limits, a size cap per message and spam scoring at the gateway, before the message service does any work.',
      'At 100x, one database cannot take the writes. Move messages to a store partitioned by conversation with conditional appends, shard pub/sub by user, and batch presence updates per gateway.',
      'At 100x, failures are routine: add jittered reconnects, handshake rate limits, the fan-out sweeper, and spare gateway capacity for one zone.',
      'Across regions, devices connect to the nearest gateways, and each conversation is sequenced in one home region with an asynchronous standby, so order still comes from a single conditional write and a region loss costs minutes of sends, not history.',
    ],
    firstBottleneck:
      'Fan-out, in the inbox store. Sockets scale by adding gateways and appends scale by adding partitions, but every message becomes one write per member, so this path runs at several times the send rate and takes the full weight of large groups. It shows first as a growing age of pending fan-out markers and late notifications, while sends still look healthy.',
    avoided: [
      'A durable ordered log per user between the message service and the gateways. The store and the cursors already make delivery reliable, so the bus can stay lossy and cheap. It is worth adding if repairs by sync become a visible share of traffic.',
      'Consensus across regions for sequencing. A home region per conversation keeps one writer and a simple conditional write; multi-region writes are worth it only if a region outage must not pause sends.',
      'Channels with many thousands of members in the first version. They need the pull model in the deep dive above, a second fan-out path to build and test; add it when the product needs broadcast-style groups.',
      'Per-member read receipts in large groups. They multiply writes by group size again; an aggregate count is enough until users ask for names.',
      'Pinning users to gateways by hashing. It removes the pub/sub layer but ties rebalancing to user identity; it pays off only if the subscription count becomes the limit.',
    ],
  },
};
