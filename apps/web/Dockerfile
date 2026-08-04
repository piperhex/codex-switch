FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
COPY apps/web/package*.json ./apps/web/
RUN npm ci

FROM deps AS build
ARG VITE_WEB_BASE_PATH=/web/
ARG VITE_API_BASE_URL=
ENV VITE_WEB_BASE_PATH=${VITE_WEB_BASE_PATH}
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY apps/web ./apps/web
RUN npm run build -w @codex-switch/web

FROM nginx:1.27-alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1
