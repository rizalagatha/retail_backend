// di file: src/middleware/uploadMiddleware.js
const multer = require('multer');
const path = require('path');

// Tentukan folder penyimpanan
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Simpan file di folder public/images
        cb(null, path.join(__dirname, '..', 'public', 'images'));
    },
    filename: function (req, file, cb) {
        // Beri nama sementara dengan timestamp. Kita akan rename nanti.
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

module.exports = upload;