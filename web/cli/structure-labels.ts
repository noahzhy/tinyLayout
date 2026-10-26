/** Rebuild supervision from saved sensor passes; never re-render or change RGB. */
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative,sep,isAbsolute} from 'node:path';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {PerspectiveCamera} from 'three';
import {RENDER_CAMERA,setCameraPose,firstSurfaceHits} from '../src/synthetic/render';
import {observedStructureLabels} from '../src/synthetic/structure-labels';
import type {CameraFrame,Layout,Hit} from '../src/synthetic/types';

const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const args=parseArgs({options:{root:{type:'string'},output:{type:'string'},python:{type:'string'},
  'max-stores':{type:'string',default:'0'},'max-windows':{type:'string',default:'0'},
  'legacy-four-frames':{type:'boolean',default:false}}}).values;

function observedFrames(row:any){
  const selected=args['legacy-four-frames']?row.frames.slice(0,4):row.frames.filter((f:any)=>f.frame_id===row.anchor_frame_id);
  if(selected.length!==(args['legacy-four-frames']?4:1))throw Error(row.sample_id+': local input frame count differs');
  return selected;
}

async function main(){
  if(!args.root||!args.output||!args.python)throw Error('--root, --output, --python are required');
  const root=resolve(args.root),output=resolve(args.output),part=relative(root,output);
  if(!part||(!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep)))throw Error('supervision output must be outside source dataset');
  await mkdir(output); // Existing output is never silently mixed with a new run.
  const source=await readFile(resolve(root,'windows.jsonl'));
  const all=source.toString().split('\n').filter(Boolean).map(line=>JSON.parse(line));
  const stores=[...new Set<string>(all.map(row=>row.store_id))].slice(0,Number(args['max-stores'])||undefined);
  const manifest:unknown[]=[],counts:Record<string,{windows:number;known:number;ambiguous:number;vertical_normals:number}>={};
  const sensorHash=createHash('sha256');
  for(const store of stores){
    const prefix=`stores/${store}/privileged`,layout=await json(resolve(root,prefix,'scene.json')) as Layout;
    const record=await json(resolve(root,prefix,'cameras.json'));
    const poses=new Map<string,CameraFrame>(record.frames.map((f:CameraFrame)=>[f.frame_id,f]));
    const windows=all.filter(row=>row.store_id===store).slice(0,Number(args['max-windows'])||undefined);
    const views=windows.flatMap(observedFrames);
    const width=layout.config.image_width,height=layout.config.image_height,spec=record.camera??RENDER_CAMERA;
    const camera=new PerspectiveCamera(spec.vertical_fov_deg,width/height,spec.near,spec.far);
    const child=spawn(args.python,[resolve('scripts/decode_instance_passes.py'),'--root',root],{stdio:['pipe','pipe','inherit']});
    const done=new Promise<number|null>((ok,fail)=>{child.once('exit',ok);child.once('error',fail);});
    child.stdin.end(JSON.stringify({width,height,paths:views.map(f=>prefix+'/instance/'+f.frame_id+'.png')}));
    const iterator=child.stdout[Symbol.asyncIterator]();let pending:Buffer=Buffer.alloc(0);
    async function readBytes(size:number){
      const chunks:Buffer[]=[];let remaining=size;
      while(remaining){
        if(!pending.length){const next=await iterator.next();if(next.done)throw Error(store+': incomplete instance stream');pending=next.value as Buffer;}
        const n=Math.min(remaining,pending.length);chunks.push(pending.subarray(0,n));pending=pending.subarray(n);remaining-=n;
      }
      return Buffer.concat(chunks,size);
    }
    await mkdir(resolve(output,'stores',store),{recursive:true});
    try{
      for(const row of windows){
        const hits:Hit[]=[],actual=observedFrames(row);
        if(row.anchor_frame_id!==row.context_frame_ids.at(-1)||!actual.some((f:any)=>f.frame_id===row.anchor_frame_id))throw Error(row.sample_id+': actual/context anchor differs');
        for(const frame of actual){
          const pose=poses.get(frame.frame_id)!;
          if(!pose||pose.task_id!==frame.task_id||pose.segment_id!==frame.segment_id)throw Error(row.sample_id+': camera scope differs');
          setCameraPose(camera,pose);
          const ids=await readBytes(width*height*4),depth=await readFile(resolve(root,prefix,'depth',frame.frame_id+'.rgba'));
          sensorHash.update(store).update(frame.frame_id).update(ids).update(depth);
          hits.push(...firstSurfaceHits(ids,depth,camera,width,height));
        }
        const labels=observedStructureLabels(layout,poses.get(row.anchor_frame_id)!,hits,row.chart.chart_id);
        const name=`stores/${store}/${row.sample_id}.json`;
        await writeFile(resolve(output,name),JSON.stringify(labels)+'\n');
        const refs=actual.map((f:any)=>[store,f.task_id,f.segment_id,f.frame_id]);
        manifest.push({sample_id:row.sample_id,store_id:store,split:row.split,label_path:name,
          actual_refs:refs,anchor_ref:refs.find((r:string[])=>r[3]===row.anchor_frame_id),sha256:sha(await readFile(resolve(output,name)))});
        const c=counts[row.split]??={windows:0,known:0,ambiguous:0,vertical_normals:0};
        c.windows++;c.known+=labels.label_valid.filter(Boolean).length;c.ambiguous+=labels.context_support.filter((v,i)=>v&&!labels.label_valid[i]).length;
        c.vertical_normals+=labels.normal_valid.filter(Boolean).length;
      }
      if(pending.length||(await iterator.next()).done===false||await done!==0)throw Error(store+': instance stream failed/trailing bytes');
    }catch(error){child.kill('SIGTERM');throw error;}
    console.log(JSON.stringify({store,windows:windows.length,counts}));
  }
  await writeFile(resolve(output,'labels.jsonl'),manifest.map(row=>JSON.stringify(row)).join('\n')+'\n');
  const result={protocol:'observed_rigid_structure_v1',grid_shape:[64,64],bev_latent_grid_unchanged:[16,16],
    local_observation_protocol:args['legacy-four-frames']?'legacy_actual4':'single_rgb_v1',local_input_frames:args['legacy-four-frames']?4:1,
    source_root:root,source_manifest_sha256:sha(source),sensor_passes_sha256:sensorHash.digest('hex'),
    source_files_modified:false,rgb_regenerated:false,optimizer_updates:0,counts,windows:manifest.length,
    limited_smoke:!!Number(args['max-stores'])||!!Number(args['max-windows']),
    source_code_sha256:sha(Buffer.concat(await Promise.all(['web/cli/structure-labels.ts','web/src/synthetic/structure-labels.ts','web/src/synthetic/render.ts'].map(file=>readFile(file)))))};
  await writeFile(resolve(output,'provenance.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result));
}

main().catch(error=>{console.error(error);process.exitCode=1;});
