FROM node:24-alpine AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN --mount=type=cache,target=/pnpm/store \
    corepack pnpm install --frozen-lockfile --store-dir /pnpm/store --network-concurrency=8 --fetch-retries=4
COPY . .
ARG VITE_MAP_TILES
ARG VITE_SATELLITE_TILES
ARG VITE_SATELLITE_ATTRIBUTION
ARG VITE_SATELLITE_LICENSE_URL
ARG VITE_SATELLITE_MAX_ZOOM
ARG VITE_SATELLITE_DIGITIZATION_AUTHORIZED
ENV VITE_API_URL=/
RUN corepack pnpm build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist/ /usr/share/nginx/html/
