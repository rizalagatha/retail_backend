const priceProposalFormService = require('../services/priceProposalFormService');

const getNextNumber = async (req, res) => {
    try {
        const { cabang, tanggal } = req.query;
        if (!cabang || !tanggal) {
            return res.status(400).json({ message: 'Parameter cabang dan tanggal diperlukan.' });
        }
        const nextNumber = await priceProposalFormService.generateNewProposalNumber(cabang, tanggal);
        res.json({ nextNumber });
    } catch (error) {
        res.status(500).json({ message: 'Gagal membuat nomor baru.' });
    }
};

const searchTshirtTypes = async (req, res) => {
    try {
        const { term, custom } = req.query;
        const types = await priceProposalFormService.searchTshirtTypes(term, custom);
        res.json(types);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mencari jenis kaos.' });
    }
};

const getTshirtTypeDetails = async (req, res) => {
    try {
        const { jenisKaos, custom } = req.query;
        if (!jenisKaos || !custom) {
            return res.status(400).json({ message: 'Parameter jenisKaos dan custom diperlukan.' });
        }
        const details = await priceProposalFormService.getTshirtTypeDetails(jenisKaos, custom);
        res.json(details);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mengambil detail jenis kaos.' });
    }
};

const uploadImage = (req, res) => {
    // Jika middleware multer berhasil, file sudah tersimpan.
    // Kirim respons sukses.
    if (!req.file) {
        return res.status(400).json({ message: 'Tidak ada file yang diunggah.' });
    }
    res.status(200).json({ message: 'Gambar berhasil diunggah.', filePath: req.file.path });
};

const getDiscount = async (req, res) => {
    try {
        const { bruto } = req.query;
        // Panggil fungsi service yang baru dibuat
        const diskonRp = await priceProposalFormService.getDiscountByBruto(bruto);
        res.json({ diskonRp });
    } catch (error) {
        res.status(500).json({ message: 'Gagal menghitung diskon otomatis.' });
    }
};

const searchProductsByType = async (req, res) => {
    try {
        const { jenisKaos } = req.query;
        const products = await priceProposalFormService.searchProductsByType(jenisKaos);
        res.json(products);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mencari produk.' });
    }
};

module.exports = {
    getNextNumber,
    searchTshirtTypes,
    getTshirtTypeDetails,
    uploadImage,
    getDiscount,
    searchProductsByType,
};
