import {describe,it,expect} from 'vitest';
import {observedStructureLabels} from '../src/synthetic/structure-labels';
import {makeLayout} from '../src/synthetic/layout';
import {defaults} from '../src/synthetic/types';
import type {CameraFrame,Hit} from '../src/synthetic/types';

describe('observed rigid structure supervision (geometry fixtures only)',()=>{
  const layout=makeLayout({...defaults,stores:1});
  const anchor={position:[0,0,1.5],yaw:0,pitch:0,roll:0} as CameraFrame;
  const instance=layout.solids.findIndex(s=>s.kind==='shelf')+2;
  const point={x:.1,y:.1,z:1,instance,normal:[1,0,0]} as Hit;
  const index=31*64+32;
  it('a measured side labels only its hit cell, not the object footprint',()=>{
    const labels=observedStructureLabels(layout,anchor,[point],'chart');
    expect(labels.context_support.filter(Boolean)).toHaveLength(1);
    expect(labels.semantic_labels[index]).toBe(1);
    expect(labels.boundary_labels[index]).toBe(1);
    expect(labels.surface_normals[index]).toEqual([1,0]);
    expect(labels.semantic_labels.filter(v=>v>=0)).toHaveLength(1);
  });
  it('mixed floor/structure and different instances stay ambiguous',()=>{
    const floor={...point,instance:1,z:0,normal:[0,0,1]} as Hit;
    const labels=observedStructureLabels(layout,anchor,[point,floor],'chart');
    expect(labels.context_support[index]).toBe(true);
    expect(labels.label_valid[index]).toBe(false);
    expect(labels.semantic_labels[index]).toBe(-1);
    const mixed=observedStructureLabels(layout,anchor,[point,{...point,instance:instance+1}],'chart');
    expect(mixed.instance_ids[index]).toBe(-1);
  });
  it('a visible roof is occupied but not a vertical edge; normals rotate with the chart',()=>{
    const roof=observedStructureLabels(layout,anchor,[{...point,normal:[0,0,1]}],'chart');
    expect(roof.semantic_labels[index]).toBe(1);expect(roof.boundary_labels[index]).toBe(0);
    const rotated=observedStructureLabels(layout,{...anchor,yaw:Math.PI/2},[point],'chart');
    const edge=rotated.normal_valid.findIndex(Boolean);
    expect(rotated.surface_normals[edge][0]).toBeCloseTo(0);
    expect(rotated.surface_normals[edge][1]).toBeCloseTo(1);
    const invalid=observedStructureLabels(layout,{...anchor,pitch:Math.PI/2},[point],'chart');
    expect(invalid.chart_valid).toBe(false);expect(invalid.label_valid.some(Boolean)).toBe(false);
  });
});
