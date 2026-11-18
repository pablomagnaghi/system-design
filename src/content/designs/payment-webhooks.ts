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
    ],
    outOfScope: ['Checkout and card collection.', 'Accounting reports.'],
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
      description: 'Re-runs a stored event after a fix. Safe because handlers are idempotent.',
    },
  ],
  dataFlow: [
    'The provider sends a signed event.',
    'The endpoint verifies it, stores it in the inbox and answers 2xx.',
    'A relay publishes stored events to a queue; a processor applies each one to payments and the ledger in one transaction.',
    'A daily reconciliation compares the ledger with the provider and repairs gaps.',
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
        appearsAt: 6,
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
      ['endpoint', 'inbox'],
      ['inbox', 'queue'],
      ['queue', 'processor'],
      ['queue', 'dlq'],
      ['processor', 'db'],
      ['recon', 'db'],
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
        metrics: { users: '100K', requestsPerSecond: '50', p95Latency: '400 ms', errorRate: '0%' },
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
        metrics: { users: '100K', requestsPerSecond: '50', p95Latency: '400 ms', errorRate: '0%' },
        load: { endpoint: 18 },
      },
      {
        title: 'Work inside the request times out',
        narration:
          'At first the endpoint does everything before answering: it updates the payment and the ledger and sends the receipt. A busy sales day multiplies events, handlers slow down and responses miss the provider timeout. The provider retries, and every retry adds more load to an endpoint that is already behind.',
        tradeoff:
          'Inline processing is the simplest design and works at low volume. Under a spike it turns slowness into failures, and failures into retries, so load feeds on itself. The fix is to make the request do as little as possible and move the work behind it.',
        nodes: ['provider', 'endpoint', 'db'],
        travel: [['provider', 'endpoint']],
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
          'An inbox table joins the design. The raw event goes into it and the endpoint answers 2xx right away. No business logic runs inside the request.',
        tradeoff:
          'Doing the work inside the request is simpler, but a slow handler misses the provider timeout and triggers retries that pile up. Acknowledging first keeps the endpoint fast; in exchange we own retries, so the inbox must be durable.',
        nodes: ['endpoint', 'inbox'],
        travel: [['endpoint', 'inbox']],
        short: 'Store, 2xx',
        metrics: { users: '1M', requestsPerSecond: '2K', p95Latency: '40 ms', errorRate: '0%' },
        load: { endpoint: 30, inbox: 35 },
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
          'A relay polls the inbox for rows still marked as received and publishes them to a queue that gives retries with backoff and a visibility timeout. The endpoint itself never publishes.',
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
          'An event that keeps failing moves to a dead-letter queue and raises an alert. After a fix, it is replayed from the inbox.',
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
          'A daily job lists the provider payments and refunds for the period, compares them with the ledger and repairs or flags any difference.',
        tradeoff:
          'Reconciliation costs API calls and a job to maintain. Webhooks alone cannot prove that nothing was missed; comparing against the source of truth can.',
        nodes: ['recon', 'db'],
        travel: [['recon', 'db']],
        short: 'Reconcile',
        metrics: { users: '1M', requestsPerSecond: '2K', p95Latency: '40 ms', errorRate: '0%' },
        load: { recon: 70, db: 50 },
        traffic: [{ edge: ['recon', 'db'], kind: 'heavy' }],
      },
    ],
  },
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
          'At least once, made harmless by the provider event id. The handler flips the inbox row from received to processed with a conditional update in the same transaction as the payment, ledger and outbox writes. They commit together or not at all, so the ledger never disagrees with the payment state, and a redelivered message finds the row processed and does nothing. A unique key on each ledger entry (provider object id plus entry type) covers two different events, or an event and a reconciliation repair, that describe the same movement of money.',
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
          'An event that the provider never delivers is found by the daily reconciliation, so a missing payment or refund goes unnoticed for about a day at most.',
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
        'Queue redelivery count and the age of the oldest inbox row not yet processed, alarmed at a few minutes. That one metric also catches a stalled relay and a lost queue message.',
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
        'Money-changing events cannot be applied and their backlog grows, so orders stay pending after the customer has paid. Ingestion is unaffected, and events that need no fetch keep flowing.',
      detection:
        'Fetch error rate and the rate of 429 responses, with the age of the oldest queued message as the user-facing signal.',
      recovery:
        'These failures are retried with backoff and do not count toward the dead-letter limit, since the event is not at fault; a circuit breaker pauses the fetching handlers instead of burning attempts. When the API returns, the backlog drains at the rate limit. State is late, never wrong.',
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
      'The provider rate limit, not our hardware, sets the processing rate. Adding processors past about 50 concurrent handlers (20 fetches in flight, plus about 20 handlers for the events that need none) buys nothing, so the queue is sized to hold more than an hour of backlog and lag is an expected state with its own alarm threshold.',
      'Because the backlog is bounded by a limit we do not control, fetches are worth saving: one fetch per payment serves all of its events that are waiting, and events that change no money skip it.',
      'Half a terabyte of payloads in the transactional database is why the inbox is partitioned by day: the purge becomes dropping a partition instead of deleting 8.6 million rows.',
      'Reconciliation shares the API limit with the processor, so it runs off peak under its own budget of about 20 calls per second and must be resumable from a cursor.',
    ],
  },
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
