const service = require('../services/mutasiKirimService');

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
        const { nomor } = req.params;
        const data = await service.getDetails(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await service.remove(nomor, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    getCabangList,
    getList,
    getDetails,
    remove,
};

