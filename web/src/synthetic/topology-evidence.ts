import {makeLabels, toChart} from './labels';
import type {CameraFrame, Hit, Layout, XY} from './types';
import {verticalSurfaces} from './vertical-surfaces';

export interface FrameHits {frame: CameraFrame; hits: Hit[]}

/** Positive first-surface witnesses only; absence of hits is unknown. */
export function topologyEvidence(layout: Layout, anchor: CameraFrame, views: FrameHits[], chartId: string, version:'1.1'|'1.2'='1.2') {
  if(version!=='1.1'&&version!=='1.2')throw Error('unsupported topology evidence version');
  const rotate = ([x, y]: XY): XY => [x * Math.cos(anchor.yaw) - y * Math.sin(anchor.yaw), x * Math.sin(anchor.yaw) + y * Math.cos(anchor.yaw)];
  const groundWitnesses = (points: XY[]) => views.filter(v => points.every(p => v.hits.some(h => h.instance === 1 && Math.hypot(h.x - p[0], h.y - p[1]) < .28))).map(v => v.frame.frame_id);
  const nodes = layout.graph.nodes.map(n => {
    const xy = toChart(n.xy, anchor, layout.config.chart_span_m);
    const ports = n.ports.map(p => {
      const refs = groundWitnesses([.35, .75].map(t => [n.xy[0] + p.direction[0] * t, n.xy[1] + p.direction[1] * t] as XY));
      return {gt_port_id: p.id, direction: rotate(p.direction), state: refs.length ? 'supported' : 'unknown', evidence_frame_ids: refs};
    });
    const refs = groundWitnesses([n.xy]);
    const entranceBoundaryRefs=n.kind==='entrance'?views.filter(v=>['front_left','front_right'].every(id=>{
      const wallIndex=layout.solids.findIndex(s=>s.id===id);
      const edgeX=n.xy[0]+(id==='front_left'?-1:1)*layout.config.aisle_width/2;
      return v.hits.filter(h=>h.instance===wallIndex+2&&Math.abs(h.x-edgeX)<.65&&Math.abs(h.y)<.15).length>=3;
    })).map(v=>v.frame.frame_id):[];
    const axes: XY[] = [[1,0],[0,1],[-1,0],[0,-1]];
    const blocked = axes.filter(d=>!n.ports.some(p=>p.direction[0]*d[0]+p.direction[1]*d[1]>.95)).map(direction=>{
      const evidence=views.filter(v=>v.hits.filter(h=>{
        const s=layout.solids[h.instance-2];
        if(!s||s.semantic<1||!h.normal) return false;
        const dx=h.x-n.xy[0],dy=h.y-n.xy[1],along=dx*direction[0]+dy*direction[1],cross=dx*direction[1]-dy*direction[0];
        return along>.25&&along<3&&Math.abs(cross)<.28&&-(h.normal[0]*direction[0]+h.normal[1]*direction[1])>.85;
      }).length>=3).map(v=>v.frame.frame_id);
      return {direction:rotate(direction),evidence_frame_ids:evidence};
    }).filter(p=>p.evidence_frame_ids.length);
    const positive=ports.filter(p=>p.state==='supported').length;
    const structural=n.kind!=='portal'||Math.abs(n.ports[0].direction[0]*n.ports[1].direction[0]+n.ports[0].direction[1]*n.ports[1].direction[1])<.5;
    const complete=positive===ports.length&&positive+blocked.length===4&&structural;
    const entranceSupported=n.kind==='entrance'&&positive>=1&&entranceBoundaryRefs.length>0;
    const supported=!!refs.length&&(positive>=3||complete||entranceSupported);
    // Floor rays support local opening geometry, not node identity/type or a traversal.
    return {gt_node_id: n.id, xy, kind: n.kind, kind_valid:supported,subtype_valid:false,entrance_boundary_refs:entranceBoundaryRefs,
      state:supported?'supported':'unknown',blocked_directions:blocked,evidence_frame_ids: refs, ports};
  }).filter(n => Math.max(...n.xy.map(Math.abs)) <= 1);
  const faces: {gt_object_id: string; face: string; normal: XY; xy: XY; segment:XY[];evidence_frame_ids: string[]}[] = [];
  layout.solids.forEach((s, index) => {
    if (s.kind !== 'shelf' && s.kind !== 'cabinet') return;
    for (const side of [-1, 1]) {
      const position = s.x + side * s.w / 2;
      const observations = views.map(v => ({frame: v.frame, hits: v.hits.filter(h => {
        const xy=toChart([h.x,h.y],anchor,layout.config.chart_span_m);
        return h.instance === index + 2 && Math.abs(h.x - position) < .04 && h.z > .05 && h.z < s.h - .05 && h.normal && h.normal[0]*side>.9 && Math.max(...xy.map(Math.abs))<=1;
      })})).filter(v=>v.hits.length>=3);
      const refs = observations.map(v=>v.frame.frame_id), visible = observations.flatMap(v=>v.hits);
      if (refs.length) faces.push({gt_object_id: s.id, face: side < 0 ? 'x_minus' : 'x_plus', normal: rotate([side, 0]),
        xy: toChart([visible.reduce((s,h)=>s+h.x,0)/visible.length,visible.reduce((s,h)=>s+h.y,0)/visible.length], anchor, layout.config.chart_span_m),
        segment:[Math.min(...visible.map(h=>h.y)),Math.max(...visible.map(h=>h.y))].map(y=>toChart([visible.reduce((s,h)=>s+h.x,0)/visible.length,y],anchor,layout.config.chart_span_m)),evidence_frame_ids: refs});
    }
  });
  const dense=makeLabels(layout,anchor,views.flatMap(v=>v.hits),views.flatMap(v=>v.hits),chartId),size=layout.config.bev_size;
  const allNodes=layout.graph.nodes.map(n=>toChart(n.xy,anchor,layout.config.chart_span_m));
  const negative=dense.label_valid.map((valid,i)=>{
    const xy:XY=[-1+2*(i%size+.5)/size,1-2*(Math.floor(i/size)+.5)/size];
    return valid&&allNodes.every(p=>Math.hypot(xy[0]-p[0],xy[1]-p[1])>.2);
  });
  return {schema_version: version, gt_only: true, chart_id: chartId, source: version==='1.1'?'rendered_first_surface_graph_v2':'rendered_vertical_surface_graph_v3',
    grid_shape:[size,size],node_negative_mask:negative,
    evidence_frame_ids: views.map(v => v.frame.frame_id), nodes, shelf_faces: faces,
    connectivity_observed: false, unknown_is_negative: false, node_kind_supervision_available: nodes.some(n=>n.kind_valid),
    ...(version==='1.2'?{structure_faces:verticalSurfaces(layout,anchor,views)}:{})};
}
