const service = require('../services/invoiceFormService');

const loadForEdit = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.loadForEdit(nomor, req.user);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const save = async (req, res) => {
    try {
        const result = await service.saveData(req.body, req.user);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const searchSo = async (req, res) => {
    try {
        // Ambil dan konversi parameter dari query string
        const { term, page = 1, itemsPerPage = 10 } = req.query;
        const data = await service.searchSo(
            term, 
            Number(page), 
            Number(itemsPerPage), 
            req.user
        );
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getSoDetailsForGrid = async (req, res) => {
    try {
        const { soNomor } = req.params;
        const data = await service.getSoDetailsForGrid(soNomor, req.user);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const searchUnpaidDp = async (req, res) => {
    try {
        const { customerKode } = req.params;
        const data = await service.searchUnpaidDp(customerKode, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getSalesCounters = async (req, res) => {
    try {
        const data = await service.getSalesCounters();
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const searchPromo = async (req, res) => {
    try {
        const data = await service.searchPromo(req.query, req.user);
        res.json(data);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getMemberByHp = async (req, res) => {
    try {
        const data = await service.getMemberByHp(req.params.hp);
        if (data) { res.json(data); } 
        else { res.status(404).json({ message: 'Member tidak ditemukan.' }); }
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const saveMember = async (req, res) => {
    try {
        const result = await service.saveMember(req.body, req.user);
        res.json({ message: `Member ${result.nama} berhasil disimpan.`, savedMember: result });
    } catch (error) { res.status(400).json({ message: error.message }); }
};

const getDefaultCustomer = async (req, res) => {
    try {
        // Ambil cabang dari user atau fallback ke query parameter
        const cabang = req.user?.cabang || req.query.cabang;
        
        if (!cabang) {
            return res.json(null);
        }
        
        const data = await service.getDefaultCustomer(cabang);
        res.json(data);
    } catch (error) { 
        console.error('Error in getDefaultCustomer:', error);
        res.status(500).json({ message: error.message }); 
    }
};

const getPrintData = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.getPrintData(nomor);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const getByBarcode = async (req, res) => {
    try {
        const { barcode } = req.params;
        const { gudang } = req.query; // Gudang diambil dari query parameter
        if (!gudang) {
            return res.status(400).json({ message: 'Parameter gudang diperlukan.' });
        }
        const product = await service.findByBarcode(barcode, gudang);
        res.json(product);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const searchProducts = async (req, res) => {
    try {
        const { page = 1, itemsPerPage = 10 } = req.query;
        const result = await service.searchProducts(
            { ...req.query, page: Number(page), itemsPerPage: Number(itemsPerPage) },
            req.user
        );
        res.json(result);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

const getPrintDataKasir = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.getPrintDataKasir(nomor);
        res.json(data);
    } catch (error) { res.status(404).json({ message: error.message }); }
};

const searchSoDtf = async (req, res) => {
    try {
        const data = await service.searchSoDtf(req.query, req.user);
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getSoDtfDetails = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.getSoDtfDetails(nomor);
        res.json(data);
    } catch (error) {
        res.status(404).json({ message: error.message });
    }
};

const searchReturJual = async (req, res) => {
    try {
        const data = await service.searchReturJual(req.query, req.user);
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const saveSatisfaction = async (req, res) => {
    try {
        const result = await service.saveSatisfaction(req.body);
        res.json(result);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

const getDiscountRule = async (req, res) => {
    try {
        const { customerKode } = req.params;
        const data = await service.getDiscountRule(customerKode);
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getPromoBonusItems = async (req, res) => {
    try {
        const { promoNomor } = req.params;
        const data = await service.getPromoBonusItems(promoNomor, req.user);
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const validateVoucher = async (req, res) => {
    try {
        const data = await service.validateVoucher(req.body, req.user);
        res.json(data);
    } catch (error) { res.status(400).json({ message: error.message }); }
};

const getApplicableItemPromo = async (req, res) => {
    try {
        const data = await service.getApplicableItemPromo(req.query, req.user);
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const checkPrintables = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.checkPrintables(nomor);
        res.json(data);
    } catch (error) { res.status(500).json({ message: error.message }); }
};

const getKuponPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getKuponPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getVoucherPrintData = async (req, res) => {
  try {
    const { nomor } = req.params;
    const data = await service.getVoucherPrintData(nomor);
    res.json(data);
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
};

const getDataForSjPrint = async (req, res) => {
    try {
        const { nomor } = req.params;
        const data = await service.getDataForSjPrint(nomor);
        res.json(data);
    } catch (error) { res.status(404).json({ message: error.message }); }
};

module.exports = {
    loadForEdit,
    save,
    searchSo,
    getSoDetailsForGrid,
    searchUnpaidDp,
    getSalesCounters,
    searchPromo,
    getMemberByHp,
    saveMember,
    getDefaultCustomer,
    getPrintData,
    getByBarcode,
    searchProducts,
    getPrintDataKasir,
    searchSoDtf,
    getSoDtfDetails,
    searchReturJual,
    saveSatisfaction,
    getDiscountRule,
    getPromoBonusItems,
    validateVoucher,
    getApplicableItemPromo,
    checkPrintables,
    getKuponPrintData,
    getVoucherPrintData,
    getDataForSjPrint,
};

