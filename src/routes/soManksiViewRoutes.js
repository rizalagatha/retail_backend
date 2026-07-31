const express = require("express");
const router = express.Router();
const soManksiViewController = require("../controllers/soManksiViewController");
const {
  verifyToken,
  checkPermission,
} = require("../middleware/authMiddleware");

const PRICE_PROPOSAL_MENU_ID = 38; // reuse permission gate Pengajuan Harga

router.get(
  "/:nomor",
  verifyToken,
  checkPermission(PRICE_PROPOSAL_MENU_ID, "view"),
  soManksiViewController.getDetail,
);

module.exports = router;
