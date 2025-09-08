const lhkSoDtfService = require('../services/lhkSoDtfService');

const getAll = async (req, res) => {
    try {
        const data = await lhkSoDtfService.getLhkList(req.query);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getCabangList = async (req, res) => {
    try {
        const data = await lhkSoDtfService.getCabangList(req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const result = await lhkSoDtfService.remove(req.query, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

module.exports = {
    getAll,
    getCabangList,
    remove,
};
