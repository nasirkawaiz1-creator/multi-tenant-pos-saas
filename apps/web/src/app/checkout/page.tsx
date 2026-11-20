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

let invoiceScope = "unscoped";
const invoiceKey = () => `pos:nextInvoiceNo:${invoiceScope}`;
const INVOICE_SEED = 17;

function readNextInvoice(): number {
  try {
    const n = Number(localStorage.getItem(invoiceKey()));
    return Number.isInteger(n) && n >= INVOICE_SEED ? n : INVOICE_SEED;
  } catch {
    return INVOICE_SEED;
  }
}

function consumeInvoice(): string {
  const current = readNextInvoice();
  try {
    localStorage.setItem(invoiceKey(), String(current + 1));
  } catch {}
  return `local-${current}`;
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
  const [processing, setProcessing] = useState(false);
  const [scanningPhoto, setScanningPhoto] = useState(false);
  const [error, setError] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("local-17");
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

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }
    loadProducts();
    loadStoreProfile().finally(() => setInvoiceNo(`local-${readNextInvoice()}`));
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  async function loadStoreProfile() {
    try {
      const res = await apiFetch<StoreProfile>("/stores/current");
      if (res && res.name) {
        invoiceScope = res.slug || res.name;
        setStoreInfo(res);
      }
    } catch (err) {
      console.error("Failed to load store profile", err);
      setStoreInfo({ name: "Store", details: "", phone: "" });
    }
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
          setError("❌ n8n سے جواب نہیں آیا، ویب ہک یا انٹرنیٹ چیک کریں۔");
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
          items: cart.map((item)
