const service = require('../services/setoranBayarService');

const getCabangList = async (req, res) => {
    try {
        const data = await service.getCabangList(req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

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
        const data = await service.getDetails(req.params.nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const result = await service.remove(req.params.nomor, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const exportDetails = async (req, res) => {
    try {
        const data = await service.getExportDetails(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getCabangList,
    getList,
    getDetails,
    remove,
    exportDetails,
};

