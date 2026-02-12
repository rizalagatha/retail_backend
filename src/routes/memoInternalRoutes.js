const express = require("express");
const router = express.Router();
const controller = require("../controllers/memoInternalController");
const upload = require("../middleware/memoUploadMiddleware");
const { verifyToken } = require("../middleware/authMiddleware");

// Semua user login bisa melihat daftar memo
router.get("/", verifyToken, controller.getList);

// Hanya user KDC yang bisa upload
router.post(
  "/upload",
  verifyToken,
  (req, res, next) => {
    if (req.user.cabang !== "KDC") {
      return res
        .status(403)
        .json({ message: "Hanya manajemen (KDC) yang boleh upload memo." });
    }
    next();
  },
  upload.single("file"),
  controller.handleUpload,
);

module.exports = router;
