import * as THREE from 'three';
import { OrbitControls } from './assets/vendor/three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from './assets/vendor/three/examples/jsm/loaders/GLTFLoader.js';

const $ = (id) => document.getElementById(id);
const assetBase = new URL('./assets/models/', import.meta.url);
const embedded = new URLSearchParams(location.search).has('embed');
document.body.classList.toggle('embedded', embedded);
let manifest, current, terrain, renderer, scene, camera, controls, grid;
let requestId = 0, controller, mode = 'texture', vertical = 1, pageActive = true;
let marker, box, span = 3000, firstLoad = true, pendingModelId, contextLost = false, renderRequested = true;
const modelBuffers = new Map();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const loader = new GLTFLoader();
const format = new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 });
const colorStops = ['#285e72','#5ca493','#bbcd99','#d6bd90','#a98169','#eee9e0'].map(c=>new THREE.Color(c));

function showLoading(text, error = false) {
  $('loading').hidden = false;
  $('loading').classList.toggle('compact', Boolean(terrain));
  $('loadingText').textContent = text;
  $('retry').hidden = !error;
  $('dismissError').hidden = !error || !terrain || contextLost;
  $('loading').querySelector('.spinner').hidden = error;
  $('progress').hidden = error;
}

function setupRenderer() {
  const host = $('canvasHost');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xe6eff3, 0);
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute('aria-label', '三維 DSM：拖曳旋轉、滾輪縮放、點選高程');
  host.appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 1, 60000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .12;
  controls.maxPolarAngle = Math.PI * .49;
  controls.minPolarAngle = .001;
  controls.screenSpacePanning = true;
  controls.listenToKeyEvents(renderer.domElement);
  controls.addEventListener('change',()=>{renderRequested=true;});
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7c898d, 2.1));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(-2000,4500,-2200); scene.add(sun);
  grid = new THREE.GridHelper(6000, 30, 0x9db8c5, 0xc6d8e1);
  grid.material.transparent = true; grid.material.opacity = .5; scene.add(grid);
  marker = new THREE.Mesh(new THREE.SphereGeometry(10,16,12), new THREE.MeshBasicMaterial({color:0xffe181,depthTest:false}));
  marker.visible=false; marker.renderOrder=3; scene.add(marker);
  new ResizeObserver(()=>{
    const width=host.clientWidth, height=host.clientHeight;
    if (!width || !height) return;
    camera.aspect=width/height; camera.updateProjectionMatrix(); renderer.setSize(width,height);renderRequested=true;
  }).observe(host);
  renderer.domElement.addEventListener('webglcontextlost', (event)=>{
    event.preventDefault();contextLost=true;showLoading('三維繪圖暫時中斷，請重新載入檢視器。',true);
  });
  renderer.domElement.addEventListener('webglcontextrestored',()=>{contextLost=false;renderRequested=true;$('loading').hidden=true;});
  let down=null;
  renderer.domElement.addEventListener('pointerdown',e=>{down=[e.clientX,e.clientY];});
  renderer.domElement.addEventListener('pointerup',e=>{
    if (e.button!==0 || !down || Math.hypot(e.clientX-down[0],e.clientY-down[1])>5) return;
    sampleHeight(e); down=null;
  });
  renderer.setAnimationLoop(()=>{
    if (!pageActive || document.hidden || contextLost) return;
    controls.update();
    if(!renderRequested)return;
    renderRequested=false;
    const center=controls.target.clone().project(camera);
    const north=controls.target.clone().add(new THREE.Vector3(0,0,-100)).project(camera);
    $('northArrow').style.transform=`rotate(${Math.atan2(north.x-center.x,north.y-center.y)*180/Math.PI}deg)`;
    renderer.render(scene,camera);
  });
}

function disposeTerrain(object) {
  object?.traverse(child=>{
    if(!child.isMesh)return;
    child.geometry.dispose();
    child.userData.photoMaterial?.map?.dispose();
    child.userData.photoMaterial?.dispose();
    child.userData.heightMaterial?.dispose();
  });
}

async function fetchGlb(url, signal, fallbackBytes) {
  const res=await fetch(url,{signal});
  if(!res.ok)throw new Error(`模型下載失敗 (${res.status})`);
  const total=Number(res.headers.get('content-length'))||fallbackBytes;
  if(!res.body)return res.arrayBuffer();
  const reader=res.body.getReader(), chunks=[]; let length=0;
  for(;;){
    const {done,value}=await reader.read(); if(done)break;
    chunks.push(value);length+=value.length;
    const percent=Math.min(98,Math.round(length/total*100));
    $('progress').value=percent; $('loadingText').textContent=`載入三維模型 ${percent}%`;
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  return bytes.buffer;
}

function prepareMaterials(object, item) {
  object.traverse(child=>{
    if(!child.isMesh)return;
    const old=child.material, map=old.map;
    if(map){map.anisotropy=renderer.capabilities.getMaxAnisotropy();}
    const pos=child.geometry.getAttribute('position');
    const colors=new Float32Array(pos.count*3), color=new THREE.Color();
    // A fixed UAV colour range makes the two dates visually comparable.
    const low=item.kind==='satellite'?600:650, high=item.kind==='satellite'?2200:1500;
    for(let i=0;i<pos.count;i++){
      const t=THREE.MathUtils.clamp((pos.getY(i)+manifest.origin[2]-low)/(high-low),0,1)*(colorStops.length-1);
      const k=Math.min(colorStops.length-2,Math.floor(t));
      color.copy(colorStops[k]).lerp(colorStops[k+1],t-k);color.toArray(colors,i*3);
    }
    child.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
    child.userData.photoMaterial=new THREE.MeshBasicMaterial({map,side:THREE.DoubleSide});
    child.userData.heightMaterial=new THREE.MeshStandardMaterial({vertexColors:true,roughness:1,metalness:0,side:THREE.DoubleSide});
    old.dispose();
  });
}

async function loadModel(id) {
  const item=manifest.models.find(m=>m.id===id);if(!item)return;
  pendingModelId=id;
  const ticket=++requestId; controller?.abort();controller=new AbortController();
  const requestController=controller;
  let timedOut=false;
  const timeout=setTimeout(()=>{timedOut=true;requestController.abort();},60000);
  $('saveImage').disabled=!terrain; $('progress').value=0;
  showLoading(`載入 ${item.date} 地形…`);
  let loaded;
  try{
    const buffer=modelBuffers.get(id) || await fetchGlb(new URL(item.glb,assetBase),requestController.signal,item.bytes);
    clearTimeout(timeout);
    if(ticket!==requestId)return;
    loaded=await loader.parseAsync(buffer,assetBase.href);
    if(ticket!==requestId){loaded.scene.traverse(c=>{if(c.isMesh){c.geometry.dispose();c.material.map?.dispose();c.material.dispose();}});return;}
    prepareMaterials(loaded.scene,item);
    modelBuffers.set(id,buffer);
    if(terrain){scene.remove(terrain);disposeTerrain(terrain);}
    const reframe=firstLoad || current?.kind!==item.kind;
    terrain=loaded.scene; current=item; terrain.scale.y=vertical;scene.add(terrain);marker.visible=false;
    box=new THREE.Box3().setFromObject(terrain);const size=box.getSize(new THREE.Vector3());
    span=Math.max(size.x,size.z,size.y); controls.minDistance=60;controls.maxDistance=span*5;
    if(item.kind==='satellite')mode='height';
    else if($('textureMode').disabled)mode='texture';
    $('textureMode').disabled=item.kind==='satellite';
    applyMode(); if(reframe)frame('oblique'); firstLoad=false;
    updateInfo(); $('loading').hidden=true; $('saveImage').disabled=false;renderRequested=true;
    $('viewport').dataset.loadedModel=item.id;
    $('readout').textContent='點選模型查看地表高程';
    const hash=`#${item.id}`; if(location.hash!==hash)history.replaceState(null,'',hash);
    if(parent!==window)parent.postMessage({type:'terrain-model-selected',id:item.id},location.origin);
  }catch(error){
    if(ticket!==requestId || (error.name==='AbortError' && !timedOut))return;
    const reason=timedOut?'連線逾時':error instanceof TypeError?'連線中斷或檔案無法讀取':error.message;
    showLoading(`${item.date} 載入失敗：${reason}。${current?`目前保留 ${current.date}，仍可旋轉與查詢高程。`:'請確認網路後重試。'}`,true);
    if(current)$('dataset').value=current.id;
    $('saveImage').disabled=!terrain;
  }finally{
    clearTimeout(timeout);
  }
}

function frame(view) {
  if(!box)return;
  const center=box.getCenter(new THREE.Vector3());controls.target.copy(center);
  const distance=span*(camera.aspect<1.3?1.55:1.0);
  camera.position.copy(center).add(view==='top'?new THREE.Vector3(0,distance*1.5,1):new THREE.Vector3(-distance*.62,distance*.72,distance*.87));
  controls.update();
}

function applyMode(){
  if(!terrain)return;
  renderRequested=true;
  terrain.traverse(child=>{if(child.isMesh){child.material=mode==='texture'?child.userData.photoMaterial:child.userData.heightMaterial;child.material.wireframe=$('wireframe').checked;}});
  for(const id of ['texture','height']){$(id+'Mode').classList.toggle('selected',mode===id);$(id+'Mode').setAttribute('aria-pressed',String(mode===id));}
  $('heightLegend').hidden=mode!=='height';
  $('legendLow').textContent=current.kind==='satellite'?'600':'650';$('legendHigh').textContent=current.kind==='satellite'?'2,200':'1,500';
}

function updateInfo(){
  $('dataset').value=current.id;
  $('sourceBadge').textContent=current.kind==='uav'?'UAV DSM · 同日正射貼圖':'衛星 DSM · 歷史參考';
  $('sceneDate').textContent=current.date;
  $('sceneSpacing').textContent=`地面網格 ${current.meshResolution} m`;
  $('sourceResolution').textContent=`${current.sourceResolution} m`;
  $('meshResolution').textContent=`${current.meshResolution} m`;
  $('validArea').textContent=`${current.validAreaHa.toFixed(1)} ha`;
  $('heightRange').textContent=`${format.format(current.heightRange[0])}–${format.format(current.heightRange[1])} m`;
  $('faceCount').textContent=format.format(current.triangles);
  $('sourceLine').textContent=`${current.crs} ｜ ${current.datum} ｜ 日期：${current.date}（${current.dateBasis}）`;
  $('limits').textContent=current.limits;
  $('downloadGlb').href=new URL(current.glb,assetBase);$('downloadGlb').download=current.glb;
  $('downloadDsm').href=new URL(current.raster,assetBase);$('downloadDsm').download=current.raster;
  $('downloadMetadata').href=new URL(current.id+'_metadata.json',assetBase);$('downloadMetadata').download=current.id+'_metadata.json';
  $('downloadSize').textContent=`GLB ${(current.bytes/1e6).toFixed(1)} MB · 展示模型`;
}

function sampleHeight(event){
  if(!terrain)return;
  renderRequested=true;
  const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
  raycaster.setFromCamera(pointer,camera);
  const hit=raycaster.intersectObject(terrain,true)[0];
  if(!hit){marker.visible=false;$('readout').textContent='此處無 DSM 網格資料';return;}
  marker.visible=true;marker.position.copy(hit.point);
  const e=manifest.origin[0]+hit.point.x,n=manifest.origin[1]-hit.point.z,h=manifest.origin[2]+hit.point.y/vertical;
  $('readout').textContent=`E ${e.toFixed(1)} · N ${n.toFixed(1)} ｜ H ${h.toFixed(1)} m（${current.kind==='uav'?'TWVD2001':'EGM2008'}）`;
  $('readout').dataset.height=h.toFixed(3);
}

function rotate(angle){const offset=camera.position.clone().sub(controls.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),angle);camera.position.copy(controls.target).add(offset);controls.update();}
function zoom(factor){const offset=camera.position.clone().sub(controls.target);offset.multiplyScalar(factor);offset.clampLength(controls.minDistance,controls.maxDistance);camera.position.copy(controls.target).add(offset);controls.update();}

$('dataset').addEventListener('change',e=>loadModel(e.target.value));
$('textureMode').addEventListener('click',()=>{mode='texture';applyMode();});
$('heightMode').addEventListener('click',()=>{mode='height';applyMode();});
$('wireframe').addEventListener('change',applyMode);
$('exaggeration').addEventListener('change',e=>{
  const previous=vertical;vertical=Number(e.target.value);
  if(terrain){terrain.scale.y=vertical;controls.target.y*=vertical/previous;camera.position.y*=vertical/previous;box=new THREE.Box3().setFromObject(terrain);marker.visible=false;controls.update();}
});
$('viewOblique').addEventListener('click',()=>frame('oblique'));
$('viewTop').addEventListener('click',()=>frame('top'));
$('rotateLeft').addEventListener('click',()=>rotate(Math.PI/8));$('rotateRight').addEventListener('click',()=>rotate(-Math.PI/8));
$('zoomIn').addEventListener('click',()=>zoom(.8));$('zoomOut').addEventListener('click',()=>zoom(1.25));
$('fullscreen').addEventListener('click',async()=>{
  try{if(document.fullscreenElement)await document.exitFullscreen();else await document.querySelector('.terrain-app').requestFullscreen();}
  catch{$('readout').textContent='此瀏覽器未允許全螢幕，可使用獨立模型頁面。';}
});
document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'退出全螢幕 ⛶':'全螢幕 ⛶';});
$('saveImage').addEventListener('click',()=>{
  if(!renderer||!current)return;
  renderer.render(scene,camera);
  const out=document.createElement('canvas');out.width=renderer.domElement.width;out.height=renderer.domElement.height+110;
  const ctx=out.getContext('2d');ctx.fillStyle='#e6eff3';ctx.fillRect(0,0,out.width,out.height);ctx.drawImage(renderer.domElement,0,0);
  ctx.fillStyle='#fff';ctx.fillRect(0,out.height-110,out.width,110);ctx.fillStyle='#173447';ctx.font='bold 22px "Microsoft JhengHei", sans-serif';
  ctx.fillText(current.name,20,out.height-75);ctx.font='16px "Microsoft JhengHei", sans-serif';
  ctx.fillText(`展示網格 ${current.meshResolution} m | 垂直倍率 ${vertical}× | ${current.datum}`,20,out.height-43);
  ctx.fillText('既有 DSM 網格化；展示間距不代表高程精度；無資料區未補值。',20,out.height-16);
  out.toBlob(blob=>{const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=current.id+'_view.png';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
});
$('retry').addEventListener('click',()=>{if(!renderer||!manifest||contextLost)location.reload();else loadModel(pendingModelId || $('dataset').value);});
$('dismissError').addEventListener('click',()=>{$('loading').hidden=true;});
window.addEventListener('message',event=>{if(event.origin===location.origin && event.source===parent && event.data?.type==='terrain-visibility'){pageActive=Boolean(event.data.active);renderRequested=true;}});
if(embedded)new ResizeObserver(()=>{
  parent.postMessage({type:'terrain-viewer-size',height:Math.ceil(document.querySelector('.terrain-app').getBoundingClientRect().height)},location.origin);
}).observe(document.querySelector('.terrain-app'));
try{
  const response=await fetch(new URL('manifest.json',assetBase),{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('模型清單無法讀取');manifest=await response.json();
  for(const item of manifest.models){const option=document.createElement('option');option.value=item.id;option.textContent=item.kind==='uav'?`${item.date} · UAV 實測 DSM`:'2011–2015 · Copernicus 衛星參考';$('dataset').appendChild(option);}
  $('dataset').firstElementChild.remove();$('dataset').disabled=false;
  setupRenderer();
  const id=location.hash.slice(1);await loadModel(manifest.models.some(m=>m.id===id)?id:manifest.defaultModel);
}catch(error){showLoading(`三維檢視器無法啟動：${error.message}。請使用支援 WebGL 2 的瀏覽器。`,true);$('downloadGlb').href=new URL('matayan_20250930.glb',assetBase);}
