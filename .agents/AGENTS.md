# LinkedIn Job Alert Project Guidelines

This project is a lightweight, serverless LinkedIn job alert pipeline deployable on Vercel's free Hobby plan.

## Project Structure
- `api/index.ts`: The Vercel serverless entry point that hosts the Express API endpoints (`/api/trigger`, `/api/check-alerts`, etc.).
- `src/utils/backend.ts`: Coordinates Redis state, Bright Data dataset requests, and Telegram notifications.
- `src/utils/parser.ts`: Handles job title matching, Germany location checks, applicant count parsing, and the core alert transition logic.
- `vercel.json`: Handles zero-config rewrites mapping `/api/...` to `api/index.ts`.

## Development Commands
- Run development server locally: `npm run dev`
- Verify typescript compilation: `npm run lint`
- Clean distribution folder: `npm run clean`

## Core Alerting Rules
- Job title must match target titles (Data Analyst, BI Analyst, Tableau Developer, etc.) and location must be in Germany.
- **Alert if**:
  - Applicant count is `≤ 15` (inclusive, low competition).
  - Applicant count is `unknown` AND the job was posted `within the last 2 hours`.
- **Never Alert if**:
  - Applicant count is `> 100` under any circumstance.
  - Applicant count is `unknown` AND the job is `older than 2 hours`.
- **De-duplication**: Send alerts on each job exactly once, unless the applicant count crosses between the `≤ 15` band and the `16–100` band in either direction (which triggers a follow-up alert).
