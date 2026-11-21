"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input } from "@pos/ui";

export interface QuickItemEntry {
  id: string;
  qrOrCode: string;
  spokenOrName: string;
  qty: number;
  price: number;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

interface Props {
  onAddItem?: (item: QuickItemEntry) => void;
}

export function SimpleQrAndMicScanner({ onAddItem }: Props) {
  const [qrCode, setQrCode] = useState("");
  const [itemText, setItemText] = useState("");
  const [qty, setQty] = useState<number>(1);
  const [price, setPrice] = useState<string>("");
  const [lang, setLang] = useState<"ur-PK" | "en-US">("ur-PK");
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("");
  const [recentItems, setRecentItems] = useState<QuickItemEntry[]>([]);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const qrInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    return () => {
      try {
        recognitionRef.current?.stop();
      } catch {}
    };
  }, []);

  function toggleMic() {
    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch {}
      setListening(false);
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setStatus("اس براؤزر میں مائیک سپورٹ نہیں ہے؛ براہِ راست ٹائپ یا QR کوڈ استعمال کریں۔");
      return;
    }

    const rec = new SpeechRec();
    rec.lang = lang;
    rec.interimResults = false;
    rec.maxAlternatives = 1;

    rec.onresult = (event: SpeechRecognitionEventLike) => {
      const spoken = event.results?.[0]?.[0]?.transcript?.trim() || "";
      if (spoken) {
        setItemText((prev) => (prev ? `${prev} ${spoken}`.trim() : spoken));
        setStatus(`مائیک سے لکھا گیا: "${spoken}"`);
      }
    };

    rec.onerror = () => {
      setListening(false);
      setStatus("مائیک سننے میں مسئلہ آیا، دوبارہ کوشش کریں۔");
    };

    rec.onend = () => {
      setListening(false);
    };

    recognitionRef.current = rec;
    setListening(true);
    setStatus(lang === "ur-PK" ? "مائیک آن ہے — اردو میں بولیں..." : "Mic on — speak now...");

    try {
      rec.start();
    } catch {
      setListening(false);
      setStatus("مائیک شروع نہیں ہو سکا۔");
    }
  }

  function handleAdd(e?: React.FormEvent) {
    if (e) e.preventDefault();

    const cleanCode = qrCode.trim();
    const cleanName = itemText.trim() || cleanCode;

    if (!cleanCode && !cleanName) {
      setStatus("QR کوڈ درج کریں یا مائیک/ٹیکسٹ سے آئٹم کا نام لکھیں۔");
      return;
    }

    const newEntry: QuickItemEntry = {
      id: `ITM-${Date.now().toString().slice(-6)}`,
      qrOrCode: cleanCode,
      spokenOrName: cleanName,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      price: Number(price) || 0,
    };

    setRecentItems((prev) => [newEntry, ...prev]);
    onAddItem?.(newEntry);

    setQrCode("");
    setItemText("");
    setQty(1);
    setPrice("");
    setStatus(`شامل ہو گیا: ${newEntry.spokenOrName} (x${newEntry.qty})`);

    setTimeout(() => {
      qrInputRef.current?.focus();
    }, 30);
  }

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base font-bold text-slate-900">
          Simple QR Scan + Mic Entry (No n8n / No Camera Delay)
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setLang((prev) => (prev === "ur-PK" ? "en-US" : "ur-PK"))}
            className="text-xs"
          >
            {lang === "ur-PK" ? "Mic: Urdu (ur-PK)" : "Mic: English (en-US)"}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <form onSubmit={handleAdd} className="space-y-3">
          <Input
            ref={qrInputRef}
            placeholder="QR Code / Item Code (Enter to add)"
            value={qrCode}
            onChange={(e) => setQrCode(e.target.value)}
            autoFocus
          />

          <div className="flex gap-2">
            <Input
              placeholder="Item Name (Copy item / Voice text)"
              value={itemText}
              onChange={(e) => setItemText(e.target.value)}
            />
            <Button
              type="button"
              onClick={toggleMic}
              className={
                listening
                  ? "bg-red-600 hover:bg-red-700 text-white text-xs font-bold whitespace-nowrap"
                  : "bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold whitespace-nowrap"
              }
            >
              {listening ? "Stop Mic" : "Mic"}
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              min={1}
              placeholder="Qty"
              value={qty}
              onChange={(e) => setQty(parseInt(e.target.value || "1", 10) || 1)}
            />
            <Input
              type="number"
              min={0}
              step="any"
              placeholder="Price (Optional)"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </div>

          <Button
            type="submit"
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
          >
            Add Item Instantly
          </Button>
        </form>

        {status && (
          <div className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-800">
            {status}
          </div>
        )}

        {recentItems.length > 0 && (
          <div className="space-y-1.5 border-t border-slate-200 pt-2">
            <div className="text-xs font-semibold text-slate-600">
              Added Items ({recentItems.length})
            </div>
            <div className="max-h-40 space-y-1 overflow-y-auto">
              {recentItems.map((it) => (
                <div
                  key={it.id}
                  className="flex items-center justify-between rounded border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs"
                >
                  <span className="font-medium text-slate-900">
                    {it.spokenOrName} {it.qrOrCode ? `[${it.qrOrCode}]` : ""}
                  </span>
                  <span className="font-mono text-slate-700">
                    x{it.qty} {it.price > 0 ? `• Rs ${it.price}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
