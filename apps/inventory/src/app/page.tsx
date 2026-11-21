"use client";

import { useEffect, useState, useRef, type ChangeEvent, type FormEvent } from "react";
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
const KHATA_LEDGER_KEY = "pos:dailyKhataLedger:v1";
const MIDNIGHT_ROLLOVER_INTERVAL_MS = 15000;

type DeviceChannel = "USB" | "Bluetooth" | "Barcode" | "Keyboard";

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

interface KhataEntry {
  id: string;
  date: string;
  time: string;
  title: string;
  entryType: "expense" | "khata" | "cash_in";
  amount: number;
}

interface ScannedBillItem {
  name: string;
  sku: string;
  costPrice: string;
  salePrice: string;
  qty: number;
}

interface CollectedCodeEntry {
  id: string;
  code: string;
  channel: DeviceChannel;
  time: string;
  matchedName?: string;
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
  const [khataEntries, setKhataEntries] = useState<KhataEntry[]>([]);
  const [productCostMap, setProductCostMap] = useState<Record<string, number>>({});
  const [activeLedgerTab, setActiveLedgerTab] = useState<
    "purchase" | "sales" | "khata"
  >("purchase");

  const [khataTitle, setKhataTitle] = useState("");
  const [khataAmount, setKhataAmount] = useState("");
  const [khataType, setKhataType] = useState<"expense" | "khata" | "cash_in">(
    "khata"
  );

  const [selectedChannel, setSelectedChannel] = useState<DeviceChannel>("Barcode");
  const [deviceStatusText, setDeviceStatusText] = useState(
    "Ready (Barcode / Scanner / Printer)"
  );
  const [collectedCodes, setCollectedCodes] = useState<CollectedCodeEntry[]>([]);
  const [bluetoothPrinterDevice, setBluetoothPrinterDevice] = useState<unknown>(null);

  const [storeInfo, setStoreInfo] = useState<StoreProfile>({
    name: "",
    details: "",
    phone: "",
  });

  const [todayDate, setTodayDate] = useState<string>(() => getTodayDateStr());
  const [dayClosedManual, setDayClosedManual] = useState(false);

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
    const savedKhata = safeJsonRead<KhataEntry[]>(KHATA_LEDGER_KEY, []);
    const savedCostMap = safeJsonRead<Record<string, number>>(
      PRODUCT_COST_MAP_KEY,
      {}
    );

    setPurchaseEntries(savedPurchases);
    setSalesEntries(savedSales);
    setKhataEntries(savedKhata);
    setProductCostMap(savedCostMap);

    loadStoreProfile();
    loadProducts(savedCostMap);
    syncSalesFromOrders(savedCostMap);
  }, []);

  useEffect(() => {
    const syncDateRollover = () => {
      const now = new Date();
      const nextDate = getTodayDateStr(now);
      setTodayDate((prevDate) => {
        if (prevDate !== nextDate) {
          setDayClosedManual(false);
          return nextDate;
        }
        return prevDate;
      });
    };

    syncDateRollover();
    const timer = window.setInterval(syncDateRollover, MIDNIGHT_ROLLOVER_INTERVAL_MS);
    return () => window.clearInterval(timer);
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
    if (productId) {
      const byId = costMapArg[`id:${productId}`];
      if (byId !== undefined) return byId;
    }
    if (productSku) {
      const bySku = costMapArg[`sku:${productSku.toLowerCase()}`];
      if (bySku !== undefined) return bySku;
    }
    return fallbackSalePrice;
  }

  function collectBarcodeEntry(
    rawCode: string,
    channel: DeviceChannel = selectedChannel
  ) {
    const cleanCode = rawCode.trim();
    if (!cleanCode) return;
    const found = products.find(
      (p) =>
        (p.sku && p.sku.toLowerCase() === cleanCode.toLowerCase()) ||
        p.id === cleanCode
    );
    const entry: CollectedCodeEntry = {
      id: `CODE-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      code: cleanCode,
      channel,
      time: formatTimeStr(new Date()),
      matchedName: found?.name,
    };
    setCollectedCodes((prev) => [entry, ...prev.slice(0, 49)]);
  }

  async function handleConnectChannel(channel: DeviceChannel) {
    setSelectedChannel(channel);
    setError("");
    if (channel === "Bluetooth") {
      try {
        const nav = navigator as unknown as {
          bluetooth?: {
            requestDevice: (
              opts: Record<string, unknown>
            ) => Promise<{ name?: string }>;
          };
        };
        if (!nav.bluetooth?.requestDevice) {
          setDeviceStatusText(
            "Bluetooth Printer / Scanner mode selected (Browser print fallback ready)"
          );
          return;
        }
        const device = await nav.bluetooth.requestDevice({
          acceptAllDevices: true,
        });
        setBluetoothPrinterDevice(device);
        setDeviceStatusText(
          `Bluetooth Connected: ${device.name || "Thermal Device"}`
        );
      } catch {
        setDeviceStatusText(
          "Bluetooth selected (Pair thermal receipt printer or print paper bill)"
        );
      }
      return;
    }

    if (channel === "USB") {
      try {
        const nav = navigator as unknown as {
          usb?: {
            requestDevice: (
              opts: Record<string, unknown>
            ) => Promise<{ productName?: string }>;
          };
        };
        if (nav.usb?.requestDevice) {
          const usbDev = await nav.usb.requestDevice({ filters: [] });
          setDeviceStatusText(
            `USB Connected: ${usbDev.productName || "USB Device"}`
          );
          return;
        }
      } catch {}
      setDeviceStatusText("USB Scanner / Receipt Printer mode active");
      return;
    }

    if (channel === "Barcode") {
      setDeviceStatusText("Barcode mode active (Camera / Code collection ready)");
      return;
    }

    setDeviceStatusText("Keyboard / Scanner wedge input active");
  }

  function handlePrintCustomerReceipt() {
    const hasBt = Boolean(bluetoothPrinterDevice);
    setDeviceStatusText(
      hasBt
        ? "Sending receipt via Bluetooth printer / print dialog..."
        : "Opening thermal / paper receipt print dialog..."
    );
    window.print();
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

  function handleAddKhataEntry(e: FormEvent) {
    e.preventDefault();
    const title = khataTitle.trim();
    const amt = Number(khataAmount);
    if (!title || !Number.isFinite(amt) || amt <= 0) return;

    const now = new Date();
    const nextDate = getTodayDateStr(now);
    const entry: KhataEntry = {
      id: `KHT-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      date: nextDate,
      time: formatTimeStr(now),
      title,
      entryType: khataType,
      amount: Math.round(amt * 100) / 100,
    };

    setKhataEntries((prev) => {
      const next = [entry, ...prev];
      safeJsonWrite(KHATA_LEDGER_KEY, next);
      return next;
    });
    setTodayDate(nextDate);
    setActiveLedgerTab("khata");
    setKhataTitle("");
    setKhataAmount("");
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
    } catch {}
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
              if (first) {
                setName(first.name);
                setSku(first.sku);
                setCostPrice(first.costPrice);
                setSalePrice(first.salePrice);
                setStockQty(String(first.qty));
                collectBarcodeEntry(first.sku, "Barcode");
              }
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
          if (extractedSku) {
            setSku(extractedSku);
            collectBarcodeEntry(extractedSku, "Barcode");
          }
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

  async function handleAddProduct(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || (!salePrice.trim() && !costPrice.trim())) {
      alert("براہ کرم پروڈکٹ کا نام اور قیمت درج کریں!");
      return;
    }

    try {
      const cleanCode =
        sku.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
      await saveWholesalePurchaseItem({
        itemName: name.trim(),
        itemSku: cleanCode,
        itemCostPrice: costPrice.trim() || salePrice.trim(),
        itemSalePrice: salePrice.trim() || costPrice.trim(),
        itemQty: parseInt(stockQty, 10) || 1,
        billLabel: supplierOrBill.trim() || "Wholesale / Direct",
      });

      collectBarcodeEntry(cleanCode, selectedChannel);

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
        } catch {}
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

  const todaySales = salesEntries.filter((e) => e.date === todayDate);
  const todaySoldQty = todaySales.reduce((s, e) => s + e.qty, 0);
  const todaySalesTotal = todaySales.reduce((s, e) => s + e.totalSale, 0);
  const todayCostOfSold = todaySales.reduce((s, e) => s + e.totalCost, 0);
  const todayNetProfit = todaySales.reduce((s, e) => s + e.profit, 0);

  const todayKhata = khataEntries.filter((e) => e.date === todayDate);
  const todayCashIn = todayKhata
    .filter((k) => k.entryType === "cash_in")
    .reduce((s, k) => s + k.amount, 0);
  const todayKhataOut = todayKhata
    .filter((k) => k.entryType === "khata" || k.entryType === "expense")
    .reduce((s, k) => s + k.amount, 0);
  const khataHisabBalance = todaySalesTotal + todayCashIn - todayKhataOut;

  const allDates = Array.from(
    new Set([
      ...purchaseEntries.map((p) => p.date),
      ...salesEntries.map((s) => s.date),
      ...khataEntries.map((k) => k.date),
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
    const isClosed = d < todayDate || (d === todayDate && dayClosedManual);

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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{storeInfo.name}</h1>
          <p className="text-sm font-medium text-slate-700">
            {[
              storeInfo.details,
              storeInfo.phone ? `Ph: ${storeInfo.phone}` : "",
              `Date: ${todayDate}`,
            ]
              .filter(Boolean)
              .join(" | ")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={handlePrintCustomerReceipt}
            className="border-slate-400 font-bold text-slate-800"
          >
            🖨️ Print Bill / Receipt
          </Button>
          <Button
            onClick={() => router.push("/checkout")}
            className="bg-blue-600 font-bold text-white hover:bg-blue-700"
          >
            Go to Checkout ➔
          </Button>
        </div>
      </div>

      <PageHeader
        title="Inventory & Daily Closing Ledger"
        description={`Active Date: ${todayDate} • Closes at 12:00 AM Midnight`}
      />

      <Card className="mb-6 border-slate-200 shadow-sm">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold text-slate-900">
            Device &amp; Input Channels (USB / Bluetooth / Barcode / Keyboard) —{" "}
            {deviceStatusText}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <div className="flex flex-wrap items-center gap-2">
            {(["USB", "Bluetooth", "Barcode", "Keyboard"] as DeviceChannel[]).map(
              (ch) => (
                <Button
                  key={ch}
                  type="button"
                  variant={selectedChannel === ch ? "default" : "outline"}
                  onClick={() => handleConnectChannel(ch)}
                  className={
                    selectedChannel === ch
                      ? "bg-blue-600 font-bold text-white"
                      : "border-slate-300 text-slate-800"
                  }
                >
                  {ch}
                </Button>
              )
            )}
            <Button
              type="button"
              onClick={() => {
                if (!sku.trim()) return;
                handleBarcodeLookup(sku);
                collectBarcodeEntry(sku, selectedChannel);
              }}
              className="bg-emerald-600 font-bold text-white hover:bg-emerald-700"
            >
              + Collect Barcode ({collectedCodes.length})
            </Button>
          </div>

          {collectedCodes.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs">
              {collectedCodes.slice(0, 8).map((item) => (
                <span
                  key={item.id}
                  className="rounded-md border border-slate-300 bg-slate-100 px-2.5 py-1 font-mono text-slate-800"
                >
                  {item.code} [{item.channel}]{" "}
                  {item.matchedName ? `• ${item.matchedName}` : ""}
                </span>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6 border-slate-200 shadow-sm">
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-bold text-slate-900">
            Add Wholesale / Purchase Item to Inventory
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <form
            onSubmit={handleAddProduct}
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6"
          >
            <Input
              placeholder="Supplier / Bill Ref"
              value={supplierOrBill}
              onChange={(e) => setSupplierOrBill(e.target.value)}
            />
            <Input
              placeholder="Barcode / SKU"
              value={sku}
              onChange={(e) => handleBarcodeLookup(e.target.value)}
            />
            <Input
              placeholder="Item Name *"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
            <Input
              type="number"
              step="any"
              placeholder="Cost Price (Rs)"
              value={costPrice}
              onChange={(e) => setCostPrice(e.target.value)}
            />
            <Input
              type="number"
              step="any"
              placeholder="Sale Price (Rs) *"
              value={salePrice}
              onChange={(e) => setSalePrice(e.target.value)}
            />
            <div className="flex gap-2">
              <Input
                type="number"
                min="1"
                placeholder="Qty"
                value={stockQty}
                onChange={(e) => setStockQty(e.target.value)}
                className="w-24"
              />
              <Button
                type="submit"
                className="flex-1 bg-green-600 font-bold text-white hover:bg-green-700"
              >
                Save to Inventory &amp; Purchase Ledger
              </Button>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                placeholder="Search item or SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-60"
              />
              {!cameraOpen ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={startCameraScanner}
                >
                  📷 Scan Bill / Item
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
              <label className="cursor-pointer rounded border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50">
                Import CSV
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleCSVImport}
                  className="hidden"
                />
              </label>
              <Button
                type="button"
                variant="outline"
                onClick={exportToCSV}
                className="text-xs font-semibold"
              >
                Export CSV
              </Button>
            </div>
          </div>

          {cameraOpen && (
            <div className="mt-3 space-y-2 rounded-lg border border-blue-400 bg-black p-2">
              <video
                ref={videoRef}
                className="max-h-60 w-full rounded object-cover"
                playsInline
                muted
              />
              <canvas ref={canvasRef} className="hidden" />
              <Button
                type="button"
                onClick={captureAndScanWholesale}
                disabled={scanningPhoto}
                className="bg-blue-600 font-bold text-white hover:bg-blue-700"
              >
                {scanningPhoto ? "Scanning..." : "📸 Capture & Scan"}
              </Button>
            </div>
          )}

          {scannedBillItems.length > 0 && (
            <div className="mt-3 flex items-center justify-between rounded border border-emerald-200 bg-emerald-50 p-2.5 text-xs">
              <span>
                Scanned Bill Items Ready: <strong>{scannedBillItems.length}</strong>
              </span>
              <Button
                type="button"
                onClick={handleAddAllScannedBillItems}
                className="bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-700"
              >
                + Add All Scanned Items
              </Button>
            </div>
          )}

          {error && (
            <p className="mt-3 rounded bg-blue-50 p-2 text-xs font-medium text-blue-700">
              {error}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="mb-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900 text-xs uppercase text-white">
            <tr>
              <th className="px-3 py-3">BARCODE / SKU</th>
              <th className="px-3 py-3">ITEM NAME</th>
              <th className="px-3 py-3 text-right">COST PRICE</th>
              <th className="px-3 py-3 text-right">SALE PRICE</th>
              <th className="px-3 py-3 text-right">STOCK QTY</th>
              <th className="px-3 py-3 text-center">STATUS</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                  Loading inventory...
                </td>
              </tr>
            ) : filteredProducts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-slate-400">
                  No products found.
                </td>
              </tr>
            ) : (
              filteredProducts.map((p) => {
                const uCost = lookupUnitCost(
                  p.id,
                  p.sku,
                  parseFloat(p.price || "0") || 0
                );
                return (
                  <tr key={p.id}>
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">
                      {p.sku}
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-900">
                      {p.name}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatMoney(uCost)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {formatMoney(parseFloat(p.price || "0") || 0)}
                    </td>
                    <td className="px-3 py-2 text-right font-bold">
                      {p.stockQty}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Badge
                        variant={
                          p.stockQty > 5
                            ? "success"
                            : p.stockQty > 0
                            ? "warning"
                            : "danger"
                        }
                      >
                        {p.stockQty > 5
                          ? "In Stock"
                          : p.stockQty > 0
                          ? "Low Stock"
                          : "Out of Stock"}
                      </Badge>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950 p-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-bold tracking-wide uppercase text-slate-100">
              SEPARATE DAILY LEDGERS &amp; CLOSING ({todayDate})
            </h2>
            <span className="rounded border border-emerald-700/60 bg-emerald-900/70 px-2.5 py-1 text-xs font-semibold text-emerald-300">
              {dayClosedManual
                ? `Day Closed (${todayDate})`
                : "Day Open (Closes at 12:00 AM Midnight)"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="border-slate-600 bg-slate-900 text-xs text-slate-100 hover:bg-slate-800"
              onClick={() => setDayClosedManual((prev) => !prev)}
            >
              {dayClosedManual
                ? `Re-Open ${todayDate}`
                : `Close ${todayDate} Sales`}
            </Button>
            <Button
              type="button"
              onClick={() => setActiveLedgerTab("purchase")}
              className={
                activeLedgerTab === "purchase"
                  ? "bg-blue-600 text-xs font-bold text-white"
                  : "bg-slate-800 text-xs text-slate-200 hover:bg-slate-700"
              }
            >
              📦 Wholesale / Manufacturer In ({todayPurchaseQty})
            </Button>
            <Button
              type="button"
              onClick={() => setActiveLedgerTab("sales")}
              className={
                activeLedgerTab === "sales"
                  ? "bg-emerald-600 text-xs font-bold text-white"
                  : "bg-slate-800 text-xs text-slate-200 hover:bg-slate-700"
              }
            >
              🧾 Customer Sales &amp; Profit ({todaySoldQty})
            </Button>
            <Button
              type="button"
              onClick={() => setActiveLedgerTab("khata")}
              className={
                activeLedgerTab === "khata"
                  ? "bg-purple-600 text-xs font-bold text-white"
                  : "bg-slate-800 text-xs text-slate-200 hover:bg-slate-700"
              }
            >
              📒 کھاتہ / حساب ({todayKhata.length})
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Card className="border-slate-800 bg-slate-900 text-white">
            <CardContent className="space-y-1 p-4">
              <div className="text-xs text-slate-400">
                Customer Sales Out ({todayDate})
              </div>
              <div className="text-lg font-bold text-white">
                {formatMoney(todaySalesTotal)}
              </div>
              <div className="text-xs font-semibold text-amber-300">
                Closed Sales ({todayDate}): {formatMoney(todaySalesTotal)}
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900 text-white">
            <CardContent className="space-y-1 p-4">
              <div className="text-xs text-slate-400">
                Total Items Sold ({todayDate})
              </div>
              <div className="text-lg font-bold text-sky-300">
                {todaySoldQty} Items
              </div>
              <div className="text-xs text-slate-400">ٹوٹل نکلی ہوئی آئٹمز</div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900 text-white">
            <CardContent className="space-y-1 p-4">
              <div className="text-xs text-slate-400">Back Cost of Sold Goods</div>
              <div className="text-lg font-bold text-amber-400">
                {formatMoney(todayCostOfSold)}
              </div>
              <div className="text-xs text-slate-400">پیچھے سے مال کی لاگت</div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900 text-white">
            <CardContent className="space-y-1 p-4">
              <div className="text-xs text-slate-400">Net Profit Today (منافع)</div>
              <div className="text-lg font-bold text-emerald-400">
                {formatMoney(todayNetProfit)}
              </div>
              <div className="text-xs text-slate-400">Sale − Back Cost</div>
            </CardContent>
          </Card>

          <Card className="border-slate-800 bg-slate-900 text-white">
            <CardContent className="space-y-1 p-4">
              <div className="text-xs text-slate-400">کھاتہ / حساب (Hisab)</div>
              <div className="text-lg font-bold text-purple-300">
                {formatMoney(khataHisabBalance)}
              </div>
              <div className="text-xs text-slate-400">
                In: {formatMoney(todayCashIn)} • Khata/Out:{" "}
                {formatMoney(todayKhataOut)}
              </div>
            </CardContent>
          </Card>
        </div>

        <form
          onSubmit={handleAddKhataEntry}
          className="grid gap-2 rounded-lg border border-slate-800 bg-slate-900/80 p-3 sm:grid-cols-4"
        >
          <Input
            placeholder="کھاتہ / حساب تفصیل (نام یا خرچ)"
            value={khataTitle}
            onChange={(e) => setKhataTitle(e.target.value)}
            className="border-slate-700 bg-slate-950 text-xs text-white"
          />
          <select
            value={khataType}
            onChange={(e) =>
              setKhataType(e.target.value as "expense" | "khata" | "cash_in")
            }
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"
          >
            <option value="khata">کھاتہ / ادھار (Khata -)</option>
            <option value="expense">خرچ (Expense -)</option>
            <option value="cash_in">وصولی / کیش اِن (Cash In +)</option>
          </select>
          <Input
            type="number"
            min={1}
            step="any"
            placeholder="رقم (Rs)"
            value={khataAmount}
            onChange={(e) => setKhataAmount(e.target.value)}
            className="border-slate-700 bg-slate-950 text-xs text-white"
          />
          <Button
            type="submit"
            className="bg-purple-600 text-xs font-bold text-white hover:bg-purple-700"
          >
            + کھاتہ / حساب میں ایڈ کریں
          </Button>
        </form>

        {activeLedgerTab === "purchase" && (
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-800 text-slate-300 uppercase">
                <tr>
                  <th className="px-3 py-2.5">DATE / TIME</th>
                  <th className="px-3 py-2.5">SUPPLIER / BILL</th>
                  <th className="px-3 py-2.5">ITEM / SKU</th>
                  <th className="px-3 py-2.5 text-right">QTY IN</th>
                  <th className="px-3 py-2.5 text-right">COST PRICE</th>
                  <th className="px-3 py-2.5 text-right">SALE PRICE</th>
                  <th className="px-3 py-2.5 text-right">TOTAL PURCHASE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {purchaseEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                      No wholesale purchase entries yet.
                    </td>
                  </tr>
                ) : (
                  purchaseEntries.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-mono text-slate-300">
                        {row.date} {row.time}
                      </td>
                      <td className="px-3 py-2 text-slate-200">
                        {row.supplierOrBill}
                      </td>
                      <td className="px-3 py-2 font-medium text-white">
                        {row.itemName} ({row.sku})
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-sky-300">
                        {row.qty}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatMoney(row.costPrice)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono">
                        {formatMoney(row.salePrice)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-emerald-300">
                        {formatMoney(row.totalPurchase)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeLedgerTab === "sales" && (
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-800 text-slate-300 uppercase">
                <tr>
                  <th className="px-3 py-2.5">DATE / TIME</th>
                  <th className="px-3 py-2.5">BILL #</th>
                  <th className="px-3 py-2.5">ITEM</th>
                  <th className="px-3 py-2.5 text-right">QTY OUT</th>
                  <th className="px-3 py-2.5 text-right">SALE TOTAL</th>
                  <th className="px-3 py-2.5 text-right">BACK COST</th>
                  <th className="px-3 py-2.5 text-right">PROFIT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {salesEntries.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                      No sales recorded yet.
                    </td>
                  </tr>
                ) : (
                  salesEntries.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-mono text-slate-300">
                        {row.date} {row.time}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-200">
                        #{row.billRef}
                      </td>
                      <td className="px-3 py-2 font-medium text-white">
                        {row.itemName}
                      </td>
                      <td className="px-3 py-2 text-right font-bold text-sky-300">
                        {row.qty}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-white">
                        {formatMoney(row.totalSale)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-amber-300">
                        {formatMoney(row.totalCost)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">
                        {formatMoney(row.profit)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {activeLedgerTab === "khata" && (
          <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-800 text-slate-300 uppercase">
                <tr>
                  <th className="px-3 py-2.5">DATE / TIME</th>
                  <th className="px-3 py-2.5">TITLE / DETAIL</th>
                  <th className="px-3 py-2.5">TYPE</th>
                  <th className="px-3 py-2.5 text-right">AMOUNT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {khataEntries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-slate-400">
                      کوئی کھاتہ یا حساب کی انٹری موجود نہیں ہے۔
                    </td>
                  </tr>
                ) : (
                  khataEntries.map((row) => (
                    <tr key={row.id}>
                      <td className="px-3 py-2 font-mono text-slate-300">
                        {row.date} {row.time}
                      </td>
                      <td className="px-3 py-2 font-medium text-white">
                        {row.title}
                      </td>
                      <td className="px-3 py-2 text-slate-300">
                        {row.entryType === "cash_in"
                          ? "وصولی (+)"
                          : row.entryType === "khata"
                          ? "کھاتہ (-)"
                          : "خرچ (-)"}
                      </td>
                      <td
                        className={
                          row.entryType === "cash_in"
                            ? "px-3 py-2 text-right font-mono font-bold text-emerald-400"
                            : "px-3 py-2 text-right font-mono font-bold text-rose-400"
                        }
                      >
                        {row.entryType === "cash_in" ? "+" : "-"}
                        {formatMoney(row.amount)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-900/70">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-800 text-slate-300 uppercase">
              <tr>
                <th className="px-3 py-2">DATE</th>
                <th className="px-3 py-2 text-right">ITEMS IN</th>
                <th className="px-3 py-2 text-right">PURCHASE</th>
                <th className="px-3 py-2 text-right">ITEMS SOLD</th>
                <th className="px-3 py-2 text-right">CLOSED SALES</th>
                <th className="px-3 py-2 text-right">PROFIT</th>
                <th className="px-3 py-2 text-center">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {dateClosingSummary.map((dRow) => (
                <tr key={dRow.date}>
                  <td className="px-3 py-2 font-mono font-bold text-white">
                    {dRow.date}
                  </td>
                  <td className="px-3 py-2 text-right">{dRow.pQty}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {formatMoney(dRow.pTotal)}
                  </td>
                  <td className="px-3 py-2 text-right font-bold text-sky-300">
                    {dRow.sQty}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-amber-300">
                    {formatMoney(dRow.sTotal)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">
                    {formatMoney(dRow.profitTotal)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span
                      className={
                        dRow.isClosed
                          ? "rounded bg-rose-950 px-2 py-0.5 text-[11px] font-semibold text-rose-300"
                          : "rounded bg-emerald-950 px-2 py-0.5 text-[11px] font-semibold text-emerald-300"
                      }
                    >
                      {dRow.isClosed ? "Closed" : "Open (Till 12 AM)"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AppShell>
  );
}
