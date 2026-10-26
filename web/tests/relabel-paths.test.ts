import {mkdtemp,mkdir,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {relabelDataset,sameGeometryFloat32} from '../cli/relabel';

describe('stored-pass relabel guards without renderer/model execution',()=>{
  it('uses exact model float32 equality, without a larger geometric tolerance',()=>{
    expect(sameGeometryFloat32([-.8660254037844386],[-.8660254037844385],'normal')).toBe(1);
    expect(()=>sameGeometryFloat32([.3],[.300001],'xy')).toThrow('float32');
    expect(()=>sameGeometryFloat32([1,2],[1],'xy')).toThrow('shape');
  });
  it('refuses output inside its source before creating any dataset files',async()=>{
    const root=await mkdtemp(join(tmpdir(),'tinyLayout-relabel-'));
    try{
      await expect(relabelDataset(root,join(root,'new'),'python3')).rejects.toThrow('separate');
      await expect(stat(join(root,'new'))).rejects.toThrow();
    }finally{await rm(root,{recursive:true});}
  });
  it('refuses an existing independent output directory',async()=>{
    const root=await mkdtemp(join(tmpdir(),'tinyLayout-relabel-'));
    try{
      const source=join(root,'source'),output=join(root,'output');await mkdir(source);await mkdir(output);
      await expect(relabelDataset(source,output,'python3')).rejects.toThrow('exists');
    }finally{await rm(root,{recursive:true});}
  });
});
