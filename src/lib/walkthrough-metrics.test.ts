import { describe, expect, it } from 'vitest';
import type { StageMetrics, WalkthroughStage } from '../content/types';
import { hasMetrics, loadLevel, metricItems } from './walkthrough-metrics';

describe('metricItems', () => {
  it('lists only the metrics that are set, in a fixed order', () => {
    const items = metricItems({ errorRate: '12%', users: '200K' }, undefined);
    expect(items.map((item) => item.key)).toEqual(['users', 'errorRate']);
    expect(items[0]).toMatchObject({ label: 'Users', value: '200K', status: 'normal' });
  });

  it('flags alerts, and marks a metric recovered when the previous stage alerted it', () => {
    const before: StageMetrics = {
      p95Latency: '1.8 s',
      errorRate: '12%',
      alerts: ['p95Latency', 'errorRate'],
    };
    const after: StageMetrics = { p95Latency: '120 ms', errorRate: '12%', alerts: ['errorRate'] };
    const items = metricItems(after, before);
    expect(items.find((item) => item.key === 'p95Latency')?.status).toBe('recovered');
    expect(items.find((item) => item.key === 'errorRate')?.status).toBe('alert');
  });

  it('returns nothing for a stage without metrics', () => {
    expect(metricItems(undefined, undefined)).toEqual([]);
  });
});

describe('loadLevel', () => {
  it('maps load to ok, busy and hot', () => {
    expect(loadLevel(3)).toBe('ok');
    expect(loadLevel(69)).toBe('ok');
    expect(loadLevel(70)).toBe('busy');
    expect(loadLevel(90)).toBe('hot');
    expect(loadLevel(100)).toBe('hot');
  });
});

describe('hasMetrics', () => {
  const stage = (metrics?: WalkthroughStage['metrics']): WalkthroughStage => ({
    title: 't',
    narration: 'n',
    tradeoff: 'x',
    nodes: [],
    travel: [],
    ...(metrics ? { metrics } : {}),
  });

  it('is true only when some stage shows a metric', () => {
    expect(hasMetrics([stage(), stage()])).toBe(false);
    expect(hasMetrics([stage(), stage({ users: '1K' })])).toBe(true);
  });
});
