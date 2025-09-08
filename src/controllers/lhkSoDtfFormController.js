const lhkSoDtfFormService = require('../services/lhkSoDtfFormService');

const loadData = async (req, res) => {
    try {
        const { tanggal, cabang } = req.params;
        const data = await lhkSoDtfFormService.loadData(tanggal, cabang);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const searchSoPo = async (req, res) => {
    try {
        const { term, cabang } = req.query;
        const data = await lhkSoDtfFormService.searchSoPo(term, cabang);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const saveData = async (req, res) => {
    try {
        const result = await lhkSoDtfFormService.saveData(req.body, req.user);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    loadData,
    searchSoPo,
    saveData,
};
