import type { PacketKind, Walkthrough, WalkthroughStage } from '../content/types';
import { edgeKey } from './walkthrough-layout';

/**
 * Node ids and edge keys on screen at a stage. A node shows from its `appearsAt` stage on, so
 * the design grows as the story goes; the intro (stage -1) shows what the first stage shows.
 * An edge shows once both of its ends do.
 */
export function visibleAt(walkthrough: Walkthrough, stage: number) {
  const at = Math.max(stage, 0);
  const nodes = new Set(
    walkthrough.nodes.filter((node) => (node.appearsAt ?? 0) <= at).map((node) => node.id),
  );
  const limited = new Map(
    (walkthrough.edgeStages ?? []).map(({ edge, stages }) => [edgeKey(edge), stages]),
  );
  const edges = new Set(
    walkthrough.edges
      .filter(([from, to]) => nodes.has(from) && nodes.has(to))
      .map(edgeKey)
      .filter((key) => limited.get(key)?.includes(at) ?? true),
  );
  return { nodes, edges };
}

export interface Packet {
  readonly edge: readonly [from: string, to: string];
  readonly kind: PacketKind;
}

/** What moves during a stage: plain requests along `travel`, then the stage's extra `traffic`. */
export function packetsFor(stage: WalkthroughStage | undefined): Packet[] {
  if (!stage) return [];
  const requests = stage.travel.map(([from, to]): Packet => ({
    edge: [from, to],
    kind: 'request',
  }));
  return [...requests, ...(stage.traffic ?? [])];
}

const LEGEND: readonly (readonly [PacketKind, string])[] = [
  ['request', 'request'],
  ['heavy', 'heavy request'],
  ['health', 'health check'],
  ['failed', 'failed request'],
];

/**
 * Legend entries for the kinds a walkthrough uses. Empty when it only moves plain requests,
 * because a legend with a single entry explains nothing.
 */
export function legendFor(stages: readonly WalkthroughStage[]) {
  const kinds = new Set(stages.flatMap((stage) => packetsFor(stage).map((p) => p.kind)));
  if (kinds.size <= 1) return [];
  return LEGEND.filter(([kind]) => kinds.has(kind)).map(([kind, label]) => ({ kind, label }));
}

/** Dots per packet stream, spread evenly along the edge so the stream reads as traffic. */
export const DOTS_PER_PACKET = 3;

/**
 * Where a dot is along its edge (0 to 1) after `elapsed` ms. Dots loop, offset by their index.
 * A failed request never arrives: it stops short of the target.
 */
export function dotProgress(elapsed: number, index: number, kind: PacketKind, travelMs: number) {
  const loop = (elapsed / travelMs + index / DOTS_PER_PACKET) % 1;
  return kind === 'failed' ? loop * 0.8 : loop;
}
