const service = require('../services/mutasiInFormService');

const save = async (req, res) => {
    try {
        const result = await service.saveData(req.body, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const loadFromMo = async (req, res) => {
    try {
        const data = await service.loadFromMo(req.params.nomor, req.user);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const loadForEdit = async (req, res) => {
    try {
        const data = await service.loadForEdit(req.params.nomor, req.user);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const getPrintData = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.getPrintData(nomor);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const searchMutasiOut = async (req, res) => {
    try {
        const { term, page = 1, itemsPerPage = 10 } = req.query;
        const result = await service.searchMutasiOut(term, Number(page), Number(itemsPerPage), req.user);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const exportDetails = async (req, res) => {
    try {
        const data = await service.getExportDetails(req.query);
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = { 
    save,
    loadFromMo,
    loadForEdit,
    getPrintData,
    searchMutasiOut,
    exportDetails,
};
