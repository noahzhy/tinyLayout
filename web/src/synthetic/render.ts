import * as T from 'three';
import type {CameraFrame, Capture, Hit, Layout} from './types';

export const RENDER_CAMERA={vertical_fov_deg:60,near:.05,far:100} as const;

export function setCameraPose(camera:T.PerspectiveCamera,frame:CameraFrame):void {
  camera.position.fromArray(frame.position);
  const cp=Math.cos(frame.pitch);
  camera.up.set(Math.sin(frame.roll),0,Math.cos(frame.roll));
  camera.lookAt(frame.position[0]+Math.sin(frame.yaw)*cp,frame.position[1]+Math.cos(frame.yaw)*cp,frame.position[2]+Math.sin(frame.pitch));
  camera.updateMatrixWorld();
}

/** Shared reconstruction of the saved ID/depth pass; not an online sensor input. */
export function firstSurfaceHits(ids:Uint8Array,depths:Uint8Array,camera:T.PerspectiveCamera,width:number,height:number):Hit[] {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<=0||height<=0||ids.length!==width*height*4||depths.length!==ids.length)
    throw Error('first-surface pass dimensions differ from the actual camera');
  const hits:Hit[]=[],position=new T.Vector3(),neighborX=new T.Vector3(),neighborY=new T.Vector3();
  const surfaceNormal=new T.Vector3(),towardCamera=new T.Vector3();
  for(let y=0;y<height;y+=4)for(let x=0;x<width;x+=4){
    const offset=(y*width+x)*4,instance=ids[offset]+ids[offset+1]*256+ids[offset+2]*65536;
    if(!instance)continue;
    const depth=decodeDepth(depths,offset);
    if(depth>=1||depth<=0)continue;
    position.set(2*(x+.5)/width-1,2*(y+.5)/height-1,depth*2-1).unproject(camera);
    const hit:Hit={x:position.x,y:position.y,z:position.z,instance};
    const nx=offset+4,ny=offset+width*4;
    const sameInstance=(i:number)=>ids[i]+ids[i+1]*256+ids[i+2]*65536===instance;
    if(x+1<width&&y+1<height&&sameInstance(nx)&&sameInstance(ny)){
      neighborX.set(2*(x+1.5)/width-1,2*(y+.5)/height-1,decodeDepth(depths,nx)*2-1).unproject(camera).sub(position);
      neighborY.set(2*(x+.5)/width-1,2*(y+1.5)/height-1,decodeDepth(depths,ny)*2-1).unproject(camera).sub(position);
      surfaceNormal.crossVectors(neighborX,neighborY);
      if(neighborX.length()<.15&&neighborY.length()<.15&&surfaceNormal.lengthSq()>1e-12){
        surfaceNormal.normalize();towardCamera.copy(camera.position).sub(position);
        if(surfaceNormal.dot(towardCamera)<0)surfaceNormal.negate();
        hit.normal=surfaceNormal.toArray() as [number,number,number];
      }
    }
    hits.push(hit);
  }
  return hits;
}

export function decodeDepth(bytes: Uint8Array, offset = 0): number {
  // three.js r180 packing.glsl.js UnpackFactors4, RGBA most-significant first.
  return bytes[offset] / 256 + bytes[offset + 1] / 65536 + bytes[offset + 2] / 16777216 + bytes[offset + 3] / (255 * 16777216);
}
function rawDataURL(bytes: Uint8Array): string {
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return 'data:application/octet-stream;base64,' + btoa(binary);
}

function textureFloor(): T.CanvasTexture {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#deddd8'; ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = '#bdbdb6'; ctx.lineWidth = 2; ctx.strokeRect(0, 0, 128, 128);
  const tex = new T.CanvasTexture(canvas); tex.wrapS = tex.wrapT = T.RepeatWrapping; tex.repeat.set(24, 18); tex.colorSpace = T.SRGBColorSpace; return tex;
}
export class SceneRenderer {
  readonly scene = new T.Scene();
  readonly camera: T.PerspectiveCamera;
  readonly renderer: T.WebGLRenderer;
  readonly target: T.WebGLRenderTarget;
  readonly depthMaterial = new T.MeshDepthMaterial({depthPacking: T.RGBADepthPacking});
  private idMaterials = new Map<number, T.MeshBasicMaterial>();
  private meshes: T.Mesh[] = [];
  constructor(readonly layout: Layout, canvas?: HTMLCanvasElement) {
    const c = layout.config;
    this.renderer = new T.WebGLRenderer({canvas, antialias: false, preserveDrawingBuffer: true});
    this.renderer.setPixelRatio(1); this.renderer.setSize(c.image_width, c.image_height, false);
    this.renderer.outputColorSpace = T.SRGBColorSpace; this.renderer.toneMapping = T.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 1.25;
    this.target = new T.WebGLRenderTarget(c.image_width, c.image_height, {minFilter: T.NearestFilter, magFilter: T.NearestFilter});
    this.camera = new T.PerspectiveCamera(RENDER_CAMERA.vertical_fov_deg, c.image_width / c.image_height, RENDER_CAMERA.near, RENDER_CAMERA.far); this.camera.up.set(0, 0, 1);
    this.scene.background = new T.Color('#e5e8eb');
    const sky = new T.HemisphereLight(0xffffff, 0x77797a, 2.4); sky.position.set(0, 0, 1); this.scene.add(sky);
    const light = new T.DirectionalLight(0xffffff, 2.5); light.position.set(6, 2, 15); this.scene.add(light);
    const addBox = (w: number, d: number, h: number, x: number, y: number, z: number, color: string, instance: number) => {
      const material = new T.MeshStandardMaterial({color, roughness: .75, metalness: .08});
      const mesh = new T.Mesh(new T.BoxGeometry(w, d, h), material); mesh.position.set(x, y, z); mesh.userData.instance = instance;
      this.scene.add(mesh); this.meshes.push(mesh); return mesh;
    };
    const floor = addBox(c.width, c.length, .1, c.width / 2, c.length / 2, -.05, '#e5e3da', 1);
    (floor.material as T.MeshStandardMaterial).map = textureFloor();
    const palette = ['#e8bf74', '#adcfbf', '#c7d7de', '#ca9274', '#dfddcf', '#a5b9be'];
    for (const [index, s] of layout.solids.entries()) {
      const id = index + 2;
      const isFixture = s.kind === 'shelf' || s.kind === 'cabinet';
      const horizontal=isFixture&&s.w>s.d,fw=horizontal?s.d:s.w,fd=horizontal?s.w:s.d;
      const position=(x:number,y:number):[number,number]=>horizontal?[s.x+y,s.y-x]:[s.x+x,s.y+y];
      const fixtureBox=(w:number,d:number,h:number,x:number,y:number,z:number,color:string)=>{
        const [px,py]=position(x,y);return addBox(horizontal?d:w,horizontal?w:d,h,px,py,z,color,id);
      };
      const mesh = isFixture?fixtureBox(.08,fd,s.h,0,0,s.h/2,'#969b98'):
        addBox(s.w,s.d,s.h,s.x,s.y,s.h/2,s.kind==='wall'?'#e7e7e3':'#677a7c',id);
      mesh.userData.solid = s;
      if (s.kind === 'shelf' || s.kind === 'cabinet') {
        fixtureBox(fw,fd,.15,0,0,.075,'#777d79');
        for (const side of [-1, 1]) fixtureBox(fw,.06,s.h,0,side*(fd/2-.03),s.h/2,'#bcc2bc');
        // Repeated, shared products avoid ID-specific appearance shortcuts.
        const levels=Math.min(4,Math.max(2,Math.floor((s.h-.22)/.45)+1));
        for (let level = 0; level < levels; level++) fixtureBox(fw+.03,fd+.03,.045,0,0,.22+level*.45,'#e5e5dd');
        const slots = Math.max(2, Math.floor(fd / .26)), total = slots * (levels-1) * 2;
        const geometry = new T.BoxGeometry(Math.min(.28,fw*.38), .19, .31);
        const products = new T.InstancedMesh(geometry, new T.MeshStandardMaterial({roughness: .9}), total);
        products.userData.instance = id; const matrix = new T.Matrix4(); let k = 0;
        for (let level = 0; level < levels-1; level++) for (let side = 0; side < 2; side++) for (let slot = 0; slot < slots; slot++) {
          const [px,py]=position((side?1:-1)*fw*.29,-fd/2+.16+slot*(fd-.3)/Math.max(1,slots-1));
          matrix.makeRotationZ(horizontal?-Math.PI/2:0);matrix.setPosition(px,py,.4+level*.45);
          products.setMatrixAt(k, matrix); products.setColorAt(k, new T.Color(palette[(slot + level * 2) % palette.length])); k++;
        }
        this.scene.add(products); this.meshes.push(products);
      }
    }
  }
  setCamera(frame: CameraFrame): void {
    setCameraPose(this.camera,frame);
  }
  private read(): Uint8Array {
    const c = this.layout.config, bytes = new Uint8Array(c.image_width * c.image_height * 4);
    this.renderer.readRenderTargetPixels(this.target, 0, 0, c.image_width, c.image_height, bytes); return bytes;
  }
  private png(bytes: Uint8Array): string {
    const c = this.layout.config, canvas = document.createElement('canvas'); canvas.width = c.image_width; canvas.height = c.image_height;
    const flipped = new Uint8ClampedArray(bytes.length), stride = c.image_width * 4;
    for (let y = 0; y < c.image_height; y++) flipped.set(bytes.subarray(y * stride, (y + 1) * stride), (c.image_height - y - 1) * stride);
    canvas.getContext('2d')!.putImageData(new ImageData(flipped, c.image_width, c.image_height), 0, 0); return canvas.toDataURL('image/png');
  }
  capture(frame: CameraFrame): Capture {
    this.setCamera(frame);
    const r = this.renderer, background = this.scene.background;
    const materials = this.meshes.map(m => m.material), colors = this.meshes.map(m => m instanceof T.InstancedMesh ? m.instanceColor : null);
    // RGB uses the display framebuffer (tone mapping + sRGB). Data passes have an
    // immutable linear RGBA8 target: changing colorSpace after allocation would
    // leave an sRGB GPU attachment and corrupt both instance IDs and packed depth.
    r.setSize(this.layout.config.image_width, this.layout.config.image_height, false);
    r.setRenderTarget(null); r.render(this.scene, this.camera); const rgb = r.domElement.toDataURL('image/png');
    r.setRenderTarget(this.target);
    let ids: Uint8Array, depths: Uint8Array;
    try {
      this.scene.background = new T.Color(0); r.toneMapping = T.NoToneMapping; r.outputColorSpace = T.LinearSRGBColorSpace;
      for (const mesh of this.meshes) {
        const id = mesh.userData.instance as number;
        if (!this.idMaterials.has(id)) this.idMaterials.set(id, new T.MeshBasicMaterial({color: new T.Color((id & 255) / 255, ((id >>> 8) & 255) / 255, ((id >>> 16) & 255) / 255), toneMapped: false}));
        mesh.material = this.idMaterials.get(id)!;
        if (mesh instanceof T.InstancedMesh) mesh.instanceColor = null;
      }
      r.render(this.scene, this.camera); ids = this.read();
      this.scene.overrideMaterial = this.depthMaterial; this.scene.background = new T.Color(0xffffff);
      r.render(this.scene, this.camera); depths = this.read();
    } finally {
      this.scene.overrideMaterial = null; this.scene.background = background;
      this.meshes.forEach((m, i) => {m.material = materials[i]; if (m instanceof T.InstancedMesh) m.instanceColor = colors[i];});
      r.toneMapping = T.ACESFilmicToneMapping; r.outputColorSpace = T.SRGBColorSpace; r.setRenderTarget(null);
    }
    const c=this.layout.config,hits=firstSurfaceHits(ids,depths,this.camera,c.image_width,c.image_height);
    // Raw RGBA preserves packed depth exactly (canvas PNG alpha premultiplication would not).
    return {rgb, instance: this.png(ids), depth: rawDataURL(depths), hits};
  }
  renderOverview(canvasWidth: number, canvasHeight: number, suppliedCamera?: T.PerspectiveCamera): void {
    const c = this.layout.config;
    const camera = suppliedCamera ?? new T.PerspectiveCamera(40, canvasWidth / canvasHeight, .1, 150);
    if (!suppliedCamera) {camera.up.set(0, 0, 1); camera.position.set(c.width * .92, -c.length * .6, Math.max(c.width, c.length) * 1.05); camera.lookAt(c.width / 2, c.length / 2, 0);}
    const hidden = this.meshes.filter(m => m.userData.solid?.id?.startsWith('front_'));
    hidden.forEach(m => m.visible = false);
    this.renderer.setSize(canvasWidth, canvasHeight, false); this.renderer.render(this.scene, camera);
    hidden.forEach(m => m.visible = true);
  }
  dispose(): void {
    this.meshes.forEach(m => {m.geometry.dispose(); const mats = Array.isArray(m.material) ? m.material : [m.material]; mats.forEach(mat => {if ('map' in mat && mat.map instanceof T.Texture) mat.map.dispose(); mat.dispose();});});
    this.idMaterials.forEach(m => m.dispose()); this.depthMaterial.dispose(); this.target.dispose(); this.renderer.dispose();
  }
}
