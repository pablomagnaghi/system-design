import type { Design } from '../types';

export const llmChat: Design = {
  slug: 'llm-chat',
  title: 'LLM chat assistant',
  summary:
    'A chat assistant on top of large language models: stream each answer token by token, keep conversations and build the context the model sees, and share a scarce pool of GPUs across free and paid users without letting a busy hour take the service down.',
  difficulty: 'Hard',
  requirements: {
    functional: [
      'Send a message in a conversation and receive the reply streamed token by token.',
      'List, reopen, rename and delete past conversations.',
      'Tiers (free, paid, enterprise) get different models, limits and priority.',
      'Block or flag disallowed prompts and answers.',
      'Stop a generation in the middle.',
    ],
    nonFunctional: [
      'First token in under a second for paid tiers, then a steady stream of tens of tokens per second.',
      'Tens of millions of daily users and thousands of new generations per second at peak.',
      'GPUs are the bottleneck and the main cost, so they must stay busy without blowing latency.',
      'A dropped connection never loses an answer that is being or has been generated.',
    ],
    outOfScope: [
      'Training and fine-tuning models.',
      'Tools, file uploads and retrieval over user documents.',
    ],
  },
  entities: [
    {
      name: 'Conversation',
      description: 'ID, owner, title, model and a rolling summary of older turns.',
    },
    {
      name: 'Message',
      description:
        'Role, content, parent message (edits and regenerations form a tree), token count and status: streaming, done, stopped or blocked.',
    },
    {
      name: 'Generation',
      description:
        'One request to a model: message, model, priority from the tier, and its position in the token buffer.',
    },
    {
      name: 'Quota',
      description: 'Per user or organization: request and token buckets for each tier and model.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/conversations/{id}/messages',
      description:
        'Body: content, model, parentId. Returns an SSE stream of token deltas with numbered events, ending with the saved message ID.',
    },
    {
      method: 'GET',
      path: '/messages/{id}/stream',
      description:
        'Header: Last-Event-ID. Resumes a stream from the last event the client received.',
    },
    {
      method: 'POST',
      path: '/messages/{id}/stop',
      description: 'Cancels a running generation and saves what was produced so far.',
    },
  ],
  dataFlow: [
    'The chat API checks the rate limit and runs an input safety check, then stores the user message.',
    'It builds the prompt from the system prompt, a summary of old turns and the recent turns, and queues a generation by model and tier.',
    'A GPU server runs the request in a continuous batch and writes tokens to a short-lived buffer per message.',
    'The API tails the buffer over SSE to the client, checks the output in chunks, then saves the answer and records token usage.',
  ],
  highLevel: {
    label: 'Answer one chat message',
    intro:
      'Follow a single message from the user through limits, safety and context building, into a GPU batch, and back as a stream of tokens that survives a dropped connection. Press play, or step through the stages.',
    nodes: [
      { id: 'client', title: 'Client', detail: 'Reads an SSE stream', column: 0, row: 'middle' },
      { id: 'meter', title: 'Usage meter', detail: 'Tokens per user', column: 0, row: 'bottom' },
      { id: 'limiter', title: 'Rate limiter', detail: 'Requests, tokens', column: 1, row: 'top' },
      { id: 'api', title: 'Chat API', detail: 'Context and relay', column: 1, row: 'middle' },
      { id: 'convdb', title: 'Conversations', detail: 'Message store', column: 1, row: 'bottom' },
      { id: 'safety', title: 'Safety checks', detail: 'Input, then output', column: 2, row: 'top' },
      { id: 'router', title: 'Inference router', detail: 'Tier queues', column: 2, row: 'middle' },
      { id: 'buffer', title: 'Token buffer', detail: 'Per message', column: 2, row: 'bottom' },
      { id: 'capacity', title: 'Capacity', detail: 'Scale and shed', column: 3, row: 'top' },
      { id: 'gpu', title: 'GPU pool', detail: 'Continuous batching', column: 3, row: 'middle' },
      { id: 'small', title: 'Small model', detail: 'Under load', column: 3, row: 'bottom' },
    ],
    edges: [
      ['client', 'api', 'SSE'],
      ['api', 'limiter', 'charge'],
      ['api', 'safety', 'check'],
      ['api', 'convdb', 'history'],
      ['api', 'router', 'generate'],
      ['router', 'gpu', 'by priority'],
      ['router', 'small', 'degrade'],
      ['gpu', 'buffer', 'tokens'],
      ['small', 'buffer'],
      ['buffer', 'api', 'tail'],
      ['capacity', 'gpu', 'scale'],
      ['capacity', 'router', 'shed'],
      ['api', 'meter', 'usage'],
    ],
    stages: [
      {
        title: 'Charge the rate limit',
        narration:
          'The client posts the message and keeps the response open as an SSE stream. The API takes one request from the user’s request bucket and an estimate of input plus expected output tokens from the token bucket for their tier and model.',
        tradeoff:
          'Counting only requests is simple, and then one user pasting a whole book costs as much as a hundred short questions. Charging tokens matches what the GPUs actually spend; the cost is that output length is unknown upfront, so the charge is an estimate settled later.',
        nodes: ['client', 'api', 'limiter'],
        travel: [
          ['client', 'api', 'SSE'],
          ['api', 'limiter', 'charge'],
        ],
      },
      {
        title: 'Screen the input',
        narration:
          'A small, fast classifier checks the prompt before any GPU time is spent. High-severity categories are refused right away; borderline ones are allowed and flagged for review.',
        tradeoff:
          'Skipping the check saves tens of milliseconds and lets the big model refuse on its own, which is unreliable and burns expensive capacity. A separate classifier adds latency to every message and some false positives, and fails closed only for the worst categories so an outage does not block everyone.',
        nodes: ['api', 'safety'],
        travel: [['api', 'safety', 'check']],
      },
      {
        title: 'Store the message and build the context',
        narration:
          'The user message is saved under its conversation. The API loads the recent turns and the rolling summary of older ones, and builds the prompt: system prompt first, then summary, then recent turns, trimmed to the model’s context window.',
        tradeoff:
          'Sending the whole history is exact until it overflows the window, and long prompts are slow and costly anyway. A summary plus recent turns keeps prompts bounded; the cost is that details from early turns can be lost, and a stable prefix order is kept so the GPU side can reuse cached work.',
        nodes: ['api', 'convdb'],
        travel: [['api', 'convdb', 'history']],
      },
      {
        title: 'Queue by model and tier',
        narration:
          'The API hands a generation to the inference router, which keeps a queue per model and per priority. Paid and enterprise requests are taken first; every request carries a deadline after which it is dropped instead of served late.',
        tradeoff:
          'A single first in, first out queue is fair in a naive way, and lets a free-tier surge push paid users past their latency target. Priority queues protect the users who pay, at the cost of free users waiting longer or being turned away when the pool is full.',
        nodes: ['api', 'router'],
        travel: [['api', 'router', 'generate']],
      },
      {
        title: 'Run it in a continuous batch',
        narration:
          'A GPU server admits the request when it has room in memory for its attention cache, and adds it to the batch already running. Each step produces one more token for every request in the batch; finished requests leave and new ones join between steps.',
        tradeoff:
          'Waiting to fill a fixed batch wastes the GPU while short answers sit next to long ones. Continuous batching keeps the GPU busy and the cost is a scheduler that must watch memory per request, because admitting too many runs the cache out and forces evictions.',
        nodes: ['router', 'gpu'],
        travel: [['router', 'gpu', 'by priority']],
      },
      {
        title: 'Write tokens to a buffer, not a socket',
        narration:
          'The GPU server appends tokens in small numbered chunks to a buffer keyed by message ID. The API server holding the client connection tails that buffer and forwards each chunk as an SSE event with its number.',
        tradeoff:
          'Streaming straight from the GPU to the API server is one hop shorter, and ties the generation to a single connection that may drop. A buffer costs a few milliseconds per chunk and a store to run, and lets the answer keep generating whatever happens to the client.',
        nodes: ['gpu', 'buffer', 'api', 'client'],
        travel: [
          ['gpu', 'buffer', 'tokens'],
          ['buffer', 'api', 'tail'],
        ],
      },
      {
        title: 'Resume after a dropped connection',
        narration:
          'A phone switches networks mid-answer. The client reconnects to any API server with the last event number it saw, and that server replays the buffer from there and keeps tailing. The buffer expires a few minutes after the answer ends.',
        tradeoff:
          'Without resume, a dropped connection means asking again and paying for the whole answer twice. Keeping chunks for a few minutes costs memory in the buffer, which is small next to the GPU time it saves.',
        nodes: ['client', 'api', 'buffer'],
        travel: [
          ['client', 'api', 'SSE'],
          ['buffer', 'api', 'tail'],
        ],
      },
      {
        title: 'Check the output as it streams',
        narration:
          'The API sends the answer to the safety service in chunks of a sentence or two while it streams. If a chunk is blocked, the API stops the generation, replaces the visible text with a notice and marks the message blocked.',
        tradeoff:
          'Checking only the finished answer is cheaper, and shows harmful text to the user before it is caught. Checking chunks while streaming adds calls and a small delay per chunk, and can still let one chunk through, which is why the check runs slightly behind display only for low-risk categories.',
        nodes: ['api', 'safety', 'client'],
        travel: [['api', 'safety', 'check']],
      },
      {
        title: 'Shed and degrade under load',
        narration:
          'Capacity control watches queue depth and time to first token. It adds GPU servers when the trend rises, but new ones take minutes to load a model, so in the meantime it sheds free-tier requests past their deadline or routes them to a smaller model.',
        tradeoff:
          'Queuing everything forever looks kind and ends with every user timing out. Shedding and degrading gives free users a worse or refused answer during peaks, and in exchange paid users keep their latency and the pool never collapses.',
        nodes: ['capacity', 'router', 'gpu', 'small'],
        travel: [
          ['capacity', 'router', 'shed'],
          ['capacity', 'gpu', 'scale'],
          ['router', 'small', 'degrade'],
        ],
      },
      {
        title: 'Save the answer and settle usage',
        narration:
          'When the stream ends, the API saves the assistant message with its real token count and status. It emits a usage event, and the meter settles the earlier estimate against the actual tokens for limits and billing.',
        tradeoff:
          'Writing the answer to the database token by token would cost thousands of writes per message. Saving once at the end relies on the buffer to hold the answer until then; the cost is a short window where a crash of the API server leaves the answer only in the buffer, so a sweeper saves orphaned answers.',
        nodes: ['api', 'convdb', 'meter'],
        travel: [
          ['api', 'convdb', 'history'],
          ['api', 'meter', 'usage'],
        ],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we stream tokens and survive a dropped connection?',
      options: [
        {
          name: 'Client polls for the finished answer',
          pros: 'Plain requests; nothing long-lived to manage.',
          cons: 'The user stares at a spinner for the whole answer, which defeats the point of streaming.',
        },
        {
          name: 'WebSocket per user',
          pros: 'Two-way, so stop and new messages can share the connection.',
          cons: 'Stateful gateways, sticky routing and more trouble with proxies, for traffic that is mostly one way.',
        },
        {
          name: 'SSE fed from a per-message buffer',
          pros: 'Plain HTTP, built-in event IDs for resume, and any API server can serve a reconnect.',
          cons: 'A buffer store to run, and one direction only; stop goes as a separate request.',
        },
      ],
      choice:
        'SSE from a short-lived buffer keyed by message ID. Tokens flow one way, so a WebSocket buys little, and the buffer decouples the generation from whichever server holds the connection.',
    },
    {
      question: 'How do we share scarce GPUs across tiers?',
      options: [
        {
          name: 'One shared queue',
          pros: 'Simple and keeps every GPU busy.',
          cons: 'A free-tier surge delays paid users, and nothing protects latency targets.',
        },
        {
          name: 'Separate GPU pools per tier',
          pros: 'Strong isolation; a paid user never waits behind a free one.',
          cons: 'Pools sit idle at different hours, and GPUs are too expensive to leave idle.',
        },
        {
          name: 'Shared pools with priority queues and admission control',
          pros: 'High use of every GPU, with paid traffic served first and free traffic shed first.',
          cons: 'A scheduler that must track memory per request and tune deadlines and shares.',
        },
      ],
      choice:
        'Shared pools per model with priority queues, a reserved slice for enterprise contracts, deadlines on every request, and shedding or a smaller model for the free tier under load. Autoscaling follows queue depth with headroom, because adding a GPU server takes minutes.',
    },
    {
      question: 'How do we limit usage when the cost is in tokens?',
      options: [
        {
          name: 'Requests per minute only',
          pros: 'Easy to explain and check in one atomic increment.',
          cons: 'Ignores that one long prompt can cost as much as hundreds of short ones.',
        },
        {
          name: 'Count tokens after the answer',
          pros: 'Exact, because the real numbers are known.',
          cons: 'Lets a burst of long requests through before any of them is counted.',
        },
        {
          name: 'Estimate tokens upfront, settle afterwards',
          pros: 'Blocks bursts early and still bills and limits on real usage.',
          cons: 'Estimates are wrong for any single request, so buckets drift until settled.',
        },
      ],
      choice:
        'Two buckets per user and tier, one for requests and one for tokens, charged with an estimate on admission and settled from the usage event at the end. Enterprise customers share a pool per organization, and the remaining quota is returned in response headers.',
    },
  ],
  wrapUp:
    'Charge requests and estimated tokens per tier, screen the input, build a bounded context from a summary and recent turns, queue by model and priority, run continuous batches on shared GPUs, stream tokens through a resumable buffer over SSE, check the output as it flows, shed free traffic before the pool collapses, and settle real usage at the end.',
};
