const sjFormService = require('../services/suratJalanFormService');

const getItemsForLoad = async (req, res) => {
    try {
        const { nomor, gudang } = req.query;
        if (!nomor || !gudang) {
            return res.status(400).json({ message: 'Nomor dan Gudang diperlukan.'});
        }
        const data = await sjFormService.getItemsForLoad(nomor, gudang);
        res.json(data);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        const result = await sjFormService.saveData(req.body, req.user);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const loadForEdit = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await sjFormService.loadForEdit(nomor, req.user);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const searchStores = async (req, res) => {
    try {
        const { term, page, itemsPerPage, excludeBranch } = req.query;
        const data = await sjFormService.searchStores(term, page, itemsPerPage, excludeBranch);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const searchPermintaan = async (req, res) => {
    try {
        const { term, page = 1, itemsPerPage = 10, storeKode } = req.query;
        if (!storeKode) {
            return res.status(400).json({ message: 'Kode store diperlukan.' });
        }
        const result = await sjFormService.searchPermintaan(term, Number(page), Number(itemsPerPage), storeKode);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const searchTerimaRb = async (req, res) => {
    try {
        const { term, page = 1, itemsPerPage = 10 } = req.query;
        const result = await sjFormService.searchTerimaRb(term, Number(page), Number(itemsPerPage), req.user);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getByBarcode = async (req, res) => {
    try {
        const { barcode } = req.params;
        const { gudang } = req.query; // Gudang diambil dari query parameter
        if (!gudang) {
            return res.status(400).json({ message: 'Parameter gudang diperlukan.' });
        }
        const product = await sjFormService.findByBarcode(barcode, gudang);
        res.json(product);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

module.exports = {
    getItemsForLoad,
    save,
    loadForEdit,
    searchStores,
    searchPermintaan,
    searchTerimaRb,
    getByBarcode,
};
