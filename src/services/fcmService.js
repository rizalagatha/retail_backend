const admin = require("../config/firebaseConfig"); // Pastikan path config benar

const sendNotification = async (token, title, body, dataPayload) => {
  if (!token) return;
  try {
    await admin.messaging().send({
      token: token,
      notification: { title, body },
      data: dataPayload,
      android: {
        priority: "high", // Prioritas kirim jaringan
        notification: {
          channelId: "otorisasi_urgent", // <--- HARUS SAMA dengan ID di App.js
          // Nama file icon tetap sama
          icon: "ic_notification",

          // [GANTI JADI MERAH]
          color: "#D32F2F",
          sound: "default",
          priority: "high", // Prioritas tampilan Android
          defaultSound: true,
          defaultVibrateTimings: true,
          visibility: "public", // Agar muncul walau layar terkunci
        },
      },
    });
    console.log("Notif sent to:", token);
  } catch (err) {
    console.error("FCM Error:", err.message);
  }
};

module.exports = { sendNotification };
