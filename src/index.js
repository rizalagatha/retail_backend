const express = require("express");
const cors = require("cors");
const cookieParser = require('cookie-parser');
const clientCertAuth = require('./middleware/clientCertAuth');
const fs = require("fs");
const path = require("path");
require("dotenv/config"); // Memuat variabel dari .env
// === Global Rounding Policy ===
global.ROUNDING_POLICY = process.env.ROUNDING_POLICY || "ROUND_1";
console.log("Rounding Policy:", global.ROUNDING_POLICY);

// Impor file rute
const dashboardRoutes = require("./routes/dashboardRoutes");
const healthRoutes = require("./routes/healthRoutes");
const userActivityRoutes = require("./routes/userActivityRoutes");
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
const packingListRoutes = require("./routes/packingListRoutes");
const packingListFormRoutes = require("./routes/packingListFormRoutes");
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
const pelunasanInvoiceRoutes = require("./routes/pelunasanInvoiceRoutes");
const pesananOnlineFormRoutes = require("./routes/pesananOnlineFormRoutes");
const pesananOnlineRoutes = require("./routes/pesananOnlineRoutes");
const mutasiKirimRoutes = require("./routes/mutasiKirimRoutes");
const mutasiKirimFormRoutes = require("./routes/mutasiKirimFormRoutes");
const mutasiTerimaRoutes = require("./routes/mutasiTerimaRoutes");
const mutasiTerimaFormRoutes = require("./routes/mutasiTerimaFormRoutes");
const koreksiStokRoutes = require("./routes/koreksiStokRoutes");
const koreksiStokFormRoutes = require("./routes/koreksiStokFormRoutes");
const returJualRoutes = require("./routes/returJualRoutes");
const returJualFormRoutes = require("./routes/returJualFormRoutes");
const returDcRoutes = require("./routes/returDcRoutes");
const returDcFormRoutes = require("./routes/returDcFormRoutes");
const terimaReturRoutes = require("./routes/terimaReturRoutes");
const terimaReturFormRoutes = require('./routes/terimaReturFormRoutes');
const kartuPiutangRoutes = require('./routes/kartuPiutangRoutes');
const pengajuanBarcodeRoutes = require('./routes/pengajuanBarcodeRoutes');
const pengajuanBarcodeFormRoutes = require('./routes/pengajuanBarcodeFormRoutes');
const jenisKainRoutes = require("./routes/jenisKainRoutes");
const warnaKainRoutes = require("./routes/warnaKainRoutes");
const lenganRoutes = require("./routes/lenganRoutes");
const barangDcRoutes = require("./routes/barangDcRoutes");
const barangDcFormRoutes = require("./routes/barangDcFormRoutes");
const priceListRoutes = require("./routes/priceListRoutes");  
const promoRoutes = require("./routes/promoRoutes");
const promoFormRoutes = require("./routes/promoFormRoutes");
const terimaStbjRoutes = require("./routes/terimaStbjRoutes");
const terimaStbjFormRoutes = require("./routes/terimaStbjFormRoutes");
const tolakStbjFormRoutes = require("./routes/tolakStbjFormRoutes"); 
const terimaRepairRoutes = require('./routes/terimaRepairRoutes');
const terimaRepairFormRoutes = require('./routes/terimaRepairFormRoutes');
const ambilBarangRoutes = require("./routes/ambilBarangRoutes");
const ambilBarangFormRoutes = require("./routes/ambilBarangFormRoutes");
const proformaRoutes = require("./routes/proformaRoutes");
const proformaFormRoutes = require("./routes/proformaFormRoutes");
const laporanStokRoutes = require("./routes/laporanStokRoutes");
const laporanMutasiStokRoutes = require('./routes/laporanMutasiStokRoutes');
const laporanKartuStokRoutes = require('./routes/laporanKartuStokRoutes');
const laporanListOtorisasiRoutes = require('./routes/laporanListOtorisasiRoutes');
const laporanInvoiceRoutes = require('./routes/laporanInvoiceRoutes');
const potonganRoutes = require('./routes/potonganRoutes');
const potonganFormRoutes = require('./routes/potonganFormRoutes');
const refundRoutes = require('./routes/refundRoutes');
const refundFormRoutes = require('./routes/refundFormRoutes');
const qckeGarmenRoutes = require('./routes/qckeGarmenRoutes');
const qckeGarmenFormRoutes = require('./routes/qckeGarmenFormRoutes');
const stokOpnameSettingRoutes = require("./routes/stokOpnameSettingRoutes");  
const hitungStokRoutes = require("./routes/hitungStokRoutes");
const hitungStokFormRoutes = require("./routes/hitungStokFormRoutes");
const hitungStokLokasiRoutes = require("./routes/hitungStokLokasiRoutes");
const cekSelisihRoutes = require("./routes/cekSelisihRoutes");
const prosesStokOpnameRoutes = require("./routes/prosesStokOpnameRoutes");
const prosesStokOpnameFormRoutes = require("./routes/prosesStokOpnameFormRoutes");
const paretoRoutes = require("./routes/paretoRoutes");
const laporanPenjualanPivotRoutes = require('./routes/laporanPenjualanPivotRoutes');
const salesTargetRoutes = require("./routes/salesTargetRoutes");
const monitoringAchievementRoutes = require("./routes/monitoringAchievementRoutes");
const laporanStokPivotRoutes = require("./routes/laporanStokPivotRoutes");
const laporanStokStagnanRoutes = require("./routes/laporanStokStagnanRoutes");
const laporanDeadStokRoutes = require("./routes/laporanDeadStokRoutes");
const laporanSaldoKasirRoutes = require("./routes/laporanSaldoKasirRoutes");
const mutasiAntarGudangRoutes = require("./routes/mutasiAntarGudangRoutes");
const mutasiAntarGudangFormRoutes = require("./routes/mutasiAntarGudangFormRoutes");
const pengajuanProduksiRoutes = require("./routes/pengajuanProduksiRoutes");
const pengajuanProduksiFormRoutes = require("./routes/pengajuanProduksiFormRoutes");
const approvePengajuanProduksiRoutes = require("./routes/approvePengajuanProduksiRoutes");
const approvePengajuanProduksiFormRoutes = require("./routes/approvePengajuanProduksiFormRoutes");
const barangExternalRoutes = require("./routes/barangExternalRoutes");
const barangExternalFormRoutes = require("./routes/barangExternalFormRoutes");
const poKaosanRoutes = require("./routes/poKaosanRoutes");
const poKaosanFormRoutes = require("./routes/poKaosanFormRoutes");
const bpbKaosanRoutes = require("./routes/bpbKaosanRoutes");
const bpbKaosanFormRoutes = require("./routes/bpbKaosanFormRoutes");
const laporanHppKosongRoutes = require("./routes/laporanHppKosongRoutes");
const klerekRoutes = require ("./routes/klerekRoutes");
const laporanStokMinusRoutes = require("./routes/laporanStokMinusRoutes");
const whatsappRoutes = require("./routes/whatsappRoutes");

const app = express();
const port = process.env.PORT || 8000;
const allowedOrigins = [
  "http://localhost:5173", // vite dev server
  "http://103.94.238.252",
  "http://192.168.1.191:5173",
  "https://103.94.238.252",
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
    credentials: true
  })
);
app.use(express.json());
app.use(cookieParser());
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
app.use("/api/auth", clientCertAuth, authRoutes);
app.use("/api/dashboard", clientCertAuth, dashboardRoutes);
app.use("/api/health-check", clientCertAuth, healthRoutes);
app.use("/api/activity", clientCertAuth, userActivityRoutes);
app.use("/api/sales-counters", clientCertAuth, salesCounterRoutes);
app.use("/api/history-updates", clientCertAuth, historyUpdateRoutes);
app.use("/api/version", clientCertAuth,versionRoutes);
app.use("/api/buffer-stock", clientCertAuth, bufferStockRoutes);
app.use("/api/data-process", clientCertAuth, dataProcessRoutes);
app.use("/api/users", clientCertAuth, userRoutes);
app.use("/api/customers", clientCertAuth, customerRoutes);
app.use("/api/members", clientCertAuth, memberRoutes);
app.use("/api/suppliers", clientCertAuth, supplierRoutes);
app.use("/api/sales-counters", clientCertAuth, salesCounterRoutes);
app.use("/api/barcodes", clientCertAuth, barcodeRoutes);
app.use("/api/barcode-form", clientCertAuth, barcodeFormRoutes);
app.use("/api/offers", clientCertAuth, offerRoutes);
app.use("/api/offer-form", clientCertAuth, offerFormRoutes);
app.use("/api/warehouses", clientCertAuth, warehouseRoutes);
app.use("/api/auth-pin", clientCertAuth, authPinRoutes);
app.use("/api/price-proposals", clientCertAuth, priceProposalRoutes);
app.use("/api/price-proposal-form", clientCertAuth, priceProposalFormRoutes);
app.use("/api/setting-harga", clientCertAuth, settingHargaRoutes);
app.use("/api/so-dtf", clientCertAuth, soDtfRoutes);
app.use("/api/so-dtf-form", clientCertAuth, soDtfFormRoutes);
app.use("/api/lhk-so-dtf", clientCertAuth, lhkSoDtfRoutes);
app.use("/api/lhk-so-dtf-form", clientCertAuth, lhkSoDtfFormRoutes);
app.use("/api/dasbor-dtf", clientCertAuth, DasborDtfRoutes);
app.use("/api/so-dtf-stok", clientCertAuth, soDtfStokRoutes);
app.use("/api/so-dtf-stok-form", clientCertAuth, soDtfStokFormRoutes);
app.use("/api/lhk-so-dtf-stok", clientCertAuth, lhkSoDtfStokRoutes);
app.use("/api/lhk-so-dtf-stok-form", clientCertAuth, lhkSoDtfStokFormRoutes);
app.use("/api/so", clientCertAuth, soRoutes);
app.use("/api/so-form", clientCertAuth, soFormRoutes);
app.use("/api/mutasi-out", clientCertAuth, mutasiOutRoutes);
app.use("/api/mutasi-out-form", clientCertAuth, mutasiOutFormRoutes);
app.use("/api/minta-barang", clientCertAuth, mintaBarangRoutes);
app.use("/api/minta-barang-form", clientCertAuth, mintaBarangFormRoutes);
app.use("/api/packing-list", clientCertAuth, packingListRoutes);  
app.use("/api/packing-list-form", clientCertAuth, packingListFormRoutes);
app.use("/api/surat-jalan", clientCertAuth, suratJalanRoutes);
app.use("/api/surat-jalan-form", clientCertAuth, suratJalanFormRoutes);
app.use("/api/terima-sj", clientCertAuth,terimaSjRoutes);
app.use("/api/terima-sj-form", clientCertAuth, terimaSjFormRoutes);
app.use("/api/mutasi-in", clientCertAuth, mutasiInRoutes);
app.use("/api/mutasi-in-form", clientCertAuth, mutasiInFormRoutes);
app.use("/api/mutasi-stok", clientCertAuth, mutasiStokRoutes);
app.use("/api/mutasi-stok-form", clientCertAuth, mutasiStokFormRoutes);
app.use("/api/setoran-bayar", clientCertAuth, setoranBayarRoutes);
app.use("/api/setoran-bayar-form", clientCertAuth,setoranBayarFormRoutes);
app.use("/api/fsk", clientCertAuth, fskRoutes);
app.use("/api/fsk-form", clientCertAuth, fskFormRoutes);
app.use("/api/invoices", clientCertAuth, invoiceRoutes);
app.use("/api/invoice-form", clientCertAuth, invoiceFormRoutes);
app.use("/api/pelunasan-invoice", clientCertAuth, pelunasanInvoiceRoutes);
app.use("/api/pesanan-online", clientCertAuth, pesananOnlineRoutes);
app.use("/api/pesanan-online-form", clientCertAuth, pesananOnlineFormRoutes);
app.use("/api/mutasi-kirim", clientCertAuth, mutasiKirimRoutes);
app.use("/api/mutasi-kirim-form", clientCertAuth, mutasiKirimFormRoutes);
app.use("/api/mutasi-terima", clientCertAuth,mutasiTerimaRoutes);
app.use("/api/mutasi-terima-form", clientCertAuth,mutasiTerimaFormRoutes);
app.use("/api/koreksi-stok", clientCertAuth,koreksiStokRoutes);
app.use("/api/koreksi-stok-form", clientCertAuth,koreksiStokFormRoutes);
app.use("/api/retur-jual", clientCertAuth,returJualRoutes);
app.use("/api/retur-jual-form", clientCertAuth, returJualFormRoutes);
app.use("/api/retur-dc", clientCertAuth,returDcRoutes);
app.use("/api/retur-dc-form", clientCertAuth,returDcFormRoutes);
app.use("/api/terima-retur", clientCertAuth,terimaReturRoutes);
app.use('/api/terima-retur-form', clientCertAuth,terimaReturFormRoutes);
app.use('/api/kartu-piutang', clientCertAuth, kartuPiutangRoutes);
app.use('/api/pengajuan-barcode', clientCertAuth, pengajuanBarcodeRoutes);
app.use('/api/pengajuan-barcode-form', clientCertAuth,pengajuanBarcodeFormRoutes);
app.use("/api/jenis-kain", clientCertAuth,jenisKainRoutes);
app.use("/api/warna-kain", clientCertAuth, warnaKainRoutes);
app.use("/api/lengan", clientCertAuth,lenganRoutes);
app.use("/api/barang-dc", clientCertAuth,barangDcRoutes);
app.use("/api/barang-dc-form", clientCertAuth,barangDcFormRoutes);
app.use("/api/price-list", clientCertAuth, priceListRoutes);
app.use("/api/promo", clientCertAuth,promoRoutes);
app.use("/api/promo-form", clientCertAuth,promoFormRoutes);
app.use("/api/terima-stbj", clientCertAuth,terimaStbjRoutes);
app.use("/api/terima-stbj-form", clientCertAuth, terimaStbjFormRoutes);
app.use("/api/tolak-stbj-form", clientCertAuth,tolakStbjFormRoutes);
app.use('/api/terima-repair', clientCertAuth,terimaRepairRoutes);
app.use('/api/terima-repair-form', clientCertAuth,terimaRepairFormRoutes);
app.use("/api/ambil-barang", clientCertAuth,ambilBarangRoutes);
app.use("/api/ambil-barang-form", clientCertAuth, ambilBarangFormRoutes);
app.use("/api/proforma", clientCertAuth, proformaRoutes);   
app.use("/api/proforma-form", clientCertAuth, proformaFormRoutes);
app.use("/api/laporan-stok", clientCertAuth,laporanStokRoutes);
app.use('/api/laporan-mutasi-stok', clientCertAuth,laporanMutasiStokRoutes);
app.use('/api/laporan-invoice', clientCertAuth,laporanInvoiceRoutes);
app.use('/api/laporan-kartu-stok', clientCertAuth,laporanKartuStokRoutes);
app.use('/api/laporan-list-otorisasi', clientCertAuth,laporanListOtorisasiRoutes);
app.use("/api/potongan", clientCertAuth, potonganRoutes);
app.use("/api/potongan-form", clientCertAuth, potonganFormRoutes);
app.use("/api/refund", clientCertAuth, refundRoutes);
app.use("/api/refund-form", clientCertAuth, refundFormRoutes);
app.use("/api/qc-ke-garmen", clientCertAuth, qckeGarmenRoutes);  
app.use("/api/qc-ke-garmen-form", clientCertAuth, qckeGarmenFormRoutes);
app.use("/api/stok-opname/setting-tanggal", clientCertAuth, stokOpnameSettingRoutes);
app.use("/api/hitung-stok", clientCertAuth, hitungStokRoutes);
app.use("/api/hitung-stok-form", clientCertAuth, hitungStokFormRoutes);
app.use("/api/hitung-stok-lokasi", clientCertAuth, hitungStokLokasiRoutes);
app.use("/api/cek-selisih", clientCertAuth, cekSelisihRoutes);
app.use("/api/proses-stok-opname", clientCertAuth, prosesStokOpnameRoutes);
app.use("/api/proses-stok-opname-form", clientCertAuth, prosesStokOpnameFormRoutes);
app.use("/api/pareto", clientCertAuth, paretoRoutes);
app.use('/api/laporan-penjualan-pivot', laporanPenjualanPivotRoutes);
app.use("/api/sales-vs-target", clientCertAuth, salesTargetRoutes);
app.use("/api/monitoring-achievement", clientCertAuth, monitoringAchievementRoutes);
app.use("/api/laporan-stok-pivot", clientCertAuth, laporanStokPivotRoutes);
app.use("/api/laporan-stok-stagnan", clientCertAuth, laporanStokStagnanRoutes);
app.use("/api/laporan-dead-stok", clientCertAuth, laporanDeadStokRoutes);
app.use("/api/laporan-saldo-kasir", clientCertAuth, laporanSaldoKasirRoutes);
app.use("/api/mutasi-antar-gudang", clientCertAuth, mutasiAntarGudangRoutes);
app.use("/api/mutasi-antar-gudang-form", clientCertAuth, mutasiAntarGudangFormRoutes);
app.use("/api/pengajuan-produksi", clientCertAuth, pengajuanProduksiRoutes);
app.use("/api/pengajuan-produksi-form", clientCertAuth, pengajuanProduksiFormRoutes);
app.use("/api/approve-pengajuan-produksi", clientCertAuth, approvePengajuanProduksiRoutes);
app.use("/api/approve-pengajuan-form", clientCertAuth, approvePengajuanProduksiFormRoutes);
app.use("/api/barang-external", clientCertAuth, barangExternalRoutes);
app.use("/api/barang-external-form", clientCertAuth, barangExternalFormRoutes);
app.use("/api/po-kaosan", clientCertAuth, poKaosanRoutes);
app.use("/api/po-kaosan-form", clientCertAuth, poKaosanFormRoutes);
app.use("/api/bpb-kaosan", clientCertAuth, bpbKaosanRoutes);
app.use("/api/bpb-kaosan-form", clientCertAuth, bpbKaosanFormRoutes);
app.use("/api/laporan-hpp-kosong", clientCertAuth, laporanHppKosongRoutes);
app.use("/api/klerek", clientCertAuth, klerekRoutes);
app.use("/api/laporan-stok-minus", clientCertAuth, laporanStokMinusRoutes);
app.use("/api/whatsapp", clientCertAuth, whatsappRoutes);

// Menjalankan Server
app.listen(port, () => {
  console.log(`⚡️[server]: Server berjalan di http://localhost:${port}`);
});
