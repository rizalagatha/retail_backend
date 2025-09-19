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
};

