import {describe, it, expect} from 'vitest';
import {defaults, parseConfig, type Family, type CameraFrame} from '../src/synthetic/types';
import {makeFrames, makeLayout, segmentFree,footprintHash,contains} from '../src/synthetic/layout';
import {contextAnchor} from '../src/synthetic/types';
import {toChart, fromChart, makeLabels, rasterize, supportFromHits} from '../src/synthetic/labels';
import {decodeDepth} from '../src/synthetic/render';

describe('deterministic physical layouts', () => {
  it.each(['grid', 'cross', 'T', 'dead_end'] as Family[])('%s graph is collision-free, trajectories are segment-safe', family => {
    const layout = makeLayout({...defaults, family});
    expect(layout).toEqual(makeLayout({...defaults, family}));
    for (const e of layout.graph.edges) expect(segmentFree(e.polyline[0], e.polyline[1], layout.solids.filter(s => s.kind !== 'occluder'))).toBe(true);
    for (const task of [0, 1]) expect(makeFrames(layout, task)).toHaveLength(32);
    const restarted = makeFrames(layout, 1), middle = Math.floor(restarted.length / 2);
    expect(restarted[0].timestamp_s).toBeGreaterThan(makeFrames(layout,0).at(-1)!.timestamp_s);
    expect(restarted[middle].segment_id).not.toBe(restarted[middle - 1].segment_id);
    expect(Math.hypot(restarted[middle].position[0] - restarted[middle - 1].position[0], restarted[middle].position[1] - restarted[middle - 1].position[1])).toBeGreaterThan(5);
    for (const n of layout.graph.nodes) expect(n.ports.map(p => p.angle)).toEqual(n.ports.map(p => p.angle).sort((a, b) => a - b));
    expect(layout.graph.nodes.every(n => n.ports.length > 0)).toBe(true);
  });
  it('store identity ignores trajectory changes and changes with geometry', () => {
    const grid = {...defaults,family:'grid' as const},a = makeLayout(grid);
    expect(makeLayout({...grid, trajectory: 'reverse'}).store_id).toBe(a.store_id);
    expect(makeLayout({...grid, seed: 18}).layout_hash).not.toBe(a.layout_hash);
    expect(makeLayout({...defaults, family: 'cross'}).graph.edges.length).toBeGreaterThan(a.graph.edges.length);
  });
  it('invalid dimensions and unknown config fail before export', () => {
    expect(() => parseConfig({...defaults, width: 8})).toThrow(/fit/);
    expect(() => parseConfig({...defaults, future_option: true})).toThrow(/unknown/);
    expect(() => parseConfig({...defaults, seed: true})).toThrow(/seed/);
  });
  it('2D identity ignores height and each layout family varies its actual footprint', () => {
    for(const family of ['grid','cross','T','dead_end'] as Family[]) {
      const a=makeLayout({...defaults,family,seed:17}),b=makeLayout({...defaults,family,seed:18});
      expect(a.layout_hash).not.toBe(b.layout_hash);
      expect(footprintHash(a.solids.map(s=>({...s,h:s.h+1})),a.config.width,a.config.length)).toBe(a.layout_hash);
    }
  });
  it('mapped outer aisle endpoints have physical partitions and dead-end back bay remains reachable', () => {
    const layout=makeLayout({...defaults,family:'T'}), middle=layout.graph.nodes.filter(n=>n.ports.length===3&&n.xy[1]>2.01&&n.xy[1]<defaults.length-2.01).sort((a,b)=>a.xy[0]-b.xy[0]);
    expect(layout.solids.some(s=>contains(s,[middle[0].xy[0]-defaults.aisle_width/2,middle[0].xy[1]]))).toBe(true);
    expect(layout.solids.some(s=>contains(s,[middle.at(-1)!.xy[0]+defaults.aisle_width/2+.02,middle.at(-1)!.xy[1]]))).toBe(true);
    const dead=makeLayout({...defaults,family:'dead_end'}),bay=dead.graph.nodes.find(n=>n.kind==='dead_end'&&n.xy[1]===defaults.length-2)!;
    expect(bay.ports).toHaveLength(1);
  });
  it('latest observed frame anchors the chart and cannot cross a segment', () => {
    const frames=makeFrames(makeLayout(defaults));expect(contextAnchor(frames.slice(0,4))).toBe(frames[3]);
    expect(()=>contextAnchor([])).toThrow(/observed/);
    expect(()=>contextAnchor([frames[0],{...frames[1],segment_id:'restart'}])).toThrow(/boundary/);
  });
  it('dead-end capture goes around the cart and the barrier has no side gap', () => {
    const layout=makeLayout({...defaults,family:'dead_end'}),frames=makeFrames(layout,1),last=frames.at(-1)!;
    const dead=layout.graph.nodes.find(n=>n.kind==='dead_end'&&n.xy[1]<defaults.length-2)!;
    expect(Math.hypot(last.position[0]-dead.xy[0],last.position[1]-dead.xy[1])).toBeLessThan(.01);
    const shelf=layout.solids.filter(s=>s.kind==='shelf').sort((a,b)=>a.x-b.x).at(-1)!;
    expect(shelf.y+shelf.d/2).toBeCloseTo(defaults.length-4);
  });
});
describe('chart and evidence masks', () => {
  const anchor: CameraFrame = {frame_id: 'a', task_id: 'task', segment_id: 's', timestamp_s: 1, position: [6, 6, 1.55], yaw: Math.PI / 2, pitch: 0, roll: 0};
  it('side-facing chart uses horizontal optical axis, with inverse roundtrip', () => {
    expect(toChart([7, 6], anchor, 12)[1]).toBeCloseTo(1 / 6);
    expect(toChart([6, 5], anchor, 12)[0]).toBeCloseTo(1 / 6);
    for (const point of [[.5, -.7], [-.2, .9]] as [number, number][]) {
      const actual = toChart(fromChart(point, anchor, 12), anchor, 12);
      expect(actual[0]).toBeCloseTo(point[0]); expect(actual[1]).toBeCloseTo(point[1]);
    }
  });
  it('unobserved GT does not create support; a visible side is local', () => {
    const layout = makeLayout(defaults), f = makeFrames(layout)[0], full = rasterize(layout, f);
    expect(supportFromHits(layout, f, [], full.semantic).some(Boolean)).toBe(false);
    const shelf = layout.solids.find(s => s.kind === 'shelf')!, id = layout.solids.indexOf(shelf) + 2;
    const single = supportFromHits(layout, f, [{x: shelf.x - shelf.w / 2 + .01, y: shelf.y, z: 1, instance: id}], full.semantic);
    expect(single.filter(Boolean).length).toBeLessThanOrEqual(1);
    const label = makeLabels(layout, f, [], [], 'c');
    expect(label.semantic_labels.every(v => v === -1)).toBe(true);
    expect(label.target_region.some(Boolean)).toBe(false);
  });
  it('temporary occluders do not certify underlying static ground', () => {
    const layout = makeLayout(defaults), f = makeFrames(layout)[0], full = rasterize(layout, f);
    const cart = layout.solids.find(s => s.kind === 'occluder')!, id = layout.solids.indexOf(cart) + 2;
    expect(supportFromHits(layout, f, [{x: cart.x, y: cart.y, z: 1, instance: id}], full.semantic).some(Boolean)).toBe(false);
  });
  it('vertical anchors disable all dense supervision', () => {
    const layout = makeLayout(defaults), f = {...makeFrames(layout)[0], pitch: Math.PI / 2};
    const label = makeLabels(layout, f, [{x: 6, y: 4, z: 0, instance: 1}], [], 'invalid');
    expect(label.context_support.some(Boolean)).toBe(false);
    expect(label.support_valid.some(Boolean)).toBe(false);
  });
  it('packed depth follows the installed r180 shader, no byte reversal', () => {
    expect(decodeDepth(new Uint8Array([128, 0, 0, 0]))).toBe(.5);
    expect(decodeDepth(new Uint8Array([255, 255, 255, 255]))).toBeCloseTo(1, 12);
  });
});
