const soFormService = require('../services/soFormService');

const getForEdit = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await soFormService.getSoForEdit(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        const result = await soFormService.save(req.body, req.user);
        res.status(req.body.isNew ? 201 : 200).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// --- Controller untuk Form Bantuan ---
const searchCustomers = async (req, res) => { /* ... implementasi ... */ };
const searchPenawaran = async (req, res) => { /* ... implementasi ... */ };
const searchProducts = async (req, res) => { /* ... implementasi ... */ };

module.exports = {
    getForEdit,
    save,
    searchCustomers,
    searchPenawaran,
    searchProducts,
};
