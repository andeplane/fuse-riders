/** Idempotent asset resolution for root hosting and GitHub Pages project paths. */
export function resolveAssetUrl(path: string, base: string): string {
  if (/^(?:https?:)?\/\//.test(path) || path.startsWith('data:') || path.startsWith('blob:')) return path;
  const prefix=base.endsWith('/')?base:`${base}/`;
  if(path.startsWith(prefix))return path;
  return `${prefix}${path.replace(/^\//, '')}`;
}
export function assetUrl(path: string): string {
  return resolveAssetUrl(path,import.meta.env?.BASE_URL ?? '/');
}
