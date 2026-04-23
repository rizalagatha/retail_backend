const pool = require("../config/database");
const { format } = require("date-fns");
const fs = require("fs");
const path = require("path");

const generateNomorCmp = async (connection, cabang, tanggal) => {
  const date = new Date(tanggal);
  const prefix = `${cabang}.BAP.${format(date, "yyMM")}.`; // Diubah jadi BAP

  const query = `
    SELECT IFNULL(MAX(RIGHT(cmp_nomor, 4)), 0) + 1 AS next_num
    FROM tkomplain_hdr 
    WHERE cmp_nomor LIKE ?;
  `;
  const [rows] = await connection.query(query, [`${prefix}%`]);
  const nextNumber = rows[0].next_num.toString().padStart(4, "0");
  return `${prefix}${nextNumber}`;
};

const getKomplainDetail = async (nomor) => {
  const [hdrRows] = await pool.query(
    `
    SELECT h.*, 
           h.cmp_contact_nama as contact_nama, 
           h.cmp_contact_telp as contact_telp,
           c.cus_nama, c.cus_telp 
    FROM tkomplain_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.cmp_cus_kode
    WHERE h.cmp_nomor = ?
  `,
    [nomor],
  );

  if (hdrRows.length === 0) throw new Error("Data BAP tidak ditemukan.");

  const [dtlRows] = await pool.query(
    `
    SELECT d.cmpd_id, d.cmpd_nomor, d.cmpd_brg_kode as kode_barang, d.cmpd_ukuran as ukuran, 
           d.cmpd_qty_inv as qty_invoice, 
           d.cmpd_qty as qty, d.cmpd_foto as foto, d.cmpd_keterangan as keterangan, 
           IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), f.sd_nama) as nama_barang
    FROM tkomplain_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.cmpd_brg_kode
    LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.cmpd_brg_kode
    WHERE d.cmpd_nomor = ?
  `,
    [nomor],
  );

  const [logRows] = await pool.query(
    `
    SELECT l.*, u.user_nama 
    FROM tkomplain_log l
    LEFT JOIN tuser u ON u.user_kode = l.user_create
    WHERE l.cmpl_nomor = ?
    ORDER BY l.date_create DESC
  `,
    [nomor],
  );

  return { header: hdrRows[0], details: dtlRows, logs: logRows };
};

const saveKomplain = async (payload, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { header, details, isNew } = payload;
    let nomorCmp = header.nomor;

    const finalDir = path.join(
      process.cwd(),
      `public/images/cabang/${user.cabang}/komplain`,
    );
    if (!fs.existsSync(finalDir)) {
      fs.mkdirSync(finalDir, { recursive: true });
    }

    if (isNew) {
      nomorCmp = await generateNomorCmp(
        connection,
        user.cabang,
        header.tanggal,
      );

      await connection.query(
        `
        INSERT INTO tkomplain_hdr (
          cmp_nomor, cmp_tanggal, cmp_cab, cmp_cus_kode, 
          cmp_contact_nama, cmp_contact_telp, 
          cmp_ref_jenis, cmp_ref_nomor, cmp_nominal_inv, cmp_kategori, cmp_keterangan, cmp_sumber_masalah, cmp_status, user_create, date_create
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, NOW())
      `,
        [
          nomorCmp,
          header.tanggal,
          user.cabang,
          header.customer_kode,
          header.contact_nama || "",
          header.contact_telp || "",
          header.ref_jenis,
          header.ref_nomor,
          header.nominal_inv || 0,
          header.kategori,
          header.keterangan,
          header.sumber_masalah || "",
          user.kode,
        ],
      );

      await connection.query(
        `INSERT INTO tkomplain_log (cmpl_nomor, cmpl_status, cmpl_catatan, user_create, date_create) VALUES (?, 'DRAFT', 'BAP dibuat', ?, NOW())`,
        [nomorCmp, user.kode],
      );
    } else {
      const [cekDraft] = await connection.query(
        `SELECT cmp_status FROM tkomplain_hdr WHERE cmp_nomor = ?`,
        [nomorCmp],
      );
      if (
        cekDraft.length > 0 &&
        !["DRAFT", "ON_REVIEW", "RESOLVED"].includes(cekDraft[0].cmp_status)
      ) {
        throw new Error("Status BAP tidak mengizinkan perubahan.");
      }

      // Toko Edit Draft, Pusat Edit Solusi/Tanggungjawab
      await connection.query(
        `
        UPDATE tkomplain_hdr SET 
        cmp_contact_nama = ?, cmp_contact_telp = ?, cmp_nominal_inv = ?,
        cmp_kategori = ?, cmp_keterangan = ?, cmp_sumber_masalah = ?, 
        cmp_solusi = ?, cmp_tanggungjawab = ?, user_modified = ?, date_modified = NOW()
        WHERE cmp_nomor = ?
      `,
        [
          header.contact_nama || "",
          header.contact_telp || "",
          header.nominal_inv || 0,
          header.kategori,
          header.keterangan,
          header.sumber_masalah || "",
          header.solusi || "",
          header.tanggung_jawab || "",
          user.kode,
          nomorCmp,
        ],
      );

      if (cekDraft[0].cmp_status === "DRAFT") {
        await connection.query(
          `DELETE FROM tkomplain_dtl WHERE cmpd_nomor = ?`,
          [nomorCmp],
        );
      }
    }

    if (details && details.length > 0 && header.status === "DRAFT") {
      const dtlValues = details.map((d, i) => {
        const dtlId = `${nomorCmp.replace(/\./g, "")}${String(i + 1).padStart(3, "0")}`;
        let finalFotoPath = d.foto || null;
        if (d.foto && d.foto.startsWith("temp-")) {
          const tempPath = path.join(process.cwd(), "temp", d.foto);
          const ext = path.extname(d.foto);
          const newFilename = `BAP-${dtlId}${ext}`;
          const destPath = path.join(finalDir, newFilename);
          if (fs.existsSync(tempPath)) {
            fs.renameSync(tempPath, destPath);
            finalFotoPath = `/images/cabang/${user.cabang}/komplain/${newFilename}`;
          } else finalFotoPath = null;
        }
        return [
          dtlId,
          nomorCmp,
          d.kode_barang,
          d.ukuran,
          Number(d.qty_invoice || 0),
          Number(d.qty || 0),
          finalFotoPath,
          d.keterangan || "",
        ];
      });

      await connection.query(
        `INSERT INTO tkomplain_dtl (cmpd_id, cmpd_nomor, cmpd_brg_kode, cmpd_ukuran, cmpd_qty_inv, cmpd_qty, cmpd_foto, cmpd_keterangan) VALUES ?`,
        [dtlValues],
      );
    }

    await connection.commit();
    return { message: "Data BAP berhasil disimpan.", nomor: nomorCmp };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const updateStatus = async (nomor, statusTarget, catatan, solusi, user) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    let updateQuery = `UPDATE tkomplain_hdr SET cmp_status = ?, user_modified = ?, date_modified = NOW()`;
    const updateParams = [statusTarget, user.kode];

    if (solusi) {
      updateQuery += `, cmp_solusi = ?`;
      updateParams.push(solusi);
    }
    updateQuery += ` WHERE cmp_nomor = ?`;
    updateParams.push(nomor);

    await connection.query(updateQuery, updateParams);
    await connection.query(
      `INSERT INTO tkomplain_log (cmpl_nomor, cmpl_status, cmpl_catatan, user_create, date_create) VALUES (?, ?, ?, ?, NOW())`,
      [nomor, statusTarget, catatan || "", user.kode],
    );

    await connection.commit();
    return {
      message: `Status BAP berhasil diperbarui menjadi ${statusTarget.replace("_", " ")}.`,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
};

const lookupInvoice = async (cabang) => {
  const query = `
    SELECT h.inv_nomor AS Nomor, h.inv_tanggal AS Tanggal, h.inv_cus_kode AS KdCus, 
           c.cus_nama AS Customer, c.cus_alamat AS Alamat,
           (SELECT SUM(dd.invd_jumlah * (dd.invd_harga - dd.invd_diskon)) FROM tinv_dtl dd WHERE dd.invd_inv_nomor = h.inv_nomor) AS Nominal
    FROM tinv_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.inv_cus_kode
    WHERE h.inv_sts_pro = 0 AND LEFT(h.inv_nomor, 3) = ?
    ORDER BY h.inv_tanggal DESC LIMIT 200
  `;
  const [rows] = await pool.query(query, [cabang]);
  return rows;
};

const getInvoiceDetailsForKomplain = async (nomorInv) => {
  const query = `
    SELECT d.invd_kode AS kode_barang,
           IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), f.sd_nama) as nama_barang,
           d.invd_ukuran AS ukuran, d.invd_jumlah AS qty_invoice
    FROM tinv_dtl d
    LEFT JOIN tbarangdc a ON a.brg_kode = d.invd_kode
    LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.invd_kode
    WHERE d.invd_inv_nomor = ?
  `;
  const [rows] = await pool.query(query, [nomorInv]);
  return rows;
};

const getPrintData = async (nomor) => {
  const query = `
    SELECT 
      h.*, 
      c.cus_nama, 
      c.cus_telp,
      DATE_FORMAT(h.date_create, '%d/%m/%Y %H:%i:%s') AS created_at,
      
      -- [BARU] Tarik data langsung dari tabel totorisasi
      (SELECT o_approver 
       FROM totorisasi 
       WHERE o_transaksi = h.cmp_nomor 
         AND o_jenis = 'SUBMIT_BAP' 
         AND o_status = 'Y' 
       ORDER BY o_approved_at DESC LIMIT 1) AS approver_nama,
       
      (SELECT DATE_FORMAT(o_approved_at, '%d/%m/%Y %H:%i') 
       FROM totorisasi 
       WHERE o_transaksi = h.cmp_nomor 
         AND o_jenis = 'SUBMIT_BAP' 
         AND o_status = 'Y' 
       ORDER BY o_approved_at DESC LIMIT 1) AS approved_at,

      g.gdg_inv_nama AS perush_nama, 
      g.gdg_inv_alamat AS perush_alamat,
      g.gdg_inv_kota AS perush_kota, 
      g.gdg_inv_telp AS perush_telp,
      
      d.cmpd_brg_kode, 
      d.cmpd_ukuran, 
      d.cmpd_qty_inv AS qty_invoice, 
      d.cmpd_qty, 
      d.cmpd_keterangan AS dtl_keterangan,
      IFNULL(TRIM(CONCAT(a.brg_jeniskaos, " ", a.brg_tipe, " ", a.brg_lengan, " ", a.brg_jeniskain, " ", a.brg_warna)), f.sd_nama) as nama_barang
      
    FROM tkomplain_hdr h
    LEFT JOIN tcustomer c ON c.cus_kode = h.cmp_cus_kode
    LEFT JOIN tgudang g ON g.gdg_kode = h.cmp_cab
    LEFT JOIN tkomplain_dtl d ON d.cmpd_nomor = h.cmp_nomor
    LEFT JOIN tbarangdc a ON a.brg_kode = d.cmpd_brg_kode
    LEFT JOIN tsodtf_hdr f ON f.sd_nomor = d.cmpd_brg_kode
    WHERE h.cmp_nomor = ?;
  `;

  const [rows] = await pool.query(query, [nomor]);
  if (rows.length === 0) throw new Error("Data BAP tidak ditemukan.");

  const header = {
    nomor: rows[0].cmp_nomor,
    tanggal: rows[0].cmp_tanggal,
    customer_nama: rows[0].cus_nama,
    customer_telp: rows[0].cus_telp,
    contact_nama: rows[0].cmp_contact_nama,
    contact_telp: rows[0].cmp_contact_telp,
    ref_nomor: rows[0].cmp_ref_nomor,
    nominal_inv: rows[0].cmp_nominal_inv,
    kategori: rows[0].cmp_kategori,
    keterangan: rows[0].cmp_keterangan,
    sumber_masalah: rows[0].cmp_sumber_masalah,
    solusi: rows[0].cmp_solusi,
    tanggung_jawab: rows[0].cmp_tanggungjawab,
    status: rows[0].cmp_status,
    user_create: rows[0].user_create,
    created_at: rows[0].created_at,

    // [UPDATE] Gunakan data hasil subquery totorisasi
    approved_at: rows[0].approved_at || "-",
    approver_nama: rows[0].approver_nama || "ADMIN PUSAT",

    perush_nama: rows[0].perush_nama,
    perush_alamat: `${rows[0].perush_alamat || ""}, ${rows[0].perush_kota || ""}`,
    perush_telp: rows[0].perush_telp,
  };

  const details = rows
    .filter((r) => r.cmpd_brg_kode)
    .map((r) => ({
      kode: r.cmpd_brg_kode,
      nama: r.nama_barang,
      ukuran: r.cmpd_ukuran,
      qty_invoice: r.qty_invoice,
      qty: r.cmpd_qty,
      keterangan: r.dtl_keterangan,
    }));

  return { header, details };
};

module.exports = {
  getKomplainDetail,
  saveKomplain,
  updateStatus,
  lookupInvoice,
  getInvoiceDetailsForKomplain,
  getPrintData,
};
