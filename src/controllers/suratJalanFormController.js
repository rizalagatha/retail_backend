const sjFormService = require('../services/suratJalanFormService');

const getLookupData = async (req, res) => {
    try {
        const { type } = req.params;
        const data = await sjFormService.getLookupData(type, req.user, req.query);
        res.json(data);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

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

const searchStore = async (req, res) => {
    try {
        const { term, page = 1, itemsPerPage = 10 } = req.query;
        const result = await suratJalanFormService.searchStore(term, Number(page), Number(itemsPerPage));
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getLookupData,
    getItemsForLoad,
    save,
    loadForEdit,
    searchStore,
};
