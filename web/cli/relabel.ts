import {readFile,writeFile,mkdir,readdir,copyFile,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,dirname,isAbsolute,sep} from 'node:path';
import {spawn} from 'node:child_process';
import {PerspectiveCamera} from 'three';
import {firstSurfaceHits,setCameraPose,RENDER_CAMERA} from '../src/synthetic/render';
import {verticalSurfaces,legacyShelfFaces,clipObservedSegment} from '../src/synthetic/vertical-surfaces';
import {makeLabels} from '../src/synthetic/labels';
import type {CameraFrame,Hit,Layout} from '../src/synthetic/types';

const hash=(data:Uint8Array|string)=>createHash('sha256').update(data).digest('hex');
function inside(root:string,name:string){
  const path=resolve(root,name),part=relative(root,path);
  if(part==='..'||part.startsWith('..'+sep)||isAbsolute(part))throw Error(`relabel path escapes root: ${name}`);
  return path;
}
const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const jsonl=async(path:string)=>(await readFile(path,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
function same(actual:unknown,expected:unknown,where:string){
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error(`${where}: original first-surface supervision differs after stored-pass reconstruction`);
}

export function sameGeometryFloat32(actual:unknown,expected:unknown,where:string):number {
  if(typeof actual==='number'&&typeof expected==='number'){
    if(!Number.isFinite(actual)||!Number.isFinite(expected)||Math.fround(actual)!==Math.fround(expected))
      throw Error(`${where}: reconstructed geometry differs in the model float32 representation`);
    return Number(actual!==expected);
  }
  if(Array.isArray(actual)&&Array.isArray(expected)&&actual.length===expected.length)
    return actual.reduce((count,value,index)=>count+sameGeometryFloat32(value,expected[index],where+'.'+index),0);
  throw Error(`${where}: geometric shape/type differs`);
}

export async function relabelDataset(rootName:string,outputName:string,python:string,maxStores=0){
  const root=resolve(rootName),output=resolve(outputName);
  if(!Number.isInteger(maxStores)||maxStores<0)throw Error('relabel --max-stores must be nonnegative');
  const fromSource=relative(root,output);
  if(!fromSource||(fromSource!=='..'&&!fromSource.startsWith('..'+sep)&&!isAbsolute(fromSource)))throw Error('relabel output must be separate from the source dataset');
  try{await stat(output);throw Error('relabel output exists');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  await stat(resolve(root,'COMPLETE'));
  const all=await jsonl(resolve(root,'windows.jsonl'));
  if(all.some(row=>row.data_kind!=='synthetic_mapping_benchmark_v1'))throw Error('stored-pass relabel currently requires the fixed benchmark dataset');
  const selected=[...new Set<string>(all.map(row=>row.store_id))].slice(0,maxStores||undefined),stores=new Set(selected);
  const windows=all.filter(row=>stores.has(row.store_id)),frames=(await jsonl(resolve(root,'frames.jsonl'))).filter(row=>stores.has(row.store_id));
  const evidence=(await jsonl(resolve(root,'graph_evidence.jsonl'))).filter(row=>stores.has(row.store_id));
  if(!windows.length||windows.length!==evidence.length||new Set(evidence.map(e=>e.sample_id)).size!==windows.length)throw Error('relabel evidence index coverage differs');
  const sourceHashes:Record<string,string>={},pixelHashes:Record<string,string>={};let copied=0;
  await mkdir(output,{recursive:true});
  try{
    const clone=async(directory:string)=>{
      for(const entry of await readdir(resolve(root,directory),{withFileTypes:true})){
        const name=directory?directory+'/'+entry.name:entry.name;
        if(name==='COMPLETE'||name==='FAILED.json')continue;
        if(name.startsWith('stores/')&&name.split('/').length>=2&&!stores.has(name.split('/')[1]))continue;
        if(entry.isSymbolicLink())throw Error(`relabel source contains an unsupported symlink: ${name}`);
        const destination=inside(output,name);
        if(entry.isDirectory()){await mkdir(destination,{recursive:true});await clone(name);}
        else if(entry.isFile()){
          const bytes=await readFile(inside(root,name));sourceHashes[name]=hash(bytes);
          await mkdir(dirname(destination),{recursive:true});
          await copyFile(inside(root,name),destination,constants.COPYFILE_FICLONE);
          if(hash(await readFile(destination))!==sourceHashes[name])throw Error(`relabel copy changed ${name}`);
          if(name.endsWith('.png')||name.endsWith('.rgba'))pixelHashes[name]=sourceHashes[name];
          copied++;
        }
      }
    };
    await clone('');
    const summaries=[];let float64SerializationDifferences=0;
    for(const store of selected){
      const prefix=`stores/${store}/privileged`,layout=await json(inside(root,prefix+'/scene.json')) as Layout;
      const cameraRecord=await json(inside(root,prefix+'/cameras.json'));
      const views=frames.filter(frame=>frame.store_id===store),cameraFrames=cameraRecord.frames as CameraFrame[];
      if(layout.store_id!==store||cameraRecord.gt_only!==true||views.length!==cameraFrames.length||new Set(views.map(v=>v.task_id)).size!==1)
        throw Error(`${store}: stored pass/camera scope differs`);
      const width=layout.config.image_width,height=layout.config.image_height,poses=new Map(cameraFrames.map(f=>[f.frame_id,f]));
      const spec=cameraRecord.camera??RENDER_CAMERA;
      if(JSON.stringify(spec)!==JSON.stringify(RENDER_CAMERA))throw Error(`${store}: unsupported stored camera intrinsics`);
      const camera=new PerspectiveCamera(spec.vertical_fov_deg,width/height,spec.near,spec.far);
      const decoder=spawn(python,[resolve('scripts/decode_instance_passes.py'),'--root',root],{stdio:['pipe','pipe','inherit']});
      const finished=new Promise<number|null>((ok,fail)=>{decoder.once('error',fail);decoder.once('exit',ok);});
      decoder.stdin.end(JSON.stringify({width,height,paths:views.map(f=>prefix+'/instance/'+f.frame_id+'.png')}));
      const iterator=decoder.stdout[Symbol.asyncIterator]();let pending:Buffer=Buffer.alloc(0);
      const readBytes=async(size:number)=>{
        const chunks:Buffer[]=[];let remaining=size;
        while(remaining){
          if(!pending.length){const next=await iterator.next();if(next.done)throw Error(`${store}: instance decoder ended before the frame was complete`);pending=next.value as Buffer;}
          const count=Math.min(remaining,pending.length);chunks.push(pending.subarray(0,count));pending=pending.subarray(count);remaining-=count;
        }
        return Buffer.concat(chunks,size);
      };
      const hits=new Map<string,Hit[]>();
      try{
        for(const [index,view] of views.entries()){
          const pose=poses.get(view.frame_id);
          if(!pose||pose.task_id!==view.task_id||pose.segment_id!==view.segment_id||pose.timestamp_s!==view.timestamp_s||view.width!==width||view.height!==height)
            throw Error(`${store}/${view.frame_id}: camera/frame binding differs`);
          setCameraPose(camera,pose);
          const ids=await readBytes(width*height*4),depth=await readFile(inside(root,prefix+'/depth/'+view.frame_id+'.rgba'));
          hits.set(view.frame_id,firstSurfaceHits(ids,depth,camera,width,height));
          if((index+1)%64===0)console.log(JSON.stringify({store,decoded_frames:index+1,total:views.length}));
        }
        if(pending.length||(await iterator.next()).done===false)throw Error(`${store}: trailing instance decoder bytes`);
        if(await finished!==0)throw Error(`${store}: instance PNG decoder failed`);
      }catch(error){decoder.kill('SIGTERM');throw error;}
      const storeWindows=windows.filter(row=>row.store_id===store);let faces=0,orthogonal=0;
      for(const sample of storeWindows){
        const item=evidence.find(row=>row.sample_id===sample.sample_id);
        if(!item||!item.path.endsWith('.json'))throw Error(`${sample.sample_id}: missing JSON evidence`);
        const anchor=poses.get(sample.anchor_frame_id)!;
        const context=sample.context_frame_ids.map((id:string)=>({frame:poses.get(id)!,hits:hits.get(id)!}));
        const actual=sample.frames.slice(0,4).map((frame:{frame_id:string})=>({frame:poses.get(frame.frame_id)!,hits:hits.get(frame.frame_id)!}));
        if(!anchor||context.some((v:{frame?:CameraFrame;hits?:Hit[]})=>!v.frame||!v.hits)||actual.some((v:{frame?:CameraFrame;hits?:Hit[]})=>!v.frame||!v.hits))throw Error(`${sample.sample_id}: missing actual/context frames`);
        const upgrade=(old:any,observed:{frame:CameraFrame;hits:Hit[]}[])=>{
          if(old.chart_id===sample.chart.chart_id&&old.schema_version==='1.2'&&old.source==='rendered_vertical_surface_graph_v3')return old;
          if(old.schema_version!=='1.1'||old.source!=='rendered_first_surface_graph_v2'||old.chart_id!==sample.chart.chart_id)throw Error(`${sample.sample_id}: unsupported original topology protocol`);
          const measured=verticalSurfaces(layout,anchor,observed);
          const reconstructed=legacyShelfFaces(verticalSurfaces(layout,anchor,observed,false));
          if(reconstructed.length!==old.shelf_faces.length)throw Error(`${sample.sample_id}: legacy visible face count differs`);
          for(const [index,face] of reconstructed.entries()){
            const previous=old.shelf_faces[index];
            for(const key of ['gt_object_id','face','evidence_frame_ids'] as const)same(face[key],previous[key],sample.sample_id+'/legacy_faces/'+key);
            for(const key of ['xy','normal','segment'] as const)
              float64SerializationDifferences+=sameGeometryFloat32(face[key],previous[key],sample.sample_id+'/legacy_faces/'+key);
          }
          // Preserve every old JSON scalar. The old browser and Node can differ
          // by an f64 trigonometric ULP while producing exactly equal f32 inputs.
          const legacy=new Map(old.shelf_faces.map((face:any)=>[face.gt_object_id+':'+face.face,face]));
          const canonical=measured.map(face=>{
            const previous=legacy.get(face.gt_object_id+':'+face.face) as any;
            return previous?{...face,xy:previous.xy,normal:previous.normal,segment:clipObservedSegment(previous.segment),evidence_frame_ids:previous.evidence_frame_ids}:face;
          });
          return {...old,schema_version:'1.2',source:'rendered_vertical_surface_graph_v3',structure_faces:canonical};
        };
        const old=await json(inside(root,item.path)),updated=upgrade(old,context);
        const labels=makeLabels(layout,anchor,context.flatMap((v:{hits:Hit[]})=>v.hits),actual.flatMap((v:{hits:Hit[]})=>v.hits),sample.chart.chart_id);
        same(labels,await json(inside(root,sample.labels.path)),sample.sample_id+'/dense_labels');
        await writeFile(inside(output,item.path),JSON.stringify(updated)+'\n');
        const actualPath=`stores/${store}/association_observations/${sample.sample_id}.json`,original=await json(inside(root,actualPath));
        same(makeLabels(layout,anchor,actual.flatMap((v:{hits:Hit[]})=>v.hits),actual.flatMap((v:{hits:Hit[]})=>v.hits),sample.chart.chart_id),original.labels,sample.sample_id+'/actual_labels');
        const upgraded=upgrade(original.graph,actual);
        await writeFile(inside(output,actualPath),JSON.stringify({...original,graph:upgraded})+'\n');
        faces+=upgraded.structure_faces.length;
        orthogonal+=Number(upgraded.structure_faces.some((a:any)=>upgraded.structure_faces.some((b:any)=>Math.abs(a.normal[0]*b.normal[1]-a.normal[1]*b.normal[0])>.1)));
      }
      summaries.push({store_id:store,windows:storeWindows.length,actual_structure_faces:faces,nonparallel_windows:orthogonal});
      console.log(JSON.stringify(summaries.at(-1)));
    }
    for(const [name,digest] of Object.entries(sourceHashes))if(hash(await readFile(inside(root,name)))!==digest)throw Error(`source changed during relabel: ${name}`);
    for(const [name,digest] of Object.entries(pixelHashes))if(hash(await readFile(inside(output,name)))!==digest)throw Error(`relabel changed sensor bytes: ${name}`);
    for(const [name,rows] of [['windows.jsonl',windows],['frames.jsonl',frames],['graph_evidence.jsonl',evidence]] as const)
      await writeFile(resolve(output,name),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    const split=await json(resolve(root,'splits.json'));
    if(!Array.isArray(split))throw Error('relabel requires explicit per-store split records');
    await writeFile(resolve(output,'splits.json'),JSON.stringify(split.filter(row=>stores.has(row.store_id)),null,2)+'\n');
    const provenance=await json(resolve(root,'provenance.json'));
    await writeFile(resolve(output,'parent_provenance.json'),JSON.stringify(provenance,null,2)+'\n');
    const sourceDigest=createHash('sha256');
    for(const file of ['web/cli/relabel.ts','web/src/synthetic/vertical-surfaces.ts','web/src/synthetic/render.ts','scripts/decode_instance_passes.py'])
      sourceDigest.update(file).update(await readFile(file));
    await writeFile(resolve(output,'provenance.json'),JSON.stringify({...provenance,
      stores:provenance.stores.filter((row:{store_id:string})=>stores.has(row.store_id)),frames:frames.length,windows:windows.length,
      topology_evidence_version:'1.2',relabel_source_sha256:sourceDigest.digest('hex'),
      stored_pass_relabel:{source:root,source_manifest_sha256:sourceHashes['windows.jsonl'],stores:summaries,limited_smoke:maxStores>0,
        camera_model:RENDER_CAMERA,camera_model_source:'legacy SceneRenderer fixed intrinsics; exact model-float32 face geometry and exact dense-label parity',
        source_files_unchanged:true,sensor_bytes_unchanged:true,legacy_supervision_exact:true,copied_files:copied,
        reconstruction_geometry_comparison:'exact model float32; original float64 JSON retained',float64_serialization_differences:float64SerializationDifferences}},null,2)+'\n');
    await writeFile(resolve(output,'relabel_source_files.json'),JSON.stringify(sourceHashes,null,2)+'\n');
    await writeFile(resolve(output,'COMPLETE'),'Stored-pass relabel completed; no RGB, model or online input was regenerated.\n');
    console.log(JSON.stringify({status:'stored_pass_relabel_completed',stores:stores.size,windows:windows.length,frames:frames.length,optimizer_updates:0,output}));
  }catch(error){await writeFile(resolve(output,'FAILED.json'),JSON.stringify({error:String(error)}));throw error;}
}
