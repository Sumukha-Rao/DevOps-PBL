FROM node:22-bookworm-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=secret,id=build_ca_bundle \
    if [ -r /run/secrets/build_ca_bundle ]; then \
        export NODE_EXTRA_CA_CERTS=/run/secrets/build_ca_bundle; \
    fi; \
    npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim-bookworm
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt .
RUN --mount=type=secret,id=build_ca_bundle \
    if [ -r /run/secrets/build_ca_bundle ]; then \
        export PIP_CERT=/run/secrets/build_ca_bundle; \
    fi; \
    pip install --no-cache-dir -r requirements.txt
COPY --chmod=644 app.py .
COPY --from=frontend /build/dist ./dist
USER 10001:10001
EXPOSE 8000
# Keep idle connections open longer than ingress-nginx's 60 s upstream keepalive,
# so the proxy never reuses a connection that uvicorn has just closed.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--timeout-keep-alive", "75"]
