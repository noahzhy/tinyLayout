import {describe, expect, it} from 'vitest';
import {benchmarkRoute} from '../src/synthetic/mapping-benchmark';
import {makeLayout, segmentFree} from '../src/synthetic/layout';
import {defaults} from '../src/synthetic/types';
import {topologyEvidence} from '../src/synthetic/topology-evidence';
import {fromChart} from '../src/synthetic/labels';

describe('fixed causal mapping route (not learned predictions)', () => {
  const layout = makeLayout({...defaults,seed:117,family:'T'});
  it('is reproducible, collision-free, revisits T and restarts without a connecting traversal', () => {
    const a = benchmarkRoute(layout), b = benchmarkRoute(layout);
    expect(a).toEqual(b);
    const first = a.checkpoints.find(p=>p.name==='first_T')!, back = a.checkpoints.find(p=>p.name==='return_T')!, other = a.checkpoints.find(p=>p.name==='similar_T')!;
    expect(first.node_id).toBe(back.node_id); expect(other.node_id).not.toBe(first.node_id);
    for (const point of a.checkpoints) expect((a.frames.findIndex(f=>f.frame_id===point.frame_id)+1)%4).toBe(0);
    for (let i=1;i<a.frames.length;i++) {
      const p=a.frames[i-1],q=a.frames[i];
      if(p.segment_id===q.segment_id) {
        expect(segmentFree(p.position.slice(0,2) as [number,number],q.position.slice(0,2) as [number,number],layout.solids)).toBe(true);
        expect(Math.hypot(p.position[0]-q.position[0],p.position[1]-q.position[1])).toBeLessThanOrEqual(.421);
        expect(Math.abs(Math.atan2(Math.sin(p.yaw-q.yaw),Math.cos(p.yaw-q.yaw)))).toBeLessThanOrEqual(.181);
      }
    }
    for (const tr of a.traversals) {
      expect(new Set(tr.frame_ids.map(id=>a.frames.find(f=>f.frame_id===id)!.segment_id)).size).toBe(1);
      expect(tr.segment_id).toBe('segment_0');
    }
    expect(new Set(a.frames.map(f=>f.segment_id)).size).toBe(2);
    expect(a.traversals.some(t=>a.traversals.some(u=>u.source===t.target&&u.target===t.source))).toBe(true);
  });
  it('empty or occluder-only evidence never labels GT ports as visible', () => {
    const anchor=benchmarkRoute(layout).frames[0];
    const label=topologyEvidence(layout,anchor,[{frame:anchor,hits:[]}],'c');
    expect(label.nodes.every(n=>n.state==='unknown'&&!n.kind_valid&&n.ports.every(p=>p.state==='unknown'&&!p.evidence_frame_ids.length))).toBe(true);
    expect(label.connectivity_observed).toBe(false);
    const cart=layout.solids.findIndex(s=>s.kind==='occluder')+2;
    const blocked=topologyEvidence(layout,anchor,[{frame:anchor,hits:[{x:anchor.position[0],y:3,z:0,instance:cart}]}],'c');
    expect(blocked.nodes.every(n=>n.state==='unknown')).toBe(true);
  });
  it('three openings support a coarse junction; T/X subtype and connectivity stay unverified', () => {
    const node=layout.graph.nodes.find(n=>n.ports.length===3)!, anchor={...benchmarkRoute(layout).frames[0],position:[node.xy[0],node.xy[1]-3,1.55] as [number,number,number]};
    const points=[{x:node.xy[0],y:node.xy[1],z:0,instance:1},...node.ports.flatMap(p=>[.35,.75].map(t=>({x:node.xy[0]+p.direction[0]*t,y:node.xy[1]+p.direction[1]*t,z:0,instance:1})))];
    const evidence=topologyEvidence(layout,anchor,[{frame:anchor,hits:points}],'c'), result=evidence.nodes.find(n=>n.gt_node_id===node.id)!;
    expect(result.state).toBe('supported'); expect(result.kind_valid).toBe(true);expect(result.subtype_valid).toBe(false);
    expect(result.ports.every(p=>p.evidence_frame_ids[0]===anchor.frame_id)).toBe(true);
    expect(evidence.connectivity_observed).toBe(false);
    const twoPorts=[points[0],...points.slice(1,5)];
    expect(topologyEvidence(layout,anchor,[{frame:anchor,hits:twoPorts}],'c').nodes.find(n=>n.gt_node_id===node.id)!.state).toBe('unknown');
  });
  it('shelf face witnesses require measured side normals and retain only the seen surface position', () => {
    const frame=benchmarkRoute(layout).frames[0], shelf=layout.solids.find(s=>s.kind==='shelf')!, id=layout.solids.indexOf(shelf)+2;
    const anchor={...frame,position:[shelf.x-2,shelf.y-2,1.55] as [number,number,number]};
    const points=[0,.1,.2].map(d=>({x:shelf.x-shelf.w/2,y:shelf.y-2+d,z:1,instance:id,normal:[-1,0,0] as [number,number,number]}));
    const good=topologyEvidence(layout,anchor,[{frame:anchor,hits:points}],'c');
    expect(good.shelf_faces).toHaveLength(1);
    expect(fromChart(good.shelf_faces[0].xy,anchor,layout.config.chart_span_m)[1]).toBeCloseTo(shelf.y-1.9);
    const roof=points.map(h=>({...h,normal:[0,0,1] as [number,number,number]}));
    expect(topologyEvidence(layout,anchor,[{frame:anchor,hits:roof}],'c').shelf_faces).toHaveLength(0);
  });
});
