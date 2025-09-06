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

const uploadImage = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'Tidak ada file yang diunggah.' });
        }
        
        // Ambil nomor pengajuan dari body request
        const { nomor } = req.body;
        if (!nomor) {
            // Hapus file sementara jika nomor tidak ada
            fs.unlinkSync(req.file.path); 
            return res.status(400).json({ message: 'Nomor pengajuan diperlukan.' });
        }

        // Buat nama file final (contoh: K07.2025.00001.jpg)
        const finalFileName = `${nomor}${path.extname(req.file.originalname)}`;
        
        // Panggil service untuk me-rename file
        const finalPath = await priceProposalFormService.renameProposalImage(req.file.path, finalFileName);

        res.status(200).json({ message: 'Gambar berhasil diunggah.', filePath: finalPath });

    } catch (error) {
        res.status(500).json({ message: error.message });
    }
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

const searchAdditionalCosts = async (req, res) => {
    try {
        const costs = await priceProposalFormService.searchAdditionalCosts();
        res.json(costs);
    } catch (error) {
        res.status(500).json({ message: 'Gagal mencari biaya tambahan.' });
    }
};

const getEditDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await priceProposalFormService.getFullProposalDetails(nomor);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        // req.body berisi payload lengkap dari frontend
        const result = await priceProposalFormService.saveProposal(req.body);
        res.status(201).json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getNextNumber,
    searchTshirtTypes,
    getTshirtTypeDetails,
    uploadImage,
    getDiscount,
    searchProductsByType,
    searchAdditionalCosts,
    getEditDetails,
    save,
};
