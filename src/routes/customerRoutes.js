const express = require("express");
const router = express.Router();
const customerController = require("../controllers/customerController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

// Definisikan ID Menu untuk Customer
const CUSTOMER_MENU_ID = 9;

/*
 * Middleware khusus untuk rute /save
 * Rute ini menangani 'insert' (jika data baru) dan 'edit' (jika data lama).
 * Middleware ini akan memeriksa izin yang sesuai berdasarkan data yang dikirim.
 */
const checkSavePermission = (req, res, next) => {
  // Jika body request memiliki 'kode', berarti ini adalah operasi 'edit'.
  // Jika tidak, ini adalah operasi 'insert'.
  const action = req.body.kode ? "edit" : "insert";

  // Jalankan middleware checkPermission dengan aksi yang dinamis
  return checkPermission(CUSTOMER_MENU_ID, action)(req, res, next);
};

// --- Penerapan Middleware pada Rute ---

// Rute Spesifik
// Untuk mendapatkan data pendukung form (next-code, levels),
// user setidaknya harus punya hak 'view' untuk membuka form-nya.
router.get(
  "/next-code",
  verifyToken,
  checkPermission(CUSTOMER_MENU_ID, "view"),
  customerController.getNextCode
);
router.get(
  "/levels",
  verifyToken,
  checkPermission(CUSTOMER_MENU_ID, "view"),
  customerController.getLevels
);

// Rute Umum
// Membutuhkan hak 'view' untuk melihat daftar semua customer
router.get(
  "/",
  verifyToken,
  checkPermission(CUSTOMER_MENU_ID, "view"),
  customerController.getAll
);

router.post(
  "/",
  verifyToken,
  checkPermission(CUSTOMER_MENU_ID, "insert"),
  customerController.create
); // POST ke /api/customers untuk membuat data baru
router.put(
  "/:kode",
  verifyToken,
  checkPermission(CUSTOMER_MENU_ID, "edit"),
  customerController.update
); // PUT ke /api/customers/K0300197 untuk mengubah

// Rute Dinamis
// Membutuhkan hak 'delete' untuk menghapus
router.delete(
  "/:kode",
  verifyToken,
  checkPermission(CUSTOMER_MENU_ID, "delete"),
  customerController.remove
);

// Membutuhkan hak 'view' untuk melihat detail satu customer
router.get(
  "/:kode",
  verifyToken,
  checkPermission(CUSTOMER_MENU_ID, "view"),
  customerController.getDetails
);

module.exports = router;
