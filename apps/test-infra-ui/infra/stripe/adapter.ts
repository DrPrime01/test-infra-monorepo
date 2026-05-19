export interface StripeAdapter {
  createCustomer: (email: string, name?: string) => Promise<string>;
  updateSubscription: (data: {
    stripeCustomerId: string;
    stripeSubscriptionId: string;
    status: string;
    priceId: string;
  }) => Promise<void>;
}

/**
 * 🛠️ ADAPTER IMPLEMENTATION
 * The CLI will attempt to auto-fill this based on your ORM.
 */
export const adapter: StripeAdapter = {
  createCustomer: async (email, name) => {
    // Example: return (await db.user.create({ data: { email } })).id;
    console.log("Creating customer in DB for:", email, name);
    return "temp_customer_id";
  },

  updateSubscription: async (data) => {
    // Example: await db.subscription.upsert({ ... });
    console.log("Syncing subscription to DB:", data);
  },
};
