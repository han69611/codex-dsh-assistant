# Online updater

No public release feed is bundled. A maintainer must host an HTTPS manifest and ZIP first. Configuring a feed trusts its owner to distribute executable plugin code. SHA256 verifies package bytes against that feed; it does not authenticate a compromised feed independently.

Manifest JSON:

```json
{"name":"codex-dsh-assistant","version":"0.9.0","archiveUrl":"https://YOUR-HOST/package.zip","sha256":"64 hexadecimal SHA256 characters"}
```

The ZIP contains plugin files directly or in one enclosing directory. Only stored/deflated ZIP entries are supported; encrypted, ZIP64, symlinks, duplicate paths, Windows device names and path traversal are rejected. Downloads are limited to 32 MiB and extracted files to 128 MiB total (32 MiB per file). A manifest is limited to 64 KiB. HTTPS redirects are rejected.

Run from `skills/dsh-assistant/scripts`:

```text
node update.mjs configure https://YOUR-HOST/manifest.json
node update.mjs check
node update.mjs apply
node update.mjs configure https://YOUR-HOST/manifest.json --auto-apply --interval-hours=24
```

Configuration resides in the assistant state directory as `update.json`. Automatic checks run only when the caller invokes exported `autoUpdate(root)` on an explicitly authorized execution. They do not run a background service, invoke models or publish files. Default configuration checks only; `--auto-apply` explicitly opts into installation when due and idle. Reconfigure without that flag to disable automatic application. Remove `update.json` to disable the feed entirely. Check attempts are throttled by `update-last.json`, including failures.

`applyUpdate(root)` acquires `update.lock`, `active.lock`, `pump.lock`, and `engine.lock`, and refuses active worker locks or running/unresolved cancellation jobs. Call before opening execution locks. Locks left after a crash intentionally block installation until inspected. Install uses the current reviewed `Install-Codex.ps1` copied into the verified staging directory; that existing installer performs staging, registration and rollback attempts. A restart/reload of Codex may be needed to load a new plugin version.

Testing uses injected fetch and installer functions, without network, publication or local plugin installation:

```text
node --test tests/update.test.mjs
```
