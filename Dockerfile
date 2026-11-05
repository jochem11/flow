# The Flow server with the web version, in one image:
#   docker build -t flow .        (or: docker compose up)
# Settings come from environment variables; see server/src/config.rs and docker-compose.yml.

# 1. The web version (the same frontend as the desktop app)
FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.node.json ./
COPY public ./public
COPY src ./src
# production (default) or development: which .env.<mode> the frontend gets
ARG MODE=production
COPY .env.production .env.development ./
RUN npx vite build --mode "$MODE"

# 2. The server. The desktop app is part of the same Cargo workspace; it is
#    not built here, but Cargo needs its manifest to read the workspace.
FROM rust:1.94-slim AS server
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY fixtures ./fixtures
COPY server ./server
COPY src-tauri/Cargo.toml src-tauri/build.rs ./src-tauri/
RUN mkdir -p src-tauri/src && echo "fn main() {}" > src-tauri/src/main.rs && touch src-tauri/src/lib.rs
RUN cargo build --release -p flow-server

# 3. Just what runs: the server binary and the web build (and fonts for PNG export)
# The same Debian as the rust image (the binary needs its glibc)
FROM debian:trixie-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*
COPY --from=server /app/target/release/flow-server /usr/local/bin/flow-server
COPY --from=web /app/dist /srv/web
ENV WEB_DIR=/srv/web \
    BIND=0.0.0.0:8080
EXPOSE 8080
CMD ["flow-server"]
