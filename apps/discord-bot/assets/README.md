# Discord bot branding

Assets for the RustTools Discord application profile. Matches the web app icon and HUD theme (`apps/web/public/icon-*.png`, `apps/web/src/styles/tokens.css`).

| File | Size | Use |
|------|------|-----|
| `icon-512.png` | 512×512 | **Bot avatar** (Developer Portal → Bot → Icon) |
| `discord-banner.png` | 680×240 (17:6) | **Profile banner** (Developer Portal → Bot → Banner, or API) |

## Upload in Discord Developer Portal

1. Open [Discord Developer Portal](https://discord.com/developers/applications) → your RustTools app.
2. **Bot** → **Icon** → upload `icon-512.png`.
3. **Bot** → **Banner** → upload `discord-banner.png`.

## Banner design

- **Aspect ratio:** **17:6** (680×240) — Discord’s recommended bot/profile banner shape.
- **Background:** Black (`#060809`) with full-width PCB circuit traces, pads, and orange hub glow.
- **Text:** Centered **RUSTTOOLS** in sci-fi block lettering with neon orange glow (`#ff6b1a` / `#ff8c42`).
- **Corners:** Orange HUD L-brackets at all four edges.
- **No icon on banner** — the bot avatar carries the terminal mark; bottom-left stays relatively clear for avatar overlap on profile views.

## Web app theme

The dashboard uses the same palette and HUD aesthetic:

- Tokens: `apps/web/src/styles/tokens.css` (`--accent: #ff6b1a`)
- Global backdrop: `apps/web/src/styles/background.css` (circuit grid, corner brackets, scanlines)

## Optional: set banner via API on startup

If the portal upload is unavailable for your app tier, the bot can set its banner once with `client.user.setBanner()` after login (requires `discord.js` v14+). Not enabled by default — manual upload is simpler.
