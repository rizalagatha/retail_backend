const supplierService = require('../services/supplierService');

const getAll = async (req, res) => {
    try {
        const suppliers = await supplierService.getAllSuppliers();
        res.json(suppliers);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        const result = await supplierService.saveSupplier(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { kode } = req.params;
        const result = await supplierService.deleteSupplier(kode);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { getAll, save, remove };