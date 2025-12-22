const express = require("express");
const router = express.Router();
const hrdController = require("../controllers/hrdController");
const { verifyToken } = require("../middleware/authMiddleware");

// Route: GET /api/hrd/karyawan/:nik
router.get("/karyawan/:nik", verifyToken, hrdController.checkKaryawan);

router.get("/search", verifyToken, hrdController.searchKaryawan);

module.exports = router;
