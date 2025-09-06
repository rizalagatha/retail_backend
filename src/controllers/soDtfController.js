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

// Tambahkan fungsi untuk delete jika diperlukan
// const remove = ...

module.exports = {
    getAll,
    getDetails,
    close,
};
