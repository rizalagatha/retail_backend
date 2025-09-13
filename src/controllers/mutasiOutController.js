const mutasiOutService = require('../services/mutasiOutService');

const getAll = async (req, res) => {
    try {
        const data = await mutasiOutService.getList(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await mutasiOutService.getDetails(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getCabangList = async (req, res) => {
    try {
        const data = await mutasiOutService.getCabangList(req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await mutasiOutService.remove(nomor, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    getAll,
    getDetails,
    getCabangList,
    remove,
};
