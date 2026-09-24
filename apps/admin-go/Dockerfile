FROM node:22-alpine AS ui
WORKDIR /source
ARG NPM_REGISTRY=https://registry.npmjs.org
COPY package.json package-lock.json ./
COPY apps/admin-ui/package.json ./apps/admin-ui/
RUN --mount=type=cache,target=/root/.npm npm ci --workspace @codex-switch/admin-ui \
    --ignore-scripts --no-audit --no-fund --registry=$NPM_REGISTRY
COPY apps/admin-ui ./apps/admin-ui
COPY shared ./shared
RUN npm run build --workspace @codex-switch/admin-ui

FROM golang:1.26.8-alpine AS build
WORKDIR /source
ARG GOPROXY=https://proxy.golang.org,direct
ENV CGO_ENABLED=0
COPY apps/admin-go/go.mod apps/admin-go/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/admin-go ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go build -trimpath -ldflags="-s -w" -o /admin-go ./cmd/admin-go

FROM build AS verify
RUN apk add --no-cache gcc musl-dev redis
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    redis-server --bind 127.0.0.1 --port 16389 --save '' --appendonly no --daemonize yes && \
    TELEMETRY_TEST_REDIS=127.0.0.1:16389 CGO_ENABLED=1 go test -race ./... && go vet ./...

FROM scratch AS runtime
WORKDIR /app
ENV NODE_ENV=production LISTEN_PORT=8080
COPY --from=ui /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=ui /source/apps/admin-go/public ./public
COPY --from=build /admin-go /admin-go
EXPOSE 8080 3478/udp
ENTRYPOINT ["/admin-go"]
