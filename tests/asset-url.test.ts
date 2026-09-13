import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAssetUrl } from '../src/client/asset-url.js';
test('assets resolve once under a Pages base and preserve external URLs',()=>{
 const base='/fuse-riders/';
 for(const source of ['/themes/neon-pixel/bomb.svg','themes/neon-pixel/bomb.svg']) {
  const resolved=resolveAssetUrl(source,base);assert.equal(resolved,'/fuse-riders/themes/neon-pixel/bomb.svg');assert.equal(resolveAssetUrl(resolved,base),resolved);
 }
 assert.equal(resolveAssetUrl('/avatars/neon-heads.png','/'),'/avatars/neon-heads.png');
 for(const source of ['https://cdn.example/a.png','//cdn.example/a.png','data:image/png;base64,abc','blob:https://example/123'])assert.equal(resolveAssetUrl(source,base),source);
});
