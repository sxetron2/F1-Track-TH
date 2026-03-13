export default async function handler(req, res) {
    // ดึงค่าจาก Environment Variables ของ Vercel
    const user = process.env.OPENF1_USER;
    const pass = process.env.OPENF1_PASS;

    if (!user || !pass) {
        return res.status(500).json({ error: "Server Configuration Error: Missing Env Vars" });
    }

    try {
        const params = new URLSearchParams();
        params.append("username", user);
        params.append("password", pass);

        const response = await fetch("https://api.openf1.org/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params,
        });

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const data = await response.json();
        // ส่ง username กลับไปด้วยเพื่อให้ frontend (api.js) ใช้งานต่อ
        return res.status(200).json({ ...data, username: user });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}