"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "@pos/api-client";
import type { Product } from "@pos/types";
import {
  AppShell,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  PageHeader,
} from "@pos/ui";

interface CartItem {
  id: string;
  name: string;
  sku: string;
  price: number;
  qty: number;
}

export default function CheckoutPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customQty, setCustomQty] = useState(1);
  const [discount, setDiscount] = useState<number>(0);
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }
    loadProducts();
  }, []);

  async function loadProducts() {
    try {
      const res = await apiFetch<{ data: Product[] }>("/products");
      if (res && res.data) {
        setProducts(res.data);
      }
    } catch (err) {
      console.error("Failed to load products for checkout", err);
    }
  }

  // Handle Barcode Scan / Enter
  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = barcodeInput.trim();
    if (!code) return;

    setNotice("");
    // Search in loaded inventory products by SKU or barcode
    const foundProduct = products.find(
      (p) => p.sku?.toLowerCase() === code.toLowerCase() || p.id === code
    );

    if (foundProduct) {
      // Auto-add to cart with inventory name and price
      addToCart({
        id: foundProduct.id,
        name: foundProduct.name,
        sku: foundProduct.sku || code,
        price: Number(foundProduct.price) || 0,
        qty: 1,
      });
      setBarcodeInput("");
    } else {
      // If not found in inventory, prefill barcode and prompt for name/price
      setNotice(`Barcode (${code}) not found in inventory — enter Name & Price below or check SKU.`);
      setCustomPrice("");
      setCustomName("");
    }
  }

  function addToCart(newItem: CartItem) {
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.sku === newItem.sku);
      if (existingIndex > -1) {
        const updated = [...prev];
        updated[existingIndex].qty += newItem.qty;
        return updated;
      }
      return [newItem, ...prev];
    });
  }

  // Add custom or manual item
  function handleManualAdd() {
    if (!customName.trim() || !customPrice) return;
    const priceNum = parseFloat(customPrice);
    if (isNaN(priceNum) || priceNum <= 0) return;

    addToCart({
      id: `manual-${Date.now()}`,
      name: customName.trim(),
      sku: barcodeInput.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
      price: priceNum,
      qty: customQty > 0 ? customQty : 1,
    });

    setCustomName("");
    setCustomPrice("");
    setCustomQty(1);
    setBarcodeInput("");
    setNotice("");
  }

  function updateQty(sku: string, delta: number) {
    setCart((prev) =>
      prev
        .map((item) => {
          if (item.sku === sku) {
            const newQty = item.qty + delta;
            return newQty > 0 ? { ...item, qty: newQty } : null;
          }
          return item;
        })
        .filter(Boolean) as CartItem[]
    );
  }

  function removeFromCart(sku: string) {
    setCart((prev) => prev.filter((item) => item.sku !== sku));
  }

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const discountAmount = isNaN(discount) ? 0 : (subtotal * discount) / 100;
  const grandTotal = Math.max(0, subtotal - discountAmount);

  async function handleCheckoutComplete() {
    if (cart.length === 0) {
      alert("Cart is empty!");
      return;
    }
    setLoading(true);
    try {
      // Simulate order completion / API call
      await new Promise((resolve) => setTimeout(resolve, 600));
      alert("Checkout completed successfully!");
      setCart([]);
      setDiscount(0);
    } catch (err) {
      alert("Checkout failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AppShell
      title="Checkout"
      nav={
        <nav className="flex gap-4 text-sm">
          <a href="/dashboard" className="text-slate-600 hover:text-slate-900">
            Dashboard
          </a>
          <a href="/inventory" className="text-slate-600 hover:text-slate-900">
            Inventory
          </a>
          <a href="/checkout" className="font-medium text-slate-900">
            Checkout
          </a>
        </nav>
      }
    >
      <div className="mb-4 border-b border-slate-200 pb-3 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Checkout Terminal</h1>
          <p className="text-sm text-slate-600">Scan QR/Barcode or lookup wholesale items</p>
        </div>
        <Button
          onClick={() => router.push("/inventory")}
          variant="outline"
          className="border-slate-300 text-slate-700"
        >
          ← Back to Inventory
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left / Main Section: Scanner & Manual Add */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Scan or Enter Barcode</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleBarcodeSubmit} className="flex gap-2">
                <Input
                  placeholder="Scan Barcode / QR or type SKU..."
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  className="h-11 text-base font-mono"
                  autoFocus
                />
                <Button type="submit" className="h-11 bg-slate-900 hover:bg-slate-800 text-white px-6">
                  Add Code
                </Button>
              </form>

              {notice && (
                <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg font-medium">
                  {notice}
                </div>
              )}

              <div className="pt-2 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Input
                  placeholder="Item Name..."
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="h-10"
                />
                <Input
                  type="number"
                  placeholder="Price (Rs)..."
                  value={customPrice}
                  onChange={(e) => setCustomPrice(e.target.value)}
                  className="h-10"
                />
                <div className="flex gap-2">
                  <Input
                    type="number"
                    min="1"
                    placeholder="Qty"
                    value={customQty}
                    onChange={(e) => setCustomQty(parseInt(e.target.value) || 1)}
                    className="h-10 w-20"
                  />
                  <Button
                    type="button"
                    onClick={handleManualAdd}
                    className="h-10 flex-1 bg-green-600 hover:bg-green-700 text-white font-medium"
                  >
                    + Add Item
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cart Table */}
          <Card className="border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-lg">Current Bill Items</CardTitle>
            </CardHeader>
            <CardContent>
              {cart.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  No items in cart yet. Scan a barcode or add an item above.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 text-slate-700 text-xs uppercase border-b border-slate-200">
                      <tr>
                        <th className="px-3 py-2">Code</th>
                        <th className="px-3 py-2">Item Name</th>
                        <th className="px-3 py-2 text-right">Price</th>
                        <th className="px-3 py-2 text-center">Qty</th>
                        <th className="px-3 py-2 text-right">Total</th>
                        <th className="px-3 py-2 text-center">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {cart.map((item) => (
                        <tr key={item.sku} className="hover:bg-slate-50">
                          <td className="px-3 py-2 font-mono text-xs text-slate-500">{item.sku}</td>
                          <td className="px-3 py-2 font-semibold text-slate-900">{item.name}</td>
                          <td className="px-3 py-2 text-right">Rs {item.price}</td>
                          <td className="px-3 py-2 text-center">
                            <div className="inline-flex items-center border border-slate-200 rounded">
                              <button
                                onClick={() => updateQty(item.sku, -1)}
                                className="px-2 py-0.5 text-slate-600 hover:bg-slate-100"
                              >
                                -
                              </button>
                              <span className="px-3 font-medium">{item.qty}</span>
                              <button
                                onClick={() => updateQty(item.sku, 1)}
                                className="px-2 py-0.5 text-slate-600 hover:bg-slate-100"
                              >
                                +
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right font-bold">Rs {item.price * item.qty}</td>
                          <td className="px-3 py-2 text-center">
                            <button
                              onClick={() => removeFromCart(item.sku)}
                              className="text-red-600 hover:text-red-800 text-xs font-semibold"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right Section: Bill Summary & Checkout */}
        <div className="space-y-4">
          <Card className="border-slate-200 shadow-sm bg-slate-50">
            <CardHeader>
              <CardTitle className="text-lg">Bill Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex justify-between text-sm text-slate-600">
                <span>Subtotal</span>
                <span className="font-semibold text-slate-900">Rs {subtotal}</span>
              </div>

              <div className="flex items-center justify-between text-sm text-slate-600">
                <span>Discount (%)</span>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={discount}
                  onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
                  className="w-24 h-9 bg-white text-right"
                />
              </div>

              {discount > 0 && (
                <div className="flex justify-between text-sm text-green-700">
                  <span>Discount Amount</span>
                  <span>- Rs {discountAmount.toFixed(2)}</span>
                </div>
              )}

              <div className="border-t border-slate-200 pt-3 flex justify-between items-center text-lg font-bold text-slate-900">
                <span>Grand Total</span>
                <span className="text-blue-600">Rs {grandTotal.toFixed(2)}</span>
              </div>

              <Button
                onClick={handleCheckoutComplete}
                disabled={loading || cart.length === 0}
                className="w-full h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold text-base mt-2"
              >
                {loading ? "Processing..." : "Complete Checkout & Print"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
