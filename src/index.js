const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv/config'); // Memuat variabel dari .env

// Impor file rute
const salesCounterRoutes = require('./routes/salesCounterRoute');
const historyUpdateRoutes = require('./routes/historyUpdateRoutes');
const versionRoutes = require('./routes/versionRoutes');
const bufferStockRoutes = require('./routes/bufferStockRoutes');
const dataProcessRoutes = require('./routes/dataProcessRoutes');
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/authRoutes');
const customerRoutes = require('./routes/customerRoutes');
const memberRoutes = require('./routes/memberRoutes');
const supplierRoutes = require('./routes/supplierRoutes');
const barcodeRoutes = require('./routes/barcodeRoutes');
const barcodeFormRoutes = require('./routes/barcodeFormRoutes');
const offerRoutes = require('./routes/offerRoutes');
const offerFormRoutes = require('./routes/offerFormRoutes');
const warehouseRoutes = require('./routes/warehouseRoutes');
const authPinRoutes = require('./routes/authPinRoutes');
const priceProposalRoutes = require('./routes/priceProposalRoutes');
const priceProposalFormRoutes = require('./routes/priceProposalFormRoutes');
const settingHargaRoutes = require('./routes/settingHargaRoutes');
const soDtfRoutes = require('./routes/soDtfRoutes');
const soDtfFormRoutes = require('./routes/soDtfFormRoutes');
const lhkSoDtfRoutes = require('./routes/lhkSoDtfRoutes');
const laporanStokRoutes = require('./routes/laporanStokRoutes');

const app = express();
const port = process.env.PORT || 8000;
const corsOptions = {
    origin: 'http://localhost:5173', // Ganti dengan domain frontend Anda
    exposedHeaders: 'Content-Disposition',
};
const imageFolderPath = path.join(process.cwd(), 'public', 'images');

// Middleware
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/images', express.static(imageFolderPath));
app.disable('etag');

// Menggunakan Rute
app.use('/api/auth', authRoutes);
app.use('/api/sales-counters', salesCounterRoutes);
app.use('/api/history-updates', historyUpdateRoutes)
app.use('/api/version', versionRoutes);
app.use('/api/buffer-stock', bufferStockRoutes);
app.use('/api/data-process', dataProcessRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/suppliers', supplierRoutes);
app.use('/api/sales-counters', salesCounterRoutes);
app.use('/api/barcodes', barcodeRoutes);
app.use('/api/barcode-form', barcodeFormRoutes);
app.use('/api/offers', offerRoutes);
app.use('/api/offer-form', offerFormRoutes);
app.use('/api/warehouses', warehouseRoutes);
app.use('/api/auth-pin', authPinRoutes);
app.use('/api/price-proposals', priceProposalRoutes);
app.use('/api/price-proposal-form', priceProposalFormRoutes);
app.use('/api/setting-harga', settingHargaRoutes);
app.use('/api/so-dtf', soDtfRoutes);
app.use('/api/so-dtf-form', soDtfFormRoutes);
app.use('/api/lhk-so-dtf', lhkSoDtfRoutes);
app.use('/api/laporan-stok', laporanStokRoutes);

// Menjalankan Server
app.listen(port, () => {
    console.log(`⚡️[server]: Server berjalan di http://localhost:${port}`);
});
