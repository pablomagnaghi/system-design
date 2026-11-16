import type { Design } from '../types';

export const onlineChess: Design = {
  slug: 'online-chess',
  title: 'Online chess',
  summary:
    'Pair players of similar rating in seconds, then run each game on one server that owns the board and both clocks: every move is checked, saved and delivered in a blink, a dropped player can come back, and ratings change only after the game ends.',
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Find an opponent of similar rating for a chosen time control, such as 3 minutes plus 2 seconds per move.',
      'Play a game: each move is checked and shown to the opponent right away, with both clocks running.',
      'A game ends by checkmate, resignation, timeout, draw or abandonment.',
      'Ratings update when a game ends, and finished games can be replayed.',
    ],
    nonFunctional: [
      'About a million games at once at peak; each game is a tiny, independent state.',
      'A move reaches the opponent in about a hundred milliseconds.',
      'Clocks are fair and decided by the server, never by a client.',
      'Within a game, moves apply once and in order, and an acknowledged move is never lost.',
    ],
    outOfScope: ['Cheat detection.', 'Tournaments, chat and puzzles.'],
  },
  entities: [
    {
      name: 'Player',
      description: 'ID and a rating with its uncertainty for each time control.',
    },
    {
      name: 'Seek',
      description:
        'A player waiting for a game: time control, rating and when they started waiting.',
    },
    {
      name: 'Game',
      description:
        'ID, players, time control, moves so far, both clocks, whose turn it is, status and result.',
    },
    {
      name: 'Move',
      description: 'Game, move number, the move itself and the server time it was received.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/seeks',
      description:
        'Body: timeControl. Joins matchmaking; the game ID arrives later on the WebSocket.',
    },
    {
      method: 'WS',
      path: '/games/{id}',
      description:
        'Client sends { move, moveNumber }. Server sends each move with both clocks, and the result at the end.',
    },
    {
      method: 'GET',
      path: '/games/{id}',
      description: 'The full move list and result of a game, for replay.',
    },
  ],
  dataFlow: [
    'A player joins a pool for a time control and is paired with the closest rating in a window that widens with time.',
    'The game is created on the server that owns its game ID, and both players connect to it.',
    'Each move is validated, charged against the mover’s clock, saved and pushed to the opponent.',
    'When the game ends, an event updates both ratings and archives the game.',
  ],
  highLevel: {
    label: 'Pair two players and play a game',
    intro:
      'Follow two players from matchmaking into a game, through a move, a dropped connection and a failed server, to the rating update at the end. Press play, or step through the stages.',
    nodes: [
      { id: 'players', title: 'Players', detail: 'One WebSocket each', column: 0, row: 'middle' },
      { id: 'matcher', title: 'Matchmaker', detail: 'Per time control', column: 1, row: 'top' },
      { id: 'gateway', title: 'Gateway', detail: 'Routes by game ID', column: 1, row: 'middle' },
      {
        id: 'directory',
        title: 'Game directory',
        detail: 'Game to server',
        column: 1,
        row: 'bottom',
      },
      { id: 'pool', title: 'Rating pool', detail: 'Sorted by rating', column: 2, row: 'top' },
      { id: 'server', title: 'Game server', detail: 'Board and clocks', column: 2, row: 'middle' },
      { id: 'movelog', title: 'Move log', detail: 'Append before ack', column: 2, row: 'bottom' },
      { id: 'events', title: 'Game events', detail: 'Game ended', column: 3, row: 'middle' },
      { id: 'ratings', title: 'Ratings', detail: 'Update once', column: 4, row: 'middle' },
      { id: 'archive', title: 'Game archive', detail: 'For replay', column: 4, row: 'bottom' },
    ],
    edges: [
      ['players', 'gateway', 'connect'],
      ['gateway', 'matcher', 'seek'],
      ['matcher', 'pool', 'pair'],
      ['matcher', 'server', 'create'],
      ['gateway', 'directory', 'lookup'],
      ['gateway', 'server', 'moves'],
      ['server', 'movelog', 'append'],
      ['server', 'events', 'result'],
      ['events', 'ratings'],
      ['events', 'archive'],
    ],
    stages: [
      {
        title: 'Join a pool',
        narration:
          'A player opens a WebSocket to the gateway and asks for a game at a time control. The matchmaker adds a seek with their current rating to the pool for that time control.',
        tradeoff:
          'One global pool would let a bullet player meet a classical one. A pool per time control keeps games sensible; the cost is that rare time controls have few players and longer waits.',
        nodes: ['players', 'gateway', 'matcher', 'pool'],
        travel: [
          ['players', 'gateway', 'connect'],
          ['gateway', 'matcher', 'seek'],
        ],
      },
      {
        title: 'Widen the window while waiting',
        narration:
          'Seeks sit in a set sorted by rating. A few times a second, the matchmaker looks for the closest rating within a window around each seek; the window starts narrow and widens the longer a player waits.',
        tradeoff:
          'A fixed narrow window gives the fairest games and leaves strong or weak players waiting forever. Widening trades some fairness for a game within seconds, and the speed of widening is the knob between the two.',
        nodes: ['matcher', 'pool'],
        travel: [['matcher', 'pool', 'pair']],
      },
      {
        title: 'Pair atomically',
        narration:
          'Pairing removes both seeks in one atomic step on the pool: if either is already gone, nothing happens and the matchmaker tries again. Each pool has a single matchmaker owner, so two workers never race on it.',
        tradeoff:
          'Reading two seeks and removing them in separate steps can put one player in two games. An atomic step or a single owner per pool prevents that, and the cost is that one pool is served by one worker, which is plenty for a sorted set.',
        nodes: ['matcher', 'pool'],
        travel: [['matcher', 'pool', 'pair']],
      },
      {
        title: 'Place the game on its shard',
        narration:
          'The matchmaker creates the game with a new ID, colors and clocks. The ID maps to one game server through the directory, and both players are told the game ID and connect through the gateway, which routes them to that server.',
        tradeoff:
          'Spreading a game across servers would need coordination on every move. Pinning each game to one owner makes the owner the single authority, and the cost is a directory to keep and a failover story when an owner dies.',
        nodes: ['matcher', 'server', 'gateway', 'directory'],
        travel: [
          ['matcher', 'server', 'create'],
          ['gateway', 'directory', 'lookup'],
        ],
      },
      {
        title: 'Validate the move on the server',
        narration:
          'White sends a move with its move number. The game server checks that it is White’s turn, the number is the next one and the move is legal on its own board. A repeated number is ignored; anything else wrong is rejected.',
        tradeoff:
          'Trusting the client saves a check of a few microseconds and lets anyone play illegal moves. Validating on the server costs CPU on every move, which is tiny for chess, and makes the server the only board that counts.',
        nodes: ['players', 'gateway', 'server'],
        travel: [
          ['players', 'gateway', 'connect'],
          ['gateway', 'server', 'moves'],
        ],
      },
      {
        title: 'Charge the clock on the server',
        narration:
          'The server takes the time between sending the last move and receiving this one off the mover’s clock, minus a small capped allowance for network lag, then adds the increment. It sets a timer for the other side to flag them if their time runs out.',
        tradeoff:
          'Client clocks are exact for the player and trivial to cheat. Server time is fair to both sides and penalizes a player on a slow network a little, which the capped lag allowance softens without letting anyone stretch it.',
        nodes: ['server'],
        travel: [],
      },
      {
        title: 'Save, then deliver',
        narration:
          'The move is appended to the move log for the game, and only then acknowledged to the mover and pushed to the opponent with both clocks. Spectators get it through a separate fan-out so the game server stays small.',
        tradeoff:
          'Pushing before saving shaves a few milliseconds, and a crash right after could show a move to the opponent that the system then forgets. Saving first costs one fast append per move and means a delivered move always survives.',
        nodes: ['server', 'movelog', 'gateway', 'players'],
        travel: [
          ['server', 'movelog', 'append'],
          ['gateway', 'server', 'moves'],
        ],
      },
      {
        title: 'Reconnect or lose on time',
        narration:
          'Black’s connection drops. Their clock keeps running. If they reconnect, the gateway routes them back to the same server, which sends the full state. If they stay away past a timeout of about a minute, or their clock runs out first, they lose; a game abandoned before both sides move is canceled instead.',
        tradeoff:
          'Pausing the clock on disconnect is kind to bad networks and easy to abuse by pulling the cable in a lost position. A running clock plus a timeout is strict, and a short grace period covers brief drops without giving away the game.',
        nodes: ['players', 'gateway', 'directory', 'server'],
        travel: [
          ['players', 'gateway', 'connect'],
          ['gateway', 'directory', 'lookup'],
          ['gateway', 'server', 'moves'],
        ],
      },
      {
        title: 'Recover from a failed server',
        narration:
          'If a game server dies, the directory reassigns its games to other servers. Each new owner replays the move log to rebuild board and clocks, players reconnect, and play continues from the last saved move.',
        tradeoff:
          'A hot standby per game would fail over faster and double the memory and traffic for a rare event. Replaying a log of a few dozen moves takes milliseconds, so the cost is only the seconds players spend reconnecting, with clocks restored from saved times.',
        nodes: ['gateway', 'directory', 'server', 'movelog'],
        travel: [
          ['gateway', 'directory', 'lookup'],
          ['server', 'movelog', 'append'],
        ],
      },
      {
        title: 'Rate the game after it ends',
        narration:
          'On checkmate, resignation, timeout or draw, the server writes the result and emits a game-ended event. The rating service updates both players, keyed by game ID so a replayed event changes nothing, and the archive stores the full game.',
        tradeoff:
          'Updating ratings inside the game server would put a second database on the move path. An event keeps games independent of ratings, and the cost is a second or so before the new rating shows up.',
        nodes: ['server', 'events', 'ratings', 'archive'],
        travel: [
          ['server', 'events', 'result'],
          ['events', 'ratings'],
          ['events', 'archive'],
        ],
      },
    ],
  },
  deepDives: [
    {
      question: 'How do we pair players quickly and fairly?',
      options: [
        {
          name: 'First come, first served per time control',
          pros: 'Instant games and almost nothing to build.',
          cons: 'A beginner meets a master, and both leave unhappy.',
        },
        {
          name: 'Fixed rating buckets',
          pros: 'Simple queues, with games inside a known rating band.',
          cons: 'Two close players on either side of a boundary never meet, and edge buckets stay empty.',
        },
        {
          name: 'Sorted pool with a widening window',
          pros: 'Closest available opponent, with waits bounded by how fast the window grows.',
          cons: 'Pairing must be atomic or owned by one worker, and the widening needs tuning.',
        },
      ],
      choice:
        'A sorted pool per time control, a window that widens with waiting time, and atomic removal of both seeks. Rating uncertainty can widen the window faster for new players.',
    },
    {
      question: 'Who decides how much time each player has left?',
      options: [
        {
          name: 'Each client runs its own clock',
          pros: 'Exactly what the player sees, with no network effects.',
          cons: 'A modified client can stop its clock, so it cannot be trusted.',
        },
        {
          name: 'Server clock from receive times',
          pros: 'One authority, and timeouts fire from a server timer.',
          cons: 'A player on a slow network loses their round trip on every move.',
        },
        {
          name: 'Server clock with capped lag allowance',
          pros: 'Fair across networks while the server stays the authority.',
          cons: 'Lag must be measured, and the cap must be small enough not to be gamed.',
        },
      ],
      choice:
        'The server clock with a small, capped allowance per move based on measured round trip. Clients only display a countdown that the server corrects with every move.',
    },
    {
      question: 'How do we scale to a million games and survive server failures?',
      options: [
        {
          name: 'Games only in server memory',
          pros: 'Fastest moves and no storage on the hot path.',
          cons: 'A crashed server loses every game it held.',
        },
        {
          name: 'Shard by game ID with a move log',
          pros: 'Games are independent, so servers scale out; a lost server is rebuilt from short logs.',
          cons: 'One append per move, and a directory to reassign games on failure.',
        },
        {
          name: 'Replicate each game to a standby',
          pros: 'Near instant failover with no replay.',
          cons: 'Double the memory and traffic for a failure that is rare and cheap to recover from.',
        },
      ],
      choice:
        'Shard by game ID, keep state in memory on the owner, append every move before acknowledging it, and rebuild from the log on failover. Each server holds tens of thousands of games, so a few dozen servers cover a million.',
    },
  ],
  wrapUp:
    'Pool seeks by time control, pair the closest ratings in a window that widens with time, remove both seeks atomically, pin each game to one server by game ID, validate moves and run clocks on that server, append each move before delivering it, keep clocks running through disconnects with a timeout, replay the log on failover, and update ratings from a game-ended event.',
};
