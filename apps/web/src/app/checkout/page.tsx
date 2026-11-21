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

// 2:30 بجنے تک ٹوکن بچانے کے لیے لائیو کیمرہ اسکین کالز عارضی طور پر بند
const PAUSE_LIVE_SCAN_UNTIL_RESET = true;

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
  totalSales: number;
}

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
  const cleanScope = encodeURIComponent(String(scope || "unscoped").trim().toLowerCase());
  return `pos:nextInvoiceNo:${cleanScope}`;
}

function getLedgerStorageKey(scope: string = invoiceScope): string {
  const cleanScope = encodeURIComponent(String(scope || "unscoped").trim().toLowerCase());
  return `pos:dailyLedger:${cleanScope}`;
}

function readNextInvoice(scope: string = invoiceScope): number {
  try {
    const n = Number(localStorage.getItem(getInvoiceStorageKey(scope)));
    return Number.isInteger(n) && n >= INVOICE_SEED ? n : INVOICE_SEED;
  } catch {
    return INVOICE_SEED;
  }
}

function readLedgerMap(scope: string = invoiceScope): Record<string, DailyLedgerEntry> {
  try {
    const raw = localStorage.getItem(getLedgerStorageKey(scope));
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, DailyLedgerEntry>;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    }
  } catch {}
  return {};
}

function getSortedLedger(scope: string = invoiceScope): DailyLedgerEntry[] {
  const map = readLedgerMap(scope);
  return Object.values(map).sort((a, b) => b.date.localeCompare(a.date));
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

  const ledgerMap = readLedgerMap(scope);
  const existing = ledgerMap[dateKey] || {
    date: dateKey,
    invoiceCount: 0,
    lastInvoiceNo: issuedInvoice,
    totalSales: 0,
  };

  const updatedEntry: DailyLedgerEntry = {
    date: dateKey,
    invoiceCount: existing.invoiceCount + 1,
    lastInvoiceNo: issuedInvoice,
    totalSales: Math.round((existing.totalSales + amount) * 100) / 100,
  };

  ledgerMap[dateKey] = updatedEntry;

  try {
    localStorage.setItem(getInvoiceStorageKey(scope), String(nextSeq));
    localStorage.setItem(getLedgerStorageKey(scope), JSON.stringify(ledgerMap));
  } catch {}

  return {
    issuedInvoice,
    nextInvoiceFormatted,
    todayEntry: updatedEntry,
    ledgerList: Object.values(ledgerMap).sort((a, b) => b.date.localeCompare(a.date)),
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

  // تاریخ تبدیل ہونے پر خودکار اگلے دن کے حساب پر سوئچ کرنا (بل نمبر پچھلے آخری بل سے آگے جاری رہتا ہے)
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
    if (PAUSE_LIVE_SCAN_UNTIL_RESET) {
      setError("⏸️ 2:30 تک ٹوکن بچانے کے لیے کیمرہ اسکین روکا ہوا ہے؛ براہِ راست آئٹم کا نام لکھ کر بل بنائیں۔");
      return;
    }
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
    if (PAUSE_LIVE_SCAN_UNTIL_RESET) {
      setError("⏸️ 2:30 تک ٹوکن بچانے کے لیے اسکین ٹیسٹ روکا ہوا ہے۔");
      return;
    }
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
                (p.sku && p.sku.toLowerCase() === extractedBarcode.toLowerCase()) ||
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
            `❌ n8n سے جواب نہیں آیا (${err instanceof Error ? err.message : "نامعلوم"})، ویب ہک یا انٹرنیٹ چیک کریں۔`
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
      (p) => (p.sku && p.sku.toLowerCase() === trimmed.toLowerCase()) || p.id === trimmed
    );

    if (found) {
      setItemNameInput(found.name);
      setPriceInput(found.price || "");
      setError(`⚡ Auto-matched: ${found.name}`);
    }
  }

  async function handleAddAndSave(e: React.FormEvent) {
    e.preventDefault();
    const sku = barcodeInput.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
    const name = itemNameInput.trim() || `Item-${sku}`;
    const qty = parseInt(qtyInput, 10) || 1;
    const price = priceInput.trim() ? priceInput.trim() : "0";

    setError("");

    let targetProduct: Product | undefined = products.find(
      (p) => p.sku && p.sku.toLowerCase() === sku.toLowerCase(),
    );

    if (!targetProduct) {
      try {
        const response = await apiFetch<Product | { data: Product }>("/products", {
          method: "POST",
          body: JSON.stringify({
            name,
            sku,
            price,
            stockQty: 9999,
          }),
        });

        const savedProduct =
          response && typeof response === "object" && "data" in response
            ? (response as { data: Product }).data
            : (response as Product);

        if (savedProduct && savedProduct.id) {
          targetProduct = savedProduct;
          setProducts((prev) => {
            const exists = prev.findIndex((p) => p.id === savedProduct.id);
            if (exists >= 0) {
              return prev.map((p) => (p.id === savedProduct.id ? savedProduct : p));
            }
            return [...prev, savedProduct];
          });
        }
      } catch (err) {
        console.error("Failed to save product to inventory server:", err);
        setError("❌ پروڈکٹ سرور پر سیو کرنے میں خرابی ہوئی۔ براہ کرم انٹرنیٹ یا لاگ ان چیک کریں۔");
        return;
      }
    }

    if (!targetProduct) {
      setError("❌ آئٹم سرور پر محفوظ نہیں ہوئی، اس لیے کارٹ میں ایڈ نہیں کی گئی۔");
      return;
    }

    addToCart(targetProduct, qty);
    await loadProducts();
    setError(`✔ آئٹم کامیابی کے ساتھ انوینٹری میں سیو اور کارٹ میں ایڈ ہو گئی ہے!`);

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
      setCart((prev) => prev.filter((item) => item.product.id
