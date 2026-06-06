import * as THREE from 'three';

const GRID_SIZE = 20;
const TILE_SIZE = 1;

let scene, camera, renderer;
let gridGroup;
const gridColor = 0x4488cc;
const gridBgColor = 0x1a3060;

export function initScene(container) {
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
  return { scene, camera, renderer };
}

function createGrid() {
  const mat = new THREE.MeshBasicMaterial({ color: gridBgColor, side: THREE.DoubleSide });
  const geo = new THREE.PlaneGeometry(GRID_SIZE * TILE_SIZE, GRID_SIZE * TILE_SIZE);
  const floor = new THREE.Mesh(geo, mat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, -0.05, 0);
  gridGroup.add(floor);

  // Grid lines
  const lineMat = new THREE.LineBasicMaterial({ color: gridColor, transparent: true, opacity: 0.3 });
  const half = (GRID_SIZE / 2) * TILE_SIZE;
  for (let i = 0; i <= GRID_SIZE; i++) {
    const pos = -half + i * TILE_SIZE;
    addLine(lineMat, [pos, 0, -half], [pos, 0, half]);
    addLine(lineMat, [-half, 0, pos], [half, 0, pos]);
  }
}

function addLine(mat, from, to) {
  const points = [new THREE.Vector3(...from), new THREE.Vector3(...to)];
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  gridGroup.add(new THREE.Line(geo, mat));
}

function createSkyBackground() {
  // Simple sky dome using a large hemisphere or just rely on scene background color
  // Floating island silhouettes in the background
  const bgMat = new THREE.MeshToonMaterial({ color: 0xc8d8e8 });
  for (let i = 0; i < 5; i++) {
    const x = (Math.random() - 0.5) * 30;
    const y = 8 + Math.random() * 6;
    const z = (Math.random() - 0.5) * 30;
    const size = 0.6 + Math.random() * 1.5;
    const geo = new THREE.BoxGeometry(size, size * 0.3, size);
    const cloud = new THREE.Mesh(geo, bgMat);
    cloud.position.set(x, y, z);
    cloud.rotation.set(Math.random() * 0.3, Math.random() * Math.PI, Math.random() * 0.3);
    scene.add(cloud);
  }
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
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }
export function getTileSize() { return TILE_SIZE; }
export function getGridSize() { return GRID_SIZE; }
export function getHalfGrid() { return (GRID_SIZE / 2) * TILE_SIZE; }
export function render() { renderer.render(scene, camera); }
