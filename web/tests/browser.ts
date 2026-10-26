/** Local browser QA, including real rendered occlusion and browser/CLI export parity. */
import assert from 'node:assert/strict';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {chromium} from 'playwright';
import {unzipSync} from 'fflate';
import {defaults} from '../src/synthetic/types';

const out = resolve(process.env.TINYLAYOUT_QA_DIR || 'runs/browser_qa'); await mkdir(out, {recursive: true});
const url = process.env.TINYLAYOUT_URL || 'http://127.0.0.1:5173/';
const browser = await chromium.launch({executablePath: process.env.TINYLAYOUT_CHROMIUM || undefined, headless: true, args: ['--no-sandbox', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
const context = await browser.newContext({viewport: {width: 1536, height: 1024}, acceptDownloads: true});
const errors: string[] = [], network: string[] = [];
await context.route('**/*', route => {
  const target = new URL(route.request().url());
  if (target.protocol === 'data:' || target.origin === new URL(url).origin) return route.continue();
  network.push(target.href); return route.abort();
});
const page = await context.newPage(); page.on('pageerror', error => errors.push(String(error))); page.on('console', msg => {if (msg.type() === 'error') errors.push(msg.text());});
try {
  await page.goto(url); assert.match(await page.title(), /tinyLayout/);
  await page.locator('.rgb-panel img').waitFor({timeout: 60000});
  await page.locator('[data-labels-ready="true"]').waitFor({timeout: 60000});
  assert.equal(await page.locator('h1').textContent(), '合成数据工作台');
  assert.equal(await page.locator('.viewport').count(), 4);
  await page.screenshot({path: `${out}/desktop.png`});
  const originalLayout=await page.locator('main').getAttribute('data-layout-id');
  await page.getByRole('button',{name:'换一个布局',exact:true}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'Seed',exact:true}).inputValue(),'18');
  assert.notEqual(await page.locator('main').getAttribute('data-layout-id'),originalLayout);
  for(const family of ['islands','rooms']){
    await page.getByRole('combobox',{name:'布局类型',exact:true}).selectOption(family);
    await page.getByRole('button',{name:'生成场景',exact:true}).click();
    await page.waitForFunction(f=>document.querySelector('main')?.getAttribute('data-layout-family')===f,family);
    await page.locator('[data-labels-ready="true"]').waitFor({timeout:60000});
    assert.equal(await page.locator('.status.error').count(),0);
    await page.screenshot({path:`${out}/${family}.png`});
  }
  await page.getByRole('spinbutton',{name:'Seed',exact:true}).fill('17');
  await page.getByRole('combobox',{name:'布局类型',exact:true}).selectOption('mixed');
  await page.getByRole('button',{name:'生成场景',exact:true}).click();
  await page.locator('[data-labels-ready="true"]').waitFor({timeout:60000});
  await page.getByRole('button', {name: 'Support', exact: true}).click();
  assert.equal(await page.getByRole('button', {name: 'Support', exact: true}).getAttribute('aria-pressed'), 'true');
  await page.locator('.bev-map rect[fill="#356ae6"]').first().waitFor({timeout:60000});
  assert.ok(await page.locator('.bev-map rect[fill="#356ae6"]').count() > 0);
  await page.getByRole('button', {name: '选择 f005', exact: true}).click();
  assert.match(await page.locator('output').textContent() || '', /f005/);
  await page.getByRole('spinbutton', {name: '门店宽度', exact: true}).fill('8'); await page.getByRole('button', {name: '生成场景', exact: true}).click();
  assert.match(await page.locator('footer[role=status]').textContent() || '', /fit/);
  await page.getByRole('spinbutton', {name: '门店宽度', exact: true}).fill('24'); await page.getByRole('button', {name: '生成场景', exact: true}).click();
  const saved = page.waitForEvent('download'); await page.getByRole('button', {name: '保存配置', exact: true}).click(); const configDownload = await saved;
  await configDownload.saveAs(`${out}/saved-config.json`); assert.equal(JSON.parse(await readFile(`${out}/saved-config.json`, 'utf8')).width, 24);
  const config = {...defaults, frames_per_task: 16, image_width: 192, image_height: 144};
  await page.locator('input[type=file]').setInputFiles({name: 'config.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(config))});
  await page.waitForFunction(() => document.querySelector('footer[role=status]')?.textContent?.includes('配置已载入'));
  const downloaded = page.waitForEvent('download', {timeout: 180000}); await page.getByRole('button', {name: '导出数据集', exact: true}).click();
  const archive = await downloaded; await archive.saveAs(`${out}/browser-export.zip`);
  const files = unzipSync(await readFile(`${out}/browser-export.zip`)); const windows = new TextDecoder().decode(files['windows.jsonl']).trim().split('\n').map(x => JSON.parse(x));
  assert.equal(windows.length, 5); assert.ok(files.COMPLETE);
  for (const record of windows) {
    const file = record.labels.path;
    assert.deepEqual(JSON.parse(new TextDecoder().decode(files[file])), JSON.parse(await readFile(resolve(process.env.TINYLAYOUT_PARITY_ROOT || 'runs/synthetic_probe_final', file), 'utf8')));
    const graphFile = record.labels.topology_path;
    const graph = JSON.parse(new TextDecoder().decode(files[graphFile]));
    assert.equal(graph.chart_id, record.chart.chart_id);
    assert.deepEqual(graph, JSON.parse(await readFile(resolve(process.env.TINYLAYOUT_PARITY_ROOT || 'runs/synthetic_probe_final', graphFile), 'utf8')));
  }
  assert.deepEqual(Buffer.from(files[windows[0].frames[0].image_path]), await readFile(resolve(process.env.TINYLAYOUT_PARITY_ROOT || 'runs/synthetic_probe_final', windows[0].frames[0].image_path)));
  await page.getByRole('button', {name: '目标区域', exact: true}).click();
  await page.screenshot({path: `${out}/exported.png`});
  const render = await context.newPage(); await render.goto(url + 'render.html'); await render.waitForFunction(() => !!window.visibilityProbe);
  const visibility = await render.evaluate(c => window.visibilityProbe(c), config) as {clear_far_cells: number; blocked_far_cells: number; floor_hit_count: number; floor_max_z_error: number; floor_normal_count:number;floor_normal_max_error:number;clear_rgb: string; blocked_rgb: string};
  assert.ok(visibility.clear_far_cells > 0); assert.equal(visibility.blocked_far_cells, 0); assert.ok(visibility.floor_hit_count > 0); assert.ok(visibility.floor_max_z_error < .003);
  assert.ok(visibility.floor_normal_count>0);assert.ok(visibility.floor_normal_max_error<.02);
  for (const name of ['clear_rgb', 'blocked_rgb'] as const) await writeFile(`${out}/${name}.png`, Buffer.from(visibility[name].split(',')[1], 'base64'));
  assert.deepEqual(network, []); assert.deepEqual(errors, []);
  const {clear_rgb: _, blocked_rgb: __, ...stats} = visibility;
  await writeFile(`${out}/summary.json`, JSON.stringify({status: 'passed', browser_plugin: 'not available; Playwright Chromium used', url, viewport: [1536, 1024], desktop_only: true, external_requests: network, app_errors: errors,
    browser_cli_label_parity: true, browser_cli_rgb_parity: true, varied_layout_controls:true,zip_windows: windows.length, ...stats}, null, 2));
  console.log(JSON.stringify({status: 'passed', output: out, ...stats}));
} catch (error) {await page.screenshot({path: `${out}/failure.png`, fullPage: true}); await writeFile(`${out}/failure.json`, JSON.stringify({error: String(error), errors, network})); throw error;}
finally {await browser.close();}
