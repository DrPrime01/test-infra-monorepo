import { db } from "@/lib/db"; // Adjust this import to your Prisma client

export const adapter = {
  updateSubscription: async (data: any) => {
    await db.user.update({
      where: { stripeCustomerId: data.stripeCustomerId },
      data: {
        stripeSubscriptionId: data.stripeSubscriptionId,
        status: data.status,
        priceId: data.priceId
      }
    });
  }
};