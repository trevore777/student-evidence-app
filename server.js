import express from "express";
const app = express();

// your routes here

app.get("/", (req, res) => {
  res.redirect("/login");
});

export default app;

if (process.env.NODE_ENV !== "production") {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Student Evidence App running on http://localhost:${port}`);
  });
}