import type { Design } from '../types';

export const codeJudge: Design = {
  slug: 'code-judge',
  title: 'Online code judge',
  summary:
    'Run code written by strangers against hidden tests and return a verdict in seconds: queue every submission, execute it in a throwaway sandbox with no network and hard limits, absorb the surge when a contest starts, and keep a live leaderboard for a hundred thousand contestants.',
  difficulty: 'Hard',
  minutes: 11,
  requirements: {
    functional: [
      'Browse problems and read a statement with a code stub per language.',
      'Submit a solution in one of several languages and get a verdict: accepted, wrong answer, time or memory limit exceeded, runtime or compile error.',
      'Join a timed contest and see a live leaderboard.',
    ],
    nonFunctional: [
      'Submitted code can never reach the network, the host, other submissions or the hidden tests of other problems.',
      'A typical verdict arrives within a few seconds.',
      'Contests of around a hundred thousand people, with thousands of submissions per second in the first and last minutes.',
      'Runtime and memory measurements are fair: the same code gets about the same numbers every time.',
      'The leaderboard is at most a few seconds behind.',
    ],
    outOfScope: [
      'Accounts, discussions and editorials.',
      'Plagiarism detection, beyond noting where it would hook in.',
    ],
  },
  entities: [
    {
      name: 'Problem',
      description:
        'Statement, code stubs per language, limits, and a reference to its test bundle.',
    },
    {
      name: 'Test bundle',
      description: 'Hidden inputs and expected outputs, versioned and read-only.',
    },
    {
      name: 'Submission',
      description:
        'User, problem, language, code, contest if any, and status: queued, running or judged with a verdict.',
    },
    {
      name: 'Contest',
      description: 'Start and end time, problem list and the scoring rule.',
    },
    {
      name: 'Standing',
      description: 'Per contestant: problems solved and penalty time. Derived from verdicts.',
    },
  ],
  api: [
    {
      method: 'GET',
      path: '/problems/{id}',
      description: 'Statement, limits and the code stub for the chosen language.',
    },
    {
      method: 'POST',
      path: '/problems/{id}/submissions',
      description:
        'Body: language, code, idempotencyKey. Returns 202 with a submission ID; never waits for the run.',
    },
    {
      method: 'GET',
      path: '/submissions/{id}',
      description:
        'Status and verdict. Clients poll it, or open a server-sent events stream on /submissions/{id}/events.',
    },
    {
      method: 'GET',
      path: '/contests/{id}/leaderboard?page={n}',
      description: 'A page of standings, plus the caller’s own rank.',
    },
  ],
  dataFlow: [
    'The API stores the submission as queued and puts a job on the queue for its language; the user gets an ID at once.',
    'A runner takes the job, fetches the test bundle and claims a fresh sandbox from a warm pool.',
    'The code compiles and runs against every test with no network and hard CPU, memory and time limits.',
    'The verdict is written to the submission, pushed or polled back to the user, and an accepted contest run updates the leaderboard.',
  ],
  highLevel: {
    label: 'Judge one submission during a contest',
    intro:
      'Follow one contestant from reading a problem to seeing their verdict and their new rank. Watch a contest start swamp a fixed set of runners, then see the autoscaler, sandboxes, the result stream and the leaderboard join as the design grows. Numbers are illustrative. Press play, or step through the stages.',
    nodes: [
      { id: 'user', title: 'Contestants', detail: 'Submit code', column: 0, row: 'middle' },
      {
        id: 'results',
        title: 'Result stream',
        detail: 'Poll or SSE',
        column: 0,
        row: 'bottom',
        appearsAt: 9,
      },
      { id: 'problems', title: 'Problem pages', detail: 'Cached at edge', column: 1, row: 'top' },
      {
        id: 'api',
        title: 'Submit API',
        detail: 'Validate, enqueue',
        column: 1,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'subs',
        title: 'Submissions DB',
        detail: 'Status, verdict',
        column: 1,
        row: 'bottom',
        appearsAt: 1,
      },
      {
        id: 'queue',
        title: 'Run queue',
        detail: 'Per language',
        column: 2,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'scaler',
        title: 'Autoscaler',
        detail: 'Depth + schedule',
        column: 3,
        row: 'top',
        appearsAt: 4,
      },
      {
        id: 'runners',
        title: 'Runners',
        detail: 'Pull and judge',
        column: 3,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'tests',
        title: 'Test bundles',
        detail: 'Read-only',
        column: 4,
        row: 'top',
        appearsAt: 5,
      },
      {
        id: 'sandbox',
        title: 'Sandbox',
        detail: 'MicroVM, no network',
        column: 4,
        row: 'middle',
        appearsAt: 6,
      },
      {
        id: 'pool',
        title: 'Warm pool',
        detail: 'Booted VMs',
        column: 5,
        row: 'middle',
        appearsAt: 6,
      },
      {
        id: 'board',
        title: 'Leaderboard',
        detail: 'Sorted set',
        column: 4,
        row: 'bottom',
        appearsAt: 10,
      },
      {
        id: 'readers',
        title: 'Board readers',
        detail: 'Poll every few s',
        column: 5,
        row: 'bottom',
        appearsAt: 10,
      },
    ],
    edges: [
      ['user', 'problems', 'read'],
      ['user', 'api', 'submit'],
      ['api', 'subs', 'queued'],
      ['api', 'queue', 'job'],
      ['queue', 'scaler', 'depth'],
      ['scaler', 'runners', 'scale'],
      ['queue', 'runners'],
      ['runners', 'tests', 'fetch'],
      ['pool', 'sandbox', 'claim'],
      ['runners', 'sandbox', 'run'],
      ['runners', 'subs', 'verdict'],
      ['user', 'results', 'wait'],
      ['results', 'subs', 'status'],
      ['runners', 'board', 'accepted'],
      ['readers', 'board', 'top page'],
    ],
    stages: [
      {
        title: 'Serve problems from the edge',
        narration:
          'Problem statements and stubs change rarely, so they are rendered once and cached at the CDN. Contest problems stay hidden until the start time, when they are published under new URLs that every edge fetches once.',
        tradeoff:
          'Serving statements from the database would put a hundred thousand reads on it in the first second of a contest. Caching costs a short delay when a statement is corrected mid-contest, which a new version and URL solve without waiting for caches to expire.',
        nodes: ['user', 'problems'],
        travel: [['user', 'problems', 'read']],
        short: 'Problems',
        metrics: { users: '2K', requestsPerSecond: '200', p95Latency: '3 s', errorRate: '0.01%' },
        load: { problems: 15 },
      },
      {
        title: 'Accept the submission and store it',
        narration:
          'The API checks the language, the code size and a per-user rate limit, then writes the submission with status "queued" under an idempotency key. A double click returns the same submission ID instead of a second run.',
        tradeoff:
          'Writing before running means a crash anywhere later can be recovered from the database, and the user always has an ID to ask about. The cost is one more write on the busiest path, which is small next to the seconds a run takes.',
        nodes: ['user', 'api', 'subs'],
        travel: [
          ['user', 'api', 'submit'],
          ['api', 'subs', 'queued'],
        ],
        short: 'Submit',
        metrics: { users: '2K', requestsPerSecond: '200', p95Latency: '3 s', errorRate: '0.01%' },
        load: { api: 10, subs: 10 },
      },
      {
        title: 'Queue it, never run it inline',
        narration:
          'The API puts a job on the queue for that language and answers 202 with the submission ID. The API servers never execute user code and never wait for a run.',
        tradeoff:
          'Running code inside the request would make API capacity depend on the slowest submission and give a burst nowhere to wait. A queue adds a hop and a few hundred milliseconds, and in exchange runs are retried after a crash and the queue absorbs any spike. Storing the row and enqueueing the job are two separate writes, so a sweeper re-enqueues any submission still "queued" past a deadline; a job that ends up queued twice is harmless because the verdict write is conditional.',
        nodes: ['api', 'queue'],
        travel: [['api', 'queue', 'job']],
        short: 'Queue',
        metrics: { users: '2K', requestsPerSecond: '200', p95Latency: '3 s', errorRate: '0.01%' },
        load: { api: 10, queue: 5 },
      },
      {
        title: 'The contest starts',
        narration:
          'At the start time a hundred thousand contestants open the problems, and within minutes thousands of submissions arrive every second. A fixed set of runners works flat out, the queue grows faster than they drain it, and a verdict that took three seconds now takes ninety. Impatient users resubmit, which adds to the queue.',
        tradeoff:
          'The queue does its job: nothing is lost and the API stays fast. But a queue only turns overload into waiting, and in a timed contest waiting is a failure too. Sizing the fleet for the peak all day would leave it idle most of the time, so capacity has to follow the contest calendar.',
        nodes: ['user', 'api', 'queue', 'runners'],
        travel: [
          ['user', 'api', 'submit'],
          ['api', 'queue', 'job'],
          ['queue', 'runners'],
        ],
        short: 'Contest rush',
        metrics: {
          users: '100K',
          requestsPerSecond: '5K',
          p95Latency: '90 s',
          errorRate: '2%',
          alerts: ['p95Latency', 'errorRate'],
        },
        load: { api: 45, queue: 95, runners: 100 },
        traffic: [{ edge: ['api', 'queue'], kind: 'heavy' }],
      },
      {
        title: 'Scale on depth and on the calendar',
        narration:
          'An autoscaler joins the design. It watches queue depth and the age of the oldest job, and adds runners when either grows. Because contests are scheduled, it also scales up minutes before each start instead of waiting for the wave.',
        tradeoff:
          'Reacting to depth alone means the first minute of a contest queues while new machines boot. Scaling ahead costs paying for idle capacity for a few minutes, which is cheap compared with a contest where verdicts take a minute.',
        nodes: ['queue', 'scaler', 'runners'],
        travel: [
          ['queue', 'scaler', 'depth'],
          ['scaler', 'runners', 'scale'],
        ],
        short: 'Autoscale',
        metrics: { users: '100K', requestsPerSecond: '5K', p95Latency: '4 s', errorRate: '0.1%' },
        load: { queue: 30, scaler: 40, runners: 70 },
      },
      {
        title: 'Pull the job and its tests',
        narration:
          'A runner takes a job with a visibility timeout, so a runner that dies hands the job back. It fetches the problem’s test bundle by version and keeps it on local disk, since the same few problems are judged thousands of times in a contest.',
        tradeoff:
          'Tests stay out of the sandbox image and are mounted read-only for a single run. Caching bundles on runners cuts storage reads to almost nothing during a contest, and the version in the key means a fixed test never mixes with an old one.',
        nodes: ['queue', 'runners', 'tests'],
        travel: [
          ['queue', 'runners'],
          ['runners', 'tests', 'fetch'],
        ],
        short: 'Pull + tests',
        metrics: { users: '100K', requestsPerSecond: '5K', p95Latency: '4 s', errorRate: '0.1%' },
        load: { queue: 30, runners: 70, tests: 15 },
      },
      {
        title: 'Claim a fresh sandbox',
        narration:
          'A pool of already booted microVMs per language waits on each host. The runner claims one, copies in the code and the tests, and the VM is destroyed after this single run, never reused.',
        tradeoff:
          'Booting a VM per submission adds latency, and reusing one lets a submission leave something behind for the next. A warm pool of single-use VMs gets both a fast start and a clean slate, at the cost of memory held by idle VMs.',
        nodes: ['pool', 'sandbox'],
        travel: [['pool', 'sandbox', 'claim']],
        short: 'Sandbox',
        metrics: { users: '100K', requestsPerSecond: '5K', p95Latency: '4 s', errorRate: '0.1%' },
        load: { pool: 60, sandbox: 65 },
      },
      {
        title: 'Run under hard limits',
        narration:
          'The code compiles and runs as a non-root user on a read-only file system with no network device. Limits cap CPU time, wall time, memory, process count and output size, and a syscall filter blocks everything a solution does not need.',
        tradeoff:
          'Every limit is a defense against a specific attack: fork bombs, infinite loops, memory floods, giant outputs. Pinning each VM to dedicated cores and measuring CPU time instead of wall time makes runtimes fair, and the cost is fewer runs per host.',
        nodes: ['runners', 'sandbox'],
        travel: [['runners', 'sandbox', 'run']],
        short: 'Run',
        metrics: { users: '100K', requestsPerSecond: '5K', p95Latency: '4 s', errorRate: '0.1%' },
        load: { runners: 70, sandbox: 75 },
      },
      {
        title: 'Judge and record the verdict',
        narration:
          'A harness per language feeds each test input, captures the output and compares it with the expected answer, or calls a checker for problems with many valid answers. The run stops at the first failing test, and the verdict is written with a conditional update from "queued" or "running" to "judged".',
        tradeoff:
          'At-least-once delivery means a job can run twice after a runner crash. The conditional update makes the second verdict a no-op, so the user never sees their verdict flip. Stopping at the first failure saves capacity and hides how many tests passed, which also leaks less about the hidden tests.',
        nodes: ['runners', 'subs'],
        travel: [['runners', 'subs', 'verdict']],
        short: 'Verdict',
        metrics: { users: '100K', requestsPerSecond: '5K', p95Latency: '4 s', errorRate: '0.1%' },
        load: { runners: 70, subs: 40 },
      },
      {
        title: 'Send the verdict back',
        narration:
          'The client opens a server-sent events stream for the submission, or polls once a second if events are blocked. Either way the gateway reads the status, and the stream closes as soon as a verdict exists.',
        tradeoff:
          'Polling is trivial to build and cache, but a hundred thousand clients polling every second is real load. Events cut that to one message per verdict and cost long-lived connections to manage, so polling stays as a fallback rather than the main path.',
        nodes: ['user', 'results', 'subs'],
        travel: [
          ['user', 'results', 'wait'],
          ['results', 'subs', 'status'],
        ],
        short: 'Send back',
        metrics: { users: '100K', requestsPerSecond: '5K', p95Latency: '4 s', errorRate: '0.1%' },
        load: { results: 45, subs: 40 },
      },
      {
        title: 'Update the live leaderboard',
        narration:
          'An accepted contest verdict updates the contestant’s entry in a sorted set for the contest, scored by problems solved and then by penalty time. The update sets the score from the contestant’s standing in the submissions table, counting only the first accepted run of each problem, and never adds to the old score. The runner acknowledges the job only after this update. Readers get the top page from a copy cached for two seconds, and their own rank with one lookup.',
        tradeoff:
          'Recomputing standings from the submissions table on every view would melt the database at the end of a contest. A sorted set gives ranks in logarithmic time and costs a second copy of the truth, which can be rebuilt from verdicts if it is ever lost. Jobs are delivered at least once, and an increment per accepted verdict would count a redelivered job or a second accepted solution twice. Setting the score from the standing costs one indexed read per accepted run and makes every repeat write the same value.',
        nodes: ['runners', 'board', 'readers'],
        travel: [
          ['runners', 'board', 'accepted'],
          ['readers', 'board', 'top page'],
        ],
        short: 'Leaderboard',
        metrics: { users: '100K', requestsPerSecond: '5K', p95Latency: '4 s', errorRate: '0.1%' },
        load: { runners: 70, board: 50, readers: 40 },
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we run untrusted code safely?',
      options: [
        {
          name: 'Hardened containers',
          pros: 'Start in milliseconds and pack densely; namespaces, cgroups and syscall filters block most attacks.',
          cons: 'Every container shares the host kernel, so one kernel bug is an escape for all of them.',
        },
        {
          name: 'A user-space kernel in front of containers',
          pros: 'Intercepts system calls so the host kernel is barely exposed, and still feels like a container.',
          cons: 'Slower for system-call-heavy code and some programs behave differently.',
        },
        {
          name: 'MicroVMs from a warm pool',
          pros: 'A separate kernel per run behind a small, hardened hypervisor; boot in a fraction of a second.',
          cons: 'More memory per run than a container and more machinery to operate.',
        },
        {
          name: 'Full virtual machines',
          pros: 'Strong, well understood isolation.',
          cons: 'Boot times and overhead make a VM per submission far too slow and costly.',
        },
      ],
      choice:
        'Single-use microVMs from a warm pool, with container-style limits inside each one: no network, read-only file system, non-root user, CPU, memory, process and output caps. Two layers mean one bug is not enough to escape.',
    },
    {
      question: 'How do we survive the surge at the start and end of a contest?',
      options: [
        {
          name: 'Autoscale on queue depth only',
          pros: 'Simple and follows real demand.',
          cons: 'New capacity arrives minutes after the spike, exactly when contestants are waiting.',
        },
        {
          name: 'Provision for the peak ahead of every contest',
          pros: 'Contests are scheduled, so the spike is known in advance.',
          cons: 'Pays for idle capacity and still fails if turnout beats the forecast.',
        },
        {
          name: 'Separate queues with priority and graceful degradation',
          pros: 'Contest submissions are served first; practice runs wait longer instead of contests failing.',
          cons: 'Practice users see slower verdicts during contests, and priorities need tuning.',
        },
      ],
      choice:
        'All three: scale ahead of each contest based on registrations, keep reacting to depth, and run contest and practice submissions on separate queues so practice absorbs any shortfall. Rate limits per user stop one contestant from flooding the queue.',
    },
    {
      question: 'How do we keep the leaderboard live and correct?',
      options: [
        {
          name: 'Query the submissions table on every view',
          pros: 'Always exact, nothing extra to keep in sync.',
          cons: 'A group-by over a contest’s submissions on every refresh does not survive a hundred thousand readers.',
        },
        {
          name: 'A sorted set updated on each accepted verdict',
          pros: 'Ranks and pages in logarithmic time; one update per accepted run, safe to repeat when it sets the score instead of incrementing it.',
          cons: 'A derived copy that must be rebuilt if lost or if a verdict is overturned by a rejudge.',
        },
        {
          name: 'A snapshot recomputed every few seconds',
          pros: 'Simple, and the cost does not grow with readers.',
          cons: 'Always a few seconds stale and recomputes everything even when nothing changed.',
        },
      ],
      choice:
        'A sorted set per contest whose score packs problems solved and penalty time into one number, set from the contestant’s standing on each accepted verdict so a repeated update changes nothing, with the top page cached for a couple of seconds. The submissions table stays the source of truth for rebuilds, rejudges and the final standings.',
    },
  ],
  wrapUp:
    'Store every submission before running it, queue it per language, scale runners on depth and ahead of contests, judge each run in a single-use microVM with no network and hard limits, write verdicts idempotently, stream them back with polling as a fallback, and rank contestants in a sorted set rebuilt from the database when needed.',
};
