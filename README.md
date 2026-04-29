# langdle

Daily semantic word game (SvelteKit + Drizzle + PostgreSQL).

## Stack

- Runtime app/API: SvelteKit (`@sveltejs/adapter-node`)
- ORM: Drizzle
- Database: PostgreSQL (local via `compose.yaml`)
- Planned pipeline: Python + sentence-transformers (LaBSE) as a scheduled one-shot job

## Local setup

1. Install dependencies:

```sh
npm install
```

2. Ensure `.env` exists (already prepared in this repo; otherwise copy from `.env.example`).

```sh
copy .env.example .env
```

3. Start Postgres:

```sh
npm run db:start
```

4. Push schema:

```sh
npm run db:push
```

5. Start dev server:

```sh
npm run dev -- --open
```

## Database model (MVP foundation)

Current schema includes:

- `vocabulary` (allowed German guess lemmas)
- `languages` (language metadata for bonus phase)
- `countries` (country metadata for bonus phase)
- `puzzles` (daily puzzle + precomputed semantic snapshot JSON)
- `puzzle_countries` (all valid country answers per puzzle)
- `guesses` (optional ranking/similarity telemetry groundwork)

## First API endpoint

- `GET /api/puzzle/today` returns the current day puzzle and bonus metadata
- Returns `404` when no puzzle exists yet for the current UTC day

## Next milestones

- Seed curated MVP vocabulary and first 30 puzzle rows
- Add Python embedding pipeline and daily job container
- Build D3 wordcloud gameplay loop and reveal interaction
