const service = require('../services/setoranBayarFormService');

const loadForEdit = async (req, res) => {
    try {
        const data = await service.loadForEdit(req.params.nomor, req.user);
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

const searchUnpaidInvoices = async (req, res) => {
    try {
        const { term, page = 1, itemsPerPage = 10, customerKode } = req.query;
        if (!customerKode) {
            return res.status(400).json({ message: 'Kode customer diperlukan.' });
        }
        
        const result = await service.searchUnpaidInvoices(
            term, 
            Number(page), 
            Number(itemsPerPage), 
            customerKode, 
            req.user
        );

        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
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

module.exports = {
    loadForEdit,
    save,
    searchUnpaidInvoices,
    getPrintData,
};

