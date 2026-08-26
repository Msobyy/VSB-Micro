# 0001: Monorepo over polyrepo

## Status
Accepted (2026-08-26)

## Context
Starting a microservices rebuild from scratch means deciding up front how
service code is split across repos, since it's expensive to change later.

## Decision
All services and shared libraries live in one repo (`vsb-microservices`),
as pnpm workspaces (`services/*`, `libs/*`), orchestrated with Turborepo.

## Consequences
- Shared code (`libs/config`, `libs/event-schemas`, `libs/event-bus`, etc.)
  is a normal workspace dependency (`workspace:*`) — no publishing a
  private npm package just to share a config loader.
- Cross-service changes (e.g. adding a field to an event schema and
  updating both the producer and every consumer) land in one PR.
- Single CI to start, single root `package.json` for shared tooling
  (vitest, turbo).
- Trade-off accepted: less repo-level isolation than polyrepo — anyone with
  repo access can see every service's code. Revisit only if/when separate
  teams own separate services and need independent access control or
  release cadences.
