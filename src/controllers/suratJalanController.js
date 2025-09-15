const suratJalanService = require('../services/suratJalanService');

const getAll = async (req, res) => {
    try {
        const data = await suratJalanService.getList(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await suratJalanService.getDetails(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await suratJalanService.remove(nomor, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const requestChange = async (req, res) => {
    try {
        const result = await suratJalanService.requestChange(req.body, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    getAll,
    getDetails,
    remove,
    requestChange,
};
