import type { Design } from '../types';

export const notificationSystem: Design = {
  slug: 'notification-system',
  title: 'Notification system',
  summary:
    'Send push, email and SMS on behalf of every product team: urgent messages in seconds, campaigns at their own pace, user preferences respected and no visible duplicates.',
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Product services send a notification to a user through one API, choosing a template and a priority.',
      'Deliver through push, email or SMS, according to each user’s preferences and opt-outs.',
      'Track the status of every notification: queued, sent, delivered or failed.',
    ],
    nonFunctional: [
      'Urgent messages (sign-in codes, security alerts) arrive within seconds, even during a large campaign.',
      'At-least-once delivery with no duplicates the user can see.',
      'A failing provider affects only its own channel.',
      'Handle bursts of hundreds of thousands of notifications a minute.',
    ],
    outOfScope: ['Designing the message content and templates editor.', 'In-app inbox UI.'],
  },
  entities: [
    {
      name: 'Notification',
      description: 'Who, what template, which data, priority and an idempotency key.',
    },
    { name: 'Preferences', description: 'Per user and channel: allowed, quiet hours, opt-outs.' },
    { name: 'Template', description: 'The message per channel and language, with placeholders.' },
    {
      name: 'Delivery attempt',
      description: 'One try on one channel: provider, result, timestamps.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/notifications',
      description:
        'Body: userId, templateId, data, priority, idempotencyKey. Returns 202 with a notificationId.',
    },
    {
      method: 'GET',
      path: '/notifications/{id}',
      description: 'Status per channel and the delivery attempts so far.',
    },
    {
      method: 'PUT',
      path: '/users/{id}/preferences',
      description: 'Channels allowed, quiet hours and opt-outs.',
    },
  ],
  dataFlow: [
    'A service calls the API; the request is validated and deduplicated.',
    'Preferences decide which channels, if any, the user gets.',
    'The router renders the template and puts the message on a queue for its priority.',
    'Channel workers send through the provider, retrying on failure, and record every attempt.',
  ],
  highLevel: {
    label: 'Run a notification through the system',
    intro:
      'Follow one notification from the service that asks for it to the provider that delivers it. Press play, or step through the stages to see what happens and what each choice costs.',
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
        detail: 'Validate + dedupe',
        column: 1,
        row: 'middle',
      },
      { id: 'prefs', title: 'Preferences', detail: 'Channels, opt-outs', column: 1, row: 'top' },
      { id: 'router', title: 'Router', detail: 'Template + priority', column: 2, row: 'middle' },
      { id: 'urgent', title: 'Urgent queue', detail: 'Codes, alerts', column: 3, row: 'top' },
      { id: 'standard', title: 'Standard queue', detail: 'Activity', column: 3, row: 'middle' },
      { id: 'bulk', title: 'Bulk queue', detail: 'Campaigns', column: 3, row: 'bottom' },
      {
        id: 'workers',
        title: 'Channel workers',
        detail: 'Push, email, SMS',
        column: 4,
        row: 'middle',
      },
      { id: 'log', title: 'Delivery log', detail: 'Every attempt', column: 4, row: 'bottom' },
      { id: 'providers', title: 'Providers', detail: 'Push, email, SMS', column: 5, row: 'middle' },
    ],
    edges: [
      ['service', 'api'],
      ['api', 'prefs'],
      ['api', 'router'],
      ['router', 'urgent'],
      ['router', 'standard'],
      ['router', 'bulk'],
      ['urgent', 'workers'],
      ['standard', 'workers'],
      ['bulk', 'workers'],
      ['workers', 'providers'],
      ['workers', 'log'],
    ],
    stages: [
      {
        title: 'Accept and answer 202',
        narration:
          'A service posts a notification. The API validates it, stores it and answers 202 Accepted with an id, before anything is sent.',
        tradeoff:
          'Answering before sending keeps callers fast and independent of provider latency. The cost is that the caller cannot know the outcome in the same call, so status is a separate endpoint or a callback.',
        nodes: ['service', 'api'],
        travel: [['service', 'api']],
      },
      {
        title: 'Deduplicate on the idempotency key',
        narration:
          'The caller sends an idempotency key. A unique constraint on it turns a retried request into a no-op that returns the original id.',
        tradeoff:
          'Keeping keys for a day costs some storage, and it means a caller that times out and retries never makes the user receive the same message twice.',
        nodes: ['api'],
        travel: [],
      },
      {
        title: 'Check preferences',
        narration:
          'The API reads the user preferences: which channels are allowed, opt-outs and quiet hours. A notification with no allowed channel stops here.',
        tradeoff:
          'Filtering early avoids rendering and queueing messages nobody will get. Preferences can change while a message waits in a queue, so regulated channels such as SMS check the opt-out again right before sending.',
        nodes: ['api', 'prefs'],
        travel: [['api', 'prefs']],
      },
      {
        title: 'Route by priority',
        narration:
          'The router renders the template for each channel and puts the message on the queue for its priority: urgent, standard or bulk.',
        tradeoff:
          'One queue is simpler, but a campaign of a million emails would sit in front of a sign-in code. Separate queues cost more infrastructure and keep urgent messages fast whatever else is happening.',
        nodes: ['router', 'urgent', 'standard', 'bulk'],
        travel: [
          ['api', 'router'],
          ['router', 'urgent'],
          ['router', 'standard'],
          ['router', 'bulk'],
        ],
      },
      {
        title: 'Workers per channel',
        narration:
          'Separate worker pools for push, email and SMS consume the queues, always draining urgent first, and scale on how many messages are waiting.',
        tradeoff:
          'Per-channel pools cost more to run than one generic pool, and a slow email provider can then only slow email. Scaling on queue depth reacts to the real backlog, not to CPU.',
        nodes: ['urgent', 'standard', 'bulk', 'workers'],
        travel: [
          ['urgent', 'workers'],
          ['standard', 'workers'],
          ['bulk', 'workers'],
        ],
      },
      {
        title: 'Send with retries and a circuit breaker',
        narration:
          'Workers call the provider. Temporary failures are retried with exponential backoff and jitter; a provider that keeps failing trips a circuit breaker, and urgent SMS can fail over to a second provider.',
        tradeoff:
          'Retries raise the delivery rate but risk duplicates when a provider accepted the message and the response was lost. Checking the delivery log before each send, and passing an idempotency key when the provider supports one, keeps retries safe.',
        nodes: ['workers', 'providers'],
        travel: [['workers', 'providers']],
      },
      {
        title: 'Record every attempt',
        narration:
          'Each attempt is written to the delivery log, and provider callbacks later mark messages as delivered or bounced.',
        tradeoff:
          'Logging every attempt costs storage, and it is what makes support questions answerable ("did the code go out?") and duplicates detectable. Bulk details can expire after a few weeks.',
        nodes: ['workers', 'log'],
        travel: [['workers', 'log']],
      },
      {
        title: 'Alarm on age per queue',
        narration:
          'After a few attempts a message moves to a dead-letter queue. Each queue alarms on the age of its oldest message: seconds for urgent, minutes for bulk.',
        tradeoff:
          'Messages per second can look healthy while a backlog grows. The age of the oldest message is what users feel, and different thresholds per queue match what each kind of message promises.',
        nodes: ['urgent', 'standard', 'bulk'],
        travel: [],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we avoid duplicates with at-least-once queues?',
      options: [
        {
          name: 'Trust the queue',
          pros: 'Nothing to build.',
          cons: 'Redelivery after a worker crash sends the message again.',
        },
        {
          name: 'Check the delivery log before sending',
          pros: 'One lookup per send catches redeliveries.',
          cons: 'A crash between the send and the log write can still duplicate.',
        },
        {
          name: 'Log check plus provider idempotency key',
          pros: 'Closes the last gap where the provider supports keys.',
          cons: 'Not every provider supports them.',
        },
      ],
      choice:
        'Check the log and pass an idempotency key where the provider supports it. The remaining gap is small and only on providers without keys.',
    },
    {
      question: 'How do we not overwhelm providers or users?',
      options: [
        {
          name: 'Send as fast as workers can',
          pros: 'Simple.',
          cons: 'Hits provider rate limits and can spam users.',
        },
        {
          name: 'Token buckets per provider and per user',
          pros: 'Stays under provider quotas and caps messages per user per day.',
          cons: 'Bulk sends take longer.',
        },
      ],
      choice:
        'Token buckets per provider and per user, with urgent messages exempt from the per-user cap.',
    },
    {
      question: 'How does a campaign to millions of users start?',
      options: [
        {
          name: 'The caller sends one request per user',
          pros: 'No new component.',
          cons: 'Millions of API calls from one service, hard to pause or cancel.',
        },
        {
          name: 'A fan-out job expands an audience in batches',
          pros: 'One request starts it; it can be paused, resumed and throttled.',
          cons: 'Another job to run and monitor.',
        },
      ],
      choice:
        'A fan-out job that writes batches into the bulk queue, so a campaign can be throttled or stopped halfway.',
    },
  ],
  wrapUp:
    'One API that accepts fast and deduplicates, preferences first, a queue per priority, workers per channel with safe retries, and every attempt on record.',
};
