import express from "express";
import { db } from "../lib/db.js";
import { stripe } from "../lib/stripe.js";
import requireTeacher from "../middleware/requireTeacher.js";

const router = express.Router();

function normalizeRow(row, keys = []) {
  if (!row) return {};
  if (!Array.isArray(row)) return row;
  const obj = {};
  keys.forEach((key, i) => (obj[key] = row[i]));
  return obj;
}

router.get("/", requireTeacher, async (req, res) => {
  const teacher = req.signedCookies.user;

  const result = await db.execute({
    sql: `
      SELECT plan, subscription_status, current_period_end
      FROM teachers
      WHERE id = ?
    `,
    args: [teacher.id]
  });

  const billing = normalizeRow(result.rows?.[0], [
    "plan",
    "subscription_status",
    "current_period_end"
  ]);

  res.render("billing", {
    teacher,
    billing,
    error: null
  });
});

router.post("/checkout", requireTeacher, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).send("Stripe is not configured");
    }

    const teacher = req.signedCookies.user;

    const teacherResult = await db.execute({
      sql: `
        SELECT id, name, email, stripe_customer_id
        FROM teachers
        WHERE id = ?
      `,
      args: [teacher.id]
    });

    const teacherRow = normalizeRow(teacherResult.rows?.[0], [
      "id",
      "name",
      "email",
      "stripe_customer_id"
    ]);

    let customerId = teacherRow.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: teacherRow.email,
        name: teacherRow.name,
        metadata: {
          teacher_id: String(teacherRow.id)
        }
      });

      customerId = customer.id;

      await db.execute({
        sql: `UPDATE teachers SET stripe_customer_id = ? WHERE id = ?`,
        args: [customerId, teacherRow.id]
      });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [
        {
          price: process.env.STRIPE_PRICE_TEACHER_PRO,
          quantity: 1
        }
      ],
      success_url: `${process.env.APP_URL}/billing/success`,
      cancel_url: `${process.env.APP_URL}/billing`
    });

    res.redirect(session.url);
  } catch (err) {
    console.error("POST /billing/checkout error:", err);
    res.status(500).send("Failed to start checkout");
  }
});

router.post("/portal", requireTeacher, async (req, res) => {
  try {
    if (!stripe) {
      return res.status(500).send("Stripe is not configured");
    }

    const teacher = req.signedCookies.user;

    const result = await db.execute({
      sql: `SELECT stripe_customer_id FROM teachers WHERE id = ?`,
      args: [teacher.id]
    });

    const row = normalizeRow(result.rows?.[0], ["stripe_customer_id"]);

    if (!row.stripe_customer_id) {
      return res.redirect("/billing");
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: row.stripe_customer_id,
      return_url: `${process.env.APP_URL}/billing`
    });

    res.redirect(session.url);
  } catch (err) {
    console.error("POST /billing/portal error:", err);
    res.status(500).send("Failed to open billing portal");
  }
});

router.get("/success", requireTeacher, (req, res) => {
  res.render("billing-success");
});

export default router;