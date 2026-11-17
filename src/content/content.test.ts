import { describe, expect, it } from 'vitest';
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
