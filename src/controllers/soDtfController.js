const soDtfService = require('../services/soDtfService');

const getAll = async (req, res) => {
    try {
        if (!req.query.startDate || !req.query.endDate || !req.query.cabang) {
            return res.status(400).json({ message: 'Parameter filter tidak lengkap.' });
        }
        const data = await soDtfService.getSoDtfList(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await soDtfService.getSoDtfDetails(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const close = async (req, res) => {
    try {
        const { nomor, alasan, user } = req.body;
        const result = await soDtfService.closeSoDtf(nomor, alasan, user);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await soDtfService.remove(nomor, req.user);
        res.json(result);
    } catch (error) {
        // Kirim status 400 (Bad Request) untuk error validasi, 500 untuk lainnya
        res.status(error.message.includes('tidak bisa dihapus') || error.message.includes('tidak berhak') ? 400 : 500).json({ message: error.message });
    }
};

const exportHeader = async (req, res) => {
    try {
        const data = await soDtfService.exportHeader(req.query);
        res.json(data); // Kirim sebagai JSON biasa
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const exportDetail = async (req, res) => {
    try {
        const data = await soDtfService.exportDetail(req.query);
        res.json(data); // Kirim sebagai JSON biasa
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getAll,
    getDetails,
    close,
    remove,
    exportHeader,
    exportDetail,  
};
