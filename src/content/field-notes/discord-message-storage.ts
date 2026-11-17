import type { FieldNote } from '../types';

export const discordMessageStorage: FieldNote = {
  slug: 'discord-message-storage',
  company: 'Discord',
  title: 'Moving trillions of messages off Cassandra',
  summary:
    'Hot channels and garbage collection pauses made the message cluster slow and noisy. Discord put a Rust layer in front of the database to merge duplicate reads, then moved every message to ScyllaDB with no downtime.',
  minutes: 8,
  source: {
    title: 'How Discord Stores Trillions of Messages',
    url: 'https://discord.com/blog/how-discord-stores-trillions-of-messages',
    year: 2023,
  },
  context: [
    'Discord keeps messages in a Cassandra cluster. The post says it ran on 12 nodes in 2017, holding billions of messages, and on 177 nodes by early 2022, holding trillions. Messages are grouped by channel and by a fixed window of time, so one channel and one window form one partition, copied to three nodes, and reads and writes need a quorum of those copies.',
    'That layout works until one channel gets very busy. A big server can send far more traffic to a single partition than a small group chat ever will, and Cassandra reads are more expensive than its writes. When many people read the same channel at once, the nodes holding it slow down, and because of the quorum every other query that touches them slows down too.',
    'On top of that, compaction often fell behind and Java garbage collection paused nodes, sometimes long enough that someone had to reboot them by hand. The team was paged often and spent its time nursing the cluster instead of building on it.',
  ],
  walkthrough: {
    label: 'From a struggling Cassandra cluster to ScyllaDB behind data services',
    intro:
      "Follow a message read from the API to the store, watch a busy channel overload Cassandra, then see the data services and the new ScyllaDB cluster join the design. The metrics bar shows node counts, disk per node and p99 latency as quoted from Discord's post: red while Cassandra serves messages, green once ScyllaDB does. Load bars are approximate. Press play, or step through the stages.",
    nodes: [
      {
        id: 'clients',
        title: 'Discord clients',
        detail: 'Apps and browsers',
        column: 0,
        row: 'middle',
      },
      { id: 'api', title: 'API monolith', detail: 'Business logic', column: 1, row: 'middle' },
      {
        id: 'cassandra',
        title: 'Cassandra',
        detail: '177 nodes, quorum reads',
        column: 2,
        row: 'top',
      },
      {
        id: 'data',
        title: 'Data services',
        detail: 'Rust, one gRPC call per query',
        column: 2,
        row: 'middle',
        appearsAt: 3,
      },
      {
        id: 'scylla',
        title: 'ScyllaDB',
        detail: 'C++, no garbage collector',
        column: 2,
        row: 'bottom',
        appearsAt: 6,
      },
      {
        id: 'migrator',
        title: 'Rust migrator',
        detail: 'Copies token ranges',
        column: 3,
        row: 'middle',
        appearsAt: 7,
      },
      {
        id: 'checkpoints',
        title: 'Checkpoints',
        detail: 'Progress in SQLite',
        column: 4,
        row: 'middle',
        appearsAt: 7,
      },
    ],
    edges: [
      ['clients', 'api'],
      ['api', 'cassandra', 'quorum'],
      ['api', 'data', 'gRPC'],
      ['data', 'cassandra'],
      ['data', 'scylla'],
      ['cassandra', 'migrator', 'read'],
      ['migrator', 'checkpoints'],
      ['migrator', 'scylla', 'write'],
    ],
    stages: [
      {
        title: 'Messages by channel and time window',
        narration:
          'A client opens a channel and the API asks Cassandra for its recent messages. Message IDs are Snowflakes, so they sort by time. Each partition holds one channel for one fixed time window and is copied to three nodes.',
        tradeoff:
          'Partitioning by channel keeps a page of history in one place and the time window caps how big a partition can grow. The cost is that traffic follows popularity: a busy channel lands on the same three nodes no matter how many nodes the cluster has.',
        nodes: ['clients', 'api', 'cassandra'],
        travel: [
          ['clients', 'api'],
          ['api', 'cassandra', 'quorum'],
        ],
        short: 'Before',
        metrics: {
          custom: [
            { label: 'Message DB nodes', value: '177' },
            { label: 'Disk per node', value: '4 TB avg' },
          ],
        },
        load: { api: 30, cassandra: 45 },
      },
      {
        title: 'Reads cost more than writes',
        narration:
          'A write goes to a commit log and an in-memory table and is flushed to disk later. A read may have to check the memory table and several files on disk. When compaction falls behind, there are more files to check, so reads get slower and the backlog grows.',
        tradeoff:
          'This storage design makes writes cheap, which suits a chat app that writes all day. It pushes the work onto reads and onto background compaction, so a cluster that cannot keep up with compaction pays for it on every read.',
        nodes: ['api', 'cassandra'],
        travel: [['api', 'cassandra', 'quorum']],
        short: 'Costly reads',
        metrics: {
          custom: [
            { label: 'Message DB nodes', value: '177' },
            { label: 'Disk per node', value: '4 TB avg' },
          ],
        },
        load: { api: 35, cassandra: 75 },
      },
      {
        title: 'A busy channel slows everyone',
        narration:
          'A large server sends one announcement and a crowd of people open the same channel. All of those reads hit one partition. Its nodes slow down, and since queries wait for a quorum, unrelated channels on those nodes slow down as well. The post puts Cassandra p99 at 40 to 125 ms for reading history and 5 to 70 ms for inserts.',
        tradeoff:
          'Adding nodes does not help, because the problem is many readers on one key, not too little total capacity. Garbage collection pauses and manual compaction rounds made it worse, and every fix so far was operational toil rather than a change in design.',
        nodes: ['clients', 'api', 'cassandra'],
        travel: [
          ['clients', 'api'],
          ['api', 'cassandra', 'quorum'],
        ],
        short: 'Hot partition',
        metrics: {
          custom: [
            { label: 'Message DB nodes', value: '177' },
            { label: 'Disk per node', value: '4 TB avg' },
            { label: 'p99 read (history)', value: '40-125 ms', alert: true },
            { label: 'p99 insert', value: '5-70 ms', alert: true },
          ],
        },
        load: { api: 70, cassandra: 98 },
        traffic: [
          { edge: ['clients', 'api'], kind: 'heavy' },
          { edge: ['api', 'cassandra'], kind: 'failed' },
        ],
      },
      {
        title: 'A layer in front of the database',
        narration:
          'Discord adds data services: Rust services between the API and the database. Each one exposes about one gRPC endpoint per query and holds no business logic. The API now asks the data service, and the data service asks Cassandra.',
        tradeoff:
          'A thin, logic-free layer is easy to reason about and gives one place to control how much traffic reaches each partition. It is one more tier to deploy and monitor, and on its own it does not make a single query faster.',
        nodes: ['api', 'data', 'cassandra'],
        travel: [
          ['api', 'data', 'gRPC'],
          ['data', 'cassandra'],
        ],
        short: 'Data services',
        metrics: {
          custom: [
            { label: 'Message DB nodes', value: '177' },
            { label: 'Disk per node', value: '4 TB avg' },
            { label: 'p99 read (history)', value: '40-125 ms', alert: true },
            { label: 'p99 insert', value: '5-70 ms', alert: true },
          ],
        },
        load: { api: 60, data: 40, cassandra: 90 },
        traffic: [{ edge: ['api', 'data'], kind: 'heavy' }],
      },
      {
        title: 'Merge identical reads',
        narration:
          'When many requests ask for the same row at the same moment, the first one starts the database query and the others wait for its answer. A burst of readers on one channel becomes a single read on the partition.',
        tradeoff:
          'Coalescing turns a crowd into one query without any cache to invalidate, because it only shares answers that are in flight. It only helps when the duplicate requests reach the same process at the same time, which is what the next step arranges.',
        nodes: ['data', 'cassandra'],
        travel: [
          ['api', 'data', 'gRPC'],
          ['data', 'cassandra'],
        ],
        short: 'Coalescing',
        metrics: {
          custom: [
            { label: 'Message DB nodes', value: '177' },
            { label: 'Disk per node', value: '4 TB avg' },
            { label: 'p99 read (history)', value: '40-125 ms', alert: true },
            { label: 'p99 insert', value: '5-70 ms', alert: true },
          ],
        },
        load: { api: 55, data: 50, cassandra: 75 },
        traffic: [{ edge: ['api', 'data'], kind: 'heavy' }],
      },
      {
        title: 'Route each channel to one instance',
        narration:
          'Every request carries a routing key, the channel ID for messages, and consistent hashing sends all requests for a channel to the same data service instance. Duplicates now meet in one place and get merged. The post says spikes dropped, though Cassandra still had hot partitions, only less often.',
        tradeoff:
          'Routing by key makes coalescing effective, but it also means one very busy channel always lands on one instance. That is acceptable because the instance now sends one query instead of a crowd of them, and it bought the team time to build the new cluster.',
        nodes: ['api', 'data', 'cassandra'],
        travel: [
          ['api', 'data', 'gRPC'],
          ['data', 'cassandra'],
        ],
        short: 'Hash routing',
        metrics: {
          custom: [
            { label: 'Message DB nodes', value: '177' },
            { label: 'Disk per node', value: '4 TB avg' },
            { label: 'p99 read (history)', value: '40-125 ms', alert: true },
            { label: 'p99 insert', value: '5-70 ms', alert: true },
          ],
        },
        load: { api: 50, data: 55, cassandra: 65 },
      },
      {
        title: 'A new cluster on ScyllaDB',
        narration:
          'Discord builds a ScyllaDB cluster: compatible with Cassandra, written in C++, with no garbage collector and one shard per CPU core. It runs on local SSDs mirrored with RAID to persistent disks. Every other Discord database had already moved by 2020; messages waited until ScyllaDB made reverse-order scans fast.',
        tradeoff:
          'Keeping the same data model and query language made the switch mostly operational. No garbage collector removes the pauses that caused so many pages. The team still expected hot partitions on any engine, which is why the data services stay in front.',
        nodes: ['data', 'scylla'],
        travel: [['data', 'cassandra']],
        short: 'ScyllaDB',
        metrics: {
          custom: [
            { label: 'Message DB nodes', value: '177' },
            { label: 'Disk per node', value: '4 TB avg' },
            { label: 'p99 read (history)', value: '40-125 ms', alert: true },
            { label: 'p99 insert', value: '5-70 ms', alert: true },
          ],
        },
        load: { data: 50, cassandra: 65, scylla: 10 },
      },
      {
        title: 'Copy trillions of messages',
        narration:
          'The first plan used the ScyllaDB Spark migrator, estimated at about three months. Instead the team turned its Rust data service library into a migrator in an afternoon: it reads token ranges from Cassandra, records progress in SQLite and writes to ScyllaDB. The estimate fell to nine days, and the post reports peaks of 3.2 million messages per second.',
        tradeoff:
          'Reusing their own library gave speed and control, so they could move everything at once instead of cutting over at a point in time. The last ranges were full of old tombstones and the copy stalled at 99.9999% until those ranges were compacted, after which it finished in seconds.',
        nodes: ['cassandra', 'migrator', 'checkpoints', 'scylla'],
        travel: [
          ['cassandra', 'migrator', 'read'],
          ['migrator', 'checkpoints'],
          ['migrator', 'scylla', 'write'],
        ],
        short: 'Migration',
        metrics: {
          custom: [
            { label: 'Message DB nodes', value: '177' },
            { label: 'Disk per node', value: '4 TB avg' },
            { label: 'p99 read (history)', value: '40-125 ms', alert: true },
            { label: 'p99 insert', value: '5-70 ms', alert: true },
            { label: 'Migration peak', value: '3.2M msg/s' },
          ],
        },
        load: { data: 50, cassandra: 85, migrator: 90, scylla: 70 },
        traffic: [
          { edge: ['cassandra', 'migrator'], kind: 'heavy' },
          { edge: ['migrator', 'scylla'], kind: 'heavy' },
        ],
      },
      {
        title: 'Compare, then switch',
        narration:
          'A small share of reads goes to both databases and the answers are compared. They match, ScyllaDB holds full production traffic, and in May 2022 it becomes the primary message store.',
        tradeoff:
          'Shadow reads check correctness on real traffic before anyone depends on the new store. They cost extra reads for a while and only cover a sample, so they catch systematic bugs, not every last row.',
        nodes: ['data', 'cassandra', 'scylla'],
        travel: [
          ['data', 'cassandra'],
          ['data', 'scylla'],
        ],
        short: 'Cutover',
        metrics: {
          custom: [
            { label: 'Message DB nodes', value: '177' },
            { label: 'Disk per node', value: '4 TB avg' },
            { label: 'p99 read (history)', value: '40-125 ms', alert: true },
            { label: 'p99 insert', value: '5-70 ms', alert: true },
          ],
        },
        load: { data: 55, cassandra: 60, scylla: 40 },
      },
      {
        title: 'Fewer nodes, steady latency',
        narration:
          'The post reports 72 ScyllaDB nodes in place of 177 Cassandra nodes, with 9 TB of disk each against an average of 4 TB. Reading history went from a p99 of 40 to 125 ms to 15 ms, and inserts from 5 to 70 ms to a steady 5 ms. The World Cup final at the end of 2022 showed up as traffic spikes, handled without trouble.',
        tradeoff:
          'Fewer, bigger nodes are cheaper to run, but each one now holds more data, so losing or rebuilding a node moves more bytes. The gain came from two changes together: a faster engine for each read, and a layer that stops a crowd from reaching one partition.',
        nodes: ['clients', 'api', 'data', 'scylla'],
        travel: [
          ['clients', 'api'],
          ['api', 'data', 'gRPC'],
          ['data', 'scylla'],
        ],
        short: 'After',
        metrics: {
          custom: [
            { label: 'Message DB nodes', value: '72' },
            { label: 'Disk per node', value: '9 TB' },
            { label: 'p99 read (history)', value: '15 ms' },
            { label: 'p99 insert', value: '5 ms steady' },
          ],
        },
        load: { api: 45, data: 45, scylla: 40 },
        traffic: [{ edge: ['clients', 'api'], kind: 'heavy' }],
      },
    ],
  },
  tradeoffs: [
    'The data services are a new tier with their own deploys, scaling and failure modes, even though they hold no business logic.',
    'Hot partitions are made rare, not impossible: a single busy channel still maps to one partition and one data service instance.',
    'Moving everything at once depended on a custom migrator and a careful comparison of reads; the post describes a stall on tombstone-heavy ranges that needed manual compaction.',
    'Bigger nodes mean each node holds more data, so rebuilding one moves more data than before.',
  ],
  takeaways: [
    'For append-heavy, time-ordered data, partition by entity plus a time bucket so partitions stay bounded and history reads stay local.',
    'When the problem is many readers on one key, more nodes will not fix it. Merge identical in-flight requests and route by key so the duplicates meet in one place.',
    'Tail latency is often caused by the runtime and operations, such as garbage collection and compaction, not by the query. Changing the engine can be the real fix.',
    'Migrate with a checkpointed backfill and sampled shadow reads before switching the primary.',
  ],
  related: ['chat-messaging', 'distributed-cache'],
};
