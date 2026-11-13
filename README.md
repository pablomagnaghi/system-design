# System Design, Step by Step

Reference system designs explained in the order of an interview, each with an interactive
diagram: press play to follow one request through the system and read what happens at every
step and the trade-off behind it.

**Live site:** https://systems.pablomagnaghi.com

| Design                                                                                   | Difficulty | Focus                                                 |
| ---------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------- |
| [Distributed rate limiter](https://systems.pablomagnaghi.com/designs/rate-limiter/)      | Medium     | Token buckets, atomic counters, failing open          |
| [Notification system](https://systems.pablomagnaghi.com/designs/notification-system/)    | Medium     | Priority queues, idempotency, provider isolation      |
| [Payment webhook processor](https://systems.pablomagnaghi.com/designs/payment-webhooks/) | Hard       | Inbox pattern, state machines, reconciliation         |
| [Booking system for stays](https://systems.pablomagnaghi.com/designs/booking-system/)    | Hard       | Atomic night claims, holds, channel sync              |
| [Distributed cache](https://systems.pablomagnaghi.com/designs/distributed-cache/)        | Medium     | Consistent hashing, single-flight loads, invalidation |
| [Distributed job scheduler](https://systems.pablomagnaghi.com/designs/job-scheduler/)    | Medium     | Partition leases, atomic claims, idempotent workers   |
| [Post search](https://systems.pablomagnaghi.com/designs/post-search/)                    | Medium     | Inverted index, fan-out and merge, hot and cold tiers |

## How each design is built

1. **Requirements:** functional, non-functional and out of scope.
2. **Core entities:** the main things the system stores and moves.
3. **API:** the contract with callers.
4. **Data flow:** one request in a few steps.
5. **High-level design:** an animated diagram where every stage has a narration and a trade-off.
6. **Deep dives:** the hard questions, each with options, pros, cons and a choice.

These are generic designs written to explain trade-offs. They do not describe any company's
production systems.

## Stack

- [Astro](https://astro.build) static site with a single React island for the diagram.
- TypeScript strict; designs are typed data in `src/content`, rendering lives in components.
- Pure logic (diagram geometry, player state) in `src/lib`, unit tested with Vitest.
- ESLint, Prettier and `astro check` in CI; deployed to Cloudflare Pages.

```bash
npm install
npm run dev      # http://localhost:4321
npm run check    # format, lint, typecheck, tests and build
```

## Contributing workflow

Work is split by area with one Claude Code agent each (`.claude/agents/`): a design writer for
content, a web developer for the UI and a reviewer that comments on every pull request. Each task
is a small branch and a single-commit PR into `main`; a human approves every merge. The rules are
in [`CLAUDE.md`](CLAUDE.md).

## License

Code under the MIT License. Written content © Pablo Magnaghi, all rights reserved.
