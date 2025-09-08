const dasborDtfService = require('../services/dasborDtfService');

const getDasborData = async (req, res) => {
    try {
        const data = await dasborDtfService.getDasborData(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDasborDetail = async (req, res) => {
    try {
        const { tanggal, cabang } = req.query;

        // Tambahkan blok validasi ini
        if (!tanggal || !cabang) {
            return res.status(400).json({ message: 'Parameter "tanggal" dan "cabang" diperlukan.' });
        }

        const data = await dasborDtfService.getDasborDetail(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getCabangList = async (req, res) => {
    try {
        const data = await dasborDtfService.getCabangList(req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const exportHeader = async (req, res) => {
    try {
        const data = await dasborDtfService.exportHeader(req.query);
        res.json(data); // Mengirim data JSON ke frontend
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const exportDetail = async (req, res) => {
    try {
        const data = await dasborDtfService.exportDetail(req.query);
        res.json(data); // Mengirim data JSON ke frontend
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getDasborData,
    getDasborDetail,
    getCabangList,
    exportHeader,
    exportDetail,
};
