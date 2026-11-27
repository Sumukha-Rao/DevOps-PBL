# URL Shortener

A React web interface and FastAPI REST API that turn HTTP and HTTPS destinations into short links. PostgreSQL stores the links in a Docker volume.

## Run locally

Install Docker Engine or Docker Desktop with Docker Compose v2. From the repository root, run:

```sh
docker compose up --build --wait
```

Open `http://localhost:8000` to create a link, or visit `http://localhost:8000/docs` for the interactive API documentation. Set `APP_PORT` if port 8000 is already in use.

```sh
curl -fsS http://localhost:8000/health
curl -fsS -X POST http://localhost:8000/api/links \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/guide"}'
```

Use the returned `short_url` in a browser, or pass it to `curl -i` to inspect the redirect. The link uses the host from the creation request. A link created through localhost works on that machine.

Stop the services with `docker compose down`. PostgreSQL data persists in the named volume. The Compose configuration binds the app to loopback and uses a development database password by default. Set `POSTGRES_PASSWORD` before initializing a new volume to override it.

See [PROJECT_REPORT.md](PROJECT_REPORT.md) for the architecture, API contract, and validation results.

## Run the end-to-end tests

The Playwright suite in `e2e/` tests the running stack through the browser and the REST API. Start the stack first, then:

```sh
cd e2e
npm ci
npx playwright install chromium
npm test              # UI and API tests
npm run test:docker   # also recreates containers and stops the database
```

Set `BASE_URL` to test a different address (default `http://localhost:8000`). `npm run test:docker` runs `docker compose` against this repository's stack, so use it locally only. `npm run report` opens the HTML report.

### Build behind a TLS-inspecting proxy

If the package registries use your organization's trusted proxy certificate, pass the system CA bundle to the build:

```sh
BUILD_CA_BUNDLE=/etc/ssl/certs/ca-certificates.crt \
  docker compose -f compose.yaml -f compose.build-ca.yaml up --build --wait
```

The override mounts the bundle during dependency installation so npm and pip can verify TLS.

## Deploy Project 23 to Kubernetes with Ansible

Run the following commands from the repository root. The deployment needs a Kubernetes context with namespace and workload creation permissions, a default StorageClass that supports ReadWriteOnce volumes, Metrics Server for CPU autoscaling, and an Ingress controller. Install `ansible-core` and `kubectl` on the machine running the playbook.

For a local Minikube cluster, prepare the add-ons and load the API image into the cluster:

```sh
minikube start
minikube addons enable storage-provisioner
minikube addons enable default-storageclass
minikube addons enable metrics-server
minikube addons enable ingress
docker build -t url-shortener:project23 .
minikube image load url-shortener:project23
ansible-playbook -i localhost, ansible/deploy.yml \
  -e kube_context=minikube -e app_image=url-shortener:project23
```

Behind a TLS-inspecting proxy, add `--secret id=build_ca_bundle,src=/etc/ssl/certs/ca-certificates.crt` to the Docker build. For another cluster, supply its context and an application image accessible to every worker. Use a new image tag for each release. Override `ingress_class` and `ingress_host` to match the controller and DNS name. The defaults are `nginx` and `shortener.test`.

Ansible creates the `url-shortener` namespace, initializes the database password on the first deployment, applies the workloads and waits for rollouts. Keep the `shortener-db` Secret with its database volume across deployments. The API discovers PostgreSQL through the internal `db` Service. Ingress forwards the web client, API and redirect requests to the `shortener-api` Service.

### Verify the deployment

```sh
kubectl --context minikube -n url-shortener get deploy,svc,pvc,ingress,hpa
kubectl --context minikube -n url-shortener top pods
```

Point `shortener.test` at the reachable Ingress controller address, then open `http://shortener.test`. Alternatively, test routing with the controller IP and a host header:

```sh
curl -fsS -H 'Host: shortener.test' "http://${INGRESS_IP}/health"
curl -fsS -H 'Host: shortener.test' -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/project23"}' "http://${INGRESS_IP}/api/links"
```

Set `INGRESS_IP` to the reachable controller IP before running these commands. Request the returned short link and check for HTTP 307 and the original destination in the `Location` header. For direct Service access, run `kubectl --context minikube -n url-shortener port-forward svc/shortener-api 8080:80` and open `http://localhost:8080`.

The HPA targets 65% average CPU utilization relative to each API pod's 100m CPU request. It scales the API between two and eight replicas. Run `kubectl --context minikube -n url-shortener get hpa -w` to observe utilization and replica counts during traffic. PostgreSQL uses a single replica and retains its data on a 1 GiB claim.

Each API pod keeps a pool of at most 10 database connections (`DB_POOL_MAX`) plus one for `/health`, so eight replicas stay under PostgreSQL's default limit of 100 connections. Lower `DB_POOL_MAX` if you raise `maxReplicas`.

Minikube's Metrics Server reports CPU every 60 seconds, so the HPA reacts about a minute after load starts and misses short spikes. For a faster demo, lower the resolution to 15 seconds:

```sh
kubectl --context minikube -n kube-system patch deployment metrics-server --type=json -p "[{\"op\":\"replace\",\"path\":\"/spec/template/spec/containers/0/args\",\"value\":$(kubectl --context minikube -n kube-system get deploy metrics-server -o jsonpath='{.spec.template.spec.containers[0].args}' | sed 's/--metric-resolution=60s/--metric-resolution=15s/')}]"
```
