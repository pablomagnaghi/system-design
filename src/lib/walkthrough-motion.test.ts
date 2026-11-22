import { describe, expect, it } from 'vitest';
import type { Walkthrough, WalkthroughStage } from '../content/types';
import {
  DOTS_PER_PACKET,
  dotProgress,
  legendFor,
  packetsFor,
  visibleAt,
} from './walkthrough-motion';

const stage = (extra: Partial<WalkthroughStage> = {}): WalkthroughStage => ({
  title: 't',
  narration: 'n',
  tradeoff: 'x',
  nodes: [],
  travel: [],
  ...extra,
});

const walkthrough: Walkthrough = {
  label: 'Run',
  intro: 'intro',
  nodes: [
    { id: 'users', title: 'Users', detail: '', column: 0, row: 'middle' },
    { id: 'server', title: 'Server', detail: '', column: 2, row: 'middle' },
    { id: 'lb', title: 'Load balancer', detail: '', column: 1, row: 'middle', appearsAt: 1 },
  ],
  edges: [
    ['users', 'server'],
    ['users', 'lb'],
    ['lb', 'server'],
  ],
  stages: [stage(), stage(), stage()],
};

describe('visibleAt', () => {
  it('shows a node from its appearsAt stage on, and the intro like the first stage', () => {
    expect([...visibleAt(walkthrough, -1).nodes]).toEqual(['users', 'server']);
    expect([...visibleAt(walkthrough, 0).nodes]).toEqual(['users', 'server']);
    expect(visibleAt(walkthrough, 1).nodes.has('lb')).toBe(true);
  });

  it('shows an edge only once both ends are on screen', () => {
    expect([...visibleAt(walkthrough, 0).edges]).toEqual(['users>server']);
    expect(visibleAt(walkthrough, 2).edges.has('lb>server')).toBe(true);
  });

  it('limits an edge to its listed stages, such as a path a later stage replaces', () => {
    const limited = {
      ...walkthrough,
      edgeStages: [{ edge: ['users', 'server'] as const, stages: [0] }],
    };
    expect(visibleAt(limited, -1).edges.has('users>server')).toBe(true);
    expect(visibleAt(limited, 0).edges.has('users>server')).toBe(true);
    expect(visibleAt(limited, 1).edges.has('users>server')).toBe(false);
    expect(visibleAt(limited, 2).edges.has('lb>server')).toBe(true);
  });
});

describe('packetsFor', () => {
  it('moves requests along travel, then the extra traffic', () => {
    const packets = packetsFor(
      stage({ travel: [['users', 'lb']], traffic: [{ edge: ['lb', 'server'], kind: 'health' }] }),
    );
    expect(packets).toEqual([
      { edge: ['users', 'lb'], kind: 'request' },
      { edge: ['lb', 'server'], kind: 'health' },
    ]);
    expect(packetsFor(undefined)).toEqual([]);
  });
});

describe('legendFor', () => {
  it('is empty when only plain requests move, and lists the kinds in a fixed order', () => {
    expect(legendFor([stage({ travel: [['a', 'b']] })])).toEqual([]);
    const legend = legendFor([
      stage({ travel: [['a', 'b']], traffic: [{ edge: ['a', 'b'], kind: 'failed' }] }),
      stage({ traffic: [{ edge: ['a', 'b'], kind: 'heavy' }] }),
    ]);
    expect(legend.map((entry) => entry.kind)).toEqual(['request', 'heavy', 'failed']);
  });
});

describe('dotProgress', () => {
  it('loops each dot and spreads the dots of a stream apart', () => {
    expect(dotProgress(0, 0, 'request', 1000)).toBe(0);
    expect(dotProgress(500, 0, 'request', 1000)).toBe(0.5);
    expect(dotProgress(1000, 0, 'request', 1000)).toBe(0);
    expect(dotProgress(0, 1, 'request', 1000)).toBeCloseTo(1 / DOTS_PER_PACKET);
  });

  it('never lets a failed request reach its target', () => {
    for (let t = 0; t < 2000; t += 50) expect(dotProgress(t, 0, 'failed', 1000)).toBeLessThan(0.8);
  });
});
