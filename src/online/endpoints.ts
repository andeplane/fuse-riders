import { createEndpoints } from 'fuse-network-fe';
function configured() { return createEndpoints({basePath:import.meta.env.BASE_URL,apiOrigin:import.meta.env.VITE_API_ORIGIN},location.origin); }
export const appUrl = (query = '') => configured().appUrl(query);
export const apiUrl = (path: string) => configured().apiUrl(path);
