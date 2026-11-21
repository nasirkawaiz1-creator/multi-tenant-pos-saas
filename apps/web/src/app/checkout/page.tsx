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

const N8N_PRODUCT_SCAN_WEBHOOK_URL =
  "https://primary-production-34a63.up.railway.app/webhook/store-onboarding";

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

interface DailyLedgerEntry {
  date: string;
  invoiceCount: number;
  lastInvoiceNo: string;
  lastBillAmount: number;
  totalSales: number;
}

// ہر دکان کا الگ بل نمبر 01, 02, 03, 04... سے شروع کرنے کے لیے
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

function getLedgerStorageKey(
  scope: string = invoiceScope,
  dateKey: string = getTodayDateKey()
): string {
  const cleanScope = encodeURIComponent(
    String(scope || "unscoped").trim().toLowerCase()
  );
  return `pos:dailyLedger:${cleanScope}:${dateKey}`;
}

function getLedgerIndexStorageKey(scope: string = invoiceScope): string {
  const cleanScope = encodeURIComponent(
    String(scope || "unscoped").trim().toLowerCase()
  );
  return `pos:dailyLedgerDates:${cleanScope}`;
}

function readNextInvoice(scope: string = invoiceScope): number {
  try {
    const n = Number(localStorage.getItem(getInvoiceStorageKey(scope)));
    return Number.isInteger(n) && n >= INVOICE_SEED ? n : INVOICE_SEED;
  } catch {
    return INVOICE_SEED;
  }
}

function readLedgerDates(scope: string = invoiceScope): string[] {
  try {
    const raw = localStorage.getItem(getLedgerIndexStorageKey(scope));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map(String);
      }
    }
  } catch {}
  return [];
}

function readLedgerEntry(
  scope: string = invoiceScope,
  dateKey: string = getTodayDateKey()
): DailyLedgerEntry | null {
  try {
    const raw = localStorage.getItem(getLedgerStorageKey(scope, dateKey));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DailyLedgerEntry>;
      return {
        date: dateKey,
        invoiceCount: Number(parsed.invoiceCount) || 0,
        lastInvoiceNo: String(parsed.lastInvoiceNo || "--"),
        lastBillAmount: Number(parsed.lastBillAmount) || 0,
        totalSales: Number(parsed.totalSales) || 0,
      };
    }
  } catch {}
  return null;
}

function getSortedLedger(scope: string = invoiceScope): DailyLedgerEntry[] {
  const dates = Array.from(new Set(readLedgerDates(scope))).sort((a, b) =>
    b.localeCompare(a)
  );
  const rows: DailyLedgerEntry[] = [];
  for (const d of dates) {
    const entry = readLedgerEntry(scope, d);
    if (entry) {
      rows.push(entry);
    }
  }
  return rows;
}

function recordSaleInLedger(
  scope: string,
  amount: number,
  dateKey: string = getTodayDateKey()
): {
  issuedInvoice: string;
  nextInvoiceFormatted: string;
  todayEntry: DailyLedgerEntry;
  ledgerList: DailyLedgerEntry[];
} {
  const currentSeq = readNextInvoice(scope);
  const nextSeq = currentSeq + 1;
  const issuedInvoice = formatInvoiceNumber(currentSeq);
  const nextInvoiceFormatted = formatInvoiceNumber(nextSeq);

  const existing = readLedgerEntry(scope, dateKey) || {
    date: dateKey,
    invoiceCount: 0,
    lastInvoiceNo: issuedInvoice,
    lastBillAmount: 0,
    totalSales: 0,
  };

  const roundedAmount = Math.round(amount * 100) / 100;

  const updatedEntry: DailyLedgerEntry = {
    date: dateKey,
    invoiceCount: existing.invoiceCount + 1,
    lastInvoiceNo: issuedInvoice,
    lastBillAmount: roundedAmount,
    totalSales: Math.round((existing.totalSales + roundedAmount) * 100) / 100,
  };

  const updatedDates = Array.from(new Set([...readLedgerDates(scope), dateKey]));

  try {
    localStorage.setItem(getInvoiceStorageKey(scope), String(nextSeq));
    localStorage.setItem(
      getLedgerStorageKey(scope, dateKey),
      JSON.stringify(updatedEntry)
    );
    localStorage.setItem(
      getLedgerIndexStorageKey(scope),
      JSON.stringify(updatedDates)
    );
  } catch {}

  return {
    issuedInvoice,
    nextInvoiceFormatted,
    todayEntry: updatedEntry,
    ledgerList: getSortedLedger(scope),
  };
}

export default function CheckoutPage() {
  const router = useRouter();
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
  const [processing, setProcessing] = useState(false);
  const [scanningPhoto, setScanningPhoto] = useState(false);
  const [error, setError] = useState("");
  const [currentDateKey, setCurrentDateKey] = useState<string>(getTodayDateKey());
  const [invoiceNo, setInvoiceNo] = useState(formatInvoiceNumber(INVOICE_SEED));
  const [ledgerList, setLedgerList] = useState<DailyLedgerEntry[]>([]);
  const [attendantName, setAttendantName] = useState("Nasir Farooq");

  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
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
    setLedgerList(getSortedLedger(scope));
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

  async function captureAndScanProductPhoto() {
    if (!videoRef.current || scanningPhoto) return;

    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    setScanningPhoto(true);
    setError("📷 تصویر n8n کو بھیجی جا رہی ہے...");

    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          setScanningPhoto(false);
          setError("❌ تصویر کیپچر نہیں ہو سکی، دوبارہ کوشش کریں۔");
          return;
        }

        try {
          const formData = new FormData();
          formData.append("image", blob, "product-scan.jpg");
          formData.append("scan_type", "product");
          formData.append("token", getToken() ?? "");

          const res = await fetch(N8N_PRODUCT_SCAN_WEBHOOK_URL, {
            method: "POST",
            body: formData,
          });

          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }

          const raw = await res.json();
          const payload = Array.isArray(raw) ? raw[0] : raw;

          const extractedName = String(
            payload?.product_name ?? payload?.name ?? ""
          ).trim();
          const extractedBarcode = String(
            payload?.barcode ?? payload?.sku ?? ""
          ).trim();

          if (extractedName) {
            setItemNameInput(extractedName);
          }
          if (extractedBarcode) {
            setBarcodeInput(extractedBarcode);
            const matched = products.find(
              (p) =>
                (p.sku &&
                  p.sku.toLowerCase() === extractedBarcode.toLowerCase()) ||
                p.id === extractedBarcode
            );
            if (matched?.price && !priceInput) {
              setPriceInput(matched.price);
            }
          }

          stopCamera();
          setError(
            `✔ اسکین مکمل: ${extractedName || "نام نہیں ملا"} | بار کوڈ: ${
              extractedBarcode || "نہیں ملا"
            }`
          );
        } catch (err) {
          console.error("n8n product scan failed:", err);
          setError(
            `❌ n8n سے جواب نہیں آیا (${
              err instanceof Error ? err.message : "نامعلوم"
            })، ویب ہک یا انٹرنیٹ چیک کریں۔`
          );
        } finally {
          setScanningPhoto(false);
        }
      },
      "image/jpeg",
      0.85
    );
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

    try {
      const order = await apiFetch<Order>("/orders", {
        method: "POST",
        body: JSON.stringify({
          items: cart.map((item) => ({
            productId: item.product.id,
            quantity: item.quantity,
            unitPrice: item.product.price,
          })),
          discount: discountVal,
          invoiceDate: activeDate,
        }),
      });

      const recorded = recordSaleInLedger(activeScope, total, activeDate);
      invoiceScope = activeScope;
      setCurrentDateKey(activeDate);
      setReceiptDate(activeDate);
      setReceipt({ ...order, id: recorded.issuedInvoice } as Order);
      setLedgerList(recorded.ledgerList);
      setCart([]);
      setInvoiceNo(recorded.nextInvoiceFormatted);
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

    const message =
      `*${storeInfo.name}*\n` +
      `${storeInfo.details}\n` +
      `Ph: ${storeInfo.phone}\n` +
      `Date: ${receiptDate}\n` +
      `--------------------------------\n` +
      `*Bill #${receipt.id}* (Attendant: ${attendantName})\n\n` +
      `${itemsText}\n` +
      `--------------------------------\n` +
      `Subtotal: Rs ${receipt.subtotal}\n` +
      (discountVal > 0 ? `Discount: -Rs ${discountVal}\n` : "") +
      `*Grand Total: Rs ${total}*\n` +
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

  const todaySummary = ledgerList.find(
    (item) => item.date === currentDateKey
  ) || {
    date: currentDateKey,
    invoiceCount: 0,
    lastInvoiceNo: "--",
    lastBillAmount: 0,
    totalSales: 0,
  };

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
                  <span className="text-blue-600">Rs {total}</span>
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
        description="Scan Barcode (Auto-Fills Name & Saves to Inventory) 📦"
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
              <canvas ref={canvasRef} className="hidden" />
              <div className="flex items-center justify-between gap-2">
                <p className="text-white text-xs">
                  Point camera at product name & barcode, then tap Capture
                </p>
                <Button
                  type="button"
                  onClick={captureAndScanProductPhoto}
                  disabled={scanningPhoto}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
                >
                  {scanningPhoto ? "Scanning..." : "📸 Capture Product Photo"}
                </Button>
              </div>
            </div>
          )}

          <form
            onSubmit={handleAddAndSave}
            className="space-y-3 p-4 rounded-xl border border-slate-200 bg-slate-50"
          >
            <div>
              <Input
                placeholder="Item Name (Auto-fills on scan)..."
                value={itemNameInput}
                onChange={(e) => setItemNameInput(e.target.value)}
                className="h-12 text-base bg-white font-medium"
                required
              />
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

          {/* آئٹمز ٹیبل اور اس کے بالکل نیچے روزانہ کے بل اور ڈے کلوزنگ ٹوٹل کا حساب */}
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="overflow-x-auto">
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
                        Scan barcode or capture product photo to add instantly...
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

            {/* ٹیبل کے بالکل نیچے آج کی تاریخ، بل کی رقم، اور پورے دن کا کلوزنگ حساب */}
            <div className="border-t border-slate-200 bg-slate-900 text-white p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 pb-2">
                <span className="text-xs font-bold uppercase tracking-wide text-slate-200">
                  Daily Checkout Detail ({storeInfo.name})
                </span>
                <span className="text-xs font-mono text-blue-300">
                  Date: {currentDateKey} | Next Bill: #{invoiceNo}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="rounded-lg bg-slate-800 p-2.5">
                  <div className="text-slate-400">Today Date</div>
                  <div className="mt-0.5 font-bold text-white">
                    {todaySummary.date}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-800 p-2.5">
                  <div className="text-slate-400">Current Bill Amount</div>
                  <div className="mt-0.5 font-bold text-blue-300">
                    Rs {total.toFixed(2)}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-800 p-2.5">
                  <div className="text-slate-400">Bills Today</div>
                  <div className="mt-0.5 font-bold text-white">
                    {todaySummary.invoiceCount} (Last: #{todaySummary.lastInvoiceNo})
                  </div>
                </div>
                <div className="rounded-lg bg-slate-800 p-2.5">
                  <div className="text-slate-400">Day Closing Total</div>
                  <div className="mt-0.5 font-bold text-emerald-400">
                    Rs{" "}
                    {todaySummary.totalSales.toLocaleString("en-PK", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                </div>
              </div>

              {ledgerList.length > 0 && (
                <div className="overflow-x-auto pt-1">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-700 text-slate-400 uppercase">
                        <th className="py-1.5 pr-3">Date</th>
                        <th className="py-1.5 px-3 text-center">Bills</th>
                        <th className="py-1.5 px-3 text-center">Last Bill</th>
                        <th className="py-1.5 px-3 text-right">Last Bill Rs</th>
                        <th className="py-1.5 pl-3 text-right">Day Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {ledgerList.map((dayRow) => (
                        <tr key={dayRow.date} className="text-slate-200">
                          <td className="py-1.5 pr-3 font-mono">{dayRow.date}</td>
                          <td className="py-1.5 px-3 text-center">
                            {dayRow.invoiceCount}
                          </td>
                          <td className="py-1.5 px-3 text-center font-mono">
                            #{dayRow.lastInvoiceNo}
                          </td>
                          <td className="py-1.5 px-3 text-right">
                            Rs {dayRow.lastBillAmount.toFixed(2)}
                          </td>
                          <td className="py-1.5 pl-3 text-right font-bold text-emerald-400">
                            Rs{" "}
                            {dayRow.totalSales.toLocaleString("en-PK", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
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
