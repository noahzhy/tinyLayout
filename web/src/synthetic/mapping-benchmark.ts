import {makeLayout, segmentFree} from './layout';
import {localGraph, makeLabels} from './labels';
import {SceneRenderer,RENDER_CAMERA} from './render';
import {decodeDataURL} from './export';
import {topologyEvidence} from './topology-evidence';
import {jsonBytes, stableHash, type CameraFrame, type GraphNode, type Hit, type Layout, type SceneConfig, type Sink, type XY} from './types';

interface Traversal {id: string; edge_id: string; source: string; target: string; source_port: string; target_port: string; frame_ids: string[]; segment_id: string}
export interface BenchmarkRoute {frames: CameraFrame[]; traversals: Traversal[]; checkpoints: {name: string; frame_id: string; node_id: string}[]; similar_pair: [string, string]}

/** Privileged route construction; no route/pose fields are exported to the online stream. */
export function benchmarkRoute(layout: Layout): BenchmarkRoute {
  if (layout.config.family !== 'T') throw Error('mapping benchmark requires family=T');
  const c = layout.config, nodes = layout.graph.nodes;
  const middle = nodes.filter(n => n.ports.length === 3 && n.xy[1] > 2.01 && n.xy[1] < c.length - 2.01).sort((a, b) => a.xy[0] - b.xy[0]);
  if (middle.length < 2) throw Error('mapping benchmark requires two T junctions');
  const peer = middle[0], target = middle.at(-1)!;
  const at = (x: number, y: number) => {const n = nodes.find(n => Math.hypot(n.xy[0] - x, n.xy[1] - y) < 1e-6); if (!n) throw Error(`route node missing at ${x},${y}`); return n;};
  const front = nodes.filter(n => Math.abs(n.xy[1] - 2) < 1e-6).sort((a,b) => a.xy[0] - b.xy[0]);
  const targetColumn = front.findIndex(n => n.xy[0] === target.xy[0]);
  const branch = at(front[targetColumn - 1].xy[0], target.xy[1]);
  const frames: CameraFrame[] = [], traversals: Traversal[] = [], checkpoints: BenchmarkRoute['checkpoints'] = [];
  let current = nodes.find(n => n.kind === 'entrance')!, yaw = 0, segment = 0;
  const push = (p: XY, angle: number) => frames.push({frame_id: `f${String(frames.length).padStart(4, '0')}`, task_id: 'task_0', segment_id: `segment_${segment}`,
    timestamp_s: 10 + frames.length * c.sample_interval_s, position: [p[0], p[1], 1.55], yaw: angle, pitch: -.28, roll: 0});
  const turn = (angle: number) => {
    const delta = Math.atan2(Math.sin(angle - yaw), Math.cos(angle - yaw)), count = Math.max(1, Math.ceil(Math.abs(delta) / .18));
    for (let i = 1; i <= count; i++) push(current.xy, yaw + delta * i / count);
    yaw += delta;
  };
  const hold = (name: string, node = current, position = current.xy) => {
    // End on a query boundary; enough frames for a wholly causal four-frame window.
    for (let i = 0; i < 8 || frames.length % 4; i++) push(position, yaw);
    checkpoints.push({name, frame_id: frames.at(-1)!.frame_id, node_id: node.id});
  };
  const move = (next: GraphNode, approachName?: string) => {
    const e = layout.graph.edges.find(e => e.a === current.id && e.b === next.id || e.b === current.id && e.a === next.id);
    if (!e || !segmentFree(current.xy, next.xy, layout.solids)) throw Error(`benchmark route is not a clear GT edge: ${current.id}/${next.id}`);
    turn(Math.atan2(next.xy[0] - current.xy[0], next.xy[1] - current.xy[1]));
    const start = frames.length - 1, distance = Math.hypot(next.xy[0] - current.xy[0], next.xy[1] - current.xy[1]);
    const count = Math.ceil(distance / .42);
    const approach = Math.max(0, count - Math.ceil(2.8 * count / distance));
    if (approachName && approach === 0) hold(approachName, next);
    for (let i = 1; i <= count; i++) {
      const p: XY = [current.xy[0] + (next.xy[0] - current.xy[0]) * i / count, current.xy[1] + (next.xy[1] - current.xy[1]) * i / count];
      push(p, yaw);
      if (approachName && i === approach) hold(approachName, next, p);
    }
    traversals.push({id: `tr${traversals.length}`, edge_id: e.id, source: current.id, target: next.id,
      source_port: e.a === current.id ? e.a_port : e.b_port, target_port: e.a === current.id ? e.b_port : e.a_port,
      frame_ids: frames.slice(start).map(f => f.frame_id), segment_id: `segment_${segment}`});
    current = next;
  };
  push(current.xy, yaw); move(front[0]);
  for (let i = 1; i <= targetColumn; i++) move(front[i]);
  move(target, 'first_T'); hold('at_T'); turn(-Math.PI / 2); hold('branch_scan');
  move(branch); hold('branch_endpoint'); move(target, 'return_T'); hold('at_return');
  move(at(target.xy[0], c.length - 2));
  for (let i = targetColumn - 1; i >= 0; i--) move(at(front[i].xy[0], c.length - 2));
  move(peer, 'similar_T'); hold('at_similar'); turn(Math.PI / 2); hold('similar_scan');
  // Discontinuous restart has no traversal label across the boundary.
  current = front.at(-2)!; segment++; yaw = 0; hold('restart');
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i-1], b = frames[i];
    if (a.segment_id === b.segment_id && !segmentFree(a.position.slice(0,2) as XY, b.position.slice(0,2) as XY, layout.solids)) throw Error(`benchmark collision at ${b.frame_id}`);
  }
  return {frames, traversals, checkpoints, similar_pair: [target.id, peer.id]};
}

export async function exportMappingBenchmark(config: SceneConfig, sink: Sink,contextFrames:2|4=4,trainingSplit?:'train'|'dev'|'test') {
  if (config.stores !== 1 || config.family !== 'T') throw Error('benchmark requires exactly one T-layout store');
  const layout = makeLayout(config), route = benchmarkRoute(layout), renderer = new SceneRenderer(layout), c = layout.config;
  const prefix = `stores/${layout.store_id}`, hits = new Map<string, Hit[]>(), frames: Record<string, unknown>[] = [], windows: Record<string, unknown>[] = [], queries: Record<string, unknown>[] = [];
  const privateRoot=trainingSplit?`${prefix}/privileged`:'privileged';
  try {
    await sink(`${privateRoot}/scene.json`, jsonBytes(layout));
    await sink(`${privateRoot}/global_graph.json`, jsonBytes(layout.graph));
    for (const frame of route.frames) {
      const capture = renderer.capture(frame), rgbPath = `${prefix}/${frame.task_id}/rgb/${frame.frame_id}.png`;
      await sink(rgbPath, decodeDataURL(capture.rgb));
      await sink(`${privateRoot}/instance/${frame.frame_id}.png`, decodeDataURL(capture.instance));
      await sink(`${privateRoot}/depth/${frame.frame_id}.rgba`, decodeDataURL(capture.depth));
      hits.set(frame.frame_id, capture.hits);
      frames.push({store_id: layout.store_id, task_id: frame.task_id, segment_id: frame.segment_id, frame_id: frame.frame_id,
        timestamp_s: frame.timestamp_s, image_path: rgbPath, width: c.image_width, height: c.image_height});
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    for (let end = 3; end < route.frames.length; end += 4) {
      const context = route.frames.slice(end - 3, end + 1), anchor = context[contextFrames-1],cutoff=context.at(-1)!;
      if (context.some(f => f.segment_id !== anchor.segment_id)) continue;
      const sampleId = `${trainingSplit?layout.store_id+'_':''}q${String(queries.length).padStart(4,'0')}`, chartId = `${sampleId}:chart`;
      const prefixFrames=trainingSplit?context.slice(0,contextFrames):context;
      const label = makeLabels(layout, anchor, prefixFrames.flatMap(f => hits.get(f.frame_id)!), context.flatMap(f => hits.get(f.frame_id)!), chartId);
      const evidence = topologyEvidence(layout, anchor, prefixFrames.map(frame => ({frame, hits: hits.get(frame.frame_id)!})), chartId);
      const evidencePath=`${privateRoot}/evidence/${sampleId}.json`;
      const labelPath = `${privateRoot}/labels/${sampleId}.json`, graphPath = `${privateRoot}/graphs/${sampleId}.json`;
      await sink(labelPath, jsonBytes(label)); await sink(graphPath, jsonBytes(localGraph(layout, anchor, chartId)));
      await sink(evidencePath, jsonBytes(evidence));
      if(trainingSplit){
        await sink(`${prefix}/association_observations/${sampleId}.json`,jsonBytes({gt_only:true,protocol:'prefix2_actual4_same_anchor_v1',anchor_frame_id:anchor.frame_id,actual_frame_ids:context.map(f=>f.frame_id),
          labels:makeLabels(layout,anchor,context.flatMap(f=>hits.get(f.frame_id)!),context.flatMap(f=>hits.get(f.frame_id)!),chartId),
          graph:topologyEvidence(layout,anchor,context.map(frame=>({frame,hits:hits.get(frame.frame_id)!})),chartId)}));
      }
      const named = route.checkpoints.find(p => p.frame_id === cutoff.frame_id);
      const candidates = layout.graph.nodes.filter(n => n.ports.length >= 3 && Math.hypot(n.xy[0] - anchor.position[0], n.xy[1] - anchor.position[1]) < 3.5);
      const nearest = named ? layout.graph.nodes.find(n => n.id === named.node_id) : candidates.filter(n => evidence.nodes.some(e => e.gt_node_id === n.id && e.state === 'supported')).sort((a,b) => Math.hypot(a.xy[0]-anchor.position[0], a.xy[1]-anchor.position[1])-Math.hypot(b.xy[0]-anchor.position[0], b.xy[1]-anchor.position[1]))[0];
      const nodeEvidence = evidence.nodes.find(n => n.gt_node_id === nearest?.id);
      queries.push({query_id: sampleId, context_frame_ids: context.map(f => f.frame_id), cutoff_s: cutoff.timestamp_s, segment_id: anchor.segment_id,
        place: nearest ? {gt_node_id: nearest.id, state: nodeEvidence?.state ?? 'unknown', kind_valid: nodeEvidence?.kind_valid??false, ports: nodeEvidence?.ports ?? []} : null,
        evidence_path:evidencePath});
      windows.push({schema_version:'1.1',sample_id:sampleId,store_id:layout.store_id,layout_hash:layout.layout_hash,task_id:anchor.task_id,split:trainingSplit??'dev',
        frames:frames.slice(end-3,end+1),context_frame_ids:prefixFrames.map(f=>f.frame_id),hidden_frame_ids:trainingSplit?context.slice(contextFrames).map(f=>f.frame_id):[],teacher_frame_ids:context.map(f=>f.frame_id),anchor_frame_id:anchor.frame_id,query_cutoff_s:cutoff.timestamp_s,
        memory_snapshot:{snapshot_id:`${sampleId}:empty_history`,cutoff_s:context[0].timestamp_s-.5,records:[]},
        chart:{chart_id:chartId,convention:'anchor_ground_xy_v1',unit_mode:'normalized',span_units:2,valid:true},
        labels:{schema_version:'1.0',path:labelPath,topology_path:graphPath,chart_id:chartId,source:label.source},data_kind:'synthetic_mapping_benchmark_v1'});
    }
    const checkpointQueries = route.checkpoints.map(p => ({...p, query_id: queries.find(q => (q.context_frame_ids as string[]).at(-1) === p.frame_id)?.query_id}));
    if (checkpointQueries.some(p => !p.query_id)) throw Error('checkpoint does not end on a causal query');
    const checkpoint = (name: string) => checkpointQueries.find(p => p.name === name)!;
    const pairs = [{a:checkpoint('first_T').query_id,b:checkpoint('return_T').query_id,relation:'same_place',ranking_valid:false,reason:'cross-chart matching not yet certified'},
      {a:checkpoint('first_T').query_id,b:checkpoint('similar_T').query_id,relation:'different_place',ranking_valid:false,reason:'different physical nodes; visible discriminability not certified'}];
    await sink(`${privateRoot}/truth.json`, jsonBytes({schema_version:'1.1',gt_only:true,benchmark_id:'t_return_restart_v1',store_id:layout.store_id,layout_hash:layout.layout_hash,
      queries,traversals:route.traversals,checkpoints:checkpointQueries,association_pairs:pairs,required_revisit_query_id:checkpoint('return_T').query_id,
      required_traversal_id:route.traversals.find(t=>t.source===route.similar_pair[0] && t.target!==route.similar_pair[1])!.id,
      side_supervision_available:false,scope:'fixed synthetic protocol benchmark; not learned mapping performance'}));
    await sink(`${privateRoot}/cameras.json`,jsonBytes({gt_only:true,frames:route.frames,camera:RENDER_CAMERA,
      depth_encoding:'three_r180_RGBA_depth_bottom_up_uint8',visibility_stride_px:4}));
    if(!trainingSplit)await sink('benchmark.json',jsonBytes({schema_version:contextFrames===2?'1.1':'1.0',benchmark_id:'t_return_restart_v1',stream_path:'frames.jsonl',windows_path:'windows.jsonl',truth_path:'privileged/truth.json',online_fields:['RGB','timestamp_s','segment_id'],split:'dev',synthetic_only:true,
      ...(contextFrames===2?{chart_anchor_policy:'prefix_last',predictor_context_frames:2}:{})}));
    const graphEvidenceIndex=queries.map(q=>({sample_id:q.query_id,store_id:layout.store_id,task_id:'task_0',chart_id:`${q.query_id}:chart`,path:q.evidence_path}));
    return {store_id:layout.store_id,layout_hash:layout.layout_hash,split:trainingSplit??'dev' as const,frames,windows,config_hash:stableHash(c),query_count:queries.length,frame_count:route.frames.length,graph_evidence_index:graphEvidenceIndex};
  } finally {renderer.dispose();}
}
