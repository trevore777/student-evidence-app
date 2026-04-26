import express from "express";
import { stripe } from "../lib/stripe.js";
import { db } from "../lib/db.js";

const router = express.Router();

async function updateTeacherSubscription(subscription) {
  const customerId = subscription.customer;
  const status = subscription.status;
  const subscriptionId = subscription.id;
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const plan =
    status === "active" || status === "trialing"
      ? "pro"
      : "free";

  await db.execute({
    sql: `
      UPDATE teachers
      SET
        stripe_subscription_id = ?,
        plan = ?,
        subscription_status = ?,
        current_period_end = ?
      WHERE stripe_customer_id = ?
    `,
    args: [
      subscriptionId,
      plan,
      status,
      periodEnd,
      customerId
    ]
  });
}

router.post(
  "/",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      if (!stripe) {
        return res.status(500).send("Stripe not configured");
      }

      const signature = req.headers["stripe-signature"];

      const event = stripe.webhooks.constructEvent(
        req.body,
        signature,
        process.env.STRIPE_WEBHOOK_SECRET
      );

      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        await updateTeacherSubscription(event.data.object);
      }

      res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook error:", err);
      res.status(400).send(`Webhook Error: ${err.message}`);
    }
  }
);

export default router;