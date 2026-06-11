const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const USER_MENU_ID = 1;

const checkSavePermission = (req, res, next) => {
  const action = req.body.isNewUser ? "insert" : "edit";
  return checkPermission(USER_MENU_ID, action)(req, res, next);
};

// --- Rute data pendukung (tidak butuh permission ketat) ---
router.get(
  "/available-for-sc",
  verifyToken,
  userController.getAvailableForSalesCounter,
);

// [BARU] Daftar user per cabang — untuk fitur copy permission
router.get("/users-by-cabang", verifyToken, userController.getUsersByCabang);

// [BARU] Ambil template permission dari user referensi
router.get("/template", verifyToken, userController.getTemplate);

// [BARU] Deteksi menu baru yang belum dikonfigurasi
router.get("/new-menus", verifyToken, userController.getNewMenus);

router.post(
  "/apply-new-menus",
  verifyToken,
  checkPermission("1", "edit"),
  userController.applyNewMenusToUsers,
);

// --- Rute utama ---
router.get(
  "/",
  verifyToken,
  checkPermission(USER_MENU_ID, "view"),
  userController.getAll,
);
router.get(
  "/branches",
  verifyToken,
  checkPermission(USER_MENU_ID, "view"),
  userController.getBranches,
);
router.get(
  "/menus",
  verifyToken,
  checkPermission(USER_MENU_ID, "view"),
  userController.getMenus,
);

router.post("/save", verifyToken, checkSavePermission, userController.save);
router.post("/change-password", verifyToken, userController.updatePassword);

router.delete(
  "/delete",
  verifyToken,
  checkPermission(USER_MENU_ID, "delete"),
  userController.remove,
);

// Rute dinamis — harus di paling bawah agar tidak bentrok dengan rute statis di atas
router.get(
  "/:kode/:cabang",
  verifyToken,
  checkPermission(USER_MENU_ID, "view"),
  userController.getDetails,
);

module.exports = router;
