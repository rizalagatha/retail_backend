const qckeGarmenService = require('../services/qckeGarmenService');

const getMaster = async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Parameter startDate dan endDate dibutuhkan.' });
        }
        const data = await qckeGarmenService.getQCMaster(startDate, endDate);
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ message: 'Server error saat mengambil data master.', error: error.message });
    }
};

const getDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await qckeGarmenService.getQCDetailsByNomor(nomor);
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ message: 'Server error saat mengambil data detail.', error: error.message });
    }
};

const deleteMaster = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await qckeGarmenService.deleteQC(nomor);
        res.status(200).json(result);
    } catch (error) {
        // Cek jika error karena data tidak ditemukan
        if (error.message.includes("tidak ditemukan")) {
            return res.status(404).json({ message: error.message });
        }
        res.status(500).json({ message: 'Server error saat menghapus data.', error: error.message });
    }
};

module.exports = {
    getMaster,
    getDetails,
    deleteMaster,
};