# Project 23 | Containerized URL Shortener Platform

## Objective

Build a web application that turns a long HTTP or HTTPS URL into a compact link. Develop locally with Docker Compose and deploy to Kubernetes with Ansible. Each API replica should resolve the same links, and the database should preserve them when containers are replaced.

## Architecture

| Component | Responsibility |
| --- | --- |
| React and Vite | Collect a destination URL, show the resulting short link, and copy it to the clipboard |
| FastAPI and Uvicorn | Serve the built frontend, validate requests, generate link codes, and issue redirects |
| PostgreSQL 17 | Store each code and destination in the `links` table |
| Docker Compose | Build the application image, start both services, and attach persistent storage |
| Kubernetes Services | Give the database a stable DNS name and distribute client traffic to ready API pods |
| Horizontal Pod Autoscaler | Adjust the API replica count between two and eight using CPU utilization from Metrics Server |
| Ingress | Route the configured hostname and all application paths to the API Service |
| Ansible | Create the namespace and database Secret, apply Kubernetes resources, and wait for rollouts |

A multi-stage Docker build compiles the React bundle with Node.js and copies it into the Python image. FastAPI serves the bundle and API on the same origin. Compose connects the API and database over its internal network and waits for PostgreSQL before starting the API. PostgreSQL stores its data in the `pgdata` named volume.

## Request flow

1. React sends a JSON destination to `POST /api/links`.
2. FastAPI validates the URL and generates an eight-character alphanumeric code with Python's `secrets` module.
3. PostgreSQL enforces uniqueness through the code's primary key. The API retries a code collision before returning an error.
4. The browser displays the returned short link. Requests to that link look up its code and receive an HTTP redirect to the stored destination.

| Method and path | Successful result | Other outcomes |
| --- | --- | --- |
| `GET /` | React application | |
| `POST /api/links` | `201` with the code, short URL, and destination | `422` for invalid destinations, `503` if code allocation is exhausted or the database is unreachable |
| `GET /s/{code}` | `307` with the destination in the `Location` header | `404` for unknown codes, `422` for malformed codes, `503` if the database is unreachable |
| `GET /health` | `200` when the app can query its table | `503` when the database query fails |

## Deployment scope

Docker Compose supports local development. On Kubernetes the browser reaches the React client through Ingress. The client calls the same origin, and FastAPI connects to PostgreSQL using Service DNS. Every API pod reads and writes the same link table. A PostgreSQL transaction-level advisory lock serializes schema initialization when pods start together.

The database deployment uses the Recreate strategy and a persistent volume claim. This lets a replacement database pod reuse the data, with downtime during replacement. The HPA scales only the stateless API tier. Ansible reuses the existing database credential on subsequent runs.

The example Ingress serves HTTP. Anyone who can reach the service can create a short link. A public deployment would need a public origin, HTTPS, and measures to handle abuse. The application stores link mappings only.

## Validation results

Verified in the Codex cloud environment with Docker Compose v2.

| Check | Result |
| --- | --- |
| Build the React bundle and application image | Passed |
| Start PostgreSQL and the app and wait for both health checks | Passed |
| Create a link in Chromium, copy it, and check its redirect | Passed |
| Create a link through the REST API and verify the exact redirect destination | Passed |
| Reject unsupported URL schemes and embedded credentials | Passed |
| Return the documented status for unknown and malformed codes | Passed |
| Recreate both containers and resolve a previously created link using the retained volume | Passed |

The cloud build used the system CA bundle so dependency downloads could pass TLS verification through the network proxy.

### Kubernetes and Ansible checks

Ansible applied the namespace, Secret, claim, two Deployments, two Services, HPA and Ingress to a temporary Kubernetes 1.35 API server. A second deployment reported zero changes. After manually setting the API deployment to four replicas, another deployment preserved that count, allowing the HPA to own the scale setting.

The updated Compose application passed HTTP checks for link creation, validation and redirects. A second API container connected to the same PostgreSQL service and returned the correct redirect for a link created through the first container.

The Kubernetes test used an API server without worker nodes or add-on controllers. Pod rollout, storage provisioning, Ingress traffic and CPU-driven scaling still require verification on a cluster with those components. The README includes deployment and verification commands.
