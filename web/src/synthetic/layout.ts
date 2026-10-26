import {type CameraFrame, type GraphNode, type Layout, type SceneConfig, type Solid, type XY, parseConfig, rng} from './types';
import {contains,segmentFree,footprintHash} from './geometry';
import {makeDiverseLayout,makeDiverseFrames} from './diverse-layout';
export {contains,segmentFree,footprintHash} from './geometry';

export function makeLayout(input: SceneConfig): Layout {
  const c = parseConfig(input), random = rng(c.seed);
  if(['mixed','islands','rooms'].includes(c.family))return makeDiverseLayout(c);
  const margin = (c.width - c.shelf_rows - (c.shelf_rows + 1) * c.aisle_width) / 2;
  const xs = Array.from({length: c.shelf_rows + 1}, (_, i) => margin + c.aisle_width / 2 + i * (1 + c.aisle_width));
  // Seed changes physical geometry independently of textures and trajectories.
  const mid = c.length / 2 + (random() - .5) * 1.2;
  const solids: Solid[] = [];
  const add = (id: string, kind: Solid['kind'], x: number, y: number, w: number, d: number, h: number, semantic: number) => solids.push({id, kind, x, y, w, d, h, semantic});
  add('back_wall', 'wall', c.width / 2, c.length, c.width, .2, 2.8, 2);
  add('left_wall', 'wall', 0, c.length / 2, .2, c.length, 2.8, 2);
  add('right_wall', 'wall', c.width, c.length / 2, .2, c.length, 2.8, 2);
  // Bound the mapped aisle component; exterior margins are separate rooms.
  add('aisle_left_partition', 'wall', margin, c.length / 2, .2, c.length, 2.8, 2);
  add('aisle_right_partition', 'wall', c.width - margin, c.length / 2, .2, c.length, 2.8, 2);
  const entrance = xs[0], half = c.aisle_width / 2;
  add('front_left', 'wall', (entrance - half) / 2, 0, entrance - half, .2, 2.8, 2);
  add('front_right', 'wall', (c.width + entrance + half) / 2, 0, c.width - entrance - half, .2, 2.8, 2);
  for (let i = 0; i < c.shelf_rows; i++) {
    const x = margin + c.aisle_width + i * (1 + c.aisle_width) + .5;
    const cut = c.family === 'cross' || c.family === 'T' && i < Math.ceil(c.shelf_rows / 2);
    const frontSample = 3.4 + random() * .8, backSample = c.length - 4.6 + random() * .5;
    const front = cut ? Math.min(frontSample, mid - c.aisle_width / 2 - .7) : frontSample;
    const back = c.family==='dead_end'&&i===c.shelf_rows-1 ? c.length-4 : cut ? Math.max(backSample, mid + c.aisle_width / 2 + .7) : backSample;
    const ranges = cut ? [[front, mid - c.aisle_width / 2], [mid + c.aisle_width / 2, back]] : [[front, back]];
    for (const [j, [lo, hi]] of ranges.entries()) {
      if (hi <= lo + .5) throw Error(`seed ${c.seed}: cross aisle leaves invalid shelf length`);
      add(`shelf_${i}_${j}`, 'shelf', x, (lo + hi) / 2, 1, hi - lo, 1.85 + random() * .15, 1);
    }
  }
  const cabinetWidth = Math.min(.6, c.aisle_width * .2);
  add('cold_cabinet', 'cabinet', margin + .1 + cabinetWidth / 2, c.length / 2, cabinetWidth, 5, 2.1, 1);
  if (c.family === 'dead_end') add('end_barrier', 'wall', xs.at(-1)!, c.length - 3.7, c.aisle_width + 1, .25, 2.4, 2);
  // Opaque temporary object: blocks visibility but never certifies static floor.
  add('cart', 'occluder', xs.at(-1)!, 5.5, .65, .8, 1.25, -1);
  for (let i = 0; i < solids.length; i++) for (let j = i + 1; j < solids.length; j++) {
    const a = solids[i], b = solids[j];
    if (a.kind === 'wall' && b.kind === 'wall') continue;
    if (Math.abs(a.x - b.x) < (a.w + b.w) / 2 - .01 && Math.abs(a.y - b.y) < (a.d + b.d) / 2 - .01) throw Error(`seed ${c.seed}: overlapping ${a.id}/${b.id}`);
  }
  const nodes: GraphNode[] = [], edges: Layout['graph']['edges'] = [];
  const node = (x: number, y: number, kind = 'junction'): GraphNode => {
    let n = nodes.find(n => Math.abs(n.xy[0] - x) < 1e-6 && Math.abs(n.xy[1] - y) < 1e-6);
    if (!n) {n = {id: `n${nodes.length}`, kind, xy: [x, y], ports: []}; nodes.push(n);} return n;
  };
  const connect = (a: GraphNode, b: GraphNode) => {
    if (!segmentFree(a.xy, b.xy, solids.filter(s => s.kind !== 'occluder'))) throw Error(`seed ${c.seed}: GT edge collision ${a.id}/${b.id}`);
    const length = Math.hypot(b.xy[0] - a.xy[0], b.xy[1] - a.xy[1]);
    const d: XY = [(b.xy[0] - a.xy[0]) / length, (b.xy[1] - a.xy[1]) / length];
    const ap = `${a.id}:p${a.ports.length}`, bp = `${b.id}:p${b.ports.length}`;
    a.ports.push({id: ap, direction: d, angle: Math.atan2(d[1], d[0])});
    b.ports.push({id: bp, direction: [-d[0], -d[1]], angle: Math.atan2(-d[1], -d[0])});
    edges.push({id: `e${edges.length}`, a: a.id, b: b.id, a_port: ap, b_port: bp, polyline: [a.xy, b.xy]});
  };
  const ys = c.family === 'cross' || c.family === 'T' ? [2, mid, c.length - 2] : [2, c.length - 2];
  for (let i = 0; i < xs.length; i++) {
    if (c.family === 'dead_end' && i === xs.length - 1) {connect(node(xs[i], 2), node(xs[i], c.length - 4.4, 'dead_end')); continue;}
    for (let j = 1; j < ys.length; j++) connect(node(xs[i], ys[j - 1]), node(xs[i], ys[j]));
  }
  for (const y of ys) for (let i = 1; i < xs.length; i++) {
    if (c.family === 'T' && y === mid && i > Math.ceil(c.shelf_rows / 2)) continue;
    connect(node(xs[i - 1], y), node(xs[i], y, c.family === 'dead_end' && y === c.length - 2 && i === xs.length - 1 ? 'dead_end' : 'junction'));
  }
  connect(node(xs[0], .8, 'entrance'), node(xs[0], 2));
  for (const n of nodes) {n.ports.sort((a, b) => a.angle - b.angle); if (n.kind === 'junction' && n.ports.length === 2) n.kind = 'portal';}
  const boundaries: Layout['graph']['boundaries'] = [];
  for (const e of edges) for (const s of solids.filter(s => s.semantic === 1)) {
    const [a, b] = e.polyline, dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
    const t = ((s.x - a[0]) * dx + (s.y - a[1]) * dy) / len2;
    const cross = dx * (s.y - a[1]) - dy * (s.x - a[0]);
    if (t >= 0 && t <= 1 && Math.abs(cross) / Math.sqrt(len2) < c.aisle_width + 1) boundaries.push({object_id: s.id, edge_id: e.id, side: cross > 0 ? 'left' : 'right'});
  }
  const layout_hash = footprintHash(solids, c.width, c.length);
  return {store_id: `synthetic_${layout_hash}`, layout_hash, config: c, solids,
    graph: {gt_only: true, nodes, edges, order: nodes.filter(n => n.xy[1] === 2).sort((a, b) => a.xy[0] - b.xy[0]).map(n => n.id), boundaries}};
}

export function makeFrames(layout: Layout, taskIndex = 0): CameraFrame[] {
  if(['mixed','islands','rooms'].includes(layout.config.family))return makeDiverseFrames(layout,taskIndex);
  const c = layout.config, entrance = layout.graph.nodes.find(n => n.kind === 'entrance')!;
  const x0 = entrance.xy[0];
  // The two leftmost aisles are clear in every family; headings also include side scans.
  const points: XY[] = [[x0, 2], [x0, c.length - 2], [x0 + 1 + c.aisle_width, c.length - 2], [x0 + 1 + c.aisle_width, 2]];
  const frames: CameraFrame[] = [], count = c.frames_per_task;
  for (let i = 0; i < count; i++) {
    const second = taskIndex === 1 && i >= Math.floor(count / 2);
    const local = taskIndex === 1 ? i % Math.floor(count / 2) : i;
    const denominator = taskIndex === 1 ? Math.floor(count / 2) - 1 : count - 1;
    let u = local / denominator;
    // Pause repeats a position without asserting displacement from timestamps.
    if (u > .3 && u < .4) u = .3;
    const reverse = c.trajectory === 'reverse' || second;
    const route = reverse ? [...points].reverse() : points;
    const lengths = route.slice(1).map((p, j) => Math.hypot(p[0] - route[j][0], p[1] - route[j][1]));
    let dist = u * lengths.reduce((a, b) => a + b, 0), j = 0;
    while (j < lengths.length - 1 && dist > lengths[j]) {dist -= lengths[j]; j++;}
    const a = route[j], b = route[j + 1], t = Math.min(1, dist / lengths[j]);
    let x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
    if (taskIndex === 1) {
      x = second ? x0 + 1 + c.aisle_width : x0; y = c.length - 3 - u * (c.length - 6);
      if(second&&c.family==='dead_end') {
        y=3+u*(c.length-7.4);
        const ramp=Math.min(1,Math.max(0,(y-3.5)/.9),Math.max(0,(7.5-y)/.9));
        x=x0+c.shelf_rows*(1+c.aisle_width)-.6*ramp;
      }
    }
    const scan = i % 12 >= 8 ? .7 * Math.sin(i * .65) : .12 * Math.sin(i * .4);
    const yaw = taskIndex === 1 ? (second ? 0 : Math.PI) + scan : Math.atan2(b[0] - a[0], b[1] - a[1]) + scan;
    if (layout.solids.some(s => contains(s, [x, y], .18))) throw Error(`${layout.store_id}/task_${taskIndex}/f${i}: camera collision`);
    frames.push({frame_id: `f${String(i).padStart(3, '0')}`, task_id: `task_${taskIndex}`, segment_id: `segment_${second ? 1 : 0}`,
      timestamp_s: 10 + taskIndex*(count*c.sample_interval_s+20) + i*c.sample_interval_s + (second?10:0), position: [x, y, 1.55], yaw, pitch: -.12 + .04 * Math.sin(i), roll: .025 * Math.sin(i * .7)});
  }
  for (let i = 1; i < frames.length; i++) if (frames[i].segment_id === frames[i - 1].segment_id && !segmentFree(frames[i - 1].position.slice(0, 2) as XY, frames[i].position.slice(0, 2) as XY, layout.solids)) throw Error(`${layout.store_id}: trajectory segment collision ${i}`);
  return frames;
}

export function counterfactualLayout(layout:Layout,visibleInstances:number[]=[]):Layout {
  if(!['mixed','islands','rooms'].includes(layout.config.family))return makeLayout({...layout.config,family:layout.config.family==='grid'?'cross':'grid'});
  const visible=new Set(visibleInstances),target=layout.solids.find((s,i)=>s.semantic===1&&visible.has(i+2))??layout.solids.find(s=>s.semantic===1)!;
  const solids=layout.solids.map(s=>s===target?{...s,...(s.w>s.d?{w:s.w*.55}:{d:s.d*.55})}:s);
  const hash=footprintHash(solids,layout.config.width,layout.config.length);
  return {...layout,solids,layout_hash:hash,store_id:`synthetic_${hash}`};
}
