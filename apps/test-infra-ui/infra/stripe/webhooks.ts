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
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await adapter.updateSubscription({
        stripeCustomerId: subscription.customer as string,
        stripeSubscriptionId: subscription.id,
        priceId: subscription.items.data[0].price.id,
        status: "canceled",
      });
      break;
    }
    default:
      console.log(`Unhandled event type ${event.type}`);
  }
}
