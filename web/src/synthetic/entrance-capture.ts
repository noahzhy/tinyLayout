import {segmentFree} from './layout';
import {localGraph,makeLabels} from './labels';
import {SceneRenderer} from './render';
import {decodeDataURL} from './export';
import {topologyEvidence} from './topology-evidence';
import {jsonBytes,type CameraFrame,type Hit,type Layout,type Sink,type XY} from './types';

/** Privileged collection planning. It never supplies a pose to model inference. */
export function entranceRoute(layout:Layout,startTime:number):CameraFrame[]{
  const entry=layout.graph.nodes.find(n=>n.kind==='entrance');
  if(!entry)throw Error(`${layout.store_id}: no constructed entrance`);
  const ys=[...Array.from({length:16},(_,i)=>-4+(entry.xy[1]+4)*i/15),
    ...Array.from({length:8},(_,i)=>entry.xy[1]+(2-entry.xy[1])*(i+1)/8),
    ...Array.from({length:8},(_,i)=>2+2*(i+1)/8)];
  ys[15]=entry.xy[1]; // Traversal starts at the exact constructed node.
  const frames=ys.map((y,i):CameraFrame=>({frame_id:`entry_f${String(i).padStart(4,'0')}`,
    task_id:'task_entrance',segment_id:'entrance_approach',timestamp_s:startTime+i*layout.config.sample_interval_s,
    position:[entry.xy[0],y,1.55],yaw:0,pitch:-.28,roll:0}));
  for(let i=0;i<frames.length;i++){
    const a=(frames[Math.max(0,i-1)].position.slice(0,2)) as XY,b=frames[i].position.slice(0,2) as XY;
    if(!segmentFree(a,b,layout.solids))throw Error(`${layout.store_id}/${frames[i].frame_id}: entrance capture collision`);
  }
  return frames;
}

export async function exportEntranceCapture(layout:Layout,split:'train'|'dev'|'test',startTime:number,queryStart:number,sink:Sink){
  const route=entranceRoute(layout,startTime),renderer=new SceneRenderer(layout),c=layout.config;
  const prefix=`stores/${layout.store_id}`,privateRoot=`${prefix}/privileged`;
  const hits=new Map<string,Hit[]>(),frames:Record<string,any>[]=[],windows:Record<string,any>[]=[],queries:Record<string,any>[]=[],evidenceIndex:Record<string,any>[]=[];
  try{
    for(const frame of route){
      const capture=renderer.capture(frame),path=`${prefix}/${frame.task_id}/rgb/${frame.frame_id}.png`;
      await sink(path,decodeDataURL(capture.rgb));
      await sink(`${privateRoot}/instance/${frame.frame_id}.png`,decodeDataURL(capture.instance));
      await sink(`${privateRoot}/depth/${frame.frame_id}.rgba`,decodeDataURL(capture.depth));
      hits.set(frame.frame_id,capture.hits);
      frames.push({store_id:layout.store_id,task_id:frame.task_id,segment_id:frame.segment_id,frame_id:frame.frame_id,
        timestamp_s:frame.timestamp_s,image_path:path,width:c.image_width,height:c.image_height});
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    for(let end=3;end<route.length;end+=4){
      const actual=route.slice(end-3,end+1),context=actual.slice(0,2),anchor=context[1],cutoff=actual[3];
      const sampleId=`${layout.store_id}_q${String(queryStart+windows.length).padStart(4,'0')}`,chartId=sampleId+':chart';
      const views=actual.map(frame=>({frame,hits:hits.get(frame.frame_id)!}));
      const contextHits=views.slice(0,2).flatMap(v=>v.hits),actualHits=views.flatMap(v=>v.hits);
      const label=makeLabels(layout,anchor,contextHits,actualHits,chartId),evidence=topologyEvidence(layout,anchor,views.slice(0,2),chartId);
      const actualEvidence=topologyEvidence(layout,anchor,views,chartId);
      const labelPath=`${privateRoot}/labels/${sampleId}.json`,graphPath=`${privateRoot}/graphs/${sampleId}.json`,evidencePath=`${privateRoot}/evidence/${sampleId}.json`;
      await sink(labelPath,jsonBytes(label));await sink(graphPath,jsonBytes(localGraph(layout,anchor,chartId)));
      await sink(evidencePath,jsonBytes(evidence));
      await sink(`${prefix}/association_observations/${sampleId}.json`,jsonBytes({gt_only:true,
        protocol:'prefix2_actual4_same_anchor_v1',anchor_frame_id:anchor.frame_id,actual_frame_ids:actual.map(f=>f.frame_id),
        labels:makeLabels(layout,anchor,actualHits,actualHits,chartId),graph:actualEvidence}));
      const nearest=evidence.nodes.filter(n=>n.state==='supported').sort((a,b)=>Math.hypot(...a.xy)-Math.hypot(...b.xy))[0];
      queries.push({query_id:sampleId,context_frame_ids:actual.map(f=>f.frame_id),cutoff_s:cutoff.timestamp_s,segment_id:anchor.segment_id,
        place:nearest?{gt_node_id:nearest.gt_node_id,state:nearest.state,kind_valid:nearest.kind_valid,ports:nearest.ports}:null,evidence_path:evidencePath});
      windows.push({schema_version:'1.1',sample_id:sampleId,store_id:layout.store_id,layout_hash:layout.layout_hash,task_id:anchor.task_id,split,
        frames:frames.slice(end-3,end+1),context_frame_ids:context.map(f=>f.frame_id),hidden_frame_ids:actual.slice(2).map(f=>f.frame_id),
        teacher_frame_ids:actual.map(f=>f.frame_id),anchor_frame_id:anchor.frame_id,query_cutoff_s:cutoff.timestamp_s,
        memory_snapshot:{snapshot_id:sampleId+':empty_history',cutoff_s:actual[0].timestamp_s-.5,records:[]},
        chart:{chart_id:chartId,convention:'anchor_ground_xy_v1',unit_mode:'normalized',span_units:2,valid:true},
        labels:{schema_version:'1.0',path:labelPath,topology_path:graphPath,chart_id:chartId,source:label.source},data_kind:'synthetic_mapping_benchmark_v1'});
      evidenceIndex.push({sample_id:sampleId,store_id:layout.store_id,task_id:anchor.task_id,chart_id:chartId,path:evidencePath});
    }
    const entry=layout.graph.nodes.find(n=>n.kind==='entrance')!;
    const edge=layout.graph.edges.find(e=>e.a===entry.id||e.b===entry.id)!;
    const target=edge.a===entry.id?edge.b:edge.a;
    const traversals=[{id:'entrance_tr0',edge_id:edge.id,source:entry.id,target,
      source_port:edge.a===entry.id?edge.a_port:edge.b_port,target_port:edge.a===entry.id?edge.b_port:edge.a_port,
      frame_ids:route.slice(15,24).map(f=>f.frame_id),segment_id:route[15].segment_id}];
    return {frames,windows,queries,graph_evidence_index:evidenceIndex,camera_frames:route,traversals};
  }finally{renderer.dispose();}
}
