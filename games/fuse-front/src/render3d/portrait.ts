/**
 * Portraits from the 3D models: each model renders once, head and shoulders in a three-quarter view, into one small
 * offscreen WebGL canvas, and comes back as a PNG data URL for the HUD and the lobby. Generic over the model, so a
 * better hero model shows up here unchanged. The context is released as soon as the batch is done.
 */
import * as THREE from "three";
import { paintMaterials, type Model } from "./models.js";

export interface PortraitJob {
  key: string;
  model: Model;
  /** The colour of the model's `team` surfaces. */
  tint: number;
}

/** Renders every job at `size` CSS pixels square (doubled for sharpness); throws when WebGL is unavailable. */
export function renderPortraits(
  jobs: readonly PortraitJob[],
  size = 160,
): Map<string, string> {
  const canvas = document.createElement("canvas");
  const gl = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  const out = new Map<string, string>();
  const paints = paintMaterials();
  try {
    gl.setPixelRatio(2);
    gl.setSize(size, size, false);
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    gl.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const sun = new THREE.DirectionalLight(0xffe0b0, 3.2);
    sun.position.set(2, 4, 3);
    scene.add(new THREE.HemisphereLight(0xc8dcf0, 0x6a5440, 0.9), sun);
    const camera = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
    for (const job of jobs) {
      paints.team.color.setHex(job.tint);
      const group = new THREE.Group();
      for (const part of job.model)
        group.add(new THREE.Mesh(part.geometry, paints[part.paint]));
      scene.add(group);
      const box = new THREE.Box3().setFromObject(group);
      const height = box.max.y - box.min.y;
      // Frame the top 70% of the body from the front-left, a little above it.
      const look = new THREE.Vector3(0, box.min.y + height * 0.62, 0);
      const span = Math.max(height * 0.75, box.max.x - box.min.x);
      const away = span / 2 / Math.tan((camera.fov * Math.PI) / 360) + 0.15;
      camera.position.set(away * 0.45, look.y + height * 0.12, away * 0.9);
      camera.lookAt(look);
      gl.render(scene, camera);
      out.set(job.key, canvas.toDataURL("image/png"));
      scene.remove(group);
    }
  } finally {
    for (const material of Object.values(paints)) {
      material.map?.dispose();
      material.dispose();
    }
    for (const job of jobs)
      for (const part of job.model) part.geometry.dispose();
    gl.dispose();
    gl.forceContextLoss();
  }
  return out;
}
