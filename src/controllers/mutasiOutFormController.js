const mutasiOutFormService = require('../services/mutasiOutFormService');

const loadForEdit = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await mutasiOutFormService.loadForEdit(nomor, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const searchSo = async (req, res) => {
    try {
        const data = await mutasiOutFormService.searchSo(req.query, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getSoDetailsForGrid = async (req, res) => {
    try {
        const { soNomor } = req.params;
        const data = await mutasiOutFormService.getSoDetailsForGrid(soNomor, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        // Gunakan checkSavePermission middleware jika rute digabung
        const result = await mutasiOutFormService.save(req.body, req.user);
        res.status(req.body.isNew ? 201 : 200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    loadForEdit,
    searchSo,
    getSoDetailsForGrid,
    save,
};