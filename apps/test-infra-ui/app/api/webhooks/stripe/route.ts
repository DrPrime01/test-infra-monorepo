import { headers } from "next/headers";
import { stripe } from "@/infra/stripe/client";
import { handleStripeEvent } from "@/infra/stripe/webhooks";

export async function POST(req: Request) {
  const body = await req.text();
  const signature = headers().get("Stripe-Signature") as string;

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
    await handleStripeEvent(event);
    return new Response("Webhook received", { status: 200 });
  } catch (err: any) {
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }
}