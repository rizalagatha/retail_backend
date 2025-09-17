const suratJalanService = require('../services/suratJalanService');

const getList = async (req, res) => {
    try {
        const data = await suratJalanService.getList(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await suratJalanService.getDetails(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await suratJalanService.remove(nomor);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getRequestStatus = async(req, res) => {
    try {
        const { nomor } = req.params;
        const data = await suratJalanService.getRequestStatus(nomor);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const submitRequest = async (req, res) => {
    try {
        // Menambahkan kdUser dari token ke dalam payload
        const payload = { ...req.body, kdUser: req.user.id };
        const result = await suratJalanService.submitRequest(payload);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getPrintData = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await suratJalanService.getPrintData(nomor);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const exportDetails = async (req, res) => {
    try {
        const data = await suratJalanService.getExportDetails(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getList,
    getDetails,
    remove,
    getRequestStatus,
    submitRequest,
    getPrintData,
    exportDetails,
};
