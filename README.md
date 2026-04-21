# Student Evidence App v8 — Vercel Ready

This build is prepared for deployment on **Vercel + Turso** and adds **teacher-to-class locking** so each teacher only works with their assigned class.

## What changed in v8

- Vercel serverless entrypoint added in `api/index.js`
- `vercel.json` included
- `.env.example` now defaults to Turso variables
- teacher records now include `class_name`
- teacher dashboards, assignment creation, and submission review are locked to the teacher's class
- database init now includes migration-style `ALTER TABLE` steps for older local databases
- `.gitignore` included

## Local setup

For local testing with Turso:

```bash
npm install
cp .env.example .env
# add your real Turso + OpenAI values to .env
npm run db:init
npm run dev
```

If you want to test locally with a file DB instead, set:

```env
TURSO_DATABASE_URL=file:local.db
TURSO_AUTH_TOKEN=
```

Then run:

```bash
rm -f local.db
npm run db:init
npm run dev
```

Then open:

- `http://localhost:3000/seed-demo-users`
- `http://localhost:3000/login`

## Demo logins

### Teacher A
- email: `teacher@test.com`
- password: `teacher123`
- class: `Year 10A`

### Teacher B
- email: `baker@test.com`
- password: `teacher123`
- class: `Year 10B`

### Students
- role: `Student`
- choose class and student name from dropdown

## Deploy to Vercel

1. Create a Turso database and token.
2. Set these environment variables in Vercel:
   - `APP_SECRET`
   - `TURSO_DATABASE_URL`
   - `TURSO_AUTH_TOKEN`
   - `OPENAI_API_KEY`
3. Run `npm run db:init` once against the Turso database.
4. Deploy to Vercel.
5. Visit `/seed-demo-users` once if you want demo content.

## Notes

- TinyMCE is still loaded from the TinyMCE CDN.
- The AI feedback email feature still needs a valid `OPENAI_API_KEY`.
- Submission composition percentages remain estimates, not proof.
