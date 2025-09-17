const service = require('../services/mutasiStokFormService');

const searchSo = async (req, res) => {
    try {
        const { term, page, itemsPerPage } = req.query;
        const data = await service.searchSo(term, page, itemsPerPage, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const loadFromSo = async (req, res) => {
    try {
        const { nomorSo } = req.params;
        const data = await service.loadFromSo(nomorSo, req.user);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const loadForEdit = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.loadForEdit(nomor, req.user);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        const result = await service.saveData(req.body, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getPrintData = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.getPrintData(nomor);
        res.json(data);
    } catch (error) { res.status(404).json({ message: error.message }); }
};

const exportDetails = async (req, res) => {
    try {
        const data = await service.getExportDetails(req.query);
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {
    searchSo,
    loadFromSo,
    loadForEdit,
    save,
    getPrintData,
    exportDetails,
};

