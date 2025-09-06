const laporanStokService = require('../services/laporanStokService');

const getRealTimeStock = async (req, res) => {
    try {
        const filters = {
            gudang: req.query.gudang,
            kodeBarang: req.query.kodeBarang,
            jenisStok: req.query.jenisStok,
            tampilkanKosong: req.query.tampilkanKosong === 'true',
            tanggal: req.query.tanggal,
        };

        if (!filters.gudang || !filters.tanggal) {
            return res.status(400).json({ message: 'Parameter gudang dan tanggal diperlukan.' });
        }

        const data = await laporanStokService.getRealTimeStock(filters);
        res.json(data);
    } catch (error) {
        console.error("Error in getRealTimeStock controller:", error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getRealTimeStock,
};