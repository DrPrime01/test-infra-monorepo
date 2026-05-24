import { headers } from "next/headers";
import { stripe } from "@/infra/stripe/client";
import { handleStripeEvent } from "@/infra/stripe/webhooks";

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("Stripe-Signature");

  if (!signature) {
    return new Response("Bad request", { status: 400 });
  }

  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET is not set");
    return new Response("Server misconfiguration", { status: 500 });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err: unknown) {
    console.error("[stripe webhook] signature verification failed", err);
    return new Response("Bad request", { status: 400 });
  }

  try {
    await handleStripeEvent(event);
    return new Response("OK", { status: 200 });
  } catch (err: unknown) {
    console.error("[stripe webhook] handler error", err);
    return new Response("Internal error", { status: 500 });
  }
}
