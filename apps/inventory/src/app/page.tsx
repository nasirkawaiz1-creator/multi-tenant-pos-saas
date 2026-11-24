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
  const [savingStock, setSavingStock] = useState(false);

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
          async function saveWholesalePurchaseItem(params: {
    itemName: string;
    itemSku: string;
    itemCostPrice: string;
    itemSalePrice: string;
    itemQty: number;
    itemAmount?: number;
    billLabel?: string;
  }): Promise<{ saved: boolean; backendError?: string }> {
    const cleanName = params.itemName.trim();
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

    const now = new Date();
    const activeDate = getTodayDateStr(now);

    saveCostMapping(existingProduct?.id, cleanSku, effectiveUnitCost);
    appendPurchaseRecord({
      date: activeDate,
      time: formatTimeStr(now),
      supplierOrBill:
        (params.billLabel || supplierOrBill).trim() || "New Stock / Wholesale",
      sku: cleanSku,
      itemName: cleanName,
      qty: cleanQty,
      costPrice: effectiveUnitCost,
      salePrice: parsedSale,
      totalPurchase: lineTotal,
    });

    setProducts((prev) => {
      const idx = prev.findIndex(
        (p) => p.sku && p.sku.toLowerCase() === cleanSku.toLowerCase()
      );
      let nextList: Product[];
      if (idx >= 0 && prev[idx]) {
        const current = prev[idx];
        const updated: Product = {
          ...current,
          name: cleanName || current.name,
          price: String(parsedSale),
          stockQty: nextStockQty,
        };
        nextList = prev.map((item, i) => (i === idx ? updated : item));
      } else {
        const optimisticItem = {
          id: `LOCAL-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
          name: cleanName,
          sku: cleanSku,
          price: String(parsedSale),
          stockQty: nextStockQty,
        } as unknown as Product;
        nextList = [optimisticItem, ...prev];
      }
      return nextList;
    });

    setTodayDate(activeDate);

    try {
      const response = await apiFetch<Product | { data: Product }>("/products", {
        method: "POST",
        body: JSON.stringify({
          name: cleanName,
          sku: cleanSku,
          price: String(parsedSale),
          stockQty: nextStockQty,
        }),
      });

      const createdProduct =
        response && typeof response === "object" && "data" in response
          ? (response as { data: Product }).data
          : (response as Product);

      if (createdProduct && createdProduct.id) {
        saveCostMapping(createdProduct.id, createdProduct.sku, effectiveUnitCost);
        setProducts((prev) => {
          const withoutLocal = prev.filter(
            (p) =>
              !String(p.id).startsWith("LOCAL-") ||
              (p.sku || "").toLowerCase() !== cleanSku.toLowerCase()
          );
          const exists = withoutLocal.findIndex(
            (p) => p.id === createdProduct.id
          );
          if (exists >= 0) {
            return withoutLocal.map((p) =>
              p.id === createdProduct.id ? createdProduct : p
            );
          }
          return [createdProduct, ...withoutLocal];
        });
      }

      return { saved: true };
    } catch (err) {
      return {
        saved: true,
        backendError:
          err instanceof Error ? err.message : "Server sync failed",
      };
    }
  }

  async function handleAddAllScannedBillItems() {
    if (scannedBillItems.length === 0 || savingStock) return;
    setSavingStock(true);
    setError("⏳ بل کی تمام آئٹمز STOCK اور Purchase Ledger میں محفوظ کی جا رہی ہیں...");
    try {
      const activeBillLabel = supplierOrBill.trim() || "Scanned Stock Bill";
      let failCount = 0;
      let lastBackendErr = "";

      for (const row of scannedBillItems) {
        const res = await saveWholesalePurchaseItem({
          itemName: row.name,
          itemSku: row.sku,
          itemCostPrice: row.costPrice,
          itemSalePrice: row.salePrice,
          itemQty: row.qty,
          itemAmount: row.amount,
          billLabel: activeBillLabel,
        });
        if (res.backendError) {
          failCount++;
          lastBackendErr = res.backendError;
        }
      }

      setScannedBillItems([]);
      setScannedBillTotal(null);
      setActiveLedgerTab("purchase");

      if (failCount === 0) {
        setError(
          `✔ "${activeBillLabel}" کے بل کی تمام آئٹمز STOCK اور Purchase Ledger میں محفوظ ہو گئیں!`
        );
      } else {
        setError(
          `✔ آئٹمز لوکل STOCK / Purchase Ledger میں محفوظ ہو گئیں، تاہم سرور پر ${failCount} آئٹمز سنک نہیں ہو سکیں (${lastBackendErr})۔`
        );
      }
    } catch (err) {
      console.error("Failed to save scanned bill items", err);
      setError("❌ بل کی آئٹمز سیو کرنے میں خرابی ہوئی۔");
    } finally {
      setSavingStock(false);
    }
  }

  async function handleAddProduct(e: FormEvent) {
    e.preventDefault();
    if (savingStock) return;
    if (!name.trim() || (!salePrice.trim() && !costPrice.trim())) {
      alert("براہ کرم پروڈکٹ کا نام اور قیمت درج کریں!");
      return;
    }

    setSavingStock(true);
    setError("⏳ نیا اسٹاک محفوظ کیا جا رہا ہے...");
    try {
      const cleanCode =
        sku.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
      const qtyNum = parseInt(stockQty, 10) || 1;
      const costNum = parseNumericValue(
        costPrice.trim() || salePrice.trim(),
        0
      );
      const saleNum = parseNumericValue(
        salePrice.trim() || costPrice.trim(),
        costNum
      );
      const computedLineAmount = Math.round(costNum * qtyNum * 100) / 100;

      const res = await saveWholesalePurchaseItem({
        itemName: name.trim(),
        itemSku: cleanCode,
        itemCostPrice: String(costNum),
        itemSalePrice: String(saleNum),
        itemQty: qtyNum,
        itemAmount: computedLineAmount,
        billLabel: supplierOrBill.trim() || "New Stock Entry",
      });

      collectBarcodeEntry(cleanCode, selectedChannel);

      setName("");
      setSku("");
      setCostPrice("");
      setSalePrice("");
      setStockQty("100");
      setActiveLedgerTab("purchase");

      if (!res.backendError) {
        setError(
          "✔ نیا اسٹاک انونٹری اور ہول سیل Purchase Ledger میں محفوظ ہو گیا ہے!"
        );
      } else {
        setError(
          `✔ اسٹاک لوکل لیجر میں محفوظ ہو گیا ہے، لیکن سرور سنک میں مسئلہ آیا (${res.backendError})۔`
        );
      }
    } catch (err) {
      console.error("Failed to add product", err);
      setError("❌ پروڈکٹ سیو کرنے میں خرابی ہوئی۔");
    } finally {
      setSavingStock(false);
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
            itemAmount: Math.round(Number(pCost) * pStock * 100) / 100,
            billLabel: "CSV Import",
          });
          if (saved.saved) {
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
    const isClosed = d < todayDate;

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

  const scannedItemsSum = scannedBillItems.reduce(
    (sum, item) => sum + item.amount,
    0
  );
  const displayScannedTotal =
    scannedBillTotal !== null && scannedBillTotal > 0
      ? scannedBillTotal
      : scannedItemsSum;

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
          <p className="text-sm font-medium text-slate-600">
            {storeInfo.details}
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-600">
          {storeInfo.phone && (
            <span className="rounded bg-slate-100 px-3 py-1 font-medium text-slate-700">
              📞 {storeInfo.phone}
            </span>
          )}
          <span className="rounded bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            Active Date: {todayDate}
          </span>
        </div>
      </div>

      <PageHeader
        title="STOCK — Inventory & Wholesale Purchase"
        description="اوپر سے آنے والے نئے اسٹاک (STOCK) کی انٹری، بل اسکین، اور سیل / کھاتہ کے الگ خانے۔"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push("/checkout")}
            >
              Checkout Counter
            </Button>
            <Button type="button" variant="outline" onClick={exportToCSV}>
              Export CSV
            </Button>
            <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50">
              Import CSV
              <input
                type="file"
                accept=".csv"
                onChange={handleCSVImport}
                className="hidden"
              />
            </label>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          {error}
        </div>
      )}

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-slate-500">
              STOCK — Today Purchase Qty
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-900">
              {todayPurchaseQty}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-slate-500">
              SALE — Today Sold Qty
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-900">{todaySoldQty}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-slate-500">
              SALE — Today Sales Total
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-emerald-700">
              {formatMoney(todaySalesTotal)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Cost: {formatMoney(todayCostOfSold)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-slate-500">
              Today Net Profit / Hisab
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-blue-700">
              {formatMoney(todayNetProfit)}
            </p>
            <p className="mt-1 text-xs text-slate-500">
              Khata Balance: {formatMoney(khataHisabBalance)}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>STOCK — Add / Restock Product</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddProduct} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Supplier / Bill Name
                  </label>
                  <Input
                    value={supplierOrBill}
                    onChange={(e) => setSupplierOrBill(e.target.value)}
                    placeholder="Bill supplier / customer name"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Barcode / SKU
                  </label>
                  <Input
                    value={sku}
                    onChange={(e) => handleBarcodeLookup(e.target.value)}
                    placeholder="Scan or enter SKU"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium text-slate-700">
                  Product Name
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter product name"
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Rate / Cost Price (Rs)
                  </label>
                  <Input
                    type="number"
                    step="any"
                    value={costPrice}
                    onChange={(e) => setCostPrice(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Sale Price (Rs)
                  </label>
                  <Input
                    type="number"
                    step="any"
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">
                    Qty / Stock
                  </label>
                  <Input
                    type="number"
                    value={stockQty}
                    onChange={(e) => setStockQty(e.target.value)}
                    placeholder="100"
                    required
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button type="submit" disabled={savingStock}>
                  {savingStock ? "Saving..." : "Save to STOCK"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={cameraOpen ? stopCamera : startCameraScanner}
                >
                  {cameraOpen ? "Stop Camera" : "Scan Bill / Product"}
                </Button>
              </div>
            </form>

            {cameraOpen && (
              <div className="mt-4 space-y-2 rounded-lg border border-slate-200 bg-slate-950 p-3">
                <video
                  ref={videoRef}
                  className="max-h-64 w-full rounded bg-black object-contain"
                  playsInline
                  muted
                />
                <canvas ref={canvasRef} className="hidden" />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    disabled={scanningPhoto}
                    onClick={captureAndScanWholesale}
                  >
                    {scanningPhoto ? "Scanning..." : "Capture & Scan"}
                  </Button>
                </div>
              </div>
            )}

            {scannedBillItems.length > 0 && (
              <div className="mt-4 rounded-lg border border-emerald-300 bg-emerald-50/80 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-emerald-200 pb-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded bg-emerald-800 px-2 py-0.5 text-xs font-bold uppercase text-white">
                        STOCK
                      </span>
                      <span className="text-sm font-bold text-emerald-950">
                        {supplierOrBill.trim() || "Scanned Bill"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-medium text-emerald-900">
                      Items ({scannedBillItems.length}) • Total:{" "}
                      <strong>{formatMoney(displayScannedTotal)}</strong>
                    </p>
                  </div>
                  <Button
                    type="button"
                    disabled={savingStock}
                    onClick={handleAddAllScannedBillItems}
                  >
                    {savingStock ? "Adding..." : "Add All Items"}
                  </Button>
                </div>

                <div className="space-y-2">
                  {scannedBillItems.map((it, idx) => (
                    <div
                      key={`${it.sku}-${idx}`}
                      className="rounded-md border border-emerald-200 bg-white p-2.5 text-xs text-slate-900 shadow-2xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-slate-950">
                          {idx + 1}. {it.name}
                        </span>
                        <span className="font-mono text-[11px] text-slate-500">
                          {it.sku}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1.5 text-[11px] text-slate-700">
                        <span>
                          Qty: <strong>{it.qty}</strong>
                        </span>
                        <span>
                          Rate: <strong>Rs {it.costPrice}</strong>
                        </span>
                        <span>
                          Amount: <strong>{formatMoney(it.amount)}</strong>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scanner &amp; Receipt Printer</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {(["Barcode", "USB", "Bluetooth", "Keyboard"] as DeviceChannel[]).map(
                (ch) => (
                  <Button
                    key={ch}
                    type="button"
                    variant={selectedChannel === ch ? "default" : "outline"}
                    onClick={() => handleConnectChannel(ch)}
                  >
                    {ch}
                  </Button>
                )
              )}
            </div>

            <p className="text-xs text-slate-600">{deviceStatusText}</p>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handlePrintCustomerReceipt}
              >
                Print Receipt
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => collectBarcodeEntry(sku || "TEST-SKU", selectedChannel)}
              >
                Log Code
              </Button>
            </div>

            {collectedCodes.length > 0 && (
              <div className="max-h-40 overflow-y-auto rounded border border-slate-200 p-2 text-xs">
                {collectedCodes.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between border-b border-slate-100 py-1 last:border-b-0"
                  >
                    <span>
                      <strong>{c.code}</strong> ({c.channel})
                      {c.matchedName ? ` — ${c.matchedName}` : ""}
                    </span>
                    <span className="text-slate-500">{c.time}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
