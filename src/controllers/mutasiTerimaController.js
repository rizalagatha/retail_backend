const service = require('../services/mutasiTerimaService');

const getList = async (req, res) => {
    try {
        const data = await service.getList(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.getDetails(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const cancelReceipt = async (req, res) => {
    try {
        // 'nomor' di sini adalah nomor PENGIRIMAN (msk_nomor)
        const result = await service.cancelReceipt(req.params.nomor, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = { 
    getList, 
    getDetails, 
    cancelReceipt 
};