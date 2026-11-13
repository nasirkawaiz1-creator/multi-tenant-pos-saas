"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getToken } from "@pos/api-client";
import type { Order, Product } from "@pos/types";
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

interface CartItem {
  product: Product;
  quantity: number;
}

interface StoreProfile {
  name: string;
  details: string;
}

const TAX_RATE = 0.08;

export default function CheckoutPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customQty, setCustomQty] = useState<number>(1);
  const [results, setResults] = useState<Product[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const [storeInfo, setStoreInfo] = useState<StoreProfile>({
    name: "Imdad Cosmetics",
    details: "Shop # B1-A, Kamil Plaza, Basement Bara Bazar, Rawalpindi | Ph: 03451523394",
  });

  const storeProfiles: Record<string, StoreProfile> = {
    "imdad-cosmetics": {
      name: "Imdad Cosmetics",
      details: "Shop # B1-A, Kamil Plaza, Basement Bara Bazar, Rawalpindi | Ph: 03451523394",
    },
  };

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
    }
  }, []);

  useEffect(() => {
    const currentTenant = process.env.NEXT_PUBLIC_TENANT_ID || "imdad-cosmetics";
    setStoreInfo(
      storeProfiles[currentTenant as keyof typeof storeProfiles] || {
        name: "Imdad Cosmetics",
        details: "Shop # B1-A, Kamil Plaza, Basement Bara Bazar, Rawalpindi | Ph: 03451523394",
      }
    );
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      return;
    }

    const timer = setTimeout(() => {
      apiFetch<{ data: Product[] }>(`/products/search?q=${encodeURIComponent(search)}`)
        .then((res) => setResults(res.data))
        .catch(() => setResults([]));
    }, 300);

    return () => clearTimeout(timer);
  }, [search]);

  async function startCameraScanner() {
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      streamRef.current = stream;
      setCameraOpen(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
        detectBarcodeLoop();
      }, 200);
    } catch {
      setError("Camera access denied or not supported on this browser.");
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }

  async function detectBarcodeLoop() {
    if (!("BarcodeDetector" in window)) {
      setError("Live camera BarcodeDetector not supported in this browser; please use handheld scanner.");
      return;
    }

    // @ts-expect-error BarcodeDetector experimental support
    const detector = new window.BarcodeDetector({
      formats: ["qr_code", "ean_13", "ean_8", "code_128", "code_39", "upc_a", "upc_e"],
    });

    const scanFrame = async () => {
      if (!videoRef.current || !streamRef.current) return;
      try {
        const barcodes = await detector.detect(videoRef.current);
        if (barcodes.length > 0 && barcodes[0].rawValue) {
          const scannedCode = barcodes[0].rawValue;
          setBarcodeInput(scannedCode);
          stopCamera();
          await lookupAndAddBarcode(scannedCode);
          return;
        }
      } catch {
        // Ignore single frame error
      }
      if (streamRef.current) {
        requestAnimationFrame(scanFrame);
      }
    };

    requestAnimationFrame(scanFrame);
  }

  async function lookupAndAddBarcode(code: string) {
    if (!code.trim()) return;
    try {
      const res = await apiFetch<{ data: Product[] }>(
        `/products/search?q=${encodeURIComponent(code.trim())}`
      );
      if (res.data && res.data.length > 0) {
        addToCart(res.data[0], 1);
        setBarcodeInput("");
        setError("");
      } else {
        setError(`Barcode (${code}) not in inventory — enter Name, Qty & Price below.`);
      }
    } catch {
      setError("Failed to lookup barcode");
    }
  }

  async function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    await lookupAndAddBarcode(barcodeInput);
  }

  function handleAddCustomItem() {
    if (!customName.trim() || !customPrice) return;
    const qtyToAdd = customQty > 0 ? customQty : 1;
    const customProduct: Product = {
      id: `custom-${Date.now()}`,
      name: customName.trim(),
      sku: barcodeInput.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
      price: customPrice,
      stockQty: 9999,
    };
    addToCart(customProduct, qtyToAdd);
    setCustomName("");
    setCustomPrice("");
    setCustomQty(1);
    setBarcodeInput("");
    setError("");
  }

  function addToCart(product: Product, qtyToAdd: number = 1) {
    setCart((prev) => {
      const existing = prev.find((item) => item.product.id === product.id);
      if (existing) {
        return prev.map((item) =>
          item.product.id === product.id
            ? { ...item, quantity: item.quantity + qtyToAdd }
            : item
        );
      }
      return [...prev, { product, quantity: qtyToAdd }];
    });
    setSearch("");
    setResults([]);
  }

  function updateQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((item) =>
          item.product.id === productId
            ? { ...item, quantity: item.quantity + delta }
            : item
        )
        .filter((item) => item.quantity > 0)
    );
  }

  function setExactQty(productId: string, newQty: number) {
    if (newQty <= 0) {
      setCart((prev) => prev.filter((item) => item.product.id !== productId));
      return;
    }
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId ? { ...item, quantity: newQty } : item
      )
    );
  }

  const subtotal = cart.reduce(
    (sum, item) => sum + parseFloat(item.product.price) * item.quantity,
    0
  );
  const tax = Math.round(subtotal * TAX_RATE * 100) / 100;
  const total = Math.round((subtotal + tax) * 100) / 100;

  async function completeSale() {
    if (cart.length === 0) return;
    setProcessing(true);
    setError("");

    try {
      const order = await apiFetch<Order>("/orders", {
        method: "POST",
        body: JSON.stringify({
          items: cart.map((item) => ({
            productId: item.product.id.startsWith("custom-") ? undefined : item.product.id,
            quantity: item.quantity,
          })),
        }),
      });
      setReceipt(order);
      setCart([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setProcessing(false);
    }
  }

  if (receipt) {
    return (
      <AppShell title="Checkout">
        <div className="mx-auto max-w-md">
          <Card>
            <CardHeader>
              <CardTitle>Receipt</CardTitle>
              <Badge variant="success">Order Complete</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-b border-slate-200 pb-3 text-center">
                <h2 className="font-bold text-lg">{storeInfo.name}</h2>
                <p className="text-xs text-slate-600">{storeInfo.details}</p>
              </div>
              <p className="text-sm text-slate-500">Order #{receipt.id.slice(0, 8)}</p>
              <div className="divide-y divide-slate-100">
                {receipt.items?.map((item) => (
                  <div key={item.id} className="flex justify-between py-2 text-sm">
                    <span>
                      {item.productName} × {item.quantity}
                    </span>
                    <span>Rs {(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-1 border-t border-slate-200 pt-4 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>Rs {receipt.subtotal}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax (8%)</span>
                  <span>Rs {receipt.tax}</span>
                </div>
                <div className="flex justify-between text-lg font-bold">
                  <span>Total</span>
                  <span>Rs {receipt.total}</span>
                </div>
              </div>
              <Button className="w-full" onClick={() => setReceipt(null)}>
                New Sale
              </Button>
            </CardContent>
          </Card>
        </div>
      </AppShell>
    );
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
      <div className="mb-4 border-b border-slate-200 pb-3">
        <h1 className="text-2xl font-bold text-slate-900">{storeInfo.name}</h1>
        <p className="text-sm text-slate-700 font-medium">{storeInfo.details}</p>
      </div>

      <PageHeader title="Checkout Terminal" description="Scan QR/Barcode or add wholesale items" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <form onSubmit={handleBarcodeSubmit} className="flex flex-wrap gap-2">
            <Input
              ref={barcodeInputRef}
              placeholder="Scan Barcode / QR Code..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              className="h-12 text-base flex-1 min-w-[200px]"
              autoFocus
            />
            <Button type="submit" className="h-12 px-4">
              Add Code
            </Button>
            {!cameraOpen ? (
              <Button
                type="button"
                variant="outline"
                className="h-12 px-4 border-blue-600 text-blue-600"
                onClick={startCameraScanner}
              >
                📷 Camera Scan (QR/Barcode)
              </Button>
            ) : (
              <Button
                type="button"
                variant="destructive"
                className="h-12 px-4"
                onClick={stopCamera}
              >
                ✕ Close Camera
              </Button>
            )}
          </form>

          {cameraOpen && (
            <div className="relative overflow-hidden rounded-xl border-2 border-blue-500 bg-black">
              <video ref={videoRef} className="w-full max-h-64 object-cover" playsInline muted />
              <p className="bg-blue-600 text-white text-center text-xs py-1">
                Point camera at QR Code or Barcode
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="sm:col-span-5">
              <Input
                placeholder="Item Name..."
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                placeholder="Qty"
                type="number"
                min={1}
                value={customQty}
                onChange={(e) => setCustomQty(parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="sm:col-span-3">
              <Input
                placeholder="Price (Rs)"
                type="number"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="button" onClick={handleAddCustomItem} className="w-full bg-green-600 hover:bg-green-700 text-white">
                + Add
              </Button>
            </div>
          </div>

          <Input
            placeholder="Search saved products by name or SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-12"
          />

          {results.length > 0 && (
            <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100 shadow-sm">
              {results.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-50"
                  onClick={() => addToCart(product, 1)}
                >
                  <div>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-slate-500">Code: {product.sku}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">Rs {product.price}</p>
                    <p className="text-xs text-slate-500">Stock: {product.stockQty}</p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {error && <p className="text-sm text-red-600 font-medium bg-red-50 p-2 rounded">{error}</p>}

          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm text-left">
              <thead className="bg-blue-600 text-white text-xs uppercase">
                <tr>
                  <th className="px-3 py-3">Code</th>
                  <th className="px-3 py-3">Item Name</th>
                  <th className="px-3 py-3 text-center">Qty</th>
                  <th className="px-3 py-3 text-right">Price (Rs)</th>
                  <th className="px-3 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {cart.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-400">
                      No items added yet
                    </td>
                  </tr>
                ) : (
                  cart.map((item) => {
                    const rowTotal = (parseFloat(item.product.price) * item.quantity).toFixed(2);
                    return (
                      <tr key={item.product.id}>
                        <td className="px-3 py-2 text-xs text-slate-500">{item.product.sku}</td>
                        <td className="px-3 py-2 font-medium">{item.product.name}</td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center gap-1">
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() => updateQty(item.product.id, -1)}
                            >
                              −
                            </Button>
                            <input
                              type="number"
                              min={1}
                              value={item.quantity}
                              onChange={(e) =>
                                setExactQty(item.product.id, parseInt(e.target.value) || 0)
                              }
                              className="w-12 rounded border border-slate-300 text-center text-sm font-bold py-0.5"
                            />
                            <Button
                              size="icon"
                              variant="outline"
                              className="h-7 w-7"
                              onClick={() => updateQty(item.product.id, 1)}
                            >
                              +
                            </Button>
                          </div>
                        </td>
                        <td className="px-3 py-2 text-right">{item.product.price}</td>
                        <td className="px-3 py-2 text-right font-bold">{rowTotal}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <Card>
            <CardHeader>
              <CardTitle>Bill Summary ({cart.length} Items)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>Rs {subtotal.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Tax (8%)</span>
                  <span>Rs {tax.toFixed(2)}</span>
                </div>
                <div className="flex justify-between border-t pt-2 text-lg font-bold">
                  <span>Grand Total</span>
                  <span>Rs {total.toFixed(2)}</span>
                </div>
              </div>

              <Button
                size="lg"
                className="w-full"
                onClick={completeSale}
                disabled={processing || cart.length === 0}
              >
                {processing ? "Processing..." : "Complete Sale"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
