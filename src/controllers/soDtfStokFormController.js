const upload = require('../middleware/uploadMiddleware');
const soDtfStokFormService = require('../services/soDtfStokFormService');
const fs = require('fs');

const getTemplateItems = async (req, res) => {
    try {
        const { jenisOrder } = req.params;
        const data = await soDtfStokFormService.getTemplateItems(jenisOrder);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const loadDataForEdit = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await soDtfStokFormService.loadDataForEdit(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const saveData = async (req, res) => {
    try {
        const { nomor } = req.params; // Bisa undefined untuk data baru
        const result = await soDtfStokFormService.saveData(nomor, req.body, req.user);
        res.status(nomor ? 200 : 201).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const searchJenisOrderStok = async (req, res) => {
    try {
        const { term } = req.query;
        const data = await soDtfStokFormService.searchJenisOrderStok(term);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const uploadImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Tidak ada file yang diunggah.' });
        }
        
        const { nomor } = req.params;
        if (!nomor) {
            fs.unlinkSync(req.file.path); 
            return res.status(400).json({ message: 'Nomor SO DTF Stok diperlukan.' });
        }

        const finalPath = await soDtfStokFormService.processSoDtfStokImage(req.file.path, nomor);
        res.status(200).json({ message: 'Gambar berhasil diunggah.', filePath: finalPath });
    } catch (error) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getTemplateItems,
    loadDataForEdit,
    saveData,
    searchJenisOrderStok,
    uploadImage,
};
