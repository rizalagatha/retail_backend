const service = require('../services/whatsappService');

const sendReceipt = async (req, res) => {
    try {
        const { nomor, hp } = req.body;
        const cabang = req.user.cabang;
        if (!nomor || !hp) {
            return res.status(400).json({ message: 'Nomor invoice dan nomor HP diperlukan.' });
        }
        // Ambil token dari header otorisasi
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) {
            return res.status(401).json({ message: 'Token otorisasi tidak ditemukan.' });
        }

        const result = await service.sendReceipt(cabang, nomor, hp, token); // Teruskan token ke service
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: `Gagal mengirim WhatsApp: ${error.message}` });
    }
};

const getQr = (req, res) => {
    const cabang = req.user.cabang;
    const qr = service.getQrCode(cabang);
    if (qr) {
        res.json({ qrDataUrl: qr });
    } else {
        // Jika tidak ada QR, picu pembuatan client baru
        service.getClient(req.user.cabang);
        res.status(202).json({ message: 'Sedang membuat sesi baru, silakan coba lagi dalam beberapa detik.' });
    }
};

module.exports = { sendReceipt, getQr };