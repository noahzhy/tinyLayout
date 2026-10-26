import {type CameraFrame, type Hit, type Layout, type SceneConfig, type Sink, contextAnchor, jsonBytes, stableHash} from './types';
import {makeFrames, makeLayout,counterfactualLayout,contains} from './layout';
import {localGraph, makeLabels, rasterize} from './labels';
import {SceneRenderer} from './render';
import {topologyEvidence} from './topology-evidence';

export function decodeDataURL(url: string): Uint8Array {
  return Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), ch => ch.charCodeAt(0));
}
export interface ExportOptions {split: 'train' | 'dev' | 'test'; progress?: (done: number, total: number) => void; signal?: AbortSignal; contextFrames?: 2|4}
export async function exportStore(config: SceneConfig, sink: Sink, options: ExportOptions) {
  const layout = makeLayout(config), renderer = new SceneRenderer(layout), c = layout.config;
  const prefix = `stores/${layout.store_id}`, windows: Record<string, unknown>[] = [], frameIndex: Record<string, unknown>[] = [],graphEvidenceIndex:Record<string,unknown>[]=[];
  let done = 0;
  try {
    await sink(`${prefix}/scene.json`, jsonBytes(layout));
    await sink(`${prefix}/global_graph.json`, jsonBytes(layout.graph));
    for (let task = 0; task < 2; task++) {
      const frames = makeFrames(layout, task), hits = new Map<string, Hit[]>();
      const metadata = new Map<string, Record<string, unknown>>();
      for (const frame of frames) {
        if (options.signal?.aborted) throw Error('Export cancelled');
        const capture = renderer.capture(frame), path = `${prefix}/${frame.task_id}`;
        await sink(`${path}/rgb/${frame.frame_id}.png`, decodeDataURL(capture.rgb));
        await sink(`${path}/privileged/instance/${frame.frame_id}.png`, decodeDataURL(capture.instance));
        await sink(`${path}/privileged/depth/${frame.frame_id}.rgba`, decodeDataURL(capture.depth));
        const record = {store_id: layout.store_id, task_id: frame.task_id, segment_id: frame.segment_id, frame_id: frame.frame_id,
          timestamp_s: frame.timestamp_s, image_path: `${path}/rgb/${frame.frame_id}.png`, width: c.image_width, height: c.image_height};
        metadata.set(frame.frame_id, record); frameIndex.push(record); hits.set(frame.frame_id, capture.hits);
        options.progress?.(++done, 2 * c.frames_per_task);
        // Yield so progress and cancellation remain usable during browser export.
        await new Promise(resolve => setTimeout(resolve, 0));
      }
      await sink(`${prefix}/task_${task}/privileged/cameras.json`, jsonBytes({gt_only: true, frames, camera: {vertical_fov_deg: 60, near: .05, far: 100}, depth_encoding: 'three_r180_RGBA_depth_bottom_up_uint8', visibility_stride_px: 4}));
      const segments = [...new Set(frames.map(f => f.segment_id))];
      for (const segment of segments) {
        const group = frames.filter(f => f.segment_id === segment);
        for (let start = 0; start + 8 <= group.length; start += 4) {
          const contextCount=options.contextFrames??4;
          const selected = group.slice(start, start + 8), context = selected.slice(0, contextCount), anchor = contextAnchor(context), hidden = selected.slice(contextCount);
          const sampleId = `${layout.store_id}_task${task}_${anchor.frame_id}`, chartId = `${sampleId}:chart`;
          const label = makeLabels(layout, anchor, context.flatMap(f => hits.get(f.frame_id)!), selected.flatMap(f => hits.get(f.frame_id)!), chartId);
          const labelPath = `${prefix}/labels/${sampleId}.json`, graphPath = `${prefix}/local_graphs/${sampleId}.json`, chartPath = `${prefix}/charts/${sampleId}.json`;
          const chart = {chart_id: chartId, convention: 'anchor_ground_xy_v1', unit_mode: 'normalized', span_units: 2, valid: Math.abs(Math.cos(anchor.pitch)) > 1e-3};
          await sink(labelPath, jsonBytes(label)); await sink(graphPath, jsonBytes(localGraph(layout, anchor, chartId)));
          await sink(chartPath, jsonBytes({...chart, gt_only: true, anchor_frame_id: anchor.frame_id, physical_span_m: c.chart_span_m, origin_world: anchor.position, yaw: anchor.yaw}));
          const evidencePath=`${prefix}/graph_evidence/${sampleId}.json`;
          await sink(evidencePath,jsonBytes(topologyEvidence(layout,anchor,context.map(frame=>({frame,hits:hits.get(frame.frame_id)!})),chartId)));
          if(contextCount===2){
            const actual=selected.slice(0,4);
            await sink(`${prefix}/association_observations/${sampleId}.json`,jsonBytes({gt_only:true,
              protocol:'prefix2_actual4_same_anchor_v1',anchor_frame_id:anchor.frame_id,
              actual_frame_ids:actual.map(f=>f.frame_id),
              labels:makeLabels(layout,anchor,actual.flatMap(f=>hits.get(f.frame_id)!),actual.flatMap(f=>hits.get(f.frame_id)!),chartId),
              graph:topologyEvidence(layout,anchor,actual.map(frame=>({frame,hits:hits.get(frame.frame_id)!})),chartId)}));
          }
          graphEvidenceIndex.push({sample_id:sampleId,store_id:layout.store_id,task_id:anchor.task_id,chart_id:chartId,path:evidencePath});
          windows.push({schema_version: '1.1', sample_id: sampleId, store_id: layout.store_id, layout_hash: layout.layout_hash, task_id: anchor.task_id, split: options.split,
            frames: selected.map(f => metadata.get(f.frame_id)), context_frame_ids: context.map(f => f.frame_id), hidden_frame_ids: hidden.map(f => f.frame_id), teacher_frame_ids: selected.map(f => f.frame_id),
            anchor_frame_id: anchor.frame_id, query_cutoff_s: selected.at(-1)!.timestamp_s,
            memory_snapshot: {snapshot_id: `${sampleId}:empty_history`, cutoff_s: context[0].timestamp_s - .5, records: []}, chart,
            labels: {schema_version: '1.0', path: labelPath, chart_id: chartId, source: label.source, topology_path: graphPath}, data_kind: 'synthetic_perspective_rgb'});
        }
      }
    }
    const varied=['mixed','islands','rooms'].includes(c.family);
    const route=makeFrames(layout,0);
    const observation:CameraFrame=varied?route[4]:{...route[4],position:[route[0].position[0],3,1.55],yaw:0};
    const positive=renderer.capture(observation);
    const counter=counterfactualLayout(layout,positive.hits.map(hit=>hit.instance));
    if(counter.solids.some(s=>contains(s,observation.position.slice(0,2) as [number,number],.18)))throw Error('counterfactual camera collision');
    const counterRenderer = new SceneRenderer(counter);
    try {
      const negative = counterRenderer.capture(observation);
      const a = makeLabels(layout, observation, [], positive.hits, 'counterfactual'), b = makeLabels(counter, observation, [], negative.hits, 'counterfactual');
      const ra = rasterize(layout, observation), rb = rasterize(counter, observation);
      const changed = ra.semantic.reduce((total, cls, i) => total + Number((a.teacher_support[i] || b.teacher_support[i]) && (cls !== rb.semantic[i] || ra.opening[i] !== rb.opening[i])), 0);
      await sink(`${prefix}/counterfactual/positive.png`, decodeDataURL(positive.rgb)); await sink(`${prefix}/counterfactual/negative.png`, decodeDataURL(negative.rgb));
      await sink(`${prefix}/counterfactual/scene.json`, jsonBytes(counter));
      await sink(`${prefix}/counterfactual/pair.json`, jsonBytes({gt_only: true, parent_store_id: layout.store_id, split: options.split,
        change: varied?'visible_fixture_shortened':'cross_aisle_connectivity', candidate_token_budget: 64, ranking_valid: changed > 0, changed_visible_cells: changed,
        reason: changed ? 'rendered observable structure differs' : 'no discriminable supported structure; do not rank', positive_layout_hash: layout.layout_hash, negative_layout_hash: counter.layout_hash}));
    } finally {counterRenderer.dispose();}
    await sink(`${prefix}/provenance.json`, jsonBytes({schema_version: '1.0', generator: 'tinylayout-three-v2', config: c, layout_hash: layout.layout_hash, store_id: layout.store_id, split: options.split,
      assets: 'procedural geometry and shared unbranded colors; no external assets', license: 'Apache-2.0', renderer: 'three@0.180.0', visibility: 'instance/depth first-surface, pixel stride 4, conservative semantic-matched chart scatter',
      color_ids_in_rgb: false, privileged_metadata_as_online_input: false}));
    return {store_id: layout.store_id, layout_hash: layout.layout_hash, split: options.split, windows, frames: frameIndex, config_hash: stableHash(c),graph_evidence_index:graphEvidenceIndex};
  } finally {renderer.dispose();}
}
