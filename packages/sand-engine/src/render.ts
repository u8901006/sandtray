/**
 * sand-engine render — Three.js displacement 渲染（REQ-016 §3.4；task T12／G33）。
 *
 * - 沙面：PlaneGeometry 依 hm 尺寸（w×h 頂點＝cell 數），applyPatch 只更新受影響頂點 y
 *   ＋該區法線（中央差分），不做整幾何 computeVertexNormals。
 * - 挖到底露藍：沙面頂點 alpha（itemSize 4 color attribute）在 v→0 時為 0，
 *   透明洞下方即蓝色盤底（BoxGeometry 五面可見、頂面不渲染）。
 * - 框體依 shape 用 ExtrudeGeometry(Shape)（外輪廓＋內孔）。
 * - disposeScene() 釋放全部 geometry／material（POC-7：info.memory 回基線）。
 *
 * 世界座標：1 單位＝7.2 cm（REQ-016 §2.0）。render 層只讀 hm；寫入一律經 core。
 * 頂點 (i,j) 對應 cell (i,j)（邊緣對齊而非中心對齊，POC 容差內；POC-6 落點誤差 ≤0.5 mm
 * 是以 heightAtCm 核對放置 y，不受此對齊影響）。
 */
import * as THREE from 'three';
import { heightAtCm, u8ToCm, type Heightmap, type Patch, type TrayShape } from './core';

export const CM_PER_UNIT = 7.2;
export const SAND_COLOR = 0xc2a878;
export const TRAY_BLUE = 0x1f5f8b; // Pantone 近似（REQ-016 §2.1）

export interface SandStats {
  geometries: number;
  textures: number;
  programs: number;
}

export interface PlacedBox {
  yUnits: number;
  yCm: number;
}

const WALL_UNITS = 2.5 / CM_PER_UNIT; // 框厚 ≈2.5 cm
const RIM_EXTRA_UNITS = 0.15;

export class SandRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  private group: THREE.Group | null = null;
  private sandGeom: THREE.PlaneGeometry | null = null;
  private sandColorAttr: THREE.BufferAttribute | null = null;
  private disposables: Array<THREE.BufferGeometry | THREE.Material> = [];
  private hm: Heightmap | null = null;
  private wu = 0;
  private hu = 0;
  private raycaster = new THREE.Raycaster();

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x101418);
  }

  getHeightmap(): Heightmap | null {
    return this.hm;
  }

  build(hm: Heightmap): void {
    this.disposeScene();
    this.hm = hm;
    this.wu = (hm.w / 2) / CM_PER_UNIT;
    this.hu = (hm.h / 2) / CM_PER_UNIT;

    const group = new THREE.Group();
    this.group = group;
    this.scene.add(group);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x445566, 1.0);
    const ambient = new THREE.AmbientLight(0x8899aa, 0.5); // 深洞底部仍可讀出藍色
    const dir = new THREE.DirectionalLight(0xffffff, 1.6);
    dir.position.set(5, 10, 7);
    group.add(hemi, ambient, dir);

    // 沙面（PlaneGeometry：w×h 頂點＝cell 數）
    const geom = new THREE.PlaneGeometry(this.wu, this.hu, hm.w - 1, hm.h - 1);
    geom.rotateX(-Math.PI / 2);
    this.sandGeom = geom;
    const colors = new Float32Array(hm.w * hm.h * 4);
    const c = new THREE.Color(SAND_COLOR);
    for (let k = 0; k < hm.w * hm.h; k++) {
      colors[k * 4] = c.r;
      colors[k * 4 + 1] = c.g;
      colors[k * 4 + 2] = c.b;
      colors[k * 4 + 3] = 1;
    }
    const colorAttr = new THREE.BufferAttribute(colors, 4);
    colorAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('color', colorAttr);
    this.sandColorAttr = colorAttr;
    const sandMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      transparent: true,
      roughness: 1,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const sand = new THREE.Mesh(geom, sandMat);
    group.add(sand);
    this.disposables.push(geom, sandMat);

    // 藍色盤底：bottom＋四內牆（BoxGeometry 頂面不渲染）
    const surfaceU = u8ToCm(Math.round((hm.depthCm / (hm.depthCm + 3)) * 255), hm.depthCm) / CM_PER_UNIT;
    const sideH = surfaceU + 0.03;
    const blueMat = new THREE.MeshStandardMaterial({ color: TRAY_BLUE, roughness: 0.9, metalness: 0 });
    const hiddenMat = new THREE.MeshBasicMaterial({ visible: false });
    const blueGeom = new THREE.BoxGeometry(this.wu, sideH, this.hu);
    const blue = new THREE.Mesh(blueGeom, [blueMat, blueMat, hiddenMat, blueMat, blueMat, blueMat]);
    blue.position.y = -0.01 + sideH / 2;
    group.add(blue);
    this.disposables.push(blueGeom, blueMat, hiddenMat);

    // 框體：ExtrudeGeometry（外輪廓＋內孔）
    const rimH = surfaceU + RIM_EXTRA_UNITS;
    const rimGeom = new THREE.ExtrudeGeometry(this.trayShape(hm.shape, this.wu, this.hu, WALL_UNITS), {
      depth: rimH,
      bevelEnabled: false,
      curveSegments: 48,
    });
    rimGeom.rotateX(-Math.PI / 2);
    const rimMat = new THREE.MeshStandardMaterial({ color: TRAY_BLUE, roughness: 0.85, metalness: 0 });
    const rim = new THREE.Mesh(rimGeom, rimMat);
    group.add(rim);
    this.disposables.push(rimGeom, rimMat);

    this.syncAll();
    this.fitCamera();
  }

  /** 外輪廓（outer）＋內孔（inner）。shape 座標對稱，rotateX 後鏡像不影響。 */
  private trayShape(shape: TrayShape, wu: number, hu: number, wall: number): THREE.Shape {
    const outer = new THREE.Shape();
    const hole = new THREE.Path();
    if (shape === 'circle') {
      const ri = Math.min(wu, hu) / 2;
      outer.absarc(0, 0, ri + wall, 0, Math.PI * 2, false);
      hole.absarc(0, 0, ri, 0, Math.PI * 2, true);
    } else if (shape === 'octagon') {
      const octPoints = (apothem: number): Array<[number, number]> => {
        const r = apothem / Math.cos(Math.PI / 8);
        const pts: Array<[number, number]> = [];
        for (let k = 0; k < 8; k++) {
          const a = Math.PI / 8 + (k * Math.PI) / 4;
          pts.push([r * Math.cos(a), r * Math.sin(a)]);
        }
        return pts;
      };
      const innerPts = octPoints(Math.min(wu, hu) / 2);
      const outerPts = octPoints(Math.min(wu, hu) / 2 + wall);
      outer.moveTo(outerPts[0][0], outerPts[0][1]);
      for (let k = 1; k < 8; k++) outer.lineTo(outerPts[k][0], outerPts[k][1]);
      outer.closePath();
      hole.moveTo(innerPts[7][0], innerPts[7][1]);
      for (let k = 6; k >= 0; k--) hole.lineTo(innerPts[k][0], innerPts[k][1]);
      hole.closePath();
    } else {
      // rect／square
      const hw = wu / 2;
      const hh = hu / 2;
      outer.moveTo(-hw - wall, -hh - wall);
      outer.lineTo(hw + wall, -hh - wall);
      outer.lineTo(hw + wall, hh + wall);
      outer.lineTo(-hw - wall, hh + wall);
      outer.closePath();
      hole.moveTo(-hw, hh);
      hole.lineTo(hw, hh);
      hole.lineTo(hw, -hh);
      hole.lineTo(-hw, -hh);
      hole.closePath();
    }
    outer.holes.push(hole);
    return outer;
  }

  /** 整張同步 y／alpha／法線（build 或批次 ops 後用）。 */
  syncAll(): void {
    const hm = this.hm;
    const geom = this.sandGeom;
    if (!hm || !geom) return;
    this.updateRegion(0, 0, hm.w - 1, hm.h - 1);
    geom.attributes.position.needsUpdate = true;
    geom.attributes.normal.needsUpdate = true;
    if (this.sandColorAttr) this.sandColorAttr.needsUpdate = true;
  }

  /** 套用 core.applyBrush 的 patch：只動受影響頂點與該區法線。 */
  applyPatch(p: Patch): void {
    const hm = this.hm;
    const geom = this.sandGeom;
    if (!hm || !geom || p.w === 0 || p.h === 0) return;
    const x1 = Math.min(hm.w - 1, p.x0 + p.w - 1);
    const y1 = Math.min(hm.h - 1, p.y0 + p.h - 1);
    this.updateRegion(p.x0, p.y0, x1, y1);
    geom.attributes.position.needsUpdate = true;
    geom.attributes.normal.needsUpdate = true;
    if (this.sandColorAttr) this.sandColorAttr.needsUpdate = true;
  }

  private updateRegion(x0: number, y0: number, x1: number, y1: number): void {
    const hm = this.hm;
    const geom = this.sandGeom;
    if (!hm || !geom) return;
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const nor = geom.attributes.normal as THREE.BufferAttribute;
    const col = this.sandColorAttr;
    const { w, h, data } = hm;
    const dxu = this.wu / (w - 1);
    const dzu = this.hu / (h - 1);
    const cmPerU8 = (hm.depthCm + 3) / 255;

    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const idx = j * w + i;
        const v = data[idx];
        pos.setY(idx, (v * cmPerU8) / CM_PER_UNIT);
        if (col) col.setW(idx, Math.min(1, v / 6)); // v=0 全透明 → 露藍底
      }
    }
    // 區域法線：中央差分（邊界單側）
    const ny0 = Math.max(0, y0 - 1);
    const ny1 = Math.min(h - 1, y1 + 1);
    const nx0 = Math.max(0, x0 - 1);
    const nx1 = Math.min(w - 1, x1 + 1);
    for (let j = ny0; j <= ny1; j++) {
      for (let i = nx0; i <= nx1; i++) {
        const li = Math.max(0, i - 1);
        const ri = Math.min(w - 1, i + 1);
        const lj = Math.max(0, j - 1);
        const rj = Math.min(h - 1, j + 1);
        const hx = (pos.getY(j * w + ri) - pos.getY(j * w + li)) / ((ri - li) * dxu);
        const hz = (pos.getY(rj * w + i) - pos.getY(lj * w + i)) / ((rj - lj) * dzu);
        const len = Math.sqrt(hx * hx + hz * hz + 1);
        nor.setXYZ(i + j * w, -hx / len, 1 / len, -hz / len);
      }
    }
  }

  /** 放置測試方塊：y＝heightAtCm 該點值（POC-6 用回傳值核對）。 */
  placeBox(xCm: number, zCm: number, sizeUnits = 1): PlacedBox | null {
    const hm = this.hm;
    if (!hm || !this.group) return null;
    const yCm = heightAtCm(hm, xCm, zCm);
    if (!Number.isFinite(yCm)) return null;
    const x = (xCm / (hm.w / 2) - 0.5) * this.wu;
    const z = (zCm / (hm.h / 2) - 0.5) * this.hu;
    const geom = new THREE.BoxGeometry(sizeUnits, sizeUnits, sizeUnits);
    const mat = new THREE.MeshStandardMaterial({ color: 0xb06030, roughness: 0.8 });
    const mesh = new THREE.Mesh(geom, mat);
    const yUnits = yCm / CM_PER_UNIT + sizeUnits / 2;
    mesh.position.set(x, yUnits, z);
    this.group.add(mesh);
    this.disposables.push(geom, mat);
    return { yUnits, yCm };
  }

  /** 釋放場景全部資源（POC-7：renderer.info.memory 回基線）。 */
  disposeScene(): void {
    if (this.group) {
      this.scene.remove(this.group);
      this.group = null;
    }
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.sandGeom = null;
    this.sandColorAttr = null;
    this.hm = null;
  }

  stats(): SandStats {
    return {
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
    };
  }

  getSandMesh(): THREE.Mesh | null {
    const g = this.group;
    if (!g) return null;
    return (g.children.find((c) => (c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry === this.sandGeom) as THREE.Mesh) ?? null;
  }

  /** NDC 座標對沙面 raycast，回世界單位（demo 轉盤內 cm 用）。 */
  pickOnSand(ndcX: number, ndcY: number): { xUnits: number; zUnits: number } | null {
    const mesh = this.getSandMesh();
    if (!mesh) return null;
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = this.raycaster.intersectObject(mesh, false)[0];
    return hit ? { xUnits: hit.point.x, zUnits: hit.point.z } : null;
  }

  /** 盤內 cm（原點 min 角）→ 世界單位。 */
  cmToWorld(xCm: number, zCm: number): { x: number; z: number } {
    const hm = this.hm;
    if (!hm) return { x: 0, z: 0 };
    return {
      x: (xCm / (hm.w / 2) - 0.5) * this.wu,
      z: (zCm / (hm.h / 2) - 0.5) * this.hu,
    };
  }

  /** 世界單位 → 盤內 cm（原點 min 角）。 */
  worldToCm(xUnits: number, zUnits: number): { x: number; z: number } {
    const hm = this.hm;
    if (!hm) return { x: 0, z: 0 };
    return {
      x: (xUnits / this.wu + 0.5) * (hm.w / 2),
      z: (zUnits / this.hu + 0.5) * (hm.h / 2),
    };
  }

  fitCamera(): void {
    const span = Math.max(this.wu, this.hu);
    this.camera.position.set(0, span * 0.85 + 4, span * 0.7 + 5);
    this.camera.lookAt(0, 0.5, 0);
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
