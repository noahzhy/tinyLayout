import {cp,mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,relative,isAbsolute,sep,dirname} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import type {Layout} from '../src/synthetic/types';

const json=async(path:string)=>JSON.parse(await readFile(path,'utf8'));
const jsonl=async(path:string)=>(await readFile(path,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
const sha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');

/** Add actual rendered views while retaining physical-store splits and old data. */
export async function appendEntranceCaptures(rootName:string,outputName:string,maxStores=0,browserPath?:string){
  const root=resolve(rootName),output=resolve(outputName),part=relative(root,output);
  if(!part||(!part.startsWith('..'+sep)&&part!=='..'&&!isAbsolute(part)))throw Error('entrance output must be separate from source');
  if(!Number.isInteger(maxStores)||maxStores<0)throw Error('invalid --max-stores');
  await stat(resolve(root,'COMPLETE'));
  try{await stat(output);throw Error('entrance capture output exists');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const sourceWindows=await jsonl(resolve(root,'windows.jsonl')),sourceFrames=await jsonl(resolve(root,'frames.jsonl'));
  const sourceEvidence=await jsonl(resolve(root,'graph_evidence.jsonl')),sourceSplits=await json(resolve(root,'splits.json'));
  if(sourceWindows.some(row=>row.task_id==='task_entrance'))throw Error('entrance capture already appended');
  const stores=sourceSplits.slice(0,maxStores||undefined),selected=new Set<string>(stores.map((s:any)=>s.store_id));
  const windows=sourceWindows.filter(row=>selected.has(row.store_id)),frames=sourceFrames.filter(row=>selected.has(row.store_id));
  const evidence=sourceEvidence.filter(row=>selected.has(row.store_id));
  const originalCounts={windows:windows.length,frames:frames.length};
  await cp(root,output,{recursive:true,mode:constants.COPYFILE_FICLONE,filter:path=>{
    const name=relative(root,path),parts=name.split(sep);
    return name!=='COMPLETE'&&name!=='FAILED.json'&&!(parts[0]==='stores'&&parts.length>1&&!selected.has(parts[1]));
  }});
  const server=await createServer({configFile:resolve('web/vite.config.ts'),server:{host:'127.0.0.1',port:0}});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await server.listen();const url=server.resolvedUrls!.local[0];
    browser=await chromium.launch({executablePath:browserPath||process.env.TINYLAYOUT_CHROMIUM||undefined,headless:true,
      args:['--no-sandbox','--disable-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage();
    await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
    await page.exposeFunction('writeSyntheticFile',async(name:string,base64:string)=>{
      const destination=resolve(output,name),local=relative(output,destination);
      if(local==='..'||local.startsWith('..'+sep)||isAbsolute(local))throw Error(`entrance export path escapes root: ${name}`);
      // Only newly named sensor/label files may be written by the renderer.
      try{await stat(destination);throw Error(`entrance capture would overwrite ${name}`);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
      await mkdir(dirname(destination),{recursive:true});await writeFile(destination,Buffer.from(base64,'base64'));
    });
    await page.goto(url+'render.html');await page.waitForFunction(()=>!!window.exportEntranceCapture);
    const summaries=[];
    for(const store of stores){
      const prefix=`stores/${store.store_id}/privileged`,layout=await json(resolve(root,prefix,'scene.json')) as Layout;
      const truth=await json(resolve(root,prefix,'truth.json')),cameras=await json(resolve(root,prefix,'cameras.json'));
      const oldFrames=sourceFrames.filter(f=>f.store_id===store.store_id);
      const startTime=Math.max(...oldFrames.map(f=>f.timestamp_s))+10;
      const result=await page.evaluate(({layout,split,startTime,queryStart})=>window.exportEntranceCapture(layout,split,startTime,queryStart),
        {layout,split:store.split,startTime,queryStart:truth.queries.length});
      windows.push(...result.windows);frames.push(...result.frames);evidence.push(...result.graph_evidence_index);
      truth.queries.push(...result.queries);truth.traversals.push(...result.traversals);
      cameras.frames.push(...result.camera_frames);
      await writeFile(resolve(output,prefix,'truth.json'),JSON.stringify(truth)+'\n');
      await writeFile(resolve(output,prefix,'cameras.json'),JSON.stringify(cameras)+'\n');
      const summary={store_id:store.store_id,split:store.split,added_frames:result.frames.length,added_windows:result.windows.length,
        supported_context_entrances:result.queries.filter(q=>q.place?.gt_node_id===layout.graph.nodes.find(n=>n.kind==='entrance')?.id).length};
      summaries.push(summary);console.log(JSON.stringify(summary));
    }
    for(const [name,rows] of [['windows.jsonl',windows],['frames.jsonl',frames],['graph_evidence.jsonl',evidence]] as const)
      await writeFile(resolve(output,name),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
    const updatedSplits=stores.map((s:any)=>({...s,query_count:s.query_count+8,frame_count:s.frame_count+32}));
    await writeFile(resolve(output,'splits.json'),JSON.stringify(updatedSplits,null,2)+'\n');
    const parent=await json(resolve(root,'provenance.json'));
    await writeFile(resolve(output,'entrance_parent_provenance.json'),JSON.stringify(parent,null,2)+'\n');
    const code=createHash('sha256');
    for(const name of ['web/cli/entrance-capture.ts','web/src/synthetic/entrance-capture.ts','web/src/synthetic/topology-evidence.ts'])code.update(name).update(await readFile(name));
    const summary={schema_version:'1.0',synthetic_only:true,parent_root:root,parent_manifest_sha256:sha(await readFile(resolve(root,'windows.jsonl'))),
      generator_source_sha256:code.digest('hex'),original_counts:originalCounts,windows:windows.length,frames:frames.length,stores:summaries,
      original_rows_preserved:true,store_layout_and_split_preserved:true,online_pose_exported:false,optimizer_updates:0,limited_smoke:maxStores>0};
    await writeFile(resolve(output,'provenance.json'),JSON.stringify({...parent,stores:updatedSplits,frames:frames.length,windows:windows.length,entrance_capture:summary},null,2)+'\n');
    await writeFile(resolve(output,'entrance_capture_summary.json'),JSON.stringify(summary,null,2)+'\n');
    await writeFile(resolve(output,'COMPLETE'),'Actual rendered entrance capture appended; original data and splits preserved.\n');
    console.log(JSON.stringify({status:'entrance_capture_complete',windows:windows.length,frames:frames.length,output}));
  }catch(error){await writeFile(resolve(output,'FAILED.json'),JSON.stringify({error:String(error)}));throw error;}
  finally{await browser?.close();await server.close();}
}
