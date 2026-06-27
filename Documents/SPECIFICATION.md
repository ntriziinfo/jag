# Rising JAG Specification

This repository is the Rising JAG slot prototype.

## Entry Points

- `jag.html`: main slot screen
- `index.html`: redirect entry that opens `jag.html`
- `admin.html`: local admin screen
- `server.js`: local preview and sync server

## Naming

Use `jag` for filenames, storage keys, scripts, documentation, and GitHub repository references.

## Current Direction

- A-type slot prototype.
- Three visible reel rows.
- Active lines include horizontal and diagonal lines.
- Main bonus types are BIG and REG.
- Visual design is moving toward a Juggler-style cabinet with the Rising logo.

## Local Preview

Start the local server from this folder:

```powershell
node server.js
```

Open:

```text
http://localhost:8787/jag.html
```

## GitHub

Save work in this `jag` repository and push to:

```text
https://github.com/ntriziinfo/jag
```
