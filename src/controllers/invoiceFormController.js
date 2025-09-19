const service = require('../services/invoiceFormService');

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

const searchSo = async (req, res) => {
    try {
        // Ambil dan konversi parameter dari query string
        const { term, page = 1, itemsPerPage = 10 } = req.query;
        const data = await service.searchSo(
            term, 
            Number(page), 
            Number(itemsPerPage), 
            req.user
        );
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getSoDetailsForGrid = async (req, res) => {
    try {
        const { soNomor } = req.params;
        const data = await service.getSoDetailsForGrid(soNomor, req.user);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const searchCustomer = async (req, res) => {
    try {
        const data = await service.searchCustomer(req.query, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const searchRekening = async (req, res) => {
    try {
        const data = await service.searchRekening(req.query, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const searchUnpaidDp = async (req, res) => {
    try {
        const { customerKode } = req.params;
        const data = await service.searchUnpaidDp(customerKode, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getSalesCounters = async (req, res) => {
    try {
        const data = await service.getSalesCounters();
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

module.exports = {
    loadForEdit,
    save,
    searchSo,
    getSoDetailsForGrid,
    searchCustomer,
    searchRekening,
    searchUnpaidDp,
    getSalesCounters,
};

