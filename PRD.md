# PRD: Containerized URL Shortener Platform (Project 23)

| Field | Value |
|---|---|
| Project | Project 23, DevOps PBL |
| Repository | `SumanthBHegde/DevOps-PBL` (fork of `Sumukha-Rao/DevOps-PBL`) |
| Baseline commit | `093fb2d` "Build containerized URL shortener" (22 Nov 2026) |
| Document status | Draft v3, 27 Nov 2026 (statuses updated from minikube runs before and after the load and rollout fixes; evidence in [STRESS_TEST_RESULTS.md](STRESS_TEST_RESULTS.md)) |
| Overall progress | Stages 0 to 2 done; stages 3 to 8 partly done on `integrate/upstream-k8s` (see [Section 9](#9-stages-and-current-progress)) |

---

## 1. Problem statement

> **Project 23: Containerized URL Shortener Platform**
> Build: Client → API → Database
> - **Docker:** API/database.
> - **Kubernetes:** Scaling and service discovery.
> - **Ansible:** Automated deployment.
> - **Extension:** HPA + Ingress.

Build a URL shortener as a three-tier system. Containerize it, run it on Kubernetes so the API can scale and find the database through service discovery, deploy it with Ansible, and extend it with automatic scaling (HPA) and a single external entry point (Ingress).

## 2. Goals and non-goals

### Goals
1. A working URL shortener: submit a long HTTP/HTTPS URL, get a short link, and have the short link redirect.
2. Every tier runs in containers and is reproducible from the repository alone.
3. The API runs as multiple replicas on Kubernetes and reaches the database by Service DNS name, not by a fixed IP.
4. One Ansible command takes a clean cluster to a running, verified deployment.
5. The API scales out under load (HPA) and is reachable through one hostname (Ingress).
6. Every requirement has an acceptance check that the team can show in a demo.

### Non-goals
- A public internet deployment with real DNS, TLS certificates, or abuse protection.
- User accounts, link analytics dashboards, custom aliases, or link expiry.
- A highly available database cluster (one Postgres replica with persistent storage is enough).
- A managed cloud cluster (EKS/GKE/AKS). A local cluster is the target.

## 3. Stakeholders

| Role | Interest |
|---|---|
| Project team | Build, deploy, and demonstrate the platform |
| PBL evaluators | Check each problem-statement item against a working demo |
| End user (demo persona) | Shorten a URL in the browser and open the short link |

## 4. Architecture

### 4.1 Logical (Client → API → Database)

| Tier | Technology | Responsibility |
|---|---|---|
| Client | React 19 + Vite 7 (served by the API) | Collect a URL, show and copy the short link |
| API | FastAPI + Uvicorn, Python 3.12 | Validate input, generate codes, redirect, report health |
| Database | PostgreSQL 17 | Store `links(code PK, url)` durably |

### 4.2 Target deployment on Kubernetes

```
                 Browser / curl
                       |
             http://short.local
                       |
        +--------------v---------------+
        |  Ingress (ingress-nginx)     |   <- Extension
        +--------------+---------------+
                       |
        +--------------v---------------+
        |  Service: shortener-api      |   <- service discovery (ClusterIP)
        +---+----------+-----------+---+
            |          |           |
        +---v--+   +---v--+    +---v--+
        | API  |   | API  |    | API  |   <- Deployment, 2..6 replicas
        | pod  |   | pod  |    | pod  |      scaled by HPA (Extension)
        +---+--+   +---+--+    +---+--+
            +----------+-----------+
                       |  postgres.shortener.svc.cluster.local:5432
        +--------------v---------------+
        |  Service: postgres (headless)|
        +--------------+---------------+
                       |
        +--------------v---------------+
        |  StatefulSet: postgres (1)   |
        |  + PersistentVolumeClaim     |
        +------------------------------+

   Ansible control node (WSL/Linux) --> builds image, applies all manifests,
                                        waits for rollout, runs smoke tests
```

## 5. Functional requirements

| ID | Requirement | Priority | Status |
|---|---|---|---|
| FR-1 | `POST /api/links` accepts `{"url": "..."}` and returns `201` with `code`, `short_url`, `url` | Must | ✅ Done |
| FR-2 | Only `http`/`https` URLs are accepted; URLs with embedded credentials are rejected with `422` | Must | ✅ Done |
| FR-3 | Codes are 8 random alphanumeric characters from a secure random source; uniqueness is enforced by the database, with retry on collision | Must | ✅ Done |
| FR-4 | `GET /s/{code}` returns `307` to the stored URL, `404` for unknown codes, `422` for malformed codes | Must | ✅ Done |
| FR-5 | `GET /health` returns `200` when the database is reachable, `503` otherwise | Must | ✅ Done |
| FR-6 | The web UI shortens a URL, shows the link, and copies it to the clipboard | Must | ✅ Done (falls back to `execCommand('copy')` on plain HTTP such as the Ingress host) |
| FR-7 | `short_url` uses the external hostname and scheme the client used (for example `http://short.local/s/abc12345`), including behind Ingress | Must | ✅ Done (links created via the Ingress use `http://shortener.test/s/...`) |
| FR-8 | Responses carry an `X-Served-By: <pod name>` header so load balancing across replicas is visible in a demo | Should | ❌ Not started |
| FR-9 | Interactive API docs at `/docs` | Could | ✅ Done |

## 6. Non-functional requirements

| ID | Requirement | Priority | Status |
|---|---|---|---|
| NFR-1 | Containers run as a non-root user | Must | ✅ Done |
| NFR-2 | Dependency and base-image versions are pinned | Must | ✅ Done |
| NFR-3 | Links survive container and pod restarts (persistent volume) | Must | ✅ Compose / ✅ Kubernetes (db pod deleted under load; all links kept) |
| NFR-4 | The API keeps no state, so any replica can serve any request | Must | ✅ Done |
| NFR-5 | Several API replicas can start at once without schema-creation errors | Must | ✅ Done (advisory lock; 0 to 5 replicas with no restarts; startup retries while Postgres is not ready) |
| NFR-6 | The API uses a connection pool so scaling out does not exhaust Postgres's `max_connections` | Must | ✅ Done (`psycopg_pool`, max 10 per pod plus 1 for `/health`; 0 `too many clients` across about 172,000 load-test requests, down from 1620) |
| NFR-7 | Secrets (database password) are not hard-coded in manifests or committed in plain text | Must | ✅ Kubernetes (Ansible generates a random password into a Secret) / ⚠️ Compose uses a dev default |
| NFR-8 | The API answers p95 < 200 ms for redirects at the load-test rate on a local cluster | Should | ❌ Redirect p95 179 ms at 5 VUs; at the ramp rate p95 is 606 to 682 ms for all requests (was 3.2 s), on a 4-CPU minikube shared with k6 |
| NFR-9 | Automated tests run on every push (CI) | Should | ⚠️ Playwright suite in `e2e/` (24 tests; 24 of 24 pass on Compose, 22 pass and 2 Docker-only skipped via Ingress); not yet in CI |

## 7. Platform and DevOps requirements

### 7.1 Docker (API/database)

| ID | Requirement | Acceptance check | Status |
|---|---|---|---|
| DK-1 | Multi-stage Dockerfile builds the frontend and the API image | `docker build .` succeeds | ✅ Done |
| DK-2 | Postgres runs from the official image with a named volume | `docker compose up --build --wait` brings both services up healthy | ✅ Done |
| DK-3 | Both services have health checks; the API waits for the database | `docker compose ps` shows `healthy` for both | ✅ Done |
| DK-4 | Builds work behind a TLS-inspecting proxy | `compose.build-ca.yaml` override builds | ✅ Done |
| DK-5 | The image is tagged and available to the cluster (`kind load` / `minikube image load` or a registry such as GHCR) | `kubectl run` with the image pulls without error | ✅ Done (`minikube image load`; pods start with no pull errors) |

### 7.2 Kubernetes (scaling and service discovery)

| ID | Requirement | Acceptance check | Status |
|---|---|---|---|
| K8-1 | Dedicated namespace `shortener` | `kubectl get ns shortener` | ⚠️ Namespace is `url-shortener` |
| K8-2 | Postgres `StatefulSet` (1 replica) with a `PersistentVolumeClaim` and a headless `Service` | Delete the Postgres pod; after it restarts, old links still resolve | ⚠️ Check passes; implemented as a Deployment (Recreate) + PVC + ClusterIP Service `db`, not a StatefulSet + headless Service |
| K8-3 | Database credentials in a `Secret`; `DATABASE_URL` and other settings in a `ConfigMap` | `kubectl get secret,configmap -n shortener`; no password in Git | ⚠️ Secret `shortener-db` (not in Git); no ConfigMap, `DATABASE_URL` is inline in the Deployment |
| K8-4 | Schema created once by a `Job` (or guarded with an advisory lock), not by every replica | Scale to 5 replicas from zero; no pod crash-loops | ✅ Done (advisory lock) |
| K8-5 | API `Deployment` with at least 2 replicas, readiness and liveness probes on `/health`, CPU/memory requests and limits | `kubectl get deploy` shows `2/2` ready | ⚠️ 2/2 ready; liveness probe is TCP, not `/health`; no CPU/memory limits |
| K8-6 | API `Service` (ClusterIP) load-balances across replicas | Repeated requests show different `X-Served-By` values | ❌ Header not implemented (FR-8) |
| K8-7 | **Service discovery:** the API reaches the database at `postgres.shortener.svc.cluster.local`, with no IPs hard-coded | `kubectl exec` into an API pod and resolve the name; the app connects | ✅ Done via `db` (`db.url-shortener.svc.cluster.local`) |
| K8-8 | **Manual scaling:** `kubectl scale deploy/shortener-api --replicas=4` works with no downtime | Continuous `curl` loop shows no failed requests during scaling | ✅ Done (102 of 102 probe requests OK) |
| K8-9 | Rolling update: a new image tag rolls out with zero failed requests | `kubectl rollout status` succeeds; curl loop clean | ✅ Done (`preStop` delay and uvicorn keep-alive fix; 0 failed requests during a rollout under load) |

### 7.3 Ansible (automated deployment)

| ID | Requirement | Acceptance check | Status |
|---|---|---|---|
| AN-1 | Inventory describing the control node and target cluster | `ansible-inventory -i inventory.ini --list` | ❌ No inventory; runs with `-i localhost,` |
| AN-2 | Role `prereqs`: installs or verifies Docker, kubectl, cluster tool, Python `kubernetes` library | Role runs clean on a fresh WSL/Linux host | ❌ No roles |
| AN-3 | Role `build_image`: builds the image and loads or pushes it to the cluster | Image present in the cluster after the role runs | ❌ Image is built and loaded by hand |
| AN-4 | Role `k8s_deploy`: applies all manifests with `kubernetes.core.k8s` and waits for rollouts | All pods `Ready` at the end of the play | ⚠️ Uses `kubectl apply` via `ansible.builtin.command`, not `kubernetes.core.k8s`; waits for rollouts and all pods are Ready |
| AN-5 | Role `smoke_test`: calls `/health`, creates a link, follows it, checks the redirect target | Play fails if any check fails | ❌ No smoke test |
| AN-6 | **One command** deploys from a clean cluster: `ansible-playbook -i inventory.ini deploy.yml` | Run on an empty cluster ends with `failed=0` | ✅ Done (`changed=3 failed=0`; needs the image loaded first) |
| AN-7 | Idempotent: a second run makes no changes | Second run reports `changed=0` for deploy tasks | ✅ Done |
| AN-8 | Database password supplied via Ansible Vault or an environment variable | No plain-text secret in the repository | ✅ Done (password generated on first deploy, stored only in the cluster Secret) |
| AN-9 | Teardown playbook removes the namespace | `ansible-playbook teardown.yml` leaves no `shortener` resources | ❌ No teardown playbook |

### 7.4 Extension: HPA + Ingress

| ID | Requirement | Acceptance check | Status |
|---|---|---|---|
| EX-1 | metrics-server installed and reporting | `kubectl top pods -n shortener` returns values | ✅ Done |
| EX-2 | `HorizontalPodAutoscaler` on the API: min 2, max 6, target 60% CPU | `kubectl get hpa` shows current/target CPU | ⚠️ Works; configured as min 2, max 8, 65% |
| EX-3 | Load-test script (`hey` or `k6`) against the redirect and create endpoints | Script in `scripts/` runs from one command | ✅ Done (`scripts/loadtest.js`, k6) |
| EX-4 | **Scale-out demo:** under load, replicas grow above 2 within about 2 minutes, then return to 2 after load stops (after the default 5-minute scale-down window) | `kubectl get hpa -w` recording or screenshots | ✅ Ramp: 2 to 8 within about 60 s of load, back to 2 about 6.5 to 7 min after / ⚠️ Spike: HPA lags about 60 s (metrics-server resolution) but requests no longer fail |
| EX-5 | ingress-nginx controller installed | Controller pod `Running` | ✅ Done |
| EX-6 | `Ingress` routes host `short.local` to the API Service | `curl -H 'Host: short.local' http://<ingress-ip>/health` returns `200` | ⚠️ Works with host `shortener.test` |
| EX-7 | Short links created through the Ingress use `http://short.local/s/...` and resolve through the Ingress | Create and follow a link end to end via `short.local` | ✅ Done via `shortener.test` |
| EX-8 | (Optional) Self-signed TLS on the Ingress | `curl -k https://short.local/health` returns `200` | ❌ No `tls` on the Ingress |

## 8. API contract (current, unchanged by this PRD)

| Method and path | Success | Other outcomes |
|---|---|---|
| `GET /` | React app | |
| `POST /api/links` | `201` `{code, short_url, url}` | `422` invalid URL, `503` code allocation exhausted |
| `GET /s/{code}` | `307` with `Location` header | `404` unknown, `422` malformed |
| `GET /health` | `200` `{"status":"ok"}` | `503` database unavailable |
| `GET /docs` | OpenAPI UI | |

## 9. Stages and current progress

| Stage | Scope | Requirements covered | Status |
|---|---|---|---|
| **0. Setup** | Repository, fork, upstream remote, problem-statement mapping | | ✅ Done |
| **1. Application (Client → API → DB)** | React UI, FastAPI endpoints, Postgres schema, input validation | FR-1 to FR-6, FR-9, NFR-4 | ✅ Done |
| **2. Docker** | Multi-stage image, Compose with health checks, persistent volume, proxy CA support | DK-1 to DK-4, NFR-1 to NFR-3 (Compose) | ✅ Done (image built and run in this fork) |
| **3. App hardening for Kubernetes** | `BASE_URL` / `--proxy-headers`, connection pool, move schema creation out of app startup, `X-Served-By` header, `.env.example` (done), E2E tests (done), CI | FR-7, FR-8, NFR-5, NFR-6, NFR-9 | ⏳ In progress (FR-7, NFR-5, NFR-6 done; FR-8, CI open) |
| **4. Kubernetes base** | Namespace, Secret, ConfigMap, Postgres StatefulSet + PVC + headless Service, schema Job, API Deployment + Service, image loading | DK-5, K8-1 to K8-9, NFR-3 (K8s), NFR-7 | ⚠️ Mostly done (K8-6 fails; several items differ from the spec) |
| **5. Ansible automation** | Inventory, roles (prereqs, build_image, k8s_deploy, smoke_test), Vault, teardown | AN-1 to AN-9 | ⚠️ Partly done (one idempotent playbook; no inventory, roles, smoke test or teardown) |
| **6. Extension: HPA + Ingress** | metrics-server, HPA, ingress-nginx, Ingress, load-test script, optional TLS | EX-1 to EX-8 | ⚠️ Mostly done (no TLS) |
| **7. Validation and demo** | Run every acceptance check, capture evidence (screenshots, `kubectl get hpa -w`, Ansible output), measure NFR-8 | All | ⚠️ Full run and post-fix rerun done 27 Nov 2026 ([STRESS_TEST_RESULTS.md](STRESS_TEST_RESULTS.md)) |
| **8. Documentation** | Update README and PROJECT_REPORT with the K8s/Ansible architecture, runbook, and results | | ⚠️ Partly done (covers Docker stage only) |

**Where the project stands:** stages 0 to 2 are done. Branch `integrate/upstream-k8s` adds Kubernetes manifests, a single Ansible playbook, an HPA, an Ingress and a k6 load test; deploying, service discovery, persistence and autoscaling all work on minikube. The load and rollout bugs found in the first stress test are fixed: a connection pool (NFR-6), an async `/health` that does not wait behind requests, a startup retry, a `preStop` delay and a uvicorn keep-alive fix (K8-9), and a clipboard fallback for HTTP (FR-6). The ramp load test now runs at about 200 req/s with 0 failed requests. Still open: the Ansible structure (AN-1 to AN-3, AN-5, AN-9), FR-8 (`X-Served-By`), TLS (EX-8), CI, and the naming and structure differences from this PRD.

### Problem statement coverage

| Problem-statement item | Stage | Status |
|---|---|---|
| Client → API → Database | 1 | ✅ |
| Docker: API/database | 2 | ✅ |
| Kubernetes: scaling and service discovery | 3, 4 | ✅ Works, including under load (K8-6 `X-Served-By` still missing) |
| Ansible: automated deployment | 5 | ⚠️ One-command deploy works; roles, smoke test, teardown missing |
| Extension: HPA + Ingress | 6 | ⚠️ Works; no TLS |

## 10. Planned repository layout

```
app.py, Dockerfile, compose.yaml, frontend/     (existing)
k8s/
  namespace.yaml
  postgres-secret.example.yaml
  postgres-statefulset.yaml
  postgres-service.yaml
  app-configmap.yaml
  db-init-job.yaml
  app-deployment.yaml
  app-service.yaml
  hpa.yaml
  ingress.yaml
ansible/
  inventory.ini
  deploy.yml
  teardown.yml
  group_vars/all/vault.yml          (Ansible Vault encrypted)
  roles/prereqs/  roles/build_image/  roles/k8s_deploy/  roles/smoke_test/
scripts/
  loadtest.sh
tests/
  test_api.py
```

## 11. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Several replicas run `CREATE TABLE IF NOT EXISTS` at once and fail | Pods crash-loop on scale-up | Schema `Job` or `pg_advisory_lock` (stage 3) |
| One database connection per request | Postgres connection limit hit during HPA load test (confirmed 27 Nov 2026) | ✅ Mitigated: `psycopg_pool`, max 10 per pod |
| Readiness probe shares the request thread pool and opens a DB connection | Under load every pod goes unready and the Ingress returns 503 | ✅ Mitigated: async `/health` with its own connection |
| No `preStop` delay on API pods | Rolling updates and scale-in drop a few requests (502) | ✅ Mitigated: `preStop` sleep 5 s, uvicorn keep-alive 75 s |
| Clipboard API needs a secure origin | Copy button fails on `http://<ingress host>` | ✅ Mitigated: `execCommand('copy')` fallback |
| metrics-server resolution is 60 s on minikube | HPA reacts too late to short spikes | Lower `--metric-resolution` (command in README), or demo with the ramp profile |
| Short links built from the internal host or `http` behind Ingress | Broken links in the demo | `BASE_URL` setting or `--proxy-headers` (stage 3) |
| Ansible control node does not run natively on Windows | Team members on Windows cannot run the playbook | Use WSL2 Ubuntu as the control node |
| Load test does not reach the CPU target on a fast machine | HPA never scales, so the extension cannot be shown | Lower CPU requests or target, tune load-test concurrency |
| metrics-server certificate errors on local clusters | HPA shows `<unknown>` | Install with `--kubelet-insecure-tls` on kind/minikube |
| Upstream repository changes after the fork | Merge conflicts | Pull `upstream/main` before each stage |

## 12. Open questions

1. **Target cluster:** minikube, kind, k3s, or Docker Desktop Kubernetes? (This affects image loading, Ingress setup, and the Ansible `prereqs` role.) The branch currently targets minikube.
2. **Image delivery:** load images into a local cluster, or push to GHCR?
3. **Team split:** who owns stages 3 to 7, and does work land on the fork or upstream?
4. **Is CI (GitHub Actions) in scope** for evaluation, or a stretch goal?
5. **Is TLS on the Ingress (EX-8) expected**, or is HTTP enough?
6. **Evaluation date**, so stages 3 to 8 can be scheduled.

## 13. Demo checklist (definition of done)

- [ ] `ansible-playbook -i ansible/inventory.ini ansible/deploy.yml` deploys from an empty cluster with `failed=0`
- [x] Re-running the playbook reports no changes
- [ ] `http://short.local` serves the UI; a link created there resolves through the Ingress
- [x] `kubectl get pods -n shortener` shows 2+ API pods and 1 Postgres pod, all `Ready` (namespace `url-shortener`)
- [x] API pod resolves and connects to `postgres.shortener.svc.cluster.local` (as `db.url-shortener.svc.cluster.local`)
- [ ] `X-Served-By` changes across repeated requests (load balancing)
- [x] Load test makes the HPA scale out, and it scales back after load stops (ramp profile)
- [x] Deleting the Postgres pod keeps existing links (persistent volume)
- [x] Rolling update to a new image tag with zero failed requests
- [ ] README and PROJECT_REPORT updated with the runbook and evidence
