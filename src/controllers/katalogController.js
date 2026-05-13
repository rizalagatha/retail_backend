const katalogService = require("../services/katalogService");
const fs = require("fs");
const pool = require("../config/database");

const getKatalogList = async (req, res) => {
  try {
    const query = `
      SELECT 
        b.brg_kode AS kode,
        IFNULL(b.brg_jeniskain, 'LAIN-LAIN') AS jenis_kain,
        IFNULL(b.brg_lengan, 'LAIN-LAIN') AS lengan, -- [BARU] Tambahan lengan
        TRIM(CONCAT(IFNULL(b.brg_jeniskaos,''), ' ', IFNULL(b.brg_tipe,''), ' ', IFNULL(b.brg_lengan,''), ' ', IFNULL(b.brg_jeniskain,''), ' ', IFNULL(b.brg_warna,''))) AS nama,
        
        -- Ambil gambar dari tbarangdc_images (Slot 1) sebagai prioritas utama
        COALESCE(
          (SELECT img_url FROM tbarangdc_images WHERE img_brg_kode = b.brg_kode ORDER BY img_index ASC LIMIT 1),
          b.brg_gambar_url
        ) AS gambar_url,
        
        IFNULL(b.brg_urutan_tampil, 9999) AS urutan
      FROM tbarangdc b
      WHERE b.brg_aktif = 0 AND b.brg_logstok = 'Y'
      ORDER BY urutan ASC, nama ASC
    `;
    const [rows] = await pool.query(query);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getGalleryByKode = async (req, res) => {
  try {
    const { kodeBarang } = req.params;
    const rows = await katalogService.getGalleryByKode(kodeBarang);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const uploadGambarProduk = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "Tidak ada file." });

    const { kodeBarang } = req.params;
    // Tangkap index dari body (dikirim oleh frontend FormData)
    // Jika tidak ada, default ke 1
    const index = req.body.index || 1;

    const imageUrl = await katalogService.processGambarProduk(
      req.file.path,
      kodeBarang,
      index,
    );

    res.status(200).json({ success: true, imageUrl });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ message: error.message });
  }
};

const updateUrutanMassal = async (req, res) => {
  try {
    const { urutanList } = req.body;
    // Format ekspektasi: urutanList = [ { kode: 'A01', urutan: 1 }, { kode: 'A02', urutan: 2 } ]

    if (!Array.isArray(urutanList)) {
      return res.status(400).json({ message: "Format data tidak valid." });
    }

    await katalogService.updateUrutanKatalog(urutanList);

    res.json({ success: true, message: "Urutan katalog berhasil diperbarui." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const deleteGambarProduk = async (req, res) => {
  try {
    const { kodeBarang, index } = req.params;
    await katalogService.deleteGambarProduk(kodeBarang, index);
    res.json({ success: true, message: "Gambar berhasil dihapus" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const swapGambarProduk = async (req, res) => {
  try {
    const { kodeBarang, indexA, indexB } = req.params;
    await katalogService.swapGambarProduk(
      kodeBarang,
      Number(indexA),
      Number(indexB),
    );
    res.json({ success: true, message: "Urutan gambar berhasil ditukar." });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getKatalogList,
  uploadGambarProduk,
  updateUrutanMassal,
  getGalleryByKode,
  deleteGambarProduk,
  swapGambarProduk,
};
