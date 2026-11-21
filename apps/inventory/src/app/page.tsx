"use client";

import { useEffect, useState, useRef, type ChangeEvent } from "react";
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

const N8N_PRODUCT_SCAN_WEBHOOK_URL =
  "https://primary-production-34a63.up.railway.app/webhook/store-onboarding";

const PURCHASE_LEDGER_KEY = "pos:wholesalePurchaseLedger:v1";
const SALES_LEDGER_KEY = "pos:customerSalesLedger:v1";
const PRODUCT_COST_MAP_KEY = "pos:productCostMap:v1";
const CLOSING_HOUR = 21;

interface StoreProfile {
  name: string;
  details: string;
  phone: string;
}

interface PurchaseEntry {
  id: string;
  date: string;
  time: string;
  supplierOrBill: string;
  sku: string;
  itemName: string;
  qty: number;
  costPrice: number;
  salePrice: number;
  totalPurchase: number;
}

interface SaleEntry {
  id: string;
  date: string;
  time: string;
  billRef: string;
  itemName: string;
  qty: number;
  costPrice: number;
  salePrice: number;
  totalSale: number;
  totalCost: number;
  profit: number;
}

interface ScannedBillItem {
  name: string;
  sku: string;
  costPrice: string;
  salePrice: string;
  qty: number;
}

interface BackendOrderItem {
  id?: string;
  productId?: string;
  productName?: string;
  unitPrice?: string | number;
  quantity?: number;
}

interface BackendOrder {
  id?: string | number;
  createdAt?: string;
  total?: string | number;
  subtotal?: string | number;
  discount?: string | number;
  items?: BackendOrderItem[];
}

function getTodayDateStr(dateObj: Date = new Date()): string {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTimeStr(dateObj: Date = new Date()): string {
  return dateObj.toLocaleTimeString("en-PK", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function safeJsonRead<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeJsonWrite<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function formatMoney(num: number): string {
  return `Rs ${Number(num || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function InventoryPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Add / Wholesale Entry Form State
  const [supplierOrBill, setSupplierOrBill] = useState("");
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [stockQty, setStockQty] = useState("100");

  // Scan State
  const [scanningPhoto, setScanningPhoto] = useState(false);
  const [scannedBillItems, setScannedBillItems] = useState<ScannedBillItem[]>(
    []
  );

  // Separate Ledgers State
  const [purchaseEntries, setPurchaseEntries] = useState<PurchaseEntry[]>([]);
  const [salesEntries, setSalesEntries] = useState<SaleEntry[]>([]);
  const [productCostMap, setProductCostMap] = useState<Record<string, number>>(
    {}
  );
  const [activeLedgerTab, setActiveLedgerTab] = useState<"purchase" | "sales">(
    "purchase"
  );

  const [storeInfo, setStoreInfo] = useState<StoreProfile>({
    name: "",
    details: "",
    phone: "",
  });

  const [todayDate, setTodayDate] = useState<string>(getTodayDateStr());
  const [currentHour, setCurrentHour] = useState<number>(new Date().getHours());

  // Camera Scanner Ref
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }

    const savedPurchases = safeJsonRead<PurchaseEntry[]>(
      PURCHASE_LEDGER_KEY,
      []
    );
    const savedSales = safeJsonRead<SaleEntry[]>(SALES_LEDGER_KEY, []);
    const savedCostMap = safeJsonRead<Record<string, number>>(
      PRODUCT_COST_MAP_KEY,
      {}
    );

    setPurchaseEntries(savedPurchases);
    setSalesEntries(savedSales);
    setProductCostMap(savedCostMap);

    loadStoreProfile();
    loadProducts(savedCostMap);
    syncSalesFromOrders(savedCostMap);
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setTodayDate(getTodayDateStr(now));
      setCurrentHour(now.getHours());
    }, 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  function saveCostMapping(
    productId: string | undefined,
    productSku: string | undefined,
    unitCost: number
  ) {
    if (!Number.isFinite(unitCost) || unitCost < 0) return;
    setProductCostMap((prev) => {
      const next = { ...prev };
      if (productId) next[`id:${productId}`] = unitCost;
      if (productSku) next[`sku:${productSku.toLowerCase()}`] = unitCost;
      safeJsonWrite(PRODUCT_COST_MAP_KEY, next);
      return next;
    });
  }

  function lookupUnitCost(
    productId: string | undefined,
    productSku: string | undefined,
    fallbackSalePrice: number,
    costMapArg: Record<string, number> = productCostMap
  ): number {
    if (productId && costMapArg[`id:${productId}`] !== undefined) {
      return costMapArg[`id:${productId}`];
    }
    if (
      productSku &&
      costMapArg[`sku:${productSku.toLowerCase()}`] !== undefined
    ) {
      return costMapArg[`sku:${productSku.toLowerCase()}`];
    }
    return fallbackSalePrice;
  }

  function appendPurchaseRecord(entry: Omit<PurchaseEntry, "id">) {
    const newRow: PurchaseEntry = {
      ...entry,
      id: `PUR-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
    };
    setPurchaseEntries((prev) => {
      const next = [newRow, ...prev];
      safeJsonWrite(PURCHASE_LEDGER_KEY, next);
      return next;
    });
  }

  async function syncSalesFromOrders(costMapArg: Record<string, number>) {
    try {
      const res = await apiFetch<{ data?: BackendOrder[] } | BackendOrder[]>(
        "/orders"
      );
      const orderList: BackendOrder[] = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : [];

      if (orderList.length === 0) return;

      const builtSales: SaleEntry[] = [];
      for (const ord of orderList) {
        const ordDate = ord.createdAt
          ? getTodayDateStr(new Date(ord.createdAt))
          : getTodayDateStr();
        const ordTime = ord.createdAt
          ? formatTimeStr(new Date(ord.createdAt))
          : "--:--";
        const billRef = String(ord.id ?? "-");

        if (Array.isArray(ord.items) && ord.items.length > 0) {
          ord.items.forEach((it, idx) => {
            const qty = Number(it.quantity || 1);
            const uPrice = Number(it.unitPrice || 0);
            const uCost = lookupUnitCost(
              it.productId,
              undefined,
              uPrice,
              costMapArg
            );
            const lineSale = Math.round(uPrice * qty * 100) / 100;
            const lineCost = Math.round(uCost * qty * 100) / 100;
            const lineProfit = Math.round((lineSale - lineCost) * 100) / 100;

            builtSales.push({
              id: String(it.id || `ORD-${billRef}-${idx}`),
              date: ordDate,
              time: ordTime,
              billRef,
              itemName: String(it.productName || "Sold Item"),
              qty,
              costPrice: uCost,
              salePrice: uPrice,
              totalSale: lineSale,
              totalCost: lineCost,
              profit: lineProfit,
            });
          });
        } else {
          const totalAmount = Number(ord.total ?? ord.subtotal ?? 0);
          builtSales.push({
            id: `ORD-${billRef}`,
            date: ordDate,
            time: ordTime,
            billRef,
            itemName: `Order #${billRef}`,
            qty: 1,
            costPrice: totalAmount,
            salePrice: totalAmount,
            totalSale: totalAmount,
            totalCost: totalAmount,
            profit: 0,
          });
        }
      }

      if (builtSales.length > 0) {
        setSalesEntries(builtSales);
        safeJsonWrite(SALES_LEDGER_KEY, builtSales);
      }
    } catch {
      // Fallback to local sales ledger if /orders is unavailable
    }
  }

  async function loadStoreProfile() {
    try {
      const res = await apiFetch<StoreProfile>("/stores/current");
      if (res && res.name) setStoreInfo(res);
    } catch (err) {
      console.error("Failed to load store profile", err);
    }
  }

  async function loadProducts(
    costMapArg: Record<string, number> = productCostMap
  ) {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ data: Product[] }>(
        `/products?t=${Date.now()}`
      );
      if (res && res.data) {
        setProducts(res.data);
        res.data.forEach((p) => {
          const existingCost = lookupUnitCost(
            p.id,
            p.sku,
            parseFloat(p.price || "0") || 0,
            costMapArg
          );
          if (
            costMapArg[`id:${p.id}`] === undefined &&
            (!p.sku || costMapArg[`sku:${p.sku.toLowerCase()}`] === undefined)
          ) {
            saveCostMapping(p.id, p.sku, existingCost);
          }
        });
      } else {
        setProducts([]);
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to load products from server."
      );
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }

  function handleBarcodeLookup(code: string) {
    const trimmed = code.trim();
    setSku(trimmed);
    if (!trimmed) return;

    const found = products.find(
      (p) =>
        (p.sku && p.sku.toLowerCase() === trimmed.toLowerCase()) ||
        p.id === trimmed
    );

    if (found) {
      setName(found.name);
      if (found.price) setSalePrice(found.price);
      const knownCost = lookupUnitCost(
        found.id,
        found.sku,
        parseFloat(found.price || "0") || 0
      );
      setCostPrice(String(knownCost));
      setError(
        `⚡ موجودہ پروڈکٹ ملی: ${found.name} — ہول سیل مقدار اور قیمت چیک کر کے سیو کریں۔`
      );
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
      setError("کیمرہ تک رسائی نہیں مل سکی یا براؤزر سپورٹ نہیں کرتا۔");
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }

  async function captureAndScanWholesale() {
    if (!videoRef.current || scanningPhoto) return;

    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement("canvas");
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    setScanningPhoto(true);
    setError("📷 ہول سیل / مینوفیکچرر بل یا پروڈکٹ اسکین ہو رہا ہے...");

    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          setScanningPhoto(false);
          setError("❌ تصویر کیپچر نہیں ہو سکی، دوبارہ کوشش کریں۔");
          return;
        }

        try {
          const formData = new FormData();
          formData.append("image", blob, "wholesale-bill.jpg");
          formData.append("scan_type", "wholesale_purchase_bill");
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

          const billRefText = String(
            payload?.supplier_name ??
              payload?.manufacturer ??
              payload?.invoice_no ??
              payload?.bill_no ??
              ""
          ).trim();
          if (billRefText) {
            setSupplierOrBill(billRefText);
          }

          const rawItems = Array.isArray(payload?.items)
            ? payload.items
            : Array.isArray(payload?.bill_items)
            ? payload.bill_items
            : [];

          if (rawItems.length > 0) {
            const parsed: ScannedBillItem[] = rawItems
              .map((it: Record<string, unknown>, idx: number) => {
                const cVal = String(
                  it?.cost_price ??
                    it?.purchase_price ??
                    it?.wholesale_price ??
                    it?.rate ??
                    it?.price ??
                    "0"
                ).trim();
                const sVal = String(
                  it?.sale_price ??
                    it?.retail_price ??
                    it?.price ??
                    cVal
                ).trim();

                return {
                  name: String(
                    it?.product_name ?? it?.item_name ?? it?.name ?? ""
                  ).trim(),
                  sku: String(
                    it?.barcode ??
                      it?.sku ??
                      it?.code ??
                      `WH-${Date.now().toString().slice(-4)}-${idx + 1}`
                  ).trim(),
                  costPrice: cVal,
                  salePrice: sVal,
                  qty:
                    parseInt(
                      String(it?.qty ?? it?.quantity ?? it?.stockQty ?? "1"),
                      10
                    ) || 1,
                };
              })
              .filter((r: ScannedBillItem) => r.name.length > 0);

            if (parsed.length > 0) {
              setScannedBillItems(parsed);
              const first = parsed[0];
              setName(first.name);
              setSku(first.sku);
              setCostPrice(first.costPrice);
              setSalePrice(first.salePrice);
              setStockQty(String(first.qty));
              stopCamera();
              setError(
                `✔ ہول سیل بل سے ${parsed.length} آئٹمز مل گئیں! پہلی آئٹم فارم میں بھر دی گئی ہے۔`
              );
              return;
            }
          }

          const extractedName = String(
            payload?.product_name ?? payload?.item_name ?? payload?.name ?? ""
          ).trim();
          const extractedSku = String(
            payload?.barcode ?? payload?.sku ?? payload?.code ?? ""
          ).trim();
          const extractedCost = String(
            payload?.cost_price ??
              payload?.purchase_price ??
              payload?.wholesale_price ??
              payload?.price ??
              ""
          ).trim();
          const extractedSale = String(
            payload?.sale_price ??
              payload?.retail_price ??
              payload?.price ??
              ""
          ).trim();
          const extractedQty = String(
            payload?.qty ?? payload?.quantity ?? payload?.stockQty ?? ""
          ).trim();

          if (extractedName) setName(extractedName);
          if (extractedSku) setSku(extractedSku);
          if (extractedCost) setCostPrice(extractedCost);
          if (extractedSale) setSalePrice(extractedSale);
          if (extractedQty) setStockQty(extractedQty);

          stopCamera();
          setError(
            `✔ اسکین مکمل: ${extractedName || "آئٹم"} | کوڈ: ${
              extractedSku || "-"
            }`
          );
        } catch (err) {
          console.error("Wholesale scan error:", err);
          setError(
            `❌ اسکین رسپانس میں خرابی (${
              err instanceof Error ? err.message : "نامعلوم"
            }) — آپ تفصیل براہِ راست بھی لکھ کر سیو کر سکتے ہیں۔`
          );
        } finally {
          setScanningPhoto(false);
        }
      },
      "image/jpeg",
      0.85
    );
  }

  async function saveWholesalePurchaseItem(params: {
    itemName: string;
    itemSku: string;
    itemCostPrice: string;
    itemSalePrice: string;
    itemQty: number;
    billLabel?: string;
  }): Promise<Product | null> {
    const cleanSku =
      params.itemSku.trim() ||
      `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
    const parsedCost = parseFloat(params.itemCostPrice.trim() || "0") || 0;
    const parsedSale =
      parseFloat(
        params.itemSalePrice.trim() || params.itemCostPrice.trim() || "0"
      ) || 0;
    const cleanQty = params.itemQty > 0 ? params.itemQty : 1;

    const existingProduct = products.find(
      (p) => p.sku && p.sku.toLowerCase() === cleanSku.toLowerCase()
    );
    const nextStockQty =
      (existingProduct ? Number(existingProduct.stockQty || 0) : 0) + cleanQty;

    const response = await apiFetch<Product | { data: Product }>("/products", {
      method: "POST",
      body: JSON.stringify({
        name: params.itemName.trim(),
        sku: cleanSku,
        price: String(parsedSale),
        stockQty: nextStockQty,
      }),
    });

    const createdProduct =
      response && typeof response === "object" && "data" in response
        ? (response as { data: Product }).data
        : (response as Product);

    if (createdProduct) {
      saveCostMapping(createdProduct.id, createdProduct.sku, parsedCost);
      setProducts((prev) => {
        const exists = prev.findIndex((p) => p.id === createdProduct.id);
        if (exists >= 0) {
          return prev.map((p) =>
            p.id === createdProduct.id ? createdProduct : p
          );
        }
        return [createdProduct, ...prev];
      });
    } else {
      saveCostMapping(undefined, cleanSku, parsedCost);
    }

    const now = new Date();
    appendPurchaseRecord({
      date: getTodayDateStr(now),
      time: formatTimeStr(now),
      supplierOrBill:
        (params.billLabel || supplierOrBill).trim() || "Wholesale / Direct",
      sku: cleanSku,
      itemName: params.itemName.trim(),
      qty: cleanQty,
      costPrice: parsedCost,
      salePrice: parsedSale,
      totalPurchase: Math.round(parsedCost * cleanQty * 100) / 100,
    });

    setTodayDate(getTodayDateStr(now));
    setCurrentHour(now.getHours());

    return createdProduct || null;
  }

  async function handleAddAllScannedBillItems() {
    if (scannedBillItems.length === 0) return;
    try {
      for (const row of scannedBillItems) {
        await saveWholesalePurchaseItem({
          itemName: row.name,
          itemSku: row.sku,
          itemCostPrice: row.costPrice,
          itemSalePrice: row.salePrice,
          itemQty: row.qty,
          billLabel: supplierOrBill || "Scanned Wholesale Bill",
        });
      }
      setScannedBillItems([]);
      setActiveLedgerTab("purchase");
      await loadProducts();
      setError(
        "✔ ہول سیل بل کی تمام آئٹمز انونٹری اور Purchase Ledger میں ایڈ ہو گئیں!"
      );
    } catch (err) {
      console.error("Failed to save scanned bill items", err);
      setError("بل کی آئٹمز سیو کرنے میں خرابی ہوئی۔");
    }
  }

  async function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || (!salePrice.trim() && !costPrice.trim())) {
      alert("براہ کرم پروڈکٹ کا نام اور قیمت درج کریں!");
      return;
    }

    try {
      const savedProduct = await saveWholesalePurchaseItem({
        itemName: name.trim(),
        itemSku: sku.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`,
        itemCostPrice: costPrice.trim() || salePrice.trim(),
        itemSalePrice: salePrice.trim() || costPrice.trim(),
        itemQty: parseInt(stockQty, 10) || 1,
        billLabel: supplierOrBill.trim() || "Wholesale / Direct",
      });

      if (savedProduct || true) {
        setName("");
        setSku("");
        setCostPrice("");
        setSalePrice("");
        setStockQty("100");
        setActiveLedgerTab("purchase");
        await loadProducts();
        setError(
          "✔ پروڈکٹ انونٹری اور ہول سیل Purchase Ledger میں محفوظ ہو گئی ہے!"
        );
      }
    } catch (err) {
      console.error("Failed to add product", err);
      setError("پروڈکٹ سیو کرنے میں خرابی ہوئی۔");
    }
  }

  const handleCSVImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const text = e.target?.result;
      if (typeof text !== "string") return;

      const lines = text.split("\n");
      let importedCount = 0;

      for (let i = 1; i < lines.length; i++) {
        const rawLine = lines[i];
        if (rawLine === undefined) continue;

        const line = rawLine.trim();
        if (!line) continue;

        const cols = line.split(",");
        const [
          rawSku = "",
          rawName = "",
          rawPrice = "100",
          rawStock = "50",
          rawCost = "",
        ] = cols.map((c) => c.replace(/["']/g, "").trim());

        if (!rawName) continue;

        const pSku =
          rawSku || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
        const parsedSale = Number(rawPrice);
        const pSale =
          !Number.isNaN(parsedSale) && parsedSale >= 0
            ? String(parsedSale)
            : "100";
        const parsedCost = rawCost ? Number(rawCost) : parsedSale;
        const pCost =
          !Number.isNaN(parsedCost) && parsedCost >= 0
            ? String(parsedCost)
            : pSale;
        const parsedStock = parseInt(rawStock, 10);
        const pStock =
          !Number.isNaN(parsedStock) && parsedStock >= 0 ? parsedStock : 50;

        try {
          const saved = await saveWholesalePurchaseItem({
            itemName: rawName,
            itemSku: pSku,
            itemCostPrice: pCost,
            itemSalePrice: pSale,
            itemQty: pStock,
            billLabel: "CSV Import",
          });
          if (saved) {
            importedCount++;
          }
        } catch {
          // Skip failed row
        }
      }

      alert(`کامیابی کے ساتھ ${importedCount} پروڈکٹس امپورٹ ہو گئی ہیں!`);
      loadProducts();
    };
    reader.readAsText(file);
  };

  function exportToCSV() {
    if (products.length === 0) {
      alert("No products available to export.");
      return;
    }
    const headers = [
      "Barcode / SKU",
      "Item Name",
      "Cost Price (Rs)",
      "Sale Price (Rs)",
      "Stock Qty",
      "Status",
    ];
    const rows = products.map((p) => {
      const uCost = lookupUnitCost(
        p.id,
        p.sku,
        parseFloat(p.price || "0") || 0
      );
      return [
        `"${p.sku || ""}"`,
        `"${p.name.replace(/"/g, '""')}"`,
        uCost,
        p.price,
        p.stockQty,
        p.stockQty > 5
          ? "In Stock"
          : p.stockQty > 0
          ? "Low Stock"
          : "Out of Stock",
      ];
    });
    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const safeStoreName = storeInfo.name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "_");
    link.setAttribute(
      "download",
      `${safeStoreName}_inventory_${new Date().toISOString().slice(0, 10)}.csv`
    );
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

  const todayPurchases = purchaseEntries.filter((e) => e.date === todayDate);
  const todayPurchaseQty = todayPurchases.reduce((s, e) => s + e.qty, 0);
  const todayPurchaseTotal = todayPurchases.reduce(
    (s, e) => s + e.totalPurchase,
    0
  );

  const todaySales = salesEntries.filter((e) => e.date === todayDate);
  const todaySoldQty = todaySales.reduce((s, e) => s + e.qty, 0);
  const todaySalesTotal = todaySales.reduce((s, e) => s + e.totalSale, 0);
  const todayCostOfSold = todaySales.reduce((s, e) => s + e.totalCost, 0);
  const todayNetProfit = todaySales.reduce((s, e) => s + e.profit, 0);

  const allDates = Array.from(
    new Set([
      ...purchaseEntries.map((p) => p.date),
      ...salesEntries.map((s) => s.date),
      todayDate,
    ])
  ).sort((a, b) => b.localeCompare(a));

  const dateClosingSummary = allDates.map((d) => {
    const pRows = purchaseEntries.filter((p) => p.date === d);
    const sRows = salesEntries.filter((s) => s.date === d);
    const pTotal = pRows.reduce((acc, r) => acc + r.totalPurchase, 0);
    const pQty = pRows.reduce((acc, r) => acc + r.qty, 0);
    const sTotal = sRows.reduce((acc, r) => acc + r.totalSale, 0);
    const sQty = sRows.reduce((acc, r) => acc + r.qty, 0);
    const profitTotal = sRows.reduce((acc, r) => acc + r.profit, 0);
    const isClosed =
      d < todayDate || (d === todayDate && currentHour >= CLOSING_HOUR);

    return {
      date: d,
      pQty,
      pTotal,
      sQty,
      sTotal,
      profitTotal,
      isClosed,
    };
  });

  const isEveningClosingWindow = currentHour >= CLOSING_HOUR;

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
          <p className="text-sm text-slate-700 font-medium">
            {[storeInfo.details, storeInfo.phone ? `Ph: ${storeInfo.phone}` : ""]
              .filter(Boolean)
              .join(" | ")}
          </p>
        </div>
        <Button
          onClick={() => router.push("/checkout")}
          className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
        >
          Go to Checkout ➔
        </Button>
      </div>

      <PageHeader
        title="Inventory Manager"
        description="Separate ledgers for wholesale/manufacturer purchases, customer sales, cost prices, and profit"
      />

      <div className="bg-slate-50 border border-dashed border-slate-300 p-4 rounded-xl mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <label className="font-bold block mb-1 text-slate-800 text-sm">
            📁 پرانا ڈیٹا یا کسٹمر/پروڈکٹ لسٹ امپورٹ کریں (Bulk CSV File Import):
          </label>
          <p className="text-xs text-slate-500 mb-2">
            اپنی CSV فائل یہاں سلیکٹ کریں تاکہ سارا پرانا ڈیٹا خود بخود سسٹم میں آ جائے:
          </p>
          <input
            type="file"
            accept=".csv"
            onChange={handleCSVImport}
            className="text-sm"
          />
        </div>

        <div className="flex items-center gap-2">
          {!cameraOpen ? (
            <Button
              type="button"
              variant="outline"
              onClick={startCameraScanner}
              className="border-blue-600 text-blue-600 font-semibold"
            >
              📷 Scan Wholesale Bill / QR / Barcode
            </Button>
          ) : (
            <Button
              type="button"
              variant="destructive"
              onClick={stopCamera}
            >
              ✕ Close Camera
            </Button>
          )}
        </div>
      </div>

      {cameraOpen && (
        <div className="mb-6 space-y-2 overflow-hidden rounded-xl border-2 border-blue-500 bg-black p-3">
          <video
            ref={videoRef}
            className="w-full max-h-72 rounded object-cover"
            playsInline
            muted
          />
          <canvas ref={canvasRef} className="hidden" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-white text-xs">
              ہول سیلر / مینوفیکچرر بل یا پروڈکٹ کے بار کوڈ/کیو آر پر کیمرہ رکھیں اور Capture دبائیں
            </p>
            <Button
              type="button"
              onClick={captureAndScanWholesale}
              disabled={scanningPhoto}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold"
            >
              {scanningPhoto
                ? "Scanning..."
                : "📸 Capture Wholesale Bill / Barcode"}
            </Button>
          </div>
        </div>
      )}

      {scannedBillItems.length > 0 && (
        <Card className="mb-6 border-blue-300 bg-blue-50/50">
          <CardHeader className="flex flex-row items-center justify-between py-3">
            <CardTitle className="text-sm font-bold text-blue-900">
              Scanned Wholesale Bill Items ({scannedBillItems.length})
            </CardTitle>
            <Button
              type="button"
              onClick={handleAddAllScannedBillItems}
              className="bg-green-600 hover:bg-green-700 text-white text-xs font-bold"
            >
              + Add All to Wholesale Purchase Ledger
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="divide-y divide-blue-100 text-xs">
              {scannedBillItems.map((row, idx) => (
                <div
                  key={`${row.sku}-${idx}`}
                  className="flex items-center justify-between py-1.5"
                >
                  <span className="font-semibold text-slate-900">
                    {row.name}{" "}
                    <span className="text-slate-500">({row.sku})</span>
                  </span>
                  <span className="font-mono text-slate-700">
                    Qty: {row.qty} | Cost: Rs {row.costPrice} | Sale: Rs{" "}
                    {row.salePrice}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3 mb-6">
        <Card className="lg:col-span-1 border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">
              ➕ Add Wholesale / Purchase Stock
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddProduct} className="space-y-3">
              <Input
                placeholder="Wholesaler / Manufacturer / Bill No..."
                value={supplierOrBill}
                onChange={(e) => setSupplierOrBill(e.target.value)}
              />
              <div className="flex gap-2">
                <Input
                  placeholder="QR / Barcode / SKU (Optional)..."
                  value={sku}
                  onChange={(e) => handleBarcodeLookup(e.target.value)}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={cameraOpen ? stopCamera : startCameraScanner}
                  className="px-3 border-blue-600 text-blue-600"
                  title="Scan Wholesale Bill or Barcode"
                >
                  {cameraOpen ? "✕" : "📷"}
                </Button>
              </div>
              <Input
                placeholder="Product Name (e.g. Shampoo)..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  placeholder="Cost Price (پیچھے سے)..."
                  value={costPrice}
                  onChange={(e) => setCostPrice(e.target.value)}
                />
                <Input
                  type="number"
                  placeholder="Sale Price (سیل قیمت)..."
                  value={salePrice}
                  onChange={(e) => setSalePrice(e.target.value)}
                  required
                />
              </div>
              <Input
                type="number"
                placeholder="Stock Qty..."
                value={stockQty}
                onChange={(e) => setStockQty(e.target.value)}
              />
              <Button
                type="submit"
                disabled={scanningPhoto}
                className="w-full bg-green-600 hover:bg-green-700 text-white font-bold"
              >
                Save to Inventory & Purchase Ledger
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="text-lg">Search & Manage Inventory</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-4 items-center justify-between">
              <Input
                placeholder="Search by product name or SKU/Barcode..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="max-w-md h-11 bg-white"
              />
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={() => loadProducts()}
                  className="h-11 border-slate-300 text-slate-700 hover:bg-slate-100"
                >
                  🔄 Refresh
                </Button>
                <Button
                  onClick={exportToCSV}
                  className="h-11 bg-green-600 hover:bg-green-700 text-white"
                >
                  📊 Export to CSV
                </Button>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Total Products in Database:{" "}
              <span className="font-bold text-slate-900">
                {products.length}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 p-4 rounded-xl mb-4 flex justify-between items-center">
          <p className="text-sm font-medium">{error}</p>
          <Button
            size="sm"
            onClick={() => loadProducts()}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            Retry
          </Button>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm mb-6">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-100 text-slate-700 text-xs uppercase border-b border-slate-200">
            <tr>
              <th className="px-4 py-3">Barcode / SKU</th>
              <th className="px-4 py-3">Item Name</th>
              <th className="px-4 py-3 text-right">Cost Price (پیچھے سے)</th>
              <th className="px-4 py-3 text-right">Sale Price (سیل)</th>
              <th className="px-4 py-3 text-center">Stock Qty</th>
              <th className="px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-slate-500 font-medium"
                >
                  Loading inventory items... Please wait.
                </td>
              </tr>
            ) : filteredProducts.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-10 text-center text-slate-400"
                >
                  No products found in inventory. Add a new product or import CSV
                  above.
                </td>
              </tr>
            ) : (
              filteredProducts.map((product) => {
                const uCost = lookupUnitCost(
                  product.id,
                  product.sku,
                  parseFloat(product.price || "0") || 0
                );
                return (
                  <tr key={product.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">
                      {product.sku}
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      {product.name}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-700">
                      Rs {uCost.toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      Rs {product.price}
                    </td>
                    <td className="px-4 py-3 text-center font-bold">
                      {product.stockQty}
                    </td>
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
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-900 text-white p-4 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-slate-200">
              Separate Daily Ledgers & Closing ({todayDate})
            </span>
            <span
              className={`rounded px-2 py-0.5 text-[11px] font-semibold ${
                isEveningClosingWindow
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
              }`}
            >
              {isEveningClosingWindow
                ? "Day Closed (After 9 PM)"
                : "Day Open (Closes After 9 PM)"}
            </span>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setActiveLedgerTab("purchase")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                activeLedgerTab === "purchase"
                  ? "bg-blue-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              📦 Wholesale / Manufacturer In ({todayPurchases.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveLedgerTab("sales")}
              className={`rounded-lg px-3 py-1.5 text-xs font-bold transition ${
                activeLedgerTab === "sales"
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              🧾 Customer Sales & Profit ({todaySales.length})
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg bg-slate-800 p-3">
            <div className="text-slate-400">
              Wholesale / Manufacturer In ({todayDate})
            </div>
            <div className="mt-1 font-bold text-blue-300 text-sm">
              {formatMoney(todayPurchaseTotal)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Items In: {todayPurchaseQty}
            </div>
          </div>

          <div className="rounded-lg bg-slate-800 p-3">
            <div className="text-slate-400">Customer Sales Out ({todayDate})</div>
            <div className="mt-1 font-bold text-white text-sm">
              {formatMoney(todaySalesTotal)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Items Sold: {todaySoldQty}
            </div>
          </div>

          <div className="rounded-lg bg-slate-800 p-3">
            <div className="text-slate-400">Back Cost of Sold Goods</div>
            <div className="mt-1 font-bold text-amber-300 text-sm">
              {formatMoney(todayCostOfSold)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              پیچھے سے مال کی لاگت
            </div>
          </div>

          <div className="rounded-lg bg-slate-800 p-3">
            <div className="text-slate-400">Net Profit Today (منافع)</div>
            <div
              className={`mt-1 font-bold text-sm ${
                todayNetProfit >= 0 ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {formatMoney(todayNetProfit)}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              Sale − Back Cost
            </div>
          </div>
        </div>

        {activeLedgerTab === "purchase" ? (
          <div className="space-y-2">
            <div className="text-xs font-bold text-blue-300 uppercase">
              Wholesale / Manufacturer Purchase Ledger (آنے والا مال اور بل اسکین)
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-800 text-slate-300 uppercase">
                  <tr>
                    <th className="py-2 px-3">Date / Time</th>
                    <th className="py-2 px-3">Supplier / Bill</th>
                    <th className="py-2 px-3">Item / SKU</th>
                    <th className="py-2 px-3 text-center">Qty In</th>
                    <th className="py-2 px-3 text-right">Cost Price</th>
                    <th className="py-2 px-3 text-right">Sale Price</th>
                    <th className="py-2 px-3 text-right">Total Purchase</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {purchaseEntries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-6 text-center text-slate-400"
                      >
                        ابھی کوئی ہول سیل/مینوفیکچرر انٹری یا بل اسکین ریکارڈ نہیں ہوا۔
                      </td>
                    </tr>
                  ) : (
                    purchaseEntries.map((row) => (
                      <tr key={row.id} className="text-slate-200">
                        <td className="py-2 px-3 font-mono">
                          {row.date}{" "}
                          <span className="text-slate-400">{row.time}</span>
                        </td>
                        <td className="py-2 px-3">{row.supplierOrBill}</td>
                        <td className="py-2 px-3 font-semibold">
                          {row.itemName}{" "}
                          <span className="text-slate-400 font-mono">
                            ({row.sku})
                          </span>
                        </td>
                        <td className="py-2 px-3 text-center font-bold text-blue-300">
                          +{row.qty}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {formatMoney(row.costPrice)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {formatMoney(row.salePrice)}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-amber-300">
                          {formatMoney(row.totalPurchase)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-xs font-bold text-emerald-300 uppercase">
              Customer Sales & Profit Ledger (جانے والا مال، سیل قیمت اور منافع)
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-slate-800 text-slate-300 uppercase">
                  <tr>
                    <th className="py-2 px-3">Date / Bill</th>
                    <th className="py-2 px-3">Item Name</th>
                    <th className="py-2 px-3 text-center">Qty Out</th>
                    <th className="py-2 px-3 text-right">Back Cost</th>
                    <th className="py-2 px-3 text-right">Sale Price</th>
                    <th className="py-2 px-3 text-right">Total Sale</th>
                    <th className="py-2 px-3 text-right">Profit (منافع)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {salesEntries.length === 0 ? (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-6 text-center text-slate-400"
                      >
                        ابھی کوئی کسٹمر سیل ریکارڈ نہیں آیا۔
                      </td>
                    </tr>
                  ) : (
                    salesEntries.map((row) => (
                      <tr key={row.id} className="text-slate-200">
                        <td className="py-2 px-3 font-mono">
                          {row.date}{" "}
                          <span className="text-slate-400">#{row.billRef}</span>
                        </td>
                        <td className="py-2 px-3 font-semibold">
                          {row.itemName}
                        </td>
                        <td className="py-2 px-3 text-center font-bold text-rose-300">
                          -{row.qty}
                        </td>
                        <td className="py-2 px-3 text-right font-mono text-amber-300">
                          {formatMoney(row.totalCost)}
                        </td>
                        <td className="py-2 px-3 text-right font-mono">
                          {formatMoney(row.salePrice)}
                        </td>
                        <td className="py-2 px-3 text-right font-bold text-white">
                          {formatMoney(row.totalSale)}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-bold ${
                            row.profit >= 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {formatMoney(row.profit)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="space-y-2 pt-2 border-t border-slate-800">
          <div className="text-xs font-bold text-slate-300 uppercase">
            Day-Wise Closing Summary (ہر دن کا الگ کلوزنگ حساب)
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-700 text-slate-400 uppercase">
                  <th className="py-1.5 pr-3">Date</th>
                  <th className="py-1.5 px-3 text-center">Status</th>
                  <th className="py-1.5 px-3 text-right">Purchase In</th>
                  <th className="py-1.5 px-3 text-right">Sales Out</th>
                  <th className="py-1.5 pl-3 text-right">Profit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {dateClosingSummary.map((dayRow) => (
                  <tr key={dayRow.date} className="text-slate-200">
                    <td className="py-1.5 pr-3 font-mono">{dayRow.date}</td>
                    <td className="py-1.5 px-3 text-center">
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] ${
                          dayRow.isClosed
                            ? "bg-slate-700 text-amber-300"
                            : "bg-emerald-900/60 text-emerald-300"
                        }`}
                      >
                        {dayRow.isClosed ? "Closed" : "Open"}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-blue-300">
                      {formatMoney(dayRow.pTotal)} ({dayRow.pQty})
                    </td>
                    <td className="py-1.5 px-3 text-right font-mono text-white">
                      {formatMoney(dayRow.sTotal)} ({dayRow.sQty})
                    </td>
                    <td
                      className={`py-1.5 pl-3 text-right font-bold ${
                        dayRow.profitTotal >= 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }`}
                    >
                      {formatMoney(dayRow.profitTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
