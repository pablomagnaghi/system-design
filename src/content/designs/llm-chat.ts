import type { Design } from '../types';

export const llmChat: Design = {
  slug: 'llm-chat',
  title: 'LLM chat assistant',
  summary:
    'A chat assistant on top of large language models for many tenants: stream each answer token by token and resume it after a dropped connection, store one answer per turn however often a request repeats, share a model quota measured in tokens between paid and free users, and bill each turn for the tokens it really used.',
  difficulty: 'Hard',
  minutes: 14,
  requirements: {
    functional: [
      'Send a message in a conversation and receive the answer streamed token by token. One message and its answer are a turn.',
      'Reconnect in the middle of an answer and continue from the last piece received. Stop a generation halfway and keep what was produced.',
      'Regenerate an answer, and list, reopen, rename and delete conversations.',
      'Inside a turn, the model can search the documents of the user’s tenant and use what it finds.',
      'Two tiers, free and paid, with a different model, token limit and priority each. A tenant is an organization or a single account.',
      'Block disallowed prompts and answers, and record how many tokens every turn used for limits and billing.',
    ],
    nonFunctional: [
      'About 100 turns a second on average and 300 at peak for 1 million daily users, with about 2,700 answers streaming at once at peak.',
      'First token within 3 seconds of the request for 95% of paid turns and within 10 seconds for free turns, then a steady stream of about 50 tokens a second.',
      'One stored answer per turn: requests, queue messages and workers can repeat, and a conditional write on the turn id lets one worker generate and one final state be written.',
      'Every accepted turn ends as done, stopped, blocked or failed with a reason. A partial answer is never shown as complete: when the model stream breaks, the user stops it or the answer reaches its token cap, the text so far is stored and marked; when the worker dies, the turn fails and its partial text is not stored.',
      'Model capacity is a quota in tokens a minute and is the scarce resource: a free surge must not delay paid turns, and load beyond the quota is refused at the door instead of queued without limit.',
      'A turn is billed at most once, in the same write that stores its final state: from the provider’s token counts when the model call ended normally, from an estimate marked as such when it was stopped, and not at all when it failed.',
      'Each user reads only their own conversations, retrieval is limited to the tenant’s documents by the service and not by the model, and prompts and answers are encrypted at rest and kept out of logs.',
    ],
    outOfScope: [
      'Training, fine-tuning and hosting models on our own GPUs. The models are a managed endpoint with a quota.',
      'Ingesting and indexing the tenant’s documents. The knowledge base exists and is kept up to date by another system.',
      'Tools other than document search: code execution, browsing and third-party actions.',
      'Images, audio and file uploads inside a message.',
      'Sharing a conversation between users, and search across past conversations.',
      'A monthly spend cap per tenant, invoices and payments. The design produces exact usage per user and month; billing reads it.',
      'Sign-up, sign-in and the identity provider. Requests arrive with a signed token that names the user and the tenant.',
    ],
  },
  entities: [
    {
      name: 'Tenant',
      description:
        'An organization or a single account: tier (free or paid), tokens per minute allowed, the guardrail and the knowledge base it uses.',
    },
    {
      name: 'Conversation',
      description:
        'Per user: id, title, created at, last turn at, a rolling summary of older turns and the time up to which the summary covers.',
    },
    {
      name: 'Turn',
      description:
        'One user message and its one answer, keyed by conversation and a turn id chosen by the client: parent turn, a hash of the request, status (queued, generating, done, stopped, blocked, failed), reason, the answer, an incomplete flag, citations, the model that answered, token usage, the estimate charged, a stop flag, accepted at and a deadline.',
    },
    {
      name: 'Token window',
      description:
        'Per tenant and minute: the tokens charged so far, compared with the tenant’s limit. Expires on its own.',
    },
    {
      name: 'Usage',
      description:
        'Per tenant, month, user and model: input tokens, tokens read from and written to the prompt cache, output tokens and the number of turns. What billing reads.',
    },
    {
      name: 'Stream',
      description:
        'Per turn, in memory for 10 minutes: the pieces of the answer in order, each with a sequence number, and an end marker.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/conversations',
      description:
        'Body: conversationId chosen by the client, title. Creates the conversation with a conditional write, so a repeat returns the same one.',
    },
    {
      method: 'POST',
      path: '/conversations/{id}/turns',
      description:
        'Body: turnId (the idempotency key, chosen by the client), parentTurnId, content. Answers with a server-sent event stream: accepted, then numbered pieces of the answer, then done with the final status and usage. The turn id is looked up first: a repeat with the same turnId attaches to the same turn, never starts a second answer and is never refused as busy; the same turnId with different content answers 409. A new turn over the lane’s admission rate or over the tenant’s token limit answers 429 with Retry-After and stores nothing. Regenerating, or trying again after a failed turn, is a new turnId under the same parent.',
    },
    {
      method: 'GET',
      path: '/conversations/{id}/turns/{turnId}/stream',
      description:
        'Header: Last-Event-ID. Continues the stream after that sequence number while the buffer lives, 10 minutes from the first piece. After that, or when the buffer is unavailable, it sends the stored answer in one event.',
    },
    {
      method: 'POST',
      path: '/conversations/{id}/turns/{turnId}/stop',
      description:
        'Sets a stop flag on the turn with a conditional write. The worker sees it within 5 seconds, ends the model call and stores what was produced as stopped. Repeating it changes nothing.',
    },
    {
      method: 'GET',
      path: '/conversations/{id}/turns',
      description:
        'The turns of a conversation with their status. A turn that is not final and past its deadline is written as failed before it is returned.',
    },
    {
      method: 'GET, PATCH, DELETE',
      path: '/conversations and /conversations/{id}',
      description:
        'List, rename and delete. Delete removes the turns in batches and the conversation row last, so repeating a delete that broke halfway finishes it.',
    },
    {
      method: 'GET',
      path: '/usage?month=',
      description: 'Token usage per user for the caller’s tenant and month.',
    },
  ],
  dataFlow: [
    'The client posts a turn with an id it chose. The Chat API checks the conversation’s owner and looks the turn id up. A repeat is attached to the turn that exists. For a new turn the API takes a place at the door of the tenant’s tier, charges an estimate to the tenant’s token window, writes the turn row with a conditional write, puts a message on the queue of that tier and opens the event stream.',
    'A worker of that tier receives the message and claims the turn with a conditional write that only succeeds while the turn is queued. It builds the prompt from the system prompt, the conversation summary and the recent turns.',
    'The worker calls the model endpoint with a guardrail attached, and writes each piece of the answer to a short-lived buffer that the API relays to the client. If the model asks for a document search, the worker runs it and calls the model again.',
    'A client that lost its connection reconnects to any API task with the last sequence number it saw and continues from the buffer.',
    'When the model stops, the worker stores the answer, the final status and the token usage in one transaction, conditional on the turn still being its own. Then it corrects the token window by the real count, if that minute is still running.',
    'Each API task admits new turns of a lane at a fixed rate, just under what the lane’s model quota carries, and refuses the rest with 429; when the provider throttles, the worker retries inside its budget and the paid lane falls back to a second model.',
  ],
  highLevel: {
    label: 'Answer one chat message',
    intro:
      'Follow one turn from the request to the stored answer. The design grows one piece at a time: an id that makes repeats harmless, a token limit per tenant, a worker that owns the answer, a buffer that survives a dropped connection, a guardrail and a document search. Then a surge shows why each tier needs its own queue and budget, and the provider throttles. Numbers are illustrative; P95 is the time to the first token. Press play, or step through the stages.',
    nodes: [
      { id: 'client', title: 'Client', detail: 'Reads an event stream', column: 0, row: 'middle' },
      {
        id: 'limits',
        title: 'Limits table',
        detail: 'Tokens per minute',
        column: 1,
        row: 'top',
        appearsAt: 1,
      },
      { id: 'api', title: 'Chat API', detail: 'Accept and relay', column: 1, row: 'middle' },
      {
        id: 'buffer',
        title: 'Token buffer',
        detail: 'A stream per turn',
        column: 2,
        row: 'top',
        appearsAt: 3,
      },
      { id: 'queue', title: 'Turn queue', detail: 'Waiting turns', column: 2, row: 'middle' },
      { id: 'turns', title: 'Turns table', detail: 'One row per turn', column: 2, row: 'bottom' },
      {
        id: 'workers',
        title: 'Workers',
        detail: 'Claim, generate',
        column: 3,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'kb',
        title: 'Knowledge base',
        detail: 'Tenant documents',
        column: 4,
        row: 'top',
        appearsAt: 6,
      },
      {
        id: 'model',
        title: 'Model endpoint',
        detail: 'Quota in tokens',
        column: 4,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'fallback',
        title: 'Fallback model',
        detail: 'Free lane’s model',
        column: 4,
        row: 'bottom',
        appearsAt: 10,
      },
      {
        id: 'guard',
        title: 'Guardrail',
        detail: 'Input and output',
        column: 5,
        row: 'middle',
        appearsAt: 5,
      },
    ],
    edges: [
      ['client', 'api', 'SSE'],
      ['api', 'limits'],
      ['api', 'turns'],
      ['api', 'queue'],
      ['api', 'buffer'],
      ['queue', 'workers'],
      ['workers', 'turns'],
      ['workers', 'buffer'],
      ['workers', 'model'],
      ['workers', 'kb'],
      ['workers', 'fallback'],
      ['model', 'guard'],
    ],
    stages: [
      {
        title: 'Accept a turn under one id',
        narration:
          'The client posts the message with a turn id it generated. The Chat API checks that the conversation belongs to the caller, a read of the conversations table, which is not drawn, looks the turn id up and finds no row, writes the turn row as queued with a conditional write that only succeeds if no row has that id, puts a small message on the queue and opens a server-sent event stream whose first event is accepted. A client that timed out sends the same id again: the API finds the existing row, or its write fails the condition if the two requests raced, and the caller is attached to the turn that exists. If the turn is still queued the API also sends the queue message again, in case the first one was never sent.',
        tradeoff:
          'A row and then a queue message are two writes, and a crash between them leaves a queued turn that no worker knows about. The repeat from the client is the replay, and a turn that nobody repeats fails as busy at its deadline, 15 seconds after its row was written, so it is never left open. Making the queue the first write would avoid the gap, but then a repeat could not be told from a new turn until a worker picked it up, and the caller could not be attached to an answer already streaming.',
        nodes: ['client', 'api', 'turns', 'queue'],
        travel: [
          ['client', 'api', 'SSE'],
          ['api', 'turns'],
          ['api', 'queue'],
        ],
        short: 'Accept',
        metrics: {
          users: '1M',
          requestsPerSecond: '300',
          p95Latency: '1.5 s',
          errorRate: '0.1%',
          custom: [{ label: 'Accept p95', value: '60 ms' }],
        },
        load: { api: 25, turns: 20, queue: 10 },
      },
      {
        title: 'Charge the tenant’s token window',
        narration:
          'For a new turn, after the lookup and before the row is written, the API charges the tenant. Each tenant has one row per minute that counts tokens, and the API adds an estimate to it with a conditional write that fails if the total would pass the tenant’s limit: the size of the conversation so far, the new message and 500 tokens for the answer. Over the limit, the request is answered 429 with the seconds left in the minute and nothing is stored. A repeat of a turn that already exists is not charged again.',
        tradeoff:
          'Counting requests is simpler, and then one user pasting a book costs as much as a hundred short questions. Tokens match what the model quota is spent on; the cost is that the answer’s length is unknown at the door, so the charge is an estimate that the worker corrects when the turn ends, if that minute is still running. A fixed minute lets a tenant spend two limits around a boundary, and a repeat that arrives before the row is written is charged twice; both wear off within the minute, because the row expires.',
        nodes: ['api', 'limits'],
        travel: [['api', 'limits']],
        short: 'Token limit',
        metrics: {
          users: '1M',
          requestsPerSecond: '300',
          p95Latency: '1.5 s',
          errorRate: '0.1%',
          custom: [{ label: 'Accept p95', value: '60 ms' }],
        },
        load: { api: 25, limits: 20 },
      },
      {
        title: 'One worker claims the turn and builds the context',
        narration:
          'A worker receives the queue message and claims the turn: a conditional write that moves it from queued to generating and sets a deadline 20 seconds ahead, which the worker pushes forward every 5 seconds while it works. Of two messages for the same turn, one claim succeeds and the other worker drops its message. The claim holder reads the conversation with a consistent query, its row from the conversations table, which is not drawn, and its turns from the turns table, and builds the prompt: the system prompt and tool definitions first, then the summary of older turns, then the recent turns, then the new message. A turn that ended as blocked, or that failed or was stopped with no answer text from the model, is left out. History is capped at 16,000 tokens.',
        tradeoff:
          'A worker that owns the turn from claim to stored answer means the answer never depends on the client’s connection or on the API task that accepted it. The cost is a queue hop on every turn and a write every 5 seconds per running answer. Sending the whole history would be exact and would grow the cost of every turn without limit; a summary plus recent turns bounds it, and details from early turns can be lost.',
        nodes: ['queue', 'workers', 'turns'],
        travel: [
          ['queue', 'workers'],
          ['workers', 'turns'],
        ],
        short: 'Claim',
        metrics: {
          users: '1M',
          requestsPerSecond: '300',
          p95Latency: '1.5 s',
          errorRate: '0.1%',
          custom: [{ label: 'Wait in queue p95', value: '50 ms' }],
        },
        load: { queue: 10, workers: 45, turns: 30 },
      },
      {
        title: 'Stream into a buffer, not a socket',
        narration:
          'The worker calls the model endpoint with a streaming request. Every 100 milliseconds it appends what arrived, about five tokens, to a stream in the token buffer, keyed by the turn id and numbered by the worker. The API task that holds the client’s connection reads that stream and forwards each piece as an event with its number. The prompt is laid out so the endpoint can reuse its cached prefix: about half of the 4,000 input tokens of an average turn are read from the prompt cache.',
        tradeoff:
          'Streaming straight from the worker to the client would be one hop shorter and would tie the answer to one connection and one task. The buffer costs an in-memory store and a few milliseconds per piece. It is a display channel and not the record: the worker keeps the whole answer in memory and stores it itself, so a buffer that loses pieces costs the live view and not the answer.',
        nodes: ['workers', 'model', 'buffer', 'api', 'client'],
        travel: [
          ['workers', 'model'],
          ['workers', 'buffer'],
          ['api', 'buffer'],
          ['client', 'api', 'SSE'],
        ],
        short: 'Stream',
        metrics: {
          users: '1M',
          requestsPerSecond: '300',
          p95Latency: '1.5 s',
          errorRate: '0.1%',
          custom: [
            { label: 'Answers streaming', value: '2,700' },
            { label: 'Buffer appends', value: '27K/s' },
          ],
        },
        load: { workers: 55, model: 60, buffer: 35, api: 30 },
        traffic: [{ edge: ['workers', 'model'], kind: 'heavy' }],
      },
      {
        title: 'Resume after a dropped connection',
        narration:
          'A phone changes network in the middle of an answer. The worker does not notice and keeps generating. The client reconnects to any API task with the last sequence number it received, and that task reads the buffer from the next number on. The buffer keeps a turn for 10 minutes from its first piece. Later than that, or when the buffer has a gap or cannot be reached, the API waits for the turn to be final and sends the stored answer in one event.',
        tradeoff:
          'Without resume, a dropped connection means asking again and paying for a second answer. Keeping every piece for 10 minutes costs about 2 GB of memory at peak, small next to the model tokens it saves. The fallback to the stored answer means a reconnect never fails for lack of the buffer; it only loses the token-by-token view.',
        nodes: ['client', 'api', 'buffer'],
        travel: [
          ['client', 'api', 'SSE'],
          ['api', 'buffer'],
        ],
        short: 'Resume',
        metrics: {
          users: '1M',
          requestsPerSecond: '300',
          p95Latency: '1.5 s',
          errorRate: '0.1%',
          custom: [{ label: 'Buffer kept', value: '10 min' }],
        },
        load: { api: 30, buffer: 35 },
        traffic: [{ edge: ['client', 'api'], kind: 'failed' }],
      },
      {
        title: 'A guardrail on the way in and out',
        narration:
          'The model call carries the tenant’s guardrail, whose policies block and never mask. It checks the new user message before the model runs and the answer while it streams, holding each chunk until it has been scanned. Only the new message is marked for the input check, so the history is not scanned again on every turn: it holds only turns with answer text from the model, whose messages passed the check when they were new, because a turn that ended as blocked or with no answer text is left out of later prompts and of summaries. When the guardrail intervenes, the call ends with that stop reason and the configured notice as its text. The worker stores the turn as blocked with the notice as its answer, and the done event tells the client to show the notice in place of anything already on the screen.',
        tradeoff:
          'Scanning each chunk before releasing it adds latency to every answer; in exchange no chunk is shown before it was scanned, where the asynchronous mode streams at full speed and scans behind the text. Chunks released before a later one is blocked have been shown: they are replaced by the notice when the turn ends, and none of them is stored. Running the check inside the model call means no second service to call and no path where the model answers without it; if the guardrail is down, the call fails and the turn follows the retry path.',
        nodes: ['workers', 'model', 'guard'],
        travel: [
          ['workers', 'model'],
          ['model', 'guard'],
        ],
        short: 'Guardrail',
        metrics: {
          users: '1M',
          requestsPerSecond: '300',
          p95Latency: '1.5 s',
          errorRate: '0.1%',
          custom: [{ label: 'Turns blocked', value: '0.3%' }],
        },
        load: { workers: 55, model: 60, guard: 40 },
      },
      {
        title: 'A document search inside the turn',
        narration:
          'About one turn in five needs the tenant’s documents. The model stops and asks for the search tool with a query. The worker runs the search against the knowledge base, with the tenant filter taken from the signed request and never from the model’s output, and writes a short status piece to the buffer so the client can show that a search is running. It then calls the model again with the passages, and the answer streams. A turn makes at most three searches, and each has 3 seconds.',
        tradeoff:
          'Searching on every turn would be simpler and would add latency and tokens to the four turns in five that do not need it. Letting the model decide costs a second model call when it does search. A search that fails or times out is returned to the model as an error, so it answers without the documents and says so, which is weaker than failing the turn and far better for the user. The guardrail does not scan tool results, so retrieved passages reach the model unchecked.',
        nodes: ['workers', 'kb', 'model'],
        travel: [
          ['workers', 'kb'],
          ['workers', 'model'],
        ],
        short: 'Search',
        metrics: {
          users: '1M',
          requestsPerSecond: '300',
          p95Latency: '1.5 s',
          errorRate: '0.1%',
          custom: [{ label: 'Turns with a search', value: '20%' }],
        },
        load: { workers: 55, kb: 30, model: 60 },
      },
      {
        title: 'Store the answer and the usage in one write',
        narration:
          'When the model stops, the worker stores the result in one transaction: the turn moves to done with the answer, the model and the token counts the endpoint reported, and the same transaction adds those counts to the user’s usage row for the month, which sits in a usage table that is not drawn. Both are conditional on the turn still being in generating. Then the worker appends the end marker to the buffer, and the API sends the done event.',
        tradeoff:
          'One transaction costs twice the write units of two plain writes, and it removes the case where an answer is stored and not billed or billed and not stored. The usage row is per user and not per tenant on purpose: a single row per tenant would be written by every turn of a large tenant at once, and concurrent transactions on one item cancel each other. The correction of the tenant’s token window comes after it and is not drawn: a separate write that can be lost, which only leaves the estimate in place until the minute ends.',
        nodes: ['workers', 'turns', 'buffer'],
        travel: [
          ['workers', 'turns'],
          ['workers', 'buffer'],
        ],
        short: 'Store + bill',
        metrics: {
          users: '1M',
          requestsPerSecond: '300',
          p95Latency: '1.5 s',
          errorRate: '0.1%',
          custom: [{ label: 'Table writes', value: '6.5K units/s' }],
        },
        load: { workers: 55, turns: 40, buffer: 35 },
      },
      {
        title: 'A free surge fills the model quota',
        narration:
          'A product launch brings four times the usual free traffic: 840 free turns a second next to 90 paid ones. So far there is one queue, one worker pool and one model, whose quota carries about 375 turns a second. The queue grows by 555 turns a second. Within half a minute every turn that is served has waited close to the 15 seconds a turn is allowed to wait, six in ten wait longer and fail as busy, and paid users are in the same line as everyone else.',
        tradeoff:
          'More workers do not help, because the model quota sets the pace and not the workers. Letting the queue grow is worse than it looks: the queue serves the turns that waited longest first, so in overload it spends the quota on the users who are most likely to have given up. Something has to refuse work at the door and keep paid turns out of the free line.',
        nodes: ['client', 'api', 'queue', 'workers', 'model'],
        travel: [
          ['client', 'api', 'SSE'],
          ['api', 'queue'],
          ['queue', 'workers'],
          ['workers', 'model'],
        ],
        short: 'Free surge',
        metrics: {
          users: '1M',
          requestsPerSecond: '930',
          p95Latency: '15 s',
          errorRate: '60%',
          alerts: ['p95Latency', 'errorRate'],
          custom: [{ label: 'Queue growth', value: '555/s', alert: true }],
        },
        load: { api: 60, queue: 98, workers: 95, model: 100 },
        traffic: [{ edge: ['api', 'queue'], kind: 'heavy' }],
      },
      {
        title: 'A lane per tier, and refuse at the door',
        narration:
          'The queue, the worker pool and the model each become two, drawn as one box each: a paid lane and a free lane, each with its own quota. The paid model carries 150 turns a second and the smaller free model 225. Each worker task holds a local token bucket, its lane’s quota divided by the pool’s size, and takes from it before every model call. The door works the same way in the API: each of its 12 tasks holds a bucket of turns per lane and admits a twelfth of 96% of what the lane carries, 144 paid and 216 free turns a second in all, and answers the rest with 429. The turn id is looked up first, so a repeat of a turn that exists is never refused. In the same surge, paid turns are untouched and three in four free requests are refused within milliseconds.',
        tradeoff:
          'Two pools and two quotas leave capacity idle: free turns cannot use paid headroom at night. In return a free surge cannot take queue position, worker slots or model tokens from a paid turn, and there is no shared limiter to run. Refusing at the door gives a free user an immediate "busy, try again" in place of a 15-second wait that ends the same way. While every worker task of the lane is running and the reservations in flight have settled, the door admits a little less than the lane drains, so a surge, however large, can queue at most the one second of turns the buckets hold, and an accepted turn waits about a second at worst; for a minute or two after a jump from a low rate the wait can reach a few seconds. The door counts turns and never looks at the queue: if the lane drains more slowly than planned, because a worker task is being replaced, the provider is slow or the prompt cache is cold, the queue grows and the 15-second deadline is the bound.',
        nodes: ['api', 'queue', 'workers', 'model'],
        travel: [
          ['api', 'queue'],
          ['queue', 'workers'],
          ['workers', 'model'],
        ],
        short: 'Lanes + door',
        metrics: {
          users: '1M',
          requestsPerSecond: '930',
          p95Latency: '1.5 s',
          errorRate: '0.1%',
          custom: [
            { label: 'Paid first token p95', value: '1.5 s' },
            { label: 'Free first token p95', value: '2.5 s' },
            { label: 'Free refused', value: '74%' },
          ],
        },
        load: { api: 60, queue: 60, workers: 85, model: 95 },
      },
      {
        title: 'The provider throttles: retry, then fall back',
        narration:
          'The provider starts refusing calls to the paid model, although the lane is inside its budget: a 429 when the account’s quota is the cause, a 503 or 529 when the provider is short of capacity, and the worker treats them alike. A model call that is throttled, fails or shows no first token within 5 seconds is tried again on the same model after 0.5 and then 1 second. Every try takes tokens from the task’s bucket again, so retries cannot push the lane above its budget. After three tries a paid turn makes that call once on the fallback model, the smaller one that serves the free lane, and the turn records which model answered. A free turn has no fallback and fails with the reason capacity. The rule covers every model call of a turn that has shown no answer text yet, so the call after a document search is retried the same way. Once answer text has been shown there is no retry: a stream that breaks is stored as failed with the partial text marked incomplete.',
        tradeoff:
          'A fallback gives a paid user a weaker answer in place of an error, and it borrows from the free model’s quota without the free lane’s bucket seeing it, so free turns may be throttled meanwhile: paid first, on purpose. Retrying after the first token would mean erasing text the user has already read and paying for the whole answer twice, so the user decides with the regenerate button.',
        nodes: ['workers', 'model', 'fallback'],
        travel: [
          ['workers', 'model'],
          ['workers', 'fallback'],
        ],
        short: 'Throttled',
        metrics: {
          users: '1M',
          requestsPerSecond: '300',
          p95Latency: '3.5 s',
          errorRate: '0.4%',
          alerts: ['p95Latency'],
          custom: [
            { label: 'Paid calls throttled', value: '50%', alert: true },
            { label: 'Paid on fallback', value: '13%' },
          ],
        },
        load: { workers: 70, model: 100, fallback: 45 },
        traffic: [{ edge: ['workers', 'model'], kind: 'failed' }],
      },
    ],
  },
  flows: [
    {
      id: 'accept',
      title: 'Accept a turn',
      kind: 'sync',
      summary:
        'Ana, on a paid tenant, sends a message. The API finds no turn with that id, takes a place at the paid door, charges the tenant’s token window, writes the turn, queues it and opens the stream, in about 40 milliseconds.',
      runsOn: 'Application Load Balancer → Chat API on ECS Fargate → Amazon DynamoDB → Amazon SQS',
      participants: [
        { id: 'client', label: 'Client', service: 'Browser or app' },
        { id: 'api', label: 'Chat API', service: 'ALB + ECS Fargate' },
        { id: 'convs', label: 'Conversations', service: 'DynamoDB' },
        { id: 'limits', label: 'Limits table', service: 'DynamoDB' },
        { id: 'turns', label: 'Turns table', service: 'DynamoDB' },
        { id: 'sqs', label: 'Paid queue', service: 'SQS standard' },
      ],
      steps: [
        {
          from: 'client',
          to: 'api',
          label: 'POST /conversations/c1/turns {turnId: t9, parentTurnId: t8, content}',
          note: 'The client generated t9 and will send the same id on any retry. The signed token names the user and the tenant, and the tenant’s tier and limits come from a copy the task refreshes every minute.',
        },
        {
          from: 'api',
          to: 'convs',
          label: 'GetItem (user, c1)',
          note: 'The key is the caller’s user id and the conversation id, so a row that exists is a conversation the caller owns. No row answers 404.',
        },
        {
          from: 'api',
          to: 'turns',
          label: 'GetItem (c1, t9) and (c1, t8), consistent',
          note: 'No row for t9: this is a new turn, and only a new turn goes through the next two steps. A row that exists makes the request a repeat: it is attached to that turn, and neither the door nor the token window can refuse it. The parent t8 is final, and its token counts say how large the conversation is. A parent that is still generating answers 409.',
        },
        {
          from: 'api',
          to: 'api',
          label: 'take one turn from the paid door bucket',
          note: 'In memory, with no call to anything. This task’s bucket for the paid lane refills at 12 turns a second, a twelfth of the 144 the door admits, and holds one second of them. An empty bucket ends the request with 429 and the reason busy, and nothing was stored or charged.',
        },
        {
          from: 'api',
          to: 'limits',
          label: 'UpdateItem ADD used :estimate IF no counter yet OR used <= :room',
          note: 'The row is the tenant and the current minute, and :room is the tenant’s limit minus the estimate. The first charge of a minute finds no counter and passes. The estimate is the conversation so far, the new message and 500 tokens of answer; one larger than the whole limit is refused without a write. A failed condition answers 429 with the seconds left in the minute, the task puts the turn back in its door bucket, and nothing was stored.',
        },
        {
          from: 'api',
          to: 'turns',
          label: 'PutItem status=queued, deadline=now+15 s IF attribute_not_exists',
          note: 'The turn exists from here, with the message, a hash of the request, the tier and the estimate. If a repeat won the race, this write fails and the request continues as a duplicate; its place at the door and its window charge are not given back and wear off within the second and the minute.',
        },
        {
          from: 'api',
          to: 'sqs',
          label: 'SendMessage {c1, t9}',
          note: 'Only the keys travel. A crash before this line leaves a queued row and no message: the client’s retry sends it again, and without a retry the turn fails as busy at its deadline.',
        },
        {
          from: 'api',
          to: 'client',
          label: '200 text/event-stream, event: accepted',
          note: 'The headers are sent after the queue acknowledged the message, and this is the moment the turn counts as accepted. The task now reads the buffer for t9 and relays it.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'generate',
      title: 'Generate and stream the answer',
      kind: 'queue',
      summary:
        'A paid worker claims the turn, calls the model, writes pieces to the buffer for the API to relay, and stores the answer and its usage in one transaction.',
      runsOn:
        'Amazon SQS → worker on ECS Fargate → Amazon Bedrock → ElastiCache for Valkey → Amazon DynamoDB',
      participants: [
        { id: 'sqs', label: 'Paid queue', service: 'SQS standard' },
        { id: 'worker', label: 'Worker', service: 'ECS Fargate' },
        { id: 'tables', label: 'Turns and usage', service: 'DynamoDB' },
        { id: 'model', label: 'Model endpoint', service: 'Amazon Bedrock' },
        { id: 'buffer', label: 'Token buffer', service: 'ElastiCache for Valkey' },
        { id: 'api', label: 'Chat API', service: 'ECS Fargate' },
      ],
      steps: [
        {
          from: 'sqs',
          to: 'worker',
          label: 'ReceiveMessage, long polling',
          note: 'The message is hidden for 5 seconds, far longer than a claim takes. If the worker dies before claiming, another one receives the message while the turn is still inside its 15 seconds. A task receives only while it has a free slot and tokens in its bucket.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'tables',
          label: 'UpdateItem status=generating, deadline=now+20 s IF status=queued',
          note: 'The claim, which also stores an id the worker made up for this receive. One worker can make this write succeed, so one worker ever generates this turn. If it fails, the worker reads the row: the id of this receive means the reply to an earlier try of the same write was lost and it carries on, and anything else means the turn is taken or final. If the turn is already past its 15-second deadline, the worker writes failed with the reason busy. In every case the queue message is deleted right after: from here the row is the record.',
        },
        {
          from: 'worker',
          to: 'tables',
          label: 'Query conversation c1 by time, consistent',
          note: 'The conversation row gives the summary and where it ends; the index by creation time gives the turns after it. The worker follows parent links from t8 back, so an answer that was regenerated away is left out. A turn on that chain that ended as blocked, or that failed or was stopped with no answer text from the model, is left out with its message, so the history holds only messages that passed the input check.',
        },
        {
          from: 'worker',
          to: 'model',
          label: 'ConverseStream, guardrail attached, maxTokens 2,048',
          note: 'After taking the input estimate plus 2,048 tokens from the task’s bucket, which is at least what the provider reserves at the start of a request; the worker cannot know the cache hit in advance. After the call the task settles its bucket to the real count, the input not read from the cache plus the output at the model’s rate, which can be more than the reservation: at a rate of 5 a full answer of 2,048 tokens counts 10,240, and the difference can take the bucket below zero until it refills. The bucket holds one second of the task’s share, as the door’s does. A reservation larger than the bucket, which the largest prompt the design allows can be, is taken from a full bucket and takes it below zero in the same way, like a settlement above the reservation. Cache checkpoints sit after the system prompt and after the previous turn.',
        },
        {
          from: 'worker',
          to: 'buffer',
          label: 'XADD turn:t9 id=seq + EXPIREAT, every 100 ms',
          note: 'About five tokens per piece, numbered by the worker from 1. Each append sets the key’s expiry again in the same transaction, always to 10 minutes after the first piece, so a failover that drops the latest writes cannot leave a stream without an expiry. A write that fails is skipped: the worker keeps the full answer in memory.',
          style: 'async',
        },
        {
          from: 'api',
          to: 'buffer',
          label: 'XREAD BLOCK from the last seq',
          note: 'The task that holds Ana’s connection forwards each piece as an event whose id is the sequence number, and sends a comment line every 15 seconds so the connection is never idle. When the buffer is silent for 5 seconds it reads the turn row: a final turn is sent from the row, and a turn past its deadline is written as failed and reported.',
        },
        {
          from: 'worker',
          to: 'tables',
          label: 'UpdateItem deadline=now+20 s IF status=generating, every 5 s',
          note: 'The heartbeat. It also returns the stop flag. If it fails its condition, someone has failed or deleted the turn, and the worker ends the model call and discards the answer. At 90 seconds after the claim the worker ends the call itself and stores the turn as stopped with the reason time limit.',
        },
        {
          from: 'model',
          to: 'worker',
          label: 'messageStop end_turn, metadata {usage}',
          note: 'The last event carries the token counts: input, read from cache, written to cache and output. A call that ends with the stop reason max_tokens in place of end_turn reached the 2,048-token cap: the turn is stored as done with the incomplete flag set and billed from these counts, since the call ended normally, and the done event tells the client to show the answer as cut short. The other documented stop reasons end in states that already exist: content_filtered is stored as blocked, shown with the same notice and billed from these counts like any blocked turn; malformed_model_output, malformed_tool_use and model_context_window_exceeded are stored as failed with the reason model error, without another try, and bill nothing, like any failed turn; stop_sequence cannot occur, because the calls set no stop sequences.',
          style: 'reply',
        },
        {
          from: 'worker',
          to: 'tables',
          label: 'TransactWriteItems: turn done IF status=generating; usage ADD tokens',
          note: 'The answer and the bill in one step, with a request token so a repeat after a lost reply changes nothing. Then the worker appends the end marker to the buffer and corrects the tenant’s token window, each on a best-effort basis. The correction goes to the row of the minute the turn was charged in, and is skipped when that minute is over, because that row is no longer checked.',
        },
      ],
    },
    {
      id: 'resume',
      title: 'The client disconnects and resumes',
      kind: 'sync',
      summary:
        'Ana’s phone changes network at piece 41. The worker keeps going. The app reconnects to another API task and continues from piece 42.',
      runsOn: 'Application Load Balancer → Chat API on ECS Fargate → ElastiCache for Valkey',
      participants: [
        { id: 'client', label: 'Client', service: 'Browser or app' },
        { id: 'api', label: 'Chat API', service: 'ALB + ECS Fargate' },
        { id: 'turns', label: 'Turns table', service: 'DynamoDB' },
        { id: 'buffer', label: 'Token buffer', service: 'ElastiCache for Valkey' },
      ],
      steps: [
        {
          from: 'client',
          to: 'api',
          label: 'connection lost after id: 41',
          note: 'The first API task notices the closed connection and stops reading the buffer. Nothing tells the worker, and nothing needs to.',
          style: 'async',
        },
        {
          from: 'client',
          to: 'api',
          label: 'GET /conversations/c1/turns/t9/stream, Last-Event-ID: 41',
          note: 'The load balancer picks any task. No task holds state about the stream.',
        },
        {
          from: 'api',
          to: 'turns',
          label: 'GetItem (c1, t9)',
          note: 'After the owner check on the conversation. The turn is generating, so there is a stream to follow. A final turn whose buffer has expired is answered from this row.',
        },
        {
          from: 'api',
          to: 'buffer',
          label: 'XREAD turn:t9 after 41',
          note: 'The pieces written while the client was away come back at once, then the task keeps reading. If the first piece returned is not 42, pieces were lost, and the task switches to waiting for the stored answer.',
        },
        {
          from: 'api',
          to: 'client',
          label: 'events id: 42, 43, ... then done',
          note: 'No piece twice and none missing. The done event carries the final status and usage.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'duplicate',
      title: 'A duplicate send',
      kind: 'sync',
      summary:
        'The app times out before it sees the accepted event and posts the same turn again. The second request attaches to the first turn: one answer, one bill.',
      runsOn: 'Chat API on ECS Fargate → Amazon DynamoDB → Amazon SQS → ElastiCache for Valkey',
      participants: [
        { id: 'client', label: 'Client', service: 'Browser or app' },
        { id: 'api', label: 'Chat API', service: 'ECS Fargate' },
        { id: 'turns', label: 'Turns table', service: 'DynamoDB' },
        { id: 'sqs', label: 'Paid queue', service: 'SQS standard' },
        { id: 'buffer', label: 'Token buffer', service: 'ElastiCache for Valkey' },
      ],
      steps: [
        {
          from: 'client',
          to: 'api',
          label: 'POST /conversations/c1/turns {turnId: t9, ...} again',
          note: 'Same id, same body. The first request was accepted, and a worker is already generating.',
        },
        {
          from: 'api',
          to: 'turns',
          label: 'GetItem (c1, t9), consistent',
          note: 'The row exists and its request hash matches. A different hash would answer 409. Because the row was found, the request skips the door and the token window: a repeat is never refused as busy, even while the lane is refusing new turns, and never charged again.',
        },
        {
          from: 'api',
          to: 'sqs',
          label: 'SendMessage only if status=queued',
          note: 'Here the status is generating, so nothing is sent. For a queued turn the message is sent again, because the API cannot know whether the first request got that far. Two messages are harmless: the claim lets one worker through.',
        },
        {
          from: 'api',
          to: 'buffer',
          label: 'XREAD turn:t9 from the start',
          note: 'The repeat gets the answer from its first piece, the same pieces the first connection would have shown.',
        },
        {
          from: 'api',
          to: 'client',
          label: '200 text/event-stream, same turn',
          note: 'A regenerate is the opposite case: a new turnId under the same parent, which is a new turn with its own answer and its own usage, and the old answer stays stored beside it.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'quota',
      title: 'A tenant hits its token limit',
      kind: 'sync',
      summary:
        'Two users of a free tenant with 40,000 tokens a minute each paste a long document in the same minute. The window refuses the charge and nothing is stored or queued.',
      runsOn: 'Chat API on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'client', label: 'Client', service: 'Browser or app' },
        { id: 'api', label: 'Chat API', service: 'ECS Fargate' },
        { id: 'turns', label: 'Turns table', service: 'DynamoDB' },
        { id: 'limits', label: 'Limits table', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'client',
          to: 'api',
          label: 'POST /conversations/c4/turns {turnId: t3, content: 60 KB}',
          note: 'The message alone is about 15,000 tokens by the rule of four bytes per token. Messages above 64 KB are rejected with 413 before anything else.',
        },
        {
          from: 'api',
          to: 'turns',
          label: 'GetItem (c4, t3) and the parent',
          note: 'A new turn, so the task takes a turn from its free door bucket before it charges the window. The parent’s counts put the conversation at 16,000 tokens.',
        },
        {
          from: 'api',
          to: 'limits',
          label: 'UpdateItem ADD used 31,500 IF no counter yet OR used <= 8,500',
          note: 'The estimate is 16,000 + 15,000 + 500, and 40,000 − 31,500 leaves room for 8,500. The window already holds 31,500, charged this minute for a turn of another user of the tenant, so the condition fails and the counter is unchanged.',
        },
        {
          from: 'api',
          to: 'client',
          label: '429 token limit, Retry-After: 22',
          note: 'The seconds left in the minute. The task puts the turn back in its door bucket. No turn row exists, so the client can send the same turnId again after the wait.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'throttle',
      title: 'The model endpoint throttles',
      kind: 'queue',
      summary:
        'The provider throttles the paid model. The worker tries three times inside its token budget, then answers from the fallback model and records which model answered.',
      runsOn: 'Worker on ECS Fargate → Amazon Bedrock (two models) → Amazon DynamoDB',
      participants: [
        { id: 'worker', label: 'Paid worker', service: 'ECS Fargate' },
        { id: 'model', label: 'Paid model', service: 'Bedrock inference profile' },
        { id: 'fallback', label: 'Fallback model', service: 'Bedrock inference profile' },
        { id: 'buffer', label: 'Token buffer', service: 'ElastiCache for Valkey' },
        { id: 'tables', label: 'Turns and usage', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'worker',
          to: 'model',
          label: 'ConverseStream',
          note: 'The turn is claimed and its prompt is built. The task took the reservation from its bucket first.',
        },
        {
          from: 'model',
          to: 'worker',
          label: '429 ThrottlingException',
          note: 'A 429 ThrottlingException means the account’s quota for this model is used up. A provider short of capacity answers 503 ServiceUnavailableException or 529 overloaded_error instead. Those, any other error and no first token within 5 seconds are handled the same way.',
          style: 'reply',
        },
        {
          from: 'worker',
          to: 'model',
          label: 'retry after 0.5 s, then after 1 s',
          note: 'Each try takes its tokens from the bucket again, so a wave of retries slows the task’s receiving down and cannot raise the call rate above the lane’s budget. The heartbeat keeps the turn’s deadline ahead meanwhile.',
        },
        {
          from: 'worker',
          to: 'fallback',
          label: 'ConverseStream, same prompt, one try',
          note: 'After three failed tries, and only in the paid lane. The smaller model answers; its prompt cache is cold for this conversation, so this turn pays a cache write.',
        },
        {
          from: 'worker',
          to: 'buffer',
          label: 'XADD pieces',
          note: 'The user sees the first token about 1.5 seconds later than usual plus the fallback’s own start.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'tables',
          label: 'TransactWriteItems: done, model=fallback; usage ADD',
          note: 'The turn records the model that answered, and usage is counted under the model that served each call. If the fallback also fails, the same transaction shape stores failed with the reason capacity and adds nothing to usage.',
        },
      ],
    },
    {
      id: 'tool',
      title: 'A document search inside one turn',
      kind: 'queue',
      summary:
        'The model asks for the search tool. The worker searches the tenant’s knowledge base, hands the passages back and the model answers with citations, all inside one turn and one bill.',
      runsOn: 'Worker on ECS Fargate → Amazon Bedrock → Bedrock Knowledge Bases → DynamoDB',
      participants: [
        { id: 'worker', label: 'Worker', service: 'ECS Fargate' },
        { id: 'model', label: 'Model endpoint', service: 'Amazon Bedrock' },
        { id: 'kb', label: 'Knowledge base', service: 'Bedrock Knowledge Bases' },
        { id: 'buffer', label: 'Token buffer', service: 'ElastiCache for Valkey' },
        { id: 'tables', label: 'Turns and usage', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'worker',
          to: 'model',
          label: 'ConverseStream with toolConfig {search_documents}',
          note: 'The tool definition is part of the cached prefix, so offering it on every turn costs almost nothing.',
        },
        {
          from: 'model',
          to: 'worker',
          label: 'messageStop tool_use {toolUseId, query}',
          note: 'The model wants documents. The usage of this first call is kept in memory.',
          style: 'reply',
        },
        {
          from: 'worker',
          to: 'buffer',
          label: 'XADD status: searching',
          note: 'The client shows that a search is running, so the pause does not look like a stall.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'kb',
          label: 'Retrieve query, 5 results, filter tenant=acme, 3 s timeout',
          note: 'The filter comes from the signed request that created the turn. The model chooses the words of the query and nothing else. A timeout or an error is not retried.',
        },
        {
          from: 'worker',
          to: 'model',
          label: 'ConverseStream + toolResult {passages} or status error',
          note: 'A failed search goes back as an error result, and the model answers without documents and says so. At most three searches per turn; a fourth request ends the turn with what the model has, stored as done with the incomplete flag set, as at the token cap. This call has shown no answer text yet, so a throttle or an error here gets the same three tries and, for a paid turn, the fallback.',
        },
        {
          from: 'model',
          to: 'worker',
          label: 'text deltas, messageStop end_turn, usage',
          note: 'The answer streams to the buffer as usual. Its usage is added to the first call’s.',
          style: 'reply',
        },
        {
          from: 'worker',
          to: 'tables',
          label: 'TransactWriteItems: done, citations; usage ADD the sum',
          note: 'One turn, one stored answer and one usage entry that covers both model calls. The row keeps where each passage came from, not the passages.',
        },
      ],
    },
    {
      id: 'long-context',
      title: 'A long conversation outgrows its budget',
      kind: 'async',
      summary:
        'After 30 turns the history passes 12,000 tokens. The worker answers the turn as usual, then replaces the oldest turns with a summary so the next prompt is short again.',
      runsOn: 'Worker on ECS Fargate → Amazon DynamoDB → Amazon Bedrock',
      participants: [
        { id: 'worker', label: 'Worker', service: 'ECS Fargate' },
        { id: 'turns', label: 'Turns table', service: 'DynamoDB' },
        { id: 'convs', label: 'Conversations', service: 'DynamoDB' },
        { id: 'model', label: 'Lane model', service: 'Amazon Bedrock' },
      ],
      steps: [
        {
          from: 'worker',
          to: 'turns',
          label: 'Query turns after the summary',
          note: 'Each turn stores the token size of its message and its answer. Their sum is 12,400, over the 12,000 that triggers a summary and under the 16,000 cap. Above the cap the worker would drop the oldest turns until the rest fits, with no extra model call.',
        },
        {
          from: 'worker',
          to: 'worker',
          label: 'answer the turn with the full history',
          note: 'The user’s turn is not delayed by summarizing. It runs with the old summary and all 12,400 tokens, mostly read from the prompt cache.',
        },
        {
          from: 'worker',
          to: 'model',
          label: 'Converse: old summary + oldest turns, at most 500 tokens out',
          note: 'After the answer is stored, on the lane’s own model. The reservation comes from the task’s bucket, and the call is made only if the bucket then still has room for one more turn; otherwise it is skipped, so a summary uses what turns leave and never makes one wait. The oldest turns go in until about 6,000 tokens of recent turns are left out of it; a turn that prompts leave out, blocked or with no answer text, does not go into the summary either. One try with a 10-second timeout; the tokens are ours and are counted as internal, not billed to the tenant.',
          style: 'async',
        },
        {
          from: 'worker',
          to: 'convs',
          label: 'UpdateItem summary, summaryThrough=T2 IF summaryThrough=T1',
          note: 'The condition stops an old summary from replacing a newer one. If the summary was skipped, this step fails or the task dies, nothing is lost: the next turn sees 12,000 tokens or more again and tries after it.',
        },
        {
          from: 'worker',
          to: 'turns',
          label: 'next turn: Query turns after T2',
          note: 'The prompt is now the summary and about 6,000 tokens of turns. The cached prefix after the system prompt changed, so this one turn writes the cache again. That is why the summary moves in large steps and not on every turn.',
        },
      ],
    },
    {
      id: 'stop',
      title: 'Stop a generation halfway',
      kind: 'sync',
      summary:
        'Ana presses stop. The API sets a flag on the turn, the worker sees it at its next heartbeat, ends the model call and stores what was produced as stopped.',
      runsOn: 'Chat API on ECS Fargate → Amazon DynamoDB → worker → Amazon Bedrock',
      participants: [
        { id: 'client', label: 'Client', service: 'Browser or app' },
        { id: 'api', label: 'Chat API', service: 'ECS Fargate' },
        { id: 'tables', label: 'Turns and usage', service: 'DynamoDB' },
        { id: 'worker', label: 'Worker', service: 'ECS Fargate' },
        { id: 'model', label: 'Model endpoint', service: 'Amazon Bedrock' },
      ],
      steps: [
        {
          from: 'client',
          to: 'api',
          label: 'POST /conversations/c1/turns/t9/stop',
          note: 'The client hides further pieces at once; the rest is bookkeeping.',
        },
        {
          from: 'api',
          to: 'tables',
          label: 'UpdateItem stopRequested=true IF status IN (queued, generating)',
          note: 'On a final turn the condition fails and the call answers 200 with the final status: there is nothing left to stop.',
        },
        {
          from: 'worker',
          to: 'tables',
          label: 'heartbeat returns stopRequested=true',
          note: 'Within 5 seconds. A worker that claims a queued turn with the flag set stores it as stopped without calling the model.',
        },
        {
          from: 'worker',
          to: 'model',
          label: 'close the stream',
          note: 'The model call ends before its last event, so the provider’s token counts never arrive for this turn.',
        },
        {
          from: 'worker',
          to: 'tables',
          label: 'TransactWriteItems: stopped, partial answer, usageEstimated; usage ADD',
          note: 'The turn is billed for the input the worker sent, if a call was made, and for the output it received, both estimated from their size, and the row says the usage is an estimate. A stop that lands before any call, or while every try was refused, bills nothing.',
        },
      ],
    },
  ],
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
          cons: 'A connection that outlives requests, its own reconnect and resume protocol to write, and more trouble with proxies, for traffic that is almost all one way.',
        },
        {
          name: 'Server-sent events fed from a per-turn buffer',
          pros: 'Plain HTTP, event ids and Last-Event-ID built into the protocol, and any API task can serve a reconnect because the stream lives in the buffer.',
          cons: 'An in-memory store to run, one direction only, so stop is a separate request, and a comment line every 15 seconds to stay under the load balancer’s 60-second idle timeout.',
        },
      ],
      choice:
        'Server-sent events from a buffer keyed by turn id, with sequence numbers assigned by the worker as event ids. Tokens flow one way, so a WebSocket buys little. The buffer is only the live view: when it has a gap, has expired after its 10 minutes or cannot be reached, the API sends the stored answer in one event once the turn is final, so a reconnect degrades and does not fail.',
    },
    {
      question: 'Where does a generation run, and who owns the answer?',
      options: [
        {
          name: 'In the API task that holds the connection',
          pros: 'No queue and no buffer: the task calls the model and writes to the socket.',
          cons: 'A deploy or a crash of that task kills every answer it was streaming, overload has nowhere to wait except memory, and tiers cannot be kept apart.',
        },
        {
          name: 'A worker takes the turn from a queue and leases it with takeover',
          pros: 'Survives the client and the API task, and another worker can take a crashed turn over and generate again.',
          cons: 'A takeover needs a fencing token on every write, a second attempt has to erase text the user already read, and the abandoned attempt is paid for.',
        },
        {
          name: 'A worker claims the turn once; a crash is a stated failure',
          pros: 'One conditional claim, so one worker ever generates a turn and no fencing is needed. The worker holds the answer and is the only writer of the successful result.',
          cons: 'A worker that dies mid-answer fails the turn: the user sees an error after about 20 seconds and regenerates.',
        },
      ],
      choice:
        'One claim per turn, no takeover. The claim moves the turn from queued to generating with a conditional write, and the worker pushes a 20-second deadline forward every 5 seconds. If the deadline passes, any reader may write the turn as failed with the reason interrupted, on the condition that the status and the deadline are still the ones it read, and the worker’s own later write then fails and is discarded. Clocks only decide how fast a dead worker is noticed; which final state wins is decided by the table. Deploys do not trigger this: a stopping task finishes what it holds, since an answer is capped at 90 seconds counted from the claim, its final write ends at most 20 seconds later, 110 in all, and a task gets 120 to stop.',
    },
    {
      question: 'How do we make a turn idempotent, so a retry never produces two answers?',
      options: [
        {
          name: 'Let the server assign the turn id',
          pros: 'Ids are ordered and trusted.',
          cons: 'A request whose reply was lost cannot be told from a new one, so the retry is answered twice and billed twice.',
        },
        {
          name: 'A separate idempotency key table with a time to live',
          pros: 'Works for any endpoint without changing the data model.',
          cons: 'A second write next to the turn, a second thing to expire, and a window after expiry in which a late retry is new again.',
        },
        {
          name: 'The client’s turn id is the row key',
          pros: 'One conditional write decides new or repeat, for as long as the turn exists, and the repeat can be attached to the answer in progress.',
          cons: 'The key of the table is chosen by clients, so order has to come from somewhere else, and a repeat with different content must be detected.',
        },
      ],
      choice:
        'The turn id chosen by the client is the sort key under the conversation. Creating the row, claiming it and finishing it are three conditional writes on that one row, so repeated requests, repeated queue messages and a worker that comes back late all meet a condition that fails. A stored hash of the request turns a repeat with different content into a 409. Order comes from a creation time set by the server, read through a local secondary index that allows consistent reads.',
    },
    {
      question: 'How do we store conversations and build the context of each turn?',
      options: [
        {
          name: 'Send the whole history every turn',
          pros: 'Exact: the model sees everything that was said.',
          cons: 'Every turn costs more than the one before, and a long conversation ends by overflowing the model’s context window.',
        },
        {
          name: 'Keep only the last few turns',
          pros: 'A fixed, small prompt and no extra model calls.',
          cons: 'The assistant forgets the start of the conversation without a trace.',
        },
        {
          name: 'A rolling summary plus the recent turns, under a token budget',
          pros: 'A bounded prompt that still carries the gist of old turns, and a prefix that stays stable between summaries, which the prompt cache needs.',
          cons: 'A summary call to pay for, details that the summary drops, and one cache write each time the summary moves.',
        },
      ],
      choice:
        'One row per turn, holding the message and its answer, and a summary on the conversation row. The worker reads the turns after the summary with one consistent query and follows parent links to leave out regenerated answers. From prompts and from summaries it also leaves out a turn that ended as blocked and a turn that failed or was stopped with no answer text from the model, so a message that did not pass the input check never comes back as history. History is capped at 16,000 tokens for cost, well under the models’ context windows. When it passes 12,000, the worker summarizes the oldest turns after the answer is stored, in one step that leaves about 6,000 tokens of recent turns, and writes the summary with a condition on its previous position. The summary call runs on the lane’s own model from the task’s bucket, and only when the bucket has room for it and for one more turn, so it never makes a turn wait. Building the context never calls a model: if no summary could be written, the oldest turns are dropped until the rest fits.',
    },
    {
      question: 'How do we limit usage per tenant when the cost is in tokens?',
      options: [
        {
          name: 'Requests per minute only',
          pros: 'Easy to explain and to check with one counter.',
          cons: 'Ignores that one long prompt can cost as much as hundreds of short ones.',
        },
        {
          name: 'Count tokens after the answer',
          pros: 'Exact, because the real numbers are known.',
          cons: 'Lets a burst of long requests through before any of them is counted.',
        },
        {
          name: 'Estimate tokens at the door, settle afterwards',
          pros: 'Blocks a burst before it reaches the model and still ends each minute close to real usage.',
          cons: 'The estimate is wrong for any single request, and the correction is a second write that can be lost.',
        },
      ],
      choice:
        'One counter row per tenant and minute in the table the turns already depend on, charged with an estimate by a conditional update and corrected after the turn, while that minute is still running, by the difference to the real count. No extra store sits in the accept path, and a lost correction or a double charge from a racing repeat disappears when the minute’s row expires. The accepted costs: a fixed minute allows up to two limits around a boundary, the limit is per tenant and not per user, and one tenant’s row takes at most the write rate of one partition.',
    },
    {
      question: 'How do we share a scarce model quota between tiers?',
      options: [
        {
          name: 'One queue and one quota for everyone',
          pros: 'Simple, and no capacity is ever idle.',
          cons: 'A free surge delays paid turns, and in overload the queue serves the users who waited longest and have most likely left.',
        },
        {
          name: 'One queue with priorities inside the worker',
          pros: 'Paid turns go first while the quota is shared.',
          cons: 'A plain queue has no priorities, so workers would hold messages to reorder them, and a shared quota still lets free calls trigger the throttling that hits paid ones.',
        },
        {
          name: 'A lane per tier: queue, pool, model and quota',
          pros: 'Nothing is shared that a surge could take, and each lane’s budget is enforced by a bucket inside each task with no shared limiter.',
          cons: 'Idle paid capacity cannot serve free turns, and shares per task waste a little: one task can refuse or wait while another has room, and a task that is down takes its share with it until it is replaced.',
        },
      ],
      choice:
        'A lane per tier, with both worker pools fixed in size. The paid lane has the larger model and a quota sized at 1.67 times its peak; the free lane has the smaller model and a quota it nearly fills at peak, so free is refused first. Each worker task takes the input plus the maximum output, which is at least what the provider reserves since the worker cannot know the cache hit in advance, from a local bucket before a call and settles the bucket to the real count after it, which with the output rate can be more than the reservation. The bucket holds one second of the task’s share, as the door’s does. Each of the 12 API tasks admits new turns of a lane from a local bucket, a twelfth of 96% of what the lane carries: 144 paid and 216 free turns a second in all, the rest answered 429, and a repeat of an existing turn never refused. With every worker task running, that is slightly less than the lane drains, so the queue holds at most the one second of turns the buckets can release at once, once the reservations in flight have settled: for a minute or two after a jump from a low rate the worker buckets still hold the larger reservations of the calls in progress, and the wait can reach a few seconds. While one worker task is being replaced the lane carries 14 of 15 of the paid budget or 23 of 24 of the free one, 140 and 215.6 turns a second, which is slightly under the door’s rate. If the lane drains more slowly than the door admits, for that reason or because the provider is slow, the queue grows, and a turn that still waits 15 seconds fails as busy.',
    },
    {
      question: 'What happens when the model endpoint throttles or fails?',
      options: [
        {
          name: 'Return the error to the user',
          pros: 'Nothing to build, and no extra load on a struggling provider.',
          cons: 'Every blip of the provider becomes a failed turn, including the ones a second try would have served.',
        },
        {
          name: 'Put the turn back on the queue until it works',
          pros: 'Nothing fails while the provider recovers.',
          cons: 'An interactive user does not wait minutes, the backlog hides the outage until it is huge, and the turns served afterwards are the stale ones.',
        },
        {
          name: 'Bounded retries inside the token budget, then one fallback, then fail',
          pros: 'Absorbs short throttling, gives paid users an answer from a second model, and says "capacity" within seconds otherwise.',
          cons: 'A fallback answer is weaker and writes a cold prompt cache, and it borrows quota the free lane was counting on.',
        },
      ],
      choice:
        'Before any answer text is shown, each model call of a turn, the call after a document search included, gets up to three tries on the lane’s model, 0.5 and 1 second apart, each taking its tokens from the task’s bucket again; then one try on the fallback model for paid turns; then the turn is failed with the reason capacity. After answer text was shown: no retry, and a broken stream is stored as failed with the text so far marked incomplete. While calls fail, tasks hold their slots longer and receive less, so turns wait in the queue. The door does not see that, and the deadline is the bound: a turn not claimed within 15 seconds fails as busy, and clearing its stale message costs a worker one conditional write and no model call. The model is called through an inference profile that spreads requests over several Regions, which adds capacity without any routing of our own.',
    },
    {
      question: 'How do we keep the cost of a turn down with prompt caching?',
      options: [
        {
          name: 'No caching: send the full prompt at the full price',
          pros: 'Nothing to design, and the prompt can change freely.',
          cons: 'The system prompt, the tool definitions and the whole history are processed again on every turn, and all of it counts against the quota.',
        },
        {
          name: 'Cache answers to repeated questions on our side',
          pros: 'A hit costs no model call at all.',
          cons: 'Chat messages rarely repeat word for word, the answer depends on the conversation before it, and an answer served to the wrong tenant is a leak.',
        },
        {
          name: 'The provider’s prompt cache with a stable prefix',
          pros: 'Input read from the cache is billed at a lower rate and does not count against the tokens-per-minute quota.',
          cons: 'It only works if the prefix is byte for byte the same, it expires minutes after its last use, writing it can cost more than plain input, and a hit is not guaranteed.',
        },
      ],
      choice:
        'The provider’s prompt cache, with the prompt ordered from most to least stable: tool definitions and system prompt, a checkpoint, the summary and the earlier turns, a checkpoint, then the new message. A user who answers within the cache’s lifetime reads everything up to the previous call’s checkpoint from the cache, and the previous turn’s message and answer are written to it on this call; in the estimates the part read is 2,000 of the 4,000 input tokens of an average turn, which cuts the quota a turn uses from 6,000 tokens to 4,000. The summary moves in large steps because every move rewrites the second segment. Cache reads and writes are reported separately in the usage of each call and kept separately in the usage row, since they are priced differently.',
    },
    {
      question: 'How do we moderate what goes in and what comes out?',
      options: [
        {
          name: 'Trust the model to refuse',
          pros: 'No extra latency or cost.',
          cons: 'Refusals are inconsistent, cannot be configured per tenant and leave no record of what was blocked.',
        },
        {
          name: 'Our own classifier service before and after the model',
          pros: 'Full control over categories and thresholds.',
          cons: 'A service to build, scale and keep up, a fallback path for when it is down, and an answer checked only at the end is shown before it is checked.',
        },
        {
          name: 'A managed guardrail attached to the model call',
          pros: 'Input and output are checked in the same call, per tenant configuration, with no path that skips it.',
          cons: 'Scanning each chunk before release delays the stream, and its availability is now part of the model call’s.',
        },
      ],
      choice:
        'A guardrail attached to every model call, in the mode that scans each chunk before releasing it, with every policy set to block. Only the new user message is marked for the input check, so the history, which passed the check when it was new, is not paid for again: a turn that ended as blocked, or that failed or was stopped with no answer text from the model, is left out of later prompts and of summaries, so the history holds only messages that passed. An intervention ends the call with its own stop reason and the configured notice, and the turn is stored as blocked with the notice as its answer; the done event makes the client replace any chunks it had already shown. Masking personal data is left out on purpose: a masked answer ends with the same stop reason as a blocked one, and telling them apart needs the guardrail trace, which carries the original values. So block is the only action and the trace stays off. There is no degraded mode without the guardrail: if it fails, the call fails and takes the retry path. Its known gap is stated: tool results are not scanned, so retrieved passages are as trustworthy as the tenant’s own documents.',
    },
    {
      question: 'How do we meter usage so that billing is accurate?',
      options: [
        {
          name: 'Emit a usage event after saving the answer',
          pros: 'Billing is decoupled from the chat path.',
          cons: 'Two steps: a crash between them stores an answer that is never billed, and a redelivered event bills it twice unless the consumer deduplicates.',
        },
        {
          name: 'Count tokens ourselves from the text',
          pros: 'Works even when the model call ends without its final event.',
          cons: 'Our count and the provider’s differ, cached tokens cannot be told apart, and we would bill numbers we are not charged.',
        },
        {
          name: 'Write the provider’s counts in the same transaction as the answer',
          pros: 'A turn is stored and billed together or not at all, and the condition on the turn’s status makes it happen at most once.',
          cons: 'Transactional writes cost double, and a counter row shared by many concurrent turns would make transactions cancel each other.',
        },
      ],
      choice:
        'The worker sums the usage that the provider reports for every model call of the turn and writes it in the transaction that stores the answer, conditional on the turn still being in generating, adding to a usage row per tenant, month, user and model, or to two such rows when a fallback served one of the turn’s calls. A row per user keeps concurrent transactions apart; a tenant’s bill is one query over its month. What is not billed is stated: a failed turn bills nothing even though the provider charged us, a stopped turn is billed from an estimate and marked so, and summaries are ours. A daily comparison of the provider’s token metrics against what we accounted for shows whether that unbilled share stays small.',
    },
  ],
  wrapUp:
    'Take the turn id from the client and make creating, claiming and finishing the turn three conditional writes on one row. Charge an estimate to a token window per tenant and settle it afterwards. Let one worker own the answer, stream it through a buffer that any API task can resume from, and store answer and usage in one transaction. Give each tier its own queue, pool, model and quota, admit each lane at the door at a rate just under what its quota carries, and answer a throttling provider with bounded retries and one fallback.',
  guarantees: {
    provides: [
      {
        property: 'One answer per turn',
        promise:
          'Queue messages reach workers at least once and requests can repeat, made harmless by the turn id: the row is created, claimed and finished by conditional writes, so one worker generates a turn and one final state is stored. A repeated request attaches to the existing turn and a repeat with different content gets 409.',
      },
      {
        property: 'Completion',
        promise:
          'Every accepted turn ends as done, stopped, blocked or failed with a reason. A turn that no worker claims within 15 seconds fails as busy, and a turn whose worker stops renewing its 20-second deadline fails as interrupted. An answer cut at the 2,048-token cap, or ended by a fourth search request, ends as done with the incomplete flag set, and one cut at 90 seconds ends as stopped with the reason time limit, so none of them is shown as complete. The failure is written by the next reader of the turn, conditionally, so a turn nobody reads again stays unwritten and is treated as failed by whoever reads it first.',
      },
      {
        property: 'Stored answers',
        promise:
          'A turn reported as done has its full answer in the turns table, which acknowledges a write once it is durable and keeps its data in several Availability Zones. The answer is written from the worker’s memory, not from the buffer, so losing the buffer cannot shorten it.',
      },
      {
        property: 'Resume',
        promise:
          'Within 10 minutes of the first piece, a reconnect with the last sequence number continues with the next piece, with none repeated or skipped. If the buffer cannot give that, the client gets the stored answer in one event when the turn is final.',
      },
      {
        property: 'Billing',
        promise:
          'Usage is added in the same transaction that stores the final state, conditional on the turn being in generating, so a turn is billed at most once and never without a stored result. Done and blocked turns carry the provider’s counts; stopped turns carry an estimate and say so.',
      },
      {
        property: 'Tier isolation',
        promise:
          'Paid and free turns share no queue, no worker pool, no model and no quota, so free traffic of any size cannot take queue position, worker slots or model tokens from paid turns. The exceptions are stated: a paid turn that falls back uses the free lane’s model, both lanes call the same guardrail service, whose quotas are per account, and both lanes draw on the account’s one tokens-per-day quota, which spans all models, so a free surge can spend daily tokens that paid turns need.',
      },
      {
        property: 'Tenant limit',
        promise:
          'A tenant’s accepted turns stay within its tokens-per-minute limit as estimated at the door, checked by a conditional write, with at most two limits spent around a minute boundary.',
      },
    ],
    assumes: [
      'Clients generate a new random turn id per message and reuse it on every retry of that message.',
      'The model endpoint reports token usage in the last event of a call that ends normally.',
      'Worker and API clocks agree within about a second. A larger skew can fail a healthy turn early; it cannot produce two answers.',
      'A stopping worker task is given 120 seconds, and an answer is capped at 90 seconds counted from the claim with at most 20 more for its final write, 110 in all, so deploys do not interrupt turns.',
      'The table acknowledges a write only once it is durable, and the queue stores a message redundantly before it acknowledges the send.',
      'The signed token on each request names the user and the tenant truthfully; the identity provider is outside this design.',
      'The Chat API runs its 12 tasks and the load balancer spreads new requests evenly over them. Each task admits a twelfth of the door’s rate, so with fewer tasks the door admits less, and with an uneven spread one task refuses while another has room.',
      'The load balancer forwards a streamed response as the task writes it. Its documentation states the idle timeout and not this, so it is an assumption to test.',
    ],
    doesNotGuarantee: [
      'That a turn survives its worker. A crash mid-answer fails the turn as interrupted; nothing generates it again on its own.',
      'A retry once answer text was shown. A model stream that breaks is stored as failed with the partial text marked incomplete.',
      'Token-by-token display when the buffer fails. It replicates asynchronously, so a failover can lose the last pieces, and the client then gets the stored answer at the end.',
      'A stop that is instant. The worker sees the flag within 5 seconds, and the tokens produced until then are billed; if the model finishes before the worker sees the flag, the turn is stored as done with its full answer, although the client stopped showing it.',
      'Exact billing for stopped turns, or any billing for failed ones. The provider’s charge for a failed or interrupted call is absorbed and tracked as drift.',
      'A hard token limit per tenant. The check uses an estimate, the settlement can be lost, and a fixed minute allows a burst across its boundary.',
      'A monthly spend cap. Usage per user and month is exact, and nothing in the request path compares a tenant’s total with a budget.',
      'That retrieved passages were screened. The guardrail checks the user’s message and the model’s answer, not tool results.',
      'Fairness between tenants inside a lane. Tenants of one tier share its queue in arrival order, each bounded only by its own token limit.',
      'A prompt cache hit. The estimates assume half of the input is read from the cache; a cold cache costs more quota and money, never correctness.',
      'A short wait when a lane drains more slowly than planned. The door admits turns at a fixed rate and does not look at the queue, so with a worker task out, a slow provider, a cold cache or, for a minute or two after a jump from a low rate, reservations not yet settled, accepted turns can wait longer, up to 15 seconds, and then fail as busy.',
      'Full admission with a zone or a task missing. Each API task carries a twelfth of the door and each worker task a share of its lane’s budget, and nothing hands a missing share to the others. With one zone gone the door admits 96 paid and 144 free turns a second until the tasks are replaced: at peak, paid requests are refused often enough to pass their alarm, and about three in ten free requests are refused.',
      'That no part of a blocked answer was seen. Each chunk is scanned before it is released, and chunks released before a later one is blocked were on the screen until the done event replaced them with the notice.',
      'A clean delete during an accept. A turn accepted in the instant its conversation is deleted can be written after the delete has passed it: it is generated and billed, and no list shows it.',
    ],
  },
  failures: [
    {
      scenario: 'A worker task dies while it is streaming 100 answers.',
      impact:
        'Those answers stop. Each client keeps the text it has. The turns stay in generating until their deadline, at most 20 seconds after the last heartbeat, and then fail as interrupted; the users see an error and can regenerate. Nothing is billed for them, although the provider charges for the tokens already produced.',
      detection:
        'The API task relaying each stream reads the turn row when the buffer has been silent for 5 seconds, and writes the failure when the deadline has passed. Workers cannot report their own death, so the API task counts the failure it wrote, and the alarm on paid turns not finishing compares those counts with the turns accepted.',
      recovery:
        'The service replaces the task. The queue messages of those turns were deleted at the claim, so nothing is redelivered and nothing generates twice. The failed turns keep their partial text only on the clients; the stored rows hold the status and the reason.',
    },
    {
      scenario:
        'The API task crashes after writing the turn row and before sending the queue message.',
      impact:
        'A queued turn exists that no worker will receive. The client never saw the accepted event.',
      detection:
        'By the client, as a request that did not answer. Turns that end as busy without a refusal at the door are counted, and more than a handful means this or a worker pool that is too small.',
      recovery:
        'The client repeats the request with the same turn id. The API finds the row before it applies the door or the token window, so the repeat cannot be refused as busy or over the limit. The row is queued, so the API sends the message, and the turn proceeds if it is still inside its 15 seconds; otherwise it fails as busy and the user sends again. Without a repeat, the row is written as failed by its next reader. The window charge expires with its minute.',
    },
    {
      scenario: 'The provider throttles the paid model for ten minutes.',
      impact:
        'Paid first tokens arrive later, by 1.5 seconds for turns that needed all three tries, and those turns are answered by the fallback model. If the fallback is throttled too, turns fail with the reason capacity within seconds.',
      detection:
        'Model throttling when the cause is the account’s quota (429): the provider’s own count of throttled invocations for the model, against its count of accepted ones. Model errors when the provider is short of capacity (503 or 529), which are server-side errors and not throttles. The paid first-token alarm follows if the delay is large.',
      recovery:
        'Nothing to undo. Retries are bounded per turn and paid for from the task’s bucket, so load on the provider does not grow. If the lane slows down enough for turns to wait, the alarm on the paid queue fires at 1 second, and a turn not claimed within 15 seconds fails as busy; the door keeps admitting at its rate, because it does not look at the queue. A lasting 429 is a quota that is too small, raised with the provider; a larger quota does nothing for 503 and 529.',
    },
    {
      scenario: 'A model stream breaks after half the answer was shown.',
      impact:
        'The user has half an answer. The worker stores the turn as failed with the reason model error and the text so far marked incomplete, and the done event tells the client to show it as incomplete. No usage is billed, because the call ended without its token counts.',
      detection:
        'Turns by final status and reason, published by the workers, and the provider’s server error count.',
      recovery:
        'The user regenerates, which is a new turn under the same parent. The incomplete answer stays stored beside the new one and is left out of later prompts, because the next turn’s parent chain goes through the new answer.',
    },
    {
      scenario: 'A buffer shard fails over to its replica, or the whole buffer is unreachable.',
      impact:
        'Replication is asynchronous, so the newest pieces of some streams are gone, and during an outage no pieces can be read. Answers keep being generated and stored. Affected clients stop seeing tokens and receive the whole answer in one event when it is final.',
      detection:
        'The share of streams the API serves from the stored answer, and the failover event. Workers count buffer writes they skipped.',
      recovery:
        'Workers skip buffer writes that fail or take more than 50 milliseconds and continue. An API task that sees a gap in the sequence, or cannot read, polls the turn row every 2 seconds and sends the stored answer. New turns use the buffer again as soon as it answers.',
    },
    {
      scenario: 'The turns table throttles or is unavailable for a minute.',
      impact:
        'New turns cannot be accepted and answer 503. Workers cannot claim, so queued turns wait and those older than 15 seconds fail as busy. A worker that finished an answer cannot store it; it retries until the turn’s deadline, and if the table is still away the answer is lost and the turn fails as interrupted.',
      detection:
        'The accept error ratio on the load balancer, and the table’s throttle and system error metrics.',
      recovery:
        'When the table answers, accepts and claims resume. Heartbeats that could not be written for more than 20 seconds have let deadlines pass, so answers generated during the outage may be discarded. Users regenerate. Nothing is stored twice, because every write is still conditional.',
    },
    {
      scenario:
        'The reply to the final transaction is lost, or two transactions touch the same usage row.',
      impact:
        'The worker does not know whether the answer and the usage were stored. Or the transaction is cancelled because the same user finished two turns at the same moment.',
      detection:
        'Transaction retries and conflicts counted by the workers, and the table’s transaction conflict metric.',
      recovery:
        'The worker sends the same transaction again with the same request token, which the table treats as the same request for 10 minutes, so a stored result is not applied twice. A cancelled transaction is retried after a short random wait. The worker stops pushing the deadline once the model has stopped, so these retries end at the turn’s deadline, at most 20 seconds later: if nothing was stored by then, the answer is lost and the turn fails as interrupted, like any turn whose worker died. If the condition on the status fails, the turn was already failed or deleted, and the worker discards the answer.',
    },
    {
      scenario: 'Free traffic quadruples for an hour.',
      impact:
        'Each API task admits its share of 216 free turns a second and refuses the rest, about three in four free requests, with 429 and the reason busy. Free turns that are accepted wait at most about a second for a worker once the reservations in flight have settled; if the surge starts from a low rate, the wait can reach a few seconds for the first minute or two. Paid turns do not notice.',
      detection:
        'The count of refused free turns. The age of the oldest message on the free queue stays near a second while the lane drains as planned, or a few seconds for a minute or two after a jump from a low rate, and passes 5 if the lane does not drain as planned.',
      recovery:
        'Nothing to repair: the door refuses for as long as the surge lasts and stops by itself. More free workers would not help, because the model quota and not the pool limits the lane. Raising the free quota is a decision about cost.',
    },
    {
      scenario: 'The knowledge base is slow or failing.',
      impact:
        'Turns that ask for a search wait 3 seconds for it and then go on without documents: the model is told the search failed and answers from what it knows, saying so. Turns that do not search are unaffected.',
      detection: 'Search errors and timeouts counted by the workers, as a share of searches.',
      recovery:
        'None needed per turn. A search is tried once, and a turn makes at most three, so a broken knowledge base adds at most 9 seconds to a turn and never fails it.',
    },
  ],
  capacity: {
    assumptions: [
      '1 million daily users and about 8.6 turns each. Peak is three times the average. 30% of turns are paid and 70% free.',
      'An average turn sends 4,000 input tokens (system prompt and tool definitions, summary, recent turns, the new message) and gets 400 output tokens. Half of the input, 2,000 tokens, is read from the prompt cache.',
      'The first token takes about 1 second and output arrives at about 50 tokens a second. An answer is capped at 2,048 tokens and 90 seconds.',
      'The provider counts a turn against the tokens-per-minute quota as input not read from the cache plus output times a model-specific rate; the estimates use a rate of 5, and a model with a rate of 10 would make the same turn cost 6,000 and carry a third fewer turns. The quotas, 36 million tokens a minute for the paid model and 54 million for the free one, are agreed with the provider ahead of time and are far above what a new account gets. The agreement has to cover the account’s tokens-per-day quota as well, which both models draw on: 8.64M turns a day × 4,000 = about 34.6 billion tokens a day, counted as the per-minute quota counts them and before summaries.',
      'One turn in five makes one document search, which adds a second model call; its tokens are inside the averages.',
      'A summary call sends about 6,400 input tokens and gets up to 500, which is 6,400 + 500 × 5 = 8,900 against the quota. One turn in 50 is assumed to trigger one: 178 tokens per turn on average, about 4% on top of the 4,000. Summaries are left out of the lane figures because they only take what turns leave in a task’s bucket.',
      'A worker task holds up to 100 answers at once, since it mostly waits on the network. Pieces go to the buffer every 100 milliseconds. A Chat API task relays up to about 500 open streams.',
      'A turn row with its message and answer is about 4 KB. The largest tenant sends 20% of the peak.',
    ],
    estimates: [
      {
        label: 'Turns',
        value: '~8.6M a day, 100 per second on average, 300 at peak',
        math: '1M users × 8.64 turns = 8.64M/day ÷ 86,400 s = 100/s. Peak 3 × 100 = 300/s: 90 paid and 210 free.',
      },
      {
        label: 'Answers streaming at once',
        value: '~2,700 at peak',
        math: 'A turn lasts 1 s to the first token + 400 tokens ÷ 50/s = 9 s. 300/s × 9 s = 2,700: 810 paid and 1,890 free.',
      },
      {
        label: 'Tokens per turn',
        value: '4,400 billed, 4,000 against the quota',
        math: 'Billed: 4,000 in + 400 out. Quota: (4,000 − 2,000 from cache) + 400 × 5 = 4,000. With a cold cache it would be 4,000 + 2,000 = 6,000.',
      },
      {
        label: 'Quota used at peak',
        value: 'Paid 21.6M of 36M tokens a minute (60%), free 50.4M of 54M (93%)',
        math: 'Paid: 90/s × 4,000 × 60 = 21.6M. Free: 210/s × 4,000 × 60 = 50.4M. Summaries add up to 90 ÷ 50 × 8,900 × 60 = 0.96M and 210 ÷ 50 × 8,900 × 60 = 2.24M when the buckets have room, which would be 63% and 97%.',
      },
      {
        label: 'What a lane carries',
        value: 'Paid 150 turns a second, free 225; the door admits 144 and 216',
        math: '36M ÷ 60 ÷ 4,000 = 150/s. 54M ÷ 60 ÷ 4,000 = 225/s. The door admits 96% of that: 144/s and 216/s, which is 12 and 18 per API task, each bucket holding one second. The most the door can put in a queue above what the lane drains is what the buckets hold: 216 free turns ÷ 225/s = 0.96 s of wait, and 144 ÷ 150 = 0.96 s paid. That holds with every worker task running and the reservations in flight settled. A worker task takes the input plus 2,048 from its bucket before a call, at least what the provider reserves since the worker cannot know the cache hit in advance, about 6,048 tokens for an average turn, and settles to the real 4,000 only when the call ends about 9 seconds later, so for a minute or two after a jump from a low rate the lane starts fewer turns than the door admits and the wait can reach a few seconds, about 1.6 s from 100 free turns a second; the 15-second deadline is still the bound. With one task out, the paid lane carries 14 × 2.4M = 33.6M tokens a minute ÷ 60 ÷ 4,000 = 140 turns/s against the door’s 144, and the free lane 23 × 2.25M = 51.75M ÷ 60 ÷ 4,000 = 215.6/s against 216. The ordinary peaks, 90 and 210, are under both, so the queue grows then only while requests arrive faster than 140 or 215.6 a second, by at most 4 and 0.4 turns a second.',
      },
      {
        label: 'Task pools',
        value: 'Paid workers 15, free workers 24, Chat API 12, all fixed',
        math: 'Worker slots at full budget: 150/s × 9 s = 1,350 → 14 tasks × 100; 225/s × 9 s = 2,025 → 21 tasks. Each pool gets one more task, a spare for slots and not for budget, and is rounded up to a multiple of three, to sit evenly in three Availability Zones: 15 and 24. Bucket per task: 36M ÷ 15 = 2.4M tokens a minute, 54M ÷ 24 = 2.25M, so a task that is out takes that share of the lane’s budget with it. Chat API: 2,700 open streams ÷ 12 = 225 per task, and 2,700 ÷ 8 = 338 with the four tasks of one zone gone, under the 500 a task relays. The pools are fixed because a task’s bucket is a share of its lane. With one zone gone, until its tasks are replaced, the door is 8 × 12 = 96 paid and 8 × 18 = 144 free turns a second, and the lanes carry 10 × 2.4M = 24M = 100/s and 16 × 2.25M = 36M = 150/s: 96 is 1.07 times the paid peak of 90, and a simulation of random arrivals then refuses about 2% of paid requests, past the Paid turns refused alarm, while (210 − 144) ÷ 210 = 31% of free requests are refused at the free peak.',
      },
      {
        label: 'A four-fold free surge',
        value: 'One lane: 60% of turns expire. Two lanes: 74% of free refused, paid untouched',
        math: '840 free + 90 paid = 930/s against 90M ÷ 60 ÷ 4,000 = 375/s: the queue grows 555/s and 555 ÷ 930 = 60% time out. With lanes, the free door admits 216 of 840: 624 ÷ 840 = 74% refused at once, and the accepted turns wait under a second with every worker task running; this scenario starts from the peak, so the reservations in flight are already settled.',
      },
      {
        label: 'Token buffer',
        value: '~27K appends a second, ~1.8 GB',
        math: '2,700 streams × 10 pieces/s = 27,000/s. Turns kept 10 min: 300/s × 600 s = 180,000 × about 10 KB with per-piece overhead = 1.8 GB.',
      },
      {
        label: 'Table throughput at peak',
        value: '~6,500 write units and ~4,500 read units a second',
        math: 'Writes per turn: row and index entry 3 + window 1 + claim 2 + 1.8 heartbeats × 2 = 3.6 + final transaction 2 × (4 + 1) = 10 + settle 1 + conversation 1 = 21.6 × 300 = 6,480. Reads: API 3 + worker 12 (the conversation row, the index and ten 4 KB turns, consistent) = 15 × 300 = 4,500.',
      },
      {
        label: 'Storage',
        value: '~35 GB a day, ~12.6 TB a year',
        math: '8.64M turns × 4 KB = 34.6 GB/day × 365 = 12.6 TB.',
      },
      {
        label: 'Hottest window row',
        value: '~120 writes a second',
        math: 'The largest tenant: 20% × 300 = 60 turns/s, each one charge and one settlement = 120/s, against 1,000 write units a second for one partition.',
      },
    ],
    implications: [
      'The model quota is the capacity of the system. Workers, tables and the buffer are sized from it, and adding any of them does not add a single turn.',
      'The free lane runs at 93% of its quota at peak, which is 97% of what its door admits, so it refuses in the busiest seconds of an ordinary day; the paid quota is 1.67 times the paid peak and the paid door 1.6 times. That difference is the product decision, expressed as two numbers.',
      'The prompt cache is worth a third of the quota: 4,000 against 6,000 tokens per turn. A change that breaks the stable prefix, such as a timestamp in the system prompt, would cost that third at once.',
      'Setting the maximum output to 2,048 keeps the provider’s up-front reservation near what a turn really uses. A large maximum would reserve quota that is never used and throttle the lane early. The reservation is not a ceiling: output counts five times, so an answer longer than about 410 tokens costs more than the 2,048 reserved for it, up to 10,240, and the task’s bucket is settled to that real count after the call.',
      'With 2,700 answers in flight, per-answer costs matter: one heartbeat every 5 seconds is 540 writes a second, a sixth of all write units, and pieces every 100 milliseconds are 27,000 buffer writes a second.',
      'Usage is written per user because a tenant-wide counter would be touched by 60 transactions a second for the largest tenant, and concurrent transactions on one item cancel each other.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one Region across three Availability Zones, with the models reached through Amazon Bedrock. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Client connection and Chat API',
        service:
          'An Application Load Balancer that serves only this API, with AWS WAF attached, in front of an Amazon ECS service on AWS Fargate with a fixed 12 tasks',
        why: 'The load balancer keeps a connection as long as data flows within its idle timeout, 60 seconds by default, which the comment line every 15 seconds satisfies. Any task can accept a turn or resume a stream; the only state a task holds is the door, a local bucket of turns per lane. That is why the pool is fixed at 12 and the service’s maximum percent is 100: a deploy stops a task before it starts the replacement, so the door can shrink for a moment and never grows. The minimum healthy percent is 90, which for 12 tasks is 11, so a deploy replaces one task at a time: the door is then 11 × 12 = 132 paid and 11 × 18 = 198 free turns a second, still 1.47 times the paid peak of 90, and at the free peak of 210 about 6% of free requests are refused while it lasts. On a stop signal a task stops taking requests and its open streams reconnect elsewhere.',
        watch:
          'ALB TargetResponseTime, RequestCount, HTTPCode_Target_5XX_Count, HTTPCode_ELB_5XX_Count and ActiveConnectionCount; ECS CPUUtilization and MemoryUtilization. Custom: turns accepted, turns refused and turns written as failed by an API task, each by lane and reason.',
      },
      {
        part: 'Turn queues',
        service:
          'Two Amazon SQS standard queues, paid and free, each with a 5 s visibility timeout and 5 minutes of retention, and no dead-letter queue',
        why: 'A wake-up for a queued turn, stored redundantly, with no servers to run. The message carries only keys and is deleted right after the claim, so the row is the record and a message that cannot be processed is worthless once the turn’s 15 seconds are over. That is why retention is short and nothing is moved to a dead-letter queue. Standard queues deliver at least once, which the claim absorbs.',
        watch:
          'On each queue: ApproximateAgeOfOldestMessage, ApproximateNumberOfMessagesVisible, and NumberOfMessagesSent against NumberOfMessagesDeleted.',
      },
      {
        part: 'Workers',
        service:
          'Two Amazon ECS services on AWS Fargate with a 120 s stop timeout, both of fixed size: 15 tasks in the paid pool and 24 in the free pool',
        why: 'A pool per lane keeps the tiers apart. Each task carries its own token bucket, the lane’s quota divided by the pool’s size, so there is no shared limiter and the pool does not scale: fewer tasks would carry less than the lane’s budget. Both services deploy with a maximum percent of 100 and a minimum healthy percent that takes one task out at a time: 90 for the 15 paid tasks, which keeps 14, and 95 for the 24 free ones, which keeps 23. The maximum also counts a task that is stopping, so a replacement cannot start until the old task has fully stopped, which can take up to the 120-second stop timeout. While one task is out, in a deploy or after a crash, from the moment it stops receiving until its replacement runs, the lane carries 14 of 15 or 23 of 24 of its budget: 140 paid turns a second against a door of 144, and 215.6 free against 216. The door is then slightly above the lane, so a deploy during a surge shows as queue age and not as refusals. The SDK’s own retries are turned off for model calls, because the worker counts and pays for each try itself. On a stop signal a task stops receiving and finishes the answers it holds.',
        watch:
          'ECS CPUUtilization and MemoryUtilization. Custom, per lane: time to first token, wait in queue, turns by final status and reason, tries per turn, turns answered by the fallback, buffer writes skipped, tokens billed and internal tokens.',
      },
      {
        part: 'Token buffer',
        service:
          'Amazon ElastiCache for Valkey, cluster mode with three shards, each a primary and a replica in different Availability Zones',
        why: 'A stream per turn with blocking reads is what a relay needs: append on one side, wait for the next piece on the other, and read again from any sequence number. Keys expire on their own after 10 minutes. Losing pieces in a failover is acceptable because the answer is stored from the worker’s memory.',
        watch:
          'Per node: EngineCPUUtilization (CPUUtilization on nodes with 2 vCPUs or fewer), DatabaseMemoryUsagePercentage, Evictions, CurrConnections, ReplicationLag on replicas, StreamBasedCmds and SuccessfulWriteRequestLatency.',
      },
      {
        part: 'Turns table and conversations',
        service:
          'Amazon DynamoDB, on-demand. Turns: partition key conversation id, sort key turn id, and a local secondary index on creation time. Conversations: partition key user id, sort key conversation id',
        why: 'Every state change of a turn is one conditional write on one item, and the final one is a transaction with the usage row. The local index gives the turns of a conversation in order with a consistent read; it projects keys only, so later updates of a turn do not write it, and the query fetches the rest of each turn from the table. The table is pre-warmed above its peak write rate. Keying conversations by user makes the ownership check a single read.',
        watch:
          'WriteThrottleEvents, TransactionConflict and ConsumedWriteCapacityUnits against the table quota; and per Operation (PutItem, UpdateItem, Query, TransactWriteItems), because they are published only with that dimension: ThrottledRequests, SystemErrors and SuccessfulRequestLatency.',
      },
      {
        part: 'Limits table and usage',
        service:
          'Amazon DynamoDB, on-demand. Limits: partition key tenant, one row for its settings and one per minute with a time to live. Usage: partition key tenant and month, sort key user and model',
        why: 'The token window is a conditional counter in the store the accept path already needs, so limiting adds no dependency. Usage rows are written only inside the final transaction of a turn, which is what makes them exact.',
        watch:
          'ThrottledRequests on both tables, per Operation (UpdateItem, TransactWriteItems), and the count of 429 answers for token limits by tenant.',
      },
      {
        part: 'Model endpoint and fallback model',
        service:
          'Amazon Bedrock, ConverseStream on two models, each through a geographic cross-Region inference profile, with prompt cache checkpoints',
        why: 'A managed endpoint with a quota in tokens a minute per model, one streaming API for both models, token counts in the last event of every call, and a profile that routes each request to a Region of the geography with capacity. The paid lane’s fallback is the free lane’s model.',
        watch:
          'Per model: Invocations, InvocationThrottles, InvocationServerErrors, InvocationClientErrors, TimeToFirstToken, InvocationLatency, InputTokenCount, OutputTokenCount, CacheReadInputTokenCount and CacheWriteInputTokenCount.',
      },
      {
        part: 'Guardrail',
        service:
          'Amazon Bedrock Guardrails, attached to each ConverseStream call in synchronous mode with the trace disabled',
        why: 'Checks the marked user message and the streamed answer inside the model call, with a version per tenant whose policies all block. No separate call from our side and no answer that bypasses it. With block as the only action, the stop reason alone says that a turn was blocked, so the trace, which can carry the matched text, is never requested.',
        watch:
          'Custom: turns ended as blocked, by tenant. In the namespace AWS/Bedrock/Guardrails: InvocationsIntervened by GuardrailContentSource (input or output), InvocationThrottles and InvocationServerErrors. The documentation describes these for the ApplyGuardrail operation, so the custom count is the one this design relies on.',
      },
      {
        part: 'Knowledge base',
        service:
          'Amazon Bedrock Knowledge Bases, queried with Retrieve and a metadata filter on the tenant',
        why: 'Returns passages with their source and a score for a text query. The filter is set by the worker from the turn’s tenant, so one tenant’s documents cannot be retrieved for another.',
        watch: 'Custom: searches, search errors and timeouts, and search latency.',
      },
      {
        part: 'Security',
        service: 'AWS KMS, IAM roles per service, AWS WAF, AWS CloudTrail',
        why: 'Tables, queues and the buffer are encrypted with KMS keys, and the buffer is encrypted in transit. The API role cannot call the models and the worker roles cannot be reached from the internet. WAF rate-limits by address before a request costs anything. Prompts and answers are not written to application logs, the guardrail trace is not requested, and model invocation logging stays off.',
      },
    ],
    limits: [
      'Amazon Bedrock limits on-demand inference by tokens a minute per model. There is also a quota of tokens per day, documented as the maximum across all supported models for the account, and the tokens of a request are deducted from both. At the start of a request it deducts the input tokens plus the maximum output from the quota and throttles if that does not fit, adjusts while the request runs, and returns the unused part at the end.',
      'Against that quota an output token counts as more than one for many models, at a documented rate per model that runs from 1 to 15, while a request is billed for its actual tokens. Tokens read from the prompt cache do not count against the quota; tokens written to it do.',
      'A Bedrock call that exceeds the account’s quota answers 429 ThrottlingException. A shortage of capacity on the provider’s side is not a 429: it answers ServiceUnavailableException (503) or an overloaded_error with status 529. ConverseStream can also end with ModelTimeoutException (408), InternalServerException (500) or, in the middle of a stream, ModelStreamErrorException.',
      'The Bedrock metric Invocations leaves out throttled requests, which are counted in InvocationThrottles, and the number of throttles seen depends on the SDK’s retry settings. InputTokenCount leaves out cached tokens, which have their own two metrics. A metric filtered by ModelId can miss the errors of requests that fail before the model is resolved. InvocationClientErrors is documented to include requests that were rejected for exceeding a service quota, and those are not counted as throttles, so such rejections are outside the Model throttling alarm: here they are only watched, through InvocationClientErrors, and not alarmed.',
      'EstimatedTPMQuotaUsage is documented as an approximation that does not reflect the reservation of input plus maximum output that drives throttling, so the lanes are planned from our own bucket arithmetic and not from that metric.',
      'A prompt cache entry lives for a time that restarts on every hit, 5 minutes on many models, and needs a minimum prefix length that depends on the model, between 512 and 4,096 tokens. Checkpoints are processed in the order tools, system, messages, and a change in an earlier part invalidates the later ones. A hit is never guaranteed.',
      'With cross-Region inference a request can land in a Region that has no cache entry for it, which the documentation notes as more cache writes at times of high demand. Routing adds no charge. Inference profiles do not support Provisioned Throughput.',
      'With a guardrail on a streamed call, the synchronous mode holds chunks until they are scanned and the asynchronous mode releases them first. Once any message content is marked for the guardrail, only marked content is evaluated. Tool results, tool definitions and the arguments of a tool call are not evaluated. An intervention sets the stop reason guardrail_intervened.',
      'A sensitive information filter set to mask returns a usable answer with the same stop reason as a block. Only the guardrail trace tells the two apart, and the trace also returns the values before masking. Guardrail checks have quotas of their own per account and Region, stated for the ApplyGuardrail operation in text units a second; the documentation does not say how they apply to a guardrail attached to a model call, so this design plans on no number: a guardrail that throttles fails the model call, which takes the retry path.',
      'An Application Load Balancer closes a connection that carries no data for its idle timeout, 60 seconds by default and at most 4,000. HTTP/2 PING frames do not reset it, so the stream sends real bytes.',
      'TargetResponseTime runs until the target starts to send response headers, so for a stream it measures the accept and not the answer. HTTPCode_Target_5XX_Count leaves out the 5xx the load balancer generates itself, HTTPCode_ELB_5XX_Count is reported only when nonzero, and RequestCount counts only requests for which a target was chosen.',
      'The other managed front doors have their own limits for streams: an API Gateway REST API can stream a response for up to 15 minutes with an idle timeout of 5 minutes on Regional endpoints and 30 seconds on edge-optimized ones, and an HTTP API cannot stream and has a maximum integration timeout of 30 seconds.',
      'A Fargate task gets at most 120 seconds between the stop signal and being killed, and 30 by default. The 90-second cap on an answer is chosen to fit inside it.',
      'An ECS rolling update keeps the running, stopping and pending tasks of a service at or under its maximum percent of the desired count, 200 by default. At 100 the service never runs more tasks than its desired count, and the minimum healthy percent has to be below 100 for a deploy to proceed. The minimum healthy count is that percent of the desired count rounded up, so 90 keeps 11 of 12 tasks and 14 of 15, and 95 keeps 23 of 24; the maximum is a limit on tasks in the running, stopping or pending state.',
      'A standard SQS queue delivers at least once. Retention can be set from 60 seconds to 14 days. Queue metrics arrive once a minute, and ApproximateAgeOfOldestMessage leaves out a message received three or more times without being deleted.',
      'A DynamoDB item is at most 400 KB, so a message is capped at 64 KB and the row keeps citations, not passages. A query returns at most 1 MB per page. A local secondary index allows strongly consistent reads and limits all items under one partition key value to 10 GB.',
      'TransactWriteItems takes up to 100 actions and 4 MB, each item costs two writes, and a transaction that touches an item another transaction is working on is cancelled and not retried by the SDK. A request token makes a repeated transaction a no-op for 10 minutes.',
      'A DynamoDB partition takes 1,000 write units a second, which bounds one tenant’s window row. An on-demand table has a default quota of 40,000 read and 40,000 write units a second, and a new one sustains about 4,000 writes a second, below this design’s peak, which is why the turns table is pre-warmed. Time to live deletes a row within a few days of its expiry, so the window is read by its minute and never by whether the row still exists.',
      'ElastiCache replicates from primary to replica asynchronously, so a failover can lose the latest writes. Its metrics are per node.',
      'A CloudWatch alarm with the default sliding evaluation window retrieves more data points than its evaluation periods, over a span called the evaluation range, whose size depends on the period and on the metric’s resolution and is not stated as one number. Real points in that range are evaluated before any missing point is filled in. For an alarm that needs all of its evaluation periods breaching, as every alarm here does, missing data treated as breaching therefore fires only once the earlier good points have left the range, later than the alarm’s period, and missing data treated as not breaching returns to OK once fewer breaching points than the alarm’s evaluation periods remain in the range; with one period, once the breaching point has left it.',
    ],
  },
  slos: [
    {
      objective: 'Accepting a request',
      target:
        '99.9% of API requests get their response headers within 300 ms and without a 5xx, over 28 days',
      measure:
        'On the API’s own load balancer: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount for errors, with an absent 5XX count read as zero, and TargetResponseTime for latency, which stops at the headers of the stream. The ratio is missing only when RequestCount is, and such a minute counts as failed. Refusals with 429 are not errors here; they have their own objective.',
    },
    {
      objective: 'First token, paid turns',
      target:
        '95% of the turns that produce a first token do so within 3 s of the request, over 28 days',
      measure:
        'First piece written to the buffer minus accepted at, published by the paid workers as a percentile over the turns that produced a first piece. The status piece of a document search counts as a first piece, so on a search turn the measure can end at the search notice and not at the first answer text. A turn that fails before its first token is not in the percentile; it counts against the objective for paid turns that finish. The independent signal is the age of the oldest message on the paid queue, from SQS.',
    },
    {
      objective: 'First token, free turns',
      target:
        '95% of the turns that produce a first token do so within 10 s of the request, over 28 days',
      measure:
        'The same difference on the free lane, with the age of the oldest message on the free queue as the independent signal. Refused requests and turns that fail before a first token are not in the percentile; those failures are counted by reason and have no objective on this lane. The percentile itself has no alarm: only the queue age is alarmed, so a slow provider with no backlog is seen only when worker slots fill and turns start to wait. While the lane drains at its planned rate, an accepted turn waits at most about a second for a worker once the reservations in flight have settled; for a minute or two after a jump from a low rate the wait can reach a few seconds.',
    },
    {
      objective: 'Paid turns that finish',
      target: '99.5% of accepted paid turns end as done, stopped or blocked, over 28 days',
      measure:
        '1 − (paid turns written as failed) / (paid turns accepted, counted by the API). Each failure is counted by whoever wrote it: the workers for capacity, model error and busy at the claim, and the API tasks for busy and interrupted. Dead workers cannot hide failures, because the API tasks write and count them. A failed turn that nobody reads again is never written and so not counted: its user had left.',
    },
    {
      objective: 'Paid requests not refused',
      target: '99.9% of paid turn requests are not refused as busy, over 28 days',
      measure:
        'Paid requests answered 429 with the reason busy divided by paid turn requests, both counted by the API. Refusals for a tenant’s own token limit are not counted.',
    },
    {
      objective: 'Usage accounted for',
      target:
        'On every day, at least 98% of the tokens the provider reports are in a usage row or counted as internal',
      measure:
        'Per model and day: the sum of Bedrock InputTokenCount, CacheReadInputTokenCount, CacheWriteInputTokenCount and OutputTokenCount, compared with the tokens the workers billed plus the tokens of summaries. The gap is failed, interrupted and stopped turns, tries abandoned at the 5-second first-token timeout on turns that later succeed, and the first call of a search turn whose later call fails. The comparison is made once a day, so it shows a trend across days and nothing within the day.',
    },
  ],
  alarms: [
    {
      name: 'Accept errors',
      metric:
        'On the API’s own ALB, each over one 5-minute window: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount above 0.05%, with an absent 5XX count read as zero and a missing ratio counted as breaching, or p99.95 TargetResponseTime above 200 ms. The load balancer publishes these, not the API',
      meaning:
        'Requests are failing or slow to accept: tasks are down, or the tables or the queue are failing. Each clause lets through at most 0.05% of requests, so both together stay inside the 0.1% the target allows, and 200 ms is tighter than 300. The ratio is missing only when no target can be chosen, and that fires the alarm too, after at least 5 minutes: earlier good points stay in the alarm’s evaluation range, so it fires once they have left it. Clients keep their turn ids and repeat.',
    },
    {
      name: 'Paid first token slow',
      metric:
        'p95 of time to first token published by the paid workers above 2 s over one 5-minute period; missing data is breaching',
      meaning:
        'Paid users are waiting, a second before the 3-second target. Look at the provider’s TimeToFirstToken and throttles first, then at the queue wait. Missing data means no paid worker has produced a first token for at least 5 minutes; earlier good points stay in the alarm’s evaluation range, so the queue-age alarm is the fast signal for dead workers. At 90 paid turns a second that silence is an outage of the pool and pages as one.',
    },
    {
      name: 'Paid queue waiting',
      metric:
        'SQS ApproximateAgeOfOldestMessage (maximum) on the paid queue above 1 s for two 1-minute periods; missing data is not breaching, because an empty queue has no age',
      meaning:
        'Paid turns are not being claimed at once: the pool is down, out of slots or out of bucket tokens, or the provider is slow and tasks are holding their slots. A second of waiting plus the usual 1.5 seconds to the first token is still inside the 3-second target. The metric comes from the queue, so it works with every worker dead, and it arrives once a minute.',
    },
    {
      name: 'Free queue waiting',
      metric:
        'SQS ApproximateAgeOfOldestMessage (maximum) on the free queue above 5 s for two 1-minute periods; missing data is not breaching',
      meaning:
        'The free lane is draining more slowly than its door admits: the free pool is down or short of tasks, the provider is slow or throttling, or turns cost more quota than planned. The normal wait is about a second at most once the reservations in flight have settled, and a few seconds for a minute or two after a jump from a low rate. Five seconds of waiting plus the usual 1.5 seconds to the first token is 6.5 seconds, 3.5 under the 10-second target.',
    },
    {
      name: 'Paid turns not finishing',
      metric:
        '(paid turns written as failed, each counted by its writer: the workers for capacity, model error and busy at the claim, the API tasks for busy and interrupted) / (paid turns accepted, from the API) above 0.3% over 15 minutes; a missing failure count is read as zero, and a missing accepted count is not evaluated',
      meaning:
        'Accepted turns are ending as failed, before the 0.5% the target allows. The reason split says which: interrupted for dying workers, capacity for the provider, busy for a lane that drains too slowly. The ratio does not subtract one count from another, so turns still in flight when traffic rises do not look like failures. With every worker dead, the API tasks that relay the waiting streams write those turns as busy at 15 seconds and count them, so the ratio rises with no worker reporting, and Paid queue waiting fires from the queue in any case; with the API dead nothing is accepted and Accept errors fires in its place. It returns to OK after a 15-minute window under the threshold, which has to be a real one: while the accepted count is missing, the alarm keeps its state.',
    },
    {
      name: 'Paid turns refused',
      metric:
        'Paid requests refused as busy / paid turn requests, counted by the API, above 0.05% over 5 minutes; missing data is not breaching',
      meaning:
        'The paid door is refusing, which it is sized never to need: paid requests are arriving faster than the 144 a second it admits, or API tasks are missing and the rest are over their share. A slow provider does not show here; it shows in Paid queue waiting. It returns to OK after a 5-minute window under the threshold; if paid requests stop and the ratio goes missing, a breaching point keeps the alarm on until it has left the evaluation range. Half of the 0.1% the target allows.',
    },
    {
      name: 'Model throttling',
      metric:
        'Per model, Bedrock InvocationThrottles / (Invocations + InvocationThrottles) above 5% for 5 minutes',
      meaning:
        'The provider is refusing calls because the account’s quota is used up (429). On the paid model, turns are slower and some are answered by the fallback; on the free model, turns fail with the reason capacity. Throttles are not part of Invocations, so the two are added. Compare the lane’s budget with the quota in Service Quotas.',
    },
    {
      name: 'Model errors',
      metric: 'Per model, Bedrock InvocationServerErrors / Invocations above 1% for 5 minutes',
      meaning:
        'The provider is failing calls with server-side errors. Before any answer text was shown these are retried; after it they are turns stored as failed and incomplete. The documentation defines the metric only as server-side errors, so it is this design’s reading, not a documented fact, that a 503 or 529 from a provider short of capacity is counted here and not in Model throttling. A break in the middle of a stream is a modelStreamErrorException with status 424, which may not be counted as a server-side error, so the signal for those breaks is the workers’ own count of turns failed with the reason model error, which does not depend on how the provider classifies the error.',
    },
    {
      name: 'Buffer degraded',
      metric:
        'Streams the API served from the stored answer / streams served, above 1% over 5 minutes; missing data is not breaching',
      meaning:
        'Clients are getting whole answers at the end where they should see tokens: a buffer shard is failing over, overloaded or unreachable. No turn is lost. Check EngineCPUUtilization and memory per node.',
    },
    {
      name: 'Usage drift',
      metric:
        'Per model and day, 1 − (tokens billed + internal tokens) / (Bedrock InputTokenCount + CacheReadInputTokenCount + CacheWriteInputTokenCount + OutputTokenCount) above 1%',
      meaning:
        'More of what the provider charges is going unbilled than failed and stopped turns and abandoned tries explain, at half of the 2% the target allows. A ticket, not a page: the figure is per day, so it warns on a trend across days and not within the day. Look for a rise in interrupted turns or a model call path that skips the final transaction.',
    },
  ],
  evolution: {
    mvp: 'One queue, one worker pool and one model for everyone, no document search and no summary: the history is cut to the last turns that fit. Each API task admits turns at a fixed rate and refuses the rest with 429. What is there from the first version is the part that cannot be added later without repairing data: the client’s turn id as the row key, the conditional claim, the worker as the only writer of the answer, usage in the same transaction, and the buffer with sequence numbers, because a client written against a direct socket cannot resume.',
    atScale: [
      'At 10x (3,000 turns a second), the model quotas come first: 720 million tokens a minute is a capacity contract and not a quota request, so the paid lane moves to reserved capacity and the free lane’s share is whatever is left.',
      'At 10x, table writes reach 65,000 units a second, above the default table quota of 40,000, so the quota is raised and the heartbeat, a sixth of the writes, moves into the buffer with the table deadline as the slower backstop.',
      'At 10x, the buffer takes 270,000 appends a second: more shards, and pieces every 200 milliseconds for free turns.',
      'At 10x, the largest tenant writes its window row 1,200 times a second, past one partition, so large tenants get several window rows and each request charges one chosen by hash against a share of the limit.',
      'At 100x, one Region is too large to fail at once. Each Region runs the whole design for the tenants whose home it is, because the one-answer rule is exact only inside one table, and a conversation never moves between Regions mid-turn.',
    ],
    firstBottleneck:
      'The model quota, and the free lane’s first: it runs at 93% at peak, so growth in free traffic turns directly into refusals, long before queues, workers or tables notice. The second is cost, not capacity: 38 billion tokens a day, of which the prompt cache already discounts 17 billion, so the next saving is a shorter history budget and not more infrastructure.',
    avoided: [
      'Hosting the models on our own GPUs with a scheduler that batches requests. It would give control over priority inside one pool; it is a second product to run. Worth it when the token bill passes what the fleet and its team would cost.',
      'Taking over a crashed turn and generating it again. It needs a fencing token on every write and a client that can erase text. Worth adding if worker crashes outside deploys ever become a visible share of failures.',
      'A monthly spend cap per tenant. It needs a tenant-wide counter that every final transaction writes, split over many rows to avoid conflicts. Worth adding when the product sells prepaid budgets.',
      'A WebSocket per user. Stop and resume already work over plain requests. Worth adding for voice or for typing that must reach the model while it speaks.',
      'A shared limiter for the model quota and for the door. A share per task wastes part of the budget when work lands unevenly or a task is being replaced. Worth adding when that waste costs more turns than a limiter would cost to run and to survive failing.',
      'Masking personal data in an answer in place of blocking it. A masked answer ends with the same stop reason as a blocked one, and only the guardrail trace, which carries the original values, tells them apart. Worth adding for a tenant that needs it, with the trace read in memory and never logged.',
      'A cache of answers to repeated questions. Chat rarely repeats and the answer depends on the conversation. Worth adding for a product with canned first messages.',
      'A dead-letter queue. A turn’s message is useless after 15 seconds, and the row already holds the failure. Worth adding if messages ever carry work that must not expire.',
      'Fairness between tenants inside a lane. Each tenant’s token limit bounds what it can take. Worth adding when one paid tenant’s burst visibly delays the others.',
    ],
  },
};
