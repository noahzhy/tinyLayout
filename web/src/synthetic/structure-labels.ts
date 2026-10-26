import type {CameraFrame,Hit,Layout} from './types';
import {toChart} from './labels';

/** Supervision only: actual surfaces at a finer readout grid, never full boxes. */
export function observedStructureLabels(layout:Layout,anchor:CameraFrame,hits:Hit[],chartId:string,size=64){
  const count=size*size,valid=Math.abs(Math.cos(anchor.pitch))>1e-3;
  const support=Array<boolean>(count).fill(false),instances=Array.from({length:count},()=>new Set<number>());
  const classes=Array.from({length:count},()=>new Set<number>()),vertical=Array.from({length:count},()=>new Set<number>());
  const normals=Array.from({length:count},()=>[0,0,0]);
  if(valid)for(const hit of hits){
    const cls=hit.instance===1?0:layout.solids[hit.instance-2]?.semantic??-1;
    if(cls<0)continue; // An occluder cannot reveal any surface behind it.
    const [x,y]=toChart([hit.x,hit.y],anchor,layout.config.chart_span_m);
    const col=Math.floor((x+1)*size/2),row=Math.floor((1-y)*size/2);
    if(col<0||col>=size||row<0||row>=size)continue;
    const index=row*size+col;support[index]=true;instances[index].add(hit.instance);classes[index].add(cls);
    if(!hit.normal)continue;
    const [nx,ny,nz]=hit.normal;
    if(Math.abs(nz)<.2&&Math.hypot(nx,ny)>.9){
      vertical[index].add(1);
      const c=Math.cos(anchor.yaw),s=Math.sin(anchor.yaw);
      normals[index][0]+=c*nx-s*ny;normals[index][1]+=s*nx+c*ny;normals[index][2]++;
    }else if(Math.abs(nz)>.9)vertical[index].add(0);
  }
  const labelValid=support.map((v,i)=>v&&classes[i].size===1&&instances[i].size===1);
  const semantic=classes.map((values,i)=>labelValid[i]?[...values][0]:-1);
  const instanceIds=instances.map((values,i)=>labelValid[i]?[...values][0]:-1);
  const boundaryValid=labelValid.map((v,i)=>v&&vertical[i].size===1);
  const boundary=vertical.map((values,i)=>boundaryValid[i]?[...values][0]:-1);
  const normalValid=boundaryValid.map((v,i)=>v&&boundary[i]===1&&normals[i][2]>0&&Math.hypot(normals[i][0],normals[i][1])/normals[i][2]>.95);
  const normal=normals.map((value,i)=>{const length=Math.hypot(value[0],value[1]);return normalValid[i]?[value[0]/length,value[1]/length]:[0,0];});
  return {schema_version:'1.0',protocol:'observed_rigid_structure_v1',taxonomy:'structmap_semantics_v1',chart_id:chartId,
    coordinate_system:'normalized_chart_xy',grid_shape:[size,size],chart_valid:valid,gt_only:true,
    source:'rendered_first_surface_points_and_normals_v1',context_support:support,
    semantic_labels:semantic,label_valid:labelValid,instance_ids:instanceIds,
    boundary_labels:boundary,boundary_valid:boundaryValid,surface_normals:normal,normal_valid:normalValid};
}
