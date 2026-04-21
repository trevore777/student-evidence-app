import express from "express";

const app = express();

app.get("/", (req, res) => {
  res.send("ROOT OK");
});

app.get("/health", (req, res) => {
  res.send("HEALTH OK");
});

app.get("/login", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Login Test</title>
      </head>
      <body style="font-family: Arial; padding: 30px; background: white; color: black;">
        <h1>LOGIN TEST OK</h1>
        <p>If you can see this, Vercel + Express routing is working.</p>
      </body>
    </html>
  `);
});

export default app;

if (process.env.NODE_ENV !== "production") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Running on http://localhost:${port}`);
  });
}