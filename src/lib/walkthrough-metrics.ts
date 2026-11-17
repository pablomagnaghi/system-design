import type { MetricKey, StageMetrics, WalkthroughStage } from '../content/types';

export type MetricStatus = 'alert' | 'recovered' | 'normal';

export interface MetricItem {
  readonly key: MetricKey;
  readonly label: string;
  readonly value: string;
  readonly status: MetricStatus;
}

/** Display order and labels of the metrics bar. */
const METRICS: readonly (readonly [MetricKey, string])[] = [
  ['users', 'Users'],
  ['requestsPerSecond', 'Requests / s'],
  ['p95Latency', 'P95 latency'],
  ['errorRate', 'Errors'],
  ['healthy', 'Healthy servers'],
];

/**
 * The metrics to show for a stage. A metric is an alert when the stage says so, and "recovered"
 * when the previous stage alerted it and this one no longer does, so a fix reads as a fix.
 */
export function metricItems(
  metrics: StageMetrics | undefined,
  previous: StageMetrics | undefined,
): MetricItem[] {
  if (!metrics) return [];
  const alerts = new Set(metrics.alerts);
  const previousAlerts = new Set(previous?.alerts);
  return METRICS.flatMap(([key, label]) => {
    const value = metrics[key];
    if (value === undefined) return [];
    const status: MetricStatus = alerts.has(key)
      ? 'alert'
      : previousAlerts.has(key)
        ? 'recovered'
        : 'normal';
    return [{ key, label, value, status }];
  });
}

export type LoadLevel = 'ok' | 'busy' | 'hot';

/** Below 70% a node is fine, from 90% it is saturated. */
export function loadLevel(percent: number): LoadLevel {
  if (percent >= 90) return 'hot';
  if (percent >= 70) return 'busy';
  return 'ok';
}

/** Whether any stage uses the metrics bar, so designs without metrics keep their old layout. */
export function hasMetrics(stages: readonly WalkthroughStage[]): boolean {
  return stages.some((stage) => metricItems(stage.metrics, undefined).length > 0);
}
