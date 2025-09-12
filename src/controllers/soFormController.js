const soFormService = require('../services/soFormService');

const getForEdit = async (req, res) => {
    try {
        const { nomor } = req.params;
        // Panggil fungsi service yang sudah kita buat
        const data = await soFormService.getSoForEdit(nomor);
        if (data) {
            res.json(data);
        } else {
            res.status(404).json({ message: 'Data Surat Pesanan tidak ditemukan.' });
        }
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

const getDefaultDiscount = async (req, res) => {
    try {
        const { level, total, gudang } = req.query;
        const levelCode = level ? level.split(' - ')[0] : '';
        const result = await soFormService.getDefaultDiscount(levelCode, total, gudang);
        res.json(result);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const searchSetoran = async (req, res) => {
    try {
        const data = await soFormService.searchAvailableSetoran(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const saveDp = async (req, res) => {
    try {
        const result = await soFormService.saveNewDp(req.body, req.user);
        res.status(201).json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const searchRekening = async (req, res) => {
    try {
        const data = await soFormService.searchRekening(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDpPrintData = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await soFormService.getDataForDpPrint(nomor);
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};


module.exports = {
    getForEdit,
    save,
    searchPenawaran,
    getPenawaranDetails,
    getDefaultDiscount,
    searchSetoran,
    saveDp,
    searchRekening, 
    getDpPrintData,
    // ...
};
