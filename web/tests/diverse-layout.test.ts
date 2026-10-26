import {describe,it,expect} from 'vitest';
import {makeLayout,makeFrames,segmentFree,contains,counterfactualLayout} from '../src/synthetic/layout';
import {defaults,type Family} from '../src/synthetic/types';

describe('varied physical store layouts',()=>{
  it.each(['mixed','islands','rooms'] as Family[])('%s stays connected and collision-free across 40 seeds',family=>{
    for(let seed=1;seed<=40;seed++){
      const layout=makeLayout({...defaults,family,seed});
      expect(layout).toEqual(makeLayout({...defaults,family,seed}));
      const reached=new Set([layout.graph.nodes[0].id]);
      for(let i=0;i<layout.graph.nodes.length;i++)for(const edge of layout.graph.edges){
        if(reached.has(edge.a))reached.add(edge.b);if(reached.has(edge.b))reached.add(edge.a);
      }
      expect(reached.size).toBe(layout.graph.nodes.length);
      for(const edge of layout.graph.edges)expect(segmentFree(edge.polyline[0],edge.polyline[1],layout.solids)).toBe(true);
      for(const task of [0,1]){
        const frames=makeFrames(layout,task);expect(frames).toHaveLength(defaults.frames_per_task);
        for(let i=0;i<frames.length;i++){
          const p=frames[i].position.slice(0,2) as [number,number];
          expect(layout.solids.some(s=>contains(s,p,.18))).toBe(false);
          if(i&&frames[i].segment_id===frames[i-1].segment_id)expect(segmentFree(frames[i-1].position.slice(0,2) as [number,number],p,layout.solids)).toBe(true);
        }
      }
    }
  });
  it('seeds vary structure counts, entrances, orientation and physical layout, not only textures',()=>{
    const layouts=Array.from({length:20},(_,i)=>makeLayout({...defaults,seed:i+1}));
    expect(new Set(layouts.map(l=>l.layout_hash)).size).toBe(20);
    expect(new Set(layouts.map(l=>l.solids.length)).size).toBeGreaterThan(3);
    expect(new Set(layouts.map(l=>l.graph.nodes.length)).size).toBeGreaterThan(3);
    expect(new Set(layouts.map(l=>l.graph.nodes.find(n=>n.kind==='entrance')!.xy[0])).size).toBeGreaterThan(5);
    for(const layout of layouts){
      const shelves=layout.solids.filter(s=>s.kind==='shelf');
      expect(shelves.some(s=>s.w>s.d)).toBe(true);expect(shelves.some(s=>s.d>s.w)).toBe(true);
      expect(makeLayout({...layout.config,trajectory:'reverse'}).layout_hash).toBe(layout.layout_hash);
      expect(makeFrames(makeLayout({...layout.config,trajectory:'reverse'}),1)).toHaveLength(32);
    }
  });
  it('rooms have physical doorways and a walkable interior graph branch',()=>{
    const layout=makeLayout({...defaults,family:'rooms'});
    expect(layout.solids.some(s=>s.id.startsWith('room_')&&s.kind==='wall')).toBe(true);
    const interiors=layout.graph.nodes.filter(n=>n.kind==='dead_end');
    expect(interiors.length).toBeGreaterThan(0);
    for(const node of interiors){expect(node.ports).toHaveLength(1);expect(layout.solids.some(s=>contains(s,node.xy,.18))).toBe(false);}
  });
  it('short and odd-length captures retain all turns and a real segment restart',()=>{
    for(const count of [16,17,33,64]){
      const layout=makeLayout({...defaults,frames_per_task:count});
      expect(makeFrames(layout)).toHaveLength(count);
      const frames=makeFrames(layout,1);expect(frames).toHaveLength(count);
      expect(new Set(frames.map(f=>f.segment_id)).size).toBe(2);
    }
  });
  it('counterfactuals shrink a real fixture and keep all original camera poses safe',()=>{
    for(const family of ['mixed','islands','rooms'] as Family[]){
      const layout=makeLayout({...defaults,family}),index=layout.solids.findIndex(s=>s.semantic===1);
      const counter=counterfactualLayout(layout,[index+2]);
      expect(counter.layout_hash).not.toBe(layout.layout_hash);
      expect(counter.solids[index].w*counter.solids[index].d).toBeCloseTo(layout.solids[index].w*layout.solids[index].d*.55);
      expect(counter.graph).toEqual(layout.graph);
      for(const frame of makeFrames(layout))expect(counter.solids.some(s=>contains(s,frame.position.slice(0,2) as [number,number],.18))).toBe(false);
    }
  });
});
