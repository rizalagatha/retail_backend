const settingHargaService = require('../services/settingHargaService');

const getAll = async (req, res) => {
    try {
        const data = await settingHargaService.getAllTshirtTypes();
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getUkuranTemplate = async (req, res) => {
    try {
        const data = await settingHargaService.getUkuranTemplate();
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetails = async (req, res) => {
    try {
        const { jenisKaos, custom } = req.params;
        const data = await settingHargaService.getTshirtTypeDetails(jenisKaos, custom);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        const result = await settingHargaService.saveTshirtType(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { jenisKaos, custom } = req.body;
        const result = await settingHargaService.deleteTshirtType(jenisKaos, custom);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const searchJenisKaos = async (req, res) => {
    try {
        const result = await settingHargaService.searchJenisKaosFromBarang();
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mencari Jenis Kaos.' });
    }
};

module.exports = {
    getAll,
    getUkuranTemplate,
    getDetails,
    save,
    remove,
    searchJenisKaos,
};
