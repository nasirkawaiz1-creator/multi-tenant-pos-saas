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

  const [supplierOrBill, setSupplierOrBill] = useState("");
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [stockQty, setStockQty] = useState("100");

  const [scanningPhoto, setScanningPhoto] = useState(false);
  const [scannedBillItems, setScannedBillItems] = useState<ScannedBillItem[]>([]);

  const [purchaseEntries, setPurchaseEntries] = useState<PurchaseEntry[]>([]);
  const [salesEntries, setSalesEntries] = useState<SaleEntry[]>([]);
  const [productCostMap, setProductCostMap] = useState<Record<string, number>>({});
  const [activeLedgerTab, setActiveLedgerTab] = useState<"purchase" | "sales">("purchase");

  const [storeInfo, setStoreInfo] = useState<StoreProfile>({
    name: "",
    details: "",
    phone: "",
  });

  const [todayDate, setTodayDate] = useState<string>(getTodayDateStr());
  const [currentHour, setCurrentHour] = useState<number>(new Date().getHours());

  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }

    const savedPurchases = safeJsonRead<PurchaseEntry[]>(PURCHASE_LEDGER_KEY, []);
    const savedSales = safeJsonRead<SaleEntry[]>(SALES_LEDGER_KEY, []);
    const savedCostMap = safeJsonRead<Record<string, number>>(PRODUCT_COST_MAP_KEY, {});

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
    if (productSku && costMapArg[`sku:${productSku.toLowerCase()}`] !== undefined) {
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
      const res = await apiFetch<{ data?: BackendOrder[] } | BackendOrder[]>("/orders");
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
            const uCost = lookupUnitCost(it.productId, undefined, uPrice, costMapArg);
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

  async function loadProducts(costMapArg: Record<string, number> = productCostMap) {
    setLoading(true);
    setError("");
    try {
      const res = await apiFetch<{ data: Product[] }>(`/products?t=${Date.now()}`);
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
        err instanceof Error ? err.message : "Failed to load products from server."
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
        (p.sku && p.sku.toLowerCase() === trimmed.toLowerCase()) || p.id === trimmed
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
                  it?.sale_price ?? it?.retail_price ?? it?.price ?? cVal
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
            payload?.sale_price ?? payload?.retail_price ?? payload?.price ?? ""
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
      params.itemSku.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
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

  const todaySales = salesEntries.filter
