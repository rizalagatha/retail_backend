// middleware/clientCertAuth.js

const clientCertAuth = (req, res, next) => {
  // Ambil header 'X-SSL-Client-DN' yang di-set oleh Nginx
  const userDN = req.headers["x-ssl-client-dn"];

  if (!userDN) {
    return res
      .status(403)
      .send({
        message:
          "Akses Ditolak: Sertifikat klien tidak valid atau tidak ditemukan.",
      });
  }

  // Ekstrak Common Name (CN) dari string DN untuk mendapatkan username
  // Contoh userDN: "C=ID, ST=JawaTengah, O=Kencana Print, CN=admin"
  const cnMatch = userDN.match(/CN=([^,]+)/);
  const username = cnMatch ? cnMatch[1] : null;

  if (!username) {
    return res
      .status(403)
      .send({
        message: "Akses Ditolak: Username tidak ditemukan di dalam sertifikat.",
      });
  }

  // Di sini Anda berhasil mengidentifikasi user.
  // Lampirkan informasi user ke object request agar bisa digunakan di controller selanjutnya.
  req.user = {
    kode: username,
    // Anda bisa menambahkan data lain di sini jika perlu,
    // misalnya dengan query ke database berdasarkan username.
  };

  console.log(`User terautentikasi via sertifikat: ${username}`);

  // Lanjutkan ke proses berikutnya
  next();
};

module.exports = clientCertAuth;
