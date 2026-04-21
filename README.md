# Student Evidence App v6

This version adds a TinyMCE rich text editor to the student writing space so students can use familiar formatting tools while the app still keeps evidence logging and paste declarations.

## Included in v6

- TinyMCE rich text editor on the writing page
- formatting toolbar with blocks, font family, font size, bold, italic, underline, bullets, numbering, indent, and outdent
- paste logging and declaration modal still active
- autosave still active
- teacher review now renders submitted rich text and snapshots as formatted content, with HTML source available in expandable sections

## Local setup

```bash
npm install
cp .env.example .env
rm -f local.db
npm run db:init
npm run dev
```

Then open:

- `http://localhost:3000/seed-demo-users`
- `http://localhost:3000/login`

## Demo logins

### Teacher
- email: `teacher@test.com`
- password: `teacher123`

### Student
- role: `Student`
- class: `Year 10A` or `Year 10B`
- select a student from the dropdown

## Notes

- This build uses TinyMCE from the TinyMCE CDN.
- Pasted content is forced to plain text before insertion to keep formatting cleaner and easier to review.
- Student submission content is now stored as rich HTML. Word counts are calculated from stripped plain text in the browser before save and submit.
- AI email drafting still requires `OPENAI_API_KEY` in `.env` if you want to use that feature.


## v7 update

Teacher Review now shows an **Estimated composition of submission** panel with estimated own work, copy-and-paste, and declared AI-assisted percentages plus a confidence label. These percentages are estimates based on writing activity, paste events, and declarations.
