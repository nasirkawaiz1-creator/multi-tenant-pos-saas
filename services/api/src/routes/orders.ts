import type { FastifyInstance } from "fastify";
import { and, desc, eq, inArray, orderItems, orders, products } from "@pos/database";
import { z } from "zod";
import { mapOrder } from "../lib/mappers.js";
import { runWithTenant } from "../middleware/tenant-context.js";

// Printed receipts never included tax, so the default is 0. Set TAX_RATE (e.g. 0.08) to enable it.
const TAX_RATE = Number(process.env.TAX_RATE ?? 0) || 0;

const createOrderSchema = z.object({
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().min(1),
        // Optional counter price override (the checkout screen lets the cashier edit the price).
        unitPrice: z.union([z.string(), z.number()]).optional(),
      }),
    )
    .min(1),
  // Flat discount in Rs, applied to the subtotal.
  discount: z.union([z.string(), z.number()]).optional(),
});

export async function orderRoutes(app: FastifyInstance) {
  app.post(
    "/orders",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const parsed = createOrderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid request", details: parsed.error.flatten() });
      }

      const cashierId = request.user!.userId;

      try {
        const result = await runWithTenant(request, async (tx, tenantId) => {
          let subtotal = 0;
          const lineItems: Array<{
            productId: string;
            quantity: number;
            unitPrice: string;
            productName: string;
          }> = [];

          for (const item of parsed.data.items) {
            const [product] = await tx
              .select()
              .from(products)
              .where(and(eq(products.id, item.productId), eq(products.tenantId, tenantId)))
              .limit(1);

            if (!product) {
              throw new Error(`Product ${item.productId} not found`);
            }

            if (product.stockQty < item.quantity) {
              throw new Error(`Insufficient stock for ${product.name}`);
            }

            const override =
              item.unitPrice !== undefined ? Number(item.unitPrice) : Number.NaN;
            const unitPrice = Number.isFinite(override) && override >= 0
              ? override
              : parseFloat(product.price);
            subtotal += unitPrice * item.quantity;

            lineItems.push({
              productId: product.id,
              quantity: item.quantity,
              unitPrice: unitPrice.toFixed(2),
              productName: product.name,
            });
          }

          const discount = Math.min(
            Math.max(Number(parsed.data.discount ?? 0) || 0, 0),
            subtotal,
          );
          const taxable = subtotal - discount;
          const tax = Math.round(taxable * TAX_RATE * 100) / 100;
          const total = Math.round((taxable + tax) * 100) / 100;

          const [order] = await tx
            .insert(orders)
            .values({
              tenantId,
              cashierId,
              status: "completed",
              subtotal: subtotal.toFixed(2),
              tax: tax.toFixed(2),
              total: total.toFixed(2),
            })
            .returning();

          if (!order) throw new Error("Failed to create order");

          await tx.insert(orderItems).values(
            lineItems.map((item) => ({
              orderId: order.id,
              tenantId,
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              productName: item.productName,
            })),
          );

          for (const item of parsed.data.items) {
            const [currentProduct] = await tx
              .select()
              .from(products)
              .where(and(eq(products.id, item.productId), eq(products.tenantId, tenantId)))
              .limit(1);

            if (currentProduct) {
              await tx
                .update(products)
                .set({
                  stockQty: currentProduct.stockQty - item.quantity,
                  updatedAt: new Date(),
                })
                .where(and(eq(products.id, item.productId), eq(products.tenantId, tenantId)));
            }
          }

          const items = await tx
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, order.id));

          return { ...mapOrder(order), items };
        });

        return reply.status(201).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Order failed";
        return reply.status(400).send({ error: message });
      }
    },
  );

  // The logged-in store's own orders (newest first), each with its items. Used by the
  // inventory daily ledger to total up each day's sales.
  app.get("/orders", { preHandler: [app.authenticate] }, async (request) => {
    const { limit } = z
      .object({ limit: z.coerce.number().int().min(1).max(1000).default(500) })
      .parse(request.query);

    const data = await runWithTenant(request, async (tx, tenantId) => {
      const orderRows = await tx
        .select()
        .from(orders)
        .where(eq(orders.tenantId, tenantId))
        .orderBy(desc(orders.createdAt))
        .limit(limit);
      if (orderRows.length === 0) return [];

      const itemRows = await tx
        .select()
        .from(orderItems)
        .where(
          and(
            eq(orderItems.tenantId, tenantId),
            inArray(
              orderItems.orderId,
              orderRows.map((o) => o.id),
            ),
          ),
        );

      return orderRows.map((order) => ({
        ...mapOrder(order),
        items: itemRows
          .filter((item) => item.orderId === order.id)
          .map((item) => ({
            id: item.id,
            orderId: item.orderId,
            productId: item.productId,
            tenantId: item.tenantId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            productName: item.productName,
          })),
      }));
    });

    return { data };
  });

  app.get(
    "/orders/:id",
    { preHandler: [app.authenticate] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const result = await runWithTenant(request, async (tx, tenantId) => {
        const [order] = await tx
          .select()
          .from(orders)
          .where(and(eq(orders.id, id), eq(orders.tenantId, tenantId)))
          .limit(1);
        if (!order) return null;

        const items = await tx
          .select()
          .from(orderItems)
          .where(and(eq(orderItems.orderId, id), eq(orderItems.tenantId, tenantId)));

        return {
          ...mapOrder(order),
          items: items.map((item) => ({
            id: item.id,
            orderId: item.orderId,
            productId: item.productId,
            tenantId: item.tenantId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            productName: item.productName,
          })),
        };
      });

      if (!result) return reply.status(404).send({ error: "Order not found" });
      return result;
    },
  );
}
