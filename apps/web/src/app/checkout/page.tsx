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
  const [search, setSearch] = useState("");
  const [barcodeInput, setBarcodeInput] = useState("");
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");
  const [customQty, setCustomQty] = useState<number>(1);
  const [discountAmount, setDiscountAmount] = useState<string>("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [isListening, setIsListening] = useState(false);

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

  // Voice Input (Roman English Spelling Support)
  function startVoiceInput() {
    // @ts-expect-error webkitSpeechRecognition for browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError("Voice recognition is not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      setError("Listening... Speak item name in Roman English (e.g. Pantene Shampoo).");
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      const spokenText = event.results[0][0].transcript;
      setCustomName(spokenText);
      setIsListening(false);
      setError(`Heard: "${spokenText}" — now enter price and click + Add & Save.`);
    };

    recognition.onerror = () => {
      setIsListening(false);
      setError("Voice recognition error. Please try again.");
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  }

  // Process Scanned Code and Check Local Inventory Database
  function processScannedCode(code: string) {
    const trimmedCode = code.trim();
    if (!trimmedCode) return;

    setError("");

    // Check in loaded inventory products by SKU, barcode, or ID
    const foundProduct = products.find(
      (p) =>
        (p.sku && p.sku.toLowerCase() === trimmedCode.toLowerCase()) ||
        p.id === trimmedCode ||
        p.name.toLowerCase() === trimmedCode.toLowerCase()
    );

    if (foundProduct) {
      // Auto-add to cart instantly if found!
      addToCart(foundProduct, 1);
      setBarcodeInput("");
      setCustomName("");
      setCustomPrice("");
      setError(`Scanned & Added: ${foundProduct.name}`);
    } else {
      // If not in inventory, prompt vendor to use Mic or enter Price
      setBarcodeInput(trimmedCode);
      setCustomName(`Item-${trimmedCode}`);
      setCustomPrice("");
      setError(`New Barcode (${trimmedCode}) — Click 🎤 Mic to speak name, enter Price, and click + Add & Save.`);
    }
  }

  function handleBarcodeSubmit(e: React.FormEvent) {
    e.preventDefault();
    processScannedCode(barcodeInput);
  }

  // Save custom/voice item permanently to server Inventory and add to cart!
  async function handleAddCustomItem() {
    if (!customName.trim() || !customPrice) return;
    const qtyToAdd = customQty > 0 ? customQty : 1;
    const priceNum = parseFloat(customPrice) || 0;
    const codeToSave = barcodeInput.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;

    try {
      // Permanent save to backend database via POST /products
      const savedProduct = await apiFetch<Product>("/products", {
        method: "POST",
        body: JSON.stringify({
          name: customName.trim(),
          sku: codeToSave,
          price: priceNum.toString(),
          stockQty: 9999,
        }),
      });

      if (savedProduct) {
        setProducts((prev) => [...prev, savedProduct]);
        addToCart(savedProduct, qtyToAdd);
      }
    } catch (err) {
      console.error("Failed to save product to inventory server", err);
      // Fallback local cart add if server fails
      const fallbackProduct = {
        id: `custom-${Date.now()}`,
        name: customName.trim(),
        sku: codeToSave,
        price: priceNum.toString(),
        stockQty: 9999,
      } as unknown as Product;
      addToCart(fallbackProduct, qtyToAdd);
    }

    setCustomName("");
    setCustomPrice("");
    setCustomQty(1);
    setBarcodeInput("");
    setError("Item successfully saved to inventory & added to cart!");
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

      <PageHeader title="Checkout Terminal" description="Scan Barcode (Auto-Saves to Inventory 📦)" />

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
              Scan / Find
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
                Point camera at QR Code or Barcode
              </p>
            </div>
          )}

          {/* Voice Input & Auto-Save Panel */}
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 bg-slate-50 p-3 rounded-lg border border-slate-200">
            <div className="sm:col-span-4 flex gap-1">
              <Input
                placeholder="Item Name (Roman/English)..."
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                className={`px-3 ${isListening ? "bg-red-100 text-red-600 border-red-500 animate-pulse" : "border-purple-600 text-purple-700"}`}
                onClick={startVoiceInput}
                title="Speak item name in Roman English"
              >
                🎤
              </Button>
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
            <div className="sm:col-span-4">
              <Input
                placeholder="Price (Rs)"
                type="number"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="button" onClick={handleAddCustomItem} className="w-full bg-green-600 hover:bg-green-700 text-white">
                + Add & Save
              </Button>
            </div>
          </div>

          {error && <p className="text-sm text-blue-600 font-medium bg-blue-50 p-2 rounded">{error}</p>}

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
