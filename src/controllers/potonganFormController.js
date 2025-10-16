
const potonganFormService = require('../service/potonganFormService');

/**
 * GET /api/potongan/:nomor
 */
exports.getPotonganByNomor = async (req, res) => {
    try {
        const ptNomor = req.params.nomor;
        const data = await potonganFormService.loadPotongan(ptNomor);

        if (!data) {
            return res.status(404).json({ message: 'Nomor transaksi tidak ditemukan.' });
        }
        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Gagal memuat data Potongan.', error: error.message });
    }
};

const getCustomersLookup = async (req, res) => {
    try {
        const { term = '', page = 1, itemsPerPage = 10 } = req.query;
        // Asumsi gudang (cabang) dan user diambil dari token atau session
        const gudang = req.user.cabangKode; // Ganti dengan logika pengambilan gudang yang sebenarnya

        const results = await potonganService.searchCustomers(
            term, 
            gudang, 
            parseInt(page), 
            parseInt(itemsPerPage)
        );
        
        res.status(200).json({
            data: results.items,
            total: results.total,
            page: parseInt(page),
            itemsPerPage: parseInt(itemsPerPage)
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// [B] Controller untuk Detail Customer (Setelah memilih di F1 atau exit dari field kode)
const getCustomerDetailByKode = async (req, res) => {
    try {
        const customerKode = req.params.kode;
        // Asumsi gudang (cabang) diambil dari token atau session
        const gudang = req.user.cabangKode; // Ganti dengan logika pengambilan gudang yang sebenarnya

        const customerDetail = await potonganService.getCustomerDetails(customerKode, gudang);
        
        res.status(200).json(customerDetail);
    } catch (error) {
        // Asumsi error adalah validasi bisnis, bisa dikirim status 400
        const status = error.status || 400; 
        res.status(status).json({ message: error.message });
    }
};


/**
 * POST /api/potongan (Baru)
 * PUT /api/potongan/:nomor (Ubah)
 */
exports.savePotongan = async (req, res) => {
    try {
        const ptNomor = req.params.nomor; 
        const isEdit = !!ptNomor;
        const data = req.body;
        
        // Validasi sederhana (Mencerminkan logika Delphi)
        const { pt_cus_kode, pt_nominal, pt_akun } = data;
        const nominal = parseFloat(String(pt_nominal).replace(/,/g, '')) || 0;
        
        if (!pt_cus_kode && !isEdit) {
            return res.status(400).json({ message: 'Kode Customer harus diisi.' });
        }
        if (nominal === 0) {
            return res.status(400).json({ message: 'Nominal Potongan harus lebih dari 0.' });
        }
        if (!pt_akun) {
            return res.status(400).json({ message: 'Nomor Akun harus diisi.' });
        }

        const result = await potonganService.savePotongan(data, isEdit);

        res.status(isEdit ? 200 : 201).json({ 
            message: `Transaksi Potongan berhasil disimpan.`,
            nomor: result.pt_nomor 
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ 
            message: error.message || 'Terjadi kesalahan saat menyimpan data.',
            error: error.message 
        });
    }
};