"use client";

import { Button } from "@/components/ui/button";
import { createCheckoutSession } from "../actions";
import { useState } from "react";

export function CheckoutButton({ priceId }: { priceId: string }) {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      onClick={async () => {
        setLoading(true);
        await createCheckoutSession(priceId);
      }}
      disabled={loading}
    >
      {loading ? "Redirecting..." : "Upgrade Plan"}
    </Button>
  );
}
