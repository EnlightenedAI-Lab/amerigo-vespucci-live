# IQAI Spatial Windows launchers

Desktop shortcuts are installed by:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\launchers\install-desktop-shortcuts.ps1
```

## Project path

Launchers resolve the project root automatically from `scripts/launchers/` (two levels up). If you move the repository, re-run the install script from the new location.

## Routes

| Shortcut | URL |
|----------|-----|
| IQAI Spatial - Investigation | `http://localhost:3000/spatial/intelligence-lab/` |
| IQAI Spatial - Intelligence | `http://localhost:3000/spatial/` |

## Server

- Port: `3000` (override with `PORT` or `PREVIEW_PORT`)
- Health check: `http://127.0.0.1:3000/health`
- Server log: `%TEMP%\iqai-spatial-server-out.log` and `%TEMP%\iqai-spatial-server.err.log`
- Process lock: `%TEMP%\iqai-spatial-preview.lock`

## Icon

`iqai-spatial.ico` is generated from the official IQAI PNG (`iqai-logo-black-transparent-4000px.png`).
