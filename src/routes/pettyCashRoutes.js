const express = require("express");
const router = express.Router();
const pettyCashController = require("../controllers/pettyCashController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

// 1. Ambil List Data untuk Browse
router.get("/", verifyToken, pettyCashController.getList);

router.get("/drafts-klaim", verifyToken, pettyCashController.getDraftsForKlaim);

router.put("/acc-klaim/:pck_nomor", verifyToken, pettyCashController.accKlaim);

router.get(
  "/klaim-finance",
  verifyToken,
  pettyCashController.getListKlaimFinance,
);
router.get(
  "/klaim-finance/detail/:pck_nomor",
  verifyToken,
  pettyCashController.getDetailKlaimFinance,
);
router.get(
  "/klaim-finance/proses/:pck_nomor",
  verifyToken,
  pettyCashController.getKlaimKolektifDetail,
);
router.put(
  "/klaim-finance/approve/:pck_nomor",
  verifyToken,
  pettyCashController.approveKlaimKolektif,
);
router.put(
  "/receive-klaim/:pck_nomor",
  verifyToken,
  pettyCashController.receiveKlaim,
);
router.put(
  "/klaim-finance/reject/:pck_nomor",
  verifyToken,
  pettyCashController.rejectKlaimKolektif,
);
router.put(
  "/klaim-finance/reject-item/:pck_nomor/:pc_nomor",
  verifyToken,
  pettyCashController.rejectSinglePc,
);

router.put("/submit/:nomor", verifyToken, pettyCashController.submitData);

router.post(
  "/submit-klaim",
  verifyToken,
  pettyCashController.submitKlaimKolektif,
);

router.put(
  "/klaim/:pck_nomor/transfer",
  verifyToken,
  pettyCashController.transferKlaim,
);

router.delete("/:nomor", verifyToken, pettyCashController.deleteData);

router.post("/close/:nomor", verifyToken, pettyCashController.closeData);

module.exports = router;
