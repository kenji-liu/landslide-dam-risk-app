"""Build georeferenced, textured GLB terrain meshes from measured DSM rasters.

Run with the QGIS Python runtime (GDAL, numpy, Pillow). Source files are read only.
The GLB uses metres: X east, Y up, Z south, relative to manifest.origin.
"""
from pathlib import Path
import argparse
import datetime
import hashlib
import io
import json
import math
import struct
import numpy as np
from PIL import Image
from osgeo import gdal, osr

gdal.UseExceptions()


def write_glb(path, positions, normals, uv, triangles, jpeg, extras):
    chunks, views, accessors = [], [], []
    offset = 0
    def buffer_view(data, target=None):
        nonlocal offset
        data = bytes(data)
        view = {"buffer": 0, "byteOffset": offset, "byteLength": len(data)}
        if target:
            view["target"] = target
        views.append(view)
        padded = data + b"\0" * ((-len(data)) % 4)
        chunks.append(padded)
        offset += len(padded)
        return len(views) - 1
    def accessor(a, kind, component, target, bounds=False):
        view = buffer_view(a.tobytes(), target)
        acc = {"bufferView": view, "componentType": component,
               "count": len(a), "type": kind}
        if bounds:
            acc["min"] = a.min(axis=0).tolist()
            acc["max"] = a.max(axis=0).tolist()
        accessors.append(acc)
        return len(accessors) - 1
    pos = accessor(positions.astype('<f4'), 'VEC3', 5126, 34962, True)
    norm = accessor(normals.astype('<f4'), 'VEC3', 5126, 34962)
    tex = accessor(uv.astype('<f4'), 'VEC2', 5126, 34962)
    idx = accessor(triangles.ravel().astype('<u4'), 'SCALAR', 5125, 34963)
    img = buffer_view(jpeg)
    doc = {
        "asset": {"version": "2.0", "generator": "Matayan DSM terrain builder 1.0", "extras": extras},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"name": extras['name'], "mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": pos, "NORMAL": norm, "TEXCOORD_0": tex}, "indices": idx, "material": 0}]}],
        "materials": [{"name": "orthomosaic", "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}, "metallicFactor": 0, "roughnessFactor": 1}, "doubleSided": True}],
        "textures": [{"sampler": 0, "source": 0}],
        "samplers": [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}],
        "images": [{"bufferView": img, "mimeType": "image/jpeg"}],
        "buffers": [{"byteLength": offset}], "bufferViews": views, "accessors": accessors,
    }
    raw = json.dumps(doc, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    raw += b' ' * ((-len(raw)) % 4)
    binary = b''.join(chunks)
    path.write_bytes(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(raw) + 8 + len(binary))
                     + struct.pack('<II', len(raw), 0x4E4F534A) + raw
                     + struct.pack('<II', len(binary), 0x004E4942) + binary)


def create_model(source, ortho, output, origin, model_id, date, resolution=5, satellite=False, bounds=None):
    print('Processing', model_id, flush=True)
    src = gdal.Open(str(source))
    gt = src.GetGeoTransform()
    projection = src.GetProjection()
    metadata = src.GetMetadata()
    source_info = {"file": source.name, "size": [src.RasterXSize, src.RasterYSize],
                   "pixelSize": [abs(gt[1]), abs(gt[5])], "projectionWkt": projection,
                   "software": metadata.get('TIFFTAG_SOFTWARE'),
                   "fileCreationDate": metadata.get('TIFFTAG_DATETIME')}
    options = dict(format='MEM', dstSRS='EPSG:3826', xRes=resolution, yRes=resolution,
                   resampleAlg='bilinear' if satellite else 'average', targetAlignedPixels=True,
                   dstNodata=float('nan'), outputType=gdal.GDT_Float32,
                   multithread=True, warpOptions=['NUM_THREADS=2', 'ERROR_OUT_IF_EMPTY_SOURCE_WINDOW=FALSE'])
    if bounds:
        options['outputBounds'] = bounds
    if not satellite:
        # Work only on horizontal coordinates; do not let PROJ alter source heights.
        options['srcSRS'] = 'EPSG:3826'
    grid = gdal.Warp('', src, **options)
    if not satellite:
        grid.SetProjection(projection)
    height = grid.ReadAsArray().astype(np.float32)
    tr = grid.GetGeoTransform()
    rows, cols = height.shape
    valid = np.isfinite(height) & (height > 0) & (height < 4500)
    height[~valid] = np.nan
    # NoData remains NoData. No filling or fabricated dam/lake geometry is performed.
    grid.GetRasterBand(1).WriteArray(height)
    grid.SetMetadataItem('DERIVATION', 'DSM resampled for 3D display; no new photogrammetric or InSAR inversion')
    grid.SetMetadataItem('SOURCE_FILE', source.name)
    grid.SetMetadataItem('VERTICAL_DATUM', 'EGM2008 geoid' if satellite else 'TWVD2001 (source GeoTIFF metadata)')
    grid.SetMetadataItem('ACQUISITION_DATE', date)
    tif = output / (model_id + '_dsm.tif')
    gdal.Translate(str(tif), grid, format='COG', creationOptions=['COMPRESS=DEFLATE', 'PREDICTOR=FLOATING_POINT'])
    left, top = tr[0], tr[3]
    right, bottom = left + cols * tr[1], top + rows * tr[5]
    texture_resolution = max((right-left), (top-bottom)) / 2560
    if ortho:
        ortho_src = gdal.Open(str(ortho))
        ortho_info = {'file': ortho.name, 'pixelSize': [abs(ortho_src.GetGeoTransform()[1]), abs(ortho_src.GetGeoTransform()[5])]}
        tex_grid = gdal.Warp('', ortho_src, format='MEM', dstSRS='EPSG:3826',
                             outputBounds=[left, bottom, right, top],
                             width=2560, height=round(2560*(top-bottom)/(right-left)),
                             resampleAlg='bilinear', multithread=True)
        rgb = np.stack([tex_grid.GetRasterBand(i).ReadAsArray() for i in [1,2,3]], axis=-1)
        image = Image.fromarray(np.clip(rgb, 0, 255).astype('uint8'))
        ortho_src, tex_grid = None, None
    else:
        ortho_info = None
        t = np.clip((np.nan_to_num(height, nan=700)-650)/1000, 0, 1)
        rgb = np.stack([70+155*t, 112+95*t, 90+98*t], axis=-1).astype('uint8')
        image = Image.fromarray(rgb).resize((max(cols,512), max(rows,512)))
    buf = io.BytesIO()
    image.save(buf, format='JPEG', quality=88, optimize=True)
    jpeg = buf.getvalue()
    (output / (model_id + '_texture.jpg')).write_bytes(jpeg)

    iy, ix = np.indices((rows, cols))
    x = left + (ix + .5)*resolution - origin[0]
    z = origin[1] - (top - (iy + .5)*resolution)
    y = height - origin[2]
    points = np.stack([x,y,z],axis=-1).reshape(-1,3)
    ids = np.arange(rows*cols).reshape(rows,cols)
    a,b,c,d = ids[:-1,:-1],ids[:-1,1:],ids[1:,:-1],ids[1:,1:]
    tris = np.concatenate([np.stack([a,c,b],axis=-1).reshape(-1,3), np.stack([b,c,d],axis=-1).reshape(-1,3)])
    tris = tris[valid.ravel()[tris].all(axis=1)]
    used = np.unique(tris)
    remap = np.full(rows*cols,-1,dtype=np.int32)
    remap[used] = np.arange(len(used))
    positions = points[used].astype('float32')
    triangles = remap[tris].astype('uint32')
    uv = np.stack([(ix+.5)/cols,(iy+.5)/rows],axis=-1).reshape(-1,2)[used].astype('float32')
    normals = np.zeros_like(positions)
    edge1 = positions[triangles[:,1]]-positions[triangles[:,0]]
    edge2 = positions[triangles[:,2]]-positions[triangles[:,0]]
    face_norm = np.cross(edge1,edge2)
    for k in range(3):
        np.add.at(normals,triangles[:,k],face_norm)
    normals /= np.maximum(np.linalg.norm(normals,axis=1,keepdims=True),1e-12)
    name = 'Copernicus GLO-30 衛星 DSM 參考地形' if satellite else f'馬太鞍溪 UAV DSM・{date}'
    extras = {'name':name, 'crs':'EPSG:3826', 'verticalDatum':'EGM2008' if satellite else 'TWVD2001',
              'origin':origin, 'axes':'X east, Y up, Z south', 'units':'metres', 'acquisitionDate':date,
              'meshSpacingMetres':resolution, 'source':source.name,
              'note':'Source DSM resampled for visualization; not a newly measured DSM. NoData triangles excluded.'}
    glb = output / (model_id+'.glb')
    write_glb(glb,positions,normals,uv,triangles,jpeg,extras)
    preview = image.copy()
    preview.thumbnail((960,960))
    preview.save(output/(model_id+'_preview.jpg'),quality=85)
    datum = 'EGM2008 正高（尚未轉換為 TWVD2001）' if satellite else 'TWVD2001 正高（GeoTIFF 標示）'
    limits = ('2011–2015 年代的既有全球 DSM，無法代表 2025 年堰塞壩現況；與 UAV 的垂直基準不同，僅供背景判讀。'
              if satellite else '5 m 為展示網格間距，非高程精度。未重新進行控制點檢核；水面、植被與邊界可能有重建誤差。兩期覆蓋不同，未作差分或體積計算。')
    horizontal = osr.SpatialReference(); horizontal.ImportFromEPSG(3826)
    wgs = osr.SpatialReference(); wgs.ImportFromEPSG(4326); wgs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(horizontal,wgs)
    nw=transform.TransformPoint(left,top); se=transform.TransformPoint(right,bottom)
    report = {
        'id':model_id,'name':name,'date':date,'dateBasis':'產品涵蓋年代' if satellite else '來源檔名標示的航測日期',
        'kind':'satellite' if satellite else 'uav','glb':glb.name,'raster':tif.name,
        'texture':model_id+'_texture.jpg','preview':model_id+'_preview.jpg',
        'crs':'EPSG:3826 / TWD97 TM2 zone 121','datum':datum,'sourceInfo':source_info,'orthoInfo':ortho_info,
        'sourceResolution':30 if satellite else abs(gt[1]),'meshResolution':resolution,
        'textureResolutionApprox':round(texture_resolution,2) if ortho else None,
        'bounds':[left,bottom,right,top],'boundsWgs84':[nw[0],se[1],se[0],nw[1]],
        'heightRange':[float(np.nanmin(height)),float(np.nanmax(height))],
        'validAreaHa':round(float(valid.sum()*resolution**2/10000),2),
        'validPercent':round(float(valid.mean()*100),2),'gridSize':[cols,rows],
        'vertices':len(positions),'triangles':len(triangles),'bytes':glb.stat().st_size,
        'sha256':hashlib.sha256(glb.read_bytes()).hexdigest(),'limits':limits,
        'validation':'模型結構與座標檢查完成；尚無獨立高程精度檢核',
    }
    (output/(model_id+'_metadata.json')).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['id','gridSize','heightRange','vertices','triangles','bytes']},ensure_ascii=False),flush=True)
    return report


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--source-dir',type=Path,required=True)
    parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'docs/assets/models')
    parser.add_argument('--satellite',type=Path)
    args=parser.parse_args()
    args.output.mkdir(parents=True,exist_ok=True)
    origin=[281000.0,2621500.0,600.0]
    models=[]
    for compact,date in [('20250930','2025-09-30'),('20250920','2025-09-20')]:
        source=args.source_dir/f'{compact}馬太鞍溪堰塞湖_TWD972020-dsm.tiff'
        ortho=args.source_dir/f'{compact}馬太鞍溪堰塞湖_TWD972020-orthomosaic.tiff'
        models.append(create_model(source,ortho,args.output,origin,'matayan_'+compact,date))
    if args.satellite:
        bounds=[min(m['bounds'][0] for m in models)-300,min(m['bounds'][1] for m in models)-300,
                max(m['bounds'][2] for m in models)+300,max(m['bounds'][3] for m in models)+300]
        models.append(create_model(args.satellite,None,args.output,origin,'matayan_cop30','2011–2015',30,True,bounds))
    manifest={'version':1,'builtAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'defaultModel':'matayan_20250930','origin':origin,'models':models,
              'method':'既有 DSM 網格化 + 同日正射影像貼圖。保留無資料區，不由 RGB 或 NISAR 重新反演高程。',
              'sources':[{'name':'使用者提供的 UAV DSM／正射影像（Pix4Dmatic）'},
                         {'name':'Copernicus DEM GLO-30','url':'https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM',
                          'attribution':'Produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved.'}]}
    (args.output/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')


if __name__=='__main__':main()
