# Rules for Claude in this repo

A public site of reference system designs, explained step by step with interactive diagrams.
Live at https://systems.pablomagnaghi.com. Read this file before doing anything.

## Authorship

- **Never add AI attribution anywhere.** No `Co-Authored-By` trailers, no "Generated with" footers
  in PR bodies, no AI-related comments or watermarks in code, docs or commits.
- **Pablo Magnaghi is the sole author** of every commit and PR.

## Content rules (this repo is public)

- Designs are **generic reference designs**. Never describe, name or hint at a real employer's
  or client's system, numbers, incidents or internal tools.
- Write everything in your own words. Use other courses or guides only as inspiration for the
  structure; **never copy their text, diagrams or examples**.
- Every design follows the six steps in `src/content/index.ts` (`framework`): requirements, core
  entities, API, data flow, high-level design, deep dives.
- Every stage of a diagram has a `narration` (what happens) and a `tradeoff` (what the choice
  gives and what it costs). Every deep dive has at least two options and a stated choice.
- Numbers are illustrative orders of magnitude, never measured results.
- English only, plain and concise. No em dashes in prose.

## Ownership (one agent per area, no overlapping edits)

| Agent           | Owns                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------- |
| `design-writer` | `src/content/**`                                                                                  |
| `web-dev`       | `src/components/**`, `src/layouts/**`, `src/pages/**`, `src/styles/**`, `src/lib/**`, `public/**` |
| `pr-reviewer`   | nothing: reads and comments only                                                                  |

Shared config (`package.json`, `tsconfig.json`, `eslint.config.js`, `astro.config.mjs`,
`.github/**`, this file) changes only in a `chore/` task or by the human. Adding a field to
`src/content/types.ts` is a contract change: it goes in its own PR before the content that uses it.

## Flow: branch → PR → review → human merge

1. Branch from `main`: `<area>/<short-task>` (for example `content/url-shortener`).
2. Keep each task small (under about 300 changed lines, one design per PR).
3. Run `npm run check` (format, lint, typecheck, tests, build). It must pass.
4. Open a PR into `main` using the template. One commit per PR.
5. `pr-reviewer` reviews; the human merges. Agents never merge, never push to `main` and never
   force-push.
6. Use one git worktree per agent session so parallel work never shares a checkout.

## Code style

- TypeScript strict. Content is typed data, rendering is in components: keep them separate.
- Pure logic lives in `src/lib` with unit tests; components stay thin.
- Accessibility: keyboard-reachable controls, `aria-live` narration, respects
  `prefers-reduced-motion`.
- Comments in English and only where the why is not obvious.
