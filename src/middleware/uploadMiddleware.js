const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Pastikan folder temp ada
const tempDir = path.join(process.cwd(), 'temp');
if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, tempDir);
    },
    filename: function (req, file, cb) {
        // Nama file temporary dengan timestamp
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const tempName = 'temp-' + uniqueSuffix + path.extname(file.originalname);
        cb(null, tempName);
    }
});

const fileFilter = (req, file, cb) => {
    // Accept image files
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('File harus berupa gambar (JPG, PNG, GIF, dll.)'), false);
    }
};

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 1024 * 1024, // 1MB
        files: 1
    },
    fileFilter: fileFilter
});

module.exports = upload;