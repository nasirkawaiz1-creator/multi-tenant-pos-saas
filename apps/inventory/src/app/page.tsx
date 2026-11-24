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
const CUSTOMER_KHATA_BOOK_KEY = "pos:customerKhataBook:v1";
const MIDNIGHT_ROLLOVER_INTERVAL_MS = 15000;

type DeviceChannel = "USB" | "Bluetooth" | "Barcode" | "Keyboard";
type KhataEntryType = "expense" | "khata" | "cash_in";

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
  entryType: KhataEntryType;
  amount: number;
}

interface CustomerKhataTx {
  id: string;
  date: string;
  time: string;
  type: "udhaar" | "received";
  amount: number;
  note: string;
  balanceAfter: number;
}

interface CustomerKhataAccount {
  id: string;
  name: string;
  phone: string;
  address: string;
  balance: number;
  lastDate: string;
  transactions: CustomerKhataTx[];
}

interface ScannedBillItem {
  name: string;
  sku: string;
  costPrice: string;
  salePrice: string;
  qty: number;
  amount: number;
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
    if (typeof window === "undefined") return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeJsonWrite<T>(key: string, value: T): void {
  try {
    if (typeof window === "undefined") return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function formatMoney(num: number): string {
  return `Rs ${Number(num || 0).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function parseNumericValue(raw: unknown, fallback: number = 0): number {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : fallback;
  }
  if (raw === null || raw === undefined) return fallback;
  const cleaned = String(raw).replace(/[^0-9.-]/g, "").trim();
  if (!cleaned) return fallback;
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function InventoryPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [supplierOrBill, setSupplierOrBill] = useState("");
  const [scannedBillTotal, setScannedBillTotal] = useState<number | null>(null);
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
  const productCostMapRef = useRef<Record<string, number>>({});
  const todayDateRef = useRef<string>(getTodayDateStr());
  const [activeLedgerTab, setActiveLedgerTab] = useState<
    "purchase" | "sales" | "khata"
  >("purchase");

  const [customerAccounts, setCustomerAccounts] = useState<CustomerKhataAccount[]>(
    []
  );

  const [khataSearch, setKhataSearch] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [khataModalMode, setKhataModalMode] = useState<
    "none" | "new_customer" | "received" | "udhaar"
  >("none");

  const [newCustName, setNewCustName] = useState("");
  const [newCustPhone, setNewCustPhone] = useState("");
  const [newCustAddress, setNewCustAddress] = useState("");
  const [newCustOpeningUdhaar, setNewCustOpeningUdhaar] = useState("");
  const [newCustDate, setNewCustDate] = useState(() => getTodayDateStr());

  const [txCustomerId, setTxCustomerId] = useState("");
  const [txAmount, setTxAmount] = useState("");
  const [txNote, setTxNote] = useState("");
  const [txDate, setTxDate] = useState(() => getTodayDateStr());

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
    const savedCustomers = safeJsonRead<CustomerKhataAccount[]>(
      CUSTOMER_KHATA_BOOK_KEY,
      []
    ).filter((c) => c.id !== "CUST-SAMPLE-1");
    const savedCostMap = safeJsonRead<Record<string, number>>(
      PRODUCT_COST_MAP_KEY,
      {}
    );

    setPurchaseEntries(savedPurchases);
    setSalesEntries(savedSales);
    setKhataEntries(savedKhata);
    setCustomerAccounts(savedCustomers);
    safeJsonWrite(CUSTOMER_KHATA_BOOK_KEY, savedCustomers);
    setProductCostMap(savedCostMap);
    productCostMapRef.current = savedCostMap;

    loadStoreProfile();
    loadProducts(savedCostMap);
    syncSalesFromOrders(savedCostMap);
  }, []);

  useEffect(() => {
    const syncDateRollover = () => {
      const nextDate = getTodayDateStr();
      if (nextDate !== todayDateRef.current) {
        void syncSalesFromOrders(productCostMapRef.current);
      }
      setTodayDate(nextDate);
    };

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        syncDateRollover();
        void syncSalesFromOrders(productCostMapRef.current);
      }
    };

    syncDateRollover();
    const timer = window.setInterval(syncDateRollover, MIDNIGHT_ROLLOVER_INTERVAL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", syncDateRollover);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", syncDateRollover);
    };
  }, []);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  useEffect(() => {
    productCostMapRef.current = productCostMap;
  }, [productCostMap]);

  useEffect(() => {
    todayDateRef.current = todayDate;
  }, [todayDate]);

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

  function saveCustomerAccounts(nextList: CustomerKhataAccount[]) {
    setCustomerAccounts(nextList);
    safeJsonWrite(CUSTOMER_KHATA_BOOK_KEY, nextList);
  }

  function getInitials(fullName: string): string {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "CU";
    if (parts.length === 1) return (parts[0] || "CU").slice(0, 2).toUpperCase();
    return `${parts[0]?.[0] || ""}${parts[1]?.[0] || ""}`.toUpperCase();
  }

  function formatWhatsAppPhone(rawPhone: string): string {
    const digits = rawPhone.replace(/\D/g, "");
    if (!digits) return "";
    if (digits.startsWith("03") && digits.length === 11) {
      return `92${digits.slice(1)}`;
    }
    return digits;
  }

  function openWhatsAppReminder(cust: CustomerKhataAccount) {
    const waPhone = formatWhatsAppPhone(cust.phone);
    if (!waPhone) {
      alert("اس کسٹمر کا درست موبائل نمبر درج نہیں ہے۔");
      return;
    }
    const storeLabel = storeInfo.name || "ہمارے اسٹور";
    const msg = `السلام علیکم ${cust.name}،\n${storeLabel} کی طرف سے یاد دہانی: آپ کے کھاتے میں بقایا رقم ${formatMoney(
      cust.balance
    )} واجب الادا ہے (آخری تاریخ: ${cust.lastDate})۔ براہِ کرم جلد ادائیگی کر دیں۔ شکریہ!`;
    const url = `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function createCustomerRecord(params: {
    cName: string;
    cPhone: string;
    cAddress: string;
    opening: number;
    entryDate: string;
  }): CustomerKhataAccount | null {
    const cName = params.cName.trim();
    const cPhone = params.cPhone.trim();
    const cAddress = params.cAddress.trim();
    const opening = Math.max(0, Number(params.opening) || 0);
    const entryDate = params.entryDate || getTodayDateStr();
    if (!cName) return null;

    const now = new Date();
    const initialTxs: CustomerKhataTx[] =
      opening > 0
        ? [
            {
              id: `TX-${Date.now()}`,
              date: entryDate,
              time: formatTimeStr(now),
              type: "udhaar",
              amount: opening,
              note: "کھاتہ اوپننگ بیلنس",
              balanceAfter: opening,
            },
          ]
        : [];

    const newAcc: CustomerKhataAccount = {
      id: `CUST-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      name: cName,
      phone: cPhone,
      address: cAddress,
      balance: opening,
      lastDate: entryDate,
      transactions: initialTxs,
    };

    const nextAccounts = [newAcc, ...customerAccounts];
    saveCustomerAccounts(nextAccounts);
    setSelectedCustomerId(newAcc.id);
    setTodayDate(getTodayDateStr(now));
    setActiveLedgerTab("khata");

    if (opening > 0) {
      const ledgerItem: KhataEntry = {
        id: `KHT-${Date.now()}`,
        date: entryDate,
        time: formatTimeStr(now),
        title: `${cName} (${cPhone || "-"}) — New Khata`,
        entryType: "khata",
        amount: opening,
      };
      setKhataEntries((prev) => {
        const next = [ledgerItem, ...prev];
        safeJsonWrite(KHATA_LEDGER_KEY, next);
        return next;
      });
    }

    setNewCustName("");
    setNewCustPhone("");
    setNewCustAddress("");
    setNewCustOpeningUdhaar("");
    setKhataModalMode("none");

    return newAcc;
  }

  function handleCreateCustomerKhata(e: FormEvent) {
    e.preventDefault();
    createCustomerRecord({
      cName: newCustName,
      cPhone: newCustPhone,
      cAddress: newCustAddress,
      opening: Number(newCustOpeningUdhaar) || 0,
      entryDate: newCustDate,
    });
  }

  function handleSaveAndSendWhatsApp() {
    const cName = newCustName.trim();
    const cPhone = newCustPhone.trim();
    const opening = Math.max(0, Number(newCustOpeningUdhaar) || 0);
    const entryDate = newCustDate || getTodayDateStr();

    if (!cName || !cPhone) {
      alert("براہ کرم کسٹمر کا نام اور واٹس ایپ نمبر درج کریں۔");
      return;
    }

    const created = createCustomerRecord({
      cName,
      cPhone,
      cAddress: newCustAddress,
      opening,
      entryDate,
    });

    if (created) {
      openWhatsAppReminder(created);
    }
  }

  function handleRecordCustomerTx(e: FormEvent) {
    e.preventDefault();
    const targetId = txCustomerId || selectedCustomerId || customerAccounts[0]?.id;
    const amt = Number(txAmount);
    if (!targetId || !Number.isFinite(amt) || amt <= 0) return;

    const mode = khataModalMode === "received" ? "received" : "udhaar";
    const entryDate = txDate || getTodayDateStr();
    const now = new Date();
    const cleanAmt = Math.round(amt * 100) / 100;

    let targetName = "";
    let targetPhone = "";

    const updatedAccounts = customerAccounts.map((acc) => {
      if (acc.id !== targetId) return acc;
      targetName = acc.name;
      targetPhone = acc.phone;
      const nextBal =
        mode === "received"
          ? Math.round((acc.balance - cleanAmt) * 100) / 100
          : Math.round((acc.balance + cleanAmt) * 100) / 100;

      const tx: CustomerKhataTx = {
        id: `TX-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        date: entryDate,
        time: formatTimeStr(now),
        type: mode,
        amount: cleanAmt,
        note:
          txNote.trim() ||
          (mode === "received" ? "رقم وصول ہوئی" : "مزید ادھار"),
        balanceAfter: nextBal,
      };

      return {
        ...acc,
        balance: nextBal,
        lastDate: entryDate,
        transactions: [tx, ...acc.transactions],
      };
    });

    saveCustomerAccounts(updatedAccounts);
    setSelectedCustomerId(targetId);
    setTodayDate(getTodayDateStr(now));
    setActiveLedgerTab("khata");

    const ledgerItem: KhataEntry = {
      id: `KHT-${Date.now()}`,
      date: entryDate,
      time: formatTimeStr(now),
      title: `${targetName} (${targetPhone || "-"}) — ${
        mode === "received" ? "Money Received" : "Udhaar"
      }`,
      entryType: mode === "received" ? "cash_in" : "khata",
      amount: cleanAmt,
    };

    setKhataEntries((prev) => {
      const next = [ledgerItem, ...prev];
      safeJsonWrite(KHATA_LEDGER_KEY, next);
      return next;
    });

    setTxAmount("");
    setTxNote("");
    setKhataModalMode("none");
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
    setScannedBillTotal(null);
    setError("📷 نیا اسٹاک / بل اسکین ہو رہا ہے، ٹریڈرز کا نام، آئٹمز اور ریٹ نکالے جا رہے ہیں...");

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

          const rawText = await res.text();
          let payload: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(rawText);
            payload = Array.isArray(parsed)
              ? (parsed[0] as Record<string, unknown>) || {}
              : (parsed as Record<string, unknown>) || {};
          } catch {
            payload = {};
          }

          const dataObj: Record<string, unknown> =
            payload?.product && typeof payload.product === "object"
              ? (payload.product as Record<string, unknown>)
              : payload;

          const traderName = String(
            dataObj?.supplier_name ??
              payload?.supplier_name ??
              dataObj?.trader_name ??
              payload?.trader_name ??
              dataObj?.manufacturer ??
              payload?.manufacturer ??
              dataObj?.invoice_no ??
              payload?.invoice_no ??
              dataObj?.bill_no ??
              payload?.bill_no ??
              ""
          ).trim();
          if (traderName) {
            setSupplierOrBill(traderName);
          }

          const billTotalRaw =
            dataObj?.total ??
            payload?.total ??
            dataObj?.grand_total ??
            payload?.grand_total ??
            null;
          const parsedBillTotal =
            billTotalRaw !== null &&
            billTotalRaw !== undefined &&
            String(billTotalRaw).trim() !== ""
              ? parseNumericValue(billTotalRaw, 0)
              : null;

          const rawItems = Array.isArray(dataObj?.items)
            ? dataObj.items
            : Array.isArray(dataObj?.bill_items)
            ? dataObj.bill_items
            : [];

          if (rawItems.length > 0) {
            const parsed: ScannedBillItem[] = rawItems
              .map((rawIt: unknown, idx: number) => {
                const it =
                  rawIt && typeof rawIt === "object"
                    ? (rawIt as Record<string, unknown>)
                    : {};
                const qtyNum = Math.max(
                  1,
                  parseInt(
                    String(it?.qty ?? it?.quantity ?? it?.stockQty ?? "1"),
                    10
                  ) || 1
                );

                const rawCost =
                  it?.cost_price ??
                  it?.purchase_price ??
                  it?.wholesale_price ??
                  it?.rate ??
                  it?.price;
                const rawAmount = it?.amount ?? it?.line_total ?? it?.total;

                let costNum = parseNumericValue(rawCost, 0);
                let lineAmountNum = parseNumericValue(rawAmount, 0);

                if (costNum <= 0 && lineAmountNum > 0 && qtyNum > 0) {
                  costNum = Math.round((lineAmountNum / qtyNum) * 100) / 100;
                }
                if (lineAmountNum <= 0 && costNum > 0) {
                  lineAmountNum = Math.round(costNum * qtyNum * 100) / 100;
                }

                const rawSale = it?.sale_price ?? it?.retail_price;
                const saleNum =
                  rawSale !== undefined && String(rawSale).trim() !== ""
                    ? parseNumericValue(rawSale, costNum)
                    : costNum;

                return {
                  name: String(
                    it?.product_name ?? it?.item_name ?? it?.name ?? ""
                  ).trim(),
                  sku: String(
                    it?.barcode ??
                      it?.sku ??
                      it?.code ??
                      `POS-${Date.now().toString().slice(-5)}-${idx + 1}`
                  ).trim(),
                  costPrice: String(costNum),
                  salePrice: String(saleNum),
                  qty: qtyNum,
                  amount: lineAmountNum,
                };
              })
              .filter((r: ScannedBillItem) => r.name.length > 0);

            if (parsed.length > 0) {
              setScannedBillItems(parsed);
              const computedSum = parsed.reduce((acc, r) => acc + r.amount, 0);
              setScannedBillTotal(
                parsedBillTotal && parsedBillTotal > 0
                  ? parsedBillTotal
                  : computedSum
              );

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
                `✔ نیا اسٹاک اسکین مکمل: ${
                  traderName ? `بل/ٹریڈر: ${traderName} | ` : ""
                }${parsed.length} آئٹمز ریٹ اور رقم کے ساتھ آ گئی ہیں۔`
              );
              return;
            }
          }

          const extractedName = String(
            dataObj?.product_name ?? dataObj?.item_name ?? dataObj?.name ?? ""
          ).trim();
          const extractedSku = String(
            dataObj?.barcode ?? dataObj?.sku ?? dataObj?.code ?? ""
          ).trim();
          const singleQty = Math.max(
            1,
            parseInt(
              String(
                dataObj?.qty ??
                  payload?.qty ??
                  dataObj?.quantity ??
                  dataObj?.stockQty ??
                  "1"
              ),
              10
            ) || 1
          );
          const rawSingleCost =
            dataObj?.cost_price ??
            payload?.cost_price ??
            dataObj?.purchase_price ??
            dataObj?.rate ??
            dataObj?.price;
          const rawSingleAmount =
            dataObj?.amount ?? payload?.amount ?? parsedBillTotal;

          let singleCost = parseNumericValue(rawSingleCost, 0);
          let singleAmount = parseNumericValue(rawSingleAmount, 0);
          if (singleCost <= 0 && singleAmount > 0 && singleQty > 0) {
            singleCost = Math.round((singleAmount / singleQty) * 100) / 100;
          }
          if (singleAmount <= 0 && singleCost > 0) {
            singleAmount = Math.round(singleCost * singleQty * 100) / 100;
          }

          const extractedSale =
            dataObj?.sale_price ?? payload?.sale_price ?? singleCost;

          if (extractedName) setName(extractedName);
          if (extractedSku) {
            setSku(extractedSku);
            collectBarcodeEntry(extractedSku, "Barcode");
          } else if (extractedName && !sku.trim()) {
            const genSku = `POS-${Math.floor(100000 + Math.random() * 900000)}`;
            setSku(genSku);
            collectBarcodeEntry(genSku, "Barcode");
          }
          if (singleCost > 0) setCostPrice(String(singleCost));
          setSalePrice(String(parseNumericValue(extractedSale, singleCost)));
          setStockQty(String(singleQty));
          if (singleAmount > 0) {
            setScannedBillTotal(singleAmount);
          }

          stopCamera();
          if (extractedName || extractedSku) {
            setError(
              `✔ اسکین مکمل: ${
                traderName ? `${traderName} — ` : ""
              }${extractedName || "آئٹم"} | کوڈ: ${extractedSku || "-"}`
            );
          } else {
            setError(
              "تصویر ویب ہک تک پہنچ گئی، لیکن نام واضح نہیں پڑھا جا سکا — آپ نام لکھ کر بھی آگے بڑھ سکتے ہیں۔"
            );
          }
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
    itemAmount?: number;
    billLabel?: string;
  }): Promise<Product | null> {
    const cleanSku =
      params.itemSku.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
    const parsedCost = parseNumericValue(params.itemCostPrice.trim(), 0);
    const parsedSale =
      params.itemSalePrice.trim() !== ""
        ? parseNumericValue(params.itemSalePrice.trim(), parsedCost)
        : parsedCost;
    const cleanQty = params.itemQty > 0 ? params.itemQty : 1;

    const lineTotal =
      params.itemAmount !== undefined && params.itemAmount > 0
        ? Math.round(params.itemAmount * 100) / 100
        : Math.round(parsedCost * cleanQty * 100) / 100;

    const effectiveUnitCost =
      parsedCost > 0
        ? parsedCost
        : lineTotal > 0 && cleanQty > 0
        ? Math.round((lineTotal / cleanQty) * 100) / 100
        : 0;

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
      saveCostMapping(createdProduct.id, createdProduct.sku, effectiveUnitCost);
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
      saveCostMapping(undefined, cleanSku, effectiveUnitCost);
    }

    const now = new Date();
    appendPurchaseRecord({
      date: getTodayDateStr(now),
      time: formatTimeStr(now),
      supplierOrBill:
        (params.billLabel || supplierOrBill).trim() || "New Stock / Wholesale",
      sku: cleanSku,
      itemName: params.itemName.trim(),
      qty: cleanQty,
      costPrice: effectiveUnitCost,
      salePrice: parsedSale,
      totalPurchase: lineTotal,
    });

    setTodayDate(getTodayDateStr(now));

    return createdProduct || null;
  }
