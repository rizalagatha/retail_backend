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

const searchPenawaran = async (req, res) => {
    try {
        const data = await soFormService.searchAvailablePenawaran(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getPenawaranDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await soFormService.getPenawaranDetailsForSo(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getForEdit,
    save,
    searchPenawaran,
    getPenawaranDetails,
};
