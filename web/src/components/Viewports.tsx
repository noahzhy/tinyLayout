import {useEffect, useRef, useState} from 'react';
import * as T from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {SceneRenderer} from '../synthetic/render';
import {makeLabels} from '../synthetic/labels';
import {contextAnchor,type CameraFrame,type Capture,type Layout} from '../synthetic/types';

export type Labels = ReturnType<typeof makeLabels>;
export function SceneViewport({layout, frame, frames}: {layout: Layout; frame: CameraFrame; frames: CameraFrame[]}) {
  const host = useRef<HTMLDivElement>(null);
  const redraw = useRef<(f: CameraFrame) => void>(() => {});
  useEffect(() => {
    const container = host.current!, runtime = new SceneRenderer(layout), c = layout.config;
    container.append(runtime.renderer.domElement);
    const camera = new T.PerspectiveCamera(40, 1, .1, 150); camera.up.set(0, 0, 1);
    camera.position.set(c.width * .92, -c.length * .6, Math.max(c.width, c.length) * 1.05);
    const controls = new OrbitControls(camera, runtime.renderer.domElement); controls.target.set(c.width / 2, c.length / 2, 0); controls.maxPolarAngle = Math.PI * .48; controls.update();
    const path = new T.Line(new T.BufferGeometry().setFromPoints(frames.map(f => new T.Vector3(f.position[0], f.position[1], .07))), new T.LineBasicMaterial({color: '#356ae6'}));
    runtime.scene.add(path);
    const marker = new T.Mesh(new T.ConeGeometry(.24, .6, 3), new T.MeshBasicMaterial({color: '#356ae6'})); runtime.scene.add(marker);
    const draw = () => {const box = container.getBoundingClientRect(); if (box.width < 1 || box.height < 1) return; camera.aspect = box.width / box.height; camera.updateProjectionMatrix(); runtime.renderOverview(Math.round(box.width), Math.round(box.height), camera);};
    redraw.current = f => {marker.position.set(f.position[0], f.position[1], .3); marker.rotation.set(Math.PI / 2, 0, -f.yaw); draw();};
    controls.addEventListener('change', draw); const resize = new ResizeObserver(draw); resize.observe(container); draw();
    return () => {resize.disconnect(); controls.dispose(); path.geometry.dispose(); (path.material as T.Material).dispose(); marker.geometry.dispose(); (marker.material as T.Material).dispose(); runtime.dispose(); runtime.renderer.domElement.remove(); redraw.current = () => {};};
  }, [layout, frames]);
  useEffect(() => redraw.current(frame), [frame, layout]);
  return <div ref={host} className="scene-canvas" aria-label="可旋转的 3D 门店场景"/>;
}

export function GroundTruth({layout, frame}: {layout: Layout; frame: CameraFrame}) {
  const {width, length} = layout.config;
  return <svg className="gt-svg" viewBox={`-1 -1 ${width + 2} ${length + 2}`} role="img" aria-label="全局二维结构 GT，仅作监督与审核">
    <rect x={0} y={0} width={width} height={length} fill="#f3f4f3" stroke="#cbd0d5" strokeWidth={.08}/>
    {layout.solids.map(s => <rect key={s.id} x={s.x - s.w / 2} y={length - s.y - s.d / 2} width={s.w} height={s.d} fill={s.kind === 'wall' ? '#535957' : s.kind === 'occluder' ? '#c59d69' : '#b2b6b1'} stroke="#626b6a" strokeWidth={.05}/>)}
    {layout.graph.edges.map(e => <polyline key={e.id} points={e.polyline.map(p => `${p[0]},${length - p[1]}`).join(' ')} fill="none" stroke="#7699e7" strokeWidth={.065}/>)}
    {layout.graph.nodes.map(n => <circle key={n.id} cx={n.xy[0]} cy={length - n.xy[1]} r={.13} fill="white" stroke="#356ae6" strokeWidth={.06}/>)}
    <g transform={`translate(${frame.position[0]},${length - frame.position[1]}) rotate(${frame.yaw * 180 / Math.PI})`}><path d="M 0,-.4 L -.24,.25 L .24,.25 Z" fill="#356ae6" stroke="white" strokeWidth={.06}/></g>
  </svg>;
}

export function BEVViewport({labels, size, mode}: {labels: Labels | null; size: number; mode: string}) {
  const palette = ['#eef2ed', '#89949d', '#46525e', '#bea987'];
  return <div className="bev-content" data-labels-ready={!!labels}><div className="bev-map"><span className="axis-y">+y 前方</span>
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`局部 BEV ${mode}，斜线表示未观测`}>
      <defs><pattern id="unknown-hatch" width=".6" height=".6" patternUnits="userSpaceOnUse"><rect width=".6" height=".6" fill="#f4f6f8"/><path d="M-.2,.2 L.2,-.2 M0,.6 L.6,0 M.4,.8 L.8,.4" stroke="#bdc6ce" strokeWidth=".035"/></pattern></defs>
      {Array.from({length: size * size}, (_, i) => {
        const known = labels?.context_support[i], teacher = labels?.teacher_support[i], target = labels?.target_region[i];
        const cls = labels?.semantic_labels[i] ?? -1;
        const fill = mode === 'Support' ? known ? '#356ae6' : teacher ? '#b4ccff' : 'url(#unknown-hatch)' : mode === '目标区域' ? target ? '#efb04b' : 'url(#unknown-hatch)' : known && cls >= 0 ? palette[cls] : 'url(#unknown-hatch)';
        return <rect key={i} x={i % size} y={Math.floor(i / size)} width={1} height={1} fill={fill} stroke="#d0d7dd" strokeWidth={.035}><title>{`cell ${i}: context=${!!known}, teacher=${!!teacher}, semantic=${cls}`}</title></rect>;
      })}
      <path d={`M${size / 2},${size / 2 - .35} l-.32,.65 h.64 Z`} fill="#356ae6" stroke="#172b4d" strokeWidth={.06}/>
    </svg></div><div className="bev-legend"><span>+x 右方</span><p><i className="swatch blue"/>Context 支持</p><p><i className="swatch pale"/>Teacher 新增</p><p><i className="swatch hatch"/>未观测 / 忽略</p><p><i className="swatch gray"/>货架 / 障碍</p></div></div>;
}

export function useWindowCapture(layout: Layout, frames: CameraFrame[], selected: number) {
  const [capture, setCapture] = useState<Capture | null>(null), [labels, setLabels] = useState<Labels | null>(null), [error, setError] = useState('');
  const runtime = useRef<SceneRenderer | null>(null), cache = useRef(new Map<string, Capture>());
  useEffect(() => {runtime.current = new SceneRenderer(layout); cache.current.clear(); setCapture(null); setLabels(null); return () => {runtime.current?.dispose(); runtime.current = null;};}, [layout]);
  useEffect(() => {
    let cancelled = false; const engine = runtime.current!;
    const work = async () => {
      try {
        setError(''); const current = frames[selected];
        const get = (f: CameraFrame) => {if (!cache.current.has(f.frame_id)) cache.current.set(f.frame_id, engine.capture(f)); return cache.current.get(f.frame_id)!;};
        const first = get(current); if (!cancelled) setCapture(first);
        const segment = frames.filter(f => f.segment_id === current.segment_id), index = segment.findIndex(f => f.frame_id === current.frame_id);
        const start = Math.max(0, Math.min(Math.floor(index / 8) * 8, segment.length - 8)), windowFrames = segment.slice(start, start + 8);
        for (const f of windowFrames) {if (cancelled) return; get(f); await new Promise(resolve => setTimeout(resolve, 0));}
        if (!cancelled) setLabels(makeLabels(layout, contextAnchor(windowFrames.slice(0,4)), windowFrames.slice(0, 4).flatMap(f => get(f).hits), windowFrames.flatMap(f => get(f).hits), 'preview'));
      } catch (e) {if (!cancelled) setError(String(e));}
    };
    const timer = setTimeout(work, 20); return () => {cancelled = true; clearTimeout(timer);};
  }, [layout, frames, selected]);
  return {capture, labels, error};
}
