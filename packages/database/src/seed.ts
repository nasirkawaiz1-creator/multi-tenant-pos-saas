import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import {
  categories,
  client,
  db,
  orderItems,
  orders,
  products,
  tenants,
  users,
  withTenantContext,
} from "./index.js";

const DEMO_PASSWORD = "demo1234";

async function seed() {
  console.log("Seeding database...");

  const existing = await db.select().from(tenants).limit(1);
  if (existing.length > 0) {
    console.log("Database already seeded, skipping.");
    await client.end();
    return;
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const [acme] = await db
    .insert(tenants)
    .values({ slug: "acme-retail", name: "Acme Retail", plan: "pro" })
    .returning();

  const [cafe] = await db
    .insert(tenants)
    .values({ slug: "corner-cafe", name: "Corner Cafe", plan: "starter" })
    .returning();

  if (!acme || !cafe) throw new Error("Failed to create tenants");

  await withTenantContext(acme.id, async (tx) => {
    await tx.insert(users).values([
      {
        tenantId: acme.id,
        email: "owner@acme.demo",
        passwordHash,
        name: "Alex Owner",
        role: "owner",
      },
      {
        tenantId: acme.id,
        email: "cashier@acme.demo",
        passwordHash,
        name: "Casey Cashier",
        role: "cashier",
      },
    ]);
  });

  await withTenantContext(cafe.id, async (tx) => {
    await tx.insert(users).values({
      tenantId: cafe.id,
      email: "owner@cafe.demo",
      passwordHash,
      name: "Jordan Owner",
      role: "owner",
    });
  });

  await withTenantContext(acme.id, async (tx) => {
    const acmeCategories = await tx
      .insert(categories)
      .values([
        { tenantId: acme.id, name: "Electronics" },
        { tenantId: acme.id, name: "Accessories" },
        { tenantId: acme.id, name: "Office" },
      ])
      .returning();

    const acmeProducts = [
      { name: "Wireless Mouse", sku: "ACM-001", price: "29.99", stockQty: 45, cat: 0 },
      { name: "Mechanical Keyboard", sku: "ACM-002", price: "89.99", stockQty: 22, cat: 0 },
      { name: "USB-C Hub", sku: "ACM-003", price: "49.99", stockQty: 18, cat: 1 },
      { name: "HDMI Cable", sku: "ACM-004", price: "12.99", stockQty: 100, cat: 1 },
      { name: "Laptop Stand", sku: "ACM-005", price: "39.99", stockQty: 30, cat: 2 },
      { name: "Webcam HD", sku: "ACM-006", price: "59.99", stockQty: 15, cat: 0 },
      { name: "Desk Lamp", sku: "ACM-007", price: "34.99", stockQty: 8, cat: 2 },
      { name: "Monitor 27\"", sku: "ACM-008", price: "299.99", stockQty: 12, cat: 0 },
      { name: "Phone Stand", sku: "ACM-009", price: "14.99", stockQty: 3, cat: 1 },
      { name: "Notebook Pack", sku: "ACM-010", price: "9.99", stockQty: 200, cat: 2 },
      { name: "Pen Set", sku: "ACM-011", price: "7.99", stockQty: 150, cat: 2 },
      { name: "Sticky Notes", sku: "ACM-012", price: "4.99", stockQty: 4, cat: 2 },
      { name: "Bluetooth Speaker", sku: "ACM-013", price: "79.99", stockQty: 20, cat: 0 },
      { name: "Power Strip", sku: "ACM-014", price: "24.99", stockQty: 35, cat: 1 },
      { name: "Cable Organizer", sku: "ACM-015", price: "11.99", stockQty: 60, cat: 1 },
      { name: "Ergonomic Chair", sku: "ACM-016", price: "399.99", stockQty: 5, cat: 2 },
      { name: "Standing Desk", sku: "ACM-017", price: "549.99", stockQty: 3, cat: 2 },
      { name: "Headphones", sku: "ACM-018", price: "129.99", stockQty: 25, cat: 0 },
      { name: "Tablet Case", sku: "ACM-019", price: "19.99", stockQty: 40, cat: 1 },
      { name: "Screen Cleaner", sku: "ACM-020", price: "8.99", stockQty: 2, cat: 1 },
    ];

    const insertedProducts = await tx
      .insert(products)
      .values(
        acmeProducts.map((p) => ({
          tenantId: acme.id,
          categoryId: acmeCategories[p.cat]?.id ?? null,
          name: p.name,
          sku: p.sku,
          price: p.price,
          stockQty: p.stockQty,
          lowStockThreshold: 5,
        })),
      )
      .returning();

    const acmeOwner = await tx
      .select()
      .from(users)
      .where(eq(users.email, "owner@acme.demo"))
      .limit(1);

    const owner = acmeOwner[0];
    if (owner && insertedProducts[0]) {
      const subtotal = "29.99";
      const tax = "2.40";
      const total = "32.39";

      const [order] = await tx
        .insert(orders)
        .values({
          tenantId: acme.id,
          cashierId: owner.id,
          status: "completed",
          subtotal,
          tax,
          total,
        })
        .returning();

      if (order) {
        await tx.insert(orderItems).values({
          orderId: order.id,
          productId: insertedProducts[0].id,
          tenantId: acme.id,
          quantity: 1,
          unitPrice: "29.99",
          productName: insertedProducts[0].name,
        });
      }
    }
  });

  await withTenantContext(cafe.id, async (tx) => {
    const cafeCategories = await tx
      .insert(categories)
      .values([
        { tenantId: cafe.id, name: "Beverages" },
        { tenantId: cafe.id, name: "Pastries" },
      ])
      .returning();

    const cafeProducts = [
      { name: "Espresso", sku: "CAF-001", price: "3.50", stockQty: 999, cat: 0 },
      { name: "Latte", sku: "CAF-002", price: "4.50", stockQty: 999, cat: 0 },
      { name: "Cappuccino", sku: "CAF-003", price: "4.25", stockQty: 999, cat: 0 },
      { name: "Cold Brew", sku: "CAF-004", price: "4.00", stockQty: 50, cat: 0 },
      { name: "Croissant", sku: "CAF-005", price: "3.25", stockQty: 20, cat: 1 },
      { name: "Muffin", sku: "CAF-006", price: "2.75", stockQty: 15, cat: 1 },
      { name: "Bagel", sku: "CAF-007", price: "2.50", stockQty: 25, cat: 1 },
      { name: "Danish", sku: "CAF-008", price: "3.00", stockQty: 4, cat: 1 },
      { name: "Hot Tea", sku: "CAF-009", price: "3.00", stockQty: 999, cat: 0 },
      { name: "Iced Tea", sku: "CAF-010", price: "3.25", stockQty: 80, cat: 0 },
    ];

    await tx.insert(products).values(
      cafeProducts.map((p) => ({
        tenantId: cafe.id,
        categoryId: cafeCategories[p.cat]?.id ?? null,
        name: p.name,
        sku: p.sku,
        price: p.price,
        stockQty: p.stockQty,
        lowStockThreshold: 5,
      })),
    );
  });

  console.log("Seed complete.");
  console.log("Demo credentials:");
  console.log("  acme-retail: owner@acme.demo / demo1234");
  console.log("  corner-cafe: owner@cafe.demo / demo1234");
  await client.end();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
