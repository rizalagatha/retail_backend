const service = require('../services/pengajuanProduksiService');

const getList = async (req, res) => {
    try {
        const data = await service.getList(req.query, req.user);
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
const deletePengajuan = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await service.deletePengajuan(nomor, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};
const exportDetails = async (req, res) => {
    try {
        const data = await service.getExportDetails(req.query, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getList,
    getDetails,
    deletePengajuan,
    exportDetails,
};