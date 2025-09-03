const warehouseService = require('../services/warehouseService');

const search = async (req, res) => {
    try {
        // Ambil parameter dengan nilai default untuk paginasi
        const { term = '', userCabang, page = '1', itemsPerPage = '10' } = req.query;

        // Validasi wajib untuk userCabang
        if (!userCabang) {
            return res.status(400).json({ message: 'Parameter userCabang diperlukan.' });
        }

        const pageNumber = parseInt(page, 10);
        const limit = parseInt(itemsPerPage, 10);

        const result = await warehouseService.searchWarehouses(term, userCabang, pageNumber, limit);
        res.json(result);

    } catch (error) {
        // Tambahkan logging untuk melihat error detail di terminal backend
        console.error('Error in searchWarehouses controller:', error);
        res.status(500).json({ message: 'Terjadi kesalahan di server.' });
    }
};

const getBranchList = async (req, res) => {
    try {
        const { userCabang } = req.query;
        if (!userCabang) {
            return res.status(400).json({ message: 'Parameter userCabang diperlukan.' });
        }
        const branches = await warehouseService.getBranchOptions(userCabang);
        res.json(branches);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    search,
    getBranchList,
};
