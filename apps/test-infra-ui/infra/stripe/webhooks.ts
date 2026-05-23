import Stripe from "stripe";
import { stripe } from "./client";
import { adapter } from "./adapter";

export interface SubscriptionData {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  priceId: string;
  status: string;
}

export async function handleStripeEvent(event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      // line_items is not expanded in the webhook payload — retrieve from Stripe
      const subscription = await stripe.subscriptions.retrieve(
        session.subscription as string
      );
      await adapter.updateSubscription({
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: session.subscription as string,
        priceId: subscription.items.data[0]?.price.id ?? "",
        status: "active",
      });
      break;
    }
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      await adapter.updateSubscription({
        stripeCustomerId: subscription.customer as string,
        stripeSubscriptionId: subscription.id,
        priceId: subscription.items.data[0]?.price.id ?? "",
        status: subscription.status,
      });
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await adapter.updateSubscription({
        stripeCustomerId: subscription.customer as string,
        stripeSubscriptionId: subscription.id,
        priceId: subscription.items.data[0]?.price.id ?? "",
        status: "canceled",
      });
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      await adapter.updateSubscription({
        stripeCustomerId: invoice.customer as string,
        stripeSubscriptionId: invoice.subscription as string,
        priceId: invoice.lines.data[0]?.price?.id ?? "",
        status: "past_due",
      });
      break;
    }
    default:
      console.log(`Unhandled event type ${event.type}`);
  }
}
