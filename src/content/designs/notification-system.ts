import type { Design } from '../types';

export const notificationSystem: Design = {
  slug: 'notification-system',
  title: 'Notification system',
  summary:
    'Send push, email and SMS on behalf of every product team: urgent messages in seconds while a campaign of millions drains, preferences and quiet hours respected, and one effect per notification and channel even when requests, queue messages and workers repeat.',
  difficulty: 'Medium',
  minutes: 12,
  requirements: {
    functional: [
      'Product services send a notification to one user through one API, naming a template. The template’s category (transactional, activity or marketing) sets the lane: urgent, standard or bulk.',
      'Deliver through push, email or SMS, respecting each user’s opt-outs, quiet hours and a daily cap on marketing messages.',
      'Start a campaign to millions of users with one request, and stop it halfway.',
      'Track every delivery to an end: sent or delivered, failed with a reason, or suppressed with a reason.',
      'Remove the device tokens and email addresses that providers report as dead.',
    ],
    nonFunctional: [
      'Urgent messages (sign-in codes, security alerts) reach the provider within 5 seconds for 99% of them, even while a campaign of 10 million is draining.',
      'About 2,000 notifications a second on average and 5,000 at peak, for 20 million users, plus campaigns of 10 million fanned out at 20,000 a second.',
      'An accepted notification is not dropped silently: the 202 is answered only after the message is stored in a queue across Availability Zones, and every delivery a worker picks up ends in a recorded status.',
      'One effect per notification and channel: requests, queue messages and workers can repeat, and a conditional write on the notification id and channel lets one of them send. The exception, a send whose answer was lost, is stated and bounded.',
      'A failing provider delays only its own channel (the two push platforms are one channel and wait together), a failing table delays sends but not acceptance, and neither turns a healthy message into a failure before its deadline.',
      'Callers are authenticated and limited to their own templates; phone numbers, addresses, tokens and message data are encrypted at rest and kept out of logs.',
    ],
    outOfScope: [
      'The template editor and the review of message content.',
      'Choosing a campaign’s audience and its start time: the caller hands over a file of user ids and starts the campaign when it wants it sent.',
      'An in-app inbox, web push and marketing by SMS. SMS here carries urgent messages only.',
      'Campaign analytics: opens, clicks and conversions.',
      'Digests that merge several notifications into one message.',
      'Falling back from one channel to another, such as an email when a push was not opened.',
      'Scheduling a single notification for a future time. The only delay the system adds on its own is quiet hours.',
    ],
  },
  entities: [
    {
      name: 'Notification',
      description:
        'One request to tell one user one thing: an id (a hash of the caller and its idempotency key, or of the campaign and the user), the user, the template and its version, the data, the lane, accepted at and expires at.',
    },
    {
      name: 'Delivery',
      description:
        'One per notification and channel, the unit that takes effect: status (sending, retry, deferred, sent, delivered, failed, suppressed), reason, claim token, lease end, provider, provider message id and timestamps. Kept 30 days.',
    },
    {
      name: 'User preferences',
      description:
        'Per user: opt-outs per channel and category, quiet hours with a time zone, locale, and the email address and phone number, each with a validity flag.',
    },
    { name: 'Device', description: 'One per push token: user, platform, token and updated at.' },
    {
      name: 'Template',
      description:
        'An immutable version per channel and locale, with placeholders, the channels it goes to and a category that sets the lane.',
    },
    {
      name: 'Campaign',
      description:
        'An id chosen by the caller, a template, an audience file, a status (running, cancelled or done), accepted at, the number of chunks and the set of chunks already fanned out.',
    },
    {
      name: 'Due row',
      description:
        'A delivery held back by quiet hours: the minute it is due and the message to put back on a queue.',
    },
    {
      name: 'Daily cap counter',
      description: 'Per user and day: the marketing messages claimed so far.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/notifications',
      description:
        'Body: userId, templateId, data, idempotencyKey. Answers 202 with a notificationId derived from the caller and the key, after the message is in its queue. The same key always returns the same id, and a repeat takes effect at most once per channel.',
    },
    {
      method: 'GET',
      path: '/notifications/{id}',
      description:
        'One delivery per channel with its status, reason and timestamps. A notification that no worker has picked up yet has no delivery, and the answer is 404.',
    },
    {
      method: 'POST',
      path: '/campaigns',
      description:
        'Body: campaignId, templateId, audience (a stored file with one user id per line). Answers 202 after the start message is queued. The campaignId is the idempotency key.',
    },
    {
      method: 'POST',
      path: '/campaigns/{id}/cancel',
      description:
        'Sets the campaign to cancelled from any state: not started yet, running or done. The status never moves back. Chunks not yet fanned out are dropped and queued messages are suppressed, within about 10 seconds.',
    },
    {
      method: 'GET',
      path: '/campaigns/{id}',
      description: 'The status and how many chunks of the audience are fanned out.',
    },
    {
      method: 'PUT',
      path: '/users/{id}/preferences',
      description:
        'Opt-outs, quiet hours, time zone and locale. Answers after the write, and every send that reads after it sees it.',
    },
    {
      method: 'PUT',
      path: '/users/{id}/devices/{token}',
      description:
        'Registers or refreshes a push token with its platform and sets updated at. DELETE removes it on sign-out.',
    },
  ],
  dataFlow: [
    'A service posts a notification. The API checks the caller and the template, derives the id, puts one message per channel on the queue of the template’s lane and answers 202.',
    'A worker of that channel and lane receives the message, reads the user’s preferences and addresses, and claims the delivery with a conditional write on the notification id and channel.',
    'The claim holder calls the provider within the lane’s budget and records the outcome with a second conditional write. Only then is the queue message deleted.',
    'A provider failure puts a delayed copy back on the queue until the message’s deadline; a standard push in quiet hours waits in a due table and is released when they end.',
    'A campaign is one request: a fan-out job splits the audience file into chunks and writes bulk messages, which drain at the provider budget without touching the urgent and standard lanes.',
    'Receipts from the email and SMS providers move deliveries to delivered or failed, and dead addresses and tokens are removed.',
  ],
  highLevel: {
    label: 'Run a notification through the system',
    intro:
      'Follow one notification from the service that asks for it to the provider that delivers it. The design grows one piece at a time: a claim that makes repeats harmless, a campaign that shows why each lane needs its own queue, retries that survive a provider outage, quiet hours and receipts. Numbers are illustrative. Press play, or step through the stages to see what happens and what each choice costs.',
    nodes: [
      {
        id: 'service',
        title: 'Product service',
        detail: 'Asks to notify',
        column: 0,
        row: 'middle',
      },
      {
        id: 'api',
        title: 'Notification API',
        detail: 'Check, queue, 202',
        column: 1,
        row: 'middle',
      },
      {
        id: 'fanout',
        title: 'Campaign fan-out',
        detail: 'Audience in chunks',
        column: 1,
        row: 'bottom',
        appearsAt: 3,
      },
      {
        id: 'urgent',
        title: 'Urgent queue',
        detail: 'Codes, alerts',
        column: 2,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'standard',
        title: 'Standard queue',
        detail: 'Activity',
        column: 2,
        row: 'middle',
      },
      {
        id: 'bulk',
        title: 'Bulk queue',
        detail: 'Campaigns',
        column: 2,
        row: 'bottom',
        appearsAt: 4,
      },
      {
        id: 'prefs',
        title: 'Users table',
        detail: 'Opt-outs, devices',
        column: 3,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'workers',
        title: 'Channel workers',
        detail: 'Claim, then send',
        column: 3,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'due',
        title: 'Due table',
        detail: 'Quiet hours',
        column: 3,
        row: 'bottom',
        appearsAt: 8,
      },
      {
        id: 'backup',
        title: 'Second SMS vendor',
        detail: 'Urgent only',
        column: 4,
        row: 'top',
        appearsAt: 6,
      },
      {
        id: 'providers',
        title: 'Providers',
        detail: 'Push, email, SMS',
        column: 4,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'log',
        title: 'Deliveries table',
        detail: 'One row per effect',
        column: 4,
        row: 'bottom',
        appearsAt: 1,
      },
      {
        id: 'receipts',
        title: 'Receipts',
        detail: 'Delivered, bounced',
        column: 5,
        row: 'middle',
        appearsAt: 9,
      },
    ],
    edges: [
      ['service', 'api'],
      ['api', 'urgent'],
      ['api', 'standard'],
      ['api', 'bulk'],
      ['api', 'fanout'],
      ['fanout', 'standard'],
      ['fanout', 'bulk'],
      ['urgent', 'workers'],
      ['standard', 'workers'],
      ['bulk', 'workers'],
      ['workers', 'prefs'],
      ['workers', 'due'],
      ['workers', 'backup'],
      ['workers', 'providers'],
      ['workers', 'log'],
      ['due', 'bulk'],
      ['providers', 'receipts'],
      ['receipts', 'log'],
    ],
    // Before the lanes exist, the fan-out job writes to the one queue there is.
    edgeStages: [{ edge: ['fanout', 'standard'], stages: [3] }],
    stages: [
      {
        title: 'Accept, answer 202, one id per repeat',
        narration:
          'A service posts a notification with an idempotency key. The API checks the caller and the template, derives the notification id as a hash of the caller and that key, puts a message on a queue and answers 202 Accepted with the id, before anything is sent. The queue stores the message in several Availability Zones before it acknowledges the send, and that acknowledgement is what the 202 waits for. A caller that times out and tries again gets the same id back, and its second message joins the queue next to the first. Nothing is deduplicated here: the repeat is made harmless later, where the send happens.',
        tradeoff:
          'Answering before sending keeps callers fast and independent of provider latency; the cost is that the outcome is a separate status call, which knows nothing about a notification until a worker picks it up. The queue is the only write in the request, so there is no second step to lose after a commit and no table whose outage would stop the API. Deriving the id needs no lookup, so a retry is always safe to accept; the cost is a wasted queue message per repeat, and a repeat with the same key and a different body is not noticed: whichever message is claimed first wins.',
        nodes: ['service', 'api', 'standard'],
        travel: [
          ['service', 'api'],
          ['api', 'standard'],
        ],
        short: 'Accept 202',
        metrics: { users: '20M', requestsPerSecond: '5K', p95Latency: '30 ms', errorRate: '0.01%' },
        load: { api: 25, standard: 15 },
      },
      {
        title: 'Claim, then send',
        narration:
          'A worker receives the message and claims the delivery: a conditional write of one row keyed by notification id and channel, which succeeds only if no row exists. The claim holder calls the provider and records the result with a second conditional write that checks its claim token. A second message for the same delivery finds the row and sends nothing. The queue message is deleted only after the result is recorded.',
        tradeoff:
          'The claim costs a write before every send and a row kept for 30 days, and it is what turns at-least-once queues and repeated requests into one send per notification and channel. A claim with a lease is not a lock on the provider: a worker that stalls between the claim and the call can still send late, which the lease margin makes unlikely and nothing makes impossible.',
        nodes: ['standard', 'workers', 'providers', 'log'],
        travel: [
          ['standard', 'workers'],
          ['workers', 'log'],
          ['workers', 'providers'],
        ],
        short: 'Claim',
        metrics: {
          users: '20M',
          requestsPerSecond: '5K',
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [{ label: 'To provider p99', value: '3 s' }],
        },
        load: { standard: 15, workers: 40, providers: 35, log: 30 },
      },
      {
        title: 'Read preferences at the last moment',
        narration:
          'Before it claims, the worker reads the user’s row with a consistent read: opt-outs, quiet hours, addresses and device tokens. An opted-out user, or one with no address on that channel, ends here with a delivery marked suppressed or failed and a reason. Transactional messages skip marketing opt-outs, quiet hours and the daily cap.',
        tradeoff:
          'Checking at accept time would save queueing messages nobody will get, but a message can wait minutes behind a campaign, and an opt-out made meanwhile would be ignored. One read per send, right before the claim, costs capacity and honours every opt-out written before it. A send already past that read still goes out, a window of seconds.',
        nodes: ['workers', 'prefs'],
        travel: [['workers', 'prefs']],
        short: 'Preferences',
        metrics: {
          users: '20M',
          requestsPerSecond: '5K',
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [{ label: 'To provider p99', value: '3 s' }],
        },
        load: { workers: 40, prefs: 30 },
      },
      {
        title: 'A campaign blocks sign-in codes',
        narration:
          'A caller starts a campaign of 10 million pushes through the API. A fan-out job reads the audience and, at first, writes every message to the one queue there is, 20,000 a second for about 8 minutes. Workers drain 10,000 a second, so 5 million messages are waiting when a sign-in code arrives. It waits about 8 minutes, longer than the 5 minutes the code is valid.',
        tradeoff:
          'More workers do not help: the push providers set the drain rate, and the code still waits behind everything queued before it. The messages differ in how long they can wait, and one queue cannot express that.',
        nodes: ['api', 'fanout', 'standard', 'workers'],
        travel: [
          ['api', 'fanout'],
          ['fanout', 'standard'],
          ['standard', 'workers'],
        ],
        short: 'Campaign',
        metrics: {
          users: '20M',
          requestsPerSecond: '5K',
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Fan-out', value: '20K/s' },
            { label: 'Queued', value: '5M' },
            { label: 'Code wait', value: '8 min', alert: true },
          ],
        },
        load: { api: 25, fanout: 80, standard: 98, workers: 95 },
        traffic: [{ edge: ['fanout', 'standard'], kind: 'heavy' }],
      },
      {
        title: 'A queue per lane',
        narration:
          'Two more queues join. The template’s category sets the lane, not the caller: the API puts transactional messages on urgent, activity on standard and marketing on bulk, and the fan-out job writes only to bulk. Each lane is in fact a queue per channel, seven in all because SMS carries urgent messages only; the diagram draws one box per lane.',
        tradeoff:
          'Seven queues with their dead-letter queues are more to run and to watch than one, and a campaign can no longer sit in front of a code. Fixing the lane on the template means a team cannot mark its promotion urgent to jump the line; the cost is that a new kind of message needs a template review before it can use the urgent lane.',
        nodes: ['api', 'fanout', 'urgent', 'standard', 'bulk'],
        travel: [
          ['api', 'urgent'],
          ['api', 'standard'],
          ['api', 'bulk'],
          ['fanout', 'bulk'],
        ],
        short: 'Lanes',
        metrics: {
          users: '20M',
          requestsPerSecond: '5K',
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Fan-out', value: '20K/s' },
            { label: 'Bulk queued', value: '5M' },
          ],
        },
        load: { api: 25, fanout: 80, urgent: 5, standard: 15, bulk: 95 },
        traffic: [{ edge: ['fanout', 'bulk'], kind: 'heavy' }],
      },
      {
        title: 'A pool and a budget per lane',
        narration:
          'Each queue has its own worker pool, and each pool its own share of the provider’s rate. A task holds a local token bucket sized as the lane’s budget divided by the pool’s maximum size, and takes one token per provider call, so a push to two devices takes two. A deploy replaces tasks without going over the pool’s maximum, so the bulk push pool, at most 20 tasks at 500 tokens a second, stays within 10,000 calls a second. Urgent pools have a fixed size with room to spare; the others grow with their backlog.',
        tradeoff:
          'Separate pools and fixed shares leave capacity idle: the urgent share is reserved even at night, and a bulk pool below its maximum size sends below its budget. In return there is no shared limiter to fail or to coordinate, and a campaign cannot spend the tokens a sign-in code needs.',
        nodes: ['urgent', 'standard', 'bulk', 'workers', 'providers'],
        travel: [
          ['urgent', 'workers'],
          ['standard', 'workers'],
          ['bulk', 'workers'],
          ['workers', 'providers'],
        ],
        short: 'Pools',
        metrics: {
          users: '20M',
          requestsPerSecond: '5K',
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Urgent to provider p99', value: '1 s' },
            { label: 'Bulk drain', value: '10K/s' },
            { label: 'Bulk wait, worst', value: '8 min' },
          ],
        },
        load: { urgent: 5, standard: 15, bulk: 90, workers: 70, providers: 70 },
        traffic: [{ edge: ['bulk', 'workers'], kind: 'heavy' }],
      },
      {
        title: 'Retry, break the circuit, switch vendor',
        narration:
          'A provider call that fails is tried up to three times inside one receive, with a 4-second timeout and a short backoff. If it still fails, the worker marks the delivery for retry, puts a delayed copy of the message on the queue and deletes the original, again and again until the message’s deadline passes and the delivery fails as expired. A task whose calls keep failing opens its circuit breaker and stops receiving, so that channel waits in its queue; the two push platforms share a queue and a pool per lane, so an outage of either delays both. Urgent SMS does not wait: its second and third calls go to a second vendor.',
        tradeoff:
          'A delayed copy is a second message, and a crash between the copy and the delete leaves two, which the claim absorbs. Returning the same message would be simpler, but the queue counts every receive, and a provider outage would push healthy messages into the dead-letter queue. A second vendor costs a contract and an integration, so only urgent SMS gets one, because a sign-in code is the one urgent message a user is blocked on, and a code can arrive twice when the first vendor accepted it and its answer was lost.',
        nodes: ['workers', 'providers', 'backup'],
        travel: [
          ['workers', 'providers'],
          ['workers', 'backup'],
        ],
        short: 'Retries',
        metrics: {
          users: '20M',
          requestsPerSecond: '5K',
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'SMS vendor errors', value: '60%', alert: true },
            { label: 'Urgent to provider p99', value: '4 s' },
          ],
        },
        load: { workers: 60, providers: 90, backup: 40 },
        traffic: [{ edge: ['workers', 'providers'], kind: 'failed' }],
      },
      {
        title: 'When the answer is lost',
        narration:
          'A worker dies after the provider accepted the message and before the result was written. The message comes back after its 30-second visibility timeout, by which time the 20-second lease has run out, and the next worker finds a claim with no result: it cannot know whether the user was notified. It takes the claim over with a conditional write on the old token and sends again, except for bulk email, which it records as failed with the reason outcome unknown.',
        tradeoff:
          'None of the providers here accepts an idempotency key, so this gap cannot be closed, only chosen. A push sent twice carries the notification id as its collapse identifier and shows as one notification. A sign-in code or an activity email sent twice is better than one not sent. A promotion sent twice is worse than one not sent, so bulk email gives up instead.',
        nodes: ['workers', 'providers', 'log'],
        travel: [
          ['workers', 'log'],
          ['workers', 'providers'],
        ],
        short: 'In doubt',
        metrics: {
          users: '20M',
          requestsPerSecond: '5K',
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Sends in doubt', value: 'under 0.01%' }],
        },
        load: { workers: 40, providers: 35, log: 30 },
      },
      {
        title: 'Hold for quiet hours',
        narration:
          'A standard push for a user inside quiet hours is not sent. In one transaction the worker marks the delivery deferred and writes a due row with the message and the minute the quiet hours end. A release task reads the rows that are due, puts their messages on the bulk queue and deletes the rows. Urgent messages ignore quiet hours, and a marketing push inside them is suppressed.',
        tradeoff:
          'The morning release has the shape of a campaign, about 1.3 million messages in its busiest minute, so it goes to the bulk lane, where bursts belong, and not to the standard lane, where it would delay live activity. The cost is that a held notification can wait behind a campaign for some minutes more.',
        nodes: ['workers', 'due', 'bulk'],
        travel: [
          ['workers', 'due'],
          ['due', 'bulk'],
        ],
        short: 'Quiet hours',
        metrics: {
          users: '20M',
          requestsPerSecond: '5K',
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Held per day', value: '5M' },
            { label: 'Largest release', value: '1.3M in 4.3 min' },
          ],
        },
        load: { workers: 40, due: 45, bulk: 40 },
      },
      {
        title: 'Receipts close the loop',
        narration:
          'The email and SMS providers report later what happened to each message. The events arrive on a queue, carry the notification id, channel and claim token that the worker attached to the send, and move the delivery from sent to delivered or to failed with a conditional write that checks the token, so a receipt from an abandoned attempt changes nothing. A hard bounce also marks the address invalid and a spam complaint opts the user out of marketing email, two writes by the receipt worker to the users table that the diagram does not draw. A push token that the provider calls unregistered is deleted from the users table by the worker that sent to it.',
        tradeoff:
          'Receipts make "sent" honest: accepted by the provider is not the same as received. Push has no receipt, so a push delivery ends at sent, and so does a code sent through the second SMS vendor, whose receipts are not collected. Cleaning dead addresses costs a write path, and it protects the sender reputation that the email provider measures, which a campaign to a stale list can damage for sign-in mail too.',
        nodes: ['providers', 'receipts', 'log', 'workers', 'prefs'],
        travel: [
          ['providers', 'receipts'],
          ['receipts', 'log'],
          ['workers', 'prefs'],
        ],
        short: 'Receipts',
        metrics: {
          users: '20M',
          requestsPerSecond: '5K',
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [{ label: 'Email bounce rate', value: '0.5%' }],
        },
        load: { providers: 35, receipts: 25, log: 35, prefs: 30 },
      },
      {
        title: 'Alarm on age per lane',
        narration:
          'Each queue alarms on the age of its oldest message: 3 seconds for urgent, 15 seconds for standard, 20 minutes for bulk. A message that makes workers crash five times moves to a dead-letter queue, where the first one pages someone. The age comes from the queue itself, so the alarm still works when every worker is down.',
        tradeoff:
          'Messages per second can look healthy while a backlog grows; the age of the oldest message is what users feel, and a threshold per lane matches what each lane promises. The queue reports once a minute, so the urgent alarm cannot be faster than that.',
        nodes: ['urgent', 'standard', 'bulk'],
        travel: [],
        short: 'Queue age',
        metrics: {
          users: '20M',
          requestsPerSecond: '5K',
          p95Latency: '30 ms',
          errorRate: '0.01%',
          custom: [
            { label: 'Urgent to provider p99', value: '1 s' },
            { label: 'Standard to provider p99', value: '3 s' },
          ],
        },
        load: { urgent: 5, standard: 15, bulk: 40 },
      },
    ],
  },
  flows: [
    {
      id: 'accept',
      title: 'Accept a notification',
      kind: 'sync',
      summary:
        'The sign-in service asks for a code to be sent to Ana. The API checks the request, puts one message on the urgent SMS queue and answers 202 in about 30 ms. Nothing has been sent yet.',
      runsOn: 'Internal ALB → Notification API on ECS Fargate → Amazon SQS',
      participants: [
        { id: 'service', label: 'Sign-in service', service: 'Internal caller' },
        { id: 'alb', label: 'Load balancer', service: 'Internal ALB' },
        { id: 'api', label: 'Notification API', service: 'ECS Fargate' },
        { id: 'sqs', label: 'Urgent SMS queue', service: 'SQS standard' },
      ],
      steps: [
        {
          from: 'service',
          to: 'alb',
          label: 'POST /notifications {userId, templateId, data, idempotencyKey}',
          note: 'TLS inside the network, on a load balancer that serves only this API. The caller presents a short-lived token from the company identity provider.',
        },
        {
          from: 'alb',
          to: 'api',
          label: 'forward',
          note: 'Tasks are stateless and spread over three Availability Zones; any of them can take any request.',
        },
        {
          from: 'api',
          to: 'api',
          label: 'check caller and template; id = hash(caller, key)',
          note: 'The template registry is cached in memory and refreshed every minute: it says which callers may use the template, which channels it goes to, its category and the data fields it needs. Versions are immutable, and the API pins the current one into the message. No store is read, so the API depends only on the queue.',
        },
        {
          from: 'api',
          to: 'sqs',
          label: 'SendMessage {id, userId, template@version, channel, data, expiresAt}',
          note: 'One message per channel of the template, on the queue of that channel and lane. A transactional template expires 5 minutes after it is accepted. If a template has two channels and one send fails, the answer is 503 and the caller repeats the request with the same key; the message that did get through is claimed once like any other.',
        },
        {
          from: 'sqs',
          to: 'api',
          label: 'MessageId',
          note: 'SQS answers after it has stored the message redundantly across Availability Zones. This is the durable write the 202 stands on.',
          style: 'reply',
        },
        {
          from: 'api',
          to: 'service',
          label: '202 {notificationId}',
          note: 'Any failure before this point is a 5xx, and the caller tries again with the same key. A request that never got its 202 was never promised.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'deliver',
      title: 'Deliver a sign-in code',
      kind: 'queue',
      summary:
        'A worker of the urgent SMS pool takes the message, reads Ana’s phone number, claims the delivery, sends the code and records the result, about a second after the 202.',
      runsOn:
        'Amazon SQS → SMS worker on ECS Fargate → Amazon DynamoDB → AWS End User Messaging SMS',
      participants: [
        { id: 'sqs', label: 'Urgent SMS queue', service: 'SQS standard' },
        { id: 'worker', label: 'SMS worker', service: 'ECS Fargate' },
        { id: 'users', label: 'Users table', service: 'DynamoDB' },
        { id: 'deliveries', label: 'Deliveries table', service: 'DynamoDB' },
        { id: 'sms', label: 'SMS provider', service: 'AWS End User Messaging SMS' },
      ],
      steps: [
        {
          from: 'sqs',
          to: 'worker',
          label: 'ReceiveMessage, long polling',
          note: 'The message becomes invisible for 30 seconds. If the worker dies, it comes back for another one. A message past its expiresAt is not sent: the worker records failed with the reason expired and deletes it.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'deliveries',
          label: 'GetItem (id, sms), consistent',
          note: 'No row: nobody has worked on this delivery. A row with a final status means a repeat, so the message is deleted. A row that another worker holds with a live lease is left alone: the message is not deleted and returns after the visibility timeout, when that row is either final or its lease has run out.',
        },
        {
          from: 'worker',
          to: 'users',
          label: 'Query userId, consistent',
          note: 'One query returns preferences and devices. The phone number is present and valid. A transactional message skips marketing opt-outs, quiet hours and the daily cap.',
        },
        {
          from: 'worker',
          to: 'deliveries',
          label: 'PutItem status=sending, token, leaseUntil=now+20 s IF attribute_not_exists',
          note: 'The claim. Of two workers holding two copies of this message, one write succeeds and the other fails its condition and sends nothing. The token is new for every claim.',
        },
        {
          from: 'worker',
          to: 'sms',
          label: 'SendTextMessage TimeToLive=max(time left, 5 s), Context={id, channel, token}',
          note: 'After taking a token from the task’s local bucket. The call has a 4-second timeout. TimeToLive makes the provider drop a code it could not hand off in time; the provider accepts no value below 5 seconds, so a send in the last seconds of a code asks for 5. The Context, with the notification id, the channel and the token of this claim, comes back in the delivery events.',
        },
        {
          from: 'sms',
          to: 'worker',
          label: 'MessageId',
          note: 'Accepted by the provider, which is not yet delivered to the phone.',
          style: 'reply',
        },
        {
          from: 'worker',
          to: 'deliveries',
          label: 'UpdateItem status=sent IF status=sending AND token=mine',
          note: 'The condition fails only if this worker lost its lease and another took the claim over, or if a receipt already moved the row on. Either way the row is not overwritten.',
        },
        {
          from: 'worker',
          to: 'sqs',
          label: 'DeleteMessage',
          note: 'Last, after the result is recorded. A crash before this redelivers a message whose row is already final.',
        },
      ],
    },
    {
      id: 'duplicate',
      title: 'A duplicate send request',
      kind: 'queue',
      summary:
        'The order service times out waiting for the 202 and sends the same request again. Both requests are queued, the id is the same, and one push is sent.',
      runsOn: 'Notification API on ECS Fargate → Amazon SQS → push worker → Amazon DynamoDB',
      participants: [
        { id: 'service', label: 'Order service', service: 'Internal caller' },
        { id: 'api', label: 'Notification API', service: 'ECS Fargate' },
        { id: 'sqs', label: 'Standard push queue', service: 'SQS standard' },
        { id: 'worker', label: 'Push worker', service: 'ECS Fargate' },
        { id: 'ddb', label: 'Deliveries table', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'service',
          to: 'api',
          label: 'POST /notifications key=order-77-shipped',
          note: 'The API queues message M1, but the 202 is lost on the way back and the caller times out.',
        },
        {
          from: 'service',
          to: 'api',
          label: 'POST /notifications key=order-77-shipped, again',
          note: 'The same caller and key hash to the same notification id. The API does not look anything up: it queues message M2 and answers 202 with that id.',
        },
        {
          from: 'api',
          to: 'sqs',
          label: 'SendMessage M2, same id',
          note: 'Two messages now describe one delivery. The queue can also deliver a single message twice on its own; the handling is the same.',
        },
        {
          from: 'sqs',
          to: 'worker',
          label: 'ReceiveMessage M1',
          note: 'The worker claims the delivery, sends the push, records sent and deletes M1, as in the normal flow.',
          style: 'async',
        },
        {
          from: 'sqs',
          to: 'worker',
          label: 'ReceiveMessage M2',
          note: 'Later, or at the same moment on another task.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'ddb',
          label: 'GetItem (id, push): status=sent',
          note: 'The delivery is final, so there is nothing to do. Had M2 arrived while the first worker still held the claim, its own claim would have failed the condition, and M2 would have been left to return after the visibility timeout and find the row final.',
        },
        {
          from: 'worker',
          to: 'sqs',
          label: 'DeleteMessage M2',
          note: 'A worker deletes a message only when the row is final, when the row is deferred and not yet due, or after it has queued a delayed copy. It never deletes on the strength of another worker’s live claim, because that message could be the only one left.',
        },
      ],
    },
    {
      id: 'campaign',
      title: 'Fan out a campaign to millions',
      kind: 'async',
      summary:
        'One request starts a push campaign to 10 million users. The audience file is cut into 370 chunks, and fan-out workers turn each chunk into bulk messages at 20,000 a second in total.',
      runsOn:
        'Notification API → Amazon SQS fan-out queue → fan-out workers on ECS Fargate → Amazon S3 → Amazon SQS bulk queue',
      participants: [
        { id: 'api', label: 'Notification API', service: 'ECS Fargate' },
        { id: 'fanq', label: 'Fan-out queue', service: 'SQS standard' },
        { id: 'fan', label: 'Fan-out worker', service: 'ECS Fargate' },
        { id: 'camp', label: 'Campaigns table', service: 'DynamoDB' },
        { id: 's3', label: 'Audience file', service: 'Amazon S3' },
        { id: 'bulk', label: 'Bulk push queue', service: 'SQS standard' },
      ],
      steps: [
        {
          from: 'api',
          to: 'fanq',
          label: 'SendMessage start {campaignId, templateId, audience, acceptedAt}',
          note: 'The caller’s POST /campaigns is answered 202 after this send, the same single write as for one notification. Only marketing templates may start a campaign.',
        },
        {
          from: 'fanq',
          to: 'fan',
          label: 'ReceiveMessage start',
          note: 'Any fan-out task can take it.',
          style: 'async',
        },
        {
          from: 'fan',
          to: 's3',
          label: 'HeadObject: 370 MB',
          note: 'Ten million ids of about 37 bytes each. The file is cut into byte ranges of 1 MB, about 27,000 ids per chunk.',
        },
        {
          from: 'fan',
          to: 'camp',
          label: 'PutItem status=running, chunks=370, acceptedAt IF attribute_not_exists',
          note: 'A second start message for the same campaign fails the condition, and so does a start that arrives after a cancel, because a cancel creates the row when it finds none. The worker then reads the row: running means the first attempt may have died halfway, so it goes on and queues the chunks again; cancelled or done means there is nothing left to queue, so it deletes the message and stops.',
        },
        {
          from: 'fan',
          to: 'fanq',
          label:
            'SendMessageBatch chunk {campaignId, n, byte range} × 370, then DeleteMessage start',
          note: 'Each chunk is its own message, so fan-out workers share the work and a crash costs one chunk, not the campaign. A batch can answer 200 with some entries failed; the worker sends those again and deletes the start message only when all 370 are queued. A crash before the delete queues the chunks twice. A repeat of a chunk whose number is already in the done set is skipped after the conditional done update of the last step, and a chunk that does run twice only writes bulk messages that the claim later absorbs.',
          style: 'async',
        },
        {
          from: 'fanq',
          to: 'fan',
          label: 'ReceiveMessage chunk n',
          note: 'A chunk takes about 11 seconds of sends, well inside the visibility timeout of the fan-out queue, which is set to 1 minute.',
          style: 'async',
        },
        {
          from: 'fan',
          to: 'camp',
          label: 'GetItem status and doneChunks, consistent',
          note: 'Running: go on, unless the done set already holds this chunk’s number, in which case the message is a repeat: the worker runs the conditional done update of the last step and then deletes it. Cancelled: delete the chunk message and send nothing. Done: every chunk is already fanned out, so this message is a repeat and is deleted.',
        },
        {
          from: 'fan',
          to: 's3',
          label: 'GetObject Range=bytes of chunk n',
          note: 'A line cut by the start of the range belongs to the previous chunk and is skipped; the worker reads past the end of the range to finish its last line.',
        },
        {
          from: 'fan',
          to: 'bulk',
          label: 'SendMessageBatch × 10, id = hash(campaignId, userId)',
          note: 'About 2,700 batches per chunk. Each task sends at most its share of 20,000 messages a second. The id depends only on the campaign and the user, so the same user queued twice is still one delivery. Entries that a batch reports as failed are sent again before the chunk is marked done.',
          style: 'async',
        },
        {
          from: 'fan',
          to: 'camp',
          label: 'UpdateItem ADD doneChunks {n}, then DeleteMessage chunk',
          note: 'Adding a number to a set gives the same result when it runs twice. A second conditional update sets the status to done when the set holds all 370 numbers and the status is still running, so done is reached only from running and never replaces cancelled. A repeat found in the set runs this update too, so a crash between the two updates does not leave a finished campaign running.',
        },
      ],
    },
    {
      id: 'failover',
      title: 'The SMS provider fails',
      kind: 'queue',
      summary:
        'The first SMS provider throttles or stops answering. The worker sends the sign-in code through the second vendor in the same receive, and once the task’s circuit breaker has opened, its next codes go there directly.',
      runsOn:
        'Amazon SQS → SMS worker on ECS Fargate → AWS End User Messaging SMS, then a second vendor',
      participants: [
        { id: 'sqs', label: 'Urgent SMS queue', service: 'SQS standard' },
        { id: 'worker', label: 'SMS worker', service: 'ECS Fargate' },
        { id: 'ddb', label: 'Deliveries table', service: 'DynamoDB' },
        { id: 'primary', label: 'SMS provider', service: 'AWS End User Messaging SMS' },
        { id: 'backup', label: 'Second SMS vendor', service: 'External' },
      ],
      steps: [
        {
          from: 'sqs',
          to: 'worker',
          label: 'ReceiveMessage',
          note: 'A sign-in code with about 5 minutes to live.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'ddb',
          label: 'claim: PutItem status=sending IF attribute_not_exists',
          note: 'The delivery is keyed by notification and channel, not by provider, so one claim covers both vendors.',
        },
        {
          from: 'worker',
          to: 'primary',
          label: 'SendTextMessage',
          note: 'The first of at most three calls in this receive.',
        },
        {
          from: 'primary',
          to: 'worker',
          label: 'ThrottlingException, or no answer in 4 s',
          note: 'An error answer means the provider did not take the message. No answer is different: the provider may have accepted it. The task’s breaker counts both, and opens when half of its last 20 calls to this provider failed.',
          style: 'reply',
        },
        {
          from: 'worker',
          to: 'backup',
          label: 'send the same text',
          note: 'The second and third calls of an urgent SMS go to the second vendor, with no backoff before the switch, since a backoff spares the provider that just failed and this is another one. While the breaker is open, every code goes there first; every 30 seconds one message is tried on the first provider, and it falls through to the second vendor if that fails. If the first call got no answer, Ana may receive the code twice, which is accepted for a sign-in code.',
        },
        {
          from: 'backup',
          to: 'worker',
          label: 'accepted',
          note: 'A little over 4 seconds after the 202 in the worst case of one timeout: the 4-second timeout plus the second vendor’s own answer, which is at the edge of the 5-second target. A task pays that timeout on about ten codes before its breaker opens, and on one probe every 30 seconds after that.',
          style: 'reply',
        },
        {
          from: 'worker',
          to: 'ddb',
          label: 'UpdateItem status=sent, provider=second IF token=mine',
          note: 'The condition is the token alone, so this result also replaces whatever an early receipt from the first provider wrote while the second call was running. A row whose provider is the second vendor takes no receipt, so the delivery ends at sent. If both vendors fail, the worker sets the status to retry, queues a copy of the message with a delay that doubles from 5 seconds, and deletes the original. Five minutes after the 202 the code has expired and the delivery ends as failed with the reason expired.',
        },
        {
          from: 'worker',
          to: 'sqs',
          label: 'DeleteMessage',
          note: 'After the result is recorded.',
        },
      ],
    },
    {
      id: 'opt-out',
      title: 'A user opts out mid-campaign',
      kind: 'queue',
      summary:
        'Ana turns off marketing email while a campaign message for her is already queued. The worker reads her preferences right before sending and records the delivery as suppressed.',
      runsOn: 'Notification API → Amazon DynamoDB; Amazon SQS → email worker on ECS Fargate',
      participants: [
        { id: 'settings', label: 'Settings service', service: 'Internal caller' },
        { id: 'api', label: 'Notification API', service: 'ECS Fargate' },
        { id: 'ddb', label: 'Users and deliveries', service: 'DynamoDB' },
        { id: 'sqs', label: 'Bulk email queue', service: 'SQS standard' },
        { id: 'worker', label: 'Email worker', service: 'ECS Fargate' },
      ],
      steps: [
        {
          from: 'settings',
          to: 'api',
          label: 'PUT /users/ana/preferences {marketing email: off}',
          note: 'The settings service has already checked that the request comes from Ana.',
        },
        {
          from: 'api',
          to: 'ddb',
          label: 'UpdateItem users: optOut.marketing.email = true',
          note: 'One write to the user’s row. There is no cache of preferences to invalidate.',
        },
        {
          from: 'api',
          to: 'settings',
          label: '200 OK',
          note: 'Answered after the write. From here on, every send that reads the row sees the opt-out.',
          style: 'reply',
        },
        {
          from: 'sqs',
          to: 'worker',
          label: 'ReceiveMessage: campaign email for Ana',
          note: 'Queued minutes ago, before she opted out.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'ddb',
          label: 'Query users ana, consistent',
          note: 'A consistent read returns the latest acknowledged write, so the opt-out is seen. A send whose read happened just before the write still goes out: that is the window, and it is as long as one send.',
        },
        {
          from: 'worker',
          to: 'ddb',
          label: 'PutItem delivery status=suppressed, reason=opted_out IF attribute_not_exists',
          note: 'The outcome is recorded, so the campaign owner can see why Ana got nothing, and a repeat of the message stops at the row.',
        },
        {
          from: 'worker',
          to: 'sqs',
          label: 'DeleteMessage',
          note: 'Nothing was sent, and the daily cap counter was not touched.',
        },
      ],
    },
    {
      id: 'invalid-token',
      title: 'A device token is invalid',
      kind: 'queue',
      summary:
        'Ana has two registered devices, and she removed the app from one of them. The push provider says so, the worker deletes that token and the notification still reaches the other device.',
      runsOn: 'Amazon SQS → push worker on ECS Fargate → Amazon DynamoDB → APNs',
      participants: [
        { id: 'sqs', label: 'Standard push queue', service: 'SQS standard' },
        { id: 'worker', label: 'Push worker', service: 'ECS Fargate' },
        { id: 'ddb', label: 'Users and deliveries', service: 'DynamoDB' },
        { id: 'apns', label: 'Push provider', service: 'APNs (external)' },
      ],
      steps: [
        {
          from: 'sqs',
          to: 'worker',
          label: 'ReceiveMessage',
          note: 'A standard notification: someone commented on her post.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'ddb',
          label: 'Query users ana: two device tokens; claim the delivery',
          note: 'One delivery covers all of the user’s devices, at most the ten most recently updated. The worker calls them concurrently, each within the same three-call budget, so ten devices take no longer than one; the two calls are drawn one after the other only to tell them apart.',
        },
        {
          from: 'worker',
          to: 'apns',
          label: 'POST /3/device/{token A}, apns-collapse-id=id, apns-expiration',
          note: 'The collapse identifier is the notification id, so a copy sent again in doubt merges into the same notification on the device. The expiration is the message’s own deadline. For Android the same id goes in the notification tag.',
        },
        {
          from: 'apns',
          to: 'worker',
          label: '410 Unregistered {timestamp}',
          note: 'The token is no longer active for this app. The timestamp is the moment the provider confirmed that. The Android provider answers 404 UNREGISTERED in the same situation.',
          style: 'reply',
        },
        {
          from: 'worker',
          to: 'ddb',
          label: 'DeleteItem device A IF updatedAt <= timestamp',
          note: 'The condition keeps a token that the app registered again after the provider’s timestamp. Without it, a late answer could delete a token that is valid again. The Android answer carries no timestamp, so there the condition is that updatedAt still equals the value the worker read.',
        },
        {
          from: 'worker',
          to: 'apns',
          label: 'POST /3/device/{token B}',
          note: 'The other device, in the same receive and at the same time as the call for token A.',
        },
        {
          from: 'apns',
          to: 'worker',
          label: '200',
          note: 'Accepted for delivery. There is no later receipt for a push.',
          style: 'reply',
        },
        {
          from: 'worker',
          to: 'ddb',
          label: 'UpdateItem status=sent, devices=1 of 2 IF status=sending AND token=mine',
          note: 'Sent means at least one device accepted, and a device whose calls all failed while another accepted is not retried. If no device accepts and a call failed or timed out, the delivery goes to retry like any failed send. If every token had been invalid, the delivery would end as failed with the reason no valid token. Then the message is deleted.',
        },
      ],
    },
    {
      id: 'quiet-hours',
      title: 'Hold a push through quiet hours',
      kind: 'scheduled',
      summary:
        'A comment notification arrives for Ana at 23:10 her time, inside her quiet hours of 22:00 to 08:00. It is stored with its due minute, released at 08:00 and sent a few minutes later.',
      runsOn:
        'Amazon SQS → push worker → Amazon DynamoDB; release task on ECS Fargate → Amazon SQS bulk queue',
      participants: [
        { id: 'sqs', label: 'Standard push queue', service: 'SQS standard' },
        { id: 'worker', label: 'Push worker', service: 'ECS Fargate' },
        { id: 'ddb', label: 'Deliveries and due', service: 'DynamoDB' },
        { id: 'release', label: 'Release task', service: 'ECS Fargate' },
        { id: 'bulk', label: 'Bulk push queue', service: 'SQS standard' },
      ],
      steps: [
        {
          from: 'sqs',
          to: 'worker',
          label: 'ReceiveMessage at 23:10 local',
          note: 'The worker reads Ana’s row: quiet hours 22:00 to 08:00 in her time zone. The message is standard, so it is held; an urgent one would be sent and a marketing one suppressed.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'ddb',
          label:
            'TransactWriteItems: delivery status=deferred, dueAt=08:00; due row {shard, minute, message}',
          note: 'Both rows or neither. The delivery write has the same condition as a claim, so a repeat of the message cannot defer twice. The due row lives under one of 64 shard keys, so the writes of a whole night never crowd one partition.',
        },
        {
          from: 'worker',
          to: 'sqs',
          label: 'DeleteMessage',
          note: 'The message now lives in the due row. A crash before this delete redelivers a message whose delivery is already deferred and not yet due, and the worker deletes it.',
        },
        {
          from: 'release',
          to: 'ddb',
          label: 'Query shard s: due minute <= now',
          note: 'One task runs a loop per shard, all 64 in parallel, all day, so the deletes of the morning burst are spread at about 80 a second per shard key and never land on one. The sort key starts with the due minute, so each query returns exactly the rows whose time has come, oldest first, with no cursor to keep.',
        },
        {
          from: 'release',
          to: 'bulk',
          label: 'SendMessageBatch × 10',
          note: 'Released messages go to the bulk queue of their channel, up to 5,000 a second. The busiest minute of the morning holds about 1.3 million and takes about 4.3 minutes to release.',
          style: 'async',
        },
        {
          from: 'release',
          to: 'ddb',
          label: 'BatchWriteItem: delete the released due rows',
          note: 'After the sends, and only for rows whose batch entry succeeded; a row whose entry failed stays and is released on the next loop. A crash in between releases those rows again on the next loop, and the claim lets one of the copies send.',
        },
        {
          from: 'bulk',
          to: 'worker',
          label: 'ReceiveMessage at about 08:05',
          note: 'A worker of the bulk push pool. It reads Ana’s row again, since she may have opted out during the night.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'ddb',
          label: 'claim: UpdateItem status=sending IF status=deferred AND dueAt <= now + 1 s',
          note: 'Then it sends and records the result as usual. A released message is sent even if Ana changed her quiet hours after it was held; the new hours apply to later notifications. The second in the condition is the assumed clock difference: the release task sends a message only when its minute has come on its own clock, so a worker whose clock is up to a second behind still finds it due.',
        },
      ],
    },
    {
      id: 'receipt',
      title: 'An email bounces',
      kind: 'async',
      summary:
        'An activity email to an address that no longer exists bounces a few seconds after it was sent. The receipt moves the delivery to failed and marks the address invalid, so the next email to it is not attempted.',
      runsOn: 'Amazon SES → Amazon SNS → Amazon SQS → receipt worker on ECS Fargate → DynamoDB',
      participants: [
        { id: 'ses', label: 'Email provider', service: 'Amazon SES' },
        { id: 'sns', label: 'Events topic', service: 'Amazon SNS' },
        { id: 'q', label: 'Receipts queue', service: 'SQS standard' },
        { id: 'rw', label: 'Receipt worker', service: 'ECS Fargate' },
        { id: 'ddb', label: 'Deliveries and users', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'ses',
          to: 'sns',
          label: 'Bounce event, bounceType=Permanent, tags {id, channel, token}',
          note: 'The email worker sent with a configuration set that publishes events, and attached the notification id, the channel and its claim token as message tags, which come back in every event.',
          style: 'async',
        },
        {
          from: 'sns',
          to: 'q',
          label: 'deliver to the subscribed queue',
          note: 'SMS delivery events arrive on the same topic. The queue lets the receipt worker fall behind without losing events.',
          style: 'async',
        },
        {
          from: 'q',
          to: 'rw',
          label: 'ReceiveMessage',
          note: 'Receipts are delivered at least once and in no particular order.',
          style: 'async',
        },
        {
          from: 'rw',
          to: 'ddb',
          label:
            'UpdateItem delivery status=failed, reason=bounced IF token=event token AND status IN (sending, sent, delivered)',
          note: 'The token ties the receipt to the attempt the row records: a receipt from an attempt that was taken over carries an older token and fails the condition, so it changes nothing on the delivery, and neither does one that finds the row in retry. The condition also requires that the row’s provider is not the second SMS vendor, so a late event from the first provider cannot overwrite a code the second one delivered. A second copy of the event finds the row already failed and changes nothing. Sending is in the list because a receipt can overtake the worker’s own write of sent, which then fails its condition and is dropped. A delivered event moves only a row that is sending or sent, so it cannot undo a bounce.',
        },
        {
          from: 'rw',
          to: 'ddb',
          label: 'UpdateItem users SET emailValid=false IF email = bounced address',
          note: 'Only a permanent bounce does this, and it runs whatever the delivery update before it answered, so an event delivered again after a crash between the two writes still marks the address. The condition spares an address the user has changed since. Later emails to this user end at once as failed with the reason no address.',
        },
        {
          from: 'rw',
          to: 'q',
          label: 'DeleteMessage',
          note: 'A receipt that fails five times goes to a dead-letter queue. The delivery then stays at sent, which is true as far as it goes.',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'How do we accept a notification without losing it or queueing its work twice?',
      options: [
        {
          name: 'Write a row, then enqueue',
          pros: 'The status call can answer from the first millisecond.',
          cons: 'Two writes: a crash between them leaves an accepted row that nothing will ever send, unless a sweeper looks for such rows.',
        },
        {
          name: 'Write a row and let its change stream feed the queues',
          pros: 'One write in the request, and the stream replays what a crashed relay missed.',
          cons: 'A campaign’s rows and a sign-in code’s row share the stream, so the code waits behind the campaign unless every lane gets its own table, and the stream adds its delay to the urgent path.',
        },
        {
          name: 'The queue is the first durable write',
          pros: 'One write, no relay and no sweeper; the API needs only the queue to be up. A repeat is absorbed later by the claim.',
          cons: 'The status call returns 404 until a worker picks the message up, and a repeat with a different body is not detected.',
        },
      ],
      choice:
        'The queue is the first durable write. The id is derived from the caller and the idempotency key, so the API can answer a repeat with the same id without reading anything, and the conditional claim on notification id and channel is the one place where repeats stop.',
    },
    {
      question: 'How do we get one effect per notification and channel from at-least-once parts?',
      options: [
        {
          name: 'Trust the queue',
          pros: 'Nothing to build.',
          cons: 'A redelivery after a worker crash, or a repeated request, sends the message again.',
        },
        {
          name: 'Check the delivery log before sending',
          pros: 'One lookup per send catches most repeats.',
          cons: 'Two workers can both read "not sent" and both send: a read followed by a send is not atomic.',
        },
        {
          name: 'Claim with a conditional write, send, then record',
          pros: 'Of any number of workers, one write succeeds. The claim token fences a worker that lost its lease from overwriting the result.',
          cons: 'A write before every send, and a crash between the provider’s answer and the result leaves a claim nobody can interpret.',
        },
        {
          name: 'Also pass an idempotency key to the provider',
          pros: 'Would close the last gap.',
          cons: 'None of the providers used here accepts one on a send.',
        },
      ],
      choice:
        'Claim with a conditional write on notification id and channel, send, then record the result with a write that checks the claim token. Delivery is at least once to the workers and made harmless by that key. What the claim cannot cover, a send whose answer was lost, gets its own decision in the next deep dive.',
    },
    {
      question: 'What do we do when we cannot know whether the provider sent it?',
      options: [
        {
          name: 'Always send again',
          pros: 'No message is missed.',
          cons: 'The user can get the same email or text twice.',
        },
        {
          name: 'Never send again',
          pros: 'No visible duplicate.',
          cons: 'A sign-in code can be dropped because a worker crashed at the wrong moment.',
        },
        {
          name: 'Decide by what a duplicate costs',
          pros: 'Each kind of message gets the failure it tolerates best.',
          cons: 'Two behaviours to explain and to test.',
        },
      ],
      choice:
        'Decide by what a duplicate costs. A push is sent again, because the notification id travels as the collapse identifier on iOS and as the notification tag on Android, and the second copy replaces the first on the device. Urgent and standard email and SMS are sent again and may show twice. Bulk email is not sent again: a call that got no answer, or a claim found with an expired lease, ends the delivery as failed with the reason outcome unknown. The takeover is a conditional write on the old claim token, so two workers cannot both take it.',
    },
    {
      question: 'How do we keep a campaign from delaying a sign-in code?',
      options: [
        {
          name: 'A priority field in one queue',
          pros: 'One queue to run.',
          cons: 'The queue does not order by a field, so the code waits behind every message already queued: about 8 minutes behind 5 million.',
        },
        {
          name: 'A queue per lane, one shared worker pool that polls urgent first',
          pros: 'Urgent messages jump the line, and no capacity sits idle.',
          cons: 'Workers busy with bulk sends still hold the provider’s rate, and a slow bulk provider call ties up the slots an urgent message needs.',
        },
        {
          name: 'A queue, a worker pool and a share of the provider rate per lane',
          pros: 'Nothing is shared between lanes that a campaign could use up.',
          cons: 'Reserved capacity is idle most of the day, and there are more pools to size.',
        },
      ],
      choice:
        'A queue, a pool and a share of the provider rate per lane and channel, with the lane decided by the template’s category and not by the caller. Isolation by construction is easier to reason about than a priority rule, and its cost, idle urgent capacity, is small next to a sign-in that fails.',
    },
    {
      question: 'How do we not overwhelm providers or users?',
      options: [
        {
          name: 'Send as fast as workers can',
          pros: 'Simple.',
          cons: 'Hits provider quotas, where every rejected call is wasted work, and can send one user ten promotions in a day.',
        },
        {
          name: 'A central token bucket in a shared store',
          pros: 'Uses the whole provider quota whatever the number of tasks.',
          cons: 'A new store on the path of every send: its outage stops all sending, and its latency is added to each call.',
        },
        {
          name: 'A fixed share per task, and a per-user counter in the users table',
          pros: 'No shared limiter: a task’s bucket is the lane budget divided by the pool’s maximum size. The daily cap is a conditional update in the same transaction as the claim.',
          cons: 'A pool below its maximum size sends below its budget, and the cap costs a transactional write on every marketing claim.',
        },
      ],
      choice:
        'A fixed share per task and a per-user counter. The bulk push budget is 10,000 a second, which with the standard lane keeps the Android provider at about 73% of its default quota. Marketing is capped at 3 messages per user per day: the first claim of a marketing delivery also increments the day’s counter if it is below 3, and a claim that fails on the counter records the delivery as suppressed with the reason frequency cap. Urgent and standard messages are exempt.',
    },
    {
      question: 'What happens to queued messages when a provider is down?',
      options: [
        {
          name: 'Fail the receive and let the queue redeliver',
          pros: 'The queue already retries.',
          cons: 'The queue counts every receive, so after five an outage moves healthy messages to the dead-letter queue.',
        },
        {
          name: 'Hold the message and retry in place',
          pros: 'The receive count does not grow.',
          cons: 'Every waiting message holds a worker slot and counts as in flight, and a long outage holds them all.',
        },
        {
          name: 'Put a delayed copy back, stop receiving, and let the deadline decide',
          pros: 'Messages wait in the queue untouched; the only messages that cycle are the few in flight when the breaker opened, and they never use up receives.',
          cons: 'A copy is a second message, so the design must already tolerate repeats, which it does.',
        },
      ],
      choice:
        'After three failed calls in a receive, the worker sets the delivery to retry, queues a copy with a delay that doubles from 5 seconds up to the queue’s 15-minute maximum, and deletes the original. Each task has a circuit breaker per provider that opens when half of its last 20 calls failed and then stops receiving, trying one message every 30 seconds. The bound is the message’s deadline: 5 minutes for urgent, 24 hours for standard and bulk, after which the delivery ends as failed with the reason expired. Only urgent SMS has a second vendor: a sign-in code is the one urgent message a user is blocked on, while an urgent push or email alert that outlasts 5 minutes of outage is accepted as expired.',
    },
    {
      question: 'How does a campaign to millions of users start, and stop?',
      options: [
        {
          name: 'The caller sends one request per user',
          pros: 'No new component.',
          cons: 'Ten million API calls from one service, mixed with normal traffic and impossible to stop once sent.',
        },
        {
          name: 'One long job walks the audience with a saved cursor',
          pros: 'One request starts it.',
          cons: 'A single worker sets the pace, and the cursor needs an owner: two jobs resuming from the same cursor must be fenced.',
        },
        {
          name: 'The audience is cut into chunk messages on a queue',
          pros: 'Any number of workers share the chunks, a crash repeats one chunk, and there is no cursor to own.',
          cons: 'A chunk can run twice, so every message it writes must be safe to write twice.',
        },
      ],
      choice:
        'Chunk messages on a fan-out queue. The id of each bulk message is a hash of the campaign and the user, so a chunk that runs twice changes nothing a user can see. Stopping is one write that sets the campaign to cancelled whatever state it is in. It creates the row if the start message has not been processed yet, and it applies after the status is done too, when the fan-out has finished and millions of messages still wait in the bulk queue. Nothing writes over cancelled: the start write requires that no row exists, and done is set only from running. Fan-out workers read the status before each chunk, and bulk workers read it through a 10-second in-memory cache before each send and record the delivery as suppressed with the reason campaign cancelled. The cache can serve "running" for up to 10 seconds after the cancel, which is the stated delay.',
    },
    {
      question: 'When do we check preferences?',
      options: [
        {
          name: 'At accept time, in the API',
          pros: 'Messages nobody will receive are never queued.',
          cons: 'A message can wait many minutes in the bulk lane or hours in quiet hours; an opt-out made meanwhile is ignored, and the API gains a dependency on the users table.',
        },
        {
          name: 'At send time, from a cache',
          pros: 'No read per send.',
          cons: 'A cached entry can be filled just before an opt-out and served after it, so the opt-out is late by the cache’s lifetime.',
        },
        {
          name: 'At send time, with a consistent read',
          pros: 'Every opt-out acknowledged before the read is honoured, with no cache to invalidate.',
          cons: 'One read per send, 15,000 a second at peak.',
        },
      ],
      choice:
        'A consistent read of the user’s row right before the claim. The same query returns the addresses and device tokens the send needs anyway, so the opt-out check costs nothing extra.',
    },
    {
      question: 'How do we hold a notification through quiet hours?',
      options: [
        {
          name: 'Suppress it',
          pros: 'Nothing to store.',
          cons: 'The user never learns that someone commented overnight.',
        },
        {
          name: 'Keep it in the queue, invisible',
          pros: 'No new table.',
          cons: 'A visibility timeout lasts at most 12 hours, a standard queue allows about 120,000 messages in flight, and a night holds millions.',
        },
        {
          name: 'Send it again with a delay until morning',
          pros: 'Only the queue is involved.',
          cons: 'A delay is at most 15 minutes, so a 10-hour hold is 40 hops for every message.',
        },
        {
          name: 'A due table and a release task',
          pros: 'A row per held message, read back in time order when it is due.',
          cons: 'One more table and one more task to watch.',
        },
      ],
      choice:
        'A due table with 64 shard keys, written in the same transaction that marks the delivery deferred, and one release task that moves due rows to the bulk queue. Only standard pushes are held. Urgent messages ignore quiet hours, marketing pushes inside them are suppressed, and email is not held at all.',
    },
    {
      question: 'How do we know what happened after the provider accepted?',
      options: [
        {
          name: 'Stop at "sent"',
          pros: 'Nothing more to build.',
          cons: 'A bounced email and a delivered one look the same, and dead addresses are mailed forever.',
        },
        {
          name: 'Poll the provider for each message',
          pros: 'No inbound path.',
          cons: 'Millions of calls for answers that mostly never change.',
        },
        {
          name: 'Provider events on a queue, carrying our ids',
          pros: 'The provider pushes each outcome once it knows it, and the notification id, channel and claim token attached at send time come back in the event.',
          cons: 'Events are at least once and unordered, so every update must be conditional.',
        },
      ],
      choice:
        'Events from the email and SMS providers through one topic and one queue. Each update is conditional on the claim token carried in the event and on the current status, so a repeated or late event, or one from an attempt that was abandoned, changes nothing: delivered moves only a row that is sending or sent, and a bounce may also move a delivered one. A permanent bounce marks the address invalid and a complaint opts the user out of marketing email. Push ends at sent, because the push providers send no receipt, and so does a code sent through the second SMS vendor, whose receipts are not collected.',
    },
    {
      question: 'Who may send what, and what happens to personal data?',
      options: [
        {
          name: 'Any internal service may send any template',
          pros: 'No registry to maintain.',
          cons: 'One compromised or careless service can text every user, or mark a promotion as a security alert.',
        },
        {
          name: 'Callers authenticated and bound to their templates, data minimised',
          pros: 'A caller can use only the templates registered for it, and the template fixes the lane and the channels.',
          cons: 'A registry to keep, and a review step before a new urgent template.',
        },
      ],
      choice:
        'Callers present a short-lived token and are checked against the template’s list of allowed callers. Phone numbers, addresses and tokens live in one table encrypted with a KMS key, and each worker pool’s role can read only that table, its own queues and its own provider secret, held in Secrets Manager. Queue messages are encrypted at rest and carry the data for the template, which can include a sign-in code, so their bodies are never logged. A body can stay in a queue for its retention, 4 days or 14 in a dead-letter queue; only sending stops at the lane’s deadline. The deliveries table stores statuses and ids, not rendered text. Marketing email carries a signed unsubscribe link, and email is sent from a domain with SPF, DKIM and DMARC in place.',
    },
  ],
  wrapUp:
    'One API that queues and answers 202; an id derived from the idempotency key; a conditional claim per notification and channel that makes every repeat harmless; a queue, a pool and a provider budget per lane so a campaign cannot delay a sign-in code; preferences read right before the send; delayed copies and a deadline in place of endless retries; and receipts that turn sent into delivered or failed.',
  guarantees: {
    provides: [
      {
        property: 'Acceptance',
        promise:
          'A 202 is answered only after the queue has stored the message redundantly across Availability Zones. There is no second write after it that could be lost: the delivery row is created by the worker that receives the message.',
      },
      {
        property: 'One effect per notification and channel',
        promise:
          'Messages reach workers at least once, made harmless by the conditional claim on notification id and channel: of any number of repeated requests, queue redeliveries and workers, one claim succeeds and sends. A result is written only by the holder of the current claim token. The stated exception is a send in doubt, which is repeated for everything except bulk email.',
      },
      {
        property: 'Completion',
        promise:
          'Every delivery a worker picks up ends as sent or delivered, failed with a reason, or suppressed with a reason. Retries are bounded by the message’s deadline, 5 minutes for urgent and 24 hours for standard and bulk, after which the delivery fails as expired. No worker starts a send after the deadline.',
      },
      {
        property: 'Lane isolation',
        promise:
          'Urgent, standard and bulk messages share no queue, no worker pool and no provider budget, so a campaign of any size, or a provider outage on one channel, cannot take queue position, worker slots or provider tokens from another lane or channel. The lanes do share the deliveries and users tables, which are pre-warmed to the campaign peak.',
      },
      {
        property: 'Preferences',
        promise:
          'An opt-out acknowledged before a worker’s read of the user’s row is honoured by that send, because the read is consistent and there is no cache. Urgent messages are exempt from marketing opt-outs, quiet hours and the daily cap, by design.',
      },
      {
        property: 'Idempotent requests',
        promise:
          'The same caller and idempotency key always produce the same notification id, and a repeat has no further effect for as long as the delivery row exists, which is at least 30 days.',
      },
      {
        property: 'Campaign stop',
        promise:
          'After a cancel is acknowledged, whether the campaign had not started, was running or was done fanning out, no new chunk is fanned out, and queued messages of that campaign are suppressed once a worker’s cached status is at most 10 seconds old.',
      },
    ],
    assumes: [
      'The queue delivers every stored message at least once, and the table supports conditional writes, transactions and consistent reads.',
      'The clocks of the workers and the release task agree within a second. The 20-second lease is longer than the longest handling of 13.5 seconds, which also holds for a push to several devices because their calls run concurrently, and shorter than the 30-second visibility timeout, so a message that returns finds its old lease expired.',
      'Callers reuse the idempotency key when they retry, and do not reuse a key for different content.',
      'Delivery rows live longer than any message that could refer to them: rows are kept 30 days, queues keep messages 4 days and no message is sent after 24 hours.',
      'The push providers merge notifications that carry the same collapse identifier or tag, and the email and SMS providers return the tags or context attached to a send in their events.',
      'An audience file does not change while its campaign is fanned out.',
      'Templates are immutable versions, so a message renders the same on every attempt.',
    ],
    doesNotGuarantee: [
      'A single copy of an urgent or standard email or SMS. When a send is in doubt, it is sent again, and the user can see it twice.',
      'That a bulk email in doubt arrived. It is recorded as failed with the reason outcome unknown, although the provider may have sent it.',
      'Arrival on the device. A push ends at sent: the push providers give no receipt, they drop a message that passes its expiration, and one of them stores a single notification per app for a device that is offline. A code sent through the second SMS vendor ends at sent too, because its receipts are not collected.',
      'Independence of the two push platforms. They share a queue and a pool per lane, so an outage of either provider delays pushes to both, and a user with devices on both can get a notification on one device only: sent means at least one device accepted, and the device that failed is not retried.',
      'Order between two notifications for the same user. Queues do not keep order, and lanes drain at different speeds.',
      'A status right after the 202. Until a worker picks the message up, the status call answers 404.',
      'That an opt-out or a cancel stops a send already past its check. The window is one send for an opt-out and about 10 seconds for a cancel.',
      'The exact minute a held notification arrives. It is released within minutes of the end of quiet hours and then waits in the bulk lane.',
      'That a change of quiet hours moves a notification already held. It is released at the minute stored when it was held and sent then; the new hours apply to later notifications.',
      'Detection of a reused idempotency key with a different body. The first message claimed wins.',
      'An exact daily cap. A claimed marketing message that then fails still uses one of the day’s three.',
      'Lanes that are independent of the tables. Every lane claims in the same deliveries table, so a throttled or unavailable table slows all of them until it recovers.',
      'A recorded status for a message that waits more than 4 days in a queue nobody drains. The queue drops it at the end of its retention.',
      'A fan-out that finishes on its own through an outage of what it depends on. If the audience file, the campaigns table or a bulk queue fails for several minutes during a fan-out, the chunks received in that time reach the dead-letter queue after five receives, and a redrive finishes the campaign, which is safe because chunks in the done set are skipped after the conditional done update.',
      'That a dead letter resolves on its own. A message that crashes workers waits in the dead-letter queue for a person, and its delivery has no final status until it is redriven.',
    ],
  },
  failures: [
    {
      scenario:
        'A worker crashes after the provider accepted the message and before it recorded the result.',
      impact:
        'The delivery row says sending, with a lease that runs out. Nobody knows whether the user was notified. The message is late by one visibility timeout, 30 seconds.',
      detection:
        'A custom count of claims taken over and of deliveries ended as outcome unknown, alarmed above 0.1% of sends. A few are normal during a deploy that kills tasks; workers drain what they hold on a stop signal to keep it rare.',
      recovery:
        'The message returns, and the next worker takes the claim over with a conditional write on the old token. It sends again, where a push merges on the device and an urgent or standard email or SMS may show twice, or, for bulk email, it records failed with the reason outcome unknown. Every delivery ends in a recorded status.',
    },
    {
      scenario: 'A push provider answers errors or times out for half an hour.',
      impact:
        'Pushes wait on both platforms, in every lane: a lane has one push queue and one pool for the two providers, and a task stops receiving when its breaker for either provider opens, after half of its last 20 calls to that provider fail, so messages stay in their queues. Email and SMS are unaffected, because nothing is shared with them. While a task still receives, a user with devices on both platforms gets the push on the healthy one and the delivery ends as sent; the device on the failing platform misses that notification. Urgent pushes older than 5 minutes fail as expired.',
      detection:
        'The provider error rate and breaker state published by workers, and the age of the oldest message on the push queues, which comes from the queue and fires even if the workers are gone.',
      recovery:
        'Every 30 seconds a task tries one message; one whose user has no device on the failing platform is simply sent, and the next one probes. When calls to that provider succeed again the breaker closes and the backlog drains at the lane’s budget. Messages in flight when the breaker opened were put back as delayed copies and are claimed again from the retry status. Standard and bulk messages have 24 hours, so a half-hour outage fails none of them.',
    },
    {
      scenario: 'The first SMS provider is down while users are signing in.',
      impact:
        'If the provider answers with errors, each code goes to the second vendor at once. If it stops answering, about the first ten codes on each task wait out one 4-second timeout each before they go out through the second vendor, at the edge of the 5-second target or past it. Then the task’s breaker is open and its codes go to the second vendor directly.',
      detection:
        'The share of urgent SMS sent through the second vendor and the first provider’s error rate, both published by the SMS workers, and the urgent SMS queue age from the queue.',
      recovery:
        'The breaker tries the first provider with one message every 30 seconds and closes when it answers. A code whose first call got no answer may arrive twice, and a code sent through the second vendor ends at sent. If both vendors fail, the code is retried through delayed copies until it expires 5 minutes after the 202, and the delivery ends as failed with the reason expired; the user asks for a new code.',
    },
    {
      scenario: 'A caller times out and repeats a request, or the queue delivers a message twice.',
      impact:
        'Two messages describe one delivery. Without the claim the user would be notified twice.',
      detection:
        'Nothing to detect for one event. The count of messages deleted because their row was already final is a useful baseline of repeats per caller.',
      recovery:
        'The same key gives the same id. One worker’s claim succeeds; the other finds a final row and deletes its message, or finds a live claim, leaves its message alone and deletes it on the next receive. One send, one row.',
    },
    {
      scenario: 'The deliveries or users table throttles or is unavailable.',
      impact:
        'Workers cannot read preferences or claim, so nothing is sent on any lane. The API keeps accepting, because it writes only to the queue. A send that the provider accepted just before the outage cannot be recorded and becomes a send in doubt.',
      detection:
        'ThrottledRequests and SystemErrors on the tables, and the queue-age alarms, urgent first, since they depend on neither the table nor the workers.',
      recovery:
        'A worker that cannot reach the table queues a delayed copy of its message, deletes the original and stops receiving, the same breaker as for a provider. No receive count is used up. When the table answers, messages are claimed as usual; urgent ones older than 5 minutes are recorded as expired. A throttle caused by a campaign on a table that was not pre-warmed ends when the warm throughput is raised.',
    },
    {
      scenario:
        'A fan-out worker crashes in the middle of a chunk, or the start message of a campaign is delivered twice.',
      impact:
        'Part of a chunk is queued and the chunk message returns after its visibility timeout, or all 370 chunks are queued a second time. Some users have two bulk messages in the queue.',
      detection:
        'The age of the oldest message on the fan-out queue, alarmed at 12 minutes, and the campaign’s count of chunks done.',
      recovery:
        'The chunk runs again from its start. Every message it writes has the id of its campaign and user, so the second message for a user stops at the claim. Marking a chunk done is adding its number to a set, which is the same when done twice, and a later repeat of a chunk whose number is in the set runs only the conditional done update and is skipped.',
    },
    {
      scenario: 'A campaign goes out with a wrong template and must be stopped.',
      impact:
        'Until someone cancels, messages keep leaving at 10,000 a second: a minute of delay is 600,000 users.',
      detection:
        'A person notices; nothing in the system can know that the content is wrong. Large campaigns are therefore started on a small audience first, which is a rule for callers, not a mechanism here.',
      recovery:
        'POST /campaigns/{id}/cancel sets the status to cancelled from any state, also after the fan-out is done while half of the audience is still queued, and the status never moves back. Fan-out workers drop the remaining chunks, and bulk workers suppress queued messages with the reason campaign cancelled once their 10-second cache has refreshed. Messages already sent stay sent.',
    },
    {
      scenario: 'A malformed message makes every worker that receives it crash.',
      impact:
        'The message comes back every 30 seconds and kills a task each time. Other messages are slowed while tasks restart.',
      detection:
        'After five receives the queue moves it to the lane’s dead-letter queue, and the alarm on that queue’s visible messages pages on the first one.',
      recovery:
        'A person reads the message, fixes the worker and redrives the dead-letter queue to its source queue. The worker then sends it, or records it as failed with the reason expired if its deadline has passed. The alarm returns to OK when the dead-letter queue is empty.',
    },
    {
      scenario: 'The release task is down when quiet hours end.',
      impact:
        'Held notifications stay in the due table, where they were committed. Nothing is sent twice; users get their overnight activity late.',
      detection:
        'The age of the oldest due row, published by the release task itself, alarmed at 10 minutes with missing data counted as breaching, so a dead task fires the alarm by its silence.',
      recovery:
        'The container service restarts the task, which queries every shard for rows whose minute has passed and releases them oldest first. A row released twice across the restart yields two messages and one claim. Rows older than their 24-hour deadline are released too, and the worker records them as expired.',
    },
    {
      scenario: 'A marketing email campaign goes to a stale list and many addresses bounce.',
      impact:
        'The account’s bounce rate climbs. The email provider reviews an account at a 5% bounce rate and may pause it at 10%, and a paused account cannot send sign-in email either.',
      detection:
        'The provider’s own Reputation.BounceRate and Reputation.ComplaintRate metrics, alarmed at 2% and 0.05%, far below the review thresholds.',
      recovery:
        'The on-call cancels the campaign. Each permanent bounce has already marked its address invalid, so the same addresses are not mailed again, and the provider’s suppression list refuses them as well. Marketing mail in an account of its own is the step that would remove the shared risk.',
    },
  ],
  capacity: {
    assumptions: [
      '20 million users. About 2,000 notifications a second on average and 5,000 at peak: 90% push, 9% email, 1% SMS.',
      'Urgent messages are 2% of traffic: SMS sign-in codes and security alerts by push or email.',
      'One campaign a day of 10 million pushes, fanned out at 20,000 a second by 8 tasks at 2,500 each. The bulk push budget is 10,000 sends a second.',
      'A token bucket takes one token per provider call, and a push makes one call per device, which is also what the provider quotas count. The estimates below count one device per push; an average above one stretches the campaign drain and the bulk waits in proportion, because the budget still caps the bulk lane at 10,000 calls a second.',
      'About 3% of notifications are standard pushes that land in the recipient’s quiet hours, and a quarter of them come due in the busiest minute of the morning.',
      'A delivery row is about 0.5 KB and is kept 30 days. A user id in an audience file takes about 37 bytes.',
      'A provider call is cut off at 4 seconds, and a receive makes at most three calls with backoffs of 0.5 and 1 second. An urgent SMS skips the first backoff, because its second call goes to another vendor.',
    ],
    estimates: [
      {
        label: 'Steady volume',
        value: '~173M notifications a day, 5K per second at peak',
        math: '2,000/s × 86,400 s ≈ 173M/day. Peak is 2.5 × the average.',
      },
      {
        label: 'Urgent lane at peak',
        value: '100 per second, 50 of them SMS',
        math: '5,000/s × 2% = 100/s. SMS is 5,000/s × 1% = 50/s, half of the 100 message parts a second that a US short code carries.',
      },
      {
        label: 'Campaign fan-out',
        value: '500 s, about 8 minutes',
        math: '10M ÷ 20,000/s = 500 s. The audience file is 10M × 37 bytes ≈ 370 MB, cut into 370 chunks of 1 MB with about 27,000 ids each.',
      },
      {
        label: 'Campaign drain',
        value: '~17 minutes, 5M queued at the worst moment, 8.3 minutes of wait',
        math: '10M ÷ 10,000/s = 1,000 s. After 500 s of fan-out, 10M − 500 × 10,000 = 5M wait; the last message queued waits 5M ÷ 10,000/s = 500 s. In one shared queue, a sign-in code would wait those 500 s.',
      },
      {
        label: 'Android provider quota',
        value: '~7.3K per second of 10K allowed',
        math: 'Bulk 10,000/s + standard push 5,000/s × 90% = 14,500/s, about half of it Android ≈ 7,300/s. The default quota is 600,000 a minute = 10,000/s, so the peak uses about 73%.',
      },
      {
        label: 'Quiet-hours release',
        value: '~5M held a day, 1.3M in the busiest minute, released in 4.3 minutes',
        math: '173M × 3% ≈ 5M. A quarter ≈ 1.3M ÷ 5,000/s = 260 s. With a campaign draining too: (10M + 1.3M) ÷ 10,000/s − 500 s = 630 s, 10.5 minutes of wait in the bulk lane.',
      },
      {
        label: 'Deliveries table',
        value: '~92 GB a day, ~2.7 TB kept',
        math: '(173M + 10M) × 0.5 KB ≈ 92 GB/day; × 30 days ≈ 2.7 TB.',
      },
      {
        label: 'Table throughput at peak',
        value:
          '~40K write units on the deliveries table and ~20K on the users table, ~15K read units on each, per second',
        math: 'Deliveries: steady 5,000/s × 2 writes (claim, result) = 10,000, plus campaign 10,000/s × 3 (its row of the claim transaction at double cost = 2, plus the result = 1) = 30,000, in all 40,000. Users: 10,000/s × 2 (the cap counter row of the same transaction, at double cost) = 20,000. Together 60,000, of which 50,000 come from the campaign. Reads: 15,000 sends/s × 1 on each table (delivery row, user row) = 15,000 each.',
      },
      {
        label: 'Worst handling of one receive',
        value: '13.5 s, inside a 20 s lease and a 30 s visibility timeout',
        math: '3 calls × 4 s + 0.5 s + 1 s = 13.5 s. A push to up to ten devices calls them concurrently, so the bound is the same.',
      },
      {
        label: 'API at peak',
        value: '~150 requests in flight',
        math: '5,000/s × 30 ms = 150, each one queue send.',
      },
    ],
    implications: [
      'The average designs nothing. A fan-out ten times the average rate next to a code that is worthless after 5 minutes is what forces a queue, a pool and a budget per lane.',
      'The provider budget, not our hardware, sets how long a campaign takes: 17 minutes at 10,000 a second. Adding bulk workers past 20 tasks buys nothing, and the queue has to hold 5 million messages comfortably, which a managed queue with no backlog limit does.',
      'The peak uses 73% of the Android provider’s default quota, so a larger budget, for example to run two campaigns at once without doubling the drain, needs a quota increase first. The budget is a setting to keep below the quota, not a number to tune upward freely.',
      'During a campaign the deliveries table takes 40,000 write units a second and the users table 20,000, and far less otherwise, on tables that would each start at 4,000 if new. Both are pre-warmed to their campaign peak, and the due table to the write rate of its morning release, 5,000 deletes a second of rows that each hold a message of a few kilobytes. 40,000 is also the default quota of an on-demand table, and a table can be pre-warmed only up to its quota, so the quota of the deliveries table is raised before the first campaign. The keys, the notification id and the user id, spread writes evenly so no partition approaches its 1,000-unit limit.',
      'Fifty of the sixty thousand write units across the two tables come from the campaign, and four of every five of those from the claim transaction that carries the daily cap. That is the first cost to cut at 10x.',
      'A release of 1.3 million on top of a campaign keeps the worst bulk wait at 10.5 minutes, under the 20-minute alarm. Two campaigns at once with a release reach about 19 minutes, at the edge of that alarm, and their last chunk waits about 17 minutes in the fan-out queue, past its 12-minute alarm, which is why callers start campaigns one at a time.',
      'At 2.7 TB the deliveries table is the largest thing stored. Thirty days is chosen for support questions and for the idempotency window, and expiry by time-to-live removes rows without a job.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one region across three Availability Zones. The push providers and the second SMS vendor are outside AWS. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Notification API',
        service:
          'An internal Application Load Balancer that serves only this API, Amazon ECS on AWS Fargate',
        why: 'A stateless service that checks the caller and the template from memory and makes one queue send per channel. It reads no table on the send path, so it stays up when the tables do not. The preferences, devices and cancel calls write straight to DynamoDB.',
        watch:
          'ALB TargetResponseTime, RequestCount, HTTPCode_Target_5XX_Count and HTTPCode_ELB_5XX_Count; ECS CPUUtilization.',
      },
      {
        part: 'Urgent, standard and bulk queues',
        service:
          'Seven Amazon SQS standard queues (push and email in three lanes, SMS in the urgent lane), each with a 30 s visibility timeout, 4 days of retention and redrive after 5 receives to the dead-letter queue of its lane, which keeps 14 days',
        why: 'The first durable write of every notification and the buffer for a backlog of millions, with no servers to run. Standard queues deliver at least once and in no order, which the claim already assumes, so a FIFO queue would buy nothing.',
        watch:
          'On each queue: ApproximateAgeOfOldestMessage, ApproximateNumberOfMessagesVisible, ApproximateNumberOfMessagesNotVisible, and NumberOfMessagesSent against NumberOfMessagesDeleted.',
      },
      {
        part: 'Channel workers',
        service:
          'Amazon ECS services on AWS Fargate, one per queue. Urgent pools have a fixed size; the others scale on ApproximateNumberOfMessagesVisible up to a maximum, 20 tasks for bulk push',
        why: 'A pool per queue is what keeps lanes and channels apart. Each task carries its own token bucket, the lane’s budget divided by the pool’s maximum size, and its own circuit breaker per provider, so there is no shared state between tasks. On a stop signal a task stops receiving and finishes what it holds.',
        watch:
          'ECS CPUUtilization and MemoryUtilization. Custom metrics per pool: time from queue to provider, provider error rate, breaker state, claims taken over, and deliveries by final status and reason.',
      },
      {
        part: 'Deliveries table',
        service:
          'Amazon DynamoDB, on-demand, pre-warmed to the campaign peak, keyed by notification id and channel, with time to live at 30 days',
        why: 'Conditional writes are the claim and every status change, a consistent read tells a worker what state a delivery is in, and the notification id spreads load evenly across partitions.',
        watch:
          'ThrottledRequests, WriteKeyRangeThroughputThrottleEvents, SystemErrors, ConsumedWriteCapacityUnits, SuccessfulRequestLatency and TransactionConflict.',
      },
      {
        part: 'Users table',
        service:
          'Amazon DynamoDB, on-demand, pre-warmed to the campaign peak, keyed by user id, holding the preferences row, one row per device and one cap counter per day',
        why: 'One consistent query returns everything a send needs to know about the user. The cap counter is updated in the same transaction as a marketing claim, and it expires by time to live.',
        watch:
          'ThrottledRequests, ConsumedReadCapacityUnits, ConsumedWriteCapacityUnits and SuccessfulRequestLatency.',
      },
      {
        part: 'Due table and release task',
        service:
          'An Amazon DynamoDB table with 64 shard keys and the due minute at the start of the sort key; pre-warmed to the morning release; one Amazon ECS task on AWS Fargate that works the shards in parallel',
        why: 'Holds what quiet hours hold back, readable in time order. One task is enough at 5,000 releases a second, and the container service restarts it if it dies.',
        watch:
          'A custom metric of the age of the oldest due row, published by the task every minute, also when it is zero.',
      },
      {
        part: 'Campaign fan-out',
        service:
          'An Amazon SQS standard queue for start and chunk messages with a 1-minute visibility timeout and redrive after 5 receives, 8 fan-out tasks on Amazon ECS, the audience file in Amazon S3 and a campaigns table in Amazon DynamoDB',
        why: 'Byte-range reads let any task take any chunk of the file, and the queue makes each chunk retry on its own. The campaigns table holds the status that a cancel flips.',
        watch:
          'ApproximateAgeOfOldestMessage and ApproximateNumberOfMessagesVisible on the fan-out queue; NumberOfMessagesSent on the bulk queues.',
      },
      {
        part: 'Providers: push',
        service:
          'The Apple and Android push services, called directly over HTTP/2 from the push workers',
        why: 'Calling them directly gives the worker each token’s answer, such as 410 Unregistered or 404 UNREGISTERED, and control of the collapse identifier, the tag and the expiration on every message.',
        watch:
          'Custom, from the workers: answers by status code per platform, 429 answers, and tokens deleted.',
      },
      {
        part: 'Providers: email',
        service:
          'Amazon SES, with one configuration set for transactional and activity mail and one for marketing, both publishing events to Amazon SNS',
        why: 'The sending rate and the daily quota are granted per account and Region, and the bulk email pool’s budget sits below the granted rate. Message tags carry the notification id, the channel and the claim token into every event.',
        watch: 'Send, Bounce, Complaint, Reputation.BounceRate and Reputation.ComplaintRate.',
      },
      {
        part: 'Providers: SMS, and the second SMS vendor',
        service:
          'AWS End User Messaging SMS with a short code and a configuration set that publishes events to Amazon SNS; a second vendor outside AWS behind the same worker',
        why: 'A user is blocked until the sign-in code arrives, so this is the one channel with two vendors. TimeToLive drops a code the carrier side could not hand off in time, and Context carries our ids and the claim token into the delivery events. Receipts of the second vendor are not collected, so a code it sends ends at sent.',
        watch:
          'Custom, from the SMS workers: errors per vendor, share of codes sent through the second vendor, and delivery events by status.',
      },
      {
        part: 'Receipts',
        service:
          'An Amazon SNS topic, an Amazon SQS standard queue subscribed to it with its own dead-letter queue, and a receipt worker on Amazon ECS',
        why: 'Email and SMS events arrive in one place at their own pace, and the queue absorbs a burst of bounces. Updates are conditional, so repeats and reordering do no harm.',
        watch:
          'SNS NumberOfNotificationsFailed; ApproximateAgeOfOldestMessage on the receipts queue.',
      },
      {
        part: 'Security',
        service: 'AWS Secrets Manager, AWS KMS, IAM roles per pool, AWS CloudTrail',
        why: 'Provider keys are read from Secrets Manager by the one pool that uses them. Tables and queues are encrypted with KMS keys, each role reaches only its own queues, tables and secret, and reads of secrets and cancels of campaigns leave a trail.',
        watch: 'CloudTrail events for secret reads and for the cancel call.',
      },
      {
        part: 'Observability',
        service: 'Amazon CloudWatch dashboards and alarms',
        why: 'One dashboard with the objectives per lane. The alarms that protect an objective read queue metrics, which do not depend on the workers they watch; alarms on metrics that a task publishes about itself treat missing data as breaching where silence means trouble.',
        watch: 'The objectives per lane, and the dead-letter queues, which should be empty.',
      },
    ],
    limits: [
      'An SQS message is at most 1 MiB. Notification messages are a few kilobytes: ids, the template version and the data for its placeholders.',
      'An SQS message can be delayed by at most 15 minutes, which caps the backoff of a delayed copy and rules out a delay as the way to hold a message through a night.',
      'An SQS visibility timeout lasts at most 12 hours, and a standard queue allows about 120,000 messages in flight, so held messages cannot simply stay received.',
      'SQS raises the receive count on every receive, and the redrive policy moves a message after the configured number. A retry that should not count toward it has to be a new message.',
      'SQS keeps a message 4 days by default and 14 at most. In a standard queue a message moved to a dead-letter queue keeps its original enqueue time, so the dead-letter queues keep 14 days while the lane queues keep 4.',
      'A standard SQS queue delivers at least once, keeps no order and takes a nearly unlimited rate of sends.',
      'SendMessageBatch takes up to 10 messages and reports each one on its own: the call can answer 200 with some entries in its Failed list, so the sender checks the list and sends those entries again.',
      'SQS metrics arrive once a minute, and a queue that has been idle can take up to 15 minutes to report again. The lane queues and the fan-out queue are never idle, because their tasks poll them. A dead-letter queue is, so its alarm can lag by that much, well inside the 4-hour triage target.',
      'ApproximateAgeOfOldestMessage leaves out a message that was received three or more times without being deleted, also when a redrive policy is in place, so a message on its way to the dead-letter queue stops showing in a lane’s age. The dead-letter alarm counts visible messages for that reason.',
      'A dead-letter redrive (StartMessageMoveTask) with no destination sends messages back to the queues they came from; one move task runs per queue at a time.',
      'A DynamoDB partition takes 1,000 write units and 3,000 read units a second, a transactional write costs double, and a new on-demand table sustains 4,000 writes a second until its warm throughput is raised, which can be done ahead of a peak and not lowered afterwards.',
      'A DynamoDB on-demand table has a default quota of 40,000 write and 40,000 read request units a second, which can be raised on request, and a table can be pre-warmed only up to its quota. The campaign peak of the deliveries table equals the default, so its quota is raised before the first campaign.',
      'DynamoDB time to live deletes a row within a few days of its expiry, not at it. A row that outlives 30 days only makes the idempotency window longer.',
      'The Android push service allows 600,000 messages a minute per project by default and answers 429 above it; a single device takes at most 240 messages a minute and 5,000 an hour.',
      'The Android push service keeps at most four collapse keys per device, so the notification id goes in the notification tag, which replaces a notification already shown, and not in the collapse key.',
      'The Apple push service accepts a collapse identifier of at most 64 bytes and a payload of at most 4 KB, stores one notification per app for a device that is offline, and answers 410 with a timestamp for a token that is no longer active and 429 when one token gets too many requests in a row.',
      'Amazon SES grants a daily quota and a maximum send rate per account and Region, counted per recipient; a new account in the sandbox has 200 messages a day and 1 a second. A send above the daily quota is rejected.',
      'Amazon SES places an account under review at a bounce rate of 5% or a complaint rate of 0.1%, and may pause its sending at 10% or 0.5%. It sends no EventBridge event of its own when it pauses an account: it adds an SES sending paused event to the AWS Health Dashboard, emails the account’s address and shows the pause in the EnforcementStatus field of GetAccount, so the reputation alarms are the early signal.',
      'Amazon SES accepts a message to an address on the account’s suppression list and does not send it; the list fills from hard bounces and complaints.',
      'AWS End User Messaging SMS limits throughput per origination number in message parts per second: 100 for a US short code and 3 for a US toll-free number. TimeToLive ranges from 5 seconds to 72 hours, and a carrier receipt can take up to 72 hours before the status is reported as unknown.',
      'HTTPCode_Target_5XX_Count leaves out the 5xx that the load balancer generates itself, and HTTPCode_ELB_5XX_Count exists per load balancer and is reported only in minutes that have one, so the API has its own load balancer and the error ratio adds both counts with an absent count read as zero. RequestCount counts only requests for which a target was chosen, so the ratio is missing only when RequestCount is, and that case counts as breaching.',
    ],
  },
  slos: [
    {
      objective: 'Accepting a notification',
      target: '99.9% of API requests answered within 300 ms and without a 5xx, over 28 days',
      measure:
        'On the API’s own load balancer: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount for errors, because the target count leaves out the 5xx the load balancer answers itself when tasks are down, and TargetResponseTime for latency. An absent 5XX count is read as zero. The ratio is missing only when RequestCount is, and such a minute counts as failed.',
    },
    {
      objective: 'Urgent messages',
      target: '99% handed to the provider within 5 s of the 202, over 28 days',
      measure:
        'Sent at minus accepted at on each urgent delivery, published by the workers as a percentile; a delivery that ends as expired counts as a miss. The independent signal is the age of the oldest message on the urgent queues, from SQS.',
    },
    {
      objective: 'Standard messages',
      target: '99% handed to the provider within 30 s of the 202, over 28 days',
      measure:
        'The same difference on standard deliveries, leaving out those held for quiet hours, with the age of the oldest message on the standard queues as the independent signal.',
    },
    {
      objective: 'Bulk messages',
      target: '99% handed to the provider within 30 min of entering a bulk queue, over 28 days',
      measure:
        'Sent at minus the queued time carried in the message, and the age of the oldest message on the bulk queues. The worst expected wait is 8.3 minutes for a campaign alone and 10.5 with the morning release on top.',
    },
    {
      objective: 'Campaign fan-out',
      target: 'An audience of up to 10 million fully queued within 20 min of the 202, over 28 days',
      measure:
        'The time the campaign row turns done minus the accepted-at time that the API puts in the start message and the fan-out worker stores on the row, so the wait in the fan-out queue counts, and the age of the oldest message on the fan-out queue. A campaign not done at 20 minutes counts as a miss; cancelled ones are left out. The expected time is about 8 minutes.',
    },
    {
      objective: 'Quiet-hours release',
      target:
        '99% of held notifications back on a queue within 15 min of the end of quiet hours, over 28 days',
      measure:
        'Release time minus due minute on each due row, and the age of the oldest due row, published by the release task. The expected worst case is 4.3 minutes.',
    },
    {
      objective: 'Dead letters',
      target: 'Every dead letter redriven or closed within 4 hours, over 28 days',
      measure:
        'ApproximateNumberOfMessagesVisible on each dead-letter queue over time: how long it stays above zero.',
    },
  ],
  alarms: [
    {
      name: 'Accept errors',
      metric:
        'On the API’s own ALB, each over one 5-minute window: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount above 0.04%, with an absent 5XX count read as zero and a missing ratio counted as breaching, or p99.96 TargetResponseTime above 200 ms. The load balancer publishes these, not the API',
      meaning:
        'API requests are failing or slow: tasks are down, queue sends are failing, or the tables are, which fails the preferences, devices and cancel calls but not sends. Each clause lets through at most 0.04% of requests, so both together stay inside the 0.1% that the 99.9% target allows, and 200 ms is tighter than the 300 ms target. The ratio is missing only when RequestCount is, as when no task is registered, and that fires the alarm too. Callers keep their requests and repeat them with the same key.',
    },
    {
      name: 'Urgent lane behind',
      metric:
        'SQS ApproximateAgeOfOldestMessage (maximum) on any urgent queue above 3 s for one 1-minute period; missing data is not breaching, because an empty queue has no age',
      meaning:
        'Sign-in codes or security alerts are waiting: the urgent pool is down or too small, a provider is failing, or the tables are. It fires at 3 seconds of waiting, below the 5-second target, and it comes from the queue, so it works with every worker dead. The queue reports once a minute, so it fires a minute or two after the lane falls behind. A message in flight counts toward the age until it is deleted, so one task that dies holding a code, or one call that waits out a 4-second timeout, can fire it too: a late code worth a look, not a lane that is down.',
    },
    {
      name: 'Standard lane behind',
      metric:
        'SQS ApproximateAgeOfOldestMessage (maximum) on any standard queue above 15 s for one 1-minute period; missing data is not breaching',
      meaning:
        'Activity notifications are late, at half of the 30-second target. Check the pool’s size against its backlog and the provider error rate.',
    },
    {
      name: 'Bulk lane behind',
      metric:
        'SQS ApproximateAgeOfOldestMessage (maximum) on any bulk queue above 20 min for one 1-minute period; missing data is not breaching',
      meaning:
        'A campaign or a morning release is draining slower than planned, before the 30-minute target is missed. Normal is at most 10.5 minutes. Usually a provider throttling or the bulk pool below its maximum size. Two campaigns at once stay just under it, at about 19 minutes with a release, and fire Fan-out behind first.',
    },
    {
      name: 'Fan-out behind',
      metric:
        'SQS ApproximateAgeOfOldestMessage (maximum) on the fan-out queue above 12 min; missing data is not breaching',
      meaning:
        'Chunks are not being received: fan-out tasks are down or too few. Normal is up to about 8 minutes for the last chunk, and the target is 20. A chunk that fails over and over, for example because the audience file cannot be read, returns once a minute, the queue’s visibility timeout. It leaves this metric after three receives and moves to the dead-letter queue about 5 minutes after its first receive, by about minute 13 for the last chunk. So this alarm at 12 minutes and that move both come before the 20-minute target; the Dead letters page itself can lag by up to 15 minutes when that queue was idle. Before the target is not always in time: with every fan-out task down from the start the fan-out still needs about 8 minutes after this alarm, and an audience file that cannot be read waits for a person, so in those two cases the campaign misses its 20 minutes and the alarms limit the damage.',
    },
    {
      name: 'Release late',
      metric:
        'Custom, from the release task every minute: age of the oldest due row above 10 min; missing data counts as breaching',
      meaning:
        'Held notifications are not going back on a queue, with 5 minutes left before the 15-minute target is missed. The task publishes this about itself, so no data means the task is dead, and that fires the alarm.',
    },
    {
      name: 'Dead letters',
      metric:
        'SQS ApproximateNumberOfMessagesVisible above 0 on any dead-letter queue (one per lane, one for fan-out, one for receipts)',
      meaning:
        'A message crashed workers five times and waits for a person. It pages on the first one, far inside the 4-hour target, though an idle queue can take up to 15 minutes to report. The count is used because the age metric can leave such messages out. It returns to OK when the queue is empty: after the fix, a redrive sends the messages back to their source queue, where they are sent or recorded as expired.',
    },
    {
      name: 'Provider failing',
      metric:
        'Custom, from the workers, per provider: failed or unanswered calls above 20% for 2 minutes, or more than half of a pool’s breakers open; missing data is not breaching',
      meaning:
        'A provider is down, throttling or rejecting our credentials. Its channel waits in every lane, both push platforms together when either push provider fails, and nothing fails before its deadline, except urgent messages after 5 minutes; urgent SMS should already be on the second vendor. Workers publish this, so if they are down this alarm is silent and the lane alarms fire from the queues.',
    },
    {
      name: 'Sends in doubt',
      metric:
        'Custom, from the workers: claims taken over plus deliveries ended as outcome unknown, above 0.1% of sends for 5 minutes',
      meaning:
        'Workers are dying between the provider’s answer and the result write, or a provider is timing out after accepting. Users may be getting duplicates and some bulk email is being given up. Look for tasks killed by memory limits or a deploy that does not drain.',
    },
    {
      name: 'Sender reputation',
      metric: 'SES Reputation.BounceRate above 2% or Reputation.ComplaintRate above 0.05%',
      meaning:
        'A campaign is hitting dead addresses or annoying recipients. The provider reviews an account at 5% and 0.1%, and a paused account stops sign-in email too. Cancel the campaign and check where its audience came from.',
    },
    {
      name: 'Table throttling',
      metric:
        'DynamoDB ThrottledRequests above 0 for 1 minute, summed over the write operations of the deliveries table or of the users table',
      meaning:
        'Claims are being refused, so sends slow down on every lane. Usually a campaign on a table whose warm throughput was not raised; WriteKeyRangeThroughputThrottleEvents above 0 says it is one hot partition instead, such as one user who is sent far more than the rest.',
    },
  ],
  evolution: {
    mvp: 'Three queues, one per lane, shared by all channels, and one worker service with a small pool per lane. One provider per channel, no second vendor, no campaigns API: a caller with a list loops over POST /notifications, and marketing waits in the bulk lane. Quiet hours suppress non-urgent pushes. The derived id, the conditional claim on notification and channel, the read of preferences right before the send and the lanes are there from the first version, because they are what makes a repeat harmless and a sign-in code fast, and neither can be added after users have been notified twice.',
    atScale: [
      'At 10x (50,000 a second at peak, campaigns of 100 million), provider quotas come first: a campaign at 10,000 a second would take almost three hours, so the push quotas are raised with the providers and the bulk budget follows them.',
      'At 10x, the claim transaction for the daily cap is the largest cost on the two tables. Marketing claims become single writes, and the cap moves to a counter updated after the send, which can let a user get a fourth message on a bad day.',
      'At 10x, bulk delivery rows are kept 7 days and the others 30, which cuts the table by most of its size, and one release task is no longer enough: several tasks each take a lease on a range of shards, with a conditional write per lease.',
      'At 10x, marketing email moves to its own account with the email provider, so a bad list cannot pause sign-in mail.',
      'At 100x, one region is too far from most users and too large to fail at once. Each region runs the whole design for the users whose home it is, a campaign is split by home region before fan-out, and a user’s deliveries are claimed only in that region, because the claim is exact only inside one table.',
    ],
    firstBottleneck:
      'The push provider budget. A campaign drains at 10,000 a second whatever we run, already at about 73% of the Android provider’s default quota at peak, so campaign duration and the worst bulk wait grow with audience size long before queues, workers or the API run out. The second is the pair of tables that every claim touches, in cost before capacity: 60,000 write units a second during a campaign, 40,000 on the deliveries table and 20,000 on the users table, most of them for the cap transaction.',
    avoided: [
      'A shared rate limiter in an in-memory store. Fixed shares per task waste part of the budget and add no component that can fail. Worth adding when pools change size so often that the waste costs more campaign time than the store costs to run.',
      'Fallback across channels, such as an email when a push was not opened. It needs a signal that a push was seen, which the push providers do not give, and it makes "one effect per channel" a weaker promise. Worth adding for urgent messages if push becomes their first channel.',
      'Pause and resume of a campaign. Cancel covers the emergency; resuming needs the fan-out to remember where each chunk stopped. Worth adding when campaigns run for hours.',
      'Per-user ordering with FIFO queues. Nothing here depends on order, and one stuck message would block a user’s later ones. Worth adding if a product needs "shipped" never to arrive after "delivered".',
      'Digests that merge a night of held notifications into one. The morning release sends each one. Worth adding when held volume grows enough that users complain about the burst.',
      'A deliveries table per lane. One pre-warmed table is simpler, and its key spreads a campaign evenly. Worth adding if table throttling during campaigns ever delays urgent claims.',
      'A streaming platform in place of the queues. Queues with redrive and per-message delay already give retries and isolation at this volume. Worth adding when several independent consumers need every notification event.',
    ],
  },
};
