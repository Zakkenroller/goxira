# KataGo HTTP wrapper — container image for scale-to-zero platforms (Cloud Run,
# Fly.io) or any Docker host. The KataGo binary and neural net are baked in at
# build time so a cold start loads from local disk and never downloads anything.
#
# Versions mirror katago-service/setup.sh (the VPS installer) — keep them in sync.
#
# Build:  docker build -t katago-service katago-service/
# Run:    docker run -p 8080:8080 -e KATAGO_TOKEN=secret katago-service
# Verify: curl localhost:8080/health/ready   (200 once the engine has loaded)

# ── Stage 1: fetch the KataGo binary + model ──────────────────────────────
FROM debian:bookworm-slim AS fetch

# CPU-only "eigen" build — portable across any x64 host (no GPU, no AVX
# requirement). Bump these together with setup.sh when upgrading KataGo.
ARG KATAGO_VERSION=v1.15.3
ARG KATAGO_ZIP=katago-v1.15.3-eigen-linux-x64.zip
ARG MODEL_URL=https://media.katagotraining.org/uploaded/networks/models/kata1/kata1-b15c192-s1672170752-d466197073.bin.gz

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN curl -fsSL "https://github.com/lightvector/KataGo/releases/download/${KATAGO_VERSION}/${KATAGO_ZIP}" -o katago.zip \
 && unzip -q katago.zip -d extracted \
 && find extracted -name katago -type f -exec cp {} /build/katago \; \
 && chmod +x /build/katago \
 && curl -fsSL "${MODEL_URL}" -o /build/model.bin.gz

# ── Stage 2: runtime ──────────────────────────────────────────────────────
FROM node:20-slim

# libgomp1 = OpenMP runtime the eigen build links against; zlib1g reads the
# gzipped model. Everything else the binary needs ships in node:20-slim.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgomp1 zlib1g ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=fetch /build/katago         /usr/local/bin/katago
COPY --from=fetch /build/model.bin.gz   /opt/katago/model.bin.gz
COPY analysis.cfg                        /opt/katago/analysis.cfg
COPY package.json server.js             /app/

# server.js reads these; PORT is overridden by Cloud Run at runtime (to 8080).
# BIND_HOST=0.0.0.0 is required so the platform can reach the container — the
# bearer token (KATAGO_TOKEN) is the access control, not the bind address.
ENV KATAGO_BINARY=/usr/local/bin/katago \
    KATAGO_MODEL=/opt/katago/model.bin.gz \
    KATAGO_CONFIG=/opt/katago/analysis.cfg \
    BIND_HOST=0.0.0.0 \
    PORT=8080

EXPOSE 8080
CMD ["node", "server.js"]
