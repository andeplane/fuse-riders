# Tilemap loaders (Tiled + LDtk) per engine

## Tiled → Phaser 4 (native)

Export: File → Export As → JSON. In the Map Properties, tick "Embed tilesets" (or Map → Embed Tileset). External `.tsx` references are not resolved by Phaser.

```ts
preload() {
  this.load.tilemapTiledJSON("level1", "maps/level1.json");
  this.load.image("tiles", "tiles/tileset-extruded.png");
}
create() {
  const map = this.make.tilemap({ key: "level1" });
  // name must equal the tileset name in Tiled. margin/spacing must match the extruded image
  const tiles = map.addTilesetImage("tileset", "tiles", 16, 16, 1, 2)!;
  const bg = map.createLayer("Background", tiles, 0, 0)!;
  const ground = map.createLayer("Ground", tiles, 0, 0)!;
  ground.setCollisionByProperty({ collides: true });

  // object layer → entities
  const spawn = map.findObject("Entities", (o) => o.name === "spawn")!;
  for (const o of map.getObjectLayer("Entities")!.objects) {
    if (o.type === "coin") this.spawnCoin(o.x!, o.y! - o.height!); // Tiled tile-objects are bottom-left anchored
  }
}
```

## LDtk → Phaser (manual parse)

LDtk project settings: keep "Save levels to separate files" **off** for small games (otherwise `levels[i].layerInstances` is `null` and you must load each `externalRelPath` `.ldtkl`).

```ts
type LdtkLayer = {
  __identifier: string; __type: "IntGrid" | "Entities" | "Tiles" | "AutoLayer";
  __cWid: number; __cHei: number; __gridSize: number;
  intGridCsv: number[]; gridTiles: { px: [number, number]; t: number; f: number }[];
  autoLayerTiles: { px: [number, number]; t: number; f: number }[];
  entityInstances: { __identifier: string; px: [number, number]; fieldInstances: { __identifier: string; __value: unknown }[] }[];
};

create() {
  const project = this.cache.json.get("ldtk");          // this.load.json("ldtk", "maps/world.ldtk")
  const level = project.levels.find((l: any) => l.identifier === "Level_0");
  const layers: LdtkLayer[] = [...level.layerInstances].reverse(); // LDtk lists TOP layer first
  for (const L of layers) {
    const grid = L.__gridSize;
    if (L.__type === "Tiles" || L.__type === "AutoLayer" || (L.__type === "IntGrid" && L.autoLayerTiles.length)) {
      const map = this.make.tilemap({ tileWidth: grid, tileHeight: grid, width: L.__cWid, height: L.__cHei });
      const ts = map.addTilesetImage("tiles", "tiles", grid, grid, 0, 0)!;
      const layer = map.createBlankLayer(L.__identifier, ts)!;
      for (const t of [...L.gridTiles, ...L.autoLayerTiles]) {
        const tile = layer.putTileAt(t.t, t.px[0] / grid, t.px[1] / grid);
        tile.flipX = (t.f & 1) !== 0; tile.flipY = (t.f & 2) !== 0;
      }
    }
    if (L.__type === "IntGrid") {
      // collision from IntGrid values (1 = solid by convention you define in LDtk)
      this.solid = L.intGridCsv.map((v) => v === 1);
      this.gridW = L.__cWid;
    }
    if (L.__type === "Entities") {
      for (const e of L.entityInstances) this.spawnEntity(e.__identifier, e.px[0], e.px[1], e.fieldInstances);
    }
  }
}
```
Overlapping auto-layer tiles at the same cell (LDtk stacks them) need multiple Phaser layers or a RenderTexture. Easiest: "Super simple export" (Project settings → export PNG per layer + CSV), then draw PNG layers as images and read the CSV for collision.

Typed alternative: `ldtk` npm (jprochazk/ldtk-ts, MIT) is old (2021). Writing your own types from the JSON schema (ldtk.io/json) is usually safer.

## Excalibur
```ts
import { TiledResource } from "@excaliburjs/plugin-tiled";
import { LdtkResource } from "@excaliburjs/plugin-ldtk";
const tiled = new TiledResource("./maps/level1.tmx");      // loads .tmx/.tmj
const loader = new ex.Loader([tiled]);
await game.start(loader);
tiled.addToScene(game.currentScene);
// LDtk works the same way: const ldtk = new LdtkResource("./maps/world.ldtk"); add to the loader, then ldtk.addToScene(...)
```
Check the plugin README for the version that matches your Excalibur (they version together, 0.32.x).

## PixiJS v8
- `@pixi/tilemap@5`: `const tm = new CompositeTilemap(); tm.tile(texture, x, y)`. Rebuild per chunk on change (check README for the v8 API).
- Or bake each 32×32-tile chunk into a `RenderTexture` once and cull chunks by camera rect.

## Godot 4
- Godot 4.3+ uses **`TileMapLayer`** nodes (the old multi-layer `TileMap` node is deprecated). Code: `layer.set_cell(Vector2i(x, y), source_id, atlas_coords)`.
- Tiled: **YATI** (Kiamo2/YATI, Asset Library #1772) imports `.tmx/.tmj` as a scene.
- LDtk: **heygleeson/godot-ldtk-importer** (MIT, Godot 4.1+) imports `.ldtk` as scenes with tilemaps + entity placeholders.
- Procedural: build with `set_cells_terrain_connect()` for terrain autotiling.

## Procedural levels sharing the same loader
Have your generator emit the **same JSON shape** as the editor (Tiled JSON or a subset of LDtk), then load it through the same function. You get one code path, and hand-authored rooms can be stitched into generated layouts. Verify with a seed sweep: for seeds 1..256, assert spawn→goal is reachable (BFS on the IntGrid) and the solid-tile ratio is within bounds.
