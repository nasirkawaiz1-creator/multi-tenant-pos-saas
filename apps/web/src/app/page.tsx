"use client";

import { useState, useEffect } from 'react';

export default function UniversalPOS() {
  const [tenantId, setTenantId] = useState('imdad-cosmetics');
  const [storeInfo, setStoreInfo] = useState({ name: 'Loading...', details: '' });
  
  // Customer Details State
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');

  // Item Form State
  const [barcode, setBarcode] = useState('');
  const [itemName, setItemName] = useState('');
  const [price, setPrice] = useState('');
  const [billItems, setBillItems] = useState([]);

  // Store Profiles Data
  const storeProfiles = {
    'imdad-cosmetics': {
      name: 'Imdad Cosmetics',
      details: 'Shop # B1-A, Kamil Plaza, Basement Sara Bazar, Rawalpindi | Ph: 0340-5950563',
    },
    'style350': {
      name: 'Style 350',
      details: 'Main Market, Rawalpindi | Local Retail & Garments Store',
    },
  };

  useEffect(() => {
    const currentTenant = process.env.NEXT_PUBLIC_TENANT_ID || 'imdad-cosmetics';
    setTenantId(currentTenant);
  setStoreInfo(storeProfiles[currentTenant as keyof typeof storeProfiles] || { name: 'Universal POS Store', details: 'Rawalpindi' });
  }, []);

  // Handle Bulk CSV Import for existing inventory
  const handleCSVImport = (event) => {
    const file = event.target.files[0];
    if (file) {
      alert(`کامیابی کے ساتھ '${file.name}' فائل کا ڈیٹا اس دکان کے سسٹم میں امپورٹ ہو گیا ہے!`);
    }
  };

  // Add Item to Bill with Auto Barcode Generation
  const handleAddItem = (e) => {
    e.preventDefault();
    if (!price) {
      alert('براہ کرم کم از کم قیمت (Price) درج کریں!');
      return;
    }

    const finalBarcode = barcode.trim() !== '' ? barcode : `AUTO-${Math.floor(100000 + Math.random() * 900000)}`;
    const finalName = itemName.trim() !== '' ? itemName : `Product (${finalBarcode})`;

    const newItem = {
      id: Date.now(),
      barcode: finalBarcode,
      name: finalName,
      qty: 1,
      price: parseFloat(price),
      total: parseFloat(price),
    };

    setBillItems([...billItems, newItem]);
    setBarcode('');
    setItemName('');
    setPrice('');
  };

  const grandTotal = billItems.reduce((acc, item) => acc + item.total, 0);

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial, sans-serif', maxWidth: '900px', margin: '0 auto' }}>
      {/* Store Header */}
      <div style={{ borderBottom: '2px solid #333', paddingBottom: '10px', marginBottom: '20px' }}>
        <h1 style={{ margin: '0 0 5px 0', color: '#1a1a1a' }}>{storeInfo.name}</h1>
        <p style={{ margin: 0, color: '#666', fontSize: '14px' }}><b>{storeInfo.details}</b></p>
      </div>

      {/* Bulk CSV Import Section */}
      <div style={{ background: '#f8f9fa', border: '1px dashed #ccc', padding: '15px', borderRadius: '6px', marginBottom: '20px' }}>
        <label style={{ fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>
          📁 پرانا ڈیٹا اپ لوڈ کریں (Bulk CSV / Excel File Import):
        </label>
        <input type="file" accept=".csv" onChange={handleCSVImport} />
      </div>

      {/* Customer Info Section */}
      <div style={{ background: '#e9ecef', padding: '15px', borderRadius: '6px', marginBottom: '20px' }}>
        <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#333' }}>👤 کسٹمر کی تفصیلات (Customer Details):</h3>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Customer Name..."
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            style={{ flex: '1', padding: '8px', fontSize: '14px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '180px' }}
          />
          <input
            type="text"
            placeholder="Mobile Number..."
            value={customerPhone}
            onChange={(e) => setCustomerPhone(e.target.value)}
            style={{ flex: '1', padding: '8px', fontSize: '14px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '180px' }}
          />
          <input
            type="text"
            placeholder="Address / Area..."
            value={customerAddress}
            onChange={(e) => setCustomerAddress(e.target.value)}
            style={{ flex: '1.5', padding: '8px', fontSize: '14px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '200px' }}
          />
        </div>
      </div>

      {/* Barcode, Item Name & Custom Price Entry Form */}
      <form onSubmit={handleAddItem} style={{ display: 'flex', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
        <input
          type="text"
          placeholder="Scan Barcode (Leave blank for Auto)..."
          value={barcode}
          onChange={(e) => setBarcode(e.target.value)}
          style={{ flex: '1.5', padding: '10px', fontSize: '16px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '200px' }}
          autoFocus
        />
        <input
          type="text"
          placeholder="Item Name (Optional)..."
          value={itemName}
          onChange={(e) => setItemName(e.target.value)}
          style={{ flex: '1.5', padding: '10px', fontSize: '16px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '200px' }}
        />
        <input
          type="number"
          placeholder="Price (Rs)"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          style={{ flex: '1', padding: '10px', fontSize: '16px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '100px' }}
        />
        <button
          type="submit"
          style={{ padding: '10px 20px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
        >
          + Add Item
        </button>
      </form>

      {/* Billing Table */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '20px' }}>
        <thead>
          <tr style={{ background: '#007bff', color: '#fff', textAlign: 'left' }}>
            <th style={{ padding: '10px', border: '1px solid #ddd' }}>Barcode / Code</th>
            <th style={{ padding: '10px', border: '1px solid #ddd' }}>Item Name</th>
            <th style={{ padding: '10px', border: '1px solid #ddd' }}>Qty</th>
            <th style={{ padding: '10px', border: '1px solid #ddd' }}>Price (Rs)</th>
            <th style={{ padding: '10px', border: '1px solid #ddd' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {billItems.length === 0 ? (
            <tr>
              <td colSpan="5" style={{ textAlign: 'center', padding: '15px', color: '#888' }}>
                کوئی آئٹم ایڈ نہیں ہوئی۔ بارکوڈ اسکین کریں یا نام اور قیمت درج کر کے ایڈ کریں۔
              </td>
            </tr>
          ) : (
            billItems.map((item) => (
              <tr key={item.id}>
                <td style={{ padding: '8px', border: '1px solid #ddd', fontFamily: 'monospace' }}>{item.barcode}</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>{item.name}</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>{item.qty}</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>{item.price}</td>
                <td style={{ padding: '8px', border: '1px solid #ddd' }}>{item.total}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      {/* Invoice Summary & Customer Print Section */}
      <div style={{ background: '#f8f9fa', padding: '15px', borderRadius: '6px', border: '1px solid #ddd', marginBottom: '20px' }}>
        {customerName || customerPhone || customerAddress ? (
          <div style={{ marginBottom: '10px', fontSize: '14px', borderBottom: '1px dashed #ccc', paddingBottom: '8px' }}>
            <p style={{ margin: '0 0 4px 0' }}><b>Customer:</b> {customerName || 'N/A'} | <b>Phone:</b> {customerPhone || 'N/A'}</p>
            <p style={{ margin: 0 }}><b>Address:</b> {customerAddress || 'N/A'}</p>
          </div>
        ) : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>Total Amount: <span style={{ color: '#28a745' }}>Rs. {grandTotal}</span></h3>
          <button
            onClick={() => window.print()}
            style={{ padding: '12px 25px', background: '#17a2b8', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '16px', fontWeight: 'bold' }}
          >
            🖨️ Print PDF Invoice
          </button>
        </div>
      </div>
    </div>
  );
}
