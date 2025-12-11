const packageJson = require('../../package.json');
// Pastikan path ini benar mengarah ke file changelog.js Anda
const changelogs = require('../config/changelog'); 

const checkHealth = async (req, res) => {
    const currentVer = packageJson.version;
    
    // [FIX] Ambil property .changes karena struktur data sekarang { date: '...', changes: [...] }
    // Gunakan optional chaining (?.) untuk keamanan jika versi tidak ditemukan
    const versionData = changelogs[currentVer];
    const currentChangelog = versionData?.changes || ["Perbaikan sistem dan peningkatan performa."];

    res.status(200).json({ 
        status: 'ok', 
        message: 'Server is running', 
        version: currentVer,
        
        // Kirim array changes ke frontend
        changes: currentChangelog, 
        
        // Opsional: Kirim tanggal update juga jika mau ditampilkan
        date: versionData?.date || '-',
        
        timestamp: new Date() 
    });
};

module.exports = { checkHealth };