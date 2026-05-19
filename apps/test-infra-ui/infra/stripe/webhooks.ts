import Stripe from "stripe";
import { adapter } from "./adapter";

export async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      await adapter.updateSubscription({
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: session.subscription as string,
        priceId: session.line_items?.data[0]?.price?.id ?? "",
        status: "active",
      });
      break;
    }
    default:
      console.log(`Unhandled event type ${event.type}`);
  }
}