const priceProposalFormService = require('../services/priceProposalFormService');
const fs = require('fs');
const path = require('path');

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
        
        // Ambil nomor pengajuan dari URL params
        const { nomor } = req.params;
        if (!nomor) {
            // Hapus file sementara jika nomor tidak ada
            const fs = require('fs');
            fs.unlinkSync(req.file.path); 
            return res.status(400).json({ message: 'Nomor pengajuan diperlukan.' });
        }
        
        // Panggil service untuk me-rename dan move file ke lokasi yang benar
        const finalPath = await priceProposalFormService.renameProposalImage(req.file.path, nomor);

        // Buat URL yang bisa diakses
        const cabang = nomor.substring(0, 3);
        const imageUrl = `${process.env.BASE_URL || 'http://192.168.1.73:8000'}/images/${cabang}/${nomor}${path.extname(req.file.originalname)}`;

        res.status(200).json({ 
            message: 'Gambar berhasil diunggah.', 
            filePath: finalPath,
            imageUrl: imageUrl
        });

    } catch (error) {
        console.error("Upload Image Error:", error);
        
        // Cleanup file jika ada error
        if (req.file && req.file.path) {
            try {
                const fs = require('fs');
                fs.unlinkSync(req.file.path);
            } catch (cleanupError) {
                console.error('Error cleaning up temp file:', cleanupError);
            }
        }
        
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

const getForEdit = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await priceProposalFormService.getProposalForEdit(nomor);
        res.json(data);
    } catch (error) {
        res.status(error.status || 500).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        const result = await priceProposalFormService.saveProposal(req.body);
        res.status(req.body.isNew ? 201 : 200).json(result);
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
    getForEdit,
    save,
};
