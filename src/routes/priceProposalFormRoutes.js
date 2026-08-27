const express = require("express");
const router = express.Router();
const priceProposalFormController = require("../controllers/priceProposalFormController");
const upload = require("../middleware/uploadMiddleware");
const {
  verifyToken,
  checkPermission,
  checkInsertOrEditPermission,
} = require("../middleware/authMiddleware");

// Definisikan ID Menu untuk Pengajuan Harga
const PRICE_PROPOSAL_MENU_ID = 38;

// Middleware untuk rute /save yang menangani 'insert' dan 'edit'
const checkSavePermission = (req, res, next) => {
  // Ambil flag isNew dari body. Jika tidak ada, anggap sebagai insert.
  const action = req.body.isNew === false ? "edit" : "insert";

  // Jalankan middleware checkPermission yang sudah ada dengan aksi yang benar
  return checkPermission(PRICE_PROPOSAL_MENU_ID, action)(req, res, next);
};

// --- RUTE YANG SUDAH DIAMANKAN ---

// Butuh hak 'insert' ATAU 'edit' untuk mengakses data bantuan form
router.get(
  "/search-tshirt-types",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.searchTshirtTypes,
);
router.get(
  "/tshirt-type-details",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.getTshirtTypeDetails,
);
router.get(
  "/get-discount",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.getDiscount,
);
router.get(
  "/search-products-by-type",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.searchProductsByType,
);
router.get(
  "/search-additional-costs",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.searchAdditionalCosts,
);

router.get(
  "/edit-details/:nomor",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.getForEdit,
);

// Hanya butuh hak 'insert' untuk mendapatkan nomor baru
router.get(
  "/next-number",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "insert"),
  priceProposalFormController.getNextNumber,
);

router.get(
  "/branch-info-print",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.getBranchInfoForPrint,
);

router.post(
  "/upload-acc-customer/:nomor",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  upload.single("image"),
  priceProposalFormController.uploadAccCustomerProof,
);

router.get(
  "/sublim/kain-options",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.getSublimKainOptions,
);
router.get(
  "/sublim/jenis-jersey-options",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.getSublimJenisJerseyOptions,
);
router.get(
  "/sublim/katalog",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.getSublimKatalog,
);
router.post(
  "/sublim/preview-harga",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.previewSublimHarga,
);
router.get(
  "/sublim/katalog-by-kategori",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  priceProposalFormController.getSublimKatalogByKategori,
);
router.post(
  "/sublim/upload-design/:nomor",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  upload.single("image"),
  priceProposalFormController.uploadSublimDesign,
);

// Hanya butuh hak 'edit' untuk memuat data lama
router.get(
  "/:nomor",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  priceProposalFormController.getForEdit,
);

// Rute 'save' dan 'upload' membutuhkan hak 'insert' ATAU 'edit'
router.post(
  "/save",
  verifyToken,
  checkSavePermission,
  priceProposalFormController.save,
);
router.post(
  "/upload-image/:nomor",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "edit"),
  upload.single("image"),
  priceProposalFormController.uploadImage,
);
router.post(
  "/sublim/upload-mockup/:nomor",
  verifyToken,
  checkInsertOrEditPermission(PRICE_PROPOSAL_MENU_ID),
  upload.single("image"),
  priceProposalFormController.uploadSublimMockup,
);

module.exports = router;
