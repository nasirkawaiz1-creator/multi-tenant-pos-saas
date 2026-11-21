"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Input } from "@pos/ui";

export interface HandoffItem {
  id: string;
  code: string;
  name: string;
  qty: number;
  price: number;
}

interface ReceiptItemRow {
  id: string;
  productName: string;
  unitPrice: string;
  quantity: number;
}

interface ReceiptData {
  id: string;
  subtotal?: string | number;
  items?: ReceiptItemRow[];
}

interface StoreData {
  name: string;
  details: string;
  phone: string;
}

interface Props {
  storeInfo: StoreData;
  receipt: ReceiptData;
  receiptDate: string;
  attendantName: string;
  displaySubtotal: string;
  receiptDiscount: number;
  receiptGrandTotal: number;
  customerPhone: string;
  onChangeCustomerPhone: (val: string) => void;
  onSendWhatsApp: (targetPhone?: string) => void;
  onNewSale: () => void;
  onMobileItemReceived?: (item: HandoffItem) => void;
}

export function ReceiptWithMobileQrHandoff({
  storeInfo,
  receipt,
  receiptDate,
  attendantName,
  displaySubtotal,
  receiptDiscount,
  receiptGrandTotal,
  customerPhone,
  onChangeCustomerPhone,
  onSendWhatsApp,
  onNewSale,
  onMobileItemReceived,
}: Props) {
  const cleanCustomerPhone = customerPhone.trim();
  const [qrOpen, setQrOpen] = useState(false);
  const [sessionCode, setSessionCode] = useState("");
  const [handoffUrl, setHandoffUrl] = useState("");
  const [quickMobileCode, setQuickMobileCode] = useState("");
  const [quickMobileName, setQuickMobileName] = useState("");
  const [quickMobilePrice, setQuickMobilePrice] = useState("");
  const [syncNotice, setSyncNotice] = useState("");

  useEffect(() => {
    const code = `POS-${receipt.id}-${Date.now().toString(36).slice(-4).toUpperCase()}`;
    setSessionCode(code);

    if (typeof window !== "undefined") {
      const base = `${window.location.origin}${window.location.pathname}`;
      const url = `${base}?handoffSession=${encodeURIComponent(code)}&bill=${encodeURIComponent(
        receipt.id
      )}`;
      setHandoffUrl(url);
    }
  }, [receipt.id]);

  // اگر اسی براؤزر/ڈیوائس یا دوسرے ٹیب سے BroadcastChannel کے ذریعے موبائل آئٹم آئے تو فوراً لیپ ٹاپ پر شامل کرے
  useEffect(() => {
    if (!sessionCode || typeof window === "undefined" || !("BroadcastChannel" in window)) {
      return;
    }

    const channel = new BroadcastChannel(`pos-handoff-${sessionCode}`);
    channel.onmessage = (event: MessageEvent) => {
      const incoming = event.data as HandoffItem | undefined;
      if (incoming && incoming.name) {
        onMobileItemReceived?.(incoming);
        setSyncNotice(`موبائل سے دستی آئٹم آ گیا: ${incoming.name} (x${incoming.qty})`);
      }
    };

    return () => {
      channel.close();
    };
  }, [sessionCode, onMobileItemReceived]);

  function handleSendMobileItemToLaptop(e: FormEvent) {
    e.preventDefault();
    const name = quickMobileName.trim();
    if (!name) return;

    const item: HandoffItem = {
      id: `MOB-${Date.now().toString().slice(-6)}`,
      code: quickMobileCode.trim() || `QR-${Date.now().toString().slice(-4)}`,
      name,
      qty: 1,
      price: Math.max(0, Number(quickMobilePrice) || 0),
    };

    if (typeof window !== "undefined" && "BroadcastChannel" in window && sessionCode) {
      const channel = new BroadcastChannel(`pos-handoff-${sessionCode}`);
      channel.postMessage(item);
      channel.close();
    }

    onMobileItemReceived?.(item);
    setSyncNotice(`فوری بھیج دیا گیا: ${item.name}`);
    setQuickMobileCode("");
    setQuickMobileName("");
    setQuickMobilePrice("");
  }

  const qrImageSrc = handoffUrl
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(
        handoffUrl
      )}`
    : "";

  return (
    <div className="mx-auto max-w-md space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Receipt</CardTitle>
          <Badge variant="success">Order Complete</Badge>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="border-b border-slate-200 pb-3 text-center">
            <h2 className="text-lg font-bold">{storeInfo.name}</h2>
            <p className="text-xs text-slate-600">{storeInfo.details}</p>
            <p className="text-xs text-slate-600">
              Owner Ph: {storeInfo.phone} | Date: {receiptDate}
            </p>
            {cleanCustomerPhone && (
              <p className="mt-0.5 text-xs font-semibold text-slate-800">
                Customer Ph: {cleanCustomerPhone}
              </p>
            )}
          </div>

          <div className="flex justify-between text-sm text-slate-500">
            <span>Bill #{receipt.id}</span>
            <span>Attendant: {attendantName}</span>
          </div>

          <div className="divide-y divide-slate-100">
            {receipt.items?.map((item) => (
              <div
                key={item.id}
                className="flex justify-between py-2 font-mono text-sm"
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
              <div className="flex justify-between font-medium text-green-600">
                <span>Discount</span>
                <span>-Rs {receiptDiscount.toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1 text-lg font-bold">
              <span>Grand Total</span>
              <span className="text-blue-600">
                Rs {receiptGrandTotal.toFixed(2)}
              </span>
            </div>
          </div>

          {/* 3 واضح آپشنز: 1) نمبر ان پٹ، 2) کسٹمر کو میسج، 3) سینڈ ٹو اونر */}
          <div className="space-y-2 pt-2">
            <Input
              placeholder="Customer WhatsApp Number (e.g. 923001234567)"
              value={customerPhone}
              onChange={(e) => onChangeCustomerPhone(e.target.value)}
            />

            <Button
              type="button"
              className="w-full bg-green-600 font-bold text-white hover:bg-green-700"
              onClick={() => onSendWhatsApp(customerPhone)}
            >
              💬 Send Receipt to Customer WhatsApp
            </Button>

            <Button
              type="button"
              variant="outline"
              className="w-full border-green-600 font-bold text-green-700 hover:bg-green-50"
              onClick={() => onSendWhatsApp(storeInfo.phone)}
            >
              📱 {storeInfo.phone} — Send to Owner
            </Button>
          </div>

          {/* لیپ ٹاپ کا کیمرہ بند ہو تو موبائل QR سے فوری کنیکٹ/ہینڈ آف */}
          <div className="space-y-2 border-t border-slate-200 pt-3">
            <Button
              type="button"
              variant="outline"
              className="w-full border-blue-600 font-semibold text-blue-700 hover:bg-blue-50"
              onClick={() => setQrOpen((prev) => !prev)}
            >
              {qrOpen
                ? "Hide Laptop-Mobile QR Scan"
                : "📷 Mobile QR Scan (Laptop Cam Off)"}
            </Button>

            {qrOpen && (
              <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                <div className="text-center">
                  <p className="text-xs font-semibold text-slate-800">
                    موبائل سے یہ QR اسکین کریں — Session: {sessionCode}
                  </p>
                  {qrImageSrc && (
                    <img
                      src={qrImageSrc}
                      alt="Mobile Handoff QR Code"
                      className="mx-auto mt-2 h-40 w-40 rounded border border-slate-300 bg-white p-1.5"
                    />
                  )}
                  <p className="mt-1 break-all text-[11px] text-slate-600">
                    {handoffUrl}
                  </p>
                </div>

                <form onSubmit={handleSendMobileItemToLaptop} className="space-y-2">
                  <p className="text-xs font-semibold text-slate-700">
                    موبائل سے اسکین/بولا ہوا آئٹم دستی لیپ ٹاپ پر بھیجیں:
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Input
                      placeholder="QR / Code"
                      value={quickMobileCode}
                      onChange={(e) => setQuickMobileCode(e.target.value)}
                      className="bg-white text-xs"
                    />
                    <Input
                      type="number"
                      min={0}
                      placeholder="Price (Rs)"
                      value={quickMobilePrice}
                      onChange={(e) => setQuickMobilePrice(e.target.value)}
                      className="bg-white text-xs"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Item Name..."
                      value={quickMobileName}
                      onChange={(e) => setQuickMobileName(e.target.value)}
                      className="bg-white text-xs"
                    />
                    <Button
                      type="submit"
                      className="bg-blue-600 text-xs font-bold text-white hover:bg-blue-700 whitespace-nowrap"
                    >
                      Send to Laptop
                    </Button>
                  </div>
                </form>

                {syncNotice && (
                  <p className="rounded bg-white px-2.5 py-1.5 text-xs font-medium text-emerald-700">
                    {syncNotice}
                  </p>
                )}
              </div>
            )}
          </div>

          <Button type="button" className="mt-2 w-full" onClick={onNewSale}>
            New Sale
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
