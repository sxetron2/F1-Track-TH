// f:\Project\F1\F1-Track\js\api.js

// Helper: Parse JWT to check expiry
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) { return null; }
}

let openF1Token = (typeof CONFIG !== 'undefined' && CONFIG.ACCESS_TOKEN) ? CONFIG.ACCESS_TOKEN : null;
let openF1User = (typeof CONFIG !== 'undefined' && CONFIG.OPENF1_USER) ? CONFIG.OPENF1_USER : null;
let tokenExpiry = 0;
if (openF1Token) {
    const decoded = parseJwt(openF1Token);
    tokenExpiry = decoded ? decoded.exp : 0;
}

async function getOpenF1Token(forceRefresh = false) {
    const now = Date.now() / 1000;
    
    if (!forceRefresh && openF1Token && now < (tokenExpiry - 60)) {
        return openF1Token;
    }

    try {
        let data;

        // ตรวจสอบว่ามี CONFIG แบบเดิมหรือไม่ (สำหรับการเทส Local แบบง่าย)
        if (typeof CONFIG !== 'undefined' && CONFIG.OPENF1_USER && CONFIG.OPENF1_PASS) {
            const params = new URLSearchParams();
            params.append("username", CONFIG.OPENF1_USER);
            params.append("password", CONFIG.OPENF1_PASS);

            const response = await fetch("https://api.openf1.org/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: params,
            });
            if (!response.ok) throw new Error(await response.text());
            data = await response.json();
        } else {
            // ถ้าไม่มี CONFIG ให้ยิงไปที่ Vercel Serverless Function (/api/token)
            if (window.location.protocol === 'file:') {
                console.warn("⚠️ คุณกำลังเปิดไฟล์ผ่าน file:// ทำให้ไม่สามารถเรียก /api/token ได้");
                console.warn("👉 วิธีแก้: 1. ใช้ 'vercel dev' หรือ 2. เปิด config.js ใน index.html กลับมาใช้ชั่วคราว");
                throw new Error("Cannot use backend API on file:// protocol");
            }
            // หมายเหตุ: การเรียก /api/token จะทำงานได้เมื่อ Deploy บน Vercel หรือใช้คำสั่ง 'vercel dev' ในเครื่องเท่านั้น
            // หากเปิดไฟล์ html ธรรมดา (file://) จะเกิด Error "Failed to fetch"
            const response = await fetch("/api/token");
            if (!response.ok) throw new Error("Failed to fetch token from backend");
            data = await response.json();
        }

        openF1Token = data.access_token;
        if (data.username) openF1User = data.username; // บันทึก Username ที่ได้มา
        
        const decoded = parseJwt(openF1Token);
        tokenExpiry = decoded ? decoded.exp : (now + 3600);
        return openF1Token;
    } catch (e) {
        console.error("OpenF1 Auth Error:", e);
        return null;
    }
}

async function fetchOpenF1(endpoint, retry = true) {
    let token = await getOpenF1Token();
    const headers = {};
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    const url = endpoint.startsWith('http') ? endpoint : `https://api.openf1.org/v1${endpoint}`;
    
    let response = await fetch(url, { headers });

    if (response.status === 401 && retry) {
        console.warn("Token expired or invalid. Retrying...");
        token = await getOpenF1Token(true);
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
            response = await fetch(url, { headers });
        }
    }
    return response;
}