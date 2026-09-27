"""Check model topology and georeferencing against its delivered DSM raster.
This validates file conversion, not source survey accuracy.
"""
from pathlib import Path
import hashlib,json,struct
import numpy as np
from osgeo import gdal

root=Path(__file__).resolve().parents[1]/'docs/assets/models'
manifest=json.loads((root/'manifest.json').read_text(encoding='utf-8'))
results=[]
for item in manifest['models']:
    raw=(root/item['glb']).read_bytes()
    magic,version,total=struct.unpack_from('<III',raw)
    assert (magic,version,total)==(0x46546C67,2,len(raw))
    length,kind=struct.unpack_from('<II',raw,12)
    assert kind==0x4E4F534A
    doc=json.loads(raw[20:20+length])
    binlen,binkind=struct.unpack_from('<II',raw,20+length)
    assert binkind==0x004E4942
    binary=raw[28+length:]
    assert len(binary)==binlen
    def array(i):
        a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']]
        dims={'VEC3':3,'VEC2':2,'SCALAR':1}[a['type']]
        dtype={5126:'<f4',5125:'<u4'}[a['componentType']]
        return np.frombuffer(binary,dtype=dtype,count=a['count']*dims,offset=v.get('byteOffset',0)+a.get('byteOffset',0)).reshape(-1,dims)
    prim=doc['meshes'][0]['primitives'][0]
    p=array(prim['attributes']['POSITION']);n=array(prim['attributes']['NORMAL']);uv=array(prim['attributes']['TEXCOORD_0']);tri=array(prim['indices']).reshape(-1,3)
    assert np.isfinite(p).all() and np.isfinite(n).all() and np.isfinite(uv).all()
    assert tri.max()<len(p) and tri.min()>=0
    assert len(tri)==item['triangles'] and len(p)==item['vertices']
    assert ((uv>=0)&(uv<=1)).all()
    assert np.max(np.abs(np.linalg.norm(n,axis=1)-1))<1e-5
    face=np.cross(p[tri[:,1]]-p[tri[:,0]],p[tri[:,2]]-p[tri[:,0]])
    assert (face[:,1]>0).all(),'Incorrect triangle winding'
    dsm=gdal.Open(str(root/item['raster']));h=dsm.ReadAsArray();t=dsm.GetGeoTransform()
    east=p[:,0]+manifest['origin'][0];north=manifest['origin'][1]-p[:,2]
    # Compute using float64 to preserve full projected-coordinate precision.
    east=p[:,0].astype('float64')+manifest['origin'][0]
    north=manifest['origin'][1]-p[:,2].astype('float64')
    col=np.rint((east-t[0])/t[1]-.5).astype(int)
    row=np.rint((north-t[3])/t[5]-.5).astype(int)
    assert ((row>=0)&(row<h.shape[0])&(col>=0)&(col<h.shape[1])).all()
    reference=h[row,col]
    assert np.isfinite(reference).all(),'Mesh includes a NoData vertex'
    error=np.abs(p[:,1].astype('float64')+manifest['origin'][2]-reference)
    assert error.max()<.0002,'Mesh elevations differ from raster'
    for axis in [row,col]:assert (np.ptp(axis[tri],axis=1)<=1).all(),'Triangles bridge missing terrain'
    assert np.allclose(uv[:,0],(col+.5)/h.shape[1],atol=1e-6)
    assert np.allclose(uv[:,1],(row+.5)/h.shape[0],atol=1e-6)
    assert hashlib.sha256(raw).hexdigest()==item['sha256']
    results.append({'id':item['id'],'vertices':len(p),'triangles':len(tri),
                    'maxMeshVsRasterErrorMetres':float(error.max()),'topology':'PASS','uvGeoreferencing':'PASS','sha256':'PASS'})
report={'scope':'GLB 與展示 DSM 的座標、高程、拓撲、貼圖 UV 與檔案完整性檢查。非航測精度檢核。','models':results}
(root/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps(report,ensure_ascii=False,indent=2))
