// Public CMS operations are limited to Blog. The database retains legacy types.
export const COLLECTIONS = Object.freeze(["blog"]);
export const assetRepoPath = (entry, asset) => `images/cms/${entry.id}/${asset.path.split("/").at(-1)}`;
export function collectionPath(path, collection = "blog") {
  if (collection !== "blog" || typeof path !== "string" || path.length > 500 || /[\\\x00-\x1f]/.test(path)) return false;
  const parts = path.split("/");
  return parts.length === 2 && parts[0] === "_blog" && parts[1] !== "." && parts[1] !== ".." && parts[1].endsWith(".md");
}
