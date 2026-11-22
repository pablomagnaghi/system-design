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

  it('adds labelled metrics after the fixed ones, with the same alert and recovery rules', () => {
    const before: StageMetrics = {
      custom: [
        { label: 'p99 read', value: '125 ms', alert: true },
        { label: 'Nodes', value: '177' },
      ],
    };
    const after: StageMetrics = {
      users: '1M',
      custom: [
        { label: 'p99 read', value: '15 ms' },
        { label: 'Nodes', value: '72' },
      ],
    };
    const items = metricItems(after, before);
    expect(items.map((item) => item.key)).toEqual(['users', 'custom:p99 read', 'custom:Nodes']);
    expect(items[1]).toMatchObject({ label: 'p99 read', value: '15 ms', status: 'recovered' });
    expect(items[2]?.status).toBe('normal');
    expect(metricItems(before, undefined)[0]?.status).toBe('alert');
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
  it('explains each fixed metric in plain words', () => {
    const [p95] = metricItems({ p95Latency: '400 ms' }, undefined);
    expect(p95?.hint).toMatch(/95 of every 100 requests/);
  });
});
