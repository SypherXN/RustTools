# Discord bot branding

Assets for the RustTools Discord application profile. Matches the web app icon (`apps/web/public/icon-*.png`).

| File | Size | Use |
|------|------|-----|
| `icon-512.png` | 512×512 | **Bot avatar** (Developer Portal → Bot → Icon) |
| `discord-banner.png` | 680×240 (17:6) | **Profile banner** (Developer Portal → Bot → Banner, or API) |

## Upload in Discord Developer Portal

1. Open [Discord Developer Portal](https://discord.com/developers/applications) → your RustTools app.
2. **Bot** → **Icon** → upload `icon-512.png`.
3. **Bot** → **Banner** → upload `discord-banner.png`.

Discord bot banners use a **17:6** aspect ratio (this asset is **680×240**). The banner is a full circuit-board HUD background with centered **RustTools** logotype (no icon — the bot avatar carries the mark). Corner brackets frame the canvas; keep the bottom-left relatively clear for avatar overlap on profile views.

## Optional: set banner via API on startup

If the portal upload is unavailable for your app tier, the bot can set its banner once with `client.user.setBanner()` after login (requires `discord.js` v14+). Not enabled by default — manual upload is simpler.

## Design

Black background, neon orange (`#ff6b1a` / `#ff8c42`) terminal HUD aesthetic — same palette as `apps/web/src/styles/tokens.css`.
