// Particle effects system
import * as THREE from 'three';
import { getScene } from './scene.js';

let particleGroups = {
  collect: [],
  splash: [],
  dust: [],
  ripple: []
};

const COLLECT_COLOR = 0xffdd44;
const SPLASH_COLOR = 0x4488cc;
const DUST_COLOR = 0xc4a45a;

// Shared geometry — created once, reused by all particles
const sharedGeo = new THREE.SphereGeometry(0.05, 4, 4);

// Create a single particle using shared geometry
function createParticle(x, y, z, color, velocity, life) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
  const mesh = new THREE.Mesh(sharedGeo, mat);
  mesh.position.set(x, y, z);
  mesh.userData = {
    velocity: velocity.clone(),
    life: life,
    maxLife: life
  };
  return mesh;
}

// Spawn collect particles at position
export function spawnCollectParticles(x, y, z, count = 12) {
  const scene = getScene();
  const group = new THREE.Group();
  group.name = 'particleEffect';
  
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    const speed = 2 + Math.random() * 2;
    const vel = new THREE.Vector3(
      Math.cos(angle) * speed,
      2 + Math.random() * 2,
      Math.sin(angle) * speed
    );
    const p = createParticle(x, y, z, COLLECT_COLOR, vel, 0.8 + Math.random() * 0.4);
    group.add(p);
  }
  
  scene.add(group);
  particleGroups.collect.push(group);
  return group;
}

// Spawn splash particles at water surface
export function spawnSplashParticles(x, y, z, count = 8) {
  const scene = getScene();
  const group = new THREE.Group();
  group.name = 'particleEffect';
  
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 1.5;
    const vel = new THREE.Vector3(
      Math.cos(angle) * speed,
      3 + Math.random() * 2,
      Math.sin(angle) * speed
    );
    const p = createParticle(x, y, z, SPLASH_COLOR, vel, 0.5 + Math.random() * 0.3);
    group.add(p);
  }
  
  scene.add(group);
  particleGroups.splash.push(group);
  return group;
}

// Spawn dust particles for terrain deformation
export function spawnDustParticles(x, y, z, count = 6) {
  const scene = getScene();
  const group = new THREE.Group();
  group.name = 'particleEffect';
  
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.5 + Math.random() * 0.5;
    const vel = new THREE.Vector3(
      Math.cos(angle) * speed,
      1 + Math.random(),
      Math.sin(angle) * speed
    );
    const p = createParticle(x, y, z, DUST_COLOR, vel, 0.4 + Math.random() * 0.2);
    p.scale.setScalar(0.8);
    group.add(p);
  }
  
  scene.add(group);
  particleGroups.dust.push(group);
  return group;
}

// Update all particles
export function updateParticles(delta) {
  const scene = getScene();
  const gravity = new THREE.Vector3(0, -9.8, 0);
  const toRemove = [];
  
  Object.keys(particleGroups).forEach(type => {
    const groups = particleGroups[type];
    for (let g = groups.length - 1; g >= 0; g--) {
      const group = groups[g];
      let allDead = true;
      
      group.children.forEach(p => {
        if (p.userData.life <= 0) return;
        allDead = false;
        
        p.userData.life -= delta;
        
        // Apply gravity
        p.userData.velocity.add(gravity.clone().multiplyScalar(delta));
        
        // Move particle
        p.position.add(p.userData.velocity.clone().multiplyScalar(delta));
        
        // Fade out
        const lifeRatio = p.userData.life / p.userData.maxLife;
        p.material.opacity = lifeRatio;
        p.scale.setScalar(lifeRatio);
        
        // Bounce on ground (y = 0)
        if (p.position.y < 0.05) {
          p.position.y = 0.05;
          p.userData.velocity.y *= -0.3;
        }
      });
      
      if (allDead) {
        toRemove.push(group);
        groups.splice(g, 1);
      }
    }
  });
  
  // Remove dead particles
  toRemove.forEach(group => {
    scene.remove(group);
    group.children.forEach(p => {
      p.material.dispose(); // only dispose cloned material, NOT shared geometry
    });
  });
}

// Spawn ripple effect (visual only, no physics)
const sharedRippleGeo = new THREE.RingGeometry(0.1, 0.2, 16);

export function spawnRipple(x, y, z) {
  const scene = getScene();
  const mat = new THREE.MeshBasicMaterial({
    color: 0xaaddff,
    transparent: true,
    opacity: 0.6,
    side: THREE.DoubleSide
  });
  const ring = new THREE.Mesh(sharedRippleGeo, mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, y + 0.01, z);
  ring.userData = { life: 0.6, maxLife: 0.6 };
  scene.add(ring);
  
  // Store for animation
  if (!particleGroups.ripple) particleGroups.ripple = [];
  particleGroups.ripple.push(ring);
  
  return ring;
}

// Update ripples
export function updateRipples(delta) {
  const scene = getScene();
  if (!particleGroups.ripple) return;
  
  const toRemove = [];
  
  particleGroups.ripple.forEach((ring, i) => {
    ring.userData.life -= delta;
    const ratio = ring.userData.life / ring.userData.maxLife;
    
    ring.scale.setScalar(1 + (1 - ratio) * 3);
    ring.material.opacity = ratio * 0.6;
    
    if (ring.userData.life <= 0) {
      toRemove.push(i);
    }
  });
  
  // Remove in reverse order
  toRemove.reverse().forEach(i => {
    const ring = particleGroups.ripple[i];
    scene.remove(ring);
    ring.material.dispose(); // only dispose material, NOT shared geometry
    particleGroups.ripple.splice(i, 1);
  });
}

// Clear all particles
export function clearAllParticles() {
  const scene = getScene();
  
  Object.keys(particleGroups).forEach(type => {
    particleGroups[type].forEach(group => {
      scene.remove(group);
      if (group.children) {
        group.children.forEach(p => {
          if (p.material) p.material.dispose();
          // Do NOT dispose shared geometry
        });
      }
    });
    particleGroups[type] = [];
  });
  
  // Clear ripples
  if (particleGroups.ripple) {
    particleGroups.ripple.forEach(ring => {
      scene.remove(ring);
      ring.material.dispose();
    });
    particleGroups.ripple = [];
  }
}
