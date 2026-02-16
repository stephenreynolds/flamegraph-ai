# flamegraph-ai

TypeScript monorepo MVP bootstrap for flamegraph analysis.

## Stack

- `apps/web`: Next.js 15 upload UI
- `apps/api`: Fastify API + Prisma (Postgres)
- `packages/shared`: shared TypeScript types/constants
- Postgres via Docker Compose (`docker-compose.yml`)

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy env files:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

3. Start infrastructure (Postgres):

```bash
pnpm infra:up
```

4. Generate Prisma client and run a migration:

```bash
pnpm --filter @flamegraph-ai/api prisma:generate
pnpm --filter @flamegraph-ai/api prisma:migrate
```

5. Run web + api in dev mode:

```bash
pnpm dev
```

- Web: `http://localhost:3000`
- API health: `http://localhost:3001/health`
- API analyze: `POST http://localhost:3001/api/analyze`

## API contract

`POST /api/analyze`

- Content type: `multipart/form-data`
- File field: first uploaded file (expected Speedscope `.json`)
- Response: structured mock analysis including:
  - `hotspots`
  - `recommendations.quickWins`
  - `recommendations.deepRefactors`

## Scripts

Root scripts:

- `pnpm dev`: starts all workspace dev servers via Turbo
- `pnpm infra:up`: runs `docker compose up -d`
- `pnpm infra:down`: runs `docker compose down`
- `pnpm build`, `pnpm typecheck`, `pnpm lint`

## Notes

- TypeScript strict mode is enabled across the monorepo.
- `pgadmin` is included as an optional Compose profile:

```bash
docker compose --profile pgadmin up -d
```
