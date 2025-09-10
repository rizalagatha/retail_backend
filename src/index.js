const express = require('express');
const cors = require('cors');
const fs = require('fs');
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
const lhkSoDtfFormRoutes = require('./routes/lhkSoDtfFormRoutes');
const DasborDtfRoutes = require('./routes/dasborDtfRoutes');
const soDtfStokRoutes = require('./routes/SoDtfStokRoutes');
const soDtfStokFormRoutes = require('./routes/soDtfStokFormRoutes');
const lhkSoDtfStokRoutes = require('./routes/lhkSoDtfStokRoutes');
const laporanStokRoutes = require('./routes/laporanStokRoutes');

const app = express();
const port = process.env.PORT || 8000;
const allowedOrigins = [
  "http://localhost:5173",   // vite dev server
  "http://134.209.106.4:8080"     // frontend di VPS
];
const imageFolderPath = path.join(process.cwd(), 'public', 'images');
const requiredDirs = [
    path.join(process.cwd(), 'temp'),
    path.join(process.cwd(), 'public'),
    path.join(process.cwd(), 'public', 'images')
];

// Middleware
app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (like curl or mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("Not allowed by CORS"));
    }
  },
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: "Content-Type, Authorization",
  exposedHeaders: 'Content-Disposition',
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/images', express.static(imageFolderPath));
app.disable('etag');
requiredDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log('Created directory:', dir);
    }
});

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
app.use('/api/lhk-so-dtf-form', lhkSoDtfFormRoutes);
app.use('/api/dasbor-dtf', DasborDtfRoutes);
app.use('/api/so-dtf-stok', soDtfStokRoutes);
app.use('/api/so-dtf-stok-form', soDtfStokFormRoutes);
app.use('/api/lhk-so-dtf-stok', lhkSoDtfStokRoutes);
app.use('/api/laporan-stok', laporanStokRoutes);

// Menjalankan Server
app.listen(port, () => {
    console.log(`⚡️[server]: Server berjalan di http://localhost:${port}`);
});
