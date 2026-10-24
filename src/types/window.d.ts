// The API public/preload.js exposes to the renderer (New-15). Left loose:
// renderer code and tests use it freely; src/components/env/envApi.js
// types the env vault part.
interface Window {
  electronAPI: any;
}
