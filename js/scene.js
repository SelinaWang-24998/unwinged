import * as THREE from 'three';

const GRID_SIZE = 44;
const TILE_SIZE = 1;
const MAP_RADIUS = 20 * TILE_SIZE;

let scene, camera, renderer;
let gridGroup;
const gridColor = 0x4488cc;
const gridBgColor = 0x1a3060;

export function initScene(container) {
  // Dispose old renderer to free WebGL context (critical on mobile)
  if (renderer) {
    renderer.dispose();
    try { renderer.forceContextLoss(); } catch (e) {}
    if (renderer.domElement && renderer.domElement.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  }

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87CEEB);
  scene.fog = new THREE.Fog(0x87CEEB, 25, 50);

  // Isometric camera (orthographic, 45° angle)
  const aspect = window.innerWidth / window.innerHeight;
  const size = 12;
  camera = new THREE.OrthographicCamera(-size * aspect, size * aspect, size, -size, 0.1, 100);
  camera.position.set(16, 14, 16);
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // Lighting
  const ambient = new THREE.AmbientLight(0x8899bb, 0.8);
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(10, 20, 5);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024, 1024);
  dir.shadow.camera.left = -20; dir.shadow.camera.right = 20;
  dir.shadow.camera.top = 20; dir.shadow.camera.bottom = -20;
  scene.add(dir);

  // Grid floor
  gridGroup = new THREE.Group();
  scene.add(gridGroup);
  createGrid();

  // Sky gradient (simple colored planes in background)
  createSkyBackground();

  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 200));
}

function createGrid() {
  const tex = createCircularGridTexture();
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;

  const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide });
  const geo = new THREE.CircleGeometry(MAP_RADIUS, 96);
  const floor = new THREE.Mesh(geo, mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.05, 0);
  gridGroup.add(floor);
}

function createCircularGridTexture() {
  const size = 768;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = `#${gridBgColor.toString(16).padStart(6, '0')}`;
  ctx.fillRect(0, 0, size, size);

  const center = size / 2;
  const radius = size * 0.48;
  const step = size / GRID_SIZE;

  ctx.save();
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.clip();

  ctx.strokeStyle = `rgba(68,136,204,0.28)`;
  ctx.lineWidth = 1;

  for (let i = 0; i <= GRID_SIZE; i++) {
    const p = i * step;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function createSkyBackground() {
  return;
}

function onResize() {
  const aspect = window.innerWidth / window.innerHeight;
  const size = 12;
  camera.left = -size * aspect;
  camera.right = size * aspect;
  camera.top = size;
  camera.bottom = -size;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

// 重置场景内容但不销毁 renderer/scene/camera
// 避免手机端 WebGL 上下文释放/重建失败导致 3D 消失
export function resetSceneForGame() {
  // Remove all children except lights and grid
  const keep = new Set();
  scene.children.forEach(child => {
    if (child.isLight || child === gridGroup) keep.add(child);
  });
  const toRemove = [];
  scene.children.forEach(child => {
    if (!keep.has(child)) toRemove.push(child);
  });
  toRemove.forEach(child => scene.remove(child));

  // Reset scene background & fog (may have been altered)
  scene.background = new THREE.Color(0x87CEEB);
  scene.fog = new THREE.Fog(0x87CEEB, 25, 50);

  // Reset camera
  const aspect = window.innerWidth / window.innerHeight;
  const size = 12;
  camera.left = -size * aspect;
  camera.right = size * aspect;
  camera.top = size;
  camera.bottom = -size;
  camera.updateProjectionMatrix();
  camera.position.set(16, 14, 16);
  camera.lookAt(0, 0, 0);

  // Ensure renderer size matches current viewport (critical for mobile)
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }
export function getTileSize() { return TILE_SIZE; }
export function getGridSize() { return GRID_SIZE; }
export function getHalfGrid() { return (GRID_SIZE / 2) * TILE_SIZE; }
export function getMapRadius() { return MAP_RADIUS; }
export function render() { renderer.render(scene, camera); }
export { onResize };
