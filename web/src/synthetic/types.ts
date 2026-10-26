export type Family = 'grid' | 'cross' | 'T' | 'dead_end' | 'mixed' | 'islands' | 'rooms';
export interface SceneConfig {
  schema_version: '1.0'; seed: number; stores: number; width: number; length: number;
  shelf_rows: number; aisle_width: number; family: Family; frames_per_task: number;
  sample_interval_s: number; image_width: number; image_height: number;
  chart_span_m: number; bev_size: number; trajectory: 'continuous' | 'reverse';
}
export const defaults: SceneConfig = {schema_version: '1.0', seed: 17, stores: 1,
  width: 24, length: 18, shelf_rows: 4, aisle_width: 2, family: 'mixed', frames_per_task: 32,
  sample_interval_s: .5, image_width: 512, image_height: 384, chart_span_m: 12,
  bev_size: 16, trajectory: 'continuous'};
export type XY = [number, number];
export interface Solid {id: string; kind: 'shelf' | 'wall' | 'cabinet' | 'occluder'; x: number; y: number; w: number; d: number; h: number; semantic: number}
export interface GraphNode {id: string; kind: string; xy: XY; ports: {id: string; direction: XY; angle: number}[]}
export interface GraphEdge {id: string; a: string; b: string; a_port: string; b_port: string; polyline: XY[]}
export interface Layout {store_id: string; layout_hash: string; config: SceneConfig; solids: Solid[];
  graph: {gt_only: true; nodes: GraphNode[]; edges: GraphEdge[]; order: string[]; boundaries: {object_id: string; edge_id: string; side: 'left' | 'right'}[]}}
export interface CameraFrame {frame_id: string; task_id: string; segment_id: string; timestamp_s: number; position: [number, number, number]; yaw: number; pitch: number; roll: number}
export interface Hit {x: number; y: number; z: number; instance: number; normal?: [number, number, number]}
export interface Capture {rgb: string; instance: string; depth: string; hits: Hit[]}
export function contextAnchor(frames: CameraFrame[]): CameraFrame {
  if(!frames.length) throw Error('context anchor requires observed frames');
  const anchor=frames.at(-1)!;
  if(frames.some(f=>f.task_id!==anchor.task_id||f.segment_id!==anchor.segment_id)) throw Error('context anchor cannot cross a task/segment boundary');
  return anchor;
}
export type Sink = (path: string, data: Uint8Array) => void | Promise<void>;
export interface Renderer {capture(frame: CameraFrame): Capture; dispose(): void}
export const encoder = new TextEncoder();
export function jsonBytes(value: unknown): Uint8Array {return encoder.encode(JSON.stringify(value) + '\n');}
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296;};
}
export function stableHash(value: unknown): string {
  const s = JSON.stringify(value); let a = 2166136261, b = 5381;
  for (let i = 0; i < s.length; i++) {a = Math.imul(a ^ s.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ s.charCodeAt(i);}
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
export function parseConfig(raw: unknown): SceneConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('config: expected object');
  for (const key of Object.keys(raw)) if (!(key in defaults)) throw Error(`config: unknown field ${key}`);
  const c = {...defaults, ...raw} as SceneConfig;
  if (c.schema_version !== '1.0') throw Error('config: unsupported schema_version');
  for (const [key, value] of Object.entries(c)) if (typeof defaults[key as keyof SceneConfig] === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)) throw Error(`config: invalid ${key}`);
  for (const key of ['seed', 'stores', 'shelf_rows', 'frames_per_task', 'image_width', 'image_height', 'bev_size'] as const) if (!Number.isInteger(c[key])) throw Error(`config: ${key} must be integer`);
  if (!['grid', 'cross', 'T', 'dead_end', 'mixed', 'islands', 'rooms'].includes(c.family)) throw Error('config: invalid family');
  if (!['continuous', 'reverse'].includes(c.trajectory)) throw Error('config: invalid trajectory');
  if (c.aisle_width < 1 || c.width < c.shelf_rows + (c.shelf_rows + 1) * c.aisle_width + 3 || c.length < 12) throw Error('config: shelves/aisles do not fit store dimensions');
  if (c.frames_per_task < 16 || c.frames_per_task > 512 || c.stores > 100 || c.shelf_rows > 12 || c.bev_size > 128 || c.image_width > 2048 || c.image_height > 2048) throw Error('config: workload outside supported bounds');
  return c;
}
