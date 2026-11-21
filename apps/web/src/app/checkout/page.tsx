"use client";

import { useEffect, useState, useRef } from "react";
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
  slug?: string;
  name: string;
  details: string;
  phone: string;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

let invoiceScope = "unscoped";
const INVOICE_SEED = 1;

function getTodayDateKey(dateObj: Date = new Date()): string {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatInvoiceNumber(num: number): string {
  return String(num).padStart(2, "0");
}

function getInvoiceStorageKey(scope: string = invoiceScope): string {
  const cleanScope = encodeURIComponent(
    String(scope || "unscoped").trim().toLowerCase()
  );
  return `pos:nextInvoiceNo:${cleanScope}`;
}

function readNextInvoice(scope: string = invoiceScope): number {
  try {
    const n = Number(localStorage.getItem(getInvoiceStorageKey(scope)));
    return Number.isInteger(n) && n >= INVOICE_SEED ? n : INVOICE_SEED;
  } catch {
    return INVOICE_SEED;
  }
}

export default function CheckoutPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [barcodeInput, setBarcodeInput] = useState("");
  const [itemNameInput, setItemNameInput] = useState("");
  const [qtyInput, setQtyInput] = useState("1");
  const [priceInput, setPriceInput] = useState("");
  const [discountAmount, setDiscountAmount] = useState<string>("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [receipt, setReceipt] = useState<Order | null>(null);
  const [receiptDate, setReceiptDate] = useState<string>(getTodayDateKey());
  const [receiptSubtotal, setReceiptSubtotal] = useState<number>(0);
  const [receiptDiscount, setReceiptDiscount] = useState<number>(0);
  const [receiptGrandTotal, setReceiptGrandTotal] = useState<number>(0);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [currentDateKey, setCurrentDateKey] = useState<string>(getTodayDateKey());
  const [invoiceNo, setInvoiceNo] = useState(formatInvoiceNumber(INVOICE_SEED));
  const [attendantName, setAttendantName] = useState("Nasir Farooq");

  const [micListening, setMicListening] = useState(false);
  const [micLang, setMicLang] = useState<"ur-PK" | "en-US">("ur-PK");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);
  const barcodeInputRef = useRef<HTMLInputElement>(null);

  const [storeInfo, setStoreInfo] = useState<StoreProfile>({
    name: "Loading Store...",
    details: "",
    phone: "",
  });

  function syncStoreState(scope: string, dateKey: string) {
    invoiceScope = scope;
    setCurrentDateKey(dateKey);
    setInvoiceNo(formatInvoiceNumber(readNextInvoice(scope)));
  }

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }
    loadProducts();
    loadStoreProfile();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const latestDate = getTodayDateKey();
      if (latestDate !== currentDateKey) {
        syncStoreState(invoiceScope, latestDate);
      }
    }, 30000);

    return () => clearInterval(interval);
  }, [currentDateKey]);

  useEffect(() => {
    return () => {
      stopCamera();
      try {
        recognitionRef.current?.stop();
      } catch {}
    };
  }, []);

  async function loadStoreProfile() {
    const today = getTodayDateKey();
    try {
      const res = await apiFetch<StoreProfile>("/stores/current");
      if (res && res.name) {
        const nextScope = res.slug || res.name;
        setStoreInfo(res);
        syncStoreState(nextScope, today);
        return;
      }
    } catch (err) {
      console.error("Failed to load store profile", err);
    }
    setStoreInfo({ name: "Store", details: "", phone: "" });
    syncStoreState(invoiceScope, today);
  }

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

  function stopCamera() {
    if (scanIntervalRef.current !== null) {
      window.clearInterval(scanIntervalRef.current);
      scanIntervalRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }

  async function startCameraScanner() {
    setError("");
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);

      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
      }, 100);

      const win = window as unknown as {
        BarcodeDetector?: new (opts?: { formats?: string[] }) => {
          detect: (
            source: HTMLVideoElement
          ) => Promise<Array<{ rawValue?: string }>>;
        };
      };

      if (win.BarcodeDetector) {
        const detector = new win.BarcodeDetector({
          formats: [
            "qr_code",
            "ean_13",
            "ean_8",
            "code_128",
            "code_39",
            "upc_a",
            "upc_e",
          ],
        });

        scanIntervalRef.current = window.setInterval(async () => {
          if (!videoRef.current || videoRef.current.readyState < 2) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0 && codes[0]?.rawValue) {
              const detected = codes[0].rawValue.trim();
              if (detected) {
                stopCamera();
                handleBarcodeScanned(detected);
              }
            }
          } catch {}
        }, 200);
      } else {
        setError(
          "⚡ لائیو کیمرہ کھلا ہے — کوڈ اسکین کریں یا نیچے QR/Barcode باکس و مائیک استعمال کریں۔"
        );
      }
    } catch {
      setError("Camera access denied or not supported on this browser.");
    }
  }

  function toggleMic() {
    if (micListening) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      setMicListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setError("اس براؤزر میں مائیک سپورٹ نہیں ہے؛ براہِ راست ٹائپ کریں۔");
      return;
    }

    const rec = new SpeechRec();
    rec.lang = micLang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event: SpeechRecognitionEventLike) => {
      const spoken = event.results?.[0]?.[0]?.transcript?.trim() || "";
      if (spoken) {
        setItemNameInput((prev) => (prev ? `${prev} ${spoken}`.trim() : spoken));
        setError(`🎤 مائیک سے لکھا گیا: "${spoken}"`);
      }
    };

    rec.onerror = () => {
      setMicListening(false);
      setError("مائیک سننے میں مسئلہ آیا، دوبارہ کوشش کریں۔");
    };

    rec.onend = () => {
      setMicListening(false);
    };

    recognitionRef.current = rec;
    setMicListening(true);
    setError(
      micLang === "ur-PK"
        ? "🎤 مائیک آن ہے — آئٹم کا نام بولیں..."
        : "🎤 Mic on — speak item name..."
    );

    try {
      rec.start();
    } catch {
      setMicListening(false);
      setError("مائیک شروع نہیں ہو سکا۔");
    }
  }

  function handleBarcodeScanned(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setBarcodeInput(trimmed);

    const found = products.find(
      (p) =>
        (p.sku && p.sku.toLowerCase() === trimmed.toLowerCase()) ||
        p.id === trimmed
    );

    if (found) {
      setItemNameInput(found.name);
      setPriceInput(found.price || "");
      setError(`⚡ Auto-matched: ${found.name}`);
    } else {
      setError(`⚡ Code "${trimmed}" ready — نام بولیں یا لکھیں اور Add & Save کریں۔`);
    }
  }

  async function handleAddAndSave(e: React.FormEvent) {
    e.preventDefault();
    const sku =
      barcodeInput.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
    const name = itemNameInput.trim() || `Item-${sku}`;
    const qty = parseInt(qtyInput, 10) || 1;
    const price = priceInput.trim() ? priceInput.trim() : "0";

    setError("");

    let targetProduct: Product | undefined = products.find(
      (p) => p.sku && p.sku.toLowerCase() === sku.toLowerCase()
    );

    if (!targetProduct) {
      try {
        const response = await apiFetch<Product | { data: Product }>(
          "/products",
          {
            method: "POST",
            body: JSON.stringify({
              name,
              sku,
              price,
              stockQty: 9999,
            }),
          }
        );

        const savedProduct =
          response && typeof response === "object" && "data" in response
            ? (response as { data: Product }).data
            : (response as Product);

        if (savedProduct && savedProduct.id) {
          targetProduct = savedProduct;
          setProducts((prev) => {
            const exists = prev.findIndex((p) => p.id === savedProduct.id);
            if (exists >= 0) {
              return prev.map((p) =>
                p.id === savedProduct.id ? savedProduct : p
              );
            }
            return [...prev, savedProduct];
          });
        }
      } catch (err) {
        console.error("Failed to save product to inventory server:", err);
        setError(
          "❌ پروڈکٹ سرور پر سیو کرنے میں خرابی ہوئی۔ براہ کرم انٹرنیٹ یا لاگ ان چیک کریں۔"
        );
        return;
      }
    }

    if (!targetProduct) {
      setError(
        "❌ آئٹم سرور پر محفوظ نہیں ہوئی، اس لیے کارٹ میں ایڈ نہیں کی گئی۔"
      );
      return;
    }

    addToCart(targetProduct, qty);
    await loadProducts();
    setError(
      `✔ آئٹم کامیابی کے ساتھ انوینٹری میں سیو اور کارٹ میں ایڈ ہو گئی ہے!`
    );

    setBarcodeInput("");
    setItemNameInput("");
    setQtyInput("1");
    setPriceInput("");
    if (barcodeInputRef.current) {
      barcodeInputRef.current.focus();
    }
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
  const total = Math.max(
    0,
    Math.round((subtotal - discountVal) * 100) / 100
  );

  async function completeSale() {
    if (cart.length === 0) return;
    setProcessing(true);
    setError("");

    const activeDate = getTodayDateKey();
    const activeScope = storeInfo.slug || storeInfo.name || invoiceScope;
    const finalSubtotal = Math.round(subtotal * 100) / 100;
    const finalDiscount = Math.round(discountVal * 100) / 100;
    const finalTotal = total;

    try {
      const order = await apiFetch<Order>("/orders", {
        method: "POST",
        body: JSON.stringify({
          items: cart.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            unitPrice: item.product.price,
          })),
          discount: finalDiscount,
          invoiceDate: activeDate,
        }),
      });

      const currentSeq = readNextInvoice(activeScope);
      const nextSeq = currentSeq + 1;
      const issuedInvoice = formatInvoiceNumber(currentSeq);
      const nextInvoiceFormatted = formatInvoiceNumber(nextSeq);

      try {
        localStorage.setItem(
          getInvoiceStorageKey(activeScope),
          String(nextSeq)
        );
      } catch {}

      invoiceScope = activeScope;
      setCurrentDateKey(activeDate);
      setReceiptDate(activeDate);
      setReceiptSubtotal(finalSubtotal);
      setReceiptDiscount(finalDiscount);
      setReceiptGrandTotal(finalTotal);
      setReceipt({
        ...order,
        id: issuedInvoice,
        subtotal:
          order?.subtotal !== undefined && Number(order.subtotal) > 0
            ? order.subtotal
            : finalSubtotal.toFixed(2),
      } as Order);
      setCart([]);
      setInvoiceNo(nextInvoiceFormatted);
      await loadProducts();
    } catch (err) {
      setError(
        `❌ سیل محفوظ نہیں ہوئی: ${
          err instanceof Error ? err.message : "Checkout failed"
        }`
      );
    } finally {
      setProcessing(false);
    }
  }

  function sendWhatsAppReceipt(targetPhone?: string) {
    if (!receipt) return;

    let itemsText = "";
    receipt.items?.forEach((item, index) => {
      itemsText += `${index + 1}. ${item.productName} (${item.unitPrice} x ${
        item.quantity
      }) - Rs ${(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}\n`;
    });

    const displaySubtotal =
      receiptSubtotal > 0
        ? receiptSubtotal.toFixed(2)
        : String(receipt.subtotal ?? "0.00");

    const message =
      `*${storeInfo.name}*\n` +
      `${storeInfo.details}\n` +
      `Ph: ${storeInfo.phone}\n` +
      `Date: ${receiptDate}\n` +
      `--------------------------------\n` +
      `*Bill #${receipt.id}* (Attendant: ${attendantName})\n\n` +
      `${itemsText}\n` +
      `--------------------------------\n` +
      `Subtotal: Rs ${displaySubtotal}\n` +
      (receiptDiscount > 0
        ? `Discount: -Rs ${receiptDiscount.toFixed(2)}\n`
        : "") +
      `*Grand Total: Rs ${receiptGrandTotal.toFixed(2)}*\n` +
      `--------------------------------\n` +
      `Thank you for shopping with us! (Admin: ${storeInfo.phone})`;

    const encodedMessage = encodeURIComponent(message);
    let url = `https://wa.me/?text=${encodedMessage}`;

    if (targetPhone && targetPhone.trim().length > 5) {
      const cleanPhone = targetPhone.replace(/[^0-9]/g, "");
      url = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
    }

    window.open(url, "_blank");
  }

  if (receipt) {
    const displaySubtotal =
      receiptSubtotal > 0
        ? receiptSubtotal.toFixed(2)
        : String(receipt.subtotal ?? "0.00");

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
                <p className="text-xs text-slate-600">
                  Ph: {storeInfo.phone} | Date: {receiptDate}
                </p>
              </div>
              <div className="flex justify-between text-sm text-slate-500">
                <span>Bill #{receipt.id}</span>
                <span>Attendant: {attendantName}</span>
              </div>
              <div className="divide-y divide-slate-100">
                {receipt.items?.map((item) => (
                  <div
                    key={item.id}
                    className="flex justify-between py-2 text-sm font-mono"
                  >
                    <span>
                      {item.productName} {item.unitPrice} x {item.quantity}
                    </span>
                    <span className="font-bold">
                      Rs {(parseFloat(item.unitPrice) * item.quantity).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="space-y-1 border-t border-slate-200 pt-4 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>Rs {displaySubtotal}</span>
                </div>
                {receiptDiscount > 0 && (
                  <div className="flex justify-between text-green-600 font-medium">
                    <span>Discount</span>
                    <span>-Rs {receiptDiscount.toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between text-lg font-bold">
                  <span>Grand Total</span>
                  <span className="text-blue-600">
                    Rs {receiptGrandTotal.toFixed(2)}
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <Input
                  placeholder="Customer WhatsApp Number (e.g. 923001234567)"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                />
                <Button
                  className="w-full bg-green-600 hover:bg-green-700 text-white font-bold"
                  onClick={() => sendWhatsAppReceipt(customerPhone)}
                >
                  💬 Send Receipt to Customer WhatsApp
                </Button>
                <Button
                  variant="outline"
                  className="w-full border-green-600 text-green-700 hover:bg-green-50 font-bold"
                  onClick={() => sendWhatsAppReceipt(storeInfo.phone)}
                >
                  📱 Send Copy to Store Owner ({storeInfo.phone})
                </Button>
              </div>

              <Button
                className="w-full mt-2"
                onClick={() => {
                  setReceipt(null);
                  setDiscountAmount("");
                  setReceiptSubtotal(0);
                  setReceiptDiscount(0);
                  setReceiptGrandTotal(0);
                }}
              >
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
      <div className="mb-4 border-b border-slate-200 pb-3 flex flex-wrap justify-between items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{storeInfo.name}</h1>
          <p className="text-sm text-slate-700 font-medium">
            {storeInfo.details} | Ph: {storeInfo.phone} | Date: {currentDateKey}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span>Attendant:</span>
          <input
            type="text"
            value={attendantName}
            onChange={(e) => setAttendantName(e.target.value)}
            className="px-2 py-1 border border-slate-300 rounded text-sm w-32 font-semibold"
          />
        </div>
      </div>

      <PageHeader
        title={`Checkout Terminal (Bill #${invoiceNo} • ${currentDateKey})`}
        description="Instant QR / Barcode + Voice Mic Entry (No n8n Delay) ⚡"
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap gap-2">
            <Input
              ref={barcodeInputRef}
              placeholder="Scan Barcode / QR Code..."
              value={barcodeInput}
              onChange={(e) => handleBarcodeScanned(e.target.value)}
              className="h-12 text-base flex-1 min-w-[200px]"
              autoFocus
            />
            <Button
              type="button"
              onClick={() => handleBarcodeScanned(barcodeInput)}
              className="h-12 px-6 bg-slate-900 hover:bg-slate-800 text-white font-medium"
            >
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
          </div>

          {cameraOpen && (
            <div className="space-y-2 overflow-hidden rounded-xl border-2 border-blue-500 bg-black p-2">
              <video
                ref={videoRef}
                className="w-full max-h-64 rounded object-cover"
                playsInline
                muted
              />
              <p className="text-white text-xs">
                QR یا Barcode کیمرے کے سامنے رکھیں — خود بخود اسکین ہو جائے گا
              </p>
            </div>
          )}

          <form
            onSubmit={handleAddAndSave}
            className="space-y-3 p-4 rounded-xl border border-slate-200 bg-slate-50"
          >
            <div className="flex gap-2">
              <Input
                placeholder="Item Name (Voice / Copy / Auto-fills on scan)..."
                value={itemNameInput}
                onChange={(e) => setItemNameInput(e.target.value)}
                className="h-12 text-base bg-white font-medium flex-1"
                required
              />
              <Button
                type="button"
                variant="outline"
                className="h-12 px-3 text-xs font-semibold border-slate-300 text-slate-700"
                onClick={() =>
                  setMicLang((prev) => (prev === "ur-PK" ? "en-US" : "ur-PK"))
                }
              >
                {micLang === "ur-PK" ? "UR" : "EN"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={toggleMic}
                aria-label="Voice Mic"
                className={
                  micListening
                    ? "h-12 px-4 border-red-500 bg-red-50 text-red-700 font-bold"
                    : "h-12 px-4 border-slate-300 text-slate-700"
                }
              >
                {micListening ? "⏹" : "🎤"}
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Input
                type="number"
                min="1"
                placeholder="Qty"
                value={qtyInput}
                onChange={(e) => setQtyInput(e.target.value)}
                className="h-12 text-base bg-white"
                required
              />
              <Input
                type="number"
                placeholder="Price (Rs)"
                value={priceInput}
                onChange={(e) => setPriceInput(e.target.value)}
                className="h-12 text-base bg-white"
              />
            </div>

            <Button
              type="submit"
              className="w-full h-12 bg-green-600 hover:bg-green-700 text-white font-bold text-base shadow-sm"
            >
              + Add & Save
            </Button>
          </form>

          {error && (
            <p className="text-sm text-blue-600 font-medium bg-blue-50 p-2 rounded">
              {error}
            </p>
          )}

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
                    <td
                      colSpan={5}
                      className="px-4 py-8 text-center text-slate-400"
                    >
                      Scan QR / barcode or use voice mic to add items instantly...
                    </td>
                  </tr>
                ) : (
                  cart.map((item) => {
                    const rowTotal = (
                      (parseFloat(item.product.price) || 0) * item.quantity
                    ).toFixed(2);
                    return (
                      <tr key={item.product.id}>
                        <td className="px-3 py-2 text-xs font-mono text-slate-600">
                          {item.product.sku}
                        </td>
                        <td className="px-3 py-2 font-medium text-slate-900">
                          {item.product.name}
                        </td>
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
                                setExactQty(
                                  item.product.id,
                                  parseInt(e.target.value) || 0
                                )
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
                            onChange={(e) =>
                              updateItemPrice(item.product.id, e.target.value)
                            }
                            className="w-20 rounded border border-slate-300 text-right text-sm px-1 py-0.5"
                          />
                        </td>
                        <td className="px-3 py-2 text-right font-bold">
                          {rowTotal}
                        </td>
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
              <CardTitle>Bill Summary (#{invoiceNo})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span>Rs {subtotal.toFixed(2)}</span>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-slate-700 font-medium">
                    Discount (Rs)
                  </span>
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
                  <span className="text-blue-600">Rs {total.toFixed(2)}</span>
                </div>
              </div>

              <Button
                size="lg"
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold"
                onClick={completeSale}
                disabled={processing || cart.length === 0}
              >
                {processing ? "Processing..." : "Complete Sale & Print"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
