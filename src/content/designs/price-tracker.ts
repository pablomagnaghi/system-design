import type { Design } from '../types';

export const priceTracker: Design = {
  slug: 'price-tracker',
  title: 'Price tracker',
  summary:
    'Watch the prices of 300 million products on outside stores: spend each store’s crawl budget where people are looking and pace every store inside it, claim each fetch with a conditional write, keep history as a list of confirmed changes, confirm a suspicious reading with a second fetch, and fire each alert at most once per drop through a conditional write on the alert and a key per alert and drop.',
  minutes: 14,
  difficulty: 'Medium',
  requirements: {
    functional: [
      'Users track a product by pasting its store link and setting a target price. Everyone who tracks the same store item shares one product, and a user has at most one alert per product.',
      'Users change the target or stop tracking at any time, and list their alerts with each product’s current price and when it was last checked.',
      'Users see the price history of a product as a chart over a month, a year or five years.',
      'Users get a notification when a confirmed price falls to their target or below, at most once per drop. The alert arms again only after the price climbs more than 5% above the target.',
      'Stores are read through their product API where one exists, and otherwise by reading the product page with an extractor written for that store.',
    ],
    nonFunctional: [
      '300 million products from about 5,000 stores. 20 million of them are watched, by 50 million alerts from 20 million users; 2 million users are active on a given day.',
      'Refresh by priority: the 1 million most watched products every 15 minutes, the other 19 million watched products every 6 hours, and the 280 million that nobody watches once a week. About 2,500 fetches a second in all.',
      'Politeness: each store has a budget of fetches a second, about 3,000 a second summed over all stores. Every store is paced inside its own budget, backed off when it blocks or fails, and a store in trouble cannot take the fetches of another store.',
      'Alerts: 99% handed to the notification service within 5 minutes of the confirmed change, over 28 days. A reading that falls by more than half or more than doubles the price, and the first price of a new product, count only after a second reading at least a minute later agrees.',
      'At most once per drop: fetches, stream records and jobs can repeat, run late or arrive out of order, and an alert still fires at most once per drop. The hand-off to the notification service is at least once, made harmless by a key of alert and change.',
      'Freshness: 99% of the checks of tier-1 products come within 20 minutes of the previous one, over 28 days.',
      'Tracker API (alerts and charts): 99.9% of requests answered within 300 ms and without a 5xx, over 28 days.',
      'Losing one of three Availability Zones keeps fetching, matching and the API inside their objectives.',
    ],
    outOfScope: [
      'Buying through the service, coupons, and comparing prices across stores.',
      'Delivering notifications. The notification service applies preferences, quiet hours and channels.',
      'Pages that need a browser to run scripts before the price appears, and getting past blocks: a store that blocks is backed off, never evaded.',
      'Currency conversion. A target is in the product’s own currency.',
      'Prices reported by users’ browsers or apps.',
      'Discovering products that nobody has tracked. A product exists once someone adds its link.',
      'More than one Region.',
    ],
  },
  entities: [
    {
      name: 'Product',
      description:
        'productId (a hash of the store id and the store’s item id, so the same item from any link is one item), storeId, storeItemId, canonical link, title, currency, price in cents (the last confirmed one, empty until the first is confirmed), status (listed or unavailable), changeSeq (plus 1 on every confirmed change), changedAt and alertCount.',
    },
    {
      name: 'Schedule entry',
      description:
        'One per product: tier (0 for a pending confirm, then 1, 2 or 3), nextCheckAt, lastCheckedAt (when the last trusted reading was taken), seq (the product’s changeSeq, copied by every change transaction), attempts since that reading, a due key of store, tier and shard, and an optional suspect reading with the time it was seen.',
    },
    {
      name: 'Price change',
      description:
        'productId, observedAt, price and changeSeq. Written only when the confirmed price moves, in the same transaction as the product. Kept five years.',
    },
    {
      name: 'Alert',
      description:
        'Keyed by product and shard (a hash of the user modulo 8) and by user: target in cents, state (armed or met), lastSeq (the change it was last evaluated against), firedSeq, firedPrice and firedAt (the changedAt of the change it fired at) of its last drop, notifiedSeq (the drop the notification service has accepted) and createdAt.',
    },
    {
      name: 'Store',
      description:
        'storeId, budget in fetches a second, how to fetch (API with a key, or page), link rule, extractor version, the page layout fingerprints it knows, backoffLevel and blockedUntil.',
    },
    {
      name: 'Fetch job',
      description:
        'A queue message: productId, storeId, the canonical link, the second of the minute it was paced into and notAfter, 20 seconds after that slot.',
    },
    {
      name: 'Fire job',
      description:
        'A queue message: productId, one alert shard and up to 100 user ids whose alerts a change may have crossed. It carries no price: the worker reads the current one.',
    },
  ],
  api: [
    {
      method: 'POST',
      path: '/alerts',
      description:
        'Body: productUrl, targetPrice. The API normalizes the link with the store’s rule, derives productId and creates the product if it is new. The alert is written in one transaction with the product’s alert count, keyed by user and product, so a retry finds the alert it already made and gets 200 with it; a different target is a 409 and goes through PATCH. Answers 201 with the current price and whether it is already at or below the target.',
    },
    {
      method: 'PATCH',
      path: '/alerts/{productId}',
      description:
        'Body: targetPrice. Changes the target in one transaction checked against the product’s changeSeq and against the alert’s lastSeq and state as read, so it cannot overwrite a fire or re-arm that landed meanwhile, and arms or settles the alert against the current price. Repeating it with the same target changes nothing.',
    },
    {
      method: 'DELETE',
      path: '/alerts/{productId}',
      description:
        'Stops tracking: the alert and the product’s alert count change in one transaction. Repeating it answers 204 again.',
    },
    {
      method: 'GET',
      path: '/alerts',
      description:
        'The user’s alerts, each with the product’s current price and last checked time.',
    },
    {
      method: 'GET',
      path: '/products/{id}/history?range=1y',
      description:
        'The price series for 1m, 1y or 5y, computed from the changes: raw steps up to 3 months, a daily low, high and close for a year, weekly for five years. Cached at the edge for 5 minutes.',
    },
  ],
  dataFlow: [
    'A user adds a link and a target. The link resolves to one shared product, and the alert is stored next to the other alerts of that product, ordered by target.',
    'Every minute the scheduler takes each store’s due products in tier order up to that store’s budget, claims each one with a conditional write, and sends it to the fetch queue with a delay that spreads the store’s fetches over the minute.',
    'A fetcher reads the price from the store’s API or page. The same price only records the check. A new price changes the product, the history and the schedule entry in one transaction. A suspicious one waits for a second reading a minute later.',
    'The products table’s stream carries every committed change to the alert matcher, which reads the alerts the new price may cross and queues jobs for them.',
    'A fire worker applies the product’s current price to each alert with a conditional write. An alert that moves from armed to met is handed to the notification service with the key alert and change.',
    'Charts are computed from the changes, downsampled to the range and cached at the edge for 5 minutes.',
  ],
  highLevel: {
    label: 'Refresh prices within each store’s budget and fire each alert at most once per drop',
    intro:
      'Follow a product from the moment a user tracks it, through a refresh that finds a lower price, to the alert that fires and the chart the user opens. The design grows a piece at a time: priority tiers, a store that blocks a careless crawler, pacing and backoff per store, changes stored in one transaction, a second reading for suspicious prices, matching through an index, an alert state that turns repeats into nothing, an outage of the notification service, a cached chart and a lost zone. From the third stage on, the numbers above the diagram are fetches a second, the p95 of a fetch and the share of fetches that fail. Numbers are illustrative. Press play, or step through the stages.',
    lanes: { top: 'Refreshing prices', bottom: 'Users and alerts' },
    nodes: [
      {
        id: 'queue',
        title: 'Fetch queue',
        detail: 'Paced by delay',
        column: 1,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'fetchers',
        title: 'Fetchers',
        detail: 'Read, parse, compare',
        column: 2,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'stores',
        title: 'Stores',
        detail: 'APIs and pages',
        column: 3,
        row: 'top',
        appearsAt: 2,
      },
      {
        id: 'scheduler',
        title: 'Scheduler',
        detail: 'Budget per store',
        column: 1,
        row: 'middle',
        appearsAt: 1,
      },
      {
        id: 'tables',
        title: 'Price tables',
        detail: 'Products, schedule, history',
        column: 2,
        row: 'middle',
      },
      {
        id: 'matcher',
        title: 'Alert matcher',
        detail: 'Stream, jobs, workers',
        column: 3,
        row: 'middle',
        appearsAt: 6,
      },
      {
        id: 'notify',
        title: 'Notifications',
        detail: 'Separate service',
        column: 4,
        row: 'middle',
        appearsAt: 7,
      },
      { id: 'user', title: 'User', detail: 'App or browser', column: 0, row: 'bottom' },
      { id: 'edge', title: 'Edge', detail: 'CDN, charts 5 min', column: 1, row: 'bottom' },
      { id: 'api', title: 'Tracker API', detail: 'Alerts, charts', column: 2, row: 'bottom' },
      {
        id: 'alerts',
        title: 'Alerts',
        detail: 'By product and target',
        column: 3,
        row: 'bottom',
      },
    ],
    edges: [
      ['user', 'edge'],
      ['edge', 'api'],
      ['api', 'tables', 'read'],
      ['api', 'alerts', 'arm'],
      ['scheduler', 'tables', 'due'],
      ['scheduler', 'queue', 'send'],
      ['queue', 'fetchers'],
      ['fetchers', 'stores', 'GET'],
      ['fetchers', 'tables', 'write'],
      ['tables', 'matcher'],
      ['matcher', 'alerts', 'match'],
      ['matcher', 'notify', 'key'],
    ],
    stages: [
      {
        title: 'Track a product',
        narration:
          'A user pastes a store link and a target of 79.99 for a product at 89.99. Requests reach the Tracker API through the edge. The API applies the store’s link rule, which strips tracking parameters and keeps the item id, and hashes store and item into productId, so a thousand different links to one item land on one product. It reads the product, then writes the alert and adds 1 to the product’s alert count in one transaction that also checks the product has not changed since the read, so the alert starts armed against the price it was compared with.',
        tradeoff:
          'Storing each user’s link as its own item would fetch the same product thousands of times. One product per store item costs a link rule per store, and in exchange each item is fetched once however many people watch it. Keying the alert by user and product makes a repeated request find the alert it already made, so the API needs no separate idempotency table.',
        nodes: ['user', 'edge', 'api', 'tables', 'alerts'],
        travel: [
          ['user', 'edge'],
          ['edge', 'api'],
          ['api', 'tables', 'read'],
          ['api', 'alerts', 'arm'],
        ],
        short: 'Track',
        metrics: {
          users: '2M',
          custom: [
            { label: 'API at peak', value: '700/s' },
            { label: 'Alerts', value: '50M' },
          ],
        },
        load: { edge: 10, api: 15, tables: 10, alerts: 10 },
      },
      {
        title: 'Spend the budget where people look',
        narration:
          'Each product has a tier, set at every check from its alert count. The 1 million products with 20 or more alerts are tier 1, due every 15 minutes; the other 19 million watched ones are tier 2, every 6 hours; the 280 million that nobody watches are tier 3, once a week. That is 96 + 76 + 40 = 212 million fetches a day, about 2,500 a second with retries and confirms. Every minute the scheduler reads each store’s entries due by the end of the minute it is planning, in tier order, from an index on store, tier, shard and due time, and claims each one with a conditional write that moves its due time 10 minutes ahead, a lease for the fetch. When a store has more due than its budget, tier 3 waits, not tier 1.',
        tradeoff:
          'Checking every product on one cycle would give each one a check about every 33 hours, including the ones thousands of people watch. Tiers keep watched prices fresh within the same budget, and the weekly floor costs about 18% of it to keep history useful for anyone who opens an unwatched product. The claim stops two passes from fetching one product twice: only one conditional write can move a given due time, and a claim whose fetch never happens simply runs out.',
        nodes: ['scheduler', 'tables'],
        travel: [['scheduler', 'tables', 'due']],
        short: 'Priority',
        metrics: {
          users: '2M',
          custom: [
            { label: 'Planned fetches', value: '2,500/s' },
            { label: 'Weekly floor', value: '18%' },
          ],
        },
        load: { scheduler: 30, tables: 30 },
      },
      {
        title: 'One store blocks the fetchers',
        narration:
          'In this first version the scheduler sends everything due to one queue at once, fetchers take it as fast as they can and write each result back. The largest store, about 35% of all fetches, receives its whole minute, about 52,500 requests, in the first seconds of every minute. It answers with 429s and challenge pages, then stops answering. Each hung request holds a fetcher connection for a 30-second timeout, the 18,000 connections of the fleet fill within seconds, and the products of every other store wait behind them.',
        tradeoff:
          'One queue drained as fast as possible is the simplest way to hand out work, and it treats every store alike. Stores do not: each tolerates only so many requests a second, a burst above that turns a busy store into a blocked one, and a long timeout lets one store that hangs hold the connections every other store needs.',
        nodes: ['scheduler', 'queue', 'fetchers', 'stores'],
        travel: [
          ['scheduler', 'queue', 'send'],
          ['queue', 'fetchers'],
          ['fetchers', 'stores', 'GET'],
        ],
        short: 'Store blocks',
        metrics: {
          users: '2M',
          requestsPerSecond: '2.5K',
          p95Latency: '8 s',
          errorRate: '25%',
          alerts: ['p95Latency', 'errorRate'],
          custom: [{ label: 'Connections held', value: '18,000', alert: true }],
        },
        load: { scheduler: 30, queue: 90, fetchers: 100, stores: 100 },
        traffic: [
          { edge: ['queue', 'fetchers'], kind: 'heavy' },
          { edge: ['fetchers', 'stores'], kind: 'failed' },
        ],
      },
      {
        title: 'Pace every store inside its budget',
        narration:
          'Now the scheduler claims at most a store’s budget for each minute, 1,000 a second for the largest store through its API, and sends every claimed product with a delay that places it in its own second of the minute: the pass for a minute starts 30 seconds before it, and each job’s delay is its slot’s time minus the time it is sent, so the store sees an even rate. The pass takes entries due by the end of that minute, never puts a job in a slot earlier than its nextCheckAt, and claims only entries that get a slot inside the minute; the rest wait for the next pass. A fetcher deletes without fetching a job it receives more than 20 seconds after its slot, and the claim brings the product back. Every request has a 5-second limit. A 429, a 403, a challenge page, or half of 20 fetches in a row failing on one task puts the store in backoff with a conditional write on its record: 1 minute, then 2, 4 and so on up to 60. Then the scheduler sends it one probe after each wait, sent again a minute later if it is lost; a refused probe doubles the wait.',
        tradeoff:
          'Pacing at the scheduler needs no shared rate limiter on the fetch path, at the price of unused budget when a store has few due products. The 5-second limit bounds what one store can hold in steady state: its requests arrive at most at its budget, so it ties up at most 5 seconds of that budget, and every store doing so at once is 3,000 × 5 = 15,000 of 18,000 connections. A per-task cap on every request in flight to a store keeps the bound for one store in a catch-up burst too: a store that hangs holds at most about 5 seconds of its budget or 3 requests per task, whichever is larger, in steady state and in a catch-up burst; the largest at most about 5,000 of 18,000 connections, so one store in trouble cannot take the others’ connections. Backing off and never routing around a block keeps the design inside each store’s terms; the store’s prices go stale meanwhile, and the app shows when each was last checked.',
        nodes: ['scheduler', 'queue', 'fetchers', 'stores'],
        travel: [
          ['scheduler', 'queue', 'send'],
          ['queue', 'fetchers'],
          ['fetchers', 'stores', 'GET'],
        ],
        short: 'Pace stores',
        metrics: {
          users: '2M',
          requestsPerSecond: '2.5K',
          p95Latency: '700 ms',
          errorRate: '2%',
          custom: [
            { label: 'Store budgets', value: '3,000/s' },
            { label: 'Backoff at most', value: '60 min' },
          ],
        },
        load: { scheduler: 30, queue: 35, fetchers: 56, stores: 84 },
      },
      {
        title: 'Store only changes, in one transaction',
        narration:
          'The fetcher reads the product and its schedule entry with one strongly consistent BatchGetItem over the two tables, not an isolated snapshot, which is harmless because every write it makes is conditional, and compares prices. The same price, about 95% of checks, is one conditional write that records the check and the next due time, applied only if no later check was recorded first and the entry’s seq still equals the changeSeq the fetcher read, so a stale reading cannot vouch for a price that has since changed; if that seq check fails, the fetcher rereads the product and judges its reading again, which may now commit it as a change. A new price is one transaction: set the product’s price and add 1 to changeSeq, only if changeSeq is still the one read; write the history row keyed by product and observation time; record the check. If another fetch committed first, the transaction fails and the fetcher reads again.',
        tradeoff:
          'Storing every reading would multiply history by about 20 for prices that stay flat for weeks. Writing a confirmed change and its history row in the same transaction keeps history small and complete: there is no second write to lose and no relay to run. The cost is that the price at a time t means the last change before t, and how often a product was checked is not in the history.',
        nodes: ['fetchers', 'tables'],
        travel: [['fetchers', 'tables', 'write']],
        short: 'Store changes',
        metrics: {
          users: '2M',
          requestsPerSecond: '2.5K',
          p95Latency: '700 ms',
          errorRate: '2%',
          custom: [{ label: 'Changes', value: '123/s' }],
        },
        load: { fetchers: 56, tables: 52 },
      },
      {
        title: 'Confirm a suspicious reading',
        narration:
          'A reading of 8.99 for a product at 89.99 is more than half off, so it is a suspect. The fetcher stores it on the schedule entry and sets the entry to tier 0, due in 60 seconds, which puts it at the head of the store’s order in a following pass. The next reading at least a minute later decides: the same 8.99 commits the change, 89.99 drops the suspect as a glitch, and any other price is judged on its own. A price more than double the current one, and a new product’s first price, are suspects too; a suspect with no reading to confirm it lapses after an hour. A reading from a page layout that the store’s extractor does not know is never committed at all.',
        tradeoff:
          'Alerting on the first reading is a minute faster, and one parsing slip would then send thousands of people to a product that is not on sale. The confirm costs one fetch out of the store’s budget and one to two minutes, on large moves only. It cannot catch a mistake the store itself shows for longer than a minute: that price is real on the store, and it is announced.',
        nodes: ['fetchers', 'stores', 'tables', 'scheduler'],
        travel: [
          ['fetchers', 'stores', 'GET'],
          ['fetchers', 'tables', 'write'],
          ['scheduler', 'tables', 'due'],
        ],
        short: 'Confirm',
        metrics: {
          users: '2M',
          requestsPerSecond: '2.5K',
          p95Latency: '700 ms',
          errorRate: '2%',
          custom: [{ label: 'Confirm fetches', value: '~6/s' }],
        },
        load: { fetchers: 56, tables: 52, scheduler: 30, stores: 84 },
      },
      {
        title: 'Match a change through an index',
        narration:
          'The products table’s stream holds every committed change in order per product for 24 hours. The alert matcher, a function reading it, acts only on records where changeSeq moved. For a new price P it reads, on each of the product’s 8 alert shards, the armed alerts with a target of at least P and the met alerts with a target below P ÷ 1.05, through an index whose sort key is state then target, so each read returns only alerts in that state, with strongly consistent reads. It puts their user ids, 100 to a job, on a queue for the fire workers.',
        tradeoff:
          'Scanning all alerts of a product on every change would read 100,000 rows for a cent of movement on the most watched one. The index costs two index writes per change of target or state, because both are in its sort key, and makes each match read only the alerts the change can affect. Strongly consistent reads are why it is a local index: an alert committed before the change is always found, at the cost of keeping each product shard’s items in one partition, under one partition’s write limit, which is why there are 8 shards; the 10 GB limit per shard is far above the few megabytes one holds.',
        nodes: ['tables', 'matcher', 'alerts'],
        travel: [
          ['tables', 'matcher'],
          ['matcher', 'alerts', 'match'],
        ],
        short: 'Match',
        metrics: {
          users: '2M',
          requestsPerSecond: '2.5K',
          p95Latency: '700 ms',
          errorRate: '2%',
          custom: [
            { label: 'Match queries', value: '~2,000/s' },
            { label: 'Matcher lag', value: '~1 s' },
          ],
        },
        load: { tables: 52, matcher: 20, alerts: 10 },
      },
      {
        title: 'Fire at most once per drop, then re-arm',
        narration:
          'A fire worker reads the product’s current price and changeSeq, here 79.99 at 42, and applies it to each alert of its job with one conditional write: armed with a target of at least 79.99 becomes met with firedSeq 42, only if lastSeq is below 42. It then reads the product again; had changeSeq moved, it would apply the newer price to the same alerts before going on. It hands the alert to the notification service with the key alert plus 42, then records notifiedSeq 42. A repeated job finds lastSeq at 42 and changes nothing; one that finds an alert met but not yet notified hands it off again under the same key while the price is still at or below the target, and the notification service drops the repeat. When the price later climbs more than 5% above the target, the same kind of write sets the alert back to armed.',
        tradeoff:
          'Firing on every matching change would message the same user each time the price wobbles by a cent. The state on the alert costs three or four writes per drop and gives one alert per drop. Using the current price rather than the price in the record makes late and reordered jobs harmless, and means a drop that is over before its job runs is not announced: users are told only about prices still on the store.',
        nodes: ['matcher', 'alerts', 'notify'],
        travel: [
          ['matcher', 'alerts', 'match'],
          ['matcher', 'notify', 'key'],
        ],
        short: 'Fire once',
        metrics: {
          users: '2M',
          requestsPerSecond: '2.5K',
          p95Latency: '700 ms',
          errorRate: '2%',
          custom: [
            { label: 'Hand-offs', value: '2M/day' },
            { label: 'Change to hand-off', value: '~20 s' },
          ],
        },
        load: { matcher: 30, alerts: 15, notify: 20 },
      },
      {
        title: 'The notification service goes down',
        narration:
          'The notification service answers 503 for 40 minutes. Fetching, matching and the alert state go on: alerts still move to met, and only the hand-offs fail. A worker takes one job at a time and, before any call, sets the job’s visibility to its next retry delay: 30 seconds, doubling up to 15 minutes. Each call has a 1-second limit and the job stops at its first failed hand-off, so a service that hangs cannot run the worker into its timeout before the delay is set. A job tries about 100 times over about 24 hours before it moves to a dead-letter queue, and at most 10 workers run at once whatever the backlog. When the service is back, each job finds its alerts met but not notified and hands off those whose price is still at or below the target, under the same keys; a drop that ended meanwhile is settled without a call, and the alert arms again in the normal way after a rise of more than 5%.',
        tradeoff:
          'Treating a failed hand-off as a failed alert would turn one outage into missing alerts; holding the job keeps the drop and costs a late notification. The backoff and the cap of 10 workers keep the retries from becoming the load that keeps the service down. A job older than a day goes to a dead-letter queue that someone redrives within about 13 days, since a dead-letter message keeps its first enqueue time and is deleted 14 days after it; that is inside the 30 days the notification service keeps its keys, so even a redrive does not repeat a notification.',
        nodes: ['matcher', 'alerts', 'notify'],
        travel: [
          ['matcher', 'alerts', 'match'],
          ['matcher', 'notify', 'key'],
        ],
        short: 'Notify down',
        metrics: {
          users: '2M',
          requestsPerSecond: '2.5K',
          p95Latency: '700 ms',
          errorRate: '2%',
          custom: [
            { label: 'Hand-off errors', value: '100%', alert: true },
            { label: 'Retry at most', value: '15 min' },
          ],
        },
        load: { matcher: 40, alerts: 15, notify: 0 },
        traffic: [{ edge: ['matcher', 'notify'], kind: 'failed' }],
      },
      {
        title: 'Serve the chart from the edge',
        narration:
          'Opening a product shows its chart. The API reads the changes in the range plus the last one before it, and turns them into at most a few hundred points: the raw steps up to 3 months, a daily low, high and close for a year, weekly for five years. The answer carries a 5-minute cache lifetime, and the edge, with one shield cache in the Region in front of the API, serves the other requests for that product and range from its cache.',
        tradeoff:
          'Returning every change for a five-year chart sends far more points than a screen can draw, and computing the points at read time costs a read of up to a few hundred kilobytes instead of a rollup job to run. The cache costs freshness: a chart can be 5 minutes behind the price, while the alert list shows the current one. When a deal spreads, a million views of one chart become a few reads of the table every 5 minutes.',
        nodes: ['user', 'edge', 'api', 'tables'],
        travel: [
          ['user', 'edge'],
          ['edge', 'api'],
          ['api', 'tables', 'read'],
        ],
        short: 'Chart cache',
        metrics: {
          users: '2M',
          requestsPerSecond: '2.5K',
          p95Latency: '700 ms',
          errorRate: '2%',
          custom: [
            { label: 'Chart hits at edge', value: '80%' },
            { label: 'API p95', value: '120 ms' },
          ],
        },
        load: { edge: 20, api: 30, tables: 52 },
      },
      {
        title: 'A zone goes down',
        narration:
          'An Availability Zone is lost. 15 of the 45 fetcher tasks go with it; the 30 left run at about 83% of their CPU and hold 12,000 connections, room for the usual 1,000 in flight and for the largest store hanging. One of 3 API tasks goes, and 2 carry the 530 requests a second that reach the load balancer at peak. If the scheduler’s task was in that zone, the container service starts it in another within a couple of minutes, inside the 5 minutes of slack that tier 1 has. The tables, queues, stream and functions are regional and keep going.',
        tradeoff:
          '45 fetcher tasks where 28 would do is the price of losing a zone without late fetches, and the same margin covers a deploy: fetchers and API start new tasks before they stop old ones. One scheduler task keeps each store’s budget a single count and costs a gap of a couple of minutes when it restarts or is deployed; two at once would need a shared count per store to stay inside budgets.',
        nodes: ['scheduler', 'queue', 'fetchers', 'stores', 'api', 'tables'],
        travel: [
          ['queue', 'fetchers'],
          ['fetchers', 'stores', 'GET'],
          ['fetchers', 'tables', 'write'],
        ],
        short: 'Lose a zone',
        metrics: {
          users: '2M',
          requestsPerSecond: '2.5K',
          p95Latency: '750 ms',
          errorRate: '2%',
          healthy: '30 / 45',
          alerts: ['healthy'],
          custom: [{ label: 'Fetcher CPU', value: '83%' }],
        },
        load: { scheduler: 30, queue: 35, fetchers: 83, stores: 84, api: 45, tables: 52 },
      },
    ],
  },
  flows: [
    {
      id: 'track',
      title: 'A user tracks a product and sets a target',
      kind: 'sync',
      summary:
        'Ana tracks a pair of headphones at 89.99 with a target of 79.99. The link resolves to the product that 120 other users already track, and the alert is created armed in one transaction with the product’s alert count.',
      runsOn:
        'Amazon CloudFront with AWS WAF → Application Load Balancer → Tracker API on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'app', label: 'App', service: 'Phone or browser' },
        { id: 'edge', label: 'Edge', service: 'CloudFront with AWS WAF' },
        { id: 'api', label: 'Tracker API', service: 'ALB + ECS Fargate' },
        { id: 'products', label: 'Products', service: 'DynamoDB' },
        { id: 'alerts', label: 'Alerts', service: 'DynamoDB' },
        { id: 'sched', label: 'Schedule', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'edge',
          label: 'POST /alerts {productUrl, targetPrice: 79.99}',
          note: 'With the user’s session token. The edge never caches this route, and a rate rule per user and address in the firewall limits floods of links.',
        },
        {
          from: 'edge',
          to: 'api',
          label: 'forward to the load balancer',
          note: 'The API has its own load balancer, so its errors and latency are measured apart from anything else.',
        },
        {
          from: 'api',
          to: 'api',
          label: 'store rule: strip parameters, keep item id; productId = hash(s12, item)',
          note: 'A link to a store without a rule, or one the rule cannot read an item id from, gets a 422. The API never fetches the link itself, so a user cannot make the service call an address of their choosing.',
        },
        {
          from: 'api',
          to: 'products',
          label: 'GetItem p7 ConsistentRead',
          note: 'It exists: price 89.99, changeSeq 41. Had it not, the transaction below would also put the product and a schedule entry due now, each under a condition that it does not exist yet, so two users adding a new item at once create it one time.',
        },
        {
          from: 'api',
          to: 'alerts',
          label:
            'TransactWriteItems: Put alert (p7#3, u9) armed, lastSeq 41 IF not exists; Update p7 ADD alertCount 1 IF changeSeq = 41',
          note: 'Shard 3 is u9’s hash modulo 8. 89.99 is above 79.99, so the alert starts armed. If a change commits between the read and this write, the condition fails and the API reads again, so an alert is never armed against a price that is already gone.',
        },
        {
          from: 'api',
          to: 'sched',
          label: 'UpdateItem p7 SET nextCheckAt = now IF tier = 3',
          note: 'Only for a product nobody watched, whose next check could be a week away. Best effort: if it is lost, the weekly check comes anyway and sets the new tier.',
          style: 'async',
        },
        {
          from: 'api',
          to: 'app',
          label: '201 {alert, price: 89.99, checked 6 min ago, atOrBelowTarget: false}',
          note: 'A retry of the same request fails the condition on the alert, reads it, finds the same target and gets 200 with the same alert. Had the price already been at or below 79.99, the alert would start met, with no notification, and the answer would say so.',
          style: 'reply',
        },
      ],
    },
    {
      id: 'refresh',
      title:
        'The scheduler picks due products and a fetcher refreshes one within its store’s budget',
      kind: 'scheduled',
      summary:
        'In the 12:00 pass the scheduler claims store s12’s due products in tier order, up to its budget of 40 a second, and paces them over the minute. A fetcher reads p7 in its slot and finds the price unchanged.',
      runsOn:
        'Scheduler on ECS Fargate → DynamoDB due index → Amazon SQS → fetcher on ECS Fargate → store API → Amazon DynamoDB',
      participants: [
        { id: 'scheduler', label: 'Scheduler', service: 'ECS Fargate, one task' },
        { id: 'sched', label: 'Schedule', service: 'DynamoDB + due index' },
        { id: 'queue', label: 'Fetch queue', service: 'Amazon SQS' },
        { id: 'fetcher', label: 'Fetcher', service: 'ECS Fargate' },
        { id: 'store', label: 'Store s12', service: 'Product API' },
        { id: 'products', label: 'Products', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'scheduler',
          to: 'sched',
          label: 'Query due index s12#0, then s12#1, #2, #3: nextCheckAt ≤ 12:00:59, up to 2,400',
          note: 'At 11:59:30, for the 12:00 minute: entries due by its end, tier 0 first, then 1, 2 and 3, and at most 40 a second × 60. Each job gets a slot no earlier than its own nextCheckAt, and an entry that gets no slot inside the minute is left unclaimed for the next pass; p7 was due at 12:00:37. The index is eventually consistent, which only means that some entries it returns were claimed a moment ago.',
        },
        {
          from: 'scheduler',
          to: 'sched',
          label:
            'UpdateItem p7 SET nextCheckAt = now + 10 min, attempts + 1 IF nextCheckAt = :read',
          note: 'The claim. A pass spreads its claims over its 30-second lead, so write peaks are about 1.5 times the average, inside the warmed levels and the per-partition limit. Only one write can move this due time, so no two passes claim p7 for it; a job the queue delivers twice costs one extra fetch, and its result write fails if a newer check or change was recorded first. If the job is lost, p7 is due again in 10 minutes; after 3 claims without a result the scheduler parks it until its next normal check.',
        },
        {
          from: 'scheduler',
          to: 'queue',
          label: 'SendMessageBatch at 11:59:30: p7 with DelaySeconds 67, notAfter 12:00:57',
          note: 'The 12:00 pass starts at 11:59:30, and p7’s slot is second 37 of 12:00, so its delay is the slot minus the send time, 67 seconds, inside SQS’s 15-minute limit. With 40 jobs in each second, the store sees an even 40 a second. The batch call reports each entry, and failed entries are sent again.',
        },
        {
          from: 'queue',
          to: 'fetcher',
          label: 'receive p7 at 12:00:37',
          note: 'Visibility 30 seconds. The fetcher checks notAfter and the store’s record, which it rereads every 10 seconds: a job past its time, or for a store in backoff, is deleted without a fetch.',
        },
        {
          from: 'fetcher',
          to: 'store',
          label: 'GET product API with the store’s key, 5 s limit',
          note: 'The user agent names the service. Store keys come from Secrets Manager.',
        },
        {
          from: 'store',
          to: 'fetcher',
          label: '200 {price: 89.99}',
          note: 'Parsed by the store’s extractor, version 14, which also checks the answer has the shape it expects.',
          style: 'reply',
        },
        {
          from: 'fetcher',
          to: 'products',
          label: 'BatchGetItem p7 product and schedule, ConsistentRead',
          note: 'Price 89.99, unchanged, and 121 alerts, so p7 stays tier 1.',
        },
        {
          from: 'fetcher',
          to: 'sched',
          label:
            'UpdateItem p7 SET lastCheckedAt = 12:00:37, nextCheckAt = 12:15:37, attempts = 0 IF lastCheckedAt < 12:00:37 AND seq = 41',
          note: 'The condition keeps a slower, older reading from overwriting this one, and the seq check keeps a reading taken before a change from recording itself after it; if it fails, the fetcher rereads and judges the reading again, which may now commit it as a change. Then the fetcher deletes the job.',
        },
      ],
    },
    {
      id: 'change',
      title: 'A price change is stored and matched to the alerts it crosses',
      kind: 'async',
      summary:
        'p7 drops from 89.99 to 79.99. The fetcher commits product, history and schedule in one transaction; the stream hands the change to the matcher, which finds the 96 armed alerts at 79.99 or above and queues one job per shard for them.',
      runsOn:
        'Fetcher on ECS Fargate → Amazon DynamoDB → DynamoDB Streams → AWS Lambda matcher → DynamoDB local index → Amazon SQS',
      participants: [
        { id: 'fetcher', label: 'Fetcher', service: 'ECS Fargate' },
        { id: 'tables', label: 'Price tables', service: 'DynamoDB' },
        { id: 'stream', label: 'Change stream', service: 'DynamoDB Streams' },
        { id: 'matcher', label: 'Alert matcher', service: 'AWS Lambda' },
        { id: 'alerts', label: 'Alerts', service: 'DynamoDB, local index' },
        { id: 'fire', label: 'Fire queue', service: 'Amazon SQS' },
      ],
      steps: [
        {
          from: 'fetcher',
          to: 'tables',
          label:
            'TransactWriteItems: p7 price 79.99, changeSeq 42 IF changeSeq = 41; Put history (p7, 12:15:41); schedule p7 checked, seq = 42',
          note: '11% down: not a suspect. All three writes or none, at twice the cost, only for the 5% of checks that see a change. The schedule part carries the same condition on lastCheckedAt as an unchanged check.',
        },
        {
          from: 'tables',
          to: 'stream',
          label: 'MODIFY p7, old and new images',
          note: 'In order per product and kept 24 hours. The commit is in the stream whatever happens to the fetcher next, so there is no publish step to lose.',
          style: 'async',
        },
        {
          from: 'stream',
          to: 'matcher',
          label: 'batch of up to 100 records',
          note: 'One invocation per shard at a time. Records where changeSeq did not move, such as an alert count, are skipped.',
          style: 'async',
        },
        {
          from: 'matcher',
          to: 'alerts',
          label:
            'Query p7#0..p7#7 on byTarget: armed#000000007999 and above; met# up to met#000000007618; ConsistentRead',
          note: '16 small queries, 2 per shard. 7618 is the largest target in cents with 7618 × 105 < 7999 × 100, so the price is more than 5% above it. 96 of p7’s 121 alerts are armed with a target of 79.99 or more, and none are waiting to re-arm.',
        },
        {
          from: 'matcher',
          to: 'fire',
          label: 'SendMessageBatch: 8 jobs, one per shard, about 12 user ids each',
          note: 'Each job names p7 and one shard. A matcher that fails before it finishes is invoked again on the same records, and the repeated jobs are harmless.',
        },
        {
          from: 'matcher',
          to: 'matcher',
          label: 'one record of the batch throws on every try: skip and count',
          note: 'Retried twice inside the function, then written with its productId and changeSeq to the skipped-changes queue, and the batch goes on. Only one record per batch may be skipped: if two or more throw, the whole batch fails and the shard waits, so a bad deploy shows up as iterator age, not as quiet skips. Throttling and timeouts are never skipped either.',
        },
      ],
    },
    {
      id: 'glitch',
      title: 'A suspected glitch is checked by a second fetch before anyone is told',
      kind: 'async',
      summary:
        'A page read shows 8.99 for a product at 89.99. The reading waits on the schedule entry, the product comes back at the head of its store’s order a minute later, the second reading says 89.99, and the 8.99 is dropped.',
      runsOn:
        'Fetcher on ECS Fargate → store page → Amazon DynamoDB schedule → scheduler on ECS Fargate → Amazon CloudWatch',
      participants: [
        { id: 'fetcher', label: 'Fetcher', service: 'ECS Fargate' },
        { id: 'store', label: 'Store s5', service: 'Product page' },
        { id: 'sched', label: 'Schedule', service: 'DynamoDB' },
        { id: 'scheduler', label: 'Scheduler', service: 'ECS Fargate' },
        { id: 'cw', label: 'Metrics', service: 'CloudWatch' },
      ],
      steps: [
        {
          from: 'fetcher',
          to: 'store',
          label: 'GET page p3, 12:04:10',
          note: 'A page store with extractor version 9. The layout fingerprint of the answer is one the store’s record knows, so the reading can count.',
        },
        {
          from: 'store',
          to: 'fetcher',
          label: '200: price 8.99',
          note: 'The product is at 89.99: more than half off.',
          style: 'reply',
        },
        {
          from: 'fetcher',
          to: 'sched',
          label:
            'UpdateItem p3 SET suspect = {8.99, 12:04:10}, tier = 0, nextCheckAt = 12:05:10 IF lastCheckedAt < 12:04:10',
          note: 'The product and its history are not touched, so nothing downstream sees 8.99. lastCheckedAt stays where it was: a suspect is not a trusted reading.',
        },
        {
          from: 'scheduler',
          to: 'sched',
          label: 'claim p3 in the 12:05 pass at 12:04:30, slot no earlier than 12:05:10',
          note: 'The pass takes entries due by 12:05:59. Tier 0 is read before the store’s other tiers and counts against the same budget, and the slot is never earlier than the due time, so the confirm comes at least 60 seconds after the suspect.',
        },
        {
          from: 'fetcher',
          to: 'store',
          label: 'GET page p3 again, 12:05:31',
          note: 'More than a minute after the suspect, which is the rule: two readings that close could both come from one bad cached page.',
        },
        {
          from: 'store',
          to: 'fetcher',
          label: '200: price 89.99',
          note: 'The current price, not the suspect.',
          style: 'reply',
        },
        {
          from: 'fetcher',
          to: 'sched',
          label:
            'UpdateItem p3 REMOVE suspect SET tier = 1, lastCheckedAt = 12:05:31, nextCheckAt …',
          note: 'The 8.99 was a glitch. Had this reading said 8.99 again, the fetcher would have committed the change with the transaction of the previous flow, and the alerts would have fired then.',
        },
        {
          from: 'fetcher',
          to: 'cw',
          label: 'GlitchesDropped + 1',
          note: 'Logged with the store. Many glitches at one store usually mean its page changed.',
          style: 'async',
        },
      ],
    },
    {
      id: 'handoff',
      title: 'An alert fires at most once per drop and is handed off under one key',
      kind: 'queue',
      summary:
        'A fire worker moves u9’s alert from armed to met at change 42 and hands it off under the key alert plus 42. The same job comes back after a crash, and nothing is sent twice.',
      runsOn:
        'Amazon SQS → AWS Lambda fire worker → Amazon DynamoDB → notification service internal API',
      participants: [
        { id: 'fire', label: 'Fire queue', service: 'Amazon SQS' },
        { id: 'worker', label: 'Fire worker', service: 'AWS Lambda' },
        { id: 'products', label: 'Products', service: 'DynamoDB' },
        { id: 'alerts', label: 'Alerts', service: 'DynamoDB' },
        { id: 'notify', label: 'Notification service', service: 'Internal API' },
      ],
      steps: [
        {
          from: 'fire',
          to: 'worker',
          label: 'job {p7, shard 3, 12 user ids}',
          note: 'One job per invocation and at most 10 workers at once. Before any call the worker sets the job’s visibility to its next retry delay, 30 seconds on a first try, doubling to 15 minutes, so a timeout or crash returns it on that schedule.',
        },
        {
          from: 'worker',
          to: 'products',
          label: 'GetItem p7 ConsistentRead',
          note: 'Price 79.99 at changeSeq 42, whatever change caused the job. A job that runs late uses the price on the store now.',
        },
        {
          from: 'worker',
          to: 'alerts',
          label:
            'UpdateItem (p7#3, u9) SET state = met, firedSeq = 42, firedPrice = 79.99, firedAt = 12:15:41, lastSeq = 42 IF state = armed AND target ≥ 79.99 AND lastSeq < 42',
          note: 'With ReturnValuesOnConditionCheckFailure ALL_OLD, a failed condition returns the item, so the worker sees why without a second read.',
        },
        {
          from: 'worker',
          to: 'products',
          label: 'GetItem p7 ConsistentRead again: still changeSeq 42',
          note: 'A change committed between the first read and the alert writes may have been matched before those writes, and then no job would bring it here. So the worker reads the product again after writing: if changeSeq moved, it applies the new price to the same alerts, up to 3 rounds, and then returns the job to the queue. Only when the price holds still does it hand off.',
        },
        {
          from: 'worker',
          to: 'notify',
          label: 'POST /notifications {u9, price-drop, idempotencyKey: p7:u9#42}',
          note: 'The price-drop template is in the activity category. Preferences, quiet hours and the channel are the notification service’s decisions.',
        },
        {
          from: 'notify',
          to: 'worker',
          label: '202 {notificationId}',
          note: 'That service derives the notification id from our key and keeps it 30 days, so a repeat of this call has no effect.',
          style: 'reply',
        },
        {
          from: 'worker',
          to: 'alerts',
          label:
            'UpdateItem SET notifiedSeq = 42 IF firedSeq = 42 AND (attribute_not_exists(notifiedSeq) OR notifiedSeq < 42)',
          note: 'Only when this write succeeds does the worker count the hand-off in OnTimeHandoffs, so of two copies of a job racing here only one succeeds and counts, and a repeat after a crash is counted once. Then the job is deleted.',
        },
        {
          from: 'fire',
          to: 'worker',
          label: 'the same job again, after a crash before the delete',
          note: 'The alert write fails: lastSeq is 42. The returned item shows met with notifiedSeq 42, so nothing is sent. Had the crash come before notifiedSeq was written, the worker would call again with the same key, provided the price it just read is still at or below the target, and the notification service would drop the repeat; had the price been back above the target, it would settle the drop without a call and leave the alert met until a rise of more than 5% arms it.',
        },
      ],
    },
    {
      id: 'rearm',
      title: 'The price climbs back and the alert arms again',
      kind: 'async',
      summary:
        'p7 rises to 84.99 at change 43, more than 5% above u9’s target of 79.99, so the alert arms again without a notification. The next drop to 79.99 or below is a new drop.',
      runsOn:
        'Amazon DynamoDB Streams → AWS Lambda matcher → Amazon SQS → AWS Lambda fire worker → Amazon DynamoDB',
      participants: [
        { id: 'stream', label: 'Change stream', service: 'DynamoDB Streams' },
        { id: 'matcher', label: 'Alert matcher', service: 'AWS Lambda' },
        { id: 'alerts', label: 'Alerts', service: 'DynamoDB' },
        { id: 'fire', label: 'Fire queue', service: 'Amazon SQS' },
        { id: 'worker', label: 'Fire worker', service: 'AWS Lambda' },
      ],
      steps: [
        {
          from: 'stream',
          to: 'matcher',
          label: 'MODIFY p7: 79.99 → 84.99, changeSeq 43',
          note: 'A rise, not a suspect: under double.',
          style: 'async',
        },
        {
          from: 'matcher',
          to: 'alerts',
          label: 'Query byTarget: met# up to met#000000008094; armed#000000008499 and above',
          note: '8094 is the largest target in cents with 8094 × 105 < 8499 × 100. u9’s 79.99 is below it. An alert at 82 stays met, because 84.99 is less than 5% above 82, so a price that wobbles around a target does not fire it again and again.',
        },
        {
          from: 'matcher',
          to: 'fire',
          label: 'jobs for the met alerts found',
          note: 'Same queue and workers as a drop.',
        },
        {
          from: 'fire',
          to: 'worker',
          label: 'job {p7, shard 3, …u9…}',
          note: 'The worker reads p7’s current price first, 84.99 at 43.',
        },
        {
          from: 'worker',
          to: 'alerts',
          label:
            'UpdateItem (p7#3, u9) SET state = armed, lastSeq = 43 IF state = met AND target ≤ 80.94 AND lastSeq < 43',
          note: 'Re-arming sends nothing. A late copy of an old drop job now finds lastSeq 43 and changes nothing.',
        },
      ],
    },
    {
      id: 'block',
      title: 'A store blocks the fetchers and is backed off',
      kind: 'async',
      summary:
        'Store s5 answers 429 with Retry-After 120. One conditional write puts it in backoff, fetchers drop its jobs without fetching, the scheduler sends it nothing for 2 minutes, then one probe, which succeeds and restores its budget.',
      runsOn:
        'Fetchers on ECS Fargate → store → Amazon DynamoDB stores table → scheduler on ECS Fargate → Amazon SQS → Amazon CloudWatch',
      participants: [
        { id: 'fetcher', label: 'Fetchers', service: 'ECS Fargate' },
        { id: 'store', label: 'Store s5', service: 'Product pages' },
        { id: 'stores', label: 'Stores table', service: 'DynamoDB' },
        { id: 'scheduler', label: 'Scheduler', service: 'ECS Fargate' },
        { id: 'queue', label: 'Fetch queue', service: 'Amazon SQS' },
        { id: 'cw', label: 'Metrics', service: 'CloudWatch' },
      ],
      steps: [
        {
          from: 'fetcher',
          to: 'store',
          label: 'GET page p11',
          note: 'Paced like every other job of s5.',
        },
        {
          from: 'store',
          to: 'fetcher',
          label: '429 Retry-After: 120',
          note: 'A 403 or a challenge page is treated the same, and so is half of 20 fetches in a row failing with timeouts or 5xx on one task.',
          style: 'reply',
        },
        {
          from: 'fetcher',
          to: 'stores',
          label:
            'UpdateItem s5 SET backoffLevel = 1, blockedUntil = now + 2 min IF backoffLevel = 0',
          note: 'The wait is the larger of 2^(level − 1) minutes and Retry-After, at most 60 minutes. Dozens of tasks see 429s at the same moment; the first write wins and the others find s5 already in backoff. A repeat block raises the level with SET backoffLevel = :read + 1, blockedUntil = … IF backoffLevel = :read AND blockedUntil < now, so many tasks cannot raise it several times at once.',
        },
        {
          from: 'fetcher',
          to: 'fetcher',
          label: 'jobs for s5 in hand: delete without a fetch',
          note: 'A task marks s5 blocked at once on its own 429 and learns the others’ from the stores table within 10 seconds. The claims bring those products back after 10 minutes.',
        },
        {
          from: 'scheduler',
          to: 'stores',
          label: 'next passes: s5 in backoff, claim nothing for it',
          note: 'Every other store keeps its full budget. Each task caps the requests in flight to s5, so a store that hangs holds at most about 5 seconds of its budget or 3 requests per task, whichever is larger, in steady state and in a catch-up burst; the largest at most about 5,000 of 18,000 connections, so one store in trouble cannot take the others’ connections.',
        },
        {
          from: 'scheduler',
          to: 'queue',
          label: 'after blockedUntil: one probe job',
          note: 'The highest-priority due product of s5. A probe that is lost is simply sent again the next minute.',
        },
        {
          from: 'fetcher',
          to: 'stores',
          label: 'probe 200: full budget again, backoffLevel kept',
          note: 'Full budget from the next pass, and tier 1 catches up first. The level is kept and counts from 0 again only once the last block is more than 30 minutes old, so a store that accepts one probe and blocks again waits twice as long. A refused probe raises the level and doubles the wait instead.',
        },
        {
          from: 'scheduler',
          to: 'cw',
          label: 'BlockedBudgetPct',
          note: 'The share of all store budgets that belongs to stores now in backoff, published every minute.',
          style: 'async',
        },
      ],
    },
    {
      id: 'chart',
      title: 'Reading the price history chart',
      kind: 'sync',
      summary:
        'Ana opens p7’s one-year chart. The edge misses, the API reads a year of changes and returns 365 daily points with a 5-minute lifetime, and the next viewers are served by the edge.',
      runsOn:
        'Amazon CloudFront with Origin Shield → ALB → Tracker API on ECS Fargate → Amazon DynamoDB',
      participants: [
        { id: 'app', label: 'App', service: 'Phone or browser' },
        { id: 'edge', label: 'Edge', service: 'CloudFront + Origin Shield' },
        { id: 'api', label: 'Tracker API', service: 'ALB + ECS Fargate' },
        { id: 'history', label: 'Price history', service: 'DynamoDB' },
      ],
      steps: [
        {
          from: 'app',
          to: 'edge',
          label: 'GET /products/p7/history?range=1y',
          note: 'The cache key is the path and the range. The answer is the same for every user, so it can be shared.',
        },
        {
          from: 'edge',
          to: 'api',
          label: 'miss at the edge location and at the shield',
          note: 'The shield is one regional cache in front of the API, so edge locations around the world ask it and not the API.',
        },
        {
          from: 'api',
          to: 'history',
          label:
            'Query p7, observedAt in the last year; Query observedAt < start, descending, Limit 1',
          note: 'Eventually consistent reads. A tier-1 product changes a few times a day, so a year is under 2,000 rows and about 100 KB.',
        },
        {
          from: 'api',
          to: 'api',
          label: 'daily low, high and close for 365 days',
          note: 'Each day starts at the last change before it, so a day without changes is a flat line, not a missing point.',
        },
        {
          from: 'api',
          to: 'edge',
          label: '200, Cache-Control: max-age=300',
          note: 'About 10 KB of points.',
          style: 'reply',
        },
        {
          from: 'edge',
          to: 'app',
          label: '200, served from cache for 5 minutes',
          note: 'Other viewers of this chart in that time are answered by the edge. The chart can be up to 5 minutes behind the current price.',
          style: 'reply',
        },
      ],
    },
  ],
  deepDives: [
    {
      question: 'How do we keep prices fresh with a limited crawl budget?',
      options: [
        {
          name: 'Round robin over every product',
          pros: 'Simple and fair; every product is checked eventually.',
          cons: '300 million products at 2,500 fetches a second means each one waits about 33 hours, including the ones thousands of people watch.',
        },
        {
          name: 'Priority by demand and volatility',
          pros: 'Watched and fast-moving products get most of the budget; the long tail still gets a floor.',
          cons: 'Needs signals kept up to date, and a quiet product that suddenly drops is caught late.',
        },
        {
          name: 'Prices reported by users’ browsers',
          pros: 'Free, fresh readings for exactly the products people are viewing.',
          cons: 'Untrusted input: it must be validated and confirmed before it can trigger alerts, and it covers only what people happen to view.',
        },
      ],
      choice:
        'Priority tiers from the alert count, set at every check: tier 1 (20 or more alerts) every 15 minutes, tier 2 (any alert) every 6 hours, tier 3 weekly, plus tier 0 for pending confirms. 1M × 96 + 19M × 4 + 280M ÷ 7 = 212 million a day. Within a store the scheduler serves tiers in order up to that store’s budget, so a store with more due than budget delays its weekly checks first and its tier-1 checks last. Demand alone puts the budget where users are; volatility would refine the intervals and is left for later, and browser reports are out of scope.',
    },
    {
      question:
        'How is each store’s budget enforced, and what happens when a store blocks or fails?',
      options: [
        {
          name: 'One queue, drained as fast as fetchers can',
          pros: 'No per-store logic at all.',
          cons: 'A large store gets its whole minute in a burst, blocks, and its hung requests hold the connections every other store needs.',
        },
        {
          name: 'A queue and a worker pool per store',
          pros: 'Complete isolation, and each pool’s size is its store’s rate.',
          cons: '5,000 queues and pools, most of them idle, and capacity that cannot move to the store that needs it.',
        },
        {
          name: 'A shared token bucket per store, checked before each fetch',
          pros: 'An exact rate whatever the fetchers do.',
          cons: 'A store on the path of every fetch: its outage stops all fetching, and its latency is added to each one.',
        },
        {
          name: 'Pace at the scheduler with message delays, plus timeouts and backoff',
          pros: 'No new component on the fetch path. The store sees an even rate, and a failing store is cut off by one write on its record.',
          cons: 'Fetchers that catch up after a stall can send up to 20 seconds of a store’s budget at once, and the rate depends on one scheduler task.',
        },
      ],
      choice:
        'Pacing at the scheduler. Each minute it claims at most 60 × the store’s budget among the entries due by the end of that minute, gives each a slot no earlier than its nextCheckAt, claims only those that get a slot inside the minute, and sends each job with DelaySeconds equal to its slot’s time minus the send time, the pass starting 30 seconds before its minute, so each job lands in its own second. A job received more than 20 seconds after its slot is deleted unfetched, so a backlog never turns into a burst of more than 20 seconds of budget; a healthy store can still receive that burst faster than its budget. Every request has a 5-second limit, so in steady state every store hanging at once would hold 3,000 × 5 = 15,000 of 18,000 connections. What protects the others from one store that hangs, in a burst too, is a cap per task on every request in flight to that store, max(3, ceil(budget × 5 s ÷ running tasks)), with a job over the cap deleted unfetched for its claim to bring back: a store that hangs holds at most about 5 seconds of its budget or 3 requests per task, whichever is larger, in steady state and in a catch-up burst; the largest at most about 5,000 of 18,000 connections, so one store in trouble cannot take the others’ connections. The cap limits connections held by a store that hangs, not the rate to a store that answers: a healthy store has budget × latency ÷ tasks in flight per task, about 9 for the largest at 0.4 s against a cap of 112; a slow store near the 5-second limit, above all a small one with a single-digit cap, can lose a share of its jobs to the cap, and they come back with their claims and count as late. A task receives from the queue only while it has free connections, and a job of a store already at its cap is deleted unfetched, so in a catch-up burst a healthy large store may also lose some jobs past its cap; they return with their claims. A block or a run of failures sets backoffLevel and blockedUntil with a conditional write, waits of 1, 2, 4 up to 60 minutes or Retry-After if longer, with one probe after each wait; a refused probe doubles the wait. A store is never retried through other addresses: a block is the store’s answer.',
    },
    {
      question: 'How does a product get fetched once per due time without a lock?',
      options: [
        {
          name: 'A lock per product with a time to live',
          pros: 'Familiar.',
          cons: 'A second write to take and release on every fetch, and a lock that expires while its fetch is still running lets two fetches overlap anyway.',
        },
        {
          name: 'A scheduler that remembers in memory what it handed out',
          pros: 'No writes at all for bookkeeping.',
          cons: 'A restart forgets everything: products are fetched twice or forgotten until someone notices.',
        },
        {
          name: 'A conditional claim that moves the due time ahead',
          pros: 'One write is both the claim and the retry timer: if the fetch never happens, the product is simply due again.',
          cons: 'A write and two index writes per claim, and a lost job costs up to 10 minutes of lateness.',
        },
      ],
      choice:
        'The claim: SET nextCheckAt = now + 10 min, attempts + 1 IF nextCheckAt is the value read, so of any number of passes reading a stale index one wins. The fetch result is written only if no later check was recorded (lastCheckedAt < its observation time), and a change only if changeSeq is still the one read, so a slow fetch that loses the race is discarded rather than applied over a newer one. A same-price write also requires the schedule entry’s seq to equal the changeSeq read; if that fails, the fetcher rereads and judges its reading again, which may now commit a change. A failed fetch sets the product due again in 2 minutes, and attempts keeps counting. A product claimed 3 times without a result, such as a page that crashes the extractor, is parked until its next normal interval, which bounds a poison page to 3 fetches per interval.',
    },
    {
      question: 'How do we match a price change to millions of alerts?',
      options: [
        {
          name: 'Scan all alerts for the product',
          pros: 'No extra structure; fine for products with a handful of watchers.',
          cons: 'The most watched product reads 100,000 rows for every cent of movement.',
        },
        {
          name: 'Index by product and target price',
          pros: 'One range read returns exactly the alerts the new price reaches.',
          cons: 'A store-wide sale still produces a large burst of matches that must be paced downstream.',
        },
        {
          name: 'Keep the highest target per product on the product',
          pros: 'Most changes skip the alerts table entirely, since the price is still above every target.',
          cons: 'The value must be kept current as alerts are added, changed and removed.',
        },
      ],
      choice:
        'An index by product and target: a local secondary index on the alerts table, read with strongly consistent queries, with a sort key of state then target, so a query reads only the alerts in the state it asks for, over 8 shards per product so that the most watched product’s 100,000 alerts spread their writes over 8 item collections, each stored in one partition. The highest-target shortcut is not worth its upkeep: 123 changes a second at 16 small queries each is about 2,000 queries a second, most of them empty. A new alert cannot slip between a change and its match: the alert’s transaction checks the product’s changeSeq, so an alert committed after a change was compared with that change, and one committed before is seen by the matcher’s consistent query.',
    },
    {
      question: 'How do we avoid false and duplicate alerts?',
      options: [
        {
          name: 'Alert on every matching reading',
          pros: 'Fastest possible alert.',
          cons: 'One bad parse sends a wave of wrong alerts, and a price that wobbles sends many.',
        },
        {
          name: 'Confirm suspicious drops with a second fetch',
          pros: 'Catches parsing errors and short glitches before anyone is told.',
          cons: 'Adds a minute and a fetch for large moves, and a deliberate one-minute sale can be missed.',
        },
        {
          name: 'Remember the last fired price per alert',
          pros: 'One alert per real drop, plus a key that makes replays harmless.',
          cons: 'A write on every notification, and rules for when an alert re-arms.',
        },
      ],
      choice:
        'Both of the last two: confirm moves of more than half down or more than double up, and every first price, with a second reading at least a minute later; and keep the state on each alert, firing at most once per drop under the key alert plus changeSeq. An alert that has fired fires again only after a confirmed price more than 5% above its target re-arms it, so neither a staircase of small cuts nor a wobble around the target repeats a notification.',
    },
    {
      question:
        'How does an alert fire at most once per drop when jobs repeat, run late or arrive out of order?',
      options: [
        {
          name: 'Apply the price carried by each record, in arrival order',
          pros: 'Simple, and each record says exactly what changed.',
          cons: 'Jobs on a standard queue arrive in any order: an old drop applied after a rise fires for a price that is gone and leaves the alert met while the price is above target.',
        },
        {
          name: 'A lock per alert while a worker decides',
          pros: 'Serializes the decisions for one alert.',
          cons: 'Locks that expire under a slow worker serialize nothing, and a hundred thousand alerts per drop means a hundred thousand locks.',
        },
        {
          name: 'Apply the current price with a write conditional on lastSeq',
          pros: 'Any number of copies of any job, in any order, leave the alert as the latest price says, once the worker’s second read of the product finds no newer change.',
          cons: 'A product read per job, and a drop that is over before its job runs is not announced.',
        },
      ],
      choice:
        'The current price with a condition. A worker reads the product’s price and changeSeq S, then writes armed to met only if lastSeq < S and the target is at least the price, or met to armed only if lastSeq < S and the price is more than 5% above the target, compared in whole cents as target × 105 < price × 100. After writing it reads the product again: a change committed between its read and its writes may have been matched before the writes and queued nothing for them, so if changeSeq moved it applies the newer price to the same alerts, up to 3 rounds, and then returns the job to the queue. The hand-off key is alert plus firedSeq; notifiedSeq records the 202. A job that finds an alert met with notifiedSeq behind firedSeq hands it off again under the same key while the current price is still at or below the target, so a crash anywhere between the write and the delete ends in one notification; if the price is back above the target, the worker settles it without a call: one write sets notifiedSeq to firedSeq, only if firedSeq is unchanged and notifiedSeq is absent or lower, and the drop counts as not handed off. The alert stays met and arms again in the normal way, after a price more than 5% above the target, so a wobble around the target still cannot notify twice. Before any call the worker sets the job’s visibility to its next retry delay, 30 seconds doubling to 15 minutes; each call has a 1-second limit and the job stops at its first failure, so the delay holds even when the service hangs: about 100 tries over 24 hours, then the dead-letter queue.',
    },
    {
      question: 'How is a glitch told apart from a real drop?',
      options: [
        {
          name: 'Trust every reading',
          pros: 'Nothing to build, and the fastest alerts.',
          cons: 'A parser that reads the shipping cost as the price sends everyone a false deal.',
        },
        {
          name: 'Reject readings far from the product’s history',
          pros: 'No extra fetch.',
          cons: 'Real sales are exactly the readings far from history, so it rejects the alerts the product exists for.',
        },
        {
          name: 'A second reading a minute later for large moves, and a layout check on every page',
          pros: 'A transient glitch does not survive two readings, and a broken extractor is stopped before it reads a wrong number.',
          cons: 'One extra fetch and one to two minutes for large moves, and a mistake the store itself shows for longer is still announced.',
        },
      ],
      choice:
        'Two checks. The extractor fingerprints the page around the price (which elements matched, and the structure near them), and a reading from a fingerprint the store’s record does not know is never committed. A move of more than half down or more than double up, and a first price, is held as a suspect on the schedule entry, due again in 60 seconds at tier 0; the next reading at least a minute later commits it if it matches to the cent, drops it if it equals the current price, and is judged afresh otherwise. A suspect with no reading in an hour lapses.',
    },
    {
      question: 'How is history stored, and how are long charts drawn?',
      options: [
        {
          name: 'Every reading in a time-series store',
          pros: 'Shows how often each product was checked, and supports any query over time.',
          cons: 'About 20 times the rows for prices that stay flat, and a second store to run.',
        },
        {
          name: 'Changes only, downsampled when the chart is read',
          pros: 'Small, written in the same transaction as the product, and a year of the busiest product is about 100 KB.',
          cons: 'Gaps in checking are invisible, and a long chart is computed on every cache miss.',
        },
        {
          name: 'Changes plus precomputed daily and weekly rollups',
          pros: 'Long charts read a few hundred precomputed rows.',
          cons: 'A rollup job to run and repair, for reads the edge cache already makes rare.',
        },
      ],
      choice:
        'Changes only, in a table keyed by product and observation time, five years kept. The API reads the range plus the last change before it, returns raw steps up to 3 months, daily low, high and close for a year and weekly for five years, and sets a 5-minute cache lifetime that the edge honours. Rollups become worth it if chart reads stop fitting behind the cache, or if a single product changes so often that a five-year read passes a megabyte.',
    },
    {
      question: 'What happens when a store changes its page layout?',
      options: [
        {
          name: 'Keep the selectors and trust what they return',
          pros: 'Nothing changes until someone notices.',
          cons: 'A selector that now matches the wrong element returns a plausible wrong price, and the confirm reads the same wrong price a minute later.',
        },
        {
          name: 'Fingerprint the layout and stop committing on an unknown one',
          pros: 'A broken extractor produces no prices rather than wrong ones, and the failure shows up per store.',
          cons: 'Every price of that store goes stale until an engineer approves the new layout or ships a new extractor.',
        },
        {
          name: 'A learned extractor that adapts to new layouts',
          pros: 'Fewer manual fixes.',
          cons: 'Its mistakes are plausible numbers, which is the failure this system can least afford.',
        },
      ],
      choice:
        'Fingerprints, plus a preference for stores’ APIs, whose answers are checked against the shape the extractor expects. An unknown layout counts as a parse failure; each fetcher task publishes the worst parse failure rate among stores with at least 50 fetches on that task in 10 minutes, and an alarm opens a ticket above 20%. The fix is a new extractor version or an approved fingerprint in the store’s record, which fetchers pick up within 10 seconds; products resume at their next check.',
    },
    {
      question: 'How is the same product added by many users kept as one?',
      options: [
        {
          name: 'One product per link as pasted',
          pros: 'No parsing at all.',
          cons: 'Tracking parameters, mobile links and regional domains make a thousand products of one item, fetched a thousand times.',
        },
        {
          name: 'The normalized link as the key',
          pros: 'Removes most tracking parameters with generic rules.',
          cons: 'Two very different paths can still name the same item, and generic rules can drop the parameter that picks a size or colour.',
        },
        {
          name: 'A rule per store that extracts the store’s item id, hashed into productId',
          pros: 'One product per item and variant, found without a lookup, created under a condition that it does not exist.',
          cons: 'A rule to write and keep for every store, and links the rule cannot read are refused.',
        },
      ],
      choice:
        'The store rule and a derived id: productId = hash(storeId, storeItemId), where the item id includes the variant when the store has one. Creation is a Put under a condition that the product does not exist, in the same transaction as the first alert, so two users adding a new item at once create one product and two alerts. Alerts on a new product start armed with no price; its first confirmed price at or below a target fires them, which tells users what they could not see when they added the link. The API never fetches a pasted link: it only parses it, which also means a user cannot point the service at an address of their choosing.',
    },
  ],
  wrapUp:
    'Resolve every link to one product through a store rule. Refresh by tiers inside each store’s budget, paced with message delays and backed off on blocks, with each fetch claimed by a conditional write. Store only confirmed changes, in one transaction with the product, and hold a suspicious reading for a second fetch. Let the products table’s stream drive matching through an index on product and target, and apply the current price to each alert with a write conditional on its last change, so it fires at most once per drop and is handed to the notification service at least once under a key of alert and change.',
  guarantees: {
    provides: [
      {
        property: 'Tracking',
        promise:
          'A 201 or 200 means the alert is committed together with the product’s alert count, in one transaction checked against the product’s changeSeq. A user has one alert per product, so a retry returns the existing alert. The same store item from any link is one product, created under a condition that it does not exist.',
      },
      {
        property: 'Fetch ownership',
        promise:
          'A product is claimed once per due time, by whoever wins the claim, a conditional write that moves its due time 10 minutes ahead. A standard queue can still deliver its job twice, which costs a fetch; the second result is written only if no newer check or change was recorded, because every result write is conditional on lastCheckedAt and on the changeSeq it read. A lost job brings it back after those 10 minutes; a product claimed 3 times without a result is parked until its next normal check.',
      },
      {
        property: 'Politeness',
        promise:
          'While one scheduler task runs, a store is sent at most its budget in each minute, spread over the minute, and a backlog adds at most 20 seconds of that budget in a burst. A store that blocks or fails gets nothing but one probe after each wait, and a refused probe doubles the wait, from 1 up to 60 minutes. Each fetcher task also caps every request in flight to a store at max(3, ceil(budget × 5 s ÷ running tasks)), with the running count read from the ECS service every 10 seconds along with the store records, keeping the last value if that read fails or is throttled, so after a zone recovers a task’s cap can stay at its 30-task value for a while, still under the fleet’s 18,000: 112 for the largest store at 45 tasks, 167 at 30 and 90 at 56 during a deploy. A healthy store stays far under it, about 9 in flight per task for the largest at 0.4 s, and the floor of 3 makes deleting a healthy small store’s job negligible; a job that would exceed the cap is deleted unfetched for its claim to bring back. So a store that hangs holds at most about 5 seconds of its budget or 3 requests per task, whichever is larger, in steady state and in a catch-up burst; the largest at most about 5,000 of 18,000 connections, so one store in trouble cannot take the others’ connections. In steady state, with each request limited to 5 seconds, every store hanging at once would hold about 15,000 of 18,000.',
      },
      {
        property: 'Price state',
        promise:
          'A product’s price changes only by a transaction conditional on the changeSeq that was read, which adds 1, so its prices have one ordered history; a reading older than the last recorded check is never applied. Every committed change has its history row, written in the same transaction.',
      },
      {
        property: 'Confirmation',
        promise:
          'A move of more than half down or more than double up, and the first price of a product, counts only after a second reading at least 60 seconds later gives the same price. A reading from a page layout the store’s record does not know never counts.',
      },
      {
        property: 'Matching',
        promise:
          'Every committed change is read from the stream in order per product, and its jobs reach every alert whose target it crosses, including an alert created a moment before it. A change that lands while a worker is writing an alert is picked up by the worker’s second read of the product. Records and jobs are delivered at least once, made harmless by lastSeq on the alert.',
      },
      {
        property: 'Firing',
        promise:
          'An alert moves from armed to met at most once per drop, by a conditional write, and is handed to the notification service at least once while its price is still at or below the target, made harmless by the key alert plus changeSeq, which that service keeps 30 days. It arms again only after a confirmed price more than 5% above its target; a pending hand-off whose price is already back above the target is settled without a call and the alert stays met until then.',
      },
      {
        property: 'Freshness',
        promise:
          'Over 28 days, 99% of tier-1 checks come within 20 minutes of the previous one, measured by the scheduler at each claim’s assigned slot time, with the tier-1 products of stores in backoff counted as late, and someone is paged before that budget is spent.',
      },
      {
        property: 'Charts',
        promise:
          'A chart is computed from the committed changes and is at most 5 minutes behind them.',
      },
    ],
    assumes: [
      'DynamoDB applies a conditional write or a transaction atomically, and its stream holds every committed write once, in order per item, for 24 hours.',
      'A strongly consistent query of a local secondary index returns every item committed before the query started.',
      'The notification service has no second effect for a repeated idempotency key within 30 days.',
      'Fetcher clocks agree within a second. Observation times only order readings of one product, which are normally minutes apart.',
      'Each store’s link rule finds the item id, and an item id names one product and variant for as long as the store keeps it.',
      'Only one scheduler task runs at a time: its service is deployed with at most 100% and at least 0% of its one task.',
      'Store budgets are set at or below what each store allows or has agreed to.',
    ],
    doesNotGuarantee: [
      'Fresh prices from a store in backoff. Its products keep their last price and last checked time until a probe succeeds, and the app shows that time.',
      'Seeing a drop shorter than the product’s check interval: at most every 15 minutes for tier 1, every 6 hours for tier 2, once a week for tier 3.',
      'Announcing a drop that is over before its job runs. The worker uses the current price, so a price that came back up within seconds is not announced.',
      'Catching a wrong price that the store itself shows for more than a minute. Two readings agree, and the alert fires.',
      'That a store honours a price we announce.',
      'Budgets during an overlap of two scheduler tasks, which the deployment settings prevent but a task the container service has lost contact with could cause. Each product is still claimed once; a store could see up to twice its budget until one task stops, and its own 429s would back it off.',
      'Alerts for a change the matcher skipped as poison. Its alerts are evaluated again at the product’s next change, or when someone replays the skipped-changes queue. A bug that throws on every record still skips the records of single-record batches until the rollback; Matcher behind pages within minutes, because batches of more records stall, and the skipped records are replayed from that queue.',
      'A notification for a drop that ended while its hand-off waited, for example during an outage of the notification service. The worker settles it without a call, the alert stays met until a rise of more than 5% arms it, and the hand-off objective counts it as late.',
      'A second drop when the price rises more than 5% above the target and falls back below it before the re-arm job runs. The worker sees only the current price, finds the alert met, and that second drop is not announced.',
      'An early check after the first alert on an unwatched product. The pull forward is best effort; if it is lost, the weekly check sets the new tier.',
      'Charts newer than 5 minutes, or the readings between changes: how often a product was checked is not in its history.',
      'Delivery to the user. The notification service may suppress a notification, hold it for quiet hours or fail it after we hand it over.',
      'Parse-failure alarms for small stores. The rollup counts only stores with at least 50 fetches in 10 minutes on a task.',
      'Every fetch of a slow store. A store answering near the 5-second limit, above all a small one with a single-digit cap, can lose a share of its jobs to the per-task cap; they come back with their claims and count as late.',
      'Fetching during the loss of a second zone. 15 tasks hold about 60% of the CPU the load needs (30 of about 50 vCPU), so jobs expire and products run late until tasks are added.',
    ],
  },
  failures: [
    {
      scenario: 'A fetcher crashes after it fetched a price and before it wrote the result.',
      impact:
        'The job becomes visible again after 30 seconds, past its 20-second window, and the next fetcher deletes it without a fetch. The product is not fetched in this pass.',
      detection:
        'ECS task stops, and ExpiredFetches from the fetchers. Nothing user-facing for one task.',
      recovery:
        'The claim ends after 10 minutes and the product is claimed and fetched again, with one more attempt counted. ECS starts a replacement task, which needs no state.',
    },
    {
      scenario: 'The scheduler dies between claims and sends, or is replaced by a deploy.',
      impact:
        'Claimed products are not fetched, and nothing new is scheduled until a new task runs, about a couple of minutes. Fetchers drain the queue and idle.',
      detection:
        'Prices stale, through its clause on NumberOfMessagesSent on the fetch queue, which drops toward zero within a minute; the scheduler’s own counts go missing too.',
      recovery:
        'The new task starts with the next minute’s pass. Products whose jobs were lost come back when their claims end, within 10 minutes; tier 1 has 5 minutes of slack before it counts as late, so the pass’s claimed tier-1 products are late until their claims end, spending some freshness budget.',
    },
    {
      scenario: 'A large store starts answering 429s and challenge pages.',
      impact:
        'That store’s prices stop updating. No other store loses fetches: their budgets are their own, and, because each task caps the requests in flight to one store, a store that hangs holds at most about 5 seconds of its budget or 3 requests per task, whichever is larger, in steady state and in a catch-up burst; the largest at most about 5,000 of 18,000 connections, so one store in trouble cannot take the others’ connections.',
      detection:
        'Store blocked from BlockedBudgetPct; the late tier-1 share in Prices stale rises with the store’s tier-1 products.',
      recovery:
        'Automatic: waits of 1 to 60 minutes, one probe after each wait, and a refused probe doubles the wait. Tier 1 catches up first; a long block leaves hours of weekly checks behind, drained with the store’s spare budget. A store that blocks for a day is a conversation with that store, not a setting to raise.',
    },
    {
      scenario: 'A store changes its page layout.',
      impact:
        'Every reading of that store has an unknown fingerprint and is not committed, so its prices go stale. No wrong price reaches an alert.',
      detection:
        'Store parser broken, from the worst parse failure rate among stores with enough fetches; glitch counts per store in the logs.',
      recovery:
        'An engineer approves the fingerprint or ships a new extractor version; fetchers read the store record within 10 seconds, and products resume at their next check. An unknown layout is recorded as a check that is not trusted: attempts goes back to 0 and the next check keeps its interval, so nothing is parked, while lastCheckedAt stays old and the products count as late.',
    },
    {
      scenario: 'A page crashes the extractor, or makes it spin, on every read.',
      impact:
        'Each claim of that product ends without a result, and nothing is written. Extraction runs with its own 2-second limit, so a spinning extractor costs one slot for 2 seconds, not a task.',
      detection: 'Extractor errors and the parked count in the fetcher metrics.',
      recovery:
        'After 3 claims without a result the scheduler parks the product until its next normal check, so the page costs at most 3 fetches per interval. A fix to the extractor ends it.',
    },
    {
      scenario: 'The notification service is down for 40 minutes.',
      impact:
        'Alerts still move to met; their hand-offs fail and wait. Fetching and matching are unaffected. Users are told late.',
      detection:
        'Handoffs failing from the workers’ own counts within minutes; Hand-offs late as the delayed hand-offs finally succeed.',
      recovery:
        'Jobs retry after 30 seconds doubling to 15 minutes, at most 10 workers at once; when the service answers, each job hands off its met and not-notified alerts under the same keys, settling without a call the drops whose price has gone back above the target; those alerts arm again after a rise of more than 5%. Jobs that reach 100 tries, about 24 hours, sit in the dead-letter queue, where they are deleted 14 days after their first enqueue, so someone has about 13 days to redrive them.',
    },
    {
      scenario: 'A fire worker dies after it moved an alert to met and before the hand-off.',
      impact:
        'Until the job returns, after the retry delay the worker set when it started, 30 seconds on a first try, the alert is met and nobody is told.',
      detection: 'Lambda Errors; nothing user-facing beyond the delay.',
      recovery:
        'The job returns, the alert write fails on lastSeq, the returned item shows notifiedSeq behind firedSeq, and the worker hands it off under the same key.',
    },
    {
      scenario: 'A stream record makes the matcher throw on every try.',
      impact:
        'That one change is skipped after two tries inside the function; its alerts keep their state until the product’s next change. Other records go on. A bug that makes every record throw fails every batch with more than one record, so the shard waits instead.',
      detection:
        'Work parked: a ticket for any skipped change, a page when more than 5 arrive in 5 minutes.',
      recovery:
        'Fix the bug, then replay the queue: each message names a product, and a replay runs the matcher’s queries for it against its current price. The product’s next change repairs it anyway.',
    },
    {
      scenario: 'The matcher stops processing for hours, after a bad deploy.',
      impact:
        'Changes wait in the stream and alerts are late. Records that stay unprocessed for 24 hours leave the stream.',
      detection: 'Matcher behind from IteratorAge within minutes; Hand-offs late soon after.',
      recovery:
        'Roll back; the matcher drains the stream in order and repeats nothing harmful. Records that expired reach the skipped-changes queue as batch metadata, and the products they named are found from changedAt in an export of the products table and replayed.',
    },
    {
      scenario: 'The schedule table or its due index throttles.',
      impact:
        'Claims and check writes slow down, because a throttled index throttles writes to its table, and products run late. Nothing is lost: an unwritten claim leaves the product due, an unwritten check is retried by the SDK and then by the claim ending.',
      detection: 'Schedule throttled from WriteThrottleEvents on the table and on the index.',
      recovery:
        'Raise the warm throughput of the table or the index; check that no store’s due shard is hotter than 100 fetches a second.',
    },
    {
      scenario: 'The most watched product, with 100,000 alerts, drops below most of their targets.',
      impact:
        'About 1,000 jobs, which the matcher sends interleaved across the 8 shards so the workers spread their writes evenly. Their writes spread over 8 shards, about 500 a second on each, and hand-offs run at about 1,000 a second, so the last alert is handed off about 100 seconds after the change.',
      detection: 'Fire backlog stays under its threshold; Hand-offs late does not move.',
      recovery:
        'None needed. The cap of 10 workers is what keeps this burst polite to the notification service.',
    },
    {
      scenario: 'An Availability Zone is lost.',
      impact:
        '15 of 45 fetchers and 1 of 3 API tasks go. 30 fetchers run at about 83% of CPU; 2 API tasks carry the peak. If the scheduler was there, scheduling pauses for a couple of minutes.',
      detection:
        'ECS RunningTaskCount, HealthyHostCount on the API target group, and NAT gateway metrics in that zone.',
      recovery:
        'ECS launches replacements in the healthy zones. DynamoDB, SQS, Lambda and CloudFront are regional or global and keep going.',
    },
  ],
  capacity: {
    assumptions: [
      '300 million products from about 5,000 stores. 1 million have 20 or more alerts, 19 million have at least one, 280 million have none.',
      '50 million alerts from 20 million users, 2 million of them active a day, about 10 requests each.',
      'About 5% of checks see a price change; 2% of changes are suspects. 300,000 new products a day.',
      '2% of fetches fail and are retried once 2 minutes later.',
      'About 2 million alerts fire a day and as many re-arm. About 1 million alerts are created and 1 million removed a day, about 23 a second together. The most watched product has 100,000 alerts.',
      'Planning figures, to confirm with a load test: 20 ms of CPU to parse an answer, 400 ms for a fetch on average and 700 ms at p95, 60 KB per answer, 400 connections per fetcher task of 2 vCPU, 400 requests a second per API task, about 50 ms per call to the notification service and about 80 ms for a fire job of one alert.',
      'The largest store, through its API, is 35% of all fetches with a budget of 1,000 a second; store budgets sum to 3,000 a second.',
      'About 30% of API requests are charts, and the edge serves 80% of those.',
    ],
    estimates: [
      {
        label: 'Scheduled fetches',
        value: '212 million a day',
        math: '1M × 96 (every 15 min) + 19M × 4 (every 6 h) + 280M ÷ 7 = 96M + 76M + 40M = 212M.',
      },
      {
        label: 'All fetches',
        value: 'about 2,500 a second, 84% of store budgets',
        math: 'Retries 2% × 212M ≈ 4.2M; first fetches and confirms of new products 2 × 300,000 = 0.6M; confirms of suspects 2% × 10.6M ≈ 0.2M. 217M ÷ 86,400 ≈ 2,510/s, against 3,000/s of budgets.',
      },
      {
        label: 'Round robin instead',
        value: 'a check about every 33 hours',
        math: '300M ÷ 2,500/s = 120,000 s ≈ 33 h.',
      },
      {
        label: 'Weekly floor',
        value: 'about 18% of fetches',
        math: '40M ÷ 217M ≈ 18%.',
      },
      {
        label: 'Largest store',
        value: '875 a second, 52,500 a minute',
        math: '35% × 2,500 = 875/s; × 60 = 52,500, inside its 1,000/s budget.',
      },
      {
        label: 'Price changes',
        value: '10.6 million a day, 123 a second',
        math: '5% × 212M = 10.6M; ÷ 86,400 ≈ 123/s.',
      },
      {
        label: 'Fetcher fleet',
        value: '45 tasks, 56% of CPU; 30 tasks after a zone, 83%',
        math: '2,510 × 20 ms ≈ 50 vCPU. 45 × 2 = 90 vCPU → 56%; 30 × 2 = 60 → 83%; 28 tasks would run at 90%.',
      },
      {
        label: 'Connections',
        value: 'about 1,000 in flight; 15,000 if every store hangs',
        math: '2,510/s × 0.4 s ≈ 1,000. Every store hanging: 3,000/s × 5 s = 15,000, under 45 × 400 = 18,000. After a zone, 12,000.',
      },
      {
        label: 'Schedule table writes',
        value: 'about 5,150 a second, plus about 10,050 on the due index',
        math: 'Claims 2,510 + checks 2,510 + 123 more for the transactions’ double cost ≈ 5,150. Every claim and check moves nextCheckAt, the index sort key, which is 2 index writes: 4 × 2,510 ≈ 10,050. Warmed to 10,000 and 20,000 writes a second, under the default 40,000 per table and per index.',
      },
      {
        label: 'Reads for fetches',
        value: 'about 2,510 strongly consistent reads a second on each of products and schedule',
        math: 'One BatchGetItem of two items under 4 KB per fetch, 1 read unit each; under the 12,000 reads a second a new on-demand table starts with.',
      },
      {
        label: 'Products and history writes',
        value: 'about 300 and 250 a second',
        math: 'Changes 123 × 2 (transaction) ≈ 246 on each; alert creates and deletes, about 23/s, × 2 ≈ 48 more on products.',
      },
      {
        label: 'Alerts table writes',
        value: 'about 300 a second',
        math: 'Creates and deletes, about 23/s, × 3 (base, local index, user index) × 2 (transaction) ≈ 144; fires 23/s × 4 (alert, 2 index writes as the sort key moves, notifiedSeq) ≈ 92; re-arms 23/s × 3 ≈ 69.',
      },
      {
        label: 'Match queries',
        value: 'about 2,000 a second',
        math: '123 changes × 8 shards × 2 queries ≈ 1,970, nearly all returning nothing.',
      },
      {
        label: 'Most watched product drops',
        value: 'about 1,000 jobs and 100 seconds of hand-offs',
        math: '100,000 ÷ 100 = 1,000 jobs, sent interleaved across the shards. 12,500 alerts per shard × 4 writes over 100 s = 500/s per shard, under a partition’s 1,000. Hand-offs: 10 workers × 5 calls at a time × 20 a second ≈ 1,000/s.',
      },
      {
        label: 'Hand-offs',
        value: '2 million a day, 23 a second on average',
        math: '2M ÷ 86,400 ≈ 23/s; bursts at up to about 1,000/s.',
      },
      {
        label: 'Fire jobs',
        value: 'about 46 a second, 10 workers clear about 125',
        math: 'Most jobs carry one alert: 23 fires + 23 re-arms ≈ 46 jobs/s. A one-alert job is about 80 ms (a read, a write, a second read, a 50 ms call, a write): 10 workers ÷ 0.08 s ≈ 125 jobs/s. After a 40-minute outage about 23 × 2,400 ≈ 55,000 jobs wait; each returns within its delay, at most 15 minutes, and the spare 125 − 46 ≈ 79 jobs/s clear them in about 12 minutes of work, so the backlog is gone about 15 minutes after recovery.',
      },
      {
        label: 'Retry span of a hand-off',
        value: 'about 24 hours in 100 tries',
        math: '30 + 60 + 120 + 240 + 480 = 930 s for the first 5, then 95 × 900 s = 85,500 s; ≈ 86,400 s.',
      },
      {
        label: 'Storage',
        value: 'about 120 GB of products, 90 GB of schedule, 0.5 TB of history a year',
        math: 'Products 300M × 400 B = 120 GB. Schedule 300M × 150 B = 45 GB, and about as much in its index. History 10.6M × 365 ≈ 3.9 billion rows × 120 B with overhead ≈ 465 GB a year.',
      },
      {
        label: 'Tracker API',
        value: '700 a second at the edge at peak, 530 at the load balancer; 3 tasks',
        math: '2M × 10 = 20M a day ≈ 231/s; peak × 3 ≈ 700/s. Charts 6M, 80% from the edge: 4.8M fewer ≈ 15.2M ≈ 176/s, peak ≈ 530/s. 530 ÷ 400 → 2 tasks; 3 cover a zone.',
      },
      {
        label: 'Egress through NAT gateways',
        value: 'about 1.2 Gbps',
        math: '2,510 × 60 KB ≈ 150 MB/s ≈ 1.2 Gbps, about 0.4 Gbps per zone, under the 5 Gbps a NAT gateway starts at.',
      },
      {
        label: 'Error budgets over 28 days',
        value: 'API 0.1%; hand-offs 1% late; tier-1 checks 1% late',
        math: '40,320 minutes in 28 days. 0.5% of hand-offs or checks over any 6 hours is half the budget.',
      },
    ],
    implications: [
      'Fetching is the load and the stores own its limit: 2,500 fetches a second against 530 API requests. A choice that saves a fetch (one product per item, tiers, changes only) is worth more than one that saves a server.',
      'The schedule’s due index takes four writes per fetch and is the largest DynamoDB load. Each store’s due entries are spread over one shard per 100 fetches a second of that store, so no index partition passes about 400 writes a second.',
      'Changes are rare, about 5% of checks, so a transaction’s double cost, the stream and 2,000 mostly empty match queries a second are cheap, and matching needs no shortcut.',
      'Alerts burst per product, not in total: 8 shards per product keep the most watched one under a partition’s write limit, and the cap of 10 workers keeps a burst near 1,000 hand-offs a second, or about 125 one-alert jobs a second against about 46 arriving.',
      'The fleet is 45 fetchers where 28 would do and 3 API tasks where 2 would, so a zone can go. Deploys start new tasks before stopping old ones: fetchers at least 100% and at most 125% of 45, which starts 11 new tasks at a time, and the API at most 200%. A fetcher is ready as soon as its container runs, because it loads no state, so the deploy never lowers capacity.',
      'The scheduler is one task, deployed at most 100% and at least 0%: a deploy or a restart leaves a gap of a couple of minutes, inside tier 1’s 5 minutes of slack, and two tasks never run at once from a deploy.',
    ],
  },
  infrastructure: {
    provider: 'AWS',
    intro:
      'One concrete way to run this design on AWS, in one Region across three Availability Zones. The stores and the notification service are outside this design. The services below are examples that fit, not the only option.',
    items: [
      {
        part: 'Edge',
        service:
          'Amazon CloudFront with AWS WAF and Origin Shield in the API’s Region, additional metrics turned on',
        why: 'Every API request passes through it. Only the history route is cached, keyed by path and range, for the 5 minutes the API sets; Origin Shield puts one regional cache in front of the API so that edge locations ask it rather than the API. WAF holds the rate rules per user and address.',
        watch:
          'Requests, 5xxErrorRate and TotalErrorRate; CacheHitRate and OriginLatency, which need additional metrics. WAF BlockedRequests per rule.',
      },
      {
        part: 'Tracker API',
        service:
          'An Application Load Balancer that serves only this API, in front of Amazon ECS on AWS Fargate: 3 tasks of 1 vCPU across zones, minimum healthy 100%, maximum 200%',
        why: 'Stateless tasks that normalize links, make the alert transactions and compute charts. Their own load balancer keeps their errors and latency apart from anything else.',
        watch:
          'ALB RequestCount, TargetResponseTime, HTTPCode_Target_5XX_Count, HTTPCode_ELB_5XX_Count and HealthyHostCount; ECS CPUUtilization.',
      },
      {
        part: 'Price tables',
        service:
          'Amazon DynamoDB, on-demand: products (a stream with new and old images), schedule (due index on store, tier and shard by nextCheckAt; warmed to 10,000 writes a second and the index to 20,000), price history, and stores',
        why: 'Conditional writes are the claims, the checks and the backoff; one transaction commits a change with its history row and check; the stream carries every committed change to the matcher in order per product, so nothing has to publish it.',
        watch:
          'ThrottledRequests per operation, WriteThrottleEvents for the schedule table and its due index, WriteKeyRangeThroughputThrottleEvents, ConsumedWriteCapacityUnits, ConditionalCheckFailedRequests, TransactionConflict and SuccessfulRequestLatency.',
      },
      {
        part: 'Alerts',
        service:
          'Amazon DynamoDB, on-demand, keyed by productId#shard and userId; a local secondary index byTarget whose sort key is state#target, the target as 12 digits of minor units (such as armed#000000007999), keys only; a global secondary index byUser with keys only',
        why: 'The local index is what allows strongly consistent range reads by target, which close the race between a new alert and a change. The user index serves the alert list and is written only when an alert is created or removed.',
        watch:
          'ConsumedWriteCapacityUnits, WriteKeyRangeThroughputThrottleEvents, ConditionalCheckFailedRequests and SuccessfulRequestLatency.',
      },
      {
        part: 'Scheduler',
        service:
          'Amazon ECS on AWS Fargate, one task of 2 vCPU, maximum 100% and minimum healthy 0%',
        why: 'One task keeps each store’s budget a single count. The deployment settings stop the old task before the new one starts, so a deploy never runs two.',
        watch:
          'ECS RunningTaskCount (Container Insights). Custom: TierOneClaims, TierOneLate, BlockedBudgetPct, parked products.',
      },
      {
        part: 'Fetch queue',
        service:
          'Amazon SQS standard queue, 30-second visibility, 1 hour of retention, no dead-letter queue',
        why: 'The per-message delay paces each store over the minute. A job is worth nothing 20 seconds after its slot, so it needs no dead-letter queue: a fetcher deletes a late job and the claim brings the product back.',
        watch:
          'ApproximateAgeOfOldestMessage, ApproximateNumberOfMessagesVisible, ApproximateNumberOfMessagesDelayed and NumberOfMessagesSent.',
      },
      {
        part: 'Fetchers',
        service:
          'Amazon ECS on AWS Fargate, 45 tasks of 2 vCPU, 15 per zone, minimum healthy 100%, maximum 125%; private subnets with a NAT gateway and Elastic IP addresses per zone',
        why: 'Stateless readers with 400 connections each, a 5-second limit per request, a cap per store on every request in flight of max(3, ceil(budget × 5 s ÷ running tasks)), with the running count read from the ECS service every 10 seconds, the last value kept if a read fails, which can leave a cap at its 30-task value for a while after a zone recovers, still under the fleet’s 18,000 (112 for the largest store at 45 tasks, 167 at 30, 90 at 56), and a 2-second limit per extraction. The fixed egress addresses are the ones a store with an API agreement can allow. Fetchers build requests only from store rules, to the store’s own domains.',
        watch:
          'ECS CPUUtilization and MemoryUtilization; NAT gateway ErrorPortAllocation, PacketsDropCount and ActiveConnectionCount. Custom: fetches by outcome, ExpiredFetches, GlitchesDropped and WorstStoreParseFailurePct.',
      },
      {
        part: 'Alert matcher',
        service:
          'AWS Lambda with a DynamoDB Streams event source mapping on the products table: batch size 100 with a 1-second batching window, starting at TRIM_HORIZON, retries until records expire, and an Amazon SQS skipped-changes queue as on-failure destination',
        why: 'Reads changes in order per product and turns each into match queries and jobs. It skips a record that throws twice by writing it to the skipped-changes queue itself, but only when it is the only failing record of its batch; two or more failures, throttling and timeouts fail the batch, so the shard waits instead of skipping healthy work. A batching window of 1 second keeps batches at several records.',
        watch: 'IteratorAge, Errors, Duration, Throttles and ConcurrentExecutions.',
      },
      {
        part: 'Fire queue and workers',
        service:
          'Amazon SQS standard queue (3-minute visibility, 4 days of retention, redrive after 100 receives to a dead-letter queue kept 14 days) and AWS Lambda with an SQS event source mapping: batch size 1, maximum concurrency 10, reserved concurrency 10, a 25-second function timeout, under a sixth of the visibility',
        why: 'Each job retries on its own. The worker sets the backoff through ChangeMessageVisibility before its first call, and calls have a 1-second limit, so 100 alerts at 5 at a time take at most 20 seconds, inside the 25-second timeout. The concurrency cap paces hand-offs at about 1,000 a second whatever the backlog.',
        watch:
          'ApproximateAgeOfOldestMessage and ApproximateNumberOfMessagesVisible on the queue, ApproximateNumberOfMessagesVisible on the dead-letter queue; Lambda Errors and Throttles. Custom: Fires, Handoffs, OnTimeHandoffs and HandoffErrors.',
      },
      {
        part: 'Notification service',
        service: 'The notification system’s internal API, behind its own load balancer',
        why: 'Takes a user, a template and an idempotency key, answers 202, and keeps the key 30 days, which is what makes our at-least-once hand-off harmless.',
        watch: 'Custom, from the workers: answers by status code and hand-off latency.',
      },
      {
        part: 'Security',
        service:
          'AWS WAF on CloudFront and the load balancer, IAM roles per part, AWS KMS, AWS Secrets Manager for store API keys, AWS CloudTrail',
        why: 'Only the fetchers read store keys, only the API writes alerts on users’ behalf, and only the workers call the notification service. Pasted links are parsed, never fetched.',
        watch:
          'WAF BlockedRequests per rule, and CloudTrail events for secret reads and role changes.',
      },
      {
        part: 'Observability',
        service: 'Amazon CloudWatch dashboards and alarms',
        why: 'Freshness is measured by the scheduler and backed by the queues’ own metrics; hand-off lateness by the workers, backed by the fire queue and the stream’s iterator age, so a dead component is seen by something that is not itself.',
        watch: 'The objectives below and the alarms that guard them.',
      },
    ],
    limits: [
      'An SQS message is at most 1 MiB; fetch and fire jobs are under 4 KB. A message can be delayed by at most 15 minutes, and pacing uses up to about 90 seconds: a pass starts 30 seconds before its minute.',
      'An SQS visibility timeout lasts at most 12 hours and can be changed per message with ChangeMessageVisibility, which is how the backoff of a fire job reaches 15 minutes. A redrive policy moves a message after 1 to 1,000 receives.',
      'ApproximateAgeOfOldestMessage leaves out a message received three or more times without being deleted, which moves to the back of the queue, so the fire queue’s age goes blind to jobs that are retrying; Handoffs failing covers them, and the dead-letter queue is watched by visible messages.',
      'SQS metrics arrive once a minute, and a queue that has been idle can take up to 15 minutes to report again. The fetch and fire queues are polled all the time; the dead-letter and skipped-changes queues are not, so their alarms can lag by that much.',
      'A DynamoDB partition takes 1,000 write units and 3,000 read units a second. A transactional write costs double, and TransactWriteItems takes up to 100 items. A new on-demand table sustains 4,000 writes and 12,000 reads a second, so the schedule table and its index are warmed ahead.',
      'The default on-demand quota is 40,000 read and 40,000 write request units a second for a table, and the same for any one of its global secondary indexes, adjustable.',
      'A global secondary index is updated asynchronously and is eventually consistent. Changing an indexed key attribute costs two index writes, and an index short of capacity throttles writes to its table.',
      'A local secondary index can be read with strongly consistent queries and must be created with the table. A table with one limits each partition key value to 10 GB across the table and its local indexes and stores that item collection in one partition, so its writes share one partition’s limit. That limit, not the 10 GB, is why alerts are spread over 8 shards per product.',
      'DynamoDB Streams keeps records 24 hours, each once and in order per item, and no more than two processes should read a shard at once. The matcher is the only reader.',
      'A DynamoDB Streams event source mapping retries a failed batch until the records expire by default; MaximumRetryAttempts and MaximumRecordAgeInSeconds can lower that. An SQS on-failure destination receives metadata only (shard and sequence numbers), not the records.',
      'ReturnValuesOnConditionCheckFailure returns the item on a failed condition and consumes no read units.',
      'An SQS event source mapping’s maximum concurrency is between 2 and 1,000 and should not exceed the function’s reserved concurrency.',
      'A NAT gateway starts at 5 Gbps and scales to 100 Gbps; each of its IPv4 addresses supports up to 55,000 simultaneous connections to each unique destination, and a gateway can have up to 8 addresses.',
      'CloudFront publishes its metrics in us-east-1; CacheHitRate and OriginLatency are available only with additional metrics turned on. AWS WAF attaches to CloudFront and to an Application Load Balancer.',
      'HTTPCode_Target_5XX_Count leaves out the 5xx the load balancer generates, HTTPCode_ELB_5XX_Count has only load balancer and zone dimensions and is reported only when nonzero, and RequestCount counts only requests for which a target was chosen and is reported only while targets are registered. That is why the error ratio adds HTTPCode_ELB_5XX_Count to its denominator.',
      'ECS maximumPercent counts running, pending and stopping tasks, and minimumHealthyPercent rounds up.',
      'A CloudWatch alarm with periods shorter than an hour can evaluate at most one day of them, 1,440 one-minute periods; with periods of an hour or more, seven days. An alarm reads more data points than its evaluation periods, the evaluation range: 5 points for a 2-of-3 alarm in the documented example, so on 5-minute windows silence fires such an alarm only about 20 minutes later. Delays caused by missing data on 1-minute alarms are written here as a few minutes.',
      'Alarms on AWS/DynamoDB metrics ignore missing data by default, and throttle metrics have points only in minutes with a throttle, so those alarms read FILL(metric, 0) through metric math.',
    ],
  },
  slos: [
    {
      objective: 'Tracker API: alerts and chart origin',
      target: '99.9% answered within 300 ms and without a 5xx, over 28 days',
      measure:
        'On the API’s own load balancer: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / (RequestCount + HTTPCode_ELB_5XX_Count) for errors, each read as zero when absent, and TargetResponseTime for latency. The denominator includes the 5xx the load balancer answers itself, which RequestCount leaves out, so with every task down the ratio is 100%, not missing; a minute with no data at all counts as failed. Charts answered by the edge are not in it; they are faster than any origin answer.',
    },
    {
      objective: 'Popular prices fresh',
      target: '99% of tier-1 checks within 20 minutes of the previous one, over 28 days',
      measure:
        'Published every minute by the scheduler as two counts with no dimensions: TierOneClaims, the first claims of a due time (attempts 0), and TierOneLate, the tier-1 claims, first or repeated, whose assigned slot time is more than 20 minutes after lastCheckedAt. A fetch that fails or is lost is claimed again, so a product checked late is counted late at that later claim, and a retry never adds to the denominator; this can count one product late more than once, which errs toward paging. Tier-1 products of stores in backoff, counted from the due index, are added to both as the claims they would have had, a fifteenth of their number each minute. A minute with no data counts as all late.',
    },
    {
      objective: 'Alert hand-off',
      target:
        '99% handed to the notification service within 5 minutes of the confirmed change, over 28 days',
      measure:
        'Published by the fire workers as Fires (alerts moved from armed to met) and OnTimeHandoffs, counts with no dimensions; late is Fires minus OnTimeHandoffs. The clock starts at the alert’s firedAt, the commit time of the confirmed change it fired at, recorded in the firing write so that a retry after a later change does not restart it; a job that finds a later change still under the target fires at that change, so its clock starts there, and stops at the 202; a hand-off is counted in OnTimeHandoffs only when its notifiedSeq write succeeds, and that write requires notifiedSeq to be absent or lower than firedSeq, so a repeat or a racing copy is not counted twice. A drop handed off late, never handed off because the price went back up, or left in the dead-letter queue counts as late. Counted per window, a hand-off that lands in the window after its fire balances out in steady traffic.',
    },
  ],
  alarms: [
    {
      name: 'API errors',
      metric:
        'On the API load balancer, over 5-minute windows: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / (RequestCount + HTTPCode_ELB_5XX_Count), each count read as zero when absent, above 0.04% in 2 of the last 3 windows, or above 0.04% over a 6-hour period, with a missing ratio counted as breaching; or p99.95 TargetResponseTime above 250 ms in one window; or HealthyHostCount Minimum below 1 for 2 consecutive 1-minute periods, missing data counted as breaching',
      meaning:
        'Requests fail or are slow: tasks down, or DynamoDB slow or throttling. Without a page, errors stay at or under 0.04% in every 6-hour period and slow answers under 0.05% in every window, together under the 0.1% the objective allows, and 250 ms is tighter than 300. The quietest hours still bring about 13,000 requests in 5 minutes, so one 5xx is about 0.008% and cannot page alone. With every task down the load balancer answers 503 itself: the ratio reads 100% and the 1-minute clause pages within a few minutes, while the 28 days allow about 40 minutes of total outage (0.1% of 40,320). It returns to OK once the windows it reads are back under both thresholds.',
    },
    {
      name: 'Hand-offs late',
      metric:
        'Custom, from the fire workers: (Fires − OnTimeHandoffs) / Fires above 5% in 2 of the last 3 5-minute windows, or above 0.5% over a 6-hour period; missing data counts as not breaching',
      meaning:
        'Alerts reach the notification service late: the matcher is behind, the workers are throttled, or hand-offs are failing and then succeeding. The slow clause keeps every 6-hour period at or under 0.5% late, half the 1% the objective allows. Quiet minutes publish nothing, so missing data is not breaching here; dead workers are caught by Fire backlog and a dead matcher by Matcher behind, both from metrics the dead component does not publish. It returns to OK once the windows it reads are under both thresholds.',
    },
    {
      name: 'Handoffs failing',
      metric:
        'Custom, from the fire workers: HandoffErrors / (Handoffs + HandoffErrors) above 5% for 5 consecutive 1-minute periods; missing data counts as not breaching',
      meaning:
        'The notification service refuses or times out. This is the alarm that sees retrying jobs, which the fire queue’s age leaves out after their third receive. It returns to OK a few minutes after the error share falls under 5%.',
    },
    {
      name: 'Fire backlog',
      metric:
        'SQS ApproximateAgeOfOldestMessage on the fire queue above 120 s for 5 consecutive 1-minute periods; missing data counts as not breaching',
      meaning:
        'Jobs wait unreceived: workers are not running, are throttled, or the burst exceeds the cap. The queue publishes it, so it works with every worker dead. SQS reports the age only while the queue holds a message, so an empty queue is silence and missing data is not breaching; jobs that nobody takes keep it reporting. It returns to OK a few minutes after the age is under 120 s.',
    },
    {
      name: 'Matcher behind',
      metric:
        'Lambda IteratorAge Maximum for the matcher above 60 s for 5 consecutive 1-minute periods; missing data counts as breaching',
      meaning:
        'Changes wait in the stream: the matcher fails a batch again and again or cannot keep up. About 150 records a second arrive, so silence means it is not being invoked. It pages about a day before records could leave the stream, and returns to OK a few minutes after the age is under 60 s.',
    },
    {
      name: 'Work parked',
      metric:
        'SQS ApproximateNumberOfMessagesVisible above 0 on the fire dead-letter queue or on the skipped-changes queue, one alarm each, Maximum over 5 minutes; and a page when the skipped-changes queue’s NumberOfMessagesSent passes 5 in a 5-minute period; missing data counts as not breaching',
      meaning:
        'A hand-off gave up after about 24 hours, or a change was skipped. The visible-message alarms are tickets: the first needs a redrive within about 13 days, because a dead-letter message keeps its first enqueue time and is deleted 14 days after it, well inside the notification service’s 30 days of keys; the second needs a fix and a replay. More than 5 skipped changes in 5 minutes means a bug rather than one poison record, and pages. These queues sit idle, so the alarms can lag by up to 15 minutes. Each returns to OK once its queue is emptied by the redrive or replay, or a 5-minute period passes with no more than 5 skips.',
    },
    {
      name: 'Prices stale',
      metric:
        'Custom, from the scheduler: TierOneLate / TierOneClaims above 10% in 2 of the last 3 5-minute windows, or above 0.5% over a 6-hour period, missing data counted as breaching; or, from SQS, NumberOfMessagesSent on the fetch queue below 50,000 for 5 consecutive 1-minute periods',
      meaning:
        'Tier-1 products are checked late: budgets too small for the tier, a scheduler restart that lasted, fetchers too slow, or a large store in backoff. The slow clause keeps every 6-hour period at or under 0.5%, inside the 1% the objective allows. A dead scheduler is caught by the third clause, from SQS: the fetchers’ polling keeps the queue reporting, so a silent scheduler is a real count near zero, not missing data, and it pages about 5 minutes after the sends stop. The first two clauses would see it only through missing data, about 20 minutes later, when one real point is left in the 5-point evaluation range and two filled breaching points make 2 of 3. A 2-minute gap during a deploy does not fire it. It returns to OK once all clauses are under their thresholds.',
    },
    {
      name: 'Fetch backlog',
      metric:
        'SQS ApproximateAgeOfOldestMessage on the fetch queue above 180 s for 5 consecutive 1-minute periods; missing data counts as not breaching',
      meaning:
        'Fetchers are not receiving jobs. A pacing delay is at most about 90 seconds, so an age of 3 minutes means jobs nobody is taking. The age is reported only while the queue holds a message, so missing data is not breaching; a dead scheduler, which empties the queue, is caught by Prices stale instead. This is the independent signal when the fetchers die: claims continue, and Prices stale only rises once the claims end 10 minutes later. It returns to OK a few minutes after the age is under 180 s.',
    },
    {
      name: 'Store blocked',
      metric:
        'Custom, from the scheduler: BlockedBudgetPct above 5% for 15 consecutive 1-minute periods; missing data counts as breaching',
      meaning:
        'Stores holding more than 5% of all budgets have been in backoff for a quarter of an hour; the largest store alone is a third. Backoff is automatic, so the page asks whether the cause is ours (a new user agent, a deploy that broke pacing) or the store’s. It returns to OK a few minutes after the share falls under 5%.',
    },
    {
      name: 'Store parser broken',
      metric:
        'Custom, from the fetchers: WorstStoreParseFailurePct, one metric with no dimensions read with the Maximum statistic, above 20% for 15 consecutive 1-minute periods; missing data counts as not breaching',
      meaning:
        'A store with at least 50 fetches in 10 minutes on some task fails to parse on more than one in five, usually a new page layout. A ticket; the log line names the store. Fetchers that stop publishing are caught by Fetch backlog. It returns to OK a few minutes after the rate falls under 20%.',
    },
    {
      name: 'Schedule throttled',
      metric:
        'DynamoDB WriteThrottleEvents on the schedule table and on its due index, each read as FILL(metric, 0) through metric math and combined with MAX, above 0 in 3 of 5 1-minute periods',
      meaning:
        'Claims and check writes are throttled, often an index shard hotter than planned or traffic above the warmed level. A throttled index throttles its table, so this shows up as late prices. It returns to OK when a few minutes pass without throttles.',
    },
  ],
  evolution: {
    mvp: 'One scheduler task, one fetch queue paced by delays, fetchers with a timeout and manual backoff, the conditional claim, the change transaction with its history row, and the stream into a matcher that writes alert state with lastSeq and hands off under the key alert plus changeSeq. Present from day one because they are hard to add once data exists: the derived productId, the alert key by user and product, changeSeq on the product, and the alert shards. Left out at first: the edge cache for charts, layout fingerprints (the confirm alone catches most glitches), automatic backoff and probes, tier 0, and the parse-failure rollup.',
    atScale: [
      'At 10x products and alerts, the stores’ budgets do not grow 10x: tier 2 and 3 intervals get longer, and the work turns to agreements with stores for feeds or higher limits. Fetches stay near the 3,000 a second the budgets allow, so the schedule table’s writes, about 6,000 a second with its index near 12,000, barely move; its storage grows 10x, about 900 GB with its index, and the index gets more shards per store as each store’s due entries multiply.',
      'At 10x, one scheduler process has more to read, not more to send: ten times the products mean ten times the due entries to query and the counts it publishes, the late and parked tier-1 products and those of stores in backoff, while fetches stay near 3,000 a second. Stores are split among several tasks, each owning a fixed set, with a per-store counter for the minute’s budget so that an overlap cannot exceed it.',
      'At 10x alerts on the most watched products, 8 shards are not enough: hot products get more shards, recorded on the product so the matcher queries all of them.',
      'At 100x, fetchers move close to the stores they read, in more than one Region, and history moves to cheaper storage with older years in files.',
    ],
    firstBottleneck:
      'The stores’ budgets, which no amount of hardware raises: at 84% of the sum today, the next growth in watched products lengthens intervals unless stores agree to more. Inside the design, the first to hurt is the schedule’s due index, with four writes per fetch.',
    avoided: [
      'A queue per store. 5,000 queues for pacing that message delays already give. Worth it if a few stores need dedicated egress or credentials.',
      'A shared rate limiter on the fetch path. Pacing at the scheduler needs no component that can stop every fetch. Worth it with several schedulers.',
      'Routing around blocks with proxies or rotating addresses. A block is the store’s answer, and the terms come first.',
      'A browser fleet for pages that need scripts. Out of scope; worth it if a large store offers no other way.',
      'A time-series store and precomputed rollups. Changes plus a cache are enough for charts.',
      'An outbox and a relay. The change transaction and the table’s stream make the commit the only step.',
      'The highest target per product as a shortcut. 2,000 mostly empty queries a second are cheaper than keeping it right.',
      'A daily reconcile of every alert against its price. The next change of a product reconciles its alerts, and skipped changes are queued.',
    ],
  },
};
