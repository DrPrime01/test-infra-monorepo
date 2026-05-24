import Stripe from "stripe";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is missing from .env.local");
}
if (!process.env.NEXT_PUBLIC_APP_URL) {
  throw new Error(
    "NEXT_PUBLIC_APP_URL is missing from .env.local — required for checkout success/cancel URLs",
  );
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-04-22.dahlia",
  typescript: true,
});