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
            <Button type="button" variant="destructive" onClick={stopCamera}>
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
                    {row.name} <span className="text-slate-500">({row.sku})</span>
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
              <span className="font-bold text-slate-900">{products.length}</span>
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
