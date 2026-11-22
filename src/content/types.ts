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
  /** Metrics with their own label, for numbers the fixed keys cannot hold (p99, node count). */
  readonly custom?: readonly CustomMetric[];
}

export interface CustomMetric {
  /** Short label, at most 24 characters, unique within a stage. */
  readonly label: string;
  readonly value: string;
  readonly alert?: boolean;
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
  /** What the design promises, what those promises rest on, and what it does not promise. */
  readonly guarantees?: Guarantees;
  /** How the design fails and recovers, beyond the happy path. */
  readonly failures?: readonly FailureScenario[];
  /** Back-of-the-envelope numbers and the decisions they drive. Illustrative, never measured. */
  readonly capacity?: Capacity;
  /** How the design should change as scale and reliability needs grow. */
  readonly evolution?: Evolution;
  /** One concrete way to run the design on a cloud provider, part by part. */
  readonly infrastructure?: Infrastructure;
  /** The few objectives an on-call team would watch, each with its target and how it is measured. */
  readonly slos?: readonly Slo[];
  /** The alarms that page someone, each tied to one metric. */
  readonly alarms?: readonly Alarm[];
}

/** An alarm worth waking up for. */
export interface Alarm {
  readonly name: string;
  /** The metric and threshold, e.g. "SQS ApproximateAgeOfOldestMessage above 60 s". */
  readonly metric: string;
  /** What it means when it fires. */
  readonly meaning: string;
}

/** One service level objective. */
export interface Slo {
  /** What users experience, e.g. "Delivery to an online device". */
  readonly objective: string;
  /** The target, e.g. "99% under 500 ms, over 28 days". */
  readonly target: string;
  /** The metric behind it and where it is measured. */
  readonly measure: string;
}

/** One part of the design mapped to the managed service that would run it. */
export interface InfrastructureItem {
  /** The part of the design, as named in the walkthrough. */
  readonly part: string;
  /** The service, with the setting that matters (e.g. "Amazon DynamoDB, on-demand"). */
  readonly service: string;
  /** Why this service fits this part. */
  readonly why: string;
  /** The metrics to watch on this service, by their real names where the provider has them. */
  readonly watch?: string;
}

export interface Infrastructure {
  /** Cloud provider the mapping targets, e.g. "AWS". */
  readonly provider: string;
  readonly intro: string;
  readonly items: readonly InfrastructureItem[];
  /** Real limits and settings of those services that the design has to respect. */
  readonly limits: readonly string[];
}

/** One guarantee, stated precisely (e.g. "at-least-once delivery, effectively-once effect"). */
export interface Guarantee {
  /** The property, e.g. "Delivery", "Read consistency", "Durability". */
  readonly property: string;
  /** What is guaranteed, in plain words. */
  readonly promise: string;
}

export interface Guarantees {
  readonly provides: readonly Guarantee[];
  /** Conditions the guarantees depend on (idempotent consumers, a quorum, synchronized clocks...). */
  readonly assumes: readonly string[];
  /** What the design explicitly does not guarantee. */
  readonly doesNotGuarantee: readonly string[];
}

export interface FailureScenario {
  /** What fails, e.g. "A worker crashes after committing but before acknowledging the message". */
  readonly scenario: string;
  /** What users or data experience while it lasts. */
  readonly impact: string;
  /** How the failure is noticed: an alarm, a metric, a reconciliation job. */
  readonly detection: string;
  /** How the system recovers, and what state it is left in. */
  readonly recovery: string;
}

/** A single estimate, with the arithmetic that produced it. */
export interface Estimate {
  readonly label: string;
  /** Display value, e.g. "~12K QPS". */
  readonly value: string;
  /** How it was derived, e.g. "100M reads/day ÷ 86,400 s × 10 peak factor". */
  readonly math: string;
}

export interface Capacity {
  readonly assumptions: readonly string[];
  readonly estimates: readonly Estimate[];
  /** The architectural decisions these numbers force, e.g. "reads dominate 100:1, so cache in front". */
  readonly implications: readonly string[];
}

export interface Evolution {
  /** What is deliberately simple in the first version. */
  readonly mvp: string;
  /** What breaks or changes first at 10x or 100x. */
  readonly atScale: readonly string[];
  /** The component that becomes the bottleneck first, and why. */
  readonly firstBottleneck: string;
  /** Complexity that was avoided on purpose, and when it would be worth adding. */
  readonly avoided: readonly string[];
}

/**
 * A real case retold from a company's own public engineering post (see "Field notes" in
 * CLAUDE.md). Unlike a design, it follows the story of one change rather than the interview
 * framework.
 */
export interface FieldNote {
  readonly slug: string;
  readonly company: string;
  readonly title: string;
  readonly summary: string;
  readonly minutes?: number;
  /** The company's own post the note is based on. */
  readonly source: { readonly title: string; readonly url: string; readonly year: number };
  /** The situation before the change: what the system did and why it started to hurt. */
  readonly context: readonly string[];
  /** The change, told as problem → fix. Numbers here come from the source post. */
  readonly walkthrough: Walkthrough;
  /** What the change cost or left unsolved. */
  readonly tradeoffs: readonly string[];
  /** The general patterns to reuse in an interview. */
  readonly takeaways: readonly string[];
  /** Slugs of designs on this site that use the same ideas. */
  readonly related?: readonly string[];
}
