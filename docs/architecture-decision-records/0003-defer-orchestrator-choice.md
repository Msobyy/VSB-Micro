# 0003: Defer container orchestrator choice

## Status
Accepted (2026-08-26)

## Context
`vsb-backend` already runs on AWS ECS/Fargate in production. A full
microservices fleet could stay on ECS (with Service Connect for
service-to-service networking) or move to Kubernetes (EKS) for more
powerful fleet-management primitives at the cost of real operational
complexity.

## Decision
Don't decide yet. Every service is a plain Docker container with its own
`Dockerfile`; local dev runs everything via
`infra/docker-compose.dev.yaml`. No ECS task definitions or Kubernetes
manifests exist in this repo.

## Consequences
- Nothing in `services/*` assumes a specific orchestrator — no
  orchestrator-specific env var injection beyond what `libs/config`
  already abstracts (Docker secret file / K8s ConfigMap file / env var
  fallback chain), and no orchestrator-specific health/readiness probe
  format beyond the plain `GET /health` every service exposes.
- This decision has to be revisited before any real production deployment
  of these services — `infra/` will need either ECS task definitions or
  Kubernetes manifests added at that point, informed by how big the
  service fleet has actually grown and who's operating it.
