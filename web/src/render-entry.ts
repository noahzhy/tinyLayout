import {exportStore} from './synthetic/export';
import {exportMappingBenchmark} from './synthetic/mapping-benchmark';
import {makeLayout, makeFrames} from './synthetic/layout';
import {SceneRenderer} from './synthetic/render';
import {fromChart, makeLabels} from './synthetic/labels';
import {type SceneConfig,type Layout,type CameraFrame} from './synthetic/types';
import {topologyEvidence} from './synthetic/topology-evidence';
import {exportEntranceCapture} from './synthetic/entrance-capture';
declare global {interface Window {
  writeSyntheticFile: (path: string, base64: string) => Promise<void>;
  exportSynthetic: (config: SceneConfig, split: 'train' | 'dev' | 'test',contextFrames?:2|4) => ReturnType<typeof exportStore>;
  exportMappingBenchmark: (config: SceneConfig,contextFrames?:2|4,trainingSplit?:'train'|'dev'|'test') => ReturnType<typeof exportMappingBenchmark>;
  probeSynthetic: (config: SceneConfig) => unknown;
  visibilityProbe: (config: SceneConfig) => unknown;
  entranceProbe: (layout:Layout) => {rgb:string;frame:CameraFrame;evidence:ReturnType<typeof topologyEvidence>;labels:ReturnType<typeof makeLabels>};
  exportEntranceCapture: (layout:Layout,split:'train'|'dev'|'test',startTime:number,queryStart:number) => ReturnType<typeof exportEntranceCapture>;
}}
window.exportSynthetic = (config, split,contextFrames) => exportStore(config, async (path, bytes) => {
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  await window.writeSyntheticFile(path, btoa(binary));
}, {split,contextFrames});
window.exportMappingBenchmark = (config,contextFrames,trainingSplit) => exportMappingBenchmark(config, async (path, bytes) => {
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  await window.writeSyntheticFile(path, btoa(binary));
},contextFrames,trainingSplit);
window.exportEntranceCapture = (layout,split,startTime,queryStart) => exportEntranceCapture(layout,split,startTime,queryStart,async(path,bytes)=>{
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  await window.writeSyntheticFile(path,btoa(binary));
});
window.probeSynthetic = config => {
  const layout = makeLayout(config), runtime = new SceneRenderer(layout);
  try {const frames = makeFrames(layout); const capture = runtime.capture(frames[0]); return {layout_hash: layout.layout_hash, labels: makeLabels(layout, frames[0], capture.hits, capture.hits, 'probe'), hits: capture.hits.slice(0, 100), rgb: capture.rgb};}
  finally {runtime.dispose();}
};
window.visibilityProbe = config => {
  const layout = makeLayout(config), frame = {...makeFrames(layout)[0], position: [makeFrames(layout)[0].position[0], 3, 1.55] as [number, number, number], yaw: 0, pitch: -.3, roll: 0};
  const clear = {...layout, solids: layout.solids.filter(s => s.kind !== 'occluder')};
  const blocked: typeof layout = {...clear, solids: [...clear.solids, {id: 'test_occluder', kind: 'occluder', x: frame.position[0], y: 7, w: 3, d: .25, h: 3.5, semantic: -1}]};
  const a = new SceneRenderer(clear), b = new SceneRenderer(blocked);
  try {
    const ca = a.capture(frame), cb = b.capture(frame), la = makeLabels(clear, frame, ca.hits, ca.hits, 'probe'), lb = makeLabels(blocked, frame, cb.hits, cb.hits, 'probe');
    const far = (i: number) => {
      const p = fromChart([-1 + 2 * (i % config.bev_size + .5) / config.bev_size, 1 - 2 * (Math.floor(i / config.bev_size) + .5) / config.bev_size], frame, config.chart_span_m);
      // This center strip is geometrically behind the opaque screen; side aisles
      // can remain visible around the screen and are intentionally excluded.
      return p[1] > 7.5 && Math.abs(p[0] - frame.position[0]) < .6;
    };
    const floors = ca.hits.filter(h => h.instance === 1);
    const normalFloors = floors.filter(h=>h.normal);
    return {clear_far_cells: la.context_support.filter((v, i) => v && far(i)).length, blocked_far_cells: lb.context_support.filter((v, i) => v && far(i)).length,
      floor_hit_count: floors.length, floor_max_z_error: Math.max(...floors.map(h => Math.abs(h.z))), floor_normal_count:normalFloors.length,
      floor_normal_max_error:Math.max(...normalFloors.map(h=>Math.hypot(h.normal![0],h.normal![1],h.normal![2]-1))),clear_rgb: ca.rgb, blocked_rgb: cb.rgb};
  } finally {a.dispose(); b.dispose();}
};
window.entranceProbe = layout => {
  const entrance=layout.graph.nodes.find(n=>n.kind==='entrance');
  if(!entrance)throw Error('entrance probe requires a constructed entrance');
  const frame:CameraFrame={frame_id:'entrance_probe',task_id:'entrance_probe',segment_id:'entrance_probe',timestamp_s:0,
    position:[entrance.xy[0],-4,1.55],yaw:0,pitch:-.28,roll:0};
  const renderer=new SceneRenderer(layout);
  try {
    const capture=renderer.capture(frame);
    return {rgb:capture.rgb,frame,evidence:topologyEvidence(layout,frame,[{frame,hits:capture.hits}],'entrance_probe:chart'),
      labels:makeLabels(layout,frame,capture.hits,capture.hits,'entrance_probe:chart')};
  } finally {renderer.dispose();}
};
