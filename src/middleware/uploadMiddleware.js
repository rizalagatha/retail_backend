const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Pastikan folder temp ada
const tempDir = path.join(process.cwd(), "temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, tempDir);
  },
  filename: function (req, file, cb) {
    // Nama file temporary dengan timestamp
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const tempName = "temp-" + uniqueSuffix + path.extname(file.originalname);
    cb(null, tempName);
  },
});

const fileFilter = (req, file, cb) => {
  // [PERBAIKAN 1] Izinkan file gambar ATAU PDF
  if (
    file.mimetype.startsWith("image/") ||
    file.mimetype === "application/pdf"
  ) {
    cb(null, true);
  } else {
    cb(
      new Error("File harus berupa gambar (JPG, PNG) atau dokumen PDF."),
      false,
    );
  }
};

const upload = multer({
  storage: storage,
  limits: {
    // [PERBAIKAN 2] Samakan dengan frontend (2MB)
    fileSize: 2 * 1024 * 1024,

    // [PERBAIKAN 3] Izinkan maksimal 50 file sekaligus per 1 kali simpan form
    files: 50,
  },
  fileFilter: fileFilter,
});

module.exports = upload;
