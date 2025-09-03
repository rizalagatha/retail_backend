const barcodeService = require('../services/barcodeService');

const getHeaders = async (req, res) => {
    try {
        const { startDate, endDate, cabang } = req.query;
        if (!startDate || !endDate || !cabang) {
            return res.status(400).json({ message: 'Parameter tanggal dan cabang diperlukan.' });
        }
        const headers = await barcodeService.getBarcodeHeaders(startDate, endDate, cabang);
        res.json(headers);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const details = await barcodeService.getBarcodeDetails(nomor);
        res.json(details);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getHeaders,
    getDetails,
};
