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

module.exports = {
    getAll,
};