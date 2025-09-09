const soDtfStokService = require('../services/soDtfStokService');

const getAll = async (req, res) => {
    try {
        const data = await soDtfStokService.getList(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await soDtfStokService.getDetails(nomor, req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getCabangList = async (req, res) => {
    try {
        const data = await soDtfStokService.getCabangList(req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const close = async (req, res) => {
    try {
        const result = await soDtfStokService.close(req.body);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await soDtfStokService.remove(nomor, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const exportHeader = async (req, res) => {
    try {
        // Memanggil service untuk mengambil data header sesuai filter
        const data = await soDtfStokService.exportHeader(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const exportDetail = async (req, res) => {
    try {
        // Memanggil service untuk mengambil data detail sesuai filter
        const data = await soDtfStokService.exportDetail(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getAll,
    getDetails,
    getCabangList,
    close,
    remove,
    exportHeader,
    exportDetail,
};
