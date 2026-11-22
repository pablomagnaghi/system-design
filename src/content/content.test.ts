import { describe, expect, it } from 'vitest';
import { unknownParticipants } from '../lib/request-flow';
import { designs, fieldNotes, getDesign } from './index';

// Designs and field notes share the walkthrough rules.
const walkthroughs = [
  ...designs.map((design) => design.highLevel),
  ...fieldNotes.map((note) => note.walkthrough),
];

describe('designs', () => {
  it('have unique, URL-safe slugs', () => {
    const slugs = designs.map((design) => design.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('can be looked up by slug', () => {
    expect(getDesign('rate-limiter')?.title).toContain('rate limiter');
    expect(getDesign('missing')).toBeUndefined();
  });

  it('cover every step of the framework', () => {
    for (const design of designs) {
      expect(design.requirements.functional.length).toBeGreaterThan(0);
      expect(design.requirements.nonFunctional.length).toBeGreaterThan(0);
      expect(design.entities.length).toBeGreaterThan(0);
      expect(design.api.length).toBeGreaterThan(0);
      expect(design.dataFlow.length).toBeGreaterThan(0);
      expect(design.deepDives.length).toBeGreaterThan(0);
      for (const dive of design.deepDives) expect(dive.options.length).toBeGreaterThan(1);
    }
  });

  it('explain the trade-off of every stage of the diagram', () => {
    for (const walkthrough of walkthroughs) {
      for (const stage of walkthrough.stages) expect(stage.tradeoff.length).toBeGreaterThan(40);
    }
  });

  it('have diagrams whose stages only reference existing nodes and edges', () => {
    for (const highLevel of walkthroughs) {
      const nodeIds = new Set(highLevel.nodes.map((node) => node.id));
      expect(nodeIds.size).toBe(highLevel.nodes.length);
      for (const node of highLevel.nodes) {
        expect(node.column).toBeGreaterThanOrEqual(0);
        expect(node.column).toBeLessThanOrEqual(5);
      }
      const positions = highLevel.nodes.map((node) => `${node.column}:${node.row}`);
      expect(new Set(positions).size).toBe(positions.length);
      const edgeKeys = new Set(highLevel.edges.map(([from, to]) => `${from}>${to}`));
      for (const [from, to] of highLevel.edges) {
        expect(nodeIds).toContain(from);
        expect(nodeIds).toContain(to);
      }
      for (const stage of highLevel.stages) {
        for (const id of stage.nodes) expect(nodeIds).toContain(id);
        for (const [from, to] of stage.travel) expect(edgeKeys).toContain(`${from}>${to}`);
      }
      // A stage-limited edge must exist and may only carry traffic in the stages that draw it.
      for (const { edge, stages } of highLevel.edgeStages ?? []) {
        expect(edgeKeys).toContain(`${edge[0]}>${edge[1]}`);
        highLevel.stages.forEach((stage, index) => {
          const uses = stage.travel.some(([f, t]) => f === edge[0] && t === edge[1]);
          if (uses) expect(stages, `${edge.join('>')} at stage ${index}`).toContain(index);
        });
      }
    }
  });

  // A design can grow stage by stage: nothing may light up, carry load or carry traffic before
  // its node has appeared.
  it('only use nodes that have already appeared in each stage', () => {
    for (const highLevel of walkthroughs) {
      const appearsAt = new Map(highLevel.nodes.map((node) => [node.id, node.appearsAt ?? 0]));
      const edgeKeys = new Set(highLevel.edges.map(([from, to]) => `${from}>${to}`));
      for (const node of highLevel.nodes) {
        expect(node.appearsAt ?? 0).toBeGreaterThanOrEqual(0);
        expect(node.appearsAt ?? 0).toBeLessThan(highLevel.stages.length);
      }
      highLevel.stages.forEach((stage, index) => {
        const visible = (id: string) => (appearsAt.get(id) ?? Infinity) <= index;
        for (const id of stage.nodes) expect(visible(id), `${id} at stage ${index}`).toBe(true);
        for (const [from, to] of stage.travel) expect(visible(from) && visible(to)).toBe(true);
        for (const { edge } of stage.traffic ?? []) {
          expect(edgeKeys).toContain(`${edge[0]}>${edge[1]}`);
          expect(visible(edge[0]) && visible(edge[1])).toBe(true);
        }
        for (const [id, value] of Object.entries(stage.load ?? {})) {
          expect(visible(id), `load on ${id} at stage ${index}`).toBe(true);
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
        }
      });
    }
  });

  it('keep stage metrics and timeline labels consistent', () => {
    for (const item of [...designs, ...fieldNotes]) {
      if (item.minutes !== undefined) expect(item.minutes).toBeGreaterThan(0);
    }
    for (const walkthrough of walkthroughs) {
      for (const stage of walkthrough.stages) {
        if (stage.short !== undefined) {
          expect(stage.short.length).toBeGreaterThan(0);
          expect(stage.short.length).toBeLessThanOrEqual(16);
        }
        const metrics = stage.metrics;
        for (const key of metrics?.alerts ?? []) expect(metrics?.[key]).toBeDefined();
        const labels = (metrics?.custom ?? []).map((metric) => metric.label);
        expect(new Set(labels).size).toBe(labels.length);
        for (const label of labels) {
          expect(label.length).toBeGreaterThan(0);
          expect(label.length).toBeLessThanOrEqual(24);
        }
      }
    }
  });
});

describe('field notes', () => {
  it('have unique, URL-safe slugs', () => {
    const slugs = fieldNotes.map((note) => note.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]+$/);
  });

  it('link the company post they are based on', () => {
    for (const note of fieldNotes) {
      expect(note.source.url).toMatch(/^https:\/\//);
      expect(note.source.title.length).toBeGreaterThan(0);
      expect(note.source.year).toBeGreaterThan(2000);
    }
  });

  it('tell the context, the trade-offs and what to reuse', () => {
    for (const note of fieldNotes) {
      expect(note.context.length).toBeGreaterThan(0);
      expect(note.tradeoffs.length).toBeGreaterThan(0);
      expect(note.takeaways.length).toBeGreaterThan(0);
    }
  });

  it('only relate to designs that exist', () => {
    const slugs = new Set(designs.map((design) => design.slug));
    for (const note of fieldNotes)
      for (const slug of note.related ?? []) expect(slugs).toContain(slug);
  });
});

// The depth sections are optional, but when a design has one it must be complete enough to teach.
describe('design depth sections', () => {
  const filled = (text: string) => text.trim().length > 20;

  it('state guarantees with their assumptions and limits', () => {
    for (const { slug, guarantees } of designs) {
      if (!guarantees) continue;
      expect(guarantees.provides.length, slug).toBeGreaterThan(0);
      for (const g of guarantees.provides)
        expect(filled(g.promise), `${slug}: ${g.property}`).toBe(true);
      expect(guarantees.assumes.length, slug).toBeGreaterThan(0);
      expect(guarantees.doesNotGuarantee.length, slug).toBeGreaterThan(0);
    }
  });

  it('describe each failure with impact, detection and recovery', () => {
    for (const { slug, failures } of designs) {
      for (const f of failures ?? []) {
        for (const part of [f.scenario, f.impact, f.detection, f.recovery])
          expect(filled(part), `${slug}: ${f.scenario}`).toBe(true);
      }
    }
  });

  it('show the math behind every capacity estimate and what it implies', () => {
    for (const { slug, capacity } of designs) {
      if (!capacity) continue;
      expect(capacity.assumptions.length, slug).toBeGreaterThan(0);
      expect(capacity.estimates.length, slug).toBeGreaterThan(0);
      for (const e of capacity.estimates)
        expect(e.math.trim().length, `${slug}: ${e.label}`).toBeGreaterThan(0);
      expect(capacity.implications.length, slug).toBeGreaterThan(0);
    }
  });

  it('explain how the design evolves', () => {
    for (const { slug, evolution } of designs) {
      if (!evolution) continue;
      expect(filled(evolution.mvp), slug).toBe(true);
      expect(filled(evolution.firstBottleneck), slug).toBe(true);
      expect(evolution.atScale.length, slug).toBeGreaterThan(0);
      expect(evolution.avoided.length, slug).toBeGreaterThan(0);
    }
  });

  it('map the infrastructure part by part, with the limits it must respect', () => {
    for (const { slug, infrastructure } of designs) {
      if (!infrastructure) continue;
      expect(infrastructure.provider.trim().length, slug).toBeGreaterThan(0);
      expect(filled(infrastructure.intro), slug).toBe(true);
      expect(infrastructure.items.length, slug).toBeGreaterThan(0);
      for (const item of infrastructure.items) {
        expect(item.part.trim().length > 0 && item.service.trim().length > 0, slug).toBe(true);
        expect(filled(item.why), slug).toBe(true);
      }
      expect(infrastructure.limits.length, slug).toBeGreaterThan(0);
    }
  });

  it('tie each alarm to a metric and say what it means', () => {
    for (const { slug, alarms } of designs) {
      for (const alarm of alarms ?? []) {
        expect(alarm.name.trim().length > 0 && filled(alarm.metric), `${slug}: ${alarm.name}`).toBe(
          true,
        );
        expect(filled(alarm.meaning), `${slug}: ${alarm.name}`).toBe(true);
      }
    }
  });

  it('draw request flows whose steps name declared participants and explain themselves', () => {
    for (const { slug, flows } of designs) {
      for (const flow of flows ?? []) {
        expect(unknownParticipants(flow), `${slug}: ${flow.id}`).toEqual([]);
        expect(flow.participants.length, `${slug}: ${flow.id}`).toBeLessThanOrEqual(6);
        expect(filled(flow.summary) && flow.runsOn.trim().length > 0, `${slug}: ${flow.id}`).toBe(
          true,
        );
        for (const step of flow.steps) {
          expect(filled(step.note), `${slug}: ${flow.id}: ${step.label}`).toBe(true);
        }
      }
      if (flows) expect(new Set(flows.map((f) => f.id)).size, slug).toBe(flows.length);
    }
  });

  it('state each SLO with a target and the metric behind it', () => {
    for (const { slug, slos } of designs) {
      for (const slo of slos ?? []) {
        expect(slo.objective.trim().length > 0 && slo.target.trim().length > 0, slug).toBe(true);
        expect(filled(slo.measure), `${slug}: ${slo.objective}`).toBe(true);
      }
    }
  });
});

// Precision rules (CLAUDE.md): absolute delivery and durability claims are the mistakes an audit
// found most often. Each reviewed use is counted here; a new one fails until it is checked
// against the rules (condition stated, dedup key named, or the claim negated) and added.
describe('precision guard', () => {
  const RISKY = /exactly[- ]once|sent once|never los[te]/gi;
  const REVIEWED: Record<string, number> = {
    'ad-click-aggregator': 1,
    'chat-messaging': 2,
    'collaborative-editor': 1,
    'file-sync': 2,
    'job-scheduler': 3,
    'news-aggregator': 1,
    'payment-webhooks': 2,
    'photo-sharing': 1,
    'stock-trading': 1,
    'video-streaming': 1,
  };

  it('has no unreviewed "exactly once", "sent once" or "never lost" claim', () => {
    for (const item of [...designs, ...fieldNotes]) {
      const found = JSON.stringify(item).match(RISKY)?.length ?? 0;
      expect(found, item.slug).toBeLessThanOrEqual(REVIEWED[item.slug] ?? 0);
    }
  });
});
