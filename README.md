# Valence

## Requirements

Go 1.27.1 or newer.

## Build and run

```sh
go build ./...
go run .            # serves on :8080, or $PORT if set
```

## Docker

```sh
docker build -t valence .
docker run -p 8080:8080 valence
```

## Test

```sh
go test ./...
```
