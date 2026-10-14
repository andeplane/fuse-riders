import { createEndpoints } from "fuse-network-fe";
function configured() {
  const base = import.meta.env.BASE_URL;
  return createEndpoints(
    {
      basePath:
        base === "./" || base === ""
          ? new URL("./", location.href).pathname
          : `${base}fuse-riders/`,
      apiOrigin: import.meta.env.VITE_API_ORIGIN,
    },
    location.origin,
  );
}
export const appUrl = (query = "") => configured().appUrl(query);
export const apiUrl = (path: string) => configured().apiUrl(path);
