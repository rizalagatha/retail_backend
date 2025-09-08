const soDtfStokFormService = require('../services/soDtfStokFormService');

const getTemplateItems = async (req, res) => {
    try {
        const { jenisOrder } = req.params;
        const data = await soDtfStokFormService.getTemplateItems(jenisOrder);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const loadDataForEdit = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await soDtfStokFormService.loadDataForEdit(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const saveData = async (req, res) => {
    try {
        const { nomor } = req.params; // Bisa undefined untuk data baru
        const result = await soDtfStokFormService.saveData(nomor, req.body, req.user);
        res.status(nomor ? 200 : 201).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    getTemplateItems,
    loadDataForEdit,
    saveData,
};
