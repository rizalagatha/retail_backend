const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv/config"); // Memuat variabel dari .env

// Impor file rute
const salesCounterRoutes = require("./routes/salesCounterRoute");
const historyUpdateRoutes = require("./routes/historyUpdateRoutes");
const versionRoutes = require("./routes/versionRoutes");
const bufferStockRoutes = require("./routes/bufferStockRoutes");
const dataProcessRoutes = require("./routes/dataProcessRoutes");
const userRoutes = require("./routes/userRoutes");
const authRoutes = require("./routes/authRoutes");
const customerRoutes = require("./routes/customerRoutes");
const memberRoutes = require("./routes/memberRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const barcodeRoutes = require("./routes/barcodeRoutes");
const barcodeFormRoutes = require("./routes/barcodeFormRoutes");
const offerRoutes = require("./routes/offerRoutes");
const offerFormRoutes = require("./routes/offerFormRoutes");
const warehouseRoutes = require("./routes/warehouseRoutes");
const authPinRoutes = require("./routes/authPinRoutes");
const priceProposalRoutes = require("./routes/priceProposalRoutes");
const priceProposalFormRoutes = require("./routes/priceProposalFormRoutes");
const settingHargaRoutes = require("./routes/settingHargaRoutes");
const soDtfRoutes = require("./routes/soDtfRoutes");
const soDtfFormRoutes = require("./routes/soDtfFormRoutes");
const lhkSoDtfRoutes = require("./routes/lhkSoDtfRoutes");
const lhkSoDtfFormRoutes = require("./routes/lhkSoDtfFormRoutes");
const DasborDtfRoutes = require("./routes/dasborDtfRoutes");
const soDtfStokRoutes = require("./routes/SoDtfStokRoutes");
const soDtfStokFormRoutes = require("./routes/soDtfStokFormRoutes");
const lhkSoDtfStokRoutes = require("./routes/lhkSoDtfStokRoutes");
const lhkSoDtfStokFormRoutes = require("./routes/lhkSoDtfStokFormRoutes");
const soRoutes = require("./routes/soRoutes");
const soFormRoutes = require("./routes/soFormRoutes");
const mutasiOutRoutes = require("./routes/mutasiOutRoutes");
const mutasiOutFormRoutes = require("./routes/mutasiOutFormRoutes");
const mintaBarangRoutes = require("./routes/mintaBarangRoutes");
const mintaBarangFormRoutes = require("./routes/mintaBarangFormRoutes");
const suratJalanRoutes = require("./routes/suratJalanRoutes");
const suratJalanFormRoutes = require("./routes/suratJalanFormRoutes");
const terimaSjRoutes = require("./routes/terimaSjRoutes");
const terimaSjFormRoutes = require("./routes/terimaSjFormRoutes");
const mutasiInRoutes = require("./routes/mutasiInRoutes");
const mutasiInFormRoutes = require("./routes/mutasiInFormRoutes");
const mutasiStokRoutes = require("./routes/mutasiStokRoutes");
const mutasiStokFormRoutes = require("./routes/mutasiStokFormRoutes");
const setoranBayarRoutes = require("./routes/setoranBayarRoutes");
const setoranBayarFormRoutes = require("./routes/setoranBayarFormRoutes");
const fskRoutes = require("./routes/fskRoutes");
const fskFormRoutes = require("./routes/fskFormRoutes");
const invoiceRoutes = require("./routes/invoiceRoutes");
const invoiceFormRoutes = require("./routes/invoiceFormRoutes");
const mutasiKirimRoutes = require("./routes/mutasiKirimRoutes");
const mutasiKirimFormRoutes = require("./routes/mutasiKirimFormRoutes");
const mutasiTerimaRoutes = require("./routes/mutasiTerimaRoutes");
const mutasiTerimaFormRoutes = require("./routes/mutasiTerimaFormRoutes");
const koreksiStokRoutes = require("./routes/koreksiStokRoutes");
const koreksiStokFormRoutes = require("./routes/koreksiStokFormRoutes");
const returJualRoutes = require("./routes/returJualRoutes");
const returJualFormRoutes = require("./routes/returJualFormRoutes");
const returDcRoutes = require("./routes/returDcRoutes");
const laporanStokRoutes = require("./routes/laporanStokRoutes");
const whatsappRoutes = require("./routes/whatsappRoutes");

const app = express();
const port = process.env.PORT || 8000;
const allowedOrigins = [
  "http://localhost:5173", // vite dev server
  "http://103.94.238.252",
  "http://192.168.1.191:5173",
];
const imageFolderPath = path.join(process.cwd(), "public", "images");
const requiredDirs = [
  path.join(process.cwd(), "temp"),
  path.join(process.cwd(), "public"),
  path.join(process.cwd(), "public", "images"),
];

// Middleware
app.use(
  cors({
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
    exposedHeaders: "Content-Disposition",
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/images", express.static(imageFolderPath));
app.disable("etag");
requiredDirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log("Created directory:", dir);
  }
});

// Menggunakan Rute
app.use("/api/auth", authRoutes);
app.use("/api/sales-counters", salesCounterRoutes);
app.use("/api/history-updates", historyUpdateRoutes);
app.use("/api/version", versionRoutes);
app.use("/api/buffer-stock", bufferStockRoutes);
app.use("/api/data-process", dataProcessRoutes);
app.use("/api/users", userRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/members", memberRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/sales-counters", salesCounterRoutes);
app.use("/api/barcodes", barcodeRoutes);
app.use("/api/barcode-form", barcodeFormRoutes);
app.use("/api/offers", offerRoutes);
app.use("/api/offer-form", offerFormRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use("/api/auth-pin", authPinRoutes);
app.use("/api/price-proposals", priceProposalRoutes);
app.use("/api/price-proposal-form", priceProposalFormRoutes);
app.use("/api/setting-harga", settingHargaRoutes);
app.use("/api/so-dtf", soDtfRoutes);
app.use("/api/so-dtf-form", soDtfFormRoutes);
app.use("/api/lhk-so-dtf", lhkSoDtfRoutes);
app.use("/api/lhk-so-dtf-form", lhkSoDtfFormRoutes);
app.use("/api/dasbor-dtf", DasborDtfRoutes);
app.use("/api/so-dtf-stok", soDtfStokRoutes);
app.use("/api/so-dtf-stok-form", soDtfStokFormRoutes);
app.use("/api/lhk-so-dtf-stok", lhkSoDtfStokRoutes);
app.use("/api/lhk-so-dtf-stok-form", lhkSoDtfStokFormRoutes);
app.use("/api/so", soRoutes);
app.use("/api/so-form", soFormRoutes);
app.use("/api/mutasi-out", mutasiOutRoutes);
app.use("/api/mutasi-out-form", mutasiOutFormRoutes);
app.use("/api/minta-barang", mintaBarangRoutes);
app.use("/api/minta-barang-form", mintaBarangFormRoutes);
app.use("/api/surat-jalan", suratJalanRoutes);
app.use("/api/surat-jalan-form", suratJalanFormRoutes);
app.use("/api/terima-sj", terimaSjRoutes);
app.use("/api/terima-sj-form", terimaSjFormRoutes);
app.use("/api/mutasi-in", mutasiInRoutes);
app.use("/api/mutasi-in-form", mutasiInFormRoutes);
app.use("/api/mutasi-stok", mutasiStokRoutes);
app.use("/api/mutasi-stok-form", mutasiStokFormRoutes);
app.use("/api/setoran-bayar", setoranBayarRoutes);
app.use("/api/setoran-bayar-form", setoranBayarFormRoutes);
app.use("/api/fsk", fskRoutes);
app.use("/api/fsk-form", fskFormRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/invoice-form", invoiceFormRoutes);
app.use("/api/mutasi-kirim", mutasiKirimRoutes);
app.use("/api/mutasi-kirim-form", mutasiKirimFormRoutes);
app.use("/api/mutasi-terima", mutasiTerimaRoutes);
app.use("/api/mutasi-terima-form", mutasiTerimaFormRoutes);
app.use("/api/koreksi-stok", koreksiStokRoutes);
app.use("/api/koreksi-stok-form", koreksiStokFormRoutes);
app.use("/api/retur-jual", returJualRoutes);
app.use("/api/retur-jual-form", returJualFormRoutes);
app.use("/api/retur-dc", returDcRoutes);
app.use("/api/laporan-stok", laporanStokRoutes);
app.use("/api/whatsapp", whatsappRoutes);

// Menjalankan Server
app.listen(port, () => {
  console.log(`⚡️[server]: Server berjalan di http://localhost:${port}`);
});
