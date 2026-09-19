FROM golang:1.27.1-alpine AS build

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /valence .

FROM alpine:3.21

RUN adduser -D -u 10001 valence

WORKDIR /app

COPY --from=build /valence ./valence
COPY --from=build /src/apps ./apps

USER valence

EXPOSE 8080

CMD ["./valence"]
