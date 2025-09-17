const service = require('../services/mutasiInFormService');

const getPrintData = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.getPrintData(nomor);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

module.exports = { 
    getPrintData,
};
