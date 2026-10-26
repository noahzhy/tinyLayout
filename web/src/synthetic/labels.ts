import type {CameraFrame, Hit, Layout, Solid, XY} from './types';

export function toChart(p: XY, anchor: CameraFrame, span: number): XY {
  const dx = p[0] - anchor.position[0], dy = p[1] - anchor.position[1];
  return [2 * (dx * Math.cos(anchor.yaw) - dy * Math.sin(anchor.yaw)) / span,
    2 * (dx * Math.sin(anchor.yaw) + dy * Math.cos(anchor.yaw)) / span];
}
export function fromChart(p: XY, anchor: CameraFrame, span: number): XY {
  const x = p[0] * span / 2, y = p[1] * span / 2;
  return [anchor.position[0] + x * Math.cos(anchor.yaw) + y * Math.sin(anchor.yaw),
    anchor.position[1] - x * Math.sin(anchor.yaw) + y * Math.cos(anchor.yaw)];
}
function intersects(poly: XY[], solid: Solid): boolean {
  const rect: XY[] = [[solid.x - solid.w / 2, solid.y - solid.d / 2], [solid.x + solid.w / 2, solid.y - solid.d / 2],
    [solid.x + solid.w / 2, solid.y + solid.d / 2], [solid.x - solid.w / 2, solid.y + solid.d / 2]];
  const axes: XY[] = [[1, 0], [0, 1], [poly[1][1] - poly[0][1], poly[0][0] - poly[1][0]], [poly[2][1] - poly[1][1], poly[1][0] - poly[2][0]]];
  return axes.every(axis => {const a = poly.map(p => p[0] * axis[0] + p[1] * axis[1]), b = rect.map(p => p[0] * axis[0] + p[1] * axis[1]); return Math.max(...a) > Math.min(...b) + 1e-8 && Math.max(...b) > Math.min(...a) + 1e-8;});
}
export function rasterize(layout: Layout, anchor: CameraFrame): {semantic: number[]; boundary: number[]; opening: number[]} {
  const c = layout.config, n = c.bev_size, semantic: number[] = [], boundary: number[] = [], opening: number[] = [];
  for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) {
    const x = -1 + 2 * col / n, y = 1 - 2 * row / n;
    const corners = [[x, y], [x + 2 / n, y], [x + 2 / n, y - 2 / n], [x, y - 2 / n]].map(p => fromChart(p as XY, anchor, c.chart_span_m));
    let cls = corners.every(p => p[0] >= 0 && p[0] <= c.width && p[1] >= 0 && p[1] <= c.length) ? 0 : -1;
    for (const solid of layout.solids) if (solid.semantic >= 0 && intersects(corners, solid)) cls = Math.max(cls, solid.semantic);
    semantic.push(cls); boundary.push(cls > 0 ? 1 : 0);
    const center: XY = [x + 1 / n, y - 1 / n];
    opening.push(layout.graph.nodes.some(node => {const q = toChart(node.xy, anchor, c.chart_span_m); return Math.hypot(q[0] - center[0], q[1] - center[1]) < 2 / n && node.ports.length >= 3;}) ? 1 : 0);
  }
  return {semantic, boundary, opening};
}
export function supportFromHits(layout: Layout, anchor: CameraFrame, hits: Hit[], semantic: number[]): boolean[] {
  const c = layout.config, n = c.bev_size, support = Array(n * n).fill(false) as boolean[];
  for (const hit of hits) {
    const cls = hit.instance === 1 ? 0 : layout.solids[hit.instance - 2]?.semantic ?? -1;
    if (cls < 0) continue;
    const [x, y] = toChart([hit.x, hit.y], anchor, c.chart_span_m);
    const col = Math.floor((x + 1) * n / 2), row = Math.floor((1 - y) * n / 2);
    if (row >= 0 && col >= 0 && row < n && col < n && semantic[row * n + col] === cls) support[row * n + col] = true;
  }
  return support;
}
export function makeLabels(layout: Layout, anchor: CameraFrame, contextHits: Hit[], teacherHits: Hit[], chartId: string) {
  const full = rasterize(layout, anchor), n = layout.config.bev_size;
  const valid = Math.abs(Math.cos(anchor.pitch)) > 1e-3;
  const context = valid ? supportFromHits(layout, anchor, contextHits, full.semantic) : Array(n * n).fill(false) as boolean[];
  const teacher = valid ? supportFromHits(layout, anchor, teacherHits, full.semantic) : Array(n * n).fill(false) as boolean[];
  const labelValid = context.map((v, i) => v && full.semantic[i] >= 0);
  return {schema_version: '1.0', taxonomy: 'structmap_semantics_v1', chart_id: chartId, grid_shape: [n, n],
    source: 'synthetic_geometry_and_rendered_first_surface_v1', context_support: context, teacher_support: teacher,
    target_region: teacher.map((v, i) => v && !context[i]), label_valid: labelValid,
    semantic_labels: full.semantic.map((v, i) => labelValid[i] ? v : -1),
    boundary_labels: full.boundary, opening_labels: full.opening,
    boundary_valid: labelValid, opening_valid: labelValid,
    support_valid: Array(n * n).fill(valid) as boolean[],
    // Full footprint is privileged, retained exclusively for QA/supervision.
    full_semantic_gt: full.semantic};
}
export function localGraph(layout: Layout, anchor: CameraFrame, chartId: string) {
  const nodes = layout.graph.nodes.map(n => ({...n, xy: toChart(n.xy, anchor, layout.config.chart_span_m), ports: n.ports.map(p => {
    const direction: XY = [p.direction[0] * Math.cos(anchor.yaw) - p.direction[1] * Math.sin(anchor.yaw), p.direction[0] * Math.sin(anchor.yaw) + p.direction[1] * Math.cos(anchor.yaw)];
    return {...p, direction, angle: Math.atan2(direction[1], direction[0])};
  }).sort((a, b) => a.angle - b.angle)})).filter(n => Math.abs(n.xy[0]) <= 1 && Math.abs(n.xy[1]) <= 1);
  const ids = new Set(nodes.map(n => n.id));
  const edges = layout.graph.edges.filter(e => ids.has(e.a) && ids.has(e.b));
  return {gt_only: true, chart_id: chartId, coordinate_system: 'normalized_chart_xy', nodes,
    edges: edges.map(e => ({...e, polyline: e.polyline.map(p => toChart(p, anchor, layout.config.chart_span_m))})),
    order: layout.graph.order.filter(id => ids.has(id)), boundaries: layout.graph.boundaries.filter(b => edges.some(e => e.id === b.edge_id)),
    truncated_node_ids: layout.graph.nodes.filter(n => !ids.has(n.id)).map(n => n.id)};
}
