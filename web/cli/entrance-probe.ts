import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import type {Layout} from '../src/synthetic/types';

/** A real rendered data-coverage probe, not an entrance recognition result. */
export async function entranceProbe(storeRoot:string,outputName:string,browserPath?:string){
  const root=resolve(storeRoot),output=resolve(outputName);
  try{await stat(output);throw Error('entrance probe output already exists');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  const layout=JSON.parse(await readFile(resolve(root,'privileged/scene.json'),'utf8')) as Layout;
  const server=await createServer({configFile:resolve('web/vite.config.ts'),server:{host:'127.0.0.1',port:0}});
  let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
  try{
    await server.listen();const url=server.resolvedUrls!.local[0];
    browser=await chromium.launch({executablePath:browserPath||process.env.TINYLAYOUT_CHROMIUM||undefined,headless:true,
      args:['--no-sandbox','--disable-gpu','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
    const page=await browser.newPage();
    await page.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():route.abort());
    await page.goto(url+'render.html');await page.waitForFunction(()=>!!window.entranceProbe);
    const result=await page.evaluate(layout=>window.entranceProbe(layout),layout);
    await mkdir(output,{recursive:true});
    await writeFile(resolve(output,'rgb.png'),Buffer.from(result.rgb.split(',')[1],'base64'));
    await writeFile(resolve(output,'probe.json'),JSON.stringify({gt_only:true,scope:'rendered supervision coverage probe, not learned recognition',...result,rgb:undefined},null,2));
    const node=result.evidence.nodes.find(n=>n.kind==='entrance');
    const summary={store_id:layout.store_id,entrance_supported:node?.state==='supported',floor_refs:node?.evidence_frame_ids,
      boundary_refs:node?.entrance_boundary_refs,ports:node?.ports.filter(p=>p.state==='supported').length,
      observed_cells:result.labels.context_support.filter(Boolean).length,training_started:false};
    await writeFile(resolve(output,'summary.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
  }finally{await browser?.close();await server.close();}
}
