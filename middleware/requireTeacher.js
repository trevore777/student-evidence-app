export default function requireTeacher(req, res, next) {
  if (!req.signedCookies.user || req.signedCookies.user.role !== "teacher") {
    return res.redirect("/login");
  }
  next();
}
