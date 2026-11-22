import type { FlowKind, FlowStep, RequestFlow } from '../content/types';

/** Label shown on a flow's tab and in the summary table. */
export const FLOW_KIND_LABEL: Readonly<Record<FlowKind, string>> = {
  sync: 'Synchronous',
  async: 'Async, same service',
  scheduled: 'Scheduled worker',
  queue: 'Queue and worker',
  direct: 'Direct, not stored',
};

/** Where an arrow sits horizontally, in percent of the diagram width. */
export interface ArrowSpan {
  /** Left edge of the arrow. */
  readonly left: number;
  readonly width: number;
  /** True when the arrow points right to left. */
  readonly reversed: boolean;
  /** True when the step is work inside one participant. */
  readonly self: boolean;
}

/** Center of a participant's lifeline, in percent of the diagram width. */
export function laneCenter(index: number, count: number): number {
  return ((index + 0.5) / count) * 100;
}

export function arrowSpan(flow: RequestFlow, step: FlowStep): ArrowSpan {
  const count = flow.participants.length;
  const from = flow.participants.findIndex((p) => p.id === step.from);
  const to = flow.participants.findIndex((p) => p.id === step.to);
  if (from < 0 || to < 0) {
    throw new Error(`${flow.id}: step "${step.label}" names an unknown participant`);
  }
  const a = laneCenter(from, count);
  const b = laneCenter(to, count);
  return { left: Math.min(a, b), width: Math.abs(b - a), reversed: b < a, self: from === to };
}

/** Steps that reference a participant the flow does not declare; empty when the flow is valid. */
export function unknownParticipants(flow: RequestFlow): string[] {
  const ids = new Set(flow.participants.map((p) => p.id));
  return flow.steps.flatMap((s) => [s.from, s.to]).filter((id) => !ids.has(id));
}

/** The next step when playing: wraps to the first after the last. */
export const nextStep = (step: number, count: number): number => (step + 1) % count;
