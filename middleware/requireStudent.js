export default function requireStudent(req, res, next) {
  if (!req.signedCookies.user || req.signedCookies.user.role !== "student") {
    return res.redirect("/login");
  }
  next();
}
