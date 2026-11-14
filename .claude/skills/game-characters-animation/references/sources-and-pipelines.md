# Character sources & pipelines (verified Oct 2026)

## Libraries

| Source | Licence | Content | Gotchas |
|---|---|---|---|
| Quaternius **Universal Animation Library** (quaternius.com, itch, OpenGameArt) | CC0 | UAL1: 120+ clips (Mar 2025). UAL2: 130+ clips (melee, armed, parkour, farming, fishing, zombie; Jan 2026). FBX/GLB/Blend. "Universal humanoid rig" tested in Godot/Unity/Unreal | Its free tier is a subset (paid tiers add clips and source). ozz-animation 0.17 samples use it, which makes it a good C++/WASM test set |
| **KayKit** (kaylousberg.itch.io) Character Animations + Adventurers/Skeletons packs | CC0 | 133 clips on `Rig_Medium`/`Rig_Large`, FBX + GLTF. Characters come with separate props (weapons, shields, hats) meant for bone sockets | Retargeting to other humanoids "may not look good" (author's words) |
| **Microsoft Rocketbox** (github.com/microsoft/Microsoft-Rocketbox) | MIT (since Dec 2020) | 115 rigged avatars, 417 animations, 15 visemes, 48 FACS + ARKit blendshapes. Movebox/Headbox companion repos | FBX + Unity-oriented. Convert via Blender → GLB. Bones are 3ds Max Biped-style (`Bip01 …`), so map names when retargeting |
| **Mixamo** (mixamo.com) | Free with Adobe ID, royalty-free in personal/commercial projects | Auto-rigger (bipeds only) + large mocap library | No official API, so automate downloads only by hand. Don't redistribute the raw files as a pack. FBX in cm (scale 0.01). Bone names `mixamorig:Hips` → sanitized `mixamorigHips` in three.js |
| Kenney mini characters | CC0 | Simple animated prototypes | Very low detail |
| **VRoid Studio** → VRM | Free tool (pixiv). The model licence is set per avatar in the VRM meta | Anime avatars with spring bones and expressions | Respect each VRM's `meta` licence fields (commercial use, redistribution) |
| Ready Player Me | — | **Shut down Jan 31 2026** after Netflix's acquisition (Dec 2025) | Exported GLBs keep working. URL-based loading, the avatar creator and the SDKs are gone |
| Avaturn / MetaPerson / Genies / Character Creator | Commercial | Avatar platforms (Avaturn/MetaPerson Pro ~$800/mo per Avatar SDK's own survey, which is a competitor's claim) | Vendor lock-in. Check terms |
| LPC (Liberated Pixel Cup) Universal Spritesheet Generator | GPL-3.0 code. Art CC0/CC-BY/CC-BY-SA/OGA-BY/GPL per asset | 2D paper-doll reference (64×64 frames) | Credit every non-CC0 author. CC-BY-SA is share-alike |

## AI auto-rig / animate APIs

**Meshy** (paid plan; ~5 credits per rig in their example):

```bash
# 1) rig: humanoid, textured, ≤380k tris, facing +Z
curl -s https://api.meshy.ai/openapi/v1/rigging -H "Authorization: Bearer $MESHY_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model_url":"https://cdn.example.com/hero.glb","height_meters":1.8}'          # or "input_task_id": "<text/image-to-3d task>"
curl -s https://api.meshy.ai/openapi/v1/rigging/$RIG_ID -H "Authorization: Bearer $MESHY_API_KEY"   # poll → rigged GLB/FBX + walk/run
# 2) animate: 1–10 presets from GET /openapi/v1/animations/library (~480 entries), one file with one clip per action
curl -s https://api.meshy.ai/openapi/v1/animations -H "Authorization: Bearer $MESHY_API_KEY" -H 'Content-Type: application/json' \
  -d '{"rig_task_id":"'$RIG_ID'","action_ids":[0,1,92],"post_process":{"operation_type":"change_fps","fps":30}}'
# result.animation_glb_url when status == SUCCEEDED
```

**Tripo** (v3 API, `https://openapi.tripo3d.com/v3`, Bearer key, async: poll the Task Query API or use a webhook):

```bash
curl -s https://openapi.tripo3d.com/v3/animations/rig -H "Authorization: Bearer $TRIPO_API_KEY" -H 'Content-Type: application/json' \
  -d '{"input":"task_xxx","model":"v3.0-20260909","rig_type":"biped","spec":"mixamo","out_format":"glb"}'
curl -s https://openapi.tripo3d.com/v3/animations/retarget -H "Authorization: Bearer $TRIPO_API_KEY" -H 'Content-Type: application/json' \
  -d '{"input":"task_rigged","animations":["preset:idle","preset:walk","preset:run"],"animate_in_place":true,"out_format":"glb"}'
```

- `spec: "mixamo"` gives Mixamo-compatible bone names, so Mixamo and UAL clips can be reused by the name map.
- Non-humanoids use `model: "v2.5-20260210"` with `rig_type` quadruped/hexapod/octopod/avian/serpentine/aquatic.
- A request takes at most 5 presets, and you send either `animation` or `animations`, not both.

The Meshy/Tripo/Hunyuan generation step itself is covered in `game-asset-pipeline`. `majidmanzarpour/threejs-game-skills` → `threejs-3d-generator` already wraps the Tripo rig+animate flow.

## Blender (via blender-mcp)

- **Setup:** `claude mcp add blender uvx mcp-for-blender`, then `uvx mcp-for-blender install-addon` (the old `uvx blender-mcp` still works). Keep its socket local.
- **Rigify** (built in) generates a control rig with `DEF-`/`ORG-`/`MCH-` bones. Export **only the deform bones**: bake the actions to `DEF-*` and disable the non-deform bones (the glTF exporter has a "Deform bones only" option).
- **Auto-Rig Pro** (paid add-on) does Smart auto-rig, Game Engine export (Humanoid/UE/Mixamo-named skeletons) and **Remap** (retarget a mocap/Mixamo action onto your rig, then bake). It's the most reliable way to retarget a library offline.
- **Rokoko Blender add-on**: free, does retargeting (check the current version).

Agent tasks to request, then verify:
1. Apply scale (FBX 0.01 → 1), set +Y up / −Z forward for glTF, and put the feet at the origin.
2. Bake each imported action onto the main armature with descriptive names (`Idle`, `Walk`, `Run`, `Attack1`).
3. Export one GLB with all animations.
4. **Verify** with `npx @gltf-transform/cli inspect hero.glb`. The ANIMATIONS table must list every clip with sensible durations, and SKINS must have 1 skin with the expected joint count.

Blender 4.4+ introduced **slotted actions**, which changed how actions bind to objects. Ask the agent to check `bpy.app.version` and use NLA strips (one track per action) so the glTF exporter (`export_animation_mode='ACTIONS'` or `'NLA_TRACKS'`) writes every clip. Check the docs for your version.

A no-Blender alternative for three.js: keep the clips in separate anim-only GLBs. At runtime, load each one and add its `gltf.animations` to the base model's mixer. Binding is by bone name, so this works whenever the rigs match.

```ts
const [base, ...animFiles] = await Promise.all(['hero.glb', 'anim_locomotion.glb', 'anim_combat.glb'].map((u) => loader.loadAsync(u)));
const clips = animFiles.flatMap((g) => g.animations);
```

## Video mocap (Oct 2026)

| Tool | Free tier / price | Output | Notes |
|---|---|---|---|
| Rokoko Vision | Starter free 30 s/mo; Basic $12/mo 600 s | FBX (free), BVH (Basic+) | Single or dual cam, browser |
| Move One (Move AI) | Credit-based (check pricing) | FBX/USD etc. | iPhone app, single camera. Move Pro is multi-cam |
| DeepMotion Animate 3D | Free 60 s/mo **non-commercial** | FBX, BVH, GLB, MP4 | Hands/face cost extra credits. SayMotion is text→motion |
| QuickMagic | 50 free coins, 30 s clips | FBX (free), many presets paid | Mixamo/Unity/UE/VRM/MMD presets |
| Uthana | $0.05 per input second, API | FBX, GLB, BVH | Auto-retarget to biped rigs. GraphQL API |
| Cartwheel | Credits (1/person/s) | BVH, FBX | Capture + text-to-motion + editing |
| FreeMoCap (OSS) | Free | Blender/CSV-based outputs | AGPL-3.0 app, ~10.6k★, multi-webcam markerless |
| GVHMR (research) | Free | SMPL params | **Non-commercial** licence. SMPL itself is non-commercial |

**Clean-up checklist for any mocap:**
1. Trim the clip and loop-match its first and last pose.
2. Lock foot contacts (Blender, or foot IK at runtime).
3. Remove root drift, or extract it as root motion.
4. Filter jitter: a Butterworth/Gaussian filter on rotation curves, or the tool's own smoothing.
5. Retarget to the game rig.
6. Rerun the foot-slide metric from SKILL.md.

Prefer stock loops for locomotion and use mocap for one-off emotes, cut-scenes and signature attacks.
