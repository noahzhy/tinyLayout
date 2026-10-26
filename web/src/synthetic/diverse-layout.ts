import {contains,footprintHash,segmentFree} from './geometry';
import {rng,type CameraFrame,type GraphNode,type Layout,type SceneConfig,type Solid,type XY} from './types';

/** Variable bays separated by explicitly reserved walking corridors. */
function axis(size:number,bays:number,aisle:number,random:()=>number){
  const slack=size-.6-(bays+1)*aisle-bays;
  if(slack<0)throw Error('aisles and fixture bays do not fit store dimensions');
  const weights=Array.from({length:bays},()=>.6+random()),sum=weights.reduce((a,b)=>a+b,0);
  const aisleWeights=Array.from({length:bays+1},()=>.5+random()),aisleSum=aisleWeights.reduce((a,b)=>a+b,0);
  const aisles=aisleWeights.map(w=>aisle+slack*.2*w/aisleSum);
  const widths=weights.map(w=>1+slack*.8*w/sum),centers:number[]=[],ranges:[number,number][]=[];
  let start=.3;
  for(let i=0;i<=bays;i++){
    centers.push(start+aisles[i]/2);start+=aisles[i];
    if(i<bays){ranges.push([start,start+widths[i]]);start+=widths[i];}
  }
  return {centers,ranges,aisles};
}

export function makeDiverseLayout(c:SceneConfig):Layout {
  const random=rng(c.seed),columns=c.shelf_rows;
  const maxBands=Math.min(3,Math.floor((c.length-.6-c.aisle_width)/(c.aisle_width+1)));
  if(maxBands<1)throw Error('horizontal aisles do not fit store length');
  const bands=Math.min(maxBands,c.family==='rooms'?2:2+Math.floor(random()*2));
  const x=axis(c.width,columns,c.aisle_width,random),y=axis(c.length,bands,c.aisle_width,random);
  const solids:Solid[]=[],doors:{column:number;row:number;x:number;y:number}[]=[];
  const add=(id:string,kind:Solid['kind'],cx:number,cy:number,w:number,d:number,h:number,semantic:number)=>{
    if(w<=0||d<=0)throw Error(id+': invalid fixture dimensions');
    solids.push({id,kind,x:cx,y:cy,w,d,h,semantic});
  };
  const entranceColumn=Math.floor(random()*x.centers.length),entryX=x.centers[entranceColumn],gap=x.aisles[entranceColumn];
  add('back_wall','wall',c.width/2,c.length,c.width,.2,2.8,2);
  add('left_wall','wall',0,c.length/2,.2,c.length,2.8,2);
  add('right_wall','wall',c.width,c.length/2,.2,c.length,2.8,2);
  add('front_left','wall',(entryX-gap/2)/2,0,entryX-gap/2,.2,2.8,2);
  add('front_right','wall',(c.width+entryX+gap/2)/2,0,c.width-entryX-gap/2,.2,2.8,2);
  let rooms=0;
  for(let row=0;row<bands;row++)for(let col=0;col<columns;col++){
    const [left,right]=x.ranges[col],[front,back]=y.ranges[row],w=right-left,d=back-front;
    const room=!(row===0&&col<3)&&w>=1.8&&d>=2.4&&c.family!=='islands'&&
      (c.family==='rooms'?(row===bands-1&&(col%2===0||rooms===0)):random()<.2);
    if(room){
      rooms++;const doorWidth=Math.min(1.4,w-.5),cx=(left+right)/2,wall=.14;
      add(`room_${col}_${row}_left`,'wall',left,(front+back)/2,wall,d,2.6,2);
      add(`room_${col}_${row}_right`,'wall',right,(front+back)/2,wall,d,2.6,2);
      add(`room_${col}_${row}_back`,'wall',cx,back,w,wall,2.6,2);
      const wing=(w-doorWidth)/2;
      add(`room_${col}_${row}_front_left`,'wall',left+wing/2,front,wing,wall,2.6,2);
      add(`room_${col}_${row}_front_right`,'wall',right-wing/2,front,wing,wall,2.6,2);
      add(`room_${col}_${row}_cabinet`,'cabinet',cx,back-.45,w-.5,.45,2.05,1);
      doors.push({column:col,row,x:cx,y:(front+back)/2});
    }else{
      const horizontal=row===0&&col===2?false:(row+col)%3===1||random()<.3;
      const compact=c.family==='islands'||row===0;
      const fraction=compact?.42+random()*.28:.7+random()*.25;
      const extent=horizontal?w-.4:d-.4;
      const long=Math.max(Math.min(.8,extent),extent*fraction);
      const short=Math.min(horizontal?d-.4:w-.4,.7+random()*.45,long*.55);
      const fw=horizontal?long:short,fd=horizontal?short:long;
      const cx=(left+right)/2+(random()-.5)*(w-fw-.3),cy=(front+back)/2+(random()-.5)*(d-fd-.3);
      const kind:Solid['kind']=row===0&&col===0?'cabinet':'shelf';
      add(`${kind}_${col}_${row}`,kind,cx,cy,fw,fd,kind==='cabinet'?2.05:1.3+random()*.75,1);
    }
  }
  if(c.family==='rooms'&&!rooms)throw Error('rooms need larger bays: increase width/length or reduce shelf_rows');
  add('cart','occluder',(x.ranges[0][0]+x.ranges[0][1])/2,.55,.5,.45,1.2,-1);
  for(let i=0;i<solids.length;i++)for(let j=i+1;j<solids.length;j++){
    const a=solids[i],b=solids[j];if(a.kind==='wall'&&b.kind==='wall')continue;
    if(Math.abs(a.x-b.x)<(a.w+b.w)/2-.01&&Math.abs(a.y-b.y)<(a.d+b.d)/2-.01)throw Error(`seed ${c.seed}: overlapping ${a.id}/${b.id}`);
  }
  const nodes:GraphNode[]=[],edges:Layout['graph']['edges']=[];
  const node=(px:number,py:number,kind='junction')=>{
    let found=nodes.find(n=>Math.abs(n.xy[0]-px)<1e-8&&Math.abs(n.xy[1]-py)<1e-8);
    if(!found){found={id:`n${nodes.length}`,kind,xy:[px,py],ports:[]};nodes.push(found);}return found;
  };
  const connect=(a:GraphNode,b:GraphNode)=>{
    if(!segmentFree(a.xy,b.xy,solids))throw Error(`seed ${c.seed}: blocked constructed aisle ${a.id}/${b.id}`);
    const length=Math.hypot(b.xy[0]-a.xy[0],b.xy[1]-a.xy[1]),direction:XY=[(b.xy[0]-a.xy[0])/length,(b.xy[1]-a.xy[1])/length];
    const ap=`${a.id}:p${a.ports.length}`,bp=`${b.id}:p${b.ports.length}`;
    a.ports.push({id:ap,direction,angle:Math.atan2(direction[1],direction[0])});
    b.ports.push({id:bp,direction:[-direction[0],-direction[1]],angle:Math.atan2(-direction[1],-direction[0])});
    edges.push({id:`e${edges.length}`,a:a.id,b:b.id,a_port:ap,b_port:bp,polyline:[a.xy,b.xy]});
  };
  for(const cx of x.centers)for(let j=1;j<y.centers.length;j++)connect(node(cx,y.centers[j-1]),node(cx,y.centers[j]));
  for(let row=0;row<y.centers.length;row++)for(let col=0;col<columns;col++){
    const a=node(x.centers[col],y.centers[row]),b=node(x.centers[col+1],y.centers[row]);
    const door=doors.find(d=>d.row===row&&d.column===col);
    if(door){const junction=node(door.x,y.centers[row]);connect(a,junction);connect(junction,b);connect(junction,node(door.x,door.y,'dead_end'));}
    else connect(a,b);
  }
  connect(node(entryX,.45,'entrance'),node(entryX,y.centers[0]));
  for(const n of nodes){n.ports.sort((a,b)=>a.angle-b.angle);if(n.kind==='junction'&&n.ports.length===2)n.kind='portal';}
  const boundaries:Layout['graph']['boundaries']=[];
  for(const edge of edges)for(const solid of solids.filter(s=>s.semantic===1)){
    const [a,b]=edge.polyline,dx=b[0]-a[0],dy=b[1]-a[1],length2=dx*dx+dy*dy;
    const t=((solid.x-a[0])*dx+(solid.y-a[1])*dy)/length2,cross=dx*(solid.y-a[1])-dy*(solid.x-a[0]);
    if(t>=0&&t<=1&&Math.abs(cross)/Math.sqrt(length2)<c.aisle_width+1)boundaries.push({object_id:solid.id,edge_id:edge.id,side:cross>0?'left':'right'});
  }
  const hash=footprintHash(solids,c.width,c.length);
  return {store_id:`synthetic_${hash}`,layout_hash:hash,config:c,solids,graph:{gt_only:true,nodes,edges,boundaries,
    order:nodes.filter(n=>n.xy[1]===y.centers[0]).sort((a,b)=>a.xy[0]-b.xy[0]).map(n=>n.id)}};
}

/** Every corner receives a frame; sparse samples cannot cut through fixtures. */
export function makeDiverseFrames(layout:Layout,taskIndex=0):CameraFrame[] {
  const c=layout.config,random=rng(c.seed+taskIndex*1009),nodes=layout.graph.nodes;
  const neighbors=new Map(nodes.map(n=>[n.id,[] as GraphNode[]]));
  for(const e of layout.graph.edges){neighbors.get(e.a)!.push(nodes.find(n=>n.id===e.b)!);neighbors.get(e.b)!.push(nodes.find(n=>n.id===e.a)!);}
  const distance=(a:GraphNode,b:GraphNode)=>Math.hypot(a.xy[0]-b.xy[0],a.xy[1]-b.xy[1]);
  const entry=nodes.find(n=>n.kind==='entrance')!;let last=entry;
  const frames:CameraFrame[]=[],chunks=taskIndex===1?[Math.floor(c.frames_per_task/2),c.frames_per_task-Math.floor(c.frames_per_task/2)]:[c.frames_per_task];
  for(const [segment,count] of chunks.entries()){
    const start=taskIndex===0?entry:nodes.reduce((best,n)=>distance(n,last)>distance(best,last)?n:best,nodes[0]);
    let route=[start];const visited=new Set([start.id]);
    while(route.length<Math.max(3,Math.floor(count/2))){
      const current=route.at(-1)!,previous=route.at(-2),options=neighbors.get(current.id)!;
      const fresh=options.filter(n=>!visited.has(n.id)),forward=options.filter(n=>n!==previous);
      const choices=fresh.length?fresh:forward.length?forward:options;
      const next=choices[Math.floor(random()*choices.length)];route.push(next);visited.add(next.id);
    }
    if(c.trajectory==='reverse')route=[...route].reverse();
    const lengths=route.slice(1).map((n,i)=>distance(n,route[i])),intervals=lengths.map(()=>1);
    const total=lengths.reduce((a,b)=>a+b,0),available=count-2;
    for(let left=available-intervals.length;left>0;left--){
      let best=0;
      for(let i=1;i<lengths.length;i++)if(lengths[i]/total*available-intervals[i]>lengths[best]/total*available-intervals[best])best=i;
      intervals[best]++;
    }
    const positions:XY[]=[route[0].xy];
    for(let i=0;i<lengths.length;i++)for(let j=1;j<=intervals[i];j++)positions.push([
      route[i].xy[0]+(route[i+1].xy[0]-route[i].xy[0])*j/intervals[i],route[i].xy[1]+(route[i+1].xy[1]-route[i].xy[1])*j/intervals[i]]);
    positions.splice(Math.floor(count*.35),0,[...positions[Math.floor(count*.35)]]);
    for(let i=0;i<positions.length;i++){
      const p=positions[i],next=positions.slice(i+1).find(q=>Math.hypot(q[0]-p[0],q[1]-p[1])>1e-6),previous=positions[Math.max(0,i-1)];
      const direction=next?[next[0]-p[0],next[1]-p[1]]:[p[0]-previous[0],p[1]-previous[1]];
      const scan=i%12>=8?.7*Math.sin(i*.65):.12*Math.sin(i*.4),index=frames.length;
      if(layout.solids.some(s=>contains(s,p,.18)))throw Error(`${layout.store_id}: camera collision`);
      if(i&&!segmentFree(positions[i-1],p,layout.solids))throw Error(`${layout.store_id}: trajectory collision`);
      frames.push({frame_id:`f${String(index).padStart(3,'0')}`,task_id:`task_${taskIndex}`,segment_id:`segment_${segment}`,
        timestamp_s:10+taskIndex*(c.frames_per_task*c.sample_interval_s+20)+index*c.sample_interval_s+segment*10,
        position:[...p,1.55],yaw:Math.atan2(direction[0],direction[1])+scan,pitch:-.12+.04*Math.sin(index),roll:.025*Math.sin(index*.7)});
    }
    last=route.at(-1)!;
  }
  return frames;
}
