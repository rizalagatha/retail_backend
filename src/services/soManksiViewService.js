const pool = require("../config/database");

const SIZE_ORDER = [
  "ALLSIZE",
  "XS",
  "S",
  "M",
  "L",
  "XL",
  "2XL",
  "3XL",
  "4XL",
  "5XL",
  "6XL",
  "7XL",
  "8XL",
  "9XL",
  "10XL",
  "OVERSIZED",
  "JUMBO",
];
const sizeOrderIdx = (size) => {
  const idx = SIZE_ORDER.indexOf((size || "").toString().trim().toUpperCase());
  return idx === -1 ? SIZE_ORDER.length : idx;
};

const JO_KATEGORI = {
  BB: "ATASAN",
  BU: "ATASAN",
  JK: "ATASAN",
  JS: "ATASAN",
  KK: "ATASAN",
  KO: "ATASAN",
  KS: "ATASAN",
  CL: "BAWAHAN",
  WP: "WEARPACK",
};

const getSoManksiDetail = async (soNomor) => {
  const [headerRows] = await pool.query(
    `SELECT
        s.so_nomor, s.so_tanggal, s.so_dateline,
        s.so_perush_kode, p.perush_nama,
        s.so_cus_kode, s.so_cus_kaosan,
        s.so_sal_kode, sal.sal_nama,
        s.so_jo_kode, jo.jo_nama,
        s.so_divisi, s.so_nama, s.so_nama2, s.so_jumlah,
        s.so_ukuran, s.so_kain, s.so_finishing, s.so_gramasi,
        s.so_cab, s.so_cabkaos, s.so_tipe, s.so_statuskerja,
        s.so_standar_ukuran, s.so_varian_ukuran,
        s.so_nomor_po, s.so_tgl_po, s.so_datelinepo,
        s.so_sablon, s.so_bordir, s.so_sublim,
        s.so_warna_badan, s.so_warna_lengan, s.so_warna_lain,
        s.so_keterangan, s.so_aktif, s.so_close, s.so_cmo,
        s.so_invdc AS refPengajuanHarga
     FROM kencanaprint.tsalesorder s
     LEFT JOIN kencanaprint.tperusahaan p ON p.perush_kode = s.so_perush_kode
     LEFT JOIN kencanaprint.tsales sal ON sal.sal_kode = s.so_sal_kode
     LEFT JOIN kencanaprint.tjenisorder jo ON jo.jo_kode = s.so_jo_kode
     WHERE s.so_nomor = ?`,
    [soNomor],
  );
  if (headerRows.length === 0) {
    throw new Error("SO Manksi tidak ditemukan.");
  }
  const header = headerRows[0];

  let custKaosanNama = "";
  if (header.so_cus_kaosan) {
    const [custRows] = await pool.query(
      "SELECT cus_nama FROM tcustomer WHERE cus_kode = ?",
      [header.so_cus_kaosan],
    );
    custKaosanNama = custRows[0]?.cus_nama || "";
  }
  header.custKaosanNama = custKaosanNama;
  header.kategoriUkuran =
    JO_KATEGORI[String(header.so_jo_kode).toUpperCase()] || null;

  const [items] = await pool.query(
    `SELECT
        k.sok_kode AS kode,
        TRIM(CONCAT(a.brg_jeniskaos, ' ', a.brg_tipe, ' ', a.brg_lengan, ' ', a.brg_jeniskain, ' ', a.brg_warna)) AS nama,
        k.sok_ukuran AS ukuran,
        k.sok_qtyorder AS qty
     FROM kencanaprint.tsalesorder_kaosan k
     LEFT JOIN tbarangdc a ON a.brg_kode = k.sok_kode
     WHERE k.sok_so_nomor = ?`,
    [soNomor],
  );
  items.sort((a, b) => sizeOrderIdx(a.ukuran) - sizeOrderIdx(b.ukuran));

  const [sizes] = await pool.query(
    `SELECT
        sos_size AS size, sos_qty AS qty,
        sos_ld AS ld, sos_pb AS pb,
        sos_pl_pendek AS plPendek, sos_pl_panjang AS plPanjang,
        sos_p_bahu AS pBahu, sos_l_lengan AS lLengan, sos_l_manset AS lManset,
        sos_l_pinggang AS lPinggang, sos_p_celana AS pCelana,
        sos_l_panggul AS lPanggul, sos_l_paha AS lPaha,
        sos_pesak AS pesak, sos_l_lutut AS lLutut, sos_l_bawah AS lBawah
     FROM kencanaprint.tsalesorder_size
     WHERE sos_so_nomor = ?`,
    [soNomor],
  );
  sizes.sort((a, b) => sizeOrderIdx(a.size) - sizeOrderIdx(b.size));

  return { header, items, sizes };
};

module.exports = { getSoManksiDetail };
