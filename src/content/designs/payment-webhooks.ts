import type { Design } from '../types';

export const paymentWebhooks: Design = {
  slug: 'payment-webhooks',
  title: 'Payment webhook processor',
  summary:
    'Turn payment provider webhooks into correct order and ledger updates: never lose an event, never apply one twice, and survive events that arrive late, out of order or not at all.',
  difficulty: 'Hard',
  requirements: {
    functional: [
      'Receive webhooks from a payment provider (payment succeeded, refunded, disputed).',
      'Verify that every webhook really comes from the provider.',
      'Update orders and the ledger exactly once in effect, whatever the delivery order.',
      'Find and repair events that were never delivered.',
    ],
    nonFunctional: [
      'Never lose an event, and keep the raw payload for audit and replay.',
      'Answer within the provider timeout, a few seconds at most.',
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
    'A processor picks it up and applies it to payments and the ledger in one transaction.',
    'A daily reconciliation compares the ledger with the provider and repairs gaps.',
  ],
  highLevel: {
    label: 'Run a payment event through the processor',
    intro:
      'Follow one "payment succeeded" event from the provider to the ledger. Press play, or step through the stages to see what happens and what each choice costs.',
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
      { id: 'inbox', title: 'Inbox table', detail: 'Unique event id', column: 2, row: 'middle' },
      { id: 'queue', title: 'Work queue', detail: 'Retries, backoff', column: 3, row: 'middle' },
      { id: 'dlq', title: 'Dead letters', detail: 'Alert + replay', column: 4, row: 'top' },
      {
        id: 'processor',
        title: 'Processor',
        detail: 'Idempotent handler',
        column: 4,
        row: 'middle',
      },
      {
        id: 'recon',
        title: 'Reconciliation',
        detail: 'Daily vs provider',
        column: 4,
        row: 'bottom',
      },
      { id: 'db', title: 'Payments + ledger', detail: 'One transaction', column: 5, row: 'middle' },
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
      },
      {
        title: 'Verify the signature',
        narration:
          'The endpoint checks the signature against the shared secret and rejects events whose timestamp is too old, which blocks replayed requests.',
        tradeoff:
          'A tight timestamp tolerance blocks replays but can reject real events when clocks drift, so use the window the provider recommends. Supporting two secrets at once lets the secret rotate without downtime.',
        nodes: ['endpoint'],
        travel: [],
      },
      {
        title: 'Store, then answer 2xx',
        narration:
          'The raw event goes into an inbox table and the endpoint answers 2xx right away. No business logic runs inside the request.',
        tradeoff:
          'Doing the work inside the request is simpler, but a slow handler misses the provider timeout and triggers retries that pile up. Acknowledging first keeps the endpoint fast; in exchange we own retries, so the inbox must be durable.',
        nodes: ['endpoint', 'inbox'],
        travel: [['endpoint', 'inbox']],
      },
      {
        title: 'Duplicates stop at the door',
        narration:
          'The inbox has a unique constraint on the provider event id. A redelivered event fails the insert and is acknowledged as already received.',
        tradeoff:
          'Deduplicating at insert is exact and cheap, as long as event ids are kept longer than the provider retry window. Keeping them for weeks costs little and also gives a full audit trail.',
        nodes: ['inbox'],
        travel: [],
      },
      {
        title: 'Hand off to a work queue',
        narration:
          'New inbox rows are published to a queue that gives retries with backoff and a visibility timeout.',
        tradeoff:
          'A managed queue scales and retries for us. At low volume, a worker polling the inbox table is simpler and has one less moving part, and it is easy to move to a queue later.',
        nodes: ['inbox', 'queue'],
        travel: [['inbox', 'queue']],
      },
      {
        title: 'Apply the event idempotently',
        narration:
          'The processor treats the payment as a state machine (pending, paid, refunded) and ignores transitions that would move it backwards. For important events it fetches the current object from the provider instead of trusting the payload.',
        tradeoff:
          'Fetching the latest object costs an API call per event, and in return arrival order stops mattering: a late "succeeded" after a "refunded" cannot undo the refund.',
        nodes: ['queue', 'processor'],
        travel: [['queue', 'processor']],
      },
      {
        title: 'One transaction for the money',
        narration:
          'The payment status, the ledger entry and the inbox row marked as processed are written in a single database transaction. Emails and other side effects go to an outbox and run after the commit.',
        tradeoff:
          'One transaction means the ledger can never disagree with the payment state. Moving side effects to an outbox adds a table and a worker, and keeps a crash from sending a receipt for a payment that was rolled back.',
        nodes: ['processor', 'db'],
        travel: [['processor', 'db']],
      },
      {
        title: 'Failures go to dead letters',
        narration:
          'An event that keeps failing moves to a dead-letter queue and raises an alert. After a fix, it is replayed from the inbox.',
        tradeoff:
          'Retrying forever hides bugs and blocks nothing visible; giving up silently loses money. A dead-letter queue with an alert makes every stuck event someone’s job, and replay is safe because handlers are idempotent.',
        nodes: ['queue', 'dlq'],
        travel: [['queue', 'dlq']],
      },
      {
        title: 'Reconcile every day',
        narration:
          'A daily job lists the provider payments and refunds for the period, compares them with the ledger and repairs or flags any difference.',
        tradeoff:
          'Reconciliation costs API calls and a job to maintain. Webhooks alone cannot prove that nothing was missed; comparing against the source of truth can.',
        nodes: ['recon', 'db'],
        travel: [['recon', 'db']],
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
          pros: 'Side effects are recorded in the same transaction and sent once after commit.',
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
};
