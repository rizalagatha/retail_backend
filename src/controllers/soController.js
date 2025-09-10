const soService = require('../services/soService');

const getAll = async (req, res) => {
    try {
        const data = await soService.getList(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await soService.getDetails(nomor, req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getCabangList = async (req, res) => {
    try {
        const data = await soService.getCabangList(req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const close = async (req, res) => {
    try {
        const result = await soService.close(req.body);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await soService.remove(nomor, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getPrintData = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await soService.getDataForPrint(nomor);
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {
    getAll,
    getDetails,
    getCabangList,
    close,
    remove,
    getPrintData,
};
