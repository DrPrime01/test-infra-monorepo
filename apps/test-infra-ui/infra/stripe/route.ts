import { NextResponse } from "next/server";
import { headers } from "next/headers";

import Stripe from "stripe";

import { stripe } from "@/infra/stripe/client";
import { handleStripeEvent } from "@/infra/stripe/webhooks";

export async function POST(req: Request) {
  const body = await req.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  await handleStripeEvent(event);
  return new Response("Webhook received", { status: 200 });
}
