/** A box in an animated walkthrough, placed on a small grid (columns 0-5, three rows). */
export interface WalkthroughNode {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly column: number;
  readonly row: 'top' | 'middle' | 'bottom';
  /** Index of the stage where the node first appears, so the design can grow. Defaults to 0. */
  readonly appearsAt?: number;
}

/** What a moving dot represents. Each kind has its own look and a legend entry. */
export type PacketKind = 'request' | 'heavy' | 'health' | 'failed';

/** Extra dots of a given kind travelling an edge during a stage, on top of `travel`. */
export interface Traffic {
  readonly edge: readonly [from: string, to: string];
  readonly kind: PacketKind;
}

export type MetricKey = 'users' | 'requestsPerSecond' | 'p95Latency' | 'errorRate' | 'healthy';

/**
 * System-wide numbers shown above the diagram during a stage, written for display ("200K",
 * "1.8 s", "3 / 3"). Illustrative orders of magnitude, never measured results.
 */
export interface StageMetrics {
  readonly users?: string;
  readonly requestsPerSecond?: string;
  readonly p95Latency?: string;
  readonly errorRate?: string;
  readonly healthy?: string;
  /** Metrics in trouble at this stage; the UI flags them. Each must be set above. */
  readonly alerts?: readonly MetricKey[];
}

/** A connector between two nodes, by node id, with an optional short label drawn on it. */
export type WalkthroughEdge = readonly [from: string, to: string, label?: string];

/** One step of the walkthrough: what lights up, what moves, what happens and what it costs. */
export interface WalkthroughStage {
  readonly title: string;
  /** What happens in this step. */
  readonly narration: string;
  /** The choice made here and what it gives up. */
  readonly tradeoff: string;
  /** Nodes highlighted during this stage. */
  readonly nodes: readonly string[];
  /** Edges the work travels along during this stage (a subset of `edges`). */
  readonly travel: readonly WalkthroughEdge[];
  /** A one- or two-word name for the stage timeline, e.g. "Hot spot". */
  readonly short?: string;
  readonly metrics?: StageMetrics;
  /** Load per node id, from 0 to 100, drawn as a bar on the node. */
  readonly load?: Readonly<Record<string, number>>;
  readonly traffic?: readonly Traffic[];
}

/** A step-by-step, animated version of the high-level design. */
export interface Walkthrough {
  readonly label: string;
  /** Shown before the first stage plays. */
  readonly intro: string;
  readonly lanes?: { readonly top?: string; readonly bottom?: string };
  readonly nodes: readonly WalkthroughNode[];
  readonly edges: readonly WalkthroughEdge[];
  readonly stages: readonly WalkthroughStage[];
}

export interface Entity {
  readonly name: string;
  readonly description: string;
}

export interface Endpoint {
  /** HTTP method, or a label such as "internal" for a non-HTTP interface. */
  readonly method: string;
  readonly path: string;
  readonly description: string;
}

/** One way to solve a deep-dive problem, with what it gives and what it costs. */
export interface Option {
  readonly name: string;
  readonly pros: string;
  readonly cons: string;
}

export interface DeepDive {
  readonly question: string;
  readonly options: readonly Option[];
  /** The option chosen and why. */
  readonly choice: string;
}

/**
 * A reference design, written in the order of an interview:
 * requirements → core entities → API → data flow → high-level design → deep dives.
 */
export interface Design {
  readonly slug: string;
  readonly title: string;
  readonly summary: string;
  readonly difficulty: 'Easy' | 'Medium' | 'Hard';
  /** Estimated reading time, shown as a chip next to the difficulty. */
  readonly minutes?: number;
  readonly requirements: {
    readonly functional: readonly string[];
    readonly nonFunctional: readonly string[];
    readonly outOfScope: readonly string[];
  };
  readonly entities: readonly Entity[];
  readonly api: readonly Endpoint[];
  readonly dataFlow: readonly string[];
  readonly highLevel: Walkthrough;
  readonly deepDives: readonly DeepDive[];
  /** A short closing line that summarizes the design in an interview. */
  readonly wrapUp: string;
}
