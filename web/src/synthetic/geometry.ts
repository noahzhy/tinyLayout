import {stableHash,type Solid,type XY} from './types';

export function contains(s:Solid,p:XY,radius=0):boolean {
  return Math.abs(p[0]-s.x)<s.w/2+radius&&Math.abs(p[1]-s.y)<s.d/2+radius;
}

export function segmentFree(a:XY,b:XY,solids:Solid[],radius=.18):boolean {
  const count=Math.max(1,Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.1));
  for(let i=0;i<=count;i++){
    const point:XY=[a[0]+(b[0]-a[0])*i/count,a[1]+(b[1]-a[1])*i/count];
    if(solids.some(s=>contains(s,point,radius)))return false;
  }
  return true;
}

export function footprintHash(solids:Solid[],width:number,length:number):string {
  return stableHash({width,length,solids:solids.filter(s=>s.kind!=='occluder').map(({h:_height,...footprint})=>footprint)});
}
