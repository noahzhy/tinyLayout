import {useEffect, useMemo, useRef, useState} from 'react';
import {zipSync} from 'fflate';
import {defaults, parseConfig, jsonBytes, contextAnchor, type SceneConfig} from './synthetic/types';
import {makeFrames, makeLayout} from './synthetic/layout';
import {exportStore} from './synthetic/export';
import {BEVViewport, GroundTruth, SceneViewport, useWindowCapture} from './components/Viewports';

function download(name: string, bytes: Uint8Array, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], {type: mime})), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function App() {
  const [draft, setDraft] = useState<SceneConfig>(defaults), [config, setConfig] = useState<SceneConfig>(defaults);
  const [selected, setSelected] = useState(4), [mode, setMode] = useState('语义'), [playing, setPlaying] = useState(false);
  const [message, setMessage] = useState('预览示意 · 尚未导出数据'), [error, setError] = useState(''), [progress, setProgress] = useState<number | null>(null);
  const layout = useMemo(() => makeLayout(config), [config]), frames = useMemo(() => makeFrames(layout), [layout]);
  const {capture, labels, error: captureError} = useWindowCapture(layout, frames, selected);
  const windowStart = Math.max(0, Math.min(Math.floor(selected / 8) * 8, frames.length - 8));
  const anchorFrame=contextAnchor(frames.slice(windowStart,windowStart+4));
  const inputFile = useRef<HTMLInputElement>(null), abortExport = useRef<AbortController | null>(null);
  useEffect(() => {if (!playing) return; const id = setInterval(() => setSelected(s => (s + 1) % frames.length), config.sample_interval_s * 1000); return () => clearInterval(id);}, [playing, frames.length, config.sample_interval_s]);
  const numberField = (key: keyof SceneConfig, label: string, unit = '') => <label className="field" key={key}><span>{label}</span><div className="input-unit"><input aria-label={label} type="number" step={key === 'sample_interval_s' ? '.1' : '1'} value={String(draft[key])} disabled={progress !== null} onChange={event => setDraft(c => ({...c, [key]: Number(event.target.value)}))}/>{unit ? <span>{unit}</span> : null}</div></label>;
  const generate = (variation=false) => {try {const next = parseConfig({...draft, seed:draft.seed+(variation?1:0),stores: 1}); makeFrames(makeLayout(next)); setDraft(next);setConfig(next); setSelected(4); setPlaying(false); setError(''); setMessage('场景已生成 · 当前数据尚未导出');} catch (e) {setError(String(e));}};
  const exportDataset = async () => {
    setPlaying(false); setProgress(0); setError(''); const controller = new AbortController(); abortExport.current = controller;
    try {
      const files: Record<string, Uint8Array> = {};
      const result = await exportStore({...config, stores: 1}, (path, bytes) => {files[path] = bytes;}, {split: 'train', progress: (done, total) => setProgress(Math.round(done * 100 / total)), signal: controller.signal});
      files['windows.jsonl'] = new TextEncoder().encode(result.windows.map(x => JSON.stringify(x)).join('\n') + '\n');
      files['frames.jsonl'] = new TextEncoder().encode(result.frames.map(x => JSON.stringify(x)).join('\n') + '\n');
      files['graph_evidence.jsonl'] = new TextEncoder().encode(result.graph_evidence_index.map(x=>JSON.stringify(x)).join('\n')+'\n');
      files['splits.json'] = jsonBytes([{store_id: result.store_id, layout_hash: result.layout_hash, split: 'train'}]);
      files['provenance.json'] = jsonBytes({synthetic_only: true, generator: 'tinylayout-three-v2', browser: navigator.userAgent, store_id: result.store_id, windows: result.windows.length, frames: result.frames.length});
      files.COMPLETE = new TextEncoder().encode('Complete browser export\n');
      download(`tinyLayout-${result.store_id}.zip`, zipSync(files, {level: 1}), 'application/zip');
      setMessage(`已导出当前门店 · ${result.frames.length} 帧 / ${result.windows.length} 窗口 · 仅合成数据`);
    } catch (e) {setError(String(e));} finally {setProgress(null); abortExport.current = null;}
  };
  const load = async (file?: File) => {if (!file) return; try {const c = parseConfig(JSON.parse(await file.text())); makeFrames(makeLayout(c)); setDraft(c); setConfig({...c, stores: 1}); setSelected(4); setError(''); setMessage('配置已载入 · 仅预览当前门店');} catch (e) {setError(`配置载入失败：${String(e)}`);} if (inputFile.current) inputFile.current.value = '';};
  return <div className="app-shell">
    <header className="app-header"><div className="brand">tinyLayout</div><h1>合成数据工作台</h1><div className="header-actions"><button onClick={()=>generate(true)} disabled={progress !== null}>换一个布局</button><button onClick={()=>generate()} disabled={progress !== null}>生成场景</button><button className="primary" onClick={exportDataset} disabled={progress !== null}>{progress === null ? '导出数据集' : `导出中 ${progress}%`}</button></div></header>
    <main className="workspace" data-layout-id={layout.layout_hash} data-layout-family={layout.config.family}><aside className="parameters"><h2>场景参数</h2>
      {numberField('seed', 'Seed')}{numberField('width', '门店宽度', 'm')}{numberField('length', '门店长度', 'm')}{numberField('shelf_rows', '货架排数')}{numberField('aisle_width', '通道宽度', 'm')}
      <label className="field"><span>布局类型</span><select aria-label="布局类型" value={draft.family} disabled={progress !== null} onChange={e => setDraft(c => ({...c, family: e.target.value as SceneConfig['family']}))}><option value="mixed">混合陈列</option><option value="islands">岛式展架</option><option value="rooms">分区房间</option><option value="grid">规则通道</option><option value="cross">交叉通道</option><option value="T">T 形支路</option><option value="dead_end">通道尽头</option></select></label>
      <hr/><h2>采集参数</h2><label className="field"><span>轨迹</span><select aria-label="轨迹" value={draft.trajectory} disabled={progress !== null} onChange={e => setDraft(c => ({...c, trajectory: e.target.value as SceneConfig['trajectory']}))}><option value="continuous">连续巡店</option><option value="reverse">反向经过</option></select></label>
      {numberField('sample_interval_s', '采样间隔', 's')}
      <div className="config-actions"><button className="primary" onClick={() => download('tinyLayout-config.json', jsonBytes(draft), 'application/json')}>保存配置</button><button onClick={() => inputFile.current?.click()} disabled={progress !== null}>载入配置</button><input ref={inputFile} className="hidden-input" type="file" accept=".json,application/json" onChange={e => load(e.target.files?.[0])}/></div>
      <p className="parameter-note">GT 与相机几何仅供监督和审核。<br/>CLI 支持多店批量生成。</p>
    </aside><section className="views" aria-label="四视图审核">
      <section className="viewport scene-panel"><h2>3D 场景</h2><SceneViewport layout={layout} frame={frames[selected]} frames={frames}/></section>
      <section className="viewport gt-panel"><h2>全局 2D GT</h2><GroundTruth layout={layout} frame={frames[selected]}/></section>
      <section className="viewport rgb-panel"><h2>当前 RGB</h2>{capture ? <img src={capture.rgb} alt={`透视 RGB ${frames[selected].frame_id}，无 GT 叠加`}/> : <div className="loading">正在渲染透视 RGB…</div>}</section>
      <section className="viewport bev-panel"><div className="panel-heading"><h2 title={`anchor ${anchorFrame.frame_id}`}>局部 BEV</h2><div className="segmented">{['语义', 'Support', '目标区域'].map(name => <button key={name} aria-pressed={mode === name} className={mode === name ? 'selected' : ''} onClick={() => setMode(name)}>{name}</button>)}</div></div><BEVViewport labels={labels} size={config.bev_size} mode={mode}/></section>
    </section><section className="timeline"><h2>帧时间轴 · anchor {anchorFrame.frame_id}</h2><div className="timeline-controls"><button className="primary play" aria-label={playing ? '暂停' : '播放'} onClick={() => setPlaying(p => !p)}>{playing ? 'Ⅱ' : '▶'}</button><output>{frames[selected].frame_id} / {frames.length}</output><div className="scrubber"><input aria-label="帧时间轴" type="range" min={0} max={frames.length - 1} value={selected} onChange={e => {setPlaying(false); setSelected(Number(e.target.value));}}/><div className="frame-dots">{frames.map((f, i) => <button key={f.frame_id} title={f.frame_id} aria-label={`选择 ${f.frame_id}`} className={`${i >= windowStart && i < windowStart + 4 ? 'context-dot' : i >= windowStart + 4 && i < windowStart + 8 ? 'hidden-dot' : 'outside-dot'} ${i === selected ? 'current-dot' : ''}`} onClick={() => setSelected(i)}/>)}</div></div><span className="timeline-legend"><i className="dot blue"/>Context <i className="dot amber"/>Teacher-only</span></div></section></main>
    <footer role="status" className={error || captureError ? 'status error' : 'status'}>{error || captureError || message}{progress !== null ? <button onClick={() => abortExport.current?.abort()}>取消导出</button> : null}</footer>
  </div>;
}
