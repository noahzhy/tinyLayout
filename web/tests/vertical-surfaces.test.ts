import {describe,expect,it} from 'vitest';
import {makeLayout} from '../src/synthetic/layout';
import {defaults,type Hit,type CameraFrame} from '../src/synthetic/types';
import {topologyEvidence} from '../src/synthetic/topology-evidence';
import {fromChart} from '../src/synthetic/labels';
import {clipObservedSegment} from '../src/synthetic/vertical-surfaces';

describe('visible vertical surfaces (annotation fixtures, not mapping performance)',()=>{
  it('clips a measured line at the chart boundary without moving it off its supporting line',()=>{
    expect(clipObservedSegment([[.4,-1.1],[.4,1.2]])).toEqual([[.4,-1],[.4,1]]);
    const diagonal=clipObservedSegment([[-.9,-1.1],[1.1,.9]]);
    for(const [x,y] of diagonal){expect(Math.abs(x)).toBeLessThanOrEqual(1);expect(Math.abs(y)).toBeLessThanOrEqual(1);expect(x-y).toBeCloseTo(.2);}
  });
  const layout=makeLayout({...defaults,seed:117,family:'T'});
  const shelf=layout.solids.find(s=>s.kind==='shelf')!;
  const wall=layout.solids.find(s=>s.kind==='wall')!;
  const frame:CameraFrame={frame_id:'observed',task_id:'task',segment_id:'segment',timestamp_s:1,
    position:[shelf.x-2,shelf.y-shelf.d/2-2,1.55],yaw:.35,pitch:-.28,roll:0};
  const hits:Hit[]=[0,.1,.2].flatMap(d=>[
    {x:shelf.x-shelf.w/2,y:shelf.y-shelf.d/2+.3+d,z:1,instance:layout.solids.indexOf(shelf)+2,normal:[-1,0,0] as [number,number,number]},
    {x:shelf.x-shelf.w/2+.1+d,y:shelf.y-shelf.d/2,z:1,instance:layout.solids.indexOf(shelf)+2,normal:[0,-1,0] as [number,number,number]},
  ]);
  it('adds measured end faces while retaining exact legacy node and long-side fields',()=>{
    const old=topologyEvidence(layout,frame,[{frame,hits}],'c','1.1');
    const value=topologyEvidence(layout,frame,[{frame,hits}],'c');
    expect(old.schema_version).toBe('1.1');expect('structure_faces' in old).toBe(false);
    expect(value.schema_version).toBe('1.2');expect(value.nodes).toEqual(old.nodes);expect(value.shelf_faces).toEqual(old.shelf_faces);
    expect(value.structure_faces!.map(f=>f.face)).toEqual(['x_minus','y_minus']);
    const [a,b]=value.structure_faces!;
    expect(a.normal[0]*b.normal[1]-a.normal[1]*b.normal[0]).toBeCloseTo(1);
    const segment=b.segment.map(p=>fromChart(p,frame,layout.config.chart_span_m));
    expect(segment[1][0]-segment[0][0]).toBeCloseTo(.2);
    expect(segment[1][0]-segment[0][0]).toBeLessThan(shelf.w);
  });
  it('uses first surfaces only: missing normals, roofs and occluder instance IDs cannot reveal a shelf',()=>{
    for(const changed of [[],hits.map(h=>({...h,normal:undefined})),hits.map(h=>({...h,normal:[0,0,1] as [number,number,number]})),
      hits.map(h=>({...h,instance:layout.solids.findIndex(s=>s.kind==='occluder')+2}))]){
      expect(topologyEvidence(layout,frame,[{frame,hits:changed}],'c').structure_faces).toEqual([]);
    }
  });
  it('labels a measured wall with its own type and excludes unobserved wall faces',()=>{
    const anchor={...frame,position:[wall.x+wall.w/2+1,wall.y,1.55] as [number,number,number]};
    const wallHits:Hit[]=[-.1,0,.1].map(d=>({x:wall.x+wall.w/2,y:wall.y+d,z:1,
      instance:layout.solids.indexOf(wall)+2,normal:[1,0,0]}));
    const result=topologyEvidence(layout,anchor,[{frame:anchor,hits:wallHits}],'c');
    expect(result.structure_faces).toHaveLength(1);
    expect(result.structure_faces![0]).toMatchObject({object_kind:'wall',face:'x_plus',evidence_frame_ids:['observed']});
    expect(result.shelf_faces).toEqual([]);
  });
});
