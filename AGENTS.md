# AGENTS.md

## What this is

Valence is a single static-file host for multiple frontend apps. `main.go` scans
`apps/` for subdirectories containing an `app.yaml` and mounts each app's static
root at `/apps/<namespace><path>`. No database, no build step, no framework.

It is designed to run on a Fly.io instance with 2 CPUs and 512 MB of RAM. Keep
the footprint small: avoid unbounded in-memory buffering, per-request
allocation-heavy paths, and background workers that scale with app count. A few
hundred megabytes is the whole budget, not a starting point. (The server idles
around 5 MB; the budget is for the apps it hosts and whatever else shares the
machine.)

## Commands

```sh
go build ./...
go run .            # serves on :8080, or $PORT if set
go run . -check     # validate app configs, exit non-zero on error
go vet ./...
go test ./...
docker build -t valence .
docker run -p 8080:8080 valence
```

`go run . -check` plus `go vet ./...` is what CI runs (`.github/workflows/ci.yml`).
Run both before considering a change done.

## Layout

- `main.go` — everything: config loading, validation, routing, SPA fallback,
  plus the dashboard.
- `web/index.html` — static shell for `/`, embedded via `go:embed`.
- `web/404.html` — static 404 page for unknown mounts, also embedded.
- `web/robots.txt` — embedded, served at `/robots.txt`.
- `Dockerfile` — multi-stage, static binary, runs as non-root on Alpine.
- `fly.toml` — Fly.io config: 2 shared CPUs, 512 MB, port 8080.

- `apps/<name>/app.yaml` — per-app config.
- `apps/<name>/<static root>` — the files to serve (default root: `dist`).

## Deploying

Pushing to `main` deploys automatically via `.github/workflows/deploy.yml`, which
runs `flyctl deploy --ha=false`, asserts exactly one machine, and smoke-tests the
live site. The flag is hardcoded there so it cannot be forgotten.

To deploy by hand:

```sh
fly deploy --ha=false
```

`--ha=false` matters: a bare `fly deploy` adds a second machine for zero-downtime
releases, doubling the footprint to 1 GB. This host is meant to run one machine.
Confirm afterwards with `fly machine list`.

`min_machines_running = 0` in `fly.toml` does **not** prevent this; the second
machine comes from Fly's HA default at deploy time. Neither setting can force a
single machine, which is why the workflow verifies the count after deploying.

The workflow needs a `FLY_API_TOKEN` repo secret, created with
`fly tokens create deploy -a valence-v1`. Pass the token through verbatim —
`FlyV1 <macaroon>` contains a space, and stripping it corrupts the token.

## Master endpoints

The Go server owns `/` and matches it before any app, so an entry in `apps/`
cannot shadow it.

`GET /` renders the registry server-side. The shell is a static file containing
markers replaced per request:

- `<!--count-->` — number of mounted apps.
- `<!--apps-->` — one `<tr>` per app, built by `Router.appRows`.

No JavaScript, no JSON, no template engine. Values are escaped with
`html.EscapeString`. Because the shell is `go:embed`-ed, rebuild after editing
it.

The dashboard sends `X-Robots-Tag: noindex, nofollow` and `/robots.txt`
disallows it, since it lists every mount. This deters crawlers only — it is not
access control, and the mounts are still discoverable by anyone who loads an app
or reads a 404. Do not treat it as a security boundary.

`web/404.html` is static and takes no markers: just `404` and the Valence name.
Any path matching no app returns it with a real 404 status. It is deliberately
minimal; anything finer-grained is the app's job. An app wanting custom 404s
should set `spa: true` and route in its own namespace.

## app.yaml

```yaml
namespace: test      # optional; defaults to the directory name
path: /              # optional; subpath appended under /apps/<namespace>
static:
  root: .            # optional; defaults to dist, must stay inside the app dir
  spa: false         # true = serve index.html for unknown paths
```

Unknown fields are rejected (`KnownFields(true)`), so config typos are errors.

## Conventions

- Config errors are collected, not fatal: `loadApps` returns `([]App, []error)`.
  Startup logs all errors and still starts, unless `-check` was passed.
- Validation lives in `AppConfig.validate`; namespace allows `[A-Za-z0-9._-]`,
  path must be empty, `/`, or start with `/` and contain no `..`.
- Never let a resolved static root escape its app directory — the existing
  `filepath.Rel` guard in `loadApp` does this; keep it if you refactor.
- `guardFiles` wraps every app handler and blocks `app.yaml`, dotfiles, and
  directory listings. `http.FileServer` does none of this on its own, so an app
  whose root is `.` would otherwise publish its own config. `.well-known` is
  exempted deliberately (ACME/OIDC).
- `guardFiles` must stay *inside* `http.StripPrefix` in the handler chain so it
  sees the app-relative path. Reversing them breaks the listing check silently.
- Namespaces are capped at 64 characters. Without a cap, a long namespace is
  logged at startup and repeated in every dashboard response, which matters on
  a shared 512 MB instance.
- Duplicate mount points are a reported error, not an override.
- Namespace-level 404s belong to the app: set `spa: true` and let it route. The
  router only 404s paths matching no mounted app at all.
- Vanilla Go stdlib only, aside from `gopkg.in/yaml.v3`. Prefer stdlib over new
  dependencies.
- Add complexity only when it is needed. The dashboard is server-rendered,
  JS-free, and has no JSON API because nothing required one.
- No rate limiting. Fly has no platform-level equivalent, so a single noisy
  client can saturate the CPUs. Known gap, not an oversight.
