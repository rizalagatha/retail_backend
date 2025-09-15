const mintaBarangFormService = require('../services/mintaBarangFormService');

const loadForEdit = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await mintaBarangFormService.loadForEdit(nomor, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const searchSo = async (req, res) => {
    try {
        const data = await mintaBarangFormService.searchSo(req.query, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getSoDetailsForGrid = async (req, res) => {
    try {
        const { soNomor } = req.params;
        const data = await mintaBarangFormService.getSoDetailsForGrid(soNomor, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getBufferStokItems = async (req, res) => {
    try {
        const data = await mintaBarangFormService.getBufferStokItems(req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        const result = await mintaBarangFormService.save(req.body, req.user);
        res.status(req.body.isNew ? 201 : 200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getProductDetails = async (req, res) => {
    try {
        // req.query akan berisi { kode: '...', ukuran: '...' }
        const data = await mintaBarangFormService.getProductDetailsForGrid(req.query, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    loadForEdit,
    searchSo,
    getSoDetailsForGrid,
    getBufferStokItems,
    save,
    getProductDetails,
};
