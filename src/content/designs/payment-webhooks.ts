import type { Design } from '../types';

export const paymentWebhooks: Design = {
  slug: 'payment-webhooks',
  title: 'Payment webhook processor',
  summary:
    'Turn payment provider webhooks into correct order and ledger updates: never lose an acknowledged event, never let one take effect twice, and survive events that arrive late, out of order or not at all.',
  minutes: 10,
  difficulty: 'Hard',
  requirements: {
    functional: [
      'Receive webhooks from a payment provider (payment succeeded, refunded, disputed).',
      'Verify that every webhook really comes from the provider.',
      'Update orders and the ledger so that each event takes effect once, deduplicated on the provider event id, whatever the delivery order.',
      'Find and repair events that were never delivered.',
    ],
    nonFunctional: [
      'Never lose an acknowledged event: answer 2xx only after the event is durably stored, and keep the raw payload for audit and replay.',
      'Answer within the provider timeout, a few seconds at most, through bursts of a few thousand events per second.',
      'Correctness over speed: a payment applied twice or not at all is an incident.',
      'Accept nothing that is not signed by the provider, keep signing secrets out of code, and restrict who can read raw payloads, which carry customer data.',
    ],
    outOfScope: [
      'Checkout and card collection: card numbers never reach this system, only the provider’s object ids.',
      'Sending payments out (payouts, transfers), which need their own idempotency keys on our requests to the provider.',
      'Accounting reports, tax and revenue recognition, which read the ledger but do not write it.',
      'Fraud scoring and dispute handling beyond recording the dispute event.',
      'Several payment providers: the design is written for one, and a second one adds an adapter per provider in front of the same inbox.',
    ],
  },
  entities: [
    {
      name: 'Webhook event',
      description: 'The raw payload, its provider event id, type and signature.',
    },
    {
      name: 'Inbox row',
      description: 'One per event id: payload, received at, status, attempts, last error.',
    },
    { name: 'Payment', description: 'Internal state: pending, paid, refunded or disputed.' },
    {
      name: 'Ledger entry',
      description: 'An immutable record of money moving, in integer minor units.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/webhooks/{provider}',
      description: 'Verifies the signature, stores the event and returns 2xx immediately.',
    },
    {
      method: 'POST',
      path: '/admin/events/{id}/replay',
      description:
        'Re-runs a stored event, or every failed event of one type, after a fix. Safe because handlers are idempotent.',
    },
  ],
  dataFlow: [
    'The provider sends a signed event.',
    'The endpoint verifies it, stores it in the inbox and answers 2xx.',
    'A relay publishes stored events to a queue; a processor applies each one to payments and the ledger in one transaction.',
    'A daily reconciliation compares the ledger with the provider and repairs gaps by inserting events into the inbox, so repairs go through the same processor.',
  ],
  highLevel: {
    label: 'Run a payment event through the processor',
    intro:
      'Follow one "payment succeeded" event from the provider to the ledger. Watch inline processing time out under a traffic spike, then see the inbox, the queue, the processor, dead letters and reconciliation join the design as it grows. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      {
        id: 'provider',
        title: 'Payment provider',
        detail: 'Signed events',
        column: 0,
        row: 'middle',
      },
      {
        id: 'endpoint',
        title: 'Webhook endpoint',
        detail: 'Verify, store, 2xx',
        column: 1,
        row: 'middle',
      },
      {
        id: 'inbox',
        title: 'Inbox table',
        detail: 'Unique event id',
        column: 2,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'queue',
        title: 'Work queue',
        detail: 'Retries, backoff',
        column: 3,
        row: 'middle',
        appearsAt: 5,
      },
      {
        id: 'dlq',
        title: 'Dead letters',
        detail: 'Alert + replay',
        column: 4,
        row: 'top',
        appearsAt: 8,
      },
      {
        id: 'processor',
        title: 'Processor',
        detail: 'Idempotent handler',
        column: 4,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'recon',
        title: 'Reconciliation',
        detail: 'Daily vs provider',
        column: 4,
        row: 'bottom',
        appearsAt: 9,
      },
      {
        id: 'db',
        title: 'Payments + ledger',
        detail: 'One transaction',
        column: 5,
        row: 'middle',
      },
    ],
    edges: [
      ['provider', 'endpoint'],
      ['endpoint', 'db'],
      ['endpoint', 'inbox'],
      ['inbox', 'processor'],
      ['inbox', 'queue'],
      ['queue', 'processor'],
      ['queue', 'dlq'],
      ['processor', 'db'],
      ['recon', 'db'],
      ['recon', 'inbox'],
    ],
    edgeStages: [
      { edge: ['endpoint', 'db'], stages: [0, 1, 2] },
      { edge: ['inbox', 'processor'], stages: [3, 4] },
    ],
    stages: [
      {
        title: 'The provider pushes an event',
        narration:
          'A payment succeeds and the provider sends a webhook. Webhooks are delivered at least once, in no guaranteed order, and occasionally not at all.',
        tradeoff:
          'Webhooks give near real-time updates without polling. The price is that duplicates, reordering and gaps are normal, so the rest of the design exists to make them harmless.',
        nodes: ['provider', 'endpoint'],
        travel: [['provider', 'endpoint']],
        short: 'Push event',
        metrics: { users: '100K', requestsPerSecond: '100', p95Latency: '400 ms', errorRate: '0%' },
        load: { endpoint: 15, db: 10 },
      },
      {
        title: 'Verify the signature',
        narration:
          'The endpoint checks the signature against the shared secret and rejects events whose timestamp is too old, which blocks replayed requests.',
        tradeoff:
          'A tight timestamp tolerance blocks replays but can reject real events when clocks drift, so use the window the provider recommends. Supporting two secrets at once lets the secret rotate without downtime.',
        nodes: ['endpoint'],
        travel: [],
        short: 'Verify',
        metrics: { users: '100K', requestsPerSecond: '100', p95Latency: '400 ms', errorRate: '0%' },
        load: { endpoint: 18 },
      },
      {
        title: 'Work inside the request times out',
        narration:
          'At first the endpoint does everything before answering: it updates the payment and the ledger and sends the receipt. A busy sales day multiplies events, handlers slow down and responses miss the provider timeout. The provider retries, and every retry adds more load to an endpoint that is already behind.',
        tradeoff:
          'Inline processing is the simplest design and works at low volume. Under a spike it turns slowness into failures, and failures into retries, so load feeds on itself. The fix is to make the request do as little as possible and move the work behind it.',
        nodes: ['provider', 'endpoint', 'db'],
        travel: [
          ['provider', 'endpoint'],
          ['endpoint', 'db'],
        ],
        short: 'Timeouts',
        metrics: {
          users: '1M',
          requestsPerSecond: '2K',
          p95Latency: '12 s',
          errorRate: '8%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { endpoint: 98, db: 75 },
        traffic: [{ edge: ['provider', 'endpoint'], kind: 'failed' }],
      },
      {
        title: 'Store, then answer 2xx',
        narration:
          'An inbox table joins the design. The raw event goes into it and the endpoint answers 2xx right away. No business logic runs inside the request: a processor behind it polls the inbox and applies each event to the payments and the ledger.',
        tradeoff:
          'Doing the work inside the request is simpler, but a slow handler misses the provider timeout and triggers retries that pile up. Acknowledging first keeps the endpoint fast; in exchange we own retries, so the inbox must be durable.',
        nodes: ['endpoint', 'inbox', 'processor', 'db'],
        travel: [
          ['endpoint', 'inbox'],
          ['inbox', 'processor'],
          ['processor', 'db'],
        ],
        short: 'Store, 2xx',
        metrics: { users: '1M', requestsPerSecond: '2K', p95Latency: '40 ms', errorRate: '0%' },
        load: { endpoint: 30, inbox: 35, processor: 40, db: 40 },
      },
      {
        title: 'Duplicates stop at the door',
        narration:
          'The inbox has a unique constraint on the provider event id. A redelivered event fails the insert and is acknowledged as already received.',
        tradeoff:
          'Deduplicating at insert is exact and cheap, as long as event ids are kept longer than the provider retry window. Keeping them for weeks costs little and also gives a full audit trail.',
        nodes: ['inbox'],
        travel: [],
        short: 'Dedupe',
        metrics: { users: '1M', requestsPerSecond: '2K', p95Latency: '40 ms', errorRate: '0%' },
        load: { inbox: 35 },
      },
      {
        title: 'Hand off to a work queue',
        narration:
          'The processor stops polling the inbox. A relay polls the inbox for rows still marked as received, publishes them to a queue that gives retries with backoff and a visibility timeout, and marks them published, an update that only touches rows still marked received. Events that need a fetch from the provider go to a queue of their own with its own consumers, drawn here as one work queue, so a provider slowdown holds back only those. The endpoint itself never publishes. A sweep publishes again any row left published for more than 3 hours, longer than the worst backlog, so a message lost on the way cannot strand an event.',
        tradeoff:
          'A managed queue scales and retries for us. Publishing from the endpoint after the insert would be a dual write: a crash between the two would strand an event that was already acknowledged, and the provider would not send it again. The relay closes that gap at the cost of publishing at least once, which the processor makes harmless by checking the inbox status. At low volume, a worker polling the inbox table is simpler and has one less moving part, and it is easy to move to a queue later.',
        nodes: ['inbox', 'queue'],
        travel: [['inbox', 'queue']],
        short: 'Work queue',
        metrics: { users: '1M', requestsPerSecond: '2K', p95Latency: '40 ms', errorRate: '0%' },
        load: { inbox: 30, queue: 30 },
      },
      {
        title: 'Apply the event idempotently',
        narration:
          'The processor treats the payment as a state machine (pending, paid, refunded) and ignores transitions that would move it backwards. The check is part of the write: a conditional update on the current status, so two events handled at the same time cannot both pass it. For important events it fetches the current object from the provider instead of trusting the payload.',
        tradeoff:
          'Fetching the latest object costs an API call per event, and in return arrival order stops mattering: a late "succeeded" after a "refunded" cannot undo the refund.',
        nodes: ['queue', 'processor'],
        travel: [['queue', 'processor']],
        short: 'Apply event',
        metrics: { users: '1M', requestsPerSecond: '2K', p95Latency: '40 ms', errorRate: '0%' },
        load: { queue: 30, processor: 45 },
      },
      {
        title: 'One transaction for the money',
        narration:
          'The payment status, the ledger entry and the inbox row marked as processed are written in a single database transaction. Emails and other side effects go to an outbox and run after the commit.',
        tradeoff:
          'One transaction means the ledger can never disagree with the payment state. Moving side effects to an outbox adds a table and a worker, and keeps a crash from sending a receipt for a payment that was rolled back.',
        nodes: ['processor', 'db'],
        travel: [['processor', 'db']],
        short: 'Transaction',
        metrics: { users: '1M', requestsPerSecond: '2K', p95Latency: '40 ms', errorRate: '0%' },
        load: { processor: 45, db: 40 },
      },
      {
        title: 'Failures go to dead letters',
        narration:
          'An event that keeps failing moves to a dead-letter queue after five receives. A small consumer on that queue marks the inbox row failed and deletes the message, so the row is marked even when the last attempt died without writing anything, and the relay sweep does not revive it. A failed row raises an alert. After a fix, replay sets the row back to received and the relay publishes it like a new event, which also clears the alert.',
        tradeoff:
          'Retrying forever hides bugs and blocks nothing visible; giving up silently loses money. A dead-letter queue with an alert makes every stuck event someone’s job, and replay is safe because handlers are idempotent.',
        nodes: ['queue', 'dlq'],
        travel: [['queue', 'dlq']],
        short: 'Dead letters',
        metrics: { users: '1M', requestsPerSecond: '2K', p95Latency: '40 ms', errorRate: '0.01%' },
        load: { queue: 30, processor: 45, dlq: 10 },
        traffic: [{ edge: ['queue', 'processor'], kind: 'failed' }],
      },
      {
        title: 'Reconcile every day',
        narration:
          'A daily job lists the provider payments and refunds for the period and compares them with the ledger. It never writes the ledger itself: each difference becomes a synthetic event in the inbox, such as recon:pi_456:charge, and goes through the relay, the queue and the processor like a real webhook.',
        tradeoff:
          'Reconciliation costs API calls and a job to maintain. Webhooks alone cannot prove that nothing was missed; comparing against the source of truth can. Repairing through the inbox keeps one write path for money, so the state machine, the ledger keys and the audit trail apply to repairs too, and a real webhook that arrives after the repair is refused by the ledger key.',
        nodes: ['recon', 'db', 'inbox', 'queue', 'processor'],
        travel: [
          ['recon', 'db'],
          ['recon', 'inbox'],
          ['inbox', 'queue'],
          ['queue', 'processor'],
          ['processor', 'db'],
        ],
        short: 'Reconcile',
        metrics: { users: '1M', requestsPerSecond: '2K', p95Latency: '40 ms', errorRate: '0%' },
        load: { recon: 70, db: 50, inbox: 30, processor: 40 },
        traffic: [{ edge: ['recon', 'db'], kind: 'heavy' }],
      },
    ],
  },
  flows: [
    {
      id: 'ingest',
      title: 'Receive a webhook',
      kind: 'sync',
      summary:
        'The provider posts "payment succeeded" for Ana’s order. The endpoint checks the signature, stores the raw event and answers in about 40 ms. Nothing about the order changes yet.',
      runsOn: 'AWS WAF → ALB → webhook endpoint on ECS Fargate → Aurora PostgreSQL',
      participants: [
        { id: 'provider', label: 'Payment provider', service: 'External' },
        { id: 'alb', label: 'Load balancer', service: 'ALB + AWS WAF' },
        { id: 'endpoint', label: 'Webhook endpoint', service: 'ECS Fargate' },
        { id: 'db', label: 'Inbox table', service: 'Aurora PostgreSQL' },
      ],
      steps: [
        {
          from: 'provider',
          to: 'alb',
          label: 'POST /webhooks/provider + signature header',
          note: 'HTTPS only. WAF drops oversized bodies and floods before they reach the service; it is a filter, not the proof of origin.',
        },
        {
          from: 'alb',
          to: 'endpoint',
          label: 'forward raw body',
          note: 'The endpoint must keep the raw bytes: the signature is computed over them, and re-serialized JSON would not match.',
        },
        {
          from: 'endpoint',
          to: 'endpoint',
          label: 'HMAC(secret, timestamp.body), check timestamp',
          note: 'Constant-time comparison against the current and the previous secret, cached from Secrets Manager. A timestamp older than the provider’s tolerance is rejected as a replay. A bad signature gets 401 and is never stored.',
        },
        {
          from: 'endpoint',
          to: 'db',
          label: 'INSERT inbox ON CONFLICT (event_id) DO NOTHING',
          note: 'One small row with status received. Aurora acknowledges the commit only after a quorum of four of its six storage copies, spread over three zones, has it, so a 2xx never covers an event that one machine could lose.',
        },
        {
          from: 'db',
          to: 'endpoint',
          label: '1 row, or 0 rows if seen before',
          note: 'Zero rows means a redelivery: the event is already safe, so the answer is the same.',
          style: 'reply',
        },
        {
          from: 'endpoint',
          to: 'provider',
          label: '200 OK',
          note: 'Answered after the commit and before any business logic. Any failure before this point is a 5xx, and the provider tries again later.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'relay',
      title: 'Publish stored events',
      kind: 'async',
      summary:
        'A relay moves committed inbox rows to the work queue. It is the only writer to the queue, so an acknowledged event cannot be stranded by a crash in the endpoint.',
      runsOn: 'Relay on ECS → Aurora PostgreSQL → Amazon SQS',
      participants: [
        { id: 'relay', label: 'Relay', service: 'ECS Fargate' },
        { id: 'db', label: 'Inbox table', service: 'Aurora PostgreSQL' },
        { id: 'sqs', label: 'Work queues', service: 'SQS standard, two queues' },
      ],
      steps: [
        {
          from: 'relay',
          to: 'db',
          label: 'SELECT status=received LIMIT 100 FOR UPDATE SKIP LOCKED',
          note: 'Two relay tasks can run side by side: each takes rows the other has not locked, so they never publish the same batch at once.',
        },
        {
          from: 'relay',
          to: 'sqs',
          label: 'SendMessageBatch {eventId} × 10',
          note: 'Messages carry only the event id. The payload stays in the inbox, which keeps messages far below the 1 MiB limit and leaves one copy of the truth. Event types that change money, and so need a fetch from the provider, go to the fetch queue; the rest go to a second queue with its own consumers.',
          style: 'async',
        },
        {
          from: 'relay',
          to: 'db',
          label: 'UPDATE status=published WHERE status=received',
          note: 'It also sets published_at. The condition keeps the relay from overwriting a row that a fast processor has already marked processed. A crash between the send and this update publishes the batch again. That is the at-least-once side of the relay, and the processor’s status check absorbs it.',
        },
        {
          from: 'relay',
          to: 'db',
          label: 'republish rows published over 3 h ago',
          note: 'A message lost in a bad deploy would leave a row published forever; the sweep publishes it again. The deadline is longer than the worst expected backlog of about 70 minutes, and only rows still marked published are swept. The dead-letter consumer has marked a dead letter’s row failed long before the deadline, so dead letters stay dead until someone replays them.',
        },
      ],
    },
    {
      id: 'process',
      title: 'Apply the event',
      kind: 'queue',
      summary:
        'A processor takes the message, fetches the current payment from the provider and writes the payment status, the ledger entries, an outbox row and the inbox status in one transaction.',
      runsOn: 'Amazon SQS → processor on ECS Fargate → provider API → Aurora PostgreSQL',
      participants: [
        { id: 'sqs', label: 'Fetch queue', service: 'SQS standard' },
        { id: 'proc', label: 'Processor', service: 'ECS Fargate' },
        { id: 'api', label: 'Provider API', service: 'External' },
        { id: 'db', label: 'Payments + ledger', service: 'Aurora PostgreSQL' },
      ],
      steps: [
        {
          from: 'sqs',
          to: 'proc',
          label: 'ReceiveMessage {eventId}',
          note: 'A money-changing event, so it comes from the fetch queue. The message becomes invisible for 60 s. If the processor dies, it reappears for another one.',
          style: 'async',
        },
        {
          from: 'proc',
          to: 'db',
          label: 'read inbox row',
          note: 'Already processed means a duplicate delivery: delete the message and stop.',
        },
        {
          from: 'proc',
          to: 'api',
          label: 'GET payment pi_123',
          note: 'Money-changing events are applied from the current object, about 200 ms, so a late or reordered event cannot move the payment backwards. A 429 is retried inside the handler with backoff, and the handler extends the visibility timeout with ChangeMessageVisibility while it waits. SQS counts every receive toward the dead-letter limit, so the message must not be received again while the provider is the problem.',
        },
        {
          from: 'proc',
          to: 'db',
          label: 'BEGIN; UPDATE payments SET paid WHERE status=pending',
          note: 'The transition is a conditional update. Zero rows means another event already moved the payment, and nothing else in the transaction may assume this one won.',
        },
        {
          from: 'proc',
          to: 'db',
          label: 'INSERT ledger, outbox; UPDATE inbox=processed; COMMIT',
          note: 'The inbox update is conditional on the row not being processed yet, whether it is still received or already published. Ledger entries have a unique key of provider object id plus entry type, so a second event or a reconciliation repair for the same money is refused. All of it commits together or not at all.',
        },
        {
          from: 'proc',
          to: 'sqs',
          label: 'DeleteMessage',
          note: 'Only after the commit. A crash between commit and delete redelivers a message whose row is already processed.',
        },
      ],
    },
    {
      id: 'side-effects',
      title: 'Send the receipt',
      kind: 'async',
      summary:
        'Ana’s receipt is sent from the outbox row written in the same transaction, after the commit, with the outbox row id as the idempotency key.',
      runsOn: 'Outbox worker on ECS → Aurora PostgreSQL → Amazon SES or the order service',
      participants: [
        { id: 'worker', label: 'Outbox worker', service: 'ECS Fargate' },
        { id: 'db', label: 'Outbox table', service: 'Aurora PostgreSQL' },
        { id: 'mail', label: 'Receipt sender', service: 'Amazon SES' },
      ],
      steps: [
        {
          from: 'worker',
          to: 'db',
          label: 'claim unsent rows FOR UPDATE SKIP LOCKED',
          note: 'A row exists only if the payment transaction committed, so a rolled-back payment never produces a receipt.',
        },
        {
          from: 'worker',
          to: 'mail',
          label: 'send receipt, key=outbox id',
          note: 'At least once. Receivers that honor the key turn a resend into nothing; a plain email relay can deliver twice, which is the known gap.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'db',
          label: 'UPDATE outbox SET sent_at',
          note: 'Failures keep the row unsent with an attempt count; past the limit it is flagged and alarmed, like a dead letter.',
        },
      ],
    },
    {
      id: 'dead-letter',
      title: 'Dead letter and replay',
      kind: 'direct',
      summary:
        'A bug makes one event type fail every time. After five receives it lands in the dead-letter queue, its inbox row is marked failed, someone is paged, a fix ships and the stored event is replayed.',
      runsOn:
        'Amazon SQS redrive → dead-letter queue → dead-letter consumer → CloudWatch alarm → admin replay',
      participants: [
        { id: 'sqs', label: 'Work queues', service: 'SQS standard' },
        { id: 'dlq', label: 'Dead letters', service: 'SQS + consumer on ECS' },
        { id: 'oncall', label: 'On-call engineer', service: 'CloudWatch alarm' },
        { id: 'admin', label: 'Admin API', service: 'ECS, IAM-protected' },
        { id: 'db', label: 'Inbox table', service: 'Aurora PostgreSQL' },
      ],
      steps: [
        {
          from: 'sqs',
          to: 'dlq',
          label: 'maxReceiveCount 5 reached',
          note: 'The redrive policy moves the message once it has been received five times without being deleted. SQS counts every receive and cannot exclude any, so a rate-limited fetch is retried inside one receive, with the visibility timeout extended, and waiting on the provider does not use the five up.',
          style: 'async',
        },
        {
          from: 'dlq',
          to: 'db',
          label: 'UPDATE inbox SET status=failed; DeleteMessage',
          note: 'The dead-letter consumer does this for every message, so the row is marked failed even when the fifth attempt crashed without writing anything, and the relay sweep leaves it alone. The dead-letter queue is empty again afterwards.',
        },
        {
          from: 'db',
          to: 'oncall',
          label: 'failed inbox rows > 0',
          note: 'Every failed row is money not recorded, so one is enough to page. The alarm is measured on the inbox, not on the queue, so it stops only when the rows are replayed.',
          style: 'async',
        },
        {
          from: 'oncall',
          to: 'admin',
          label: 'POST /admin/events/{id}/replay',
          note: 'After the fix is deployed. The call is authenticated, authorized for a small group and written to the audit log.',
        },
        {
          from: 'admin',
          to: 'db',
          label: 'UPDATE inbox SET status=received',
          note: 'The relay publishes it again like any new event, as a fresh message with a receive count of zero, and the failed-rows alarm clears. Replay is safe because every write in the handler is conditional or keyed.',
        },
      ],
    },
    {
      id: 'reconcile',
      title: 'Reconcile with the provider',
      kind: 'scheduled',
      summary:
        'Every night a job lists yesterday’s payments and refunds from the provider, compares them with the ledger and repairs differences through the same processor.',
      runsOn:
        'EventBridge Scheduler → reconciliation task on ECS → provider API → Aurora PostgreSQL',
      participants: [
        { id: 'sched', label: 'Scheduler', service: 'EventBridge Scheduler' },
        { id: 'job', label: 'Reconciliation', service: 'ECS task' },
        { id: 'api', label: 'Provider API', service: 'External' },
        { id: 'db', label: 'Ledger + inbox', service: 'Aurora PostgreSQL' },
      ],
      steps: [
        {
          from: 'sched',
          to: 'job',
          label: 'RunTask at 03:00',
          note: 'An ECS task, not a Lambda: the run takes about 20 minutes and Lambda stops at 15.',
          style: 'async',
        },
        {
          from: 'job',
          to: 'api',
          label: 'list payments, refunds; 100 per page from cursor',
          note: 'About 26K calls at 20 per second, leaving the rest of the provider limit to the processor. The cursor is saved, so a crashed run resumes.',
        },
        {
          from: 'job',
          to: 'db',
          label: 'compare with ledger totals per payment',
          note: 'Differences are a missed webhook, a stuck event or a bug. Each one is recorded in a report.',
        },
        {
          from: 'job',
          to: 'db',
          label: 'INSERT inbox id=recon:pi_456:charge',
          note: 'A repair is a synthetic event that goes through the normal processor. The ledger key stops it if the real webhook was applied in the meantime.',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'How do we handle events that arrive out of order?',
      options: [
        {
          name: 'Apply events in arrival order',
          pros: 'Simple.',
          cons: 'A late event can overwrite a newer state.',
        },
        {
          name: 'Compare event timestamps',
          pros: 'No extra calls.',
          cons: 'Several events can share a timestamp, and clocks are not a reliable order.',
        },
        {
          name: 'Allowed transitions plus fetching the current object',
          pros: 'Order no longer matters; the provider is the source of truth.',
          cons: 'One API call per important event.',
        },
      ],
      choice:
        'A state machine that refuses backward moves, and a fetch of the current object for money-changing events.',
    },
    {
      question: 'How do we keep side effects from running twice?',
      options: [
        {
          name: 'Send emails inside the handler',
          pros: 'Direct.',
          cons: 'A retry after a crash sends them again, or sends them for a rolled-back change.',
        },
        {
          name: 'Transactional outbox',
          pros: 'Side effects are recorded in the same transaction and sent at least once after commit. The outbox row id is the idempotency key, so a resend is harmless.',
          cons: 'One more table and worker.',
        },
      ],
      choice:
        'A transactional outbox. It is the standard way to tie a database change to a message without distributed transactions.',
    },
    {
      question: 'How long do we keep raw events?',
      options: [
        {
          name: 'Delete after processing',
          pros: 'Least storage.',
          cons: 'No replay and no audit trail.',
        },
        {
          name: 'Keep for a fixed window, then purge',
          pros: 'Replay and audit for as long as they are useful.',
          cons: 'Storage, and payloads may contain personal data to protect.',
        },
      ],
      choice:
        'Keep them for a fixed window, longer than the provider retry window, with access restricted and a scheduled purge.',
    },
    {
      question: 'How do we know a webhook is real, and who can read it?',
      options: [
        {
          name: 'Allow only the provider’s published IP addresses',
          pros: 'Cheap, and blocks most noise at the edge.',
          cons: 'Proves where a request came from, not what it says; lists change, and it says nothing about replays.',
        },
        {
          name: 'Trust the payload and fetch the object anyway',
          pros: 'A forged event cannot set a wrong state, because the state comes from the provider API.',
          cons: 'Anyone can flood the inbox and burn the provider rate limit with fake event ids.',
        },
        {
          name: 'Signature over the raw body and a timestamp, with two secrets',
          pros: 'Proves origin and integrity, the timestamp tolerance blocks replays, and accepting the current and previous secret lets the secret rotate with no downtime.',
          cons: 'The raw body must be kept before parsing, and clocks must stay close to the provider’s.',
        },
      ],
      choice:
        'Verify the signature with a constant-time comparison before storing anything, keep the secrets in Secrets Manager, and put WAF in front for size and rate rules. Raw payloads carry customer names and emails, so they are encrypted with KMS, only the processor role can read them, and the replay API is limited to a small group and audited.',
    },
    {
      question: 'How do we live within the provider’s API rate limit?',
      options: [
        {
          name: 'Fetch the current object for every event',
          pros: 'Simplest rule; order never matters.',
          cons: 'At the sale-day peak it needs 600 calls a second against a limit of 100.',
        },
        {
          name: 'One fetch per payment for all of its waiting events',
          pros: 'A burst of events for one payment costs one call, and events that change no money skip the fetch.',
          cons: 'The processor has to group messages by payment before calling.',
        },
        {
          name: 'Apply from the payload; fetch only on conflict',
          pros: 'Fetches become rare, so the limit stops setting the drain time.',
          cons: 'The payload must be trusted for legal forward transitions, so the signature check carries more weight.',
        },
      ],
      choice:
        'One fetch per payment now, with a circuit breaker that pauses the consumers of the fetch queue on repeated 429s. Applying from the payload and fetching only on conflict is the step taken at 10x, when post-spike lag would last hours.',
    },
    {
      question: 'How should the ledger record money?',
      options: [
        {
          name: 'A balance column updated in place',
          pros: 'One row to read.',
          cons: 'No history: a wrong update erases the evidence, and two updates can race.',
        },
        {
          name: 'Amounts as decimals or floats',
          pros: 'Natural to write.',
          cons: 'Floats round, and currencies have different minor units.',
        },
        {
          name: 'Immutable double-entry rows in integer minor units',
          pros: 'Every movement has a debit and a credit that sum to zero, history is complete, and a balance is a sum anyone can recompute.',
          cons: 'More rows, and balances need a query or a snapshot.',
        },
      ],
      choice:
        'Append-only double-entry rows in integer minor units with the currency on each row. A mistake is fixed with a reversing entry, never an update, and the unique key per provider object and entry type keeps the same money from being recorded twice.',
    },
    {
      question: 'What changes with several regions?',
      options: [
        {
          name: 'Active endpoints in two regions, each with its own database',
          pros: 'Survives a region loss for ingestion.',
          cons: 'The unique event id only deduplicates inside one database, so a redelivery that lands in the other region applies the money twice.',
        },
        {
          name: 'One writing region, a standby region kept by replication',
          pros: 'One inbox and one ledger keep deduplication exact; the standby can be promoted if the region is lost.',
          cons: 'Promotion is a decision and takes minutes, and replication across regions is asynchronous.',
        },
      ],
      choice:
        'One writing region with Aurora Global Database as the standby. The provider retries for days, so a regional outage delays events instead of losing them; rows lost by asynchronous replication are found by reconciliation, and the ledger keys stop any that were applied twice.',
    },
  ],
  wrapUp:
    'Verify, store and answer fast; deduplicate on the event id; apply with a state machine in one transaction; send side effects through an outbox; and reconcile daily because webhooks cannot prove nothing was missed.',
  guarantees: {
    provides: [
      {
        property: 'Ingestion durability',
        promise:
          'An event is acknowledged with 2xx only after its inbox row is committed to a synchronously replicated database. Anything not acknowledged is retried by the provider, and the relay publishes every committed row, so no acknowledged event depends on a second write succeeding.',
      },
      {
        property: 'Processing',
        promise:
          'At least once, made harmless by the provider event id. The handler flips the inbox row to processed with a conditional update on a status that is not yet processed (received or published), in the same transaction as the payment, ledger and outbox writes. They commit together or not at all, so the ledger never disagrees with the payment state, and a redelivered message finds the row processed and does nothing. A unique key on each ledger entry (provider object id plus entry type) covers two different events, or an event and a reconciliation repair, that describe the same movement of money.',
      },
      {
        property: 'Ordering',
        promise:
          'None is assumed, and the final state does not depend on arrival order. Transitions are conditional updates that only move forward, and money-changing events are applied from the current object fetched from the provider, not from the payload.',
      },
      {
        property: 'Side effects',
        promise:
          'Sent at least once after the commit, made harmless by the outbox row id passed as the idempotency key. A side effect is never sent for a change that rolled back.',
      },
      {
        property: 'Completeness',
        promise:
          'An event that the provider never delivers is found by the daily reconciliation, so a missing payment or refund goes unnoticed for a little over a day at most: the 03:00 run covers the previous day, up to about 27 hours back.',
      },
    ],
    assumes: [
      'The provider keeps the same event id across redeliveries and retries a failed delivery for a window of days.',
      'The provider API returns the current state of an object and can list payments and refunds for a period. It is the source of truth.',
      'The database replicates synchronously, so a failover does not lose a committed inbox row, and supports conditional updates and unique constraints.',
      'Inbox rows are kept longer than the provider retry window. A redelivery after the purge would pass the inbox, and only the ledger key would stop it.',
      'Receivers of side effects honor the idempotency key. One that does not, such as a plain email relay, can deliver twice.',
      'The signing secret stays secret, and server clocks are close enough to the provider’s for the timestamp tolerance.',
    ],
    doesNotGuarantee: [
      'Timely processing. During a spike or a provider API slowdown, an acknowledged event can wait in the queue for an hour or more.',
      'Prompt detection of undelivered events. Between reconciliations, a payment whose webhook never arrived stays pending.',
      'Processing in the order things happened. A refund can be applied before the payment it refunds; only the end state is correct.',
      'Side effects delivered once. They are delivered at least once, and a duplicate is prevented only where the receiver deduplicates.',
      'Correctness against a wrong provider. If the provider API reports a wrong state, the ledger faithfully records it.',
    ],
  },
  failures: [
    {
      scenario:
        'The endpoint crashes after the inbox insert commits but before it answers, or the 2xx is lost on the way.',
      impact:
        'The provider sees a failure and sends the event again. The event itself is safe: the row exists, and the relay publishes it whether or not the provider retries.',
      detection:
        'Nothing to detect for a single event. The duplicate shows up in the count of inserts rejected by the unique constraint, which is a useful baseline of provider retries.',
      recovery:
        'The redelivery fails the insert and is acknowledged as already received. The system ends with one inbox row and one effect.',
    },
    {
      scenario:
        'A processor crashes mid-event: before the transaction commits, or after it commits but before it acknowledges the queue message.',
      impact:
        'Before the commit, nothing was written and the event is late by one visibility timeout. After the commit, the message is delivered again although the work is done.',
      detection:
        'Queue redelivery count and the age of the oldest inbox row still waiting (received or published), alarmed at a few minutes. That one metric also catches a stalled relay and a lost queue message.',
      recovery:
        'The redelivered message either does the work for the first time or finds the inbox row already processed and stops. Rows published but still unprocessed after a deadline are published again by the relay. Outbox rows committed with the transaction are sent by their own worker.',
    },
    {
      scenario:
        'Events arrive out of order: a "refunded" event is handled while the payment is still pending, and the "succeeded" event arrives later.',
      impact:
        'Applied naively, the late event would move the payment back to paid, or the payment would become refunded with no record of the original charge.',
      detection:
        'A counter of refused backward transitions, which is normal at a low rate. The daily reconciliation compares ledger totals per payment with the provider and flags any that differ.',
      recovery:
        'The handler fetches the current object, moves the payment to refunded, and writes every ledger entry the object implies that is not there yet, the charge and the refund, each under its unique key. The late "succeeded" fails the conditional update, finds its ledger entry present, and is marked processed with no effect.',
    },
    {
      scenario: 'The database primary fails over.',
      impact:
        'For tens of seconds the endpoint cannot insert and answers 5xx, and processors cannot commit. No acknowledged event is lost, because the row was replicated before the 2xx.',
      detection:
        'Endpoint 5xx rate and the database failover alarm, followed by a visible bump in provider retries.',
      recovery:
        'The provider redelivers with backoff and the queue redelivers in-flight messages; both are deduplicated as usual. If the outage outlasts the provider retry window, or replication was asynchronous and a committed row was lost, reconciliation finds the missing payments and repairs them from the provider API.',
    },
    {
      scenario: 'The provider API is down or rate limiting the fetch of current objects.',
      impact:
        'Money-changing events cannot be applied and their backlog grows, so orders stay pending after the customer has paid. Ingestion is unaffected, and events that need no fetch keep flowing, because the relay sends them to a separate queue with its own consumers.',
      detection:
        'Fetch error rate and the rate of 429 responses, with the age of the oldest message in the fetch queue as the user-facing signal.',
      recovery:
        'The event is not at fault, so these failures must not use up the five receives that lead to the dead-letter queue. SQS counts every receive, so the handler keeps the message: it retries the fetch in-process with backoff and extends the visibility timeout with ChangeMessageVisibility. On repeated failures a circuit breaker stops the fetch consumers from receiving new messages, which wait in their queue untouched. When the API returns, the backlog drains at the rate limit. State is late, never wrong.',
    },
    {
      scenario: 'A deploy breaks the handler for one event type, and every dispute event fails.',
      impact:
        'Hundreds of events dead-letter within minutes and each one is marked failed. Other event types keep flowing, but disputes are not recorded.',
      detection:
        'The failed-rows alarm, grouped by event type, so a burst reads as one incident instead of hundreds of pages; the processor error rate per type points at the deploy.',
      recovery:
        'Roll back, or switch off that event type with a flag so the processor marks its rows failed without burning attempts. After the fix, one bulk replay sets every failed row of that type back to received and the relay republishes them at its normal pace. Nothing was lost, because the inbox kept every payload.',
    },
    {
      scenario:
        'Every webhook is rejected: a rotated signing secret was not deployed, or the endpoint is misrouted.',
      impact:
        'No event enters the inbox, so nothing downstream alarms on its own. Payments stay pending, and a provider may disable an endpoint that fails for long enough.',
      detection:
        'Signature failure rate, and a heartbeat alarm on "no event stored for N minutes" during hours when traffic is expected. An absence needs its own alarm, because every queue is empty and healthy.',
      recovery:
        'Fix the secret; accepting two secrets during rotation prevents the case. The provider redelivers what is still inside its retry window, and reconciliation repairs the rest. Events past the window never reach the inbox, so their audit trail is the reconciliation record.',
    },
  ],
  capacity: {
    assumptions: [
      'About 100 events per second on average, and a peak of 2,000 per second on a sale day, counting the provider’s retries.',
      'A stored event is about 2 KB with its payload, and the inbox keeps 30 days.',
      'About 30% of events change money and need a fetch of the current object, which takes about 200 ms. Handling without a fetch takes about 15 ms.',
      'The provider allows about 100 API calls per second for the account, shared by the processor and reconciliation.',
      'A spike lasts about ten minutes.',
    ],
    estimates: [
      {
        label: 'Event volume',
        value: '~8.6M per day, 2K per second at peak',
        math: '100/s × 86,400 s ≈ 8.6M/day. Peak is 20 × the average.',
      },
      {
        label: 'Inbox storage',
        value: '~17 GB per day, ~520 GB retained',
        math: '8.6M × 2 KB ≈ 17 GB/day; × 30 days ≈ 520 GB.',
      },
      {
        label: 'Endpoint at peak',
        value: '~80 requests in flight, 2K inserts per second',
        math: '2,000/s × 40 ms per request = 80 concurrent requests, each one single-row insert.',
      },
      {
        label: 'Provider fetches at peak',
        value: '600 per second needed, 100 allowed',
        math: '2,000/s × 30% = 600 fetches/s against a limit of 100/s, so the backlog grows by 500 events/s.',
      },
      {
        label: 'Backlog after a spike',
        value: '~300K events, about 70 minutes to drain',
        math: '500/s × 600 s = 300,000. After the spike, 100/s allowed − 30/s of normal traffic = 70/s spare; 300,000 ÷ 70 ≈ 4,300 s.',
      },
      {
        label: 'Daily reconciliation',
        value: '~26K list calls, about 20 minutes',
        math: '8.6M × 30% ≈ 2.6M objects ÷ 100 per page = 26,000 calls; at 20 calls/s ≈ 1,300 s.',
      },
    ],
    implications: [
      'A peak 20 times the average is why the endpoint only stores and acknowledges: 2,000 single-row inserts per second fit one database primary, while 2,000 full handlers per second with an API call each do not fit anything.',
      'The provider rate limit, not our hardware, sets the processing rate. Adding processors past about 40 concurrent handlers (20 fetches in flight on the fetch queue, plus about 20 handlers on the other queue for the events that need none) buys nothing, so the fetch queue is sized to hold more than an hour of backlog and lag is an expected state with its own alarm threshold.',
      'Because the backlog is bounded by a limit we do not control, fetches are worth saving: one fetch per payment serves all of its events that are waiting, and events that change no money skip it.',
      'Half a terabyte of payloads in the transactional database is why the inbox is partitioned by day: the purge becomes dropping a partition instead of deleting 8.6 million rows.',
      'Reconciliation shares the API limit with the processor, so it runs off peak under its own budget of about 20 calls per second and must be resumable from a cursor.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one region across three Availability Zones. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Webhook endpoint',
        service: 'AWS WAF on an Application Load Balancer, Amazon ECS on AWS Fargate',
        why: 'A small stateless service that verifies, inserts and answers; WAF adds body-size and rate rules in front, and tasks scale on request count.',
        watch:
          'ALB TargetResponseTime and HTTPCode_Target_5XX_Count on /webhooks, and a custom count of signature failures.',
      },
      {
        part: 'Inbox, payments, ledger and outbox',
        service:
          'Amazon Aurora PostgreSQL with a replica in another zone; the inbox partitioned by day',
        why: 'One database gives the unique event id, conditional updates and the single transaction across all four tables. Aurora acknowledges a commit only after a quorum of four of the six storage copies, spread over three zones, has it, which is what makes the 2xx safe.',
        watch:
          'CommitLatency, DatabaseConnections, Deadlocks and CPUUtilization on the writer, and the failover event.',
      },
      {
        part: 'Relay',
        service: 'Two Amazon ECS tasks polling the inbox with SKIP LOCKED',
        why: 'The only path from the inbox to the queues, so the endpoint never makes a second write. It routes by event type: money-changing events to the fetch queue, the rest to the other.',
        watch: 'A custom metric of the age of the oldest received row, the relay’s own lag.',
      },
      {
        part: 'Work queue',
        service:
          'Two Amazon SQS standard queues, one for events that need a provider fetch and one for the rest, each with a 60 s visibility timeout and redrive to a shared dead-letter queue after 5 receives',
        why: 'Retries, backoff and buffering for a backlog of hundreds of thousands of events with no servers to run. Two queues let the fetch consumers pause on a provider slowdown while the other events keep flowing. Duplicates and reordering are already harmless here, so a FIFO queue buys nothing.',
        watch:
          'On each queue: ApproximateAgeOfOldestMessage, ApproximateNumberOfMessagesVisible, and NumberOfMessagesReceived against NumberOfMessagesDeleted.',
      },
      {
        part: 'Processor',
        service:
          'Amazon ECS on Fargate, one consumer group per queue, scaling on queue depth, capped at about 40 concurrent handlers in total',
        why: 'The provider limit sets the useful concurrency, so the cap of about 20 on the fetch consumers keeps extra tasks from only collecting 429s, and their circuit breaker pauses them without touching the other group.',
        watch:
          'Custom metrics: provider fetch latency, 429 rate, circuit breaker state, and refused backward transitions.',
      },
      {
        part: 'Dead letters',
        service:
          'Amazon SQS dead-letter queue, a small consumer on Amazon ECS that marks inbox rows failed, and a CloudWatch alarm',
        why: 'Every event that cannot be applied becomes visible and paged instead of retried forever. The alarm counts failed inbox rows, so it clears when they are replayed.',
        watch:
          'A custom count of failed inbox rows, which should be zero, and ApproximateAgeOfOldestMessage on the dead-letter queue, which shows a stalled consumer.',
      },
      {
        part: 'Side effects',
        service: 'An outbox worker on Amazon ECS sending through Amazon SES and internal services',
        why: 'Receipts and order updates leave only after the commit, keyed by the outbox row id.',
        watch: 'A custom age of the oldest unsent outbox row; SES Bounce and Reject counts.',
      },
      {
        part: 'Reconciliation',
        service: 'Amazon EventBridge Scheduler starting an Amazon ECS task every night',
        why: 'A run of about 20 minutes is past Lambda’s 15-minute limit, and the task resumes from a saved cursor.',
        watch:
          'Custom metrics: differences found, run duration, and the time of the last successful run.',
      },
      {
        part: 'Security',
        service: 'AWS Secrets Manager, AWS KMS, IAM roles per service, AWS CloudTrail',
        why: 'Signing secrets with a current and a previous version for rotation, payloads encrypted at rest, each service limited to its own tables and queues, and every replay and secret read logged.',
        watch:
          'Secrets Manager errors on refresh, CloudTrail events for the replay API and secret reads, WAF BlockedRequests.',
      },
      {
        part: 'Observability and cost',
        service: 'Amazon CloudWatch dashboards and alarms, AWS Cost Explorer',
        why: 'One dashboard with the SLOs. The bill is small next to the money it protects: mostly Aurora and its storage of about half a terabyte of payloads.',
        watch: 'The SLO dashboard, and Aurora storage growth against the daily partition drop.',
      },
    ],
    limits: [
      'An SQS message is at most 1 MiB, so it carries the event id and the payload stays in the inbox.',
      'The SQS visibility timeout goes up to 12 hours, counted from the first receive; 60 s is set well above a handler of about 200 ms, so a slow fetch does not release a message to a second processor, and a handler waiting on a rate-limited fetch extends it.',
      'SQS raises the receive count on every receive and the redrive policy cannot exclude any, so a retry that should not count toward the dead-letter limit has to happen without a new receive.',
      'SQS keeps a message for at most 14 days, far longer than the worst backlog, and the inbox remains the record anyway.',
      'A standard SQS queue delivers at least once and does not keep order, which the design already assumes.',
      'Lambda stops at 15 minutes, so the 20-minute reconciliation runs as an ECS task.',
      'An Aurora failover takes tens of seconds, during which the endpoint answers 5xx and the provider retries.',
      'AWS WAF attaches to an Application Load Balancer, not to a Network Load Balancer, which is one reason for the ALB.',
      'EventBridge Scheduler runs at most once a minute, enough for the incremental reconciliation every few minutes at 10x.',
    ],
  },
  slos: [
    {
      objective: 'Ingestion',
      target: '99.95% of validly signed webhooks answered 2xx within 1 s',
      measure: 'ALB TargetResponseTime and 5XX on /webhooks, excluding 401s for bad signatures.',
    },
    {
      objective: 'Processing lag',
      target:
        '99% of events applied within 2 min outside sale peaks; a peak backlog drained within 2 h',
      measure: 'processed_at minus received_at on each inbox row.',
    },
    {
      objective: 'Ledger correctness',
      target: 'No difference with the provider survives one reconciliation run',
      measure: 'The nightly reconciliation report: differences found, repaired, and still open.',
    },
    {
      objective: 'Dead letters',
      target: 'Every dead letter triaged within 4 hours',
      measure: 'Age of the oldest inbox row with status failed.',
    },
  ],
  alarms: [
    {
      name: 'Events not being applied',
      metric:
        'Custom: oldest inbox row still received or published older than 5 min, or older than 90 min during a peak',
      meaning:
        'The relay stalled, processors are down, or the provider limit is holding the drain; one metric covers all three because it is measured on the inbox.',
    },
    {
      name: 'Silence',
      metric: 'Custom: zero inbox inserts for 15 min during hours with expected traffic',
      meaning:
        'A rotated secret not deployed, a DNS or routing change, or the provider disabled the endpoint. Every queue looks healthy, so only an absence alarm catches it.',
    },
    {
      name: 'Signature failures',
      metric: 'Custom: signature failures above 1% of webhook requests for 5 min',
      meaning: 'A secret mismatch after rotation, clock drift, or someone probing the endpoint.',
    },
    {
      name: 'Dead letter',
      metric: 'Custom: inbox rows with status failed above 0',
      meaning:
        'An event cannot be applied and money is not recorded until someone fixes and replays it.',
    },
    {
      name: 'Provider rate limiting',
      metric: 'Custom: 429 responses above 5% of fetches, or the circuit breaker open for 5 min',
      meaning:
        'Processing of money-changing events is paused by the provider; check that reconciliation is not running at peak and expect lag.',
    },
    {
      name: 'Reconciliation',
      metric: 'Custom: open differences above 0, or no successful run in 26 hours',
      meaning: 'Something was missed or applied wrongly, or the backstop itself stopped running.',
    },
    {
      name: 'Endpoint errors',
      metric: 'ALB HTTPCode_Target_5XX_Count above 1% of webhook requests for 2 min',
      meaning:
        'Usually the database: a failover or connection exhaustion. Events are not lost, but the provider retry wave follows.',
    },
  ],
  evolution: {
    mvp: 'No queue and no separate relay. The endpoint verifies, inserts into the inbox and answers; one worker polls the inbox, claims rows with a lock that skips rows already taken, and applies each in one transaction with the state machine. A failed row gets an attempt count and, past a limit, a failed status that raises an alert. The outbox lives in the same database. The unique event id, the conditional transitions, the ledger keys and the daily reconciliation are there from the first version, because they are the correctness of the system and cannot be added after money has been recorded wrongly.',
    atScale: [
      'At 10x (20,000 events per second at peak), the provider rate limit makes post-spike lag last hours. Fetches become the exception: an event that is a legal forward transition is applied from its payload, and only conflicts and refused transitions trigger a fetch.',
      'At 10x, raw payloads move out of the database to object storage and the inbox row keeps a pointer and the status, so the primary carries small rows only.',
      'At 10x, a day is too long to leave a missed event unnoticed. Reconciliation becomes incremental, walking the provider’s event list from a cursor every few minutes, with the daily full comparison kept as the backstop.',
      'At 100x, one primary cannot take ingestion and the ledger together. The inbox is sharded by account, the ledger becomes its own service behind the outbox, and events for one payment are routed to one queue partition so that conditional updates stop contending.',
    ],
    firstBottleneck:
      'The provider API rate limit on fetching current objects. At the walkthrough’s peak the processor needs about six times the allowed call rate, so lag appears there long before the endpoint, the queue or the database run out. The second is the single database primary, which takes every inbox insert and every money transaction.',
    avoided: [
      'Strict per-payment ordering with a FIFO queue. The state machine and the fetch make order irrelevant, and a FIFO queue lets one stuck event block every later event for that payment. Worth adding when a handler appears whose effects do not commute.',
      'A distributed transaction across the database, the queue and downstream services. The inbox and the outbox give the same end result with local transactions and retries. It is not worth adding; the answer to a new downstream is another outbox consumer.',
      'A streaming platform with a replayable log in place of the inbox table. The table already gives deduplication, status and replay in one place at this volume. Worth adding when several independent consumers need the same events.',
      'Real-time reconciliation of every event. A daily pass is enough while a day of delay on a rare missed webhook is acceptable; the incremental version is the step to take when it is not.',
    ],
  },
};
