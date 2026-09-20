# syntax=docker/dockerfile:1

# ---- frontend build -----------------------------------------------------------
# Each app with a package.json is built here. Output lands in apps/<name>/dist,
# which is the static root app.yaml points at. dist/ and node_modules/ are
# dockerignored, so anything a Go stage sees under apps/ is source only.
FROM node:22-alpine AS frontend

WORKDIR /src

# Copy only manifests first so `npm ci` is cached independently of source edits.
# A bare `COPY apps ./apps` here would invalidate the install on every code change.
COPY apps ./apps

RUN set -eu; \
    for app in apps/*/; do \
      [ -f "$app/package.json" ] || continue; \
      echo "building $app"; \
      ( cd "$app" && npm ci --no-audit --no-fund && npm run build ); \
    done

# The runtime image needs only each app's dist/. .dockerignore filters the build
# context, not files a stage creates, so node_modules would otherwise ride along
# (~42MB per app of build tooling to serve a few hundred KB of output). Prune
# here, in the stage that created them.
RUN set -eu; \
    for app in apps/*/; do \
      [ -d "$app" ] || continue; \
      rm -rf "$app/node_modules" "$app/src" "$app/.vite"; \
      rm -f "$app/package.json" "$app/package-lock.json" "$app/vite.config.js"; \
    done


# ---- go build -----------------------------------------------------------------
FROM golang:1.27.1-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

# Only what the Go build actually reads. A bare `COPY . .` would re-introduce the
# frontend sources and node_modules that the frontend stage just pruned, since
# .dockerignore filters the build context but not a prior stage's output.
COPY *.go ./
COPY web ./web

# Bring in the built frontend. On its own line so edits to Go code do not
# rebuild the Node stage.
COPY --from=frontend /src/apps ./apps

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /valence .


# ---- runtime ------------------------------------------------------------------
FROM alpine:3.21

RUN adduser -D -u 10001 valence

WORKDIR /app

COPY --from=build /valence ./valence
COPY --from=build /src/apps ./apps

USER valence

EXPOSE 8080

CMD ["./valence"]
