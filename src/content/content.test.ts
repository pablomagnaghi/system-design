import { describe, expect, it } from 'vitest';
import { designs, getDesign } from './index';

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
    for (const design of designs) {
      for (const stage of design.highLevel.stages)
        expect(stage.tradeoff.length).toBeGreaterThan(40);
    }
  });

  it('have diagrams whose stages only reference existing nodes and edges', () => {
    for (const { highLevel } of designs) {
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
});
