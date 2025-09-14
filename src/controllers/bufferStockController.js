const bufferStockService = require('../services/bufferStockService');

const update = async (req, res) => {
    const { pin, updateDc, updateStore } = req.body;

    // Validasi input
    if (!updateDc && !updateStore) {
        return res.status(400).json({ message: 'Pilih cabang yang akan diupdate (DC atau Store).' });
    }
    if (!pin) {
        return res.status(400).json({ message: 'PIN diperlukan.' });
    }
    // PIN di-hardcode sesuai kode Delphi, idealnya ini disimpan di database atau .env
    if (pin !== '123691') { 
        return res.status(401).json({ message: 'PIN salah.' });
    }

    try {
        const result = await bufferStockService.updateBufferStock(updateDc, updateStore);
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Terjadi kesalahan pada server.' });
    }
};

const getAll = async (req, res) => {
    try {
        const data = await bufferStokService.getList(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getCabangList = async (req, res) => {
    try {
        const data = await bufferStokService.getCabangList(req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const saveSetting = async (req, res) => {
    try {
        const result = await bufferStokService.saveSetting(req.body, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    update,
    getAll,
    getCabangList,
    saveSetting,
};
