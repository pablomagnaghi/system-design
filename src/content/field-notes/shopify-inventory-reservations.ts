import type { FieldNote } from '../types';

export const shopifyInventoryReservations: FieldNote = {
  slug: 'shopify-inventory-reservations',
  company: 'Shopify',
  title: 'Inventory reservations move from Redis to MySQL',
  summary:
    'Shopify moved the short holds that stop two buyers from taking the same unit out of Redis and into the MySQL database that owns the inventory ledger, using one row per unit and SKIP LOCKED. The hardest part turned out to be database connections, not locks.',
  minutes: 8,
  source: {
    title: 'We replaced Redis with MySQL for inventory reservations, and it scaled',
    url: 'https://shopify.engineering/scaling-inventory-reservations',
    year: 2026,
  },
  context: [
    'When a buyer starts paying, Shopify places a short hold on the items in the cart so another checkout cannot take the same unit. When payment succeeds, the hold turns into a permanent deduction in the inventory ledger. Get it wrong one way and the merchant oversells and has to cancel an order; get it wrong the other way and a buyer is told an item is gone when it is not.',
    'For years the holds lived in Redis as a counter per item, while the ledger lived in MySQL. Redis coped with the concurrency, but the final step touched both systems and could not be one atomic operation, so a crash between the two writes could leave the ledger and the holds disagreeing. The counters also knew nothing about which location could ship an item, and Redis was one more cluster to run.',
    'The load is not small: the post says merchants peaked at $5.1 million in sales per minute on Black Friday 2025, 11% above the year before, and every one of those orders touches inventory. Earlier tries at moving holds into MySQL as a single quantity column per item had failed on lock contention.',
  ],
  walkthrough: {
    label: 'A reservation, from Redis counters to rows in MySQL',
    intro:
      'Follow a checkout as it reserves and then claims inventory, first in the old split design and then as reservations move next to the ledger. The post gives no request rates or latencies, so the metrics bar shows only figures it does state: peak sales, throughput against target, reads and transactions on the primary, and CPU after the fix. All are quoted from the post; load bars are approximate. Press play, or step through the stages.',
    lanes: { top: 'Old store and visibility', bottom: 'Ledger and the rest of checkout' },
    nodes: [
      {
        id: 'checkout',
        title: 'Checkout',
        detail: 'Reserve, then claim',
        column: 0,
        row: 'middle',
      },
      { id: 'redis', title: 'Redis', detail: 'A counter per item', column: 1, row: 'top' },
      {
        id: 'proxy',
        title: 'ProxySQL',
        detail: 'Shared MySQL connections',
        column: 1,
        row: 'middle',
      },
      {
        id: 'ledger',
        title: 'Inventory ledger',
        detail: 'MySQL, source of truth',
        column: 2,
        row: 'bottom',
      },
      {
        id: 'units',
        title: 'Unit pool',
        detail: 'One row per unit, same MySQL',
        column: 2,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'reserved',
        title: 'Reserved quantities',
        detail: 'Holds per checkout',
        column: 3,
        row: 'middle',
        appearsAt: 2,
      },
      {
        id: 'replenish',
        title: 'Replenisher',
        detail: 'Refills the pool',
        column: 3,
        row: 'bottom',
        appearsAt: 3,
      },
      {
        id: 'others',
        title: 'Rest of checkout',
        detail: 'Carts, payments, orders',
        column: 0,
        row: 'bottom',
        appearsAt: 6,
      },
      {
        id: 'tags',
        title: 'Hold-time view',
        detail: 'Connection time per caller',
        column: 2,
        row: 'top',
        appearsAt: 7,
      },
    ],
    edges: [
      ['checkout', 'redis', 'hold'],
      ['checkout', 'proxy'],
      ['proxy', 'ledger', 'claim'],
      ['proxy', 'units', 'reserve'],
      ['units', 'reserved'],
      ['reserved', 'ledger', 'claim'],
      ['replenish', 'ledger'],
      ['replenish', 'units', 'refill'],
      ['others', 'proxy'],
      ['proxy', 'tags', 'tagged'],
    ],
    stages: [
      {
        title: 'Holds in Redis, stock in MySQL',
        narration:
          'When payment starts, checkout lowers a per-item counter in Redis. When payment succeeds, it deducts the units in the MySQL ledger and lifts the hold in Redis. Each half is fast on its own.',
        tradeoff:
          'An in-memory counter absorbs concurrent buyers easily, which is why it lasted for years. The price is that the hold and the stock it protects live in two systems that never commit together.',
        nodes: ['checkout', 'redis', 'proxy', 'ledger'],
        travel: [
          ['checkout', 'redis', 'hold'],
          ['checkout', 'proxy'],
          ['proxy', 'ledger', 'claim'],
        ],
        short: 'Redis era',
        metrics: { custom: [{ label: 'Peak sales / min', value: '$5.1M' }] },
        load: { checkout: 40, redis: 45, proxy: 35, ledger: 35 },
      },
      {
        title: 'The claim spans two systems',
        narration:
          'Claiming means one write to MySQL and one to Redis, and nothing makes them atomic. Depending on which lands first, a failure in between can sell a unit the ledger never deducted, or deduct a unit that still looks held. The counter also cannot tell which location is able to ship.',
        tradeoff:
          'Retries and reconciliation can shrink these windows but never close them, because the two stores have no shared transaction. Fixing it means putting the hold where the ledger already lives.',
        nodes: ['checkout', 'redis', 'ledger'],
        travel: [
          ['checkout', 'redis', 'hold'],
          ['proxy', 'ledger', 'claim'],
        ],
        short: 'Split claim',
        metrics: { custom: [{ label: 'Peak sales / min', value: '$5.1M' }] },
        load: { checkout: 40, redis: 45, proxy: 35, ledger: 35 },
        traffic: [{ edge: ['checkout', 'redis'], kind: 'failed' }],
      },
      {
        title: 'One row per unit, skip the locked ones',
        narration:
          'Instead of a quantity column that every buyer fights over, each sellable unit becomes its own row. Reserving takes the rows it needs with SELECT ... FOR UPDATE SKIP LOCKED, so a buyer never waits on rows another buyer already holds, and moves them into a table of held quantities. Holds, claims and the ledger now share one database and one transaction.',
        tradeoff:
          'SKIP LOCKED (MySQL 8) turns a single hot row into many cold ones, and keeping everything in one database gives ACID from reserve to claim. The cost is many more rows to store and scan, and holds now add load to the database that serves the rest of checkout.',
        nodes: ['checkout', 'proxy', 'units', 'reserved', 'ledger'],
        travel: [
          ['checkout', 'proxy'],
          ['proxy', 'units', 'reserve'],
          ['units', 'reserved'],
          ['reserved', 'ledger', 'claim'],
        ],
        short: 'SKIP LOCKED',
        metrics: { custom: [{ label: 'Peak sales / min', value: '$5.1M' }] },
        load: { checkout: 40, proxy: 45, units: 40, reserved: 30, ledger: 35 },
      },
      {
        title: 'Keep a small pool and refill it',
        narration:
          'A row for every unit in stock would make big items slow to scan. So each item and location keeps at most 1,000 free rows, the cap quoted in the post, and a replenisher tops the pool up from the ledger. If a hot item drains its pool mid-sale, the reserve path refills it inline under a lock: one transaction refills while the others for that item wait, then all proceed.',
        tradeoff:
          'The cap keeps the table compact and the scan fast; the post says it was sized from peak reservation rates seen during flash sales. The buyer who hits an empty pool pays extra latency, and the waiters queue behind one refill, but nobody is told an item is sold out while stock remains.',
        nodes: ['units', 'replenish', 'ledger'],
        travel: [
          ['replenish', 'ledger'],
          ['replenish', 'units', 'refill'],
        ],
        short: 'Bounded pool',
        metrics: { custom: [{ label: 'Peak sales / min', value: '$5.1M' }] },
        load: { proxy: 45, units: 55, reserved: 30, ledger: 40, replenish: 50 },
      },
      {
        title: 'Shape the keys around the locks',
        narration:
          'In the prototype, an auto-increment primary key made InnoDB lock both a secondary index and the clustered index, two locks per reservation. A composite primary key that starts with the columns the query filters on brought it to one lock per row. Reserve transactions also moved from REPEATABLE READ to READ COMMITTED, because gap locks on an empty pool were blocking the refill inserts.',
        tradeoff:
          'Halving the locks matters at many reservations per second, and dropping gap locks unblocks the refill. READ COMMITTED was the first non-default isolation level in that codebase, so the framework had to learn to set it per transaction.',
        nodes: ['units', 'reserved', 'replenish'],
        travel: [
          ['proxy', 'units', 'reserve'],
          ['replenish', 'units', 'refill'],
        ],
        short: 'Fewer locks',
        metrics: { custom: [{ label: 'Peak sales / min', value: '$5.1M' }] },
        load: { proxy: 50, units: 45, reserved: 30, ledger: 35, replenish: 35 },
      },
      {
        title: 'Lock in one order, batch the cart',
        narration:
          'Reserve and claim touched the two tables in opposite orders and sometimes deadlocked. Now reserve always deletes from the unit pool first and then inserts the hold, and claim only touches the holds, so no cycle can form. Carts with several items fetch all their units in one round trip with UNION ALL.',
        tradeoff:
          'A fixed lock order is a rule every future change has to respect, and nothing enforces it but review. Batching a cart into one query cuts round trips under load at the price of a larger, less obvious statement.',
        nodes: ['proxy', 'units', 'reserved'],
        travel: [
          ['checkout', 'proxy'],
          ['proxy', 'units', 'reserve'],
          ['units', 'reserved'],
        ],
        short: 'Lock order',
        metrics: { custom: [{ label: 'Peak sales / min', value: '$5.1M' }] },
        load: { checkout: 45, proxy: 55, units: 45, reserved: 35, ledger: 35 },
      },
      {
        title: 'A ceiling that the queries cannot explain',
        narration:
          'In production, throughput stopped well short of the target. Reservation latency was fine, CPU was not maxed and the queries were already tuned. Load tests showed threads queuing inside MySQL, CPU spiking when that queue drained, and ProxySQL running out of backend connections. The same connections serve every other step of checkout.',
        tradeoff:
          'Batching reservations from several checkouts into one query and moving some reads to replicas both helped a little, but added complexity without explaining the limit. Knowing the pool is exhausted does not say who is holding it.',
        nodes: ['checkout', 'others', 'proxy'],
        travel: [
          ['checkout', 'proxy'],
          ['others', 'proxy'],
        ],
        short: 'Ceiling',
        metrics: {
          custom: [
            { label: 'Peak sales / min', value: '$5.1M' },
            { label: 'Throughput', value: 'Below target', alert: true },
            { label: 'Primary reads', value: 'Baseline', alert: true },
            { label: 'Primary transactions', value: 'Baseline', alert: true },
          ],
        },
        load: { checkout: 70, others: 75, proxy: 98, units: 50, reserved: 35, ledger: 60 },
        traffic: [
          { edge: ['checkout', 'proxy'], kind: 'failed' },
          { edge: ['others', 'proxy'], kind: 'heavy' },
        ],
      },
      {
        title: 'Tag every query with its caller',
        narration:
          'The application adds a SQL comment naming the business process to every statement. ProxySQL parses the tag and adds up how long each process keeps a connection checked out. The view showed that other parts of checkout held connections far longer than they needed, and reservations were only the caller that pushed a nearly empty pool over the edge.',
        tradeoff:
          'Tagging at the application and counting at the proxy is cheap and turns "the pool is full" into a list of owners. It measures hold time, not query time, which is exactly what a long transaction that does little work hides from the usual dashboards.',
        nodes: ['others', 'proxy', 'tags'],
        travel: [
          ['others', 'proxy'],
          ['proxy', 'tags', 'tagged'],
        ],
        short: 'Attribution',
        metrics: {
          custom: [
            { label: 'Peak sales / min', value: '$5.1M' },
            { label: 'Throughput', value: 'Below target', alert: true },
            { label: 'Primary reads', value: 'Baseline', alert: true },
            { label: 'Primary transactions', value: 'Baseline', alert: true },
          ],
        },
        load: { checkout: 70, others: 75, proxy: 95, ledger: 60, tags: 20 },
        traffic: [{ edge: ['others', 'proxy'], kind: 'heavy' }],
      },
      {
        title: 'Clean up checkout, raise the old limit',
        narration:
          'Fixing the heavy callers removed 50% of reads and 33% of transactions on the primary, per the post. InnoDB thread concurrency, set conservatively years before, was raised where there was headroom. The ceiling went away: during high-volume flash sales the writer stayed under 50% CPU and the readers under 16%.',
        tradeoff:
          'The win came from code nobody was looking at, which is cheap once found but needs the per-caller view to stay found. Raising thread concurrency only helps while CPU has room, so it has to be checked again as the workload grows.',
        nodes: ['checkout', 'others', 'proxy', 'units'],
        travel: [
          ['checkout', 'proxy'],
          ['others', 'proxy'],
          ['proxy', 'units', 'reserve'],
        ],
        short: 'Ceiling lifted',
        metrics: {
          custom: [
            { label: 'Peak sales / min', value: '$5.1M' },
            { label: 'Throughput', value: 'Target met' },
            { label: 'Primary reads', value: '50% fewer' },
            { label: 'Primary transactions', value: '33% fewer' },
            { label: 'Writer CPU (flash sale)', value: 'Under 50%' },
            { label: 'Reader CPU (flash sale)', value: 'Under 16%' },
          ],
        },
        load: {
          checkout: 50,
          others: 35,
          proxy: 50,
          units: 45,
          reserved: 30,
          ledger: 40,
          tags: 15,
        },
      },
      {
        title: 'Shadow writes, then flip with a kill switch',
        narration:
          'Every reservation was written to both Redis and MySQL while Redis stayed the source of truth, so the two could be compared on real traffic and no in-flight hold had to be migrated. Once MySQL proved correct and fast enough, it became the source of truth, rolled out pod by pod from quiet merchants to the busiest.',
        tradeoff:
          'Dual writes double the work for a while, and Redis has to keep running to make the kill switch real. In return every step can be undone, which matters more than speed when a mistake means overselling.',
        nodes: ['checkout', 'redis', 'proxy', 'units', 'reserved'],
        travel: [
          ['checkout', 'redis', 'hold'],
          ['checkout', 'proxy'],
          ['proxy', 'units', 'reserve'],
          ['units', 'reserved'],
        ],
        short: 'Cutover',
        metrics: {
          custom: [
            { label: 'Peak sales / min', value: '$5.1M' },
            { label: 'Throughput', value: 'Target met' },
            { label: 'Primary reads', value: '50% fewer' },
            { label: 'Primary transactions', value: '33% fewer' },
            { label: 'Writer CPU (flash sale)', value: 'Under 50%' },
            { label: 'Reader CPU (flash sale)', value: 'Under 16%' },
          ],
        },
        load: {
          checkout: 50,
          redis: 30,
          others: 35,
          proxy: 50,
          units: 45,
          reserved: 30,
          ledger: 40,
        },
      },
    ],
  },
  tradeoffs: [
    'Holds now share a database with carts, payments and orders, so a reservation path that holds connections or locks too long can hurt all of checkout, not only itself.',
    'A buyer who arrives when a hot pool is empty waits for an inline refill, and only one refill runs at a time per item.',
    'Correctness rests on conventions that are easy to break later: a non-default isolation level, a fixed lock order and a primary key shaped around one query.',
    'The post gives no absolute throughput target, no reservation rates behind the 1,000-row cap and no latency figures, so the gains can only be judged by the reads, transactions and CPU numbers it does share.',
  ],
  takeaways: [
    'For a contended counter, turn one hot row into many rows and let SELECT ... FOR UPDATE SKIP LOCKED hand each buyer different ones; cap how many rows exist and refill under a single lock.',
    'Keep a hold in the same transactional store as the stock it protects, so reserve and claim cannot drift apart.',
    'When CPU is low but work queues, look at connection hold time per caller: tag queries at the application and aggregate at the proxy.',
    'Migrate a correctness-critical path with shadow writes, a comparison on real traffic and a kill switch, rolling out from the quietest tenants up.',
  ],
  related: ['flash-sale', 'booking-system'],
};
