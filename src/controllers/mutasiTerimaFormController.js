const service = require('../services/mutasiTerimaFormService');

const loadFromKirim = async (req, res) => {
    try {
        const data = await service.loadFromKirim(req.params.nomorKirim);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        const result = await service.save(req.body, req.user);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = { loadFromKirim, save };