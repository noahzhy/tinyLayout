import {parseArgs} from 'node:util';
import {readFile, writeFile, mkdir, stat, readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve, dirname, relative, isAbsolute} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {chromium} from 'playwright';
import {parseConfig, type SceneConfig} from '../src/synthetic/types';

const {values, positionals} = parseArgs({allowPositionals: true, options: {config: {type: 'string'}, output: {type: 'string'}, browser: {type: 'string'},root:{type:'string'},python:{type:'string'},'max-stores':{type:'string'},'context-frames':{type:'string'}, help: {type: 'boolean'}}});
if (values.help || !['generate', 'benchmark','benchmark-train','relabel','entrance-probe','entrance-capture'].includes(positionals[0])) {
  console.log('Usage: npm run synth -- <generate|benchmark|benchmark-train> --config CONFIG.json --output DIRECTORY [--context-frames 2|4] [--browser /path/to/chrome]\nOr: npm run synth -- relabel --root DATASET --output NEW_DATASET --python PYTHON [--max-stores 1]\nOr: npm run synth -- entrance-capture --root DATASET --output NEW_DATASET [--max-stores 1]\nOr: npm run synth -- entrance-probe --root STORE_DIRECTORY --output DIRECTORY [--browser /path/to/chrome]\nBenchmark requires one T-layout store; benchmark-train batches T stores with prefix2/actual4. Existing output is never overwritten.');
  if (!values.help) process.exitCode = 1;
} else if(positionals[0]==='entrance-capture') {
  if(!values.root||!values.output)throw Error('entrance-capture requires --root DATASET and --output NEW_DATASET');
  const {appendEntranceCaptures}=await import('./entrance-capture');
  await appendEntranceCaptures(values.root,values.output,Number(values['max-stores']??0),values.browser);
} else if(positionals[0]==='entrance-probe') {
  if(!values.root||!values.output)throw Error('entrance-probe requires --root STORE_DIRECTORY and --output DIRECTORY');
  const {entranceProbe}=await import('./entrance-probe');
  await entranceProbe(values.root,values.output,values.browser);
} else if(positionals[0]==='relabel') {
  const python=values.python??process.env.TINYLAYOUT_PY;
  if(!values.root||!values.output||!python)throw Error('relabel requires --root, --output and --python (or TINYLAYOUT_PY)');
  const {relabelDataset}=await import('./relabel');
  await relabelDataset(values.root,values.output,python,Number(values['max-stores']??0));
} else {
  if (!values.config || !values.output) throw Error('--config and --output are required');
  const config = parseConfig(JSON.parse(await readFile(values.config, 'utf8'))), output = resolve(values.output);
  const benchmarkTrain=positionals[0]==='benchmark-train';
  const benchmark = positionals[0] === 'benchmark'||benchmarkTrain;
  const contextValue=Number(values['context-frames']??4);
  if(contextValue!==2&&contextValue!==4)throw Error('--context-frames must be 2 or 4');
  const contextFrames:2|4=contextValue===2?2:4;
  if (benchmark && ((!benchmarkTrain&&config.stores!==1)||config.family !== 'T')) throw Error('benchmark requires family=T; single evaluation benchmark also requires stores=1');
  if(benchmarkTrain&&contextFrames!==2)throw Error('benchmark-train requires --context-frames 2');
  try {await stat(output); throw Error(`Output already exists: ${output}. Choose a new run directory.`);} catch (error) {if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;}
  await mkdir(output, {recursive: true});
  const server = await createServer({configFile: resolve('web/vite.config.ts'), server: {host: '127.0.0.1', port: 0}});
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await server.listen(); const url = server.resolvedUrls!.local[0];
    browser = await chromium.launch({executablePath: values.browser || process.env.TINYLAYOUT_CHROMIUM || undefined,
      headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
    const page = await browser.newPage();
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(url).origin ? route.continue() : route.abort());
    page.on('pageerror', error => console.error('Renderer:', error));
    await page.exposeFunction('writeSyntheticFile', async (path: string, base64: string) => {
      const destination = resolve(output, path), rel = relative(output, destination);
      if (rel.startsWith('..') || isAbsolute(rel)) throw Error(`Export path escapes root: ${path}`);
      await mkdir(dirname(destination), {recursive: true}); await writeFile(destination, Buffer.from(base64, 'base64'));
    });
    await page.goto(url + 'render.html'); await page.waitForFunction(() => !!window.exportSynthetic);
    const allWindows: Record<string, unknown>[] = [], allFrames: Record<string, unknown>[] = [], allGraphEvidence:Record<string,unknown>[]=[],stores: Record<string, unknown>[] = [], byHash = new Map<string, string>();
    for (let i = 0; i < config.stores; i++) {
      const split: 'train' | 'dev' | 'test' = config.stores === 1 || i < Math.ceil(config.stores * 2 / 3) ? 'train' : i < Math.ceil(config.stores * 5 / 6) ? 'dev' : 'test';
      const c: SceneConfig = {...config, seed: config.seed + i, stores: 1, family: benchmarkTrain?'T':config.family};
      const result = await page.evaluate(({c, split, benchmark,contextFrames,benchmarkTrain}) => benchmark ? window.exportMappingBenchmark(c,contextFrames,benchmarkTrain?split:undefined) : window.exportSynthetic(c, split,contextFrames), {c, split, benchmark,contextFrames,benchmarkTrain});
      if (byHash.has(result.layout_hash)) throw Error(`Duplicate physical layout ${result.layout_hash}; do not duplicate across splits`);
      byHash.set(result.layout_hash, split); allWindows.push(...result.windows); allFrames.push(...result.frames);
      allGraphEvidence.push(...result.graph_evidence_index);
      const {windows: _, frames: __, graph_evidence_index:___, ...store} = result; stores.push(store);
      console.log(JSON.stringify({store: i + 1, total: config.stores, ...store, windows: result.windows.length, frames: result.frames.length}));
    }
    await writeFile(resolve(output, 'windows.jsonl'), allWindows.map(x => JSON.stringify(x)).join('\n') + '\n');
    await writeFile(resolve(output, 'frames.jsonl'), allFrames.map(x => JSON.stringify(x)).join('\n') + '\n');
    await writeFile(resolve(output,'graph_evidence.jsonl'),allGraphEvidence.map(x=>JSON.stringify(x)).join('\n')+'\n');
    await writeFile(resolve(output, 'splits.json'), JSON.stringify(stores, null, 2));
    let commit = 'unknown'; try {commit = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();} catch { /* provenance explicitly remains unknown */ }
    const digest = createHash('sha256');
    for (const directory of ['web/src', 'web/cli']) {
      for (const file of (await readdir(directory, {recursive: true})).sort()) {
        const path = resolve(directory, file);
        if ((await stat(path)).isFile()) {digest.update(`${directory}/${file}`); digest.update(await readFile(path));}
      }
    }
    digest.update(await readFile('package-lock.json'));
    const dirty = execFileSync('git', ['status', '--porcelain'], {encoding: 'utf8'}).trim().length > 0;
    await writeFile(resolve(output, 'provenance.json'), JSON.stringify({schema_version: '1.0', synthetic_only: true, generator_commit: commit, generator_worktree_dirty: dirty, generator_source_sha256: digest.digest('hex'), config,context_frames:contextFrames,
      browser: browser.version(), renderer_backend: 'Chromium ANGLE SwiftShader software WebGL2', stores, frames: allFrames.length, windows: allWindows.length}, null, 2));
    await writeFile(resolve(output, 'COMPLETE'), 'Only datasets with this marker finished exporting.\n');
    console.log(`Dataset: ${output} (${allFrames.length} frames, ${allWindows.length} windows)`);
  } catch (error) {await writeFile(resolve(output, 'FAILED.json'), JSON.stringify({error: String(error)})); throw error;}
  finally {await browser?.close(); await server.close();}
}
