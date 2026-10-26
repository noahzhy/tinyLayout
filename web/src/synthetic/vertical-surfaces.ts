import {toChart} from './labels';
import type {CameraFrame, Hit, Layout, XY} from './types';

export type VerticalFace = 'x_minus'|'x_plus'|'y_minus'|'y_plus';
export interface SurfaceEvidence {
  gt_object_id: string; object_kind: 'shelf'|'cabinet'|'wall'; face: VerticalFace;
  normal: XY; xy: XY; segment: XY[]; evidence_frame_ids: string[];
}

export function clipObservedSegment(segment:XY[]):XY[] {
  const [a,b]=segment,d:XY=[b[0]-a[0],b[1]-a[1]];let lo=0,hi=1;
  for(const axis of [0,1] as const){
    if(Math.abs(d[axis])<1e-12){if(Math.abs(a[axis])>1)throw Error('observed surface line does not intersect the chart');}
    else{
      const x=(-1-a[axis])/d[axis],y=(1-a[axis])/d[axis];
      lo=Math.max(lo,Math.min(x,y));hi=Math.min(hi,Math.max(x,y));
    }
  }
  if(lo>hi)throw Error('observed surface segment does not intersect the chart');
  return [lo,hi].map(t=>a.map((value,i)=>Math.max(-1,Math.min(1,value+t*d[i]))) as XY);
}

/** Supervision only. Every positive face requires measured first-surface hits. */
export function verticalSurfaces(layout: Layout, anchor: CameraFrame,
  views: {frame: CameraFrame; hits: Hit[]}[],clipSegments=true): SurfaceEvidence[] {
  const result: SurfaceEvidence[]=[];
  const indexed=views.map(view=>{
    const instances=new Map<number,Hit[]>();
    for(const hit of view.hits){const group=instances.get(hit.instance)??[];group.push(hit);instances.set(hit.instance,group);}
    return {frame:view.frame,instances};
  });
  const rotate=([x,y]:XY):XY=>[x*Math.cos(anchor.yaw)-y*Math.sin(anchor.yaw),x*Math.sin(anchor.yaw)+y*Math.cos(anchor.yaw)];
  for(const [index,solid] of layout.solids.entries()) {
    if(solid.kind!=='shelf'&&solid.kind!=='cabinet'&&solid.kind!=='wall')continue;
    for(const axis of [0,1] as const)for(const sign of [-1,1]) {
      const plane=(axis===0?solid.x:solid.y)+sign*(axis===0?solid.w:solid.d)/2;
      const observations=indexed.map(view=>({frame:view.frame,hits:(view.instances.get(index+2)??[]).filter(hit=>{
        const normal=hit.normal;
        if(hit.instance!==index+2||!normal||normal[axis]*sign<=.9||hit.z<=.05||hit.z>=solid.h-.05)return false;
        const xy=toChart([hit.x,hit.y],anchor,layout.config.chart_span_m);
        return Math.abs((axis===0?hit.x:hit.y)-plane)<.04&&Math.max(...xy.map(Math.abs))<=1;
      })})).filter(view=>view.hits.length>=3);
      if(!observations.length)continue;
      const hits=observations.flatMap(view=>view.hits);
      const center:XY=[hits.reduce((s,h)=>s+h.x,0)/hits.length,hits.reduce((s,h)=>s+h.y,0)/hits.length];
      const tangent=hits.map(h=>axis===0?h.y:h.x);
      const segment:XY[]=[Math.min(...tangent),Math.max(...tangent)].map(value=>axis===0?[center[0],value]:[value,center[1]]);
      const localSegment=segment.map(point=>toChart(point,anchor,layout.config.chart_span_m));
      result.push({gt_object_id:solid.id,object_kind:solid.kind,
        face:`${axis===0?'x':'y'}_${sign<0?'minus':'plus'}`,normal:rotate(axis===0?[sign,0]:[0,sign]),
        xy:toChart(center,anchor,layout.config.chart_span_m),
        segment:clipSegments?clipObservedSegment(localSegment):localSegment,
        evidence_frame_ids:observations.map(view=>view.frame.frame_id)});
    }
  }
  return result;
}

export function legacyShelfFaces(faces:SurfaceEvidence[]) {
  return faces.filter(face=>face.object_kind!=='wall'&&(face.face==='x_minus'||face.face==='x_plus'))
    .map(({object_kind:_,...face})=>face);
}
