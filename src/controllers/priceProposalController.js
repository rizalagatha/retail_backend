const priceProposalService = require('../services/priceProposalService');

const getAll = async (req, res) => {
    try {
        // Ambil filter dari query string
        const filters = {
            startDate: req.query.startDate,
            endDate: req.query.endDate,
            cabang: req.query.cabang,
            // Ubah string 'true'/'false' menjadi boolean
            belumApproval: req.query.belumApproval === 'true'
        };

        if (!filters.startDate || !filters.endDate || !filters.cabang) {
            return res.status(400).json({ message: 'Parameter tanggal dan cabang diperlukan.' });
        }

        const proposals = await priceProposalService.getPriceProposals(filters);
        res.json(proposals);
    } catch (error) {
        console.error('Error in getPriceProposals controller:', error);
        res.status(500).json({ message: 'Terjadi kesalahan di server.' });
    }
};

const getDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const details = await priceProposalService.getProposalDetails(nomor);
        res.json(details);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const remove = async (req, res) => {
    try {
        const { nomor } = req.params;
        const result = await priceProposalService.deleteProposal(nomor);
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};


module.exports = {
    getAll,
    getDetails,
    remove,
};