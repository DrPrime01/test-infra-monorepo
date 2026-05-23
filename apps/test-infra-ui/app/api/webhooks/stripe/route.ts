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

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
    await handleStripeEvent(event);
    return new Response("OK", { status: 200 });
  } catch (err: unknown) {
    console.error("[stripe webhook]", err);
    return new Response("Bad request", { status: 400 });
  }
}
