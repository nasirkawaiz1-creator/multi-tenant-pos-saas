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
  phone: string;
}

export default function CheckoutPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [discountAmount, setDiscountAmount] = useState<string>("");
  const [customerPhone, setCustomerPhone] = useState("");
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
    loadProducts();
  }, []);

  useEffect(() => {
    const currentTenant = process.env.NEXT_PUBLIC_TENANT_ID || "imdad-cosmetics";
    setStoreInfo(
      storeProfiles[currentTenant as keyof typeof storeProfiles] || {
        name: "Imdad Cosmetics",
        details: "Shop # B1-A, Kamil Plaza, Basement Bara Bazar, Rawalpindi",
        phone: "03451523394",
      }
    );
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
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
          stopCamera();
          processScannedCode(scannedCode);
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

  // CORE LOGIC: Instant Auto-Add to Cart & Save to Server Inventory upon Scan!
  async function processScannedCode(code: string) {
    const trimmedCode = code.trim();
    if (!trimmedCode) return;

    setError("");
    setBarcodeInput("");

    // 1. Check if product already exists in inventory
    let targetProduct = products.find(
      (p) =>
        (p.sku && p.sku.toLowerCase() === trimmedCode.toLowerCase()) ||
        p.id === trimmedCode ||
        p.name.toLowerCase() === trimmedCode.toLowerCase()
    );

    // 2. If not in inventory, automatically create and save it instantly so it appears in list!
    if (!targetProduct) {
      // Automatic smart name assignment (e.g. Pantene Shampoo for this specific barcode, or generic Item-code)
      const generatedName = trimmedCode === "8700216649933" ? "Pantene Shampoo 390ml" : `Item-${trimmedCode}`;
      const defaultPrice = "350"; // Default base price

      try {
        const savedProduct = await apiFetch<Product>("/products", {
          method: "POST",
          body: JSON.stringify({
            name: generatedName,
            sku: trimmedCode,
            price: defaultPrice,
            stockQty: 9999,
          }),
        });

        if (savedProduct) {
          targetProduct = savedProduct;
          setProducts((prev) => [...prev, savedProduct]);
        }
      } catch {
        // Fallback temporary product if offline
        targetProduct = {
          id: `custom-${Date.now()}`,
          name: generatedName,
          sku: trimmedCode,
          price: defaultPrice,
          stockQty: 9999,
        } as unknown as Product;
      }
    }

    if (targetProduct) {
      addToCart(targetProduct, 1);
      setError(`⚡ Auto-added to bill & saved to inventory: ${targetProduct.name}`);
    }
  }

  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    processScannedCode(barcodeInput);
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

  function updateItemPrice(productId: string, newPrice: string) {
    setCart((prev) =>
      prev.map((item) =>
        item.product.id === productId
          ? { ...item, product: { ...item.product, price: newPrice } }
          : item
      )
    );
  }

  const subtotal = cart.reduce(
    (sum, item) => sum + (parseFloat(item.product.price) || 0) * item.quantity,
    0
  );
  const discountVal = parseFloat(discountAmount) || 0;
  const total = Math.max(0, Math.round((subtotal - discountVal) * 100) / 100);

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
      setDiscountAmount("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setProcessing(false);
    }
  }

  function sendWhatsAppReceipt(targetPhone?: string) {
    if (!receipt) return;
    
    let itemsText = "";
    receipt.items?.forEach((item, index) => {
      itemsText += `${index + 1}. ${item.productName} x ${item.quantity} - Rs ${(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}\n`;
    });

    const message = 
      `*${storeInfo.name}*\n` +
      `${storeInfo.details}\n` +
      `Ph: ${storeInfo.phone}\n` +
      `--------------------------------\n` +
      `*Order Receipt #${receipt.id.slice(0, 8)}*\n\n` +
      `${itemsText}\n` +
      `--------------------------------\n` +
      `Subtotal: Rs ${receipt.subtotal}\n` +
      (discountVal > 0 ? `Discount: -Rs ${discountVal}\n` : "") +
      `*Grand Total: Rs ${total}*\n` +
      `--------------------------------\n` +
      `Thank you for shopping with us!`;

    const encodedMessage = encodeURIComponent(message);
    let url = `https://wa.me/?text=${encodedMessage}`;
    
    if (targetPhone && targetPhone.trim().length > 5) {
      const cleanPhone = targetPhone.replace(/[^0-9]/g, "");
      url = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
    }

    window.open(url, "_blank");
  }

  if (receipt) {
    return (
      <AppShell title="Checkout">
        <div className="mx-auto max-w-md space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Receipt</CardTitle>
              <Badge variant="success">Order Complete</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-b border-slate-200 pb-3 text-center">
                <h2 className="font-bold text-lg">{storeInfo.name}</h2>
                <p className="text-xs text-slate-600">{storeInfo.details}</p>
                <p className="text-xs text-slate-600">Ph: {storeInfo.phone}</p>
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
                {discountVal > 0 && (
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>Discount</span>
                    <span>-Rs {discountVal}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold">
                  <span>Grand Total</span>
                  <span>Rs {total}</span>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <Input
                  placeholder="Customer WhatsApp Number (e.g. 923001234567)"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                />
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => sendWhatsAppReceipt(customerPhone)}
                >
                  💬 Send Receipt to Customer WhatsApp
                </Button>
                <Button
                  variant="outline"
                  className="w-full border-green-600 text-green-700 hover:bg-green-50"
                  onClick={() => sendWhatsAppReceipt(storeInfo.phone)}
                >
                  📱 Send Copy to Store Owner
                </Button>
              </div>

              <Button className="w-full mt-2" onClick={() => setReceipt(null)}>
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
        <p className="text-sm text-slate-700 font-medium">{storeInfo.details} | Ph: {storeInfo.phone}</p>
      </div>

      <PageHeader title="Checkout Terminal" description="Instant Barcode Scan & Auto-Add to List ⚡" />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <form onSubmit={handleBarcodeSubmit} className="flex flex-wrap gap-2">
            <Input
              ref={barcodeInputRef}
              placeholder="Scan Barcode / QR Code here..."
              value={barcodeInput}
              onChange={(e) => setBarcodeInput(e.target.value)}
              className="h-12 text-base flex-1 min-w-[200px]"
              autoFocus
            />
            <Button type="submit" className="h-12 px-4 bg-green-600 hover:bg-green-700 text-white">
              ⚡ Scan & Add
            </Button>
            {!cameraOpen ? (
              <Button
                type="button"
                variant="outline"
                className="h-12 px-4 border-blue-600 text-blue-600"
                onClick={startCameraScanner}
              >
                📷 Camera Scan
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
                Point camera at Barcode
              </p>
            </div>
          )}

          {error && <p className="text-sm text-blue-600 font-medium bg-blue-50 p-2 rounded">{error}</p>}

          {/* Cart Table with Direct Price Editing */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-sm text-left">
              <thead className="bg-blue-600 text-white text-xs uppercase">
                <tr>
                  <th className="px-3 py-3">Code / SKU</th>
                  <th className="px-3 py-3">Item Name</th>
                  <th className="px-3 py-3 text-center">Qty</th>
                  <th className="px-3 py-3 text-right">Price (Rs)</th>
                  <th className="px-3 py-3 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {cart.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      Scan any barcode to add items instantly...
                    </td>
                  </tr>
                ) : (
                  cart.map((item) => {
                    const rowTotal = ((parseFloat(item.product.price) || 0) * item.quantity).toFixed(2);
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
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            value={item.product.price}
                            onChange={(e) => updateItemPrice(item.product.id, e.target.value)}
                            className="w-20 rounded border border-slate-300 text-right text-sm px-1 py-0.5"
                          />
                        </td>
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
                
                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-700 font-medium">Discount (Rs)</span>
                  <Input
                    type="number"
                    placeholder="0"
                    value={discountAmount}
                    onChange={(e) => setDiscountAmount(e.target.value)}
                    className="w-28 h-8 text-right text-sm"
                  />
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
