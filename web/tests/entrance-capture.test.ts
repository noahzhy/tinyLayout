import {describe,it,expect} from 'vitest';
import {entranceRoute} from '../src/synthetic/entrance-capture';
import {makeLayout,segmentFree} from '../src/synthetic/layout';
import {defaults,type XY} from '../src/synthetic/types';

describe('entrance capture planning; not learned recognition',()=>{
  const layout=makeLayout({...defaults,family:'T',seed:117});
  it('uses the real door gap without changing layout identity, geometry or split',()=>{
    const before=JSON.stringify(layout),frames=entranceRoute(layout,200);
    expect(frames).toHaveLength(32);expect(new Set(frames.map(f=>f.frame_id)).size).toBe(32);
    expect(frames[0].position[1]).toBe(-4);expect(frames[15].position.slice(0,2)).toEqual(layout.graph.nodes.find(n=>n.kind==='entrance')!.xy);
    expect(frames[23].position[1]).toBe(2);expect(frames[31].position[1]).toBe(4);
    for(let i=1;i<frames.length;i++){
      expect(frames[i].timestamp_s-frames[i-1].timestamp_s).toBeCloseTo(layout.config.sample_interval_s);
      expect(segmentFree(frames[i-1].position.slice(0,2) as XY,frames[i].position.slice(0,2) as XY,layout.solids)).toBe(true);
    }
    expect(JSON.stringify(layout)).toBe(before);expect(entranceRoute(layout,200)).toEqual(frames);
  });
  it('fails if the actual entrance trajectory is blocked',()=>{
    const entrance=layout.graph.nodes.find(n=>n.kind==='entrance')!;
    const blocked={...layout,solids:[...layout.solids,{id:'door_block',kind:'occluder' as const,x:entrance.xy[0],y:0,w:1,d:.3,h:2,semantic:-1}]};
    expect(()=>entranceRoute(blocked,200)).toThrow('entrance capture collision');
  });
});
