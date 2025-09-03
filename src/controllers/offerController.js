const offerService = require('../services/offerService');

const getOffers = async (req, res) => {
    try {
        const { startDate, endDate, cabang } = req.query;
        if (!startDate || !endDate || !cabang) {
            return res.status(400).json({ message: 'Parameter tanggal dan cabang diperlukan.' });
        }
        const offers = await offerService.getOffers(startDate, endDate, cabang);
        res.json(offers);
    } catch (error) {
        res.status(500).json({ message: 'Terjadi kesalahan di server.' });
    }
};

const getOfferDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const details = await offerService.getOfferDetails(nomor);
        res.json(details);
    } catch (error) {
        console.error(`Error fetching details for offer ${req.params.nomor}:`, error);
        res.status(500).json({ message: 'Terjadi kesalahan di server.' });
    }
};

const getPrintData = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await offerService.getDataForPrinting(nomor);
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json({ message: error.message });
    }
};

const getExportDetails = async (req, res) => {
    try {
        const { startDate, endDate, cabang } = req.query;
        if (!startDate || !endDate || !cabang) {
            return res.status(400).json({ message: 'Parameter tanggal dan cabang diperlukan.' });
        }
        const details = await offerService.getExportDetails(startDate, endDate, cabang);
        res.json(details);
    } catch (error) {
        console.error('Error in getExportDetails controller:', error);
        res.status(500).json({ message: 'Terjadi kesalahan di server.' });
    }
};

const getBranchOptions = async (req, res) => {
    try {
        const { userCabang } = req.query;
        if (!userCabang) {
            return res.status(400).json({ message: 'Parameter userCabang diperlukan.' });
        }
        const branches = await offerService.getBranchOptions(userCabang);
        res.json(branches);
    } catch (error) {
        res.status(500).json({ message: 'Terjadi kesalahan di server.' });
    }
};

const deleteOffer = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await offerService.deleteOffer(nomor);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const closeOffer = async (req, res) => {
    try {
        const { nomor, alasan } = req.body;
        if (!nomor || !alasan) {
            return res.status(400).json({ message: 'Nomor dan alasan diperlukan.' });
        }
        const result = await offerService.closeOffer(nomor, alasan);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getOffers,
    getOfferDetails,
    getPrintData,
    getExportDetails,
    getBranchOptions,
    deleteOffer,
    closeOffer,
};
