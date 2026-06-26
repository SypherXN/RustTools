/** Live Rust+ CCTV feeds (requires server `cctvrender.enabled true`). Enabled by default; set VITE_LIVE_CAMERAS=false to hide. */
export const LIVE_CAMERAS_ENABLED = import.meta.env.VITE_LIVE_CAMERAS !== "false";
