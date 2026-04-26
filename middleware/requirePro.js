export default function requirePro(req, res, next) {
  const user = req.signedCookies.user;

  if (!user || user.role !== "teacher") {
    return res.redirect("/login");
  }

  if (user.plan === "pro" || user.plan === "school") {
    return next();
  }

  return res.redirect("/billing");
}