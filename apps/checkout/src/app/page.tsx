"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "@pos/api-client";
import type { Product } from "@pos/types";
import {
  AppShell,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PageHeader,
} from "@pos/ui";

interface StoreProfile {
  name: string;
  details: string;
  phone: string;
}

export default function InventoryPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [storeInfo, setStoreInfo] = useState<StoreProfile>({
    name: "Imdad Cosmetics",
    details: "Shop # B1-A, Kamil Plaza, Basement Bara Bazar, Rawalpindi",
    phone: "03451523394",
  });

  const storeProfiles: Record<string, StoreProfile> = {
    "imdad-cosmetics": {
      name: "Imdad Cosmetics",
      details: "Shop # B1-A, Kamil Plaza, Basement Bara Bazar, Rawalpindi",
      phone: "03451523394",
    },
  };

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }

    const currentTenant = process.env.NEXT_PUBLIC_TENANT_ID || "imdad-cosmetics";
    setStoreInfo(
      storeProfiles[currentTenant as keyof typeof storeProfiles] || {
        name: "Imdad Cosmetics",
        details: "Shop # B1-A, Kamil Plaza, Basement Bara Bazar, Rawalpindi",
        phone: "03451523394",
      }
    );

    loadProducts();
  }, []);

  async function loadProducts() {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ data: Product[] }>("/products");
      if (res && res.data) {
        setProducts(res.data);
      } else {
        setProducts([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products from server.");
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  function exportToCSV() {
    if (products.length === 0) {
      alert("No products available to export.");
      return;
    }

    const headers = ["Barcode / SKU", "Item Name", "Price (Rs)", "Stock Qty", "Status"];
    const rows = products.map((p) => [
      `"${p.sku || ""}"`,
      `"${p.name.replace(/"/g, '""')}"`,
      p.price,
      p.stockQty,
      p.stockQty > 5 ? "In Stock" : p.stockQty > 0 ? "Low Stock" : "Out of Stock",
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `imdad_cosmetics_inventory_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  const filteredProducts = products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.sku && p.sku.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSearch;
  });

  return (
    <AppShell
      title="Inventory"
      nav={
        <nav className="flex gap-4 text-sm">
          <a href="/dashboard" className="text-slate-600 hover:text-slate-900">
            Dashboard
          </a>
          <a href="/inventory" className="font-medium text-slate-900">
            Inventory
          </a>
          <a href="/checkout" className="text-slate-600 hover:text-slate-900">
            Checkout
          </a>
        </nav>
      }
    >
      <div className="mb-4 border-b border-slate-200 pb-3 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{storeInfo.name}</h1>
          <p className="text-sm text-slate-700 font-medium">{storeInfo.details} | Ph: {storeInfo.phone}</p>
        </div>
        <Button
          onClick={() => router.push("/checkout")}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          Go to Checkout ➔
        </Button>
      </div>

      <PageHeader
        title="Inventory Manager"
        description="Products, barcodes, and stock levels saved securely on server"
      />

      <div className="space-y-4">
        <div className="flex flex-wrap gap-4 items-center justify-between bg-slate-50 p-4 rounded-xl border border-slate-200">
          <Input
            placeholder="Search by product name or SKU/Barcode..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="max-w-md h-11 bg-white"
          />
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={loadProducts}
              className="h-11 border-slate-300 text-slate-700 hover:bg-slate-100"
            >
              🔄 Refresh
            </Button>
            <Button
              onClick={exportToCSV}
              className="h-11 bg-green-600 hover:bg-green-700 text-white"
            >
              📊 Export to CSV / Google Sheets
            </Button>
          </div>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex justify-between items-center">
            <p className="text-sm font-medium">{error}</p>
            <Button size="sm" onClick={loadProducts} className="bg-red-600 hover:bg-red-700 text-white">
              Retry
            </Button>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm text-left">
            <thead className="bg-slate-100 text-slate-700 text-xs uppercase border-b border-slate-200">
              <tr>
                <th className="px-4 py-3">Barcode / SKU</th>
                <th className="px-4 py-3">Item Name</th>
                <th className="px-4 py-3 text-right">Price (Rs)</th>
                <th className="px-4 py-3 text-center">Stock Qty</th>
                <th className="px-4 py-3 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-500 font-medium">
                    Loading inventory items... Please wait.
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                    No products found in inventory.
                  </td>
                </tr>
              ) : (
                filteredProducts.map((product) => (
                  <tr key={product.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{product.sku}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900">{product.name}</td>
                    <td className="px-4 py-3 text-right font-medium">Rs {product.price}</td>
                    <td className="px-4 py-3 text-center font-bold">{product.stockQty}</td>
                    <td className="px-4 py-3 text-center">
                      {product.stockQty > 5 ? (
                        <Badge variant="success">In Stock</Badge>
                      ) : product.stockQty > 0 ? (
                        <Badge variant="warning">Low Stock</Badge>
                      ) : (
                        <Badge variant="destructive">Out of Stock</Badge>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
