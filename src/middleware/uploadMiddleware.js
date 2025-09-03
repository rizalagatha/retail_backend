const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Tentukan direktori penyimpanan
const storageDir = path.join(__dirname, '../../public/images/proposals');

// Pastikan direktori ada, jika tidak, buatkan
if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
}

// Konfigurasi Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, storageDir);
    },
    filename: (req, file, cb) => {
        // Ambil nomor pengajuan dari body request
        const proposalNumber = req.body.nomor;
        // Simpan file dengan nama [nomor_pengajuan].jpg
        const fileName = `${proposalNumber}${path.extname(file.originalname)}`;
        cb(null, fileName);
    }
});

const upload = multer({ 
    storage: storage,
    limits: { fileSize: 500 * 1024 } // Batas 500 KB, sama seperti di Delphi
});

module.exports = upload;
