const salesCounterService = require('../services/salesCounterService');

const getAll = async (req, res) => {
    try {
        const salesCounter = await salesCounterService.getAllSalesCounters();
        res.json(salesCounter);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        const result = await salesCounterService.saveSalesCounter(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { kode } = req.params;
        const result = await salesCounterService.deleteSalesCounter(kode);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getAll, save, remove };