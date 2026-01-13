const express = require("express");
const router = express.Router();
const controller = require("../controllers/invoiceFormController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const MENU_ID = "27";

// Middleware khusus untuk memvalidasi izin simpan (insert/edit)
const checkSavePermission = (req, res, next) => {
  const action = req.body.isNew ? "insert" : "edit";
  return checkPermission(MENU_ID, action)(req, res, next);
};

// --- ROUTES ---

// Memuat data Invoice yang sudah ada untuk mode "Ubah"
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "edit"),
  controller.loadForEdit
);

router.get(
  "/print/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintData
);

router.get(
  "/print-kasir/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getPrintDataKasir
);

router.get("/print-sj/:nomor", verifyToken, controller.getDataForSjPrint);

// --- LOOKUP ROUTES ---
// Mencari SO yang valid untuk diinput
router.get(
  "/lookup/so",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchSo
);

router.get(
  "/lookup/promo",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchPromo
);

router.get(
  "/lookup/member/:hp",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getMemberByHp
);

router.get(
  "/lookup/default-customer",
  verifyToken,
  controller.getDefaultCustomer
);

router.get("/lookup/so-dtf", verifyToken, controller.searchSoDtf);

router.get(
  "/lookup/so-dtf-details/:nomor",
  verifyToken,
  controller.getSoDtfDetails
);

router.get("/lookup/retur-jual", verifyToken, controller.searchReturJual);

router.get(
  "/lookup/discount-rule/:customerKode",
  verifyToken,
  controller.getDiscountRule
);

// Endpoint lookup sisa piutang customer
router.get('/lookup/customer-debt/:kode', verifyToken, controller.getCustomerDebt);

router.get("/lookup/active-promos", verifyToken, controller.getActivePromos);

router.get('/lookup/promo-items/:nomorPromo', verifyToken, controller.getPromoItems);

router.get('/lookup/promo/:nomorPromo', verifyToken, controller.getPromoHeader);

router.put("/update-header/:nomor", verifyToken, controller.updateInvoiceHeaderOnly);

// Mengambil detail item dari SO yang dipilih untuk mengisi grid
router.get(
  "/lookup/so-details/:soNomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSoDetailsForGrid
);

router.get(
  "/lookup/sales-counters",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSalesCounters
);

router.get("/by-barcode/:barcode", verifyToken, controller.getByBarcode);

router.get(
  "/lookup/products",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchProducts
);

// Lookup SJ khusus cabang KPR
router.get(
  "/lookup/sj-list",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchSj
);

router.get(
  "/lookup/sj-details/:nomor",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.getSjDetails
);

// Mencari DP (Setoran) yang belum lunas milik customer
router.get(
  "/lookup/unpaid-dp/:customerKode",
  verifyToken,
  checkPermission(MENU_ID, "view"),
  controller.searchUnpaidDp
);

router.get(
  "/lookup/promo-bonus/:promoNomor",
  verifyToken,
  controller.getPromoBonusItems
);

router.get(
  "/lookup/applicable-item-promo",
  verifyToken,
  controller.getApplicableItemPromo
);

router.get("/check-printables/:nomor", verifyToken, controller.checkPrintables);

router.get("/print-kupon/:nomor", verifyToken, controller.getKuponPrintData);

router.get(
  "/print-voucher/:nomor",
  verifyToken,
  controller.getVoucherPrintData
);

// Menyimpan data (baru atau yang diubah)
router.post("/save", verifyToken, checkSavePermission, controller.save);

router.post(
  "/save-member",
  verifyToken,
  checkPermission(MENU_ID, "insert"),
  controller.saveMember
);

router.post("/save-satisfaction", verifyToken, controller.saveSatisfaction);

router.post("/validate-voucher", verifyToken, controller.validateVoucher);

module.exports = router;
