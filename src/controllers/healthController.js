const packageJson = require('../../package.json');
const changelogs = require('../config/changelog'); // Import file tadi

const checkHealth = async (req, res) => {
    const currentVer = packageJson.version;
    
    // Ambil deskripsi perubahan untuk versi yang sedang aktif di server
    const currentChangelog = changelogs[currentVer] || ["Perbaikan sistem dan peningkatan performa."];

    res.status(200).json({ 
        status: 'ok', 
        message: 'Server is running', 
        version: currentVer,
        // Kirim data changelog ke frontend
        changes: currentChangelog, 
        timestamp: new Date() 
    });
};

module.exports = { checkHealth };