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

const PURCHASE_LEDGER_BASE_KEY = "pos:wholesalePurchaseLedger:v1";
const SALES_LEDGER_BASE_KEY = "pos:customerSalesLedger:v1";
const PRODUCT_COST_MAP_BASE_KEY = "pos:productCostMap:v1";
const KHATA_LEDGER_BASE_KEY = "pos:dailyKhataLedger:v1";
const CUSTOMER_KHATA_BOOK_BASE_KEY = "pos:customerKhataBook:v1";
const LAST_BILL_IMAGE_BASE_KEY = "pos:lastScannedBillImage:v1";
const MIDNIGHT_ROLLOVER_INTERVAL_MS = 15000;
const SALES_SYNC_POLL_MS = 4000;
const DEFAULT_PAGE_SIZE = 10;

type DeviceChannel = "USB" | "Bluetooth" | "Barcode" | "Keyboard";
type KhataEntryType = "expense" | "khata" | "cash_in";

interface StoreProfile {
  name: string;
  details: string;
  phone: string;
  tenantId?: string;
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
  tenantId?: string;
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
  tenantId?: string;
}

interface BackendOrderItem {
  id?: string | number;
  productId?: string;
  sku?: string;
  productName?: string;
  name?: string;
  quantity?: number;
  qty?: number;
  unitPrice?: number | string;
  price?: number | string;
  tenantId?: string | number;
  tenant_id?: string | number;
  storeId?: string | number;
  store_id?: string | number;
}

interface BackendOrder {
  id?: string | number;
  orderNumber?: string | number;
  billNo?: string | number;
  createdAt?: string;
  created_at?: string;
  date?: string;
  total?: number | string;
  subtotal?: number | string;
  items?: BackendOrderItem[];
  tenantId?: string | number;
  tenant_id?: string | number;
  storeId?: string | number;
  store_id?: string | number;
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

function sanitizeTenantId(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).trim().replace(/[^a-zA-Z0-9_-]/g, "_");
}

function extractRecordTenantId(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const rec = obj as Record<string, unknown>;
  const raw =
    rec.tenantId ??
    rec.tenant_id ??
    rec.storeId ??
    rec.store_id ??
    (rec.store && typeof rec.store === "object"
      ? (rec.store as Record<string, unknown>).id ??
        (rec.store as Record<string, unknown>).tenantId ??
        (rec.store as Record<string, unknown>).storeId
      : undefined) ??
    "";
  return sanitizeTenantId(raw);
}

/**
 * سخت قانون: اگر ریکارڈ میں کوئی دکان/ٹیننٹ آئی ڈی موجود ہے تو وہ
 * موجودہ دکان (activeTenantKey) کے عین مطابق ہونی چاہیے۔
 * اگر مختلف ہو تو فوراً false لوٹائے گا تاکہ دوسری دکان کا ڈیٹا مکس نہ ہو۔
 */
function belongsToActiveTenant(obj: unknown, activeTenantKey: string): boolean {
  const cleanActive = sanitizeTenantId(activeTenantKey);
  if (!cleanActive) return true;
  const recordTenant = extractRecordTenantId(obj);
  if (!recordTenant) return true;
  return recordTenant.toLowerCase() === cleanActive.toLowerCase();
}

function getTenantIdFromToken(): string {
  if (typeof window === "undefined") return "default";
  const token = getToken() || "";
  try {
    const parts = token.split(".");
    if (parts.length === 3 && parts[1]) {
      const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const decoded = JSON.parse(atob(normalized)) as Record<string, unknown>;
      const candidate =
        decoded.tenantId ??
        decoded.tenant_id ??
        decoded.storeId ??
        decoded.store_id ??
        decoded.sub ??
        decoded.phone ??
        decoded.email ??
        "";
      const clean = sanitizeTenantId(candidate);
      if (clean) return clean;
    }
  } catch {}
  return sanitizeTenantId(token.slice(-16)) || "default";
}

function buildTenantStorageKey(baseKey: string, tenantId: string): string {
  const cleanTenant = sanitizeTenantId(tenantId) || getTenantIdFromToken();
  return `${baseKey}:${cleanTenant}`;
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

function buildPageNumbers(currentPage: number, totalPages: number): number[] {
  if (totalPages <= 1) return [1];
  const pages: number[] = [];
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  for (let i = start; i <= end; i++) {
    pages.push(i);
  }
  if (!pages.includes(1)) pages.unshift(1);
  if (!pages.includes(totalPages)) pages.push(totalPages);
  return pages;
}

export default function InventoryPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const productsRef = useRef<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scanDiagnostic, setScanDiagnostic] = useState("");
  const [savedBillImage, setSavedBillImage] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  const [salePage, setSalePage] = useState<number>(1);
  const [stockPage, setStockPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);

  const [activeTenantId, setActiveTenantId] = useState<string>(() =>
    getTenantIdFromToken()
  );
  const activeTenantIdRef = useRef<string>(activeTenantId);

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
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{
    name: string;
    sku: string;
    qty: string;
    costPrice: string;
    salePrice: string;
    amount: string;
  }>({
    name: "",
    sku: "",
    qty: "1",
    costPrice: "0",
    salePrice: "0",
    amount: "0",
  });

  const [purchaseEntries, setPurchaseEntries] = useState<PurchaseEntry[]>([]);
  const [salesEntries, setSalesEntries] = useState<SaleEntry[]>([]);
  const [dailySaleEntries, setDailySaleEntries] = useState<SaleEntry[]>([]);
  const [saleFilterDate, setSaleFilterDate] = useState<string>(() =>
    getTodayDateStr()
  );

  const [khataEntries, setKhataEntries] = useState<KhataEntry[]>([]);
  const [productCostMap, setProductCostMap] = useState<Record<string, number>>({});
  const productCostMapRef = useRef<Record<string, number>>({});
  const todayDateRef = useRef<string>(getTodayDateStr());
  const [activeLedgerTab, setActiveLedgerTab] = useState<
    "purchase" | "sales" | "khata"
  >("purchase");

  const [customerAccounts, setCustomerAccounts] = useState<CustomerKhataAccount[]>([]);
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
    tenantId: "",
  });

  const [todayDate, setTodayDate] = useState<string>(() => getTodayDateStr());

  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function isCheckoutOrSaleProductItem(
    p: Product,
    costMapArg: Record<string, number> = productCostMapRef.current
  ): boolean {
    const qtyNum = Number(p.stockQty ?? 0);
    const hasExplicitCost =
      (p.id && costMapArg[`id:${p.id}`] !== undefined) ||
      (p.sku && costMapArg[`sku:${String(p.sku).toLowerCase()}`] !== undefined);
    if (!hasExplicitCost && (qtyNum >= 9900 || String(p.id || "").startsWith("CHK-"))) {
      return true;
    }
    return false;
  }

  function persistBillImageDataUrl(dataUrl: string) {
    if (!dataUrl) return;
    setSavedBillImage(dataUrl);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem(
          buildTenantStorageKey(LAST_BILL_IMAGE_BASE_KEY, activeTenantIdRef.current),
          dataUrl
        );
      }
    } catch {}
  }

  function mergeAndSaveSalesList(
    tenantKey: string,
    incomingRows: SaleEntry[],
    existingRows: SaleEntry[]
  ): SaleEntry[] {
    const cleanTenant = sanitizeTenantId(tenantKey) || "default";
    const map = new Map<string, SaleEntry>();
    for (const r of [...incomingRows, ...existingRows]) {
      if (!r || !belongsToActiveTenant(r, cleanTenant)) continue;
      const key =
        r.id ||
        `${cleanTenant}|${r.date}|${r.time}|${r.billRef}|${r.itemName}|${r.qty}|${r.totalSale}`;
      if (!map.has(key)) {
        map.set(key, { ...r, tenantId: cleanTenant });
      }
    }
    const merged = Array.from(map.values()).sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return b.time.localeCompare(a.time);
    });
    safeJsonWrite(
      buildTenantStorageKey(SALES_LEDGER_BASE_KEY, cleanTenant),
      merged
    );
    return merged;
  }

  function extractCheckoutSalesFromLocalStorage(
    tenantKey: string,
    costMapArg: Record<string, number>,
    prodList: Product[]
  ): SaleEntry[] {
    if (typeof window === "undefined") return [];
    const cleanTenant = sanitizeTenantId(tenantKey) || "default";
    const tenantSuffix = `:${cleanTenant.toLowerCase()}`;
    const foundRows: SaleEntry[] = [];
    const seenKeys = new Set<string>();

    const pushSaleRow = (row: SaleEntry) => {
      if (!belongsToActiveTenant(row, cleanTenant)) return;
      const dedupe = `${cleanTenant}|${row.date}|${row.billRef}|${row.itemName}|${row.qty}|${row.totalSale}`;
      if (seenKeys.has(dedupe)) return;
      seenKeys.add(dedupe);
      foundRows.push({ ...row, tenantId: cleanTenant });
    };

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const lowerKey = k.toLowerCase();

        if (
          k.startsWith(PURCHASE_LEDGER_BASE_KEY) ||
          k.startsWith(KHATA_LEDGER_BASE_KEY) ||
          k.startsWith(CUSTOMER_KHATA_BOOK_BASE_KEY) ||
          k.startsWith(PRODUCT_COST_MAP_BASE_KEY) ||
          k.startsWith(LAST_BILL_IMAGE_BASE_KEY)
        ) {
          continue;
        }

        const isTenantScopedKey =
          lowerKey.endsWith(tenantSuffix) || lowerKey.includes(`${tenantSuffix}:`);
        const isCheckoutOrSaleKey =
          k.startsWith(SALES_LEDGER_BASE_KEY) ||
          lowerKey.includes("checkout") ||
          lowerKey.includes("order") ||
          lowerKey.includes("receipt") ||
          lowerKey.includes("sale");

        if (!isCheckoutOrSaleKey) continue;

        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as unknown;

        if (
          !isTenantScopedKey &&
          parsed &&
          typeof parsed === "object" &&
          !belongsToActiveTenant(parsed, cleanTenant)
        ) {
          continue;
        }

        const arr = Array.isArray(parsed)
          ? parsed
          : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { orders?: unknown[] }).orders)
          ? (parsed as { orders: unknown[] }).orders
          : parsed &&
            typeof parsed === "object" &&
            Array.isArray((parsed as { items?: unknown[] }).items)
          ? (parsed as { items: unknown[] }).items
          : [];

        for (const item of arr) {
          if (!item || typeof item !== "object") continue;
          if (!belongsToActiveTenant(item, cleanTenant)) continue;

          const explicitItemTenant = extractRecordTenantId(item);
          if (!isTenantScopedKey && !explicitItemTenant) {
            continue;
          }

          const obj = item as Record<string, unknown>;
          if (
            "totalSale" in obj &&
            ("itemName" in obj || "productName" in obj)
          ) {
            const sPrice = parseNumericValue(obj.salePrice ?? obj.unitPrice, 0);
            const qNum = Math.max(
              1,
              parseInt(String(obj.qty ?? obj.quantity ?? "1"), 10) || 1
            );
            const tSale = parseNumericValue(obj.totalSale, sPrice * qNum);
            const uCost = parseNumericValue(
              obj.costPrice,
              lookupUnitCost(
                String(obj.productId || ""),
                String(obj.sku || ""),
                sPrice,
                costMapArg
              )
            );
            const tCost = parseNumericValue(obj.totalCost, uCost * qNum);
            const prof = parseNumericValue(obj.profit, tSale - tCost);
            const dtRaw = String(obj.date || "");
            const dateVal =
              /^\d{4}-\d{2}-\d{2}$/.test(dtRaw)
                ? dtRaw
                : getTodayDateStr(dtRaw ? new Date(dtRaw) : new Date());

            pushSaleRow({
              id: String(
                obj.id ||
                  `CHK-${cleanTenant}-${dateVal}-${Math.floor(
                    1000 + Math.random() * 9000
                  )}`
              ),
              date: dateVal,
              time: String(obj.time || formatTimeStr(new Date())),
              billRef: String(
                obj.billRef || obj.billNo || obj.orderId || "Checkout Scan"
              ),
              itemName: String(
                obj.itemName || obj.productName || obj.name || "Sold Item"
              ),
              qty: qNum,
              costPrice: uCost,
              salePrice: sPrice,
              totalSale: tSale,
              totalCost: tCost,
              profit: prof,
              tenantId: cleanTenant,
            });
          } else if (
            Array.isArray(obj.items) ||
            "subtotal" in obj ||
            "total" in obj
          ) {
            const ord = obj as BackendOrder;
            const dtSource =
              ord.createdAt || ord.created_at || ord.date || new Date().toISOString();
            const parsedDt = new Date(String(dtSource));
            const safeDt = Number.isNaN(parsedDt.getTime()) ? new Date() : parsedDt;
            const ordDate = /^\d{4}-\d{2}-\d{2}$/.test(String(ord.date || ""))
              ? String(ord.date)
              : getTodayDateStr(safeDt);
            const ordTime = formatTimeStr(safeDt);
            const billRef = String(
              ord.billNo ?? ord.orderNumber ?? ord.id ?? "Checkout Bill"
            );

            if (Array.isArray(ord.items) && ord.items.length > 0) {
              ord.items.forEach((it, idx) => {
                if (!belongsToActiveTenant(it, cleanTenant)) return;
                const qty = Math.max(
                  1,
                  parseInt(String(it.quantity ?? it.qty ?? "1"), 10) || 1
                );
                const uPrice = parseNumericValue(it.unitPrice ?? it.price, 0);
                const pName = String(it.productName ?? it.name ?? "Scanned Item");
                const matchedProd = prodList.find(
                  (p) =>
                    p.id === it.productId ||
                    (it.sku &&
                      p.sku &&
                      p.sku.toLowerCase() === String(it.sku).toLowerCase()) ||
                    p.name.toLowerCase() === pName.toLowerCase()
                );
                const uCost = lookupUnitCost(
                  it.productId || matchedProd?.id,
                  it.sku || matchedProd?.sku,
                  uPrice,
                  costMapArg
                );
                const lineSale = Math.round(uPrice * qty * 100) / 100;
                const lineCost = Math.round(uCost * qty * 100) / 100;
                pushSaleRow({
                  id: String(
                    it.id || `ORD-${cleanTenant}-${billRef}-${ordDate}-${idx}`
                  ),
                  date: ordDate,
                  time: ordTime,
                  billRef,
                  itemName: pName,
                  qty,
                  costPrice: uCost,
                  salePrice: uPrice,
                  totalSale: lineSale,
                  totalCost: lineCost,
                  profit: Math.round((lineSale - lineCost) * 100) / 100,
                  tenantId: cleanTenant,
                });
              });
            }
          }
        }
      }
    } catch {}

    return foundRows;
  }

  async function syncCheckoutSalesNow(
    costMapArg: Record<string, number> = productCostMapRef.current,
    prodList: Product[] = productsRef.current
  ) {
    const tenantKey = sanitizeTenantId(activeTenantIdRef.current) || "default";
    const localCheckoutRows = extractCheckoutSalesFromLocalStorage(
      tenantKey,
      costMapArg,
      prodList
    );

    const apiRows: SaleEntry[] = [];
    for (const baseEndpoint of ["/orders", "/sales", "/checkout/orders"]) {
      try {
        const sep = baseEndpoint.includes("?") ? "&" : "?";
        const scopedEndpoint = `${baseEndpoint}${sep}tenantId=${encodeURIComponent(
          tenantKey
        )}&storeId=${encodeURIComponent(tenantKey)}`;
        const res = await apiFetch<
          { data?: BackendOrder[] } | BackendOrder[] | Record<string, unknown>
        >(scopedEndpoint);
        const orderList: BackendOrder[] = Array.isArray(res)
          ? (res as BackendOrder[])
          : Array.isArray((res as { data?: unknown[] })?.data)
          ? ((res as { data: BackendOrder[] }).data)
          : [];

        const tenantFilteredOrders = orderList.filter((ord) =>
          belongsToActiveTenant(ord, tenantKey)
        );

        for (const ord of tenantFilteredOrders) {
          if (!ord || typeof ord !== "object") continue;
          const dtSource =
            ord.createdAt || ord.created_at || ord.date || new Date().toISOString();
          const parsedDt = new Date(String(dtSource));
          const safeDt = Number.isNaN(parsedDt.getTime()) ? new Date() : parsedDt;
          const ordDate = /^\d{4}-\d{2}-\d{2}$/.test(String(ord.date || ""))
            ? String(ord.date)
            : getTodayDateStr(safeDt);
          const ordTime = formatTimeStr(safeDt);
          const billRef = String(
            ord.billNo ?? ord.orderNumber ?? ord.id ?? "POS Bill"
          );

          if (Array.isArray(ord.items) && ord.items.length > 0) {
            ord.items.forEach((it, idx) => {
              if (!belongsToActiveTenant(it, tenantKey)) return;
              const qty = Math.max(
                1,
                parseInt(String(it.quantity ?? it.qty ?? "1"), 10) || 1
              );
              const uPrice = parseNumericValue(it.unitPrice ?? it.price, 0);
              const pName = String(it.productName ?? it.name ?? "Sold Item");
              const matchedProd = prodList.find(
                (p) =>
                  p.id === it.productId ||
                  (it.sku &&
                    p.sku &&
                    p.sku.toLowerCase() === String(it.sku).toLowerCase()) ||
                  p.name.toLowerCase() === pName.toLowerCase()
              );
              const uCost = lookupUnitCost(
                it.productId || matchedProd?.id,
                it.sku || matchedProd?.sku,
                uPrice,
                costMapArg
              );
              const lineSale = Math.round(uPrice * qty * 100) / 100;
              const lineCost = Math.round(uCost * qty * 100) / 100;
              apiRows.push({
                id: String(
                  it.id || `API-ORD-${tenantKey}-${billRef}-${ordDate}-${idx}`
                ),
                date: ordDate,
                time: ordTime,
                billRef,
                itemName: pName,
                qty,
                costPrice: uCost,
                salePrice: uPrice,
                totalSale: lineSale,
                totalCost: lineCost,
                profit: Math.round((lineSale - lineCost) * 100) / 100,
                tenantId: tenantKey,
              });
            });
          } else {
            const totalAmount = parseNumericValue(ord.total ?? ord.subtotal, 0);
            if (totalAmount > 0) {
              apiRows.push({
                id: `API-ORD-${tenantKey}-${billRef}-${ordDate}`,
                date: ordDate,
                time: ordTime,
                billRef,
                itemName: `Checkout Bill #${billRef}`,
                qty: 1,
                costPrice: totalAmount,
                salePrice: totalAmount,
                totalSale: totalAmount,
                totalCost: totalAmount,
                profit: 0,
                tenantId: tenantKey,
              });
            }
          }
        }
        if (orderList.length > 0) break;
      } catch {}
    }

    const combinedIncoming = [...apiRows, ...localCheckoutRows].filter((r) =>
      belongsToActiveTenant(r, tenantKey)
    );
    if (combinedIncoming.length === 0) return;

    setDailySaleEntries((prev) => {
      const cleanPrev = prev.filter((r) => belongsToActiveTenant(r, tenantKey));
      const merged = mergeAndSaveSalesList(tenantKey, combinedIncoming, cleanPrev);
      setSalesEntries(merged);
      return merged;
    });
  }

  function loadTenantLocalData(tenantKey: string): Record<string, number> {
    const cleanKey = sanitizeTenantId(tenantKey) || "default";
    const tenantChanged = activeTenantIdRef.current !== cleanKey;
    activeTenantIdRef.current = cleanKey;
    setActiveTenantId(cleanKey);

    if (tenantChanged) {
      setProducts([]);
      productsRef.current = [];
      setPurchaseEntries([]);
      setSalesEntries([]);
      setDailySaleEntries([]);
      setKhataEntries([]);
      setCustomerAccounts([]);
      setSavedBillImage("");
    }

    const savedPurchases = safeJsonRead<PurchaseEntry[]>(
      buildTenantStorageKey(PURCHASE_LEDGER_BASE_KEY, cleanKey),
      []
    ).filter((p) => belongsToActiveTenant(p, cleanKey));

    const savedSales = safeJsonRead<SaleEntry[]>(
      buildTenantStorageKey(SALES_LEDGER_BASE_KEY, cleanKey),
      []
    ).filter((s) => belongsToActiveTenant(s, cleanKey));

    const savedKhata = safeJsonRead<KhataEntry[]>(
      buildTenantStorageKey(KHATA_LEDGER_BASE_KEY, cleanKey),
      []
    ).filter((k) => belongsToActiveTenant(k, cleanKey));

    const savedCustomers = safeJsonRead<CustomerKhataAccount[]>(
      buildTenantStorageKey(CUSTOMER_KHATA_BOOK_BASE_KEY, cleanKey),
      []
    ).filter(
      (c) => c.id !== "CUST-SAMPLE-1" && belongsToActiveTenant(c, cleanKey)
    );

    const savedCostMap = safeJsonRead<Record<string, number>>(
      buildTenantStorageKey(PRODUCT_COST_MAP_BASE_KEY, cleanKey),
      {}
    );

    try {
      if (typeof window !== "undefined") {
        const cachedBillImg =
          localStorage.getItem(
            buildTenantStorageKey(LAST_BILL_IMAGE_BASE_KEY, cleanKey)
          ) || "";
        setSavedBillImage(cachedBillImg);
      }
    } catch {}

    const extraLocalCheckout = extractCheckoutSalesFromLocalStorage(
      cleanKey,
      savedCostMap,
      productsRef.current
    );
    const initialSales = mergeAndSaveSalesList(
      cleanKey,
      extraLocalCheckout,
      savedSales
    );

    setPurchaseEntries(savedPurchases);
    setSalesEntries(initialSales);
    setDailySaleEntries(initialSales);
    setKhataEntries(savedKhata);
    setCustomerAccounts(savedCustomers);
    safeJsonWrite(
      buildTenantStorageKey(CUSTOMER_KHATA_BOOK_BASE_KEY, cleanKey),
      savedCustomers
    );
    setProductCostMap(savedCostMap);
    productCostMapRef.current = savedCostMap;
    return savedCostMap;
  }

  async function loadTenantAndStoreProfile() {
    const tokenTenant = getTenantIdFromToken();
    const initialMap = loadTenantLocalData(tokenTenant);
    void loadProducts(initialMap, tokenTenant);
    void syncCheckoutSalesNow(initialMap, productsRef.current);

    const endpoints = ["/auth/me", "/stores/current", "/store/profile"];
    for (const ep of endpoints) {
      try {
        const res = await apiFetch<Record<string, unknown>>(ep);
        const rootObj =
          res &&
          typeof res === "object" &&
          "data" in res &&
          res.data &&
          typeof res.data === "object"
            ? (res.data as Record<string, unknown>)
            : res;
        if (!rootObj || typeof rootObj !== "object") continue;

        const storeObj =
          rootObj.store && typeof rootObj.store === "object"
            ? (rootObj.store as Record<string, unknown>)
            : rootObj.tenant && typeof rootObj.tenant === "object"
            ? (rootObj.tenant as Record<string, unknown>)
            : rootObj;

        const resolvedTenant =
          sanitizeTenantId(
            storeObj.tenantId ??
              storeObj.tenant_id ??
              storeObj.id ??
              rootObj.tenantId ??
              rootObj.tenant_id ??
              ""
          ) || tokenTenant;

        const resolvedName = String(
          storeObj.name ??
            storeObj.storeName ??
            storeObj.businessName ??
            rootObj.name ??
            ""
        ).trim();

        const addressParts = [
          storeObj.address ?? storeObj.location ?? "",
          storeObj.city ?? "",
        ]
          .map((v) => String(v || "").trim())
          .filter(Boolean);

        const resolvedDetails = String(
          storeObj.details ??
            storeObj.description ??
            (addressParts.length > 0 ? addressParts.join(", ") : "")
        ).trim();

        const resolvedPhone = String(
          storeObj.phone ??
            storeObj.mobile ??
            storeObj.contactPhone ??
            rootObj.phone ??
            ""
        ).trim();

        if (resolvedTenant && resolvedTenant !== activeTenantIdRef.current) {
          const switchedMap = loadTenantLocalData(resolvedTenant);
          void loadProducts(switchedMap, resolvedTenant);
          void syncCheckoutSalesNow(switchedMap, productsRef.current);
        }

        if (resolvedName || resolvedDetails || resolvedPhone || resolvedTenant) {
          setStoreInfo({
            name: resolvedName,
            details: resolvedDetails,
            phone: resolvedPhone,
            tenantId: resolvedTenant,
          });
          return;
        }
      } catch {}
    }

    setStoreInfo((prev) => ({
      ...prev,
      tenantId: tokenTenant,
    }));
  }

  useEffect(() => {
    if (!getToken()) {
      window.location.href = "/login";
      return;
    }
    void loadTenantAndStoreProfile();
  }, []);

  useEffect(() => {
    const syncDateRollover = () => {
      const nextToday = getTodayDateStr();
      setTodayDate((prev) => {
        if (prev !== nextToday) {
          setSaleFilterDate(nextToday);
        }
        return nextToday;
      });
    };
    const timer = window.setInterval(syncDateRollover, MIDNIGHT_ROLLOVER_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const pollSales = () => {
      void syncCheckoutSalesNow(productCostMapRef.current, productsRef.current);
    };
    const timer = window.setInterval(pollSales, SALES_SYNC_POLL_MS);
    const onFocus = () => pollSales();
    const onStorage = () => pollSales();
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
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
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    todayDateRef.current = todayDate;
  }, [todayDate]);

  useEffect(() => {
    setSalePage(1);
  }, [saleFilterDate, dailySaleEntries.length, pageSize]);

  useEffect(() => {
    setStockPage(1);
  }, [searchQuery, products.length, pageSize]);

  async function loadProducts(
    costMapArg: Record<string, number> = productCostMap,
    tenantKeyArg: string = activeTenantIdRef.current
  ) {
    const cleanTenant = sanitizeTenantId(tenantKeyArg) || "default";
    setLoading(true);
    try {
      const endpoint = `/products?tenantId=${encodeURIComponent(
        cleanTenant
      )}&storeId=${encodeURIComponent(cleanTenant)}`;
      const res = await apiFetch<Product[] | { data?: Product[] }>(endpoint);
      const rawList = Array.isArray(res)
        ? res
        : Array.isArray(res?.data)
        ? res.data
        : [];

      const tenantProducts = rawList.filter((p) =>
        belongsToActiveTenant(p, cleanTenant)
      );

      if (activeTenantIdRef.current !== cleanTenant) return;

      setProducts(tenantProducts);
      productsRef.current = tenantProducts;
      if (costMapArg && Object.keys(costMapArg).length > 0) {
        setProductCostMap(costMapArg);
      }
      void syncCheckoutSalesNow(costMapArg, tenantProducts);
    } catch (err) {
      console.error("Load products error:", err);
    } finally {
      if (activeTenantIdRef.current === cleanTenant) {
        setLoading(false);
      }
    }
  }

  function handleBarcodeLookup(rawSku: string) {
    setSku(rawSku);
    const match = products.find(
      (p) => p.sku && p.sku.toLowerCase() === rawSku.trim().toLowerCase()
    );
    if (match) {
      if (!name.trim()) setName(match.name);
      if (!salePrice.trim() && match.price) setSalePrice(String(match.price));
    }
  }

  async function startCameraScanner() {
    try {
      setError("");
      setScanDiagnostic("");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      window.setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 60);
    } catch {
      setError("❌ کیمرہ شروع نہیں ہو سکا، براہِ کرم کیمرہ پرمیشن چیک کریں۔");
    }
  }

  function stopCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }

  function startEditScannedItem(index: number) {
    const target = scannedBillItems[index];
    if (!target) return;
    setEditingIndex(index);
    setEditDraft({
      name: target.name,
      sku: target.sku,
      qty: String(target.qty),
      costPrice: target.costPrice,
      salePrice: target.salePrice,
      amount: String(target.amount),
    });
  }

  function applyScannedItemEdit() {
    if (editingIndex === null) return;
    const cleanName = editDraft.name.trim();
    if (!cleanName) {
      alert("آئٹم کا نام خالی نہیں ہو سکتا۔");
      return;
    }
    const qNum = Math.max(1, parseInt(editDraft.qty, 10) || 1);
    const rateNum = parseNumericValue(editDraft.costPrice, 0);
    const rawAmtNum = parseNumericValue(editDraft.amount, 0);

    const finalRate =
      rateNum > 0
        ? rateNum
        : rawAmtNum > 0 && qNum > 0
        ? Math.round((rawAmtNum / qNum) * 100) / 100
        : 0;
    const finalAmt =
      finalRate > 0
        ? Math.round(finalRate * qNum * 100) / 100
        : Math.round(rawAmtNum * 100) / 100;

    const saleNum =
      editDraft.salePrice.trim() !== ""
        ? parseNumericValue(editDraft.salePrice, finalRate)
        : finalRate;

    const updatedList = scannedBillItems.map((row, idx) =>
      idx === editingIndex
        ? {
            name: cleanName,
            sku:
              editDraft.sku.trim() ||
              row.sku ||
              `POS-${Math.floor(100000 + Math.random() * 900000)}`,
            qty: qNum,
            costPrice: String(finalRate),
            salePrice: String(saleNum),
            amount: finalAmt,
          }
        : row
    );

    setScannedBillItems(updatedList);
    setScannedBillTotal(updatedList.reduce((acc, item) => acc + item.amount, 0));
    setEditingIndex(null);
    setError(`✔ آئٹم "${cleanName}" بائی ہینڈ اپ ڈیٹ ہو گئی ہے۔`);
  }

  function saveCostMapping(
    productId: string | undefined,
    productSku: string | undefined,
    unitCost: number
  ) {
    if (!Number.isFinite(unitCost) || unitCost < 0) return;
    const storageKey = buildTenantStorageKey(
      PRODUCT_COST_MAP_BASE_KEY,
      activeTenantIdRef.current
    );
    setProductCostMap((prev) => {
      const next = { ...prev };
      if (productId) next[`id:${productId}`] = unitCost;
      if (productSku) next[`sku:${productSku.toLowerCase()}`] = unitCost;
      safeJsonWrite(storageKey, next);
      return next;
    });
  }

  function lookupUnitCost(
    productId: string | undefined,
    productSku: string | undefined,
    fallbackSalePrice: number,
    costMapArg: Record<string, number> = productCostMapRef.current
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
    const cleanTenant = sanitizeTenantId(activeTenantIdRef.current) || "default";
    const newRow: PurchaseEntry = {
      ...entry,
      tenantId: cleanTenant,
      id: `PUR-${cleanTenant}-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
    };
    const storageKey = buildTenantStorageKey(
      PURCHASE_LEDGER_BASE_KEY,
      cleanTenant
    );
    setPurchaseEntries((prev) => {
      const next = [newRow, ...prev];
      safeJsonWrite(storageKey, next);
      return next;
    });
  }

  function recordDailySaleItem(params: {
    itemName: string;
    sku?: string;
    qty: number;
    salePrice: number;
    costPrice?: number;
    billRef?: string;
    dateStr?: string;
  }) {
    const cleanName = params.itemName.trim();
    if (!cleanName) return;
    const now = new Date();
    const activeDate = params.dateStr || getTodayDateStr(now);
    const qNum = Math.max(1, Number(params.qty) || 1);
    const sPrice = Math.max(0, Number(params.salePrice) || 0);
    const matchedProd = products.find(
      (p) =>
        p.name.trim().toLowerCase() === cleanName.toLowerCase() ||
        (params.sku &&
          p.sku &&
          p.sku.trim().toLowerCase() === params.sku.trim().toLowerCase())
    );
    const uCost =
      params.costPrice !== undefined
        ? Math.max(0, Number(params.costPrice) || 0)
        : lookupUnitCost(matchedProd?.id, matchedProd?.sku, sPrice);

    const totalSale = Math.round(sPrice * qNum * 100) / 100;
    const totalCost = Math.round(uCost * qNum * 100) / 100;
    const profit = Math.round((totalSale - totalCost) * 100) / 100;
    const tenantKey = sanitizeTenantId(activeTenantIdRef.current) || "default";

    const newSaleRow: SaleEntry = {
      id: `SALE-${tenantKey}-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
      date: activeDate,
      time: formatTimeStr(now),
      billRef: params.billRef?.trim() || "QR / Checkout Bill",
      itemName: cleanName,
      qty: qNum,
      costPrice: uCost,
      salePrice: sPrice,
      totalSale,
      totalCost,
      profit,
      tenantId: tenantKey,
    };

    setDailySaleEntries((prev) => {
      const cleanPrev = prev.filter((r) => belongsToActiveTenant(r, tenantKey));
      const merged = mergeAndSaveSalesList(tenantKey, [newSaleRow], cleanPrev);
      setSalesEntries(merged);
      return merged;
    });
  }

  function moveStockItemToDailySale(prod: Product) {
    const qtyVal = Math.max(1, Number(prod.stockQty || 1));
    const priceVal = parseNumericValue(prod.price, 0);
    recordDailySaleItem({
      itemName: prod.name,
      sku: prod.sku,
      qty: qtyVal,
      salePrice: priceVal,
      billRef: "Moved from Stock (QR/Checkout)",
    });
    setProducts((prev) => {
      const next = prev.filter((item) => item.id !== prod.id);
      productsRef.current = next;
      return next;
    });
    setError(
      `✔ "${prod.name}" کو STOCK سے نکال کر DAILY SALE خانے میں منتقل کر دیا گیا ہے۔`
    );
  }

  function saveCustomerAccounts(nextList: CustomerKhataAccount[]) {
    const cleanTenant = sanitizeTenantId(activeTenantIdRef.current) || "default";
    const storageKey = buildTenantStorageKey(
      CUSTOMER_KHATA_BOOK_BASE_KEY,
      cleanTenant
    );
    setCustomerAccounts(nextList);
    safeJsonWrite(storageKey, nextList);
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
    window.open(
      `https://wa.me/${waPhone}?text=${encodeURIComponent(msg)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  function handleCreateCustomerKhata(e: FormEvent) {
    e.preventDefault();
    const cleanName = newCustName.trim();
    if (!cleanName) {
      alert("براہِ کرم کسٹمر کا نام درج کریں۔");
      return;
    }
    const openingAmt = Math.max(0, parseNumericValue(newCustOpeningUdhaar, 0));
    const txDateVal = newCustDate || getTodayDateStr();
    const now = new Date();
    const newId = `CUST-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    const initialTxs: CustomerKhataTx[] =
      openingAmt > 0
        ? [
            {
              id: `TX-${Date.now()}`,
              date: txDateVal,
              time: formatTimeStr(now),
              type: "udhaar",
              amount: openingAmt,
              note: "ابتدائی ادھار (Opening Balance)",
              balanceAfter: openingAmt,
            },
          ]
        : [];

    const account: CustomerKhataAccount = {
      id: newId,
      name: cleanName,
      phone: newCustPhone.trim(),
      address: newCustAddress.trim(),
      balance: openingAmt,
      lastDate: txDateVal,
      transactions: initialTxs,
    };

    const next = [account, ...customerAccounts];
    saveCustomerAccounts(next);
    setSelectedCustomerId(newId);
    setTxCustomerId(newId);
    setNewCustName("");
    setNewCustPhone("");
    setNewCustAddress("");
    setNewCustOpeningUdhaar("");
    setKhataModalMode("none");
    setError(`✔ کسٹمر "${cleanName}" کا کھاتہ محفوظ ہو گیا ہے۔`);
  }

  function handleSaveAndSendWhatsApp() {
    const cleanName = newCustName.trim();
    if (!cleanName) {
      alert("پہلے کسٹمر کا نام درج کریں۔");
      return;
    }
    const openingAmt = Math.max(0, parseNumericValue(newCustOpeningUdhaar, 0));
    const txDateVal = newCustDate || getTodayDateStr();
    const now = new Date();
    const newId = `CUST-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    const account: CustomerKhataAccount = {
      id: newId,
      name: cleanName,
      phone: newCustPhone.trim(),
      address: newCustAddress.trim(),
      balance: openingAmt,
      lastDate: txDateVal,
      transactions:
        openingAmt > 0
          ? [
              {
                id: `TX-${Date.now()}`,
                date: txDateVal,
                time: formatTimeStr(now),
                type: "udhaar",
                amount: openingAmt,
                note: "ابتدائی ادھار",
                balanceAfter: openingAmt,
              },
            ]
          : [],
    };

    saveCustomerAccounts([account, ...customerAccounts]);
    setSelectedCustomerId(newId);
    setNewCustName("");
    setNewCustPhone("");
    setNewCustAddress("");
    setNewCustOpeningUdhaar("");
    setKhataModalMode("none");
    openWhatsAppReminder(account);
  }

  function handleRecordCustomerTx(e: FormEvent) {
    e.preventDefault();
    const targetId = txCustomerId || selectedCustomerId;
    const amt = Math.max(0, parseNumericValue(txAmount, 0));
    if (!targetId || amt <= 0) {
      alert("براہِ کرم کسٹمر اور درست رقم درج کریں۔");
      return;
    }
    const isReceived = khataModalMode === "received";
    const txDateVal = txDate || getTodayDateStr();
    const now = new Date();

    const updated = customerAccounts.map((c) => {
      if (c.id !== targetId) return c;
      const nextBal = isReceived
        ? Math.max(0, Math.round((c.balance - amt) * 100) / 100)
        : Math.round((c.balance + amt) * 100) / 100;

      const tx: CustomerKhataTx = {
        id: `TX-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`,
        date: txDateVal,
        time: formatTimeStr(now),
        type: isReceived ? "received" : "udhaar",
        amount: amt,
        note:
          txNote.trim() ||
          (isReceived ? "رقم وصول ہوئی" : "نیا ادھار / بل"),
        balanceAfter: nextBal,
      };

      return {
        ...c,
        balance: nextBal,
        lastDate: txDateVal,
        transactions: [tx, ...c.transactions],
      };
    });

    saveCustomerAccounts(updated);
    setTxAmount("");
    setTxNote("");
    setKhataModalMode("none");
    setError(
      isReceived
        ? "✔ وصول شدہ رقم کسٹمر کھاتے میں درج ہو گئی ہے۔"
        : "✔ نیا ادھار کسٹمر کھاتے میں درج ہو گئی ہے۔"
    );
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

    try {
      const capturedDataUrl = canvas.toDataURL("image/jpeg", 0.78);
      persistBillImageDataUrl(capturedDataUrl);
    } catch {}

    setScanningPhoto(true);
    setScanDiagnostic("");
    setScannedBillTotal(null);
    setEditingIndex(null);
    setError(
      "📷 بل/اسٹاک کی تصویر محفوظ ہو رہی ہے اور آئٹمز نکالے جا رہے ہیں..."
    );

    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          setScanningPhoto(false);
          stopCamera();
          setError("❌ تصویر کیپچر نہیں ہو سکی، دوبارہ کوشش کریں۔");
          return;
        }

        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 20000);

        try {
          const formData = new FormData();
          formData.append("image", blob, "wholesale-bill.jpg");
          formData.append("scan_type", "wholesale_purchase_bill");
          formData.append("tenant_id", activeTenantIdRef.current);
          formData.append("tenantId", activeTenantIdRef.current);
          formData.append("token", getToken() ?? "");

          const res = await fetch(N8N_PRODUCT_SCAN_WEBHOOK_URL, {
            method: "POST",
            body: formData,
            signal: controller.signal,
          });

          const rawText = await res.text();

          if (res.status === 502 || res.status === 503 || res.status === 504) {
            setScanDiagnostic(
              `HTTP ${res.status}: ${rawText.slice(0, 180) || "Upstream / Gateway error"}`
            );
            throw new Error("HTTP_502");
          }

          if (!res.ok) {
            setScanDiagnostic(
              `HTTP ${res.status}: ${rawText.slice(0, 180) || "Request failed"}`
            );
            throw new Error(`HTTP ${res.status}`);
          }

          let payload: Record<string, unknown> = {};
          try {
            const parsed = JSON.parse(rawText);
            payload = Array.isArray(parsed)
              ? (parsed[0] as Record<string, unknown>) || {}
              : (parsed as Record<string, unknown>) || {};
          } catch {
            setScanDiagnostic(`Invalid JSON (HTTP 200): ${rawText.slice(0, 180)}`);
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
                const rawAmountNum = parseNumericValue(rawAmount, 0);

                if (costNum <= 0 && rawAmountNum > 0 && qtyNum > 0) {
                  costNum = Math.round((rawAmountNum / qtyNum) * 100) / 100;
                }

                const lineAmountNum =
                  costNum > 0
                    ? Math.round(costNum * qtyNum * 100) / 100
                    : Math.round(rawAmountNum * 100) / 100;

                const rawSale = it?.sale_price ?? it?.retail_price;
                const saleNum =
                  rawSale !== undefined && String(rawSale).trim() !== ""
                    ? parseNumericValue(rawSale, costNum)
                    : costNum;

                return {
                  name: String(
                    it?.item ??
                      it?.item_name ??
                      it?.product_name ??
                      it?.name ??
                      ""
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
                computedSum > 0
                  ? computedSum
                  : parsedBillTotal && parsedBillTotal > 0
                  ? parsedBillTotal
                  : 0
              );

              const first = parsed[0];
              if (first) {
                setName(first.name);
                setSku(first.sku);
                setCostPrice(first.costPrice);
                setSalePrice(first.salePrice);
                setStockQty(String(first.qty));
              }
              stopCamera();
              setScanDiagnostic(`HTTP 200: ${parsed.length} items extracted`);
              setError(
                `✔ بل کی تصویر محفوظ اور ${
                  traderName ? `${traderName} — ` : ""
                }${parsed.length} آئٹمز ڈبوں میں آ گئی ہیں۔`
              );
              return;
            }
          }

          const extractedName = String(
            dataObj?.item ??
              dataObj?.item_name ??
              dataObj?.product_name ??
              dataObj?.name ??
              ""
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
          const rawSingleAmtNum = parseNumericValue(rawSingleAmount, 0);
          if (singleCost <= 0 && rawSingleAmtNum > 0 && singleQty > 0) {
            singleCost = Math.round((rawSingleAmtNum / singleQty) * 100) / 100;
          }
          const singleAmount =
            singleCost > 0
              ? Math.round(singleCost * singleQty * 100) / 100
              : Math.round(rawSingleAmtNum * 100) / 100;

          const extractedSale =
            dataObj?.sale_price ?? payload?.sale_price ?? singleCost;

          if (extractedName) setName(extractedName);
          if (extractedSku) {
            setSku(extractedSku);
          } else if (extractedName && !sku.trim()) {
            const genSku = `POS-${Math.floor(100000 + Math.random() * 900000)}`;
            setSku(genSku);
          }
          if (singleCost > 0) setCostPrice(String(singleCost));
          setSalePrice(String(parseNumericValue(extractedSale, singleCost)));
          setStockQty(String(singleQty));
          if (singleAmount > 0) {
            setScannedBillTotal(singleAmount);
          }

          stopCamera();
          if (extractedName || extractedSku) {
            setScannedBillItems([
              {
                name: extractedName || "آئٹم",
                sku:
                  extractedSku ||
                  `POS-${Math.floor(100000 + Math.random() * 900000)}`,
                costPrice: String(singleCost),
                salePrice: String(parseNumericValue(extractedSale, singleCost)),
                qty: singleQty,
                amount: singleAmount,
              },
            ]);
            setScanDiagnostic("HTTP 200: 1 item extracted");
            setError(
              `✔ تصویر محفوظ اور آئٹم ڈبے میں آ گئی: ${
                traderName ? `${traderName} — ` : ""
              }${extractedName || "آئٹم"} | کوڈ: ${extractedSku || "-"}`
            );
          } else {
            setScanDiagnostic(
              `HTTP 200 (Empty items): ${rawText.slice(0, 180)}`
            );
            setError(
              "بل کی تصویر محفوظ ہے، لیکن آئٹم واضح نہیں پڑھی جا سکی — آپ آئٹم کا نام لکھ کر سیو کر سکتے ہیں۔"
            );
            document.getElementById("manual-item-input")?.focus();
          }
        } catch (err) {
          console.error("Wholesale scan error:", err);
          stopCamera();
          const is502OrTimeout =
            err instanceof Error &&
            (err.message === "HTTP_502" || err.name === "AbortError");
          if (!scanDiagnostic) {
            setScanDiagnostic(
              `Fetch Error: ${
                err instanceof Error ? err.message : "Network / Timeout Error"
              }`
            );
          }
          if (is502OrTimeout) {
            setError(
              "اسکین سرور عارضی طور پر مصروف ہے — بل کی تصویر محفوظ ہے، آئٹم کا نام اور ریٹ لکھ کر Save to STOCK دبا دیں۔"
            );
            document.getElementById("manual-item-input")?.focus();
          } else {
            setError(
              `❌ اسکین رسپانس میں خرابی (${
                err instanceof Error ? err.message : "نامعلوم"
              }) — بل کی تصویر محفوظ ہے، آپ تفصیل براہِ راست لکھ کر سیو کر سکتے ہیں۔`
            );
          }
        } finally {
          window.clearTimeout(timeoutId);
          setScanningPhoto(false);
        }
      },
      "image/jpeg",
      0.78
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
  }): Promise<{ saved: boolean; backendError?: string }> {
    const cleanTenant = sanitizeTenantId(activeTenantIdRef.current) || "default";
    const cleanName = params.itemName.trim();
    const cleanSku =
      params.itemSku.trim() || `SKU-${Math.floor(1000 + Math.random() * 9000)}`;
    const parsedCost = parseNumericValue(params.itemCostPrice.trim(), 0);
    const parsedSale =
      params.itemSalePrice.trim() !== ""
        ? parseNumericValue(params.itemSalePrice.trim(), parsedCost)
        : parsedCost;
    const cleanQty = params.itemQty > 0 ? params.itemQty : 1;

    const effectiveUnitCost =
      parsedCost > 0
        ? parsedCost
        : params.itemAmount !== undefined && params.itemAmount > 0 && cleanQty > 0
        ? Math.round((params.itemAmount / cleanQty) * 100) / 100
        : 0;

    const lineTotal =
      effectiveUnitCost > 0
        ? Math.round(effectiveUnitCost * cleanQty * 100) / 100
        : params.itemAmount !== undefined && params.itemAmount > 0
        ? Math.round(params.itemAmount * 100) / 100
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
      tenantId: cleanTenant,
    });

    setProducts((prev) => {
      const idx = prev.findIndex(
        (p) => p.sku && p.sku.toLowerCase() === cleanSku.toLowerCase()
      );
      let nextList: Product[];
      if (idx >= 0 && prev[idx]) {
        const current = prev[idx];
        nextList = prev.map((item, i) =>
          i === idx
            ? {
                ...current,
                name: cleanName || current.name,
                price: String(parsedSale),
                stockQty: nextStockQty,
              }
            : item
        );
      } else {
        nextList = [
          {
            id: `LOCAL-${cleanTenant}-${Date.now()}-${Math.floor(
              100 + Math.random() * 900
            )}`,
            name: cleanName,
            sku: cleanSku,
            price: String(parsedSale),
            stockQty: nextStockQty,
            tenantId: cleanTenant,
          } as unknown as Product,
          ...prev,
        ];
      }
      productsRef.current = nextList;
      return nextList;
    });

    setTodayDate(activeDate);

    try {
      const response = await Promise.race([
        apiFetch<Product | { data: Product }>("/products", {
          method: "POST",
          body: JSON.stringify({
            name: cleanName,
            sku: cleanSku,
            price: String(parsedSale),
            stockQty: nextStockQty,
            tenantId: cleanTenant,
            storeId: cleanTenant,
          }),
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("API timeout (5s)")), 5000)
        ),
      ]);

      const createdProduct =
        response && typeof response === "object" && "data" in response
          ? (response as { data: Product }).data
          : (response as Product);

      if (
        createdProduct &&
        createdProduct.id &&
        belongsToActiveTenant(createdProduct, cleanTenant)
      ) {
        saveCostMapping(createdProduct.id, createdProduct.sku, effectiveUnitCost);
        setProducts((prev) => {
          const withoutLocal = prev.filter(
            (p) =>
              !String(p.id).startsWith("LOCAL-") ||
              (p.sku || "").toLowerCase() !== cleanSku.toLowerCase()
          );
          const exists = withoutLocal.findIndex((p) => p.id === createdProduct.id);
          const updatedList =
            exists >= 0
              ? withoutLocal.map((p) =>
                  p.id === createdProduct.id ? createdProduct : p
                )
              : [createdProduct, ...withoutLocal];
          productsRef.current = updatedList;
          return updatedList;
        });
      }

      return { saved: true };
    } catch (err) {
      return {
        saved: true,
        backendError: err instanceof Error ? err.message : "Server sync failed",
      };
    }
  }

  async function handleAddAllScannedBillItems() {
    if (scannedBillItems.length === 0 || savingStock) return;
    setSavingStock(true);
    setError(
      "⏳ بل کی تمام آئٹمز STOCK اور Purchase Ledger میں محفوظ کی جا رہی ہیں..."
    );
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
      setEditingIndex(null);
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
      alert("براہ کرم آئٹم اور قیمت درج کریں!");
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
      setError("❌ آئٹم سیو کرنے میں خرابی ہوئی۔");
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
            billLabel: "CSV Import",
          });
          if (saved.saved) {
            importedCount++;
          }
        } catch {}
      }

      alert(`کامیابی کے ساتھ ${importedCount} آئٹمز امپورٹ ہو گئی ہیں!`);
      void loadProducts(productCostMapRef.current, activeTenantIdRef.current);
    };
    reader.readAsText(file);
  };

  function exportToCSV() {
    if (products.length === 0) {
      alert("No items available to export.");
      return;
    }
    const headers = [
      "Barcode / SKU",
      "Item",
      "Cost Price (Rs)",
      "Sale Price (Rs)",
      "Stock Qty",
      "Total Cost (Rs)",
      "Status",
    ];
    const rows = filteredProducts.map((p) => {
      const uCost = lookupUnitCost(
        p.id,
        p.sku,
        parseFloat(p.price || "0") || 0
      );
      const lineTotal = Math.round(uCost * Number(p.stockQty || 0) * 100) / 100;
      return [
        `"${p.sku || ""}"`,
        `"${p.name.replace(/"/g, '""')}"`,
        uCost,
        p.price,
        p.stockQty,
        lineTotal,
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
    const safeStoreName = (storeInfo.name || "store_inventory")
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

  const currentTenant = sanitizeTenantId(activeTenantId) || "default";

  const filteredProducts = products.filter((p) => {
    if (!belongsToActiveTenant(p, currentTenant)) return false;
    if (isCheckoutOrSaleProductItem(p)) return false;
    const matchesSearch =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.sku && p.sku.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSearch;
  });

  const totalStockPages = Math.max(
    1,
    Math.ceil(filteredProducts.length / pageSize)
  );
  const safeStockPage = Math.min(Math.max(1, stockPage), totalStockPages);
  const stockStartIdx = (safeStockPage - 1) * pageSize;
  const paginatedStockProducts = filteredProducts.slice(
    stockStartIdx,
    stockStartIdx + pageSize
  );
  const stockPageNumbers = buildPageNumbers(safeStockPage, totalStockPages);

  const totalStockValue = filteredProducts.reduce((sum, p) => {
    const uCost = lookupUnitCost(p.id, p.sku, parseFloat(p.price || "0") || 0);
    return sum + uCost * Number(p.stockQty || 0);
  }, 0);

  const tenantPurchases = purchaseEntries.filter((e) =>
    belongsToActiveTenant(e, currentTenant)
  );
  const tenantDailySales = dailySaleEntries.filter((e) =>
    belongsToActiveTenant(e, currentTenant)
  );

  const todayPurchases = tenantPurchases.filter((e) => e.date === todayDate);
  const todayPurchaseQty = todayPurchases.reduce((s, e) => s + e.qty, 0);

  const todaySales = tenantDailySales.filter((e) => e.date === todayDate);
  const todaySoldQty = todaySales.reduce((s, e) => s + e.qty, 0);
  const todaySalesTotal = todaySales.reduce((s, e) => s + e.totalSale, 0);
  const todayCostOfSold = todaySales.reduce((s, e) => s + e.totalCost, 0);
  const todayNetProfit = todaySales.reduce((s, e) => s + e.profit, 0);

  const filteredDailySales = tenantDailySales.filter((e) =>
    saleFilterDate ? e.date === saleFilterDate : true
  );
  const totalSalePages = Math.max(
    1,
    Math.ceil(filteredDailySales.length / pageSize)
  );
  const safeSalePage = Math.min(Math.max(1, salePage), totalSalePages);
  const saleStartIdx = (safeSalePage - 1) * pageSize;
  const paginatedDailySales = filteredDailySales.slice(
    saleStartIdx,
    saleStartIdx + pageSize
  );
  const salePageNumbers = buildPageNumbers(safeSalePage, totalSalePages);

  const filteredDailySaleTotal = filteredDailySales.reduce(
    (s, e) => s + e.totalSale,
    0
  );
  const filteredDailySaleQty = filteredDailySales.reduce(
    (s, e) => s + e.qty,
    0
  );

  const todayKhata = khataEntries.filter((e) => e.date === todayDate);
  const todayCashIn = todayKhata
    .filter((k) => k.entryType === "cash_in")
    .reduce((s, k) => s + k.amount, 0);
  const todayKhataOut = todayKhata
    .filter((k) => k.entryType === "khata" || k.entryType === "expense")
    .reduce((s, k) => s + k.amount, 0);
  const khataHisabBalance = todaySalesTotal + todayCashIn - todayKhataOut;

  const scannedItemsSum = scannedBillItems.reduce(
    (sum, item) => sum + item.amount,
    0
  );
  const displayScannedTotal =
    scannedItemsSum > 0
      ? scannedItemsSum
      : scannedBillTotal !== null && scannedBillTotal > 0
      ? scannedBillTotal
      : 0;

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
          <h1 className="text-2xl font-bold text-slate-900">
            {storeInfo.name || "Store Inventory"}
          </h1>
          {storeInfo.details && (
            <p className="text-sm font-medium text-slate-600">
              {storeInfo.details}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          {storeInfo.phone && (
            <span className="rounded bg-slate-100 px-3 py-1 font-medium text-slate-700">
              📞 {storeInfo.phone}
            </span>
          )}
          {(storeInfo.tenantId || currentTenant) && (
            <span className="rounded bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
              Tenant: {storeInfo.tenantId || currentTenant}
            </span>
          )}
          <span className="rounded bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            Active Date: {todayDate}
          </span>
        </div>
      </div>

      <PageHeader
        title="DAILY SALE & STOCK — Inventory Management"
        description="چیک آؤٹ سے آنے والی سیل DAILY SALE کے نیچے اور نئے اسٹاک کی تفصیل STOCK کے نیچے — ہر دکان کا ڈیٹا صرف اسی دکان تک محدود۔"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value) || DEFAULT_PAGE_SIZE)}
              className="rounded-md border border-slate-300 bg-white px-2.5 py-2 text-xs font-medium text-slate-700"
              title="Items per page"
            >
              <option value={5}>5 / page</option>
              <option value={10}>10 / page</option>
              <option value={20}>20 / page</option>
              <option value={50}>50 / page</option>
            </select>
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

      {(error || scanDiagnostic) && (
        <div className="mb-4 space-y-1 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
          {error && <p>{error}</p>}
          {scanDiagnostic && (
            <p className="font-mono text-xs text-amber-800">
              Diagnostic: {scanDiagnostic}
            </p>
          )}
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
              DAILY SALE — Today Sold Qty
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-slate-900">{todaySoldQty}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold uppercase text-slate-500">
              DAILY SALE — Today Sales Total
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

      {/* DAILY SALE خانہ اور اس کے بالکل نیچے روزانہ سیل کی تفصیل */}
      <Card className="mb-6 border-emerald-300 bg-emerald-50/30">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>
                DAILY SALE ({filteredDailySales.length})
              </CardTitle>
              <p className="mt-1 text-xs text-slate-600">
                چیک آؤٹ سے بننے والے بل اور بیچی گئی آئٹمز کی روزانہ تفصیل DAILY SALE کے نیچے آتی ہے — STOCK میں نہیں جاتی۔
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-emerald-100 px-3 py-1 font-semibold text-emerald-900">
                Today Sale ({todayDate}): {formatMoney(todaySalesTotal)} ({todaySoldQty} items)
              </span>
              <span className="rounded bg-blue-100 px-3 py-1 font-semibold text-blue-900">
                Selected ({saleFilterDate || "All"}): {formatMoney(filteredDailySaleTotal)} ({filteredDailySaleQty} items)
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-xs font-semibold text-slate-700">
                تاریخ منتخب کریں:
              </label>
              <Input
                type="date"
                value={saleFilterDate}
                onChange={(e) => setSaleFilterDate(e.target.value)}
                className="w-auto bg-white text-xs"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setSaleFilterDate(todayDate)}
              >
                آج ({todayDate})
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSaleFilterDate("")}
              >
                تمام تاریخیں
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  void syncCheckoutSalesNow(
                    productCostMapRef.current,
                    productsRef.current
                  )
                }
              >
                ↻ Sync Checkout Sales
              </Button>
              <Button type="button" onClick={() => router.push("/checkout")}>
                Scan &amp; Bill at Checkout
              </Button>
            </div>
          </div>

          {filteredDailySales.length === 0 ? (
            <p className="text-sm text-slate-500">
              اس تاریخ ({saleFilterDate || "تمام"}) کے لیے ابھی کوئی سیل ریکارڈ نہیں آیا۔ چیک آؤٹ سے بل بنائیں تو تفصیل یہاں DAILY SALE کے نیچے آ جائے گی۔
            </p>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="py-2 pr-3 pl-3">Date / Time</th>
                      <th className="py-2 pr-3">Bill / Ref</th>
                      <th className="py-2 pr-3">Item</th>
                      <th className="py-2 pr-3">Qty</th>
                      <th className="py-2 pr-3">Rate</th>
                      <th className="py-2 pr-3">Total Sale</th>
                      <th className="py-2 pr-3">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedDailySales.map((row) => (
                      <tr key={row.id} className="border-b border-slate-100">
                        <td className="py-2 pr-3 pl-3 text-xs">
                          {row.date} {row.time}
                        </td>
                        <td className="py-2 pr-3">{row.billRef}</td>
                        <td className="py-2 pr-3 font-medium">{row.itemName}</td>
                        <td className="py-2 pr-3">{row.qty}</td>
                        <td className="py-2 pr-3">{formatMoney(row.salePrice)}</td>
                        <td className="py-2 pr-3 font-semibold text-emerald-800">
                          {formatMoney(row.totalSale)}
                        </td>
                        <td className="py-2 pr-3 font-semibold text-blue-700">
                          {formatMoney(row.profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-600">
                <span>
                  Page {safeSalePage} of {totalSalePages} • Showing{" "}
                  {saleStartIdx + 1}–
                  {Math.min(saleStartIdx + pageSize, filteredDailySales.length)} of{" "}
                  {filteredDailySales.length}
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={safeSalePage <= 1}
                    onClick={() => setSalePage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  {salePageNumbers.map((pg) => (
                    <Button
                      key={`sale-pg-${pg}`}
                      type="button"
                      variant={pg === safeSalePage ? "default" : "outline"}
                      onClick={() => setSalePage(pg)}
                    >
                      {pg}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={safeSalePage >= totalSalePages}
                    onClick={() =>
                      setSalePage((p) => Math.min(totalSalePages, p + 1))
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>STOCK — Add / Restock Item</CardTitle>
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
                  Item
                </label>
                <Input
                  id="manual-item-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter item"
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
                  {cameraOpen ? "Stop Camera" : "Scan Bill / Item"}
                </Button>
              </div>
            </form>

            {savedBillImage && (
              <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
                <div className="mb-1.5 flex items-center justify-between text-xs text-slate-600">
                  <span className="font-semibold">محفوظ شدہ بل کی تصویر</span>
                  <a
                    href={savedBillImage}
                    download={`bill-${todayDate}.jpg`}
                    className="font-medium text-blue-600 underline"
                  >
                    تصویر ڈاؤن لوڈ کریں
                  </a>
                </div>
                <img
                  src={savedBillImage}
                  alt="Saved Bill"
                  className="max-h-44 w-full rounded border bg-white object-contain"
                />
              </div>
            )}

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
                      {editingIndex === idx ? (
                        <div className="space-y-2">
                          <div className="grid gap-2 sm:grid-cols-2">
                            <Input
                              value={editDraft.name}
                              onChange={(e) =>
                                setEditDraft((prev) => ({
                                  ...prev,
                                  name: e.target.value,
                                }))
                              }
                              placeholder="Item"
                            />
                            <Input
                              value={editDraft.sku}
                              onChange={(e) =>
                                setEditDraft((prev) => ({
                                  ...prev,
                                  sku: e.target.value,
                                }))
                              }
                              placeholder="SKU"
                            />
                          </div>
                          <div className="grid gap-2 sm:grid-cols-3">
                            <Input
                              type="number"
                              value={editDraft.qty}
                              onChange={(e) =>
                                setEditDraft((prev) => ({
                                  ...prev,
                                  qty: e.target.value,
                                }))
                              }
                              placeholder="Qty"
                            />
                            <Input
                              type="number"
                              step="any"
                              value={editDraft.costPrice}
                              onChange={(e) =>
                                setEditDraft((prev) => ({
                                  ...prev,
                                  costPrice: e.target.value,
                                }))
                              }
                              placeholder="Rate"
                            />
                            <Input
                              type="number"
                              step="any"
                              value={editDraft.amount}
                              onChange={(e) =>
                                setEditDraft((prev) => ({
                                  ...prev,
                                  amount: e.target.value,
                                }))
                              }
                              placeholder="Amount"
                            />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setEditingIndex(null)}
                            >
                              Cancel
                            </Button>
                            <Button type="button" onClick={applyScannedItemEdit}>
                              Apply Edit
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-bold text-slate-950">
                              {idx + 1}. {it.name}
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-[11px] text-slate-500">
                                {it.sku}
                              </span>
                              <button
                                type="button"
                                onClick={() => startEditScannedItem(idx)}
                                className="rounded border border-slate-300 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-800 hover:bg-slate-100"
                              >
                                Edit
                              </button>
                            </div>
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
                        </>
                      )}
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
                onClick={() =>
                  collectBarcodeEntry(sku || "TEST-SKU", selectedChannel)
                }
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

      {/* STOCK خانہ اور اس کے بالکل نیچے اسٹاک کی تفصیل */}
      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>
                STOCK ({filteredProducts.length})
              </CardTitle>
              <p className="mt-1 text-xs text-slate-500">
                یہاں صرف موجودہ دکان کی STOCK کی انٹری/تفصیل آتی ہے — سیل آئٹمز STOCK میں نہیں جاتیں۔
              </p>
              <p className="mt-1 text-xs font-medium text-slate-600">
                Total Stock Value: <strong>{formatMoney(totalStockValue)}</strong>
              </p>
            </div>
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by item or SKU..."
              className="max-w-xs"
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <p className="text-sm text-slate-500">Loading items...</p>
          ) : filteredProducts.length === 0 ? (
            <p className="text-sm text-slate-500">No items found.</p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                      <th className="py-2 pr-4">SKU</th>
                      <th className="py-2 pr-4">Item</th>
                      <th className="py-2 pr-4">Cost</th>
                      <th className="py-2 pr-4">Sale Price</th>
                      <th className="py-2 pr-4">Stock</th>
                      <th className="py-2 pr-4">Total</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2">Sale Move</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedStockProducts.map((p) => {
                      const uCost = lookupUnitCost(
                        p.id,
                        p.sku,
                        parseFloat(p.price || "0") || 0
                      );
                      const rowTotal =
                        Math.round(uCost * Number(p.stockQty || 0) * 100) / 100;
                      return (
                        <tr key={p.id} className="border-b border-slate-100">
                          <td className="py-2 pr-4 font-mono text-xs">
                            {p.sku || "-"}
                          </td>
                          <td className="py-2 pr-4 font-medium">{p.name}</td>
                          <td className="py-2 pr-4">{formatMoney(uCost)}</td>
                          <td className="py-2 pr-4">
                            {formatMoney(parseFloat(p.price || "0") || 0)}
                          </td>
                          <td className="py-2 pr-4">{p.stockQty}</td>
                          <td className="py-2 pr-4 font-semibold">
                            {formatMoney(rowTotal)}
                          </td>
                          <td className="py-2 pr-4">
                            <Badge
                              variant={
                                p.stockQty > 5
                                  ? "success"
                                  : p.stockQty > 0
                                  ? "warning"
                                  : "destructive"
                              }
                            >
                              {p.stockQty > 5
                                ? "In Stock"
                                : p.stockQty > 0
                                ? "Low Stock"
                                : "Out of Stock"}
                            </Badge>
                          </td>
                          <td className="py-2">
                            <button
                              type="button"
                              onClick={() => moveStockItemToDailySale(p)}
                              className="rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-100"
                            >
                              → Sale
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs text-slate-600">
                <span>
                  Page {safeStockPage} of {totalStockPages} • Showing{" "}
                  {stockStartIdx + 1}–
                  {Math.min(stockStartIdx + pageSize, filteredProducts.length)} of{" "}
                  {filteredProducts.length}
                </span>
                <div className="flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={safeStockPage <= 1}
                    onClick={() => setStockPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  {stockPageNumbers.map((pg) => (
                    <Button
                      key={`stock-pg-${pg}`}
                      type="button"
                      variant={pg === safeStockPage ? "default" : "outline"}
                      onClick={() => setStockPage(pg)}
                    >
                      {pg}
                    </Button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={safeStockPage >= totalStockPages}
                    onClick={() =>
                      setStockPage((p) => Math.min(totalStockPages, p + 1))
                    }
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold tracking-wide uppercase text-slate-900">
                SEPARATE DAILY LEDGERS ({todayDate})
              </h2>
              <span className="rounded border border-emerald-700/60 bg-emerald-900/70 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                {`Day Open (${todayDate}) • rolls over at 12:00 AM`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={activeLedgerTab === "purchase" ? "default" : "outline"}
                onClick={() => setActiveLedgerTab("purchase")}
              >
                STOCK Purchase ({tenantPurchases.length})
              </Button>
              <Button
                type="button"
                variant={activeLedgerTab === "sales" ? "default" : "outline"}
                onClick={() => setActiveLedgerTab("sales")}
              >
                Daily Sales ({tenantDailySales.length})
              </Button>
              <Button
                type="button"
                variant={activeLedgerTab === "khata" ? "default" : "outline"}
                onClick={() => setActiveLedgerTab("khata")}
              >
                Khata / Hisab ({customerAccounts.length})
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {activeLedgerTab === "purchase" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="py-2 pr-3">Date / Time</th>
                    <th className="py-2 pr-3">Supplier / Bill</th>
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 pr-3">Qty</th>
                    <th className="py-2 pr-3">Rate</th>
                    <th className="py-2">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantPurchases.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3 text-xs">
                        {row.date} {row.time}
                      </td>
                      <td className="py-2 pr-3">{row.supplierOrBill}</td>
                      <td className="py-2 pr-3">{row.itemName}</td>
                      <td className="py-2 pr-3">{row.qty}</td>
                      <td className="py-2 pr-3">{formatMoney(row.costPrice)}</td>
                      <td className="py-2 font-semibold">
                        {formatMoney(row.totalPurchase)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeLedgerTab === "sales" && (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="py-2 pr-3">Date / Time</th>
                    <th className="py-2 pr-3">Bill</th>
                    <th className="py-2 pr-3">Item</th>
                    <th className="py-2 pr-3">Qty</th>
                    <th className="py-2 pr-3">Sale</th>
                    <th className="py-2">Profit</th>
                  </tr>
                </thead>
                <tbody>
                  {tenantDailySales.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100">
                      <td className="py-2 pr-3 text-xs">
                        {row.date} {row.time}
                      </td>
                      <td className="py-2 pr-3">{row.billRef}</td>
                      <td className="py-2 pr-3">{row.itemName}</td>
                      <td className="py-2 pr-3">{row.qty}</td>
                      <td className="py-2 pr-3">{formatMoney(row.totalSale)}</td>
                      <td className="py-2 font-semibold text-emerald-700">
                        {formatMoney(row.profit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeLedgerTab === "khata" && (() => {
            const totalToCollect = customerAccounts.reduce(
              (sum, c) => sum + (c.balance > 0 ? c.balance : 0),
              0
            );
            const activeDebtors = customerAccounts.filter((c) => c.balance > 0);
            const filteredCustomers = customerAccounts.filter((c) => {
              const q = khataSearch.trim().toLowerCase();
              if (!q) return true;
              return (
                c.name.toLowerCase().includes(q) ||
                c.phone.toLowerCase().includes(q) ||
                c.address.toLowerCase().includes(q)
              );
            });
            const activeCustomer =
              customerAccounts.find((c) => c.id === selectedCustomerId) ||
              activeDebtors[0] ||
              filteredCustomers[0] ||
              null;

            const handleTopWhatsAppReminderClick = () => {
              if (activeCustomer && activeCustomer.phone.trim()) {
                openWhatsAppReminder(activeCustomer);
                return;
              }
              setNewCustDate(getTodayDateStr());
              setKhataModalMode("new_customer");
            };

            return (
              <div className="space-y-4">
                <div className="rounded-xl border border-emerald-200 bg-[#f7f5ee] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs font-medium text-slate-600">
                        To collect (کل وصولی)
                      </p>
                      <p className="text-2xl font-bold text-slate-900">
                        {formatMoney(totalToCollect)}
                      </p>
                    </div>
                    <span className="mt-4 text-xs font-medium text-slate-600">
                      from {activeDebtors.length} customers
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleTopWhatsAppReminderClick}
                    className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-rose-200 bg-[#f9ecea] px-4 py-2.5 text-sm font-semibold text-rose-950 transition hover:bg-rose-100"
                  >
                    <span>💬</span>
                    <span>
                      {activeCustomer
                        ? `Remind on WhatsApp (${activeCustomer.name})`
                        : "Remind on WhatsApp"}
                    </span>
                  </button>

                  <div className="mt-3">
                    <Input
                      value={khataSearch}
                      onChange={(e) => setKhataSearch(e.target.value)}
                      placeholder="Find customer (نام، موبائل یا ایڈریس تلاش کریں)..."
                      className="bg-white"
                    />
                  </div>

                  <div className="mt-3 space-y-2">
                    {filteredCustomers.length === 0 ? (
                      <p className="py-4 text-center text-xs text-slate-500">
                        ابھی کوئی کسٹمر ایڈ نہیں ہے۔ اوپر &quot;Remind on WhatsApp&quot; یا نیچے &quot;+ Customer (نیا کھاتہ)&quot; سے کسٹمر شامل کریں۔
                      </p>
                    ) : (
                      filteredCustomers.map((cust) => {
                        const isSelected = activeCustomer?.id === cust.id;
                        return (
                          <div
                            key={cust.id}
                            onClick={() => setSelectedCustomerId(cust.id)}
                            className={`flex cursor-pointer items-center justify-between rounded-lg border bg-white p-3 transition ${
                              isSelected
                                ? "border-emerald-600 ring-1 ring-emerald-600"
                                : "border-slate-200 hover:border-slate-300"
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-700">
                                {getInitials(cust.name)}
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-900">
                                  {cust.name}
                                </p>
                                <p className="text-xs text-slate-500">
                                  {cust.phone || "No phone"}
                                  {cust.address ? ` • ${cust.address}` : ""} • Last:{" "}
                                  {cust.lastDate}
                                </p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2">
                              <span
                                className={`text-sm font-bold ${
                                  cust.balance > 0
                                    ? "text-rose-700"
                                    : "text-emerald-700"
                                }`}
                              >
                                {formatMoney(cust.balance)}
                              </span>
                              <button
                                type="button"
                                title="Send WhatsApp Reminder"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedCustomerId(cust.id);
                                  openWhatsAppReminder(cust);
                                }}
                                className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                              >
                                💬
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  <div className="mt-4 grid gap-2 sm:grid-cols-3">
                    <Button
                      type="button"
                      variant="outline"
                      className="bg-white font-semibold"
                      onClick={() => {
                        setTxCustomerId(activeCustomer?.id || "");
                        setTxDate(getTodayDateStr());
                        setKhataModalMode("received");
                      }}
                    >
                      Money received (وصولی)
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="bg-white font-semibold"
                      onClick={() => {
                        setTxCustomerId(activeCustomer?.id || "");
                        setTxDate(getTodayDateStr());
                        setKhataModalMode("udhaar");
                      }}
                    >
                      + Udhaar / Bill (ادھار)
                    </Button>
                    <Button
                      type="button"
                      className="bg-emerald-800 text-white hover:bg-emerald-900"
                      onClick={() => {
                        setNewCustDate(getTodayDateStr());
                        setKhataModalMode("new_customer");
                      }}
                    >
                      + Customer (نیا کھاتہ)
                    </Button>
                  </div>
                </div>

                {khataModalMode === "new_customer" && (
                  <form
                    onSubmit={handleCreateCustomerKhata}
                    className="space-y-3 rounded-lg border border-emerald-300 bg-emerald-50/60 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-emerald-950">
                        نیا کسٹمر کھاتہ کھولیں (+ Customer)
                      </h4>
                      <button
                        type="button"
                        onClick={() => setKhataModalMode("none")}
                        className="text-xs text-slate-600 hover:text-slate-900"
                      >
                        ✕ بند کریں
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <Input
                        value={newCustName}
                        onChange={(e) => setNewCustName(e.target.value)}
                        placeholder="کسٹمر کا نام *"
                        required
                      />
                      <Input
                        value={newCustPhone}
                        onChange={(e) => setNewCustPhone(e.target.value)}
                        placeholder="موبائل نمبر (0300...)"
                      />
                      <Input
                        value={newCustAddress}
                        onChange={(e) => setNewCustAddress(e.target.value)}
                        placeholder="مکمل ایڈریس"
                      />
                      <Input
                        type="number"
                        step="any"
                        value={newCustOpeningUdhaar}
                        onChange={(e) => setNewCustOpeningUdhaar(e.target.value)}
                        placeholder="ابتدائی ادھار (Rs)"
                      />
                      <Input
                        type="date"
                        value={newCustDate}
                        onChange={(e) => setNewCustDate(e.target.value)}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="submit">Save Customer Khata</Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-emerald-300 bg-white text-emerald-900"
                        onClick={handleSaveAndSendWhatsApp}
                      >
                        💬 Save &amp; Send WhatsApp
                      </Button>
                    </div>
                  </form>
                )}

                {(khataModalMode === "received" || khataModalMode === "udhaar") && (
                  <form
                    onSubmit={handleRecordCustomerTx}
                    className="space-y-3 rounded-lg border border-slate-300 bg-slate-50 p-4"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-slate-900">
                        {khataModalMode === "received"
                          ? "وصول شدہ رقم درج کریں (Money Received)"
                          : "نیا ادھار / بل درج کریں (+ Udhaar)"}
                      </h4>
                      <button
                        type="button"
                        onClick={() => setKhataModalMode("none")}
                        className="text-xs text-slate-600 hover:text-slate-900"
                      >
                        ✕ بند کریں
                      </button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                      <select
                        value={txCustomerId || activeCustomer?.id || ""}
                        onChange={(e) => setTxCustomerId(e.target.value)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900"
                        required
                      >
                        {customerAccounts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.phone || "No #"}) — Bal: {c.balance}
                          </option>
                        ))}
                      </select>
                      <Input
                        type="number"
                        step="any"
                        value={txAmount}
                        onChange={(e) => setTxAmount(e.target.value)}
                        placeholder="رقم (Rs) *"
                        required
                      />
                      <Input
                        value={txNote}
                        onChange={(e) => setTxNote(e.target.value)}
                        placeholder="تفصیل (مثلاً کیش وصولی / بل #)"
                      />
                      <Input
                        type="date"
                        value={txDate}
                        onChange={(e) => setTxDate(e.target.value)}
                      />
                      <Button type="submit">
                        {khataModalMode === "received"
                          ? "Save Received"
                          : "Save Udhaar"}
                      </Button>
                    </div>
                  </form>
                )}

                {activeCustomer && (
                  <div className="rounded-lg border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">
                          تاریخ وار کھاتہ تفصیل: {activeCustomer.name}
                        </h4>
                        <p className="text-xs text-slate-500">
                          موبائل: {activeCustomer.phone || "-"} | ایڈریس:{" "}
                          {activeCustomer.address || "-"}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-slate-100 px-3 py-1 text-xs font-bold text-slate-900">
                          بقایا بیلنس: {formatMoney(activeCustomer.balance)}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => openWhatsAppReminder(activeCustomer)}
                        >
                          💬 WhatsApp Reminder
                        </Button>
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                            <th className="py-2 pr-3">Date / Time</th>
                            <th className="py-2 pr-3">تفصیل (Note)</th>
                            <th className="py-2 pr-3">ادھار (Given)</th>
                            <th className="py-2 pr-3">وصول (Received)</th>
                            <th className="py-2">بقایا (Balance)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {activeCustomer.transactions.length === 0 ? (
                            <tr>
                              <td
                                colSpan={5}
                                className="py-3 text-center text-xs text-slate-500"
                              >
                                ابھی تک اس کسٹمر کا کوئی لین دین درج نہیں ہے۔
                              </td>
                            </tr>
                          ) : (
                            activeCustomer.transactions.map((tx) => (
                              <tr key={tx.id} className="border-b border-slate-100">
                                <td className="py-2 pr-3 text-xs">
                                  {tx.date} {tx.time}
                                </td>
                                <td className="py-2 pr-3">{tx.note}</td>
                                <td className="py-2 pr-3 text-rose-700">
                                  {tx.type === "udhaar"
                                    ? formatMoney(tx.amount)
                                    : "-"}
                                </td>
                                <td className="py-2 pr-3 text-emerald-700">
                                  {tx.type === "received"
                                    ? formatMoney(tx.amount)
                                    : "-"}
                                </td>
                                <td className="py-2 font-semibold">
                                  {formatMoney(tx.balanceAfter)}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </CardContent>
      </Card>
    </AppShell>
  );
}
