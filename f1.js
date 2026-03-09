// 0. ระบบนับถอยหลัง (Countdown)
let countdownInterval;

// OpenF1 Auth Configuration (Loaded from config.js)
// Helper: Parse JWT to check expiry
function parseJwt(token) {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(window.atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        return JSON.parse(jsonPayload);
    } catch (e) { return null; }
}

let openF1Token = CONFIG.ACCESS_TOKEN || null;
let tokenExpiry = 0;
if (openF1Token) {
    const decoded = parseJwt(openF1Token);
    tokenExpiry = decoded ? decoded.exp : 0;
}

async function getOpenF1Token(forceRefresh = false) {
    // Safety Check: ถ้าไม่มี CONFIG หรือไม่ได้ตั้งค่า User/Pass ให้ข้ามไป (ใช้แบบ Public/Free)
    if (typeof CONFIG === 'undefined' || !CONFIG.OPENF1_USER) return null;

    const now = Date.now() / 1000;
    
    // ถ้ามี Token และยังไม่หมดอายุ (และไม่ได้บังคับ refresh) ให้ใช้ของเดิม
    if (!forceRefresh && openF1Token && now < (tokenExpiry - 60)) {
        return openF1Token;
    }

    try {
        const params = new URLSearchParams();
        params.append("username", CONFIG.OPENF1_USER);
        params.append("password", CONFIG.OPENF1_PASS);

        const response = await fetch("https://api.openf1.org/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params,
        });

        if (response.ok) {
            const data = await response.json();
            openF1Token = data.access_token;
            const decoded = parseJwt(openF1Token);
            tokenExpiry = decoded ? decoded.exp : (now + 3600);
            return openF1Token;
        } else {
            console.error("OpenF1 Auth Failed:", await response.text());
            return null;
        }
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

    // Auto-retry on 401 (Unauthorized)
    if (response.status === 401 && retry) {
        console.warn("Token expired or invalid. Retrying...");
        token = await getOpenF1Token(true); // Force refresh
        if (token) {
            headers['Authorization'] = `Bearer ${token}`;
            response = await fetch(url, { headers });
        }
    }
    return response;
}

async function fetchNextSession() {
    try {
        let year = new Date().getFullYear();
        // ใช้ OpenF1 แบบมี Auth
        let response = await fetchOpenF1(`/sessions?year=${year}`);
        let data = response.ok ? await response.json() : [];
        
        if (!Array.isArray(data)) data = [];

        const now = new Date();
        let upcoming = data
            .filter(s => new Date(s.date_start) > now)
            .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

        // ถ้าปีนี้ไม่มีแข่งแล้ว ให้ลองดูปีหน้า
        if (upcoming.length === 0) {
            year++;
            response = await fetchOpenF1(`/sessions?year=${year}`);
            if (response.ok) {
                data = await response.json();
                if (Array.isArray(data)) {
                    upcoming = data.filter(s => new Date(s.date_start) > now).sort((a, b) => new Date(a.date_start) - new Date(b.date_start));
                }
            }
        }

        if (upcoming.length === 0) return;

        setupCountdown(upcoming[0]);
    } catch (error) {
        console.error("Countdown Error:", error);
    }
}

function setupCountdown(session) {
    const section = document.getElementById('countdown-section');
    section.classList.remove('hidden');

    // แปลงชื่อ Session ให้เข้าใจง่าย
    const sessionMap = {
        "Practice 1": "Free Practice 1",
        "Practice 2": "Free Practice 2",
        "Practice 3": "Free Practice 3",
        "Sprint Qualifying": "Sprint Shootout",
        "Sprint": "Sprint Race",
        "Qualifying": "Qualifying",
        "Race": "Race Day"
    };

    const sessionName = sessionMap[session.session_name] || session.session_name;
    const dateObj = new Date(session.date_start);
    
    // อัปเดตข้อความ
    document.getElementById('cd-location').innerText = `${session.location} GP`;
    document.getElementById('cd-session').innerText = sessionName;
    
    // เริ่มนับถอยหลัง
    if (countdownInterval) clearInterval(countdownInterval);
    
    function update() {
        const now = new Date();
        const diff = dateObj - now;

        if (diff <= 0) {
            clearInterval(countdownInterval);
            document.getElementById('countdown-container').innerHTML = '<div class="text-center text-2xl font-black italic text-[#e10600] animate-pulse w-full py-4">SESSION IS LIVE!</div>';
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        document.getElementById('cd-d').innerText = days.toString().padStart(2, '0');
        document.getElementById('cd-h').innerText = hours.toString().padStart(2, '0');
        document.getElementById('cd-m').innerText = minutes.toString().padStart(2, '0');
        document.getElementById('cd-s').innerText = seconds.toString().padStart(2, '0');
    }

    update();
    countdownInterval = setInterval(update, 1000);
}

// 1. ดึงข่าวสารจาก RSS Feed (Motorsport.com) ผ่าน rss2json
async function fetchNews() {
    const container = document.getElementById('news-container');
    // แสดง Loading
    container.innerHTML = '<div class="text-center text-gray-500 text-xs py-4"><div class="loader mb-2" style="width:16px; height:16px; border-width:2px;"></div>Loading News...</div>';

    try {
        // ใช้ RSS Feed จาก Motorsport.com
        const rssUrl = 'https://www.motorsport.com/rss/f1/news/';
        // ใช้ rss2json API เพื่อแปลง RSS เป็น JSON (ฟรี)
        const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`);
        if (!response.ok) throw new Error(`RSS API Error: ${response.status}`);
        const data = await response.json();

        if (data.status !== 'ok') throw new Error('Failed to fetch RSS');

        let html = '';
        // แสดง 5 ข่าวล่าสุด
        data.items.slice(0, 5).forEach(item => {
            const date = new Date(item.pubDate);
            // แปลงเวลาเป็นแบบสั้น (เช่น 14:30)
            const timeStr = date.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

            html += `
                <a href="${item.link}" target="_blank" class="block bg-gray-900/50 p-3 rounded-lg hover:bg-gray-800 transition cursor-pointer border-l-2 border-[#e10600] group">
                    <div class="flex justify-between items-start mb-1">
                        <span class="text-[10px] text-[#e10600] font-bold uppercase tracking-wider">News</span>
                        <span class="text-[10px] text-gray-500">${timeStr}</span>
                    </div>
                    <h3 class="text-sm font-medium text-gray-200 leading-tight group-hover:text-white transition line-clamp-2">${item.title}</h3>
                </a>
            `;
        });
        container.innerHTML = html;
    } catch (error) {
        console.error('News Error:', error);
        container.innerHTML = '<div class="text-red-400 text-xs text-center py-2">ไม่สามารถโหลดข่าวได้ในขณะนี้</div>';
    }
}

// 1.5 ดึงผลการแข่งขันล่าสุด (Latest Result) - เพื่อให้เห็นข้อมูลปัจจุบัน
async function fetchLastRace() {
    const container = document.getElementById('last-race-container');
    try {
        // 1. ค้นหา Race ล่าสุดที่จบไปแล้ว (ไม่เอา Practice/Qualifying)
        let year = new Date().getFullYear();
        let sessionRes = await fetchOpenF1(`/sessions?year=${year}&session_type=Race`);
        let sessions = sessionRes.ok ? await sessionRes.json() : [];

        // ถ้าปีนี้ยังไม่มีแข่ง หรือไม่เจอข้อมูล ให้ลองดูปีที่แล้ว
        if (!Array.isArray(sessions) || sessions.length === 0) {
            year--;
            sessionRes = await fetchOpenF1(`/sessions?year=${year}&session_type=Race`);
            sessions = sessionRes.ok ? await sessionRes.json() : [];
        }

        if (!Array.isArray(sessions) || sessions.length === 0) {
            container.innerHTML = '<div class="text-center text-gray-500 py-8">No session data found.</div>';
            return;
        }

        // กรองเฉพาะที่จบแล้ว และเรียงจากล่าสุด
        const now = new Date();
        const completedRaces = sessions
            .filter(s => new Date(s.date_end) < now)
            .sort((a, b) => new Date(b.date_start) - new Date(a.date_start));

        if (completedRaces.length === 0) {
            container.innerHTML = '<div class="text-center text-gray-500 py-8">No completed races found.</div>';
            return;
        }

        const lastRace = completedRaces[0];

        // ดึงข้อมูลนักขับและตำแหน่ง
        // CHANGE: ใช้ session_key ดึงข้อมูลนักขับ (เหมือนกับที่ใช้ใน Standings แล้วเวิร์ค)
        const [driversRes, resultRes] = await Promise.all([
            fetchOpenF1(`/drivers?session_key=${lastRace.session_key}`),
            fetchOpenF1(`/session_result?session_key=${lastRace.session_key}`)
        ]);

        let drivers = driversRes.ok ? await driversRes.json() : [];
        const resultsData = resultRes.ok ? await resultRes.json() : [];

        // Fallback: ถ้าดึงจาก Session ไม่ได้ (API เอ๋อ) ค่อยลองดึงแบบ Year
        if (!Array.isArray(drivers) || drivers.length === 0) {
            const yearDriversRes = await fetchOpenF1(`/drivers?year=${lastRace.year}`);
            if (yearDriversRes.ok) {
                drivers = await yearDriversRes.json();
            }
        }

        // Map ข้อมูลนักขับ
        const driverMap = {};
        if (Array.isArray(drivers)) {
            drivers.forEach(d => driverMap[String(d.driver_number)] = d);
        }

        // เรียงลำดับ 1-3
        const results = resultsData
            .map(r => ({ ...r, driverInfo: driverMap[String(r.driver_number)] }))
            .filter(p => p.driverInfo && p.position) // กรองเฉพาะที่มีข้อมูลนักขับและมีตำแหน่ง (ป้องกัน null/0)
            .sort((a, b) => a.position - b.position);

        if (results.length < 3) {
            container.innerHTML = '<div class="text-center text-gray-500 py-8">ข้อมูลผลการแข่งขันไม่สมบูรณ์</div>';
            return;
        }

        const winner = results[0];
        const second = results[1];
        const third = results[2];

        // Helper for safe display
        const getInfo = (d) => ({
            name: d.broadcast_name || d.full_name || d.last_name || d.name_acronym || 'Unknown',
            team: d.team_name || 'Unknown Team',
            img: d.headshot_url ? `<img src="${d.headshot_url}" class="w-full h-full object-cover">` : (d.name_acronym || '?')
        });

        const d1 = getInfo(winner.driverInfo);
        const d2 = getInfo(second.driverInfo);
        const d3 = getInfo(third.driverInfo);

        container.innerHTML = `
            <div class="bg-gradient-to-r from-[#15151e] to-[#2a2a35] p-0 rounded-2xl border border-gray-700 shadow-2xl relative overflow-hidden group">
                <!-- Background Effect -->
                <div class="absolute top-0 right-0 w-64 h-full bg-gradient-to-l from-[#e10600]/20 to-transparent transform skew-x-12 translate-x-10"></div>
                
                <div class="relative z-10 p-6 md:p-8">
                    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
                        <div>
                            <span class="text-[#e10600] font-bold text-xs uppercase tracking-[0.2em] mb-1 block">${lastRace.session_name} Result</span>
                            <h3 class="text-3xl md:text-4xl font-black italic text-white uppercase">${lastRace.location} GP</h3>
                            <p class="text-gray-400 text-sm mt-1 flex items-center gap-2"><i class="fa-solid fa-location-dot"></i> ${lastRace.circuit_short_name}</p>
                </div>
                        <div class="mt-4 md:mt-0">
                            <span class="bg-white text-black text-xs px-3 py-1 rounded font-bold uppercase tracking-wider">Finished</span>
                        </div>
                    </div>

                    <div class="flex items-end gap-4 md:gap-8 justify-center pb-4">
                        <!-- 2nd -->
                        <div class="flex-1 text-center order-1">
                            <div class="text-gray-500 text-xs font-bold mb-2 uppercase tracking-wider">2nd Place</div>
                            <div class="w-16 h-16 md:w-20 md:h-20 mx-auto bg-gray-800 rounded-full border-2 border-gray-500 flex items-center justify-center text-xl font-black italic mb-3 shadow-lg overflow-hidden">
                                ${d2.img}
                            </div>
                            <div class="font-bold text-sm md:text-base truncate text-gray-300">${d2.name}</div>
                            <div class="text-[10px] text-gray-500 uppercase">${d2.team}</div>
                        </div>
                        <!-- Winner -->
                        <div class="flex-1 text-center order-2 transform -translate-y-2">
                            <div class="text-[#e10600] text-2xl mb-2"><i class="fa-solid fa-crown"></i></div>
                            <div class="w-24 h-24 md:w-28 md:h-28 mx-auto bg-gray-800 rounded-full border-4 border-[#e10600] flex items-center justify-center text-3xl font-black italic mb-3 shadow-[0_0_20px_rgba(225,6,0,0.4)] text-white relative overflow-hidden">
                                ${d1.img}
                                <div class="absolute -bottom-3 bg-[#e10600] text-white text-[10px] px-2 py-0.5 rounded font-bold">WINNER</div>
                            </div>
                            <div class="font-black text-lg md:text-xl truncate text-white uppercase">${d1.name}</div>
                            <div class="text-xs text-[#e10600] font-bold uppercase mt-1">${d1.team}</div>
                        </div>
                        <!-- 3rd -->
                        <div class="flex-1 text-center order-3">
                            <div class="text-gray-500 text-xs font-bold mb-2 uppercase tracking-wider">3rd Place</div>
                            <div class="w-16 h-16 md:w-20 md:h-20 mx-auto bg-gray-800 rounded-full border-2 border-orange-700 flex items-center justify-center text-xl font-black italic mb-3 shadow-lg overflow-hidden">
                                ${d3.img}
                            </div>
                            <div class="font-bold text-sm md:text-base truncate text-gray-300">${d3.name}</div>
                            <div class="text-[10px] text-gray-500 uppercase">${d3.team}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        console.error(e);
        container.innerHTML = '<div class="text-red-400 text-center">ไม่สามารถโหลดผลล่าสุดได้</div>';
    }
}

// พิกัดสนามแข่ง (สำหรับดึงสภาพอากาศ)
const circuitLocations = {
    "Sakhir": { lat: 26.0325, lng: 50.5106 },
    "Jeddah": { lat: 21.6319, lng: 39.1044 },
    "Melbourne": { lat: -37.8497, lng: 144.968 },
    "Suzuka": { lat: 34.8431, lng: 136.541 },
    "Shanghai": { lat: 31.3389, lng: 121.221 },
    "Miami": { lat: 25.958, lng: -80.2389 },
    "Imola": { lat: 44.3439, lng: 11.7167 },
    "Monaco": { lat: 43.7347, lng: 7.4206 },
    "Montreal": { lat: 45.5017, lng: -73.5673 },
    "Montréal": { lat: 45.5017, lng: -73.5673 },
    "Barcelona": { lat: 41.57, lng: 2.2611 },
    "Spielberg": { lat: 47.2197, lng: 14.7647 },
    "Silverstone": { lat: 52.0786, lng: -1.0169 },
    "Budapest": { lat: 47.5769, lng: 19.2486 },
    "Spa-Francorchamps": { lat: 50.4372, lng: 5.9714 },
    "Zandvoort": { lat: 52.3888, lng: 4.5409 },
    "Monza": { lat: 45.6156, lng: 9.2811 },
    "Baku": { lat: 40.3725, lng: 49.8533 },
    "Singapore": { lat: 1.2914, lng: 103.864 },
    "Marina Bay": { lat: 1.2914, lng: 103.864 },
    "Austin": { lat: 30.1328, lng: -97.6411 },
    "Mexico City": { lat: 19.4042, lng: -99.0907 },
    "Sao Paulo": { lat: -23.7036, lng: -46.6997 },
    "São Paulo": { lat: -23.7036, lng: -46.6997 },
    "Las Vegas": { lat: 36.1147, lng: -115.173 },
    "Lusail": { lat: 25.4888, lng: 51.4542 },
    "Yas Island": { lat: 24.4672, lng: 54.6031 },
    "Yas Marina": { lat: 24.4672, lng: 54.6031 }
};

function getWeatherIcon(code) {
    if (code === 0) return '<i class="fa-solid fa-sun text-yellow-400"></i>';
    if (code >= 1 && code <= 3) return '<i class="fa-solid fa-cloud-sun text-gray-300"></i>';
    if (code >= 45 && code <= 48) return '<i class="fa-solid fa-smog text-gray-400"></i>';
    if (code >= 51 && code <= 67) return '<i class="fa-solid fa-cloud-rain text-blue-400"></i>';
    if (code >= 71 && code <= 77) return '<i class="fa-solid fa-snowflake text-white"></i>';
    if (code >= 80 && code <= 82) return '<i class="fa-solid fa-cloud-showers-heavy text-blue-500"></i>';
    if (code >= 95) return '<i class="fa-solid fa-bolt text-yellow-500"></i>';
    return '<i class="fa-solid fa-cloud text-gray-400"></i>';
}

// 2. ดึงข้อมูลตารางแข่ง (Schedule) จาก OpenF1 API
async function fetchSchedule() {
    try {
        // ใช้ OpenF1 API ดึงข้อมูล Session ของปีปัจจุบัน (แบบ Auth)
        const year = new Date().getFullYear();
        const response = await fetchOpenF1(`/sessions?year=${year}&session_type=Race`);
        const data = response.ok ? await response.json() : [];
        
        if (!Array.isArray(data)) throw new Error("No schedule data");

        const now = new Date();
        
        const upcoming = data.filter(session => {
            const raceDate = new Date(session.date_start);
            return raceDate >= now;
        }).sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
          .slice(0, 4); // เอาแค่ 4 สนามถัดไป

        const container = document.getElementById('race-container');
        
        if (upcoming.length === 0) {
            container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8 glass-card rounded-xl">End of Season. See you next year!</div>';
            return;
        }

        // ใช้ Promise.all เพื่อดึงสภาพอากาศพร้อมกัน
        const cardsHtml = await Promise.all(upcoming.map(async (session) => {
            const dateObj = new Date(session.date_start);
            const dateStr = dateObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
            const timeStr = dateObj.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
            
            // Logic ดึงสภาพอากาศ
            let weatherHtml = '';
            // ใช้พิกัดจาก map เดิม
            const loc = circuitLocations[session.location] || circuitLocations[session.circuit_short_name];
            
            if (loc) {
                const daysDiff = (dateObj - now) / (1000 * 60 * 60 * 24);
                // Open-Meteo ให้ข้อมูลล่วงหน้าประมาณ 14-16 วัน
                if (daysDiff <= 14 && daysDiff >= -1) {
                    try {
                        const dateKey = session.date_start.split('T')[0];
                        const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lng}&daily=weathercode,temperature_2m_max&timezone=auto&start_date=${dateKey}&end_date=${dateKey}`);
                        const wData = await wRes.json();
                        if (wData.daily && wData.daily.weathercode) {
                            const code = wData.daily.weathercode[0];
                            const maxTemp = wData.daily.temperature_2m_max[0];
                            const icon = getWeatherIcon(code);
                            weatherHtml = `
                                <div class="mt-3 pt-3 border-t border-gray-700/50 flex items-center gap-3 text-xs text-gray-300">
                                    <span class="text-lg">${icon}</span>
                                    <span>Forecast: <b class="text-white">${maxTemp}°C</b></span>
                                </div>
                            `;
                        }
                    } catch (e) { console.error('Weather error', e); }
                } else {
                    weatherHtml = `<div class="mt-3 pt-3 border-t border-gray-700/50 text-[10px] text-gray-500"><i class="fa-solid fa-hourglass-half"></i> Forecast available 14 days prior</div>`;
                }
            }

            return `
                <div class="glass-card p-5 rounded-xl hover:border-[#e10600] transition duration-300 group relative overflow-hidden">
                    <div class="absolute top-0 right-0 p-2 opacity-5 text-6xl font-black italic text-white select-none -mr-4 -mt-2">
                        F1
                    </div>
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[10px] font-bold text-[#e10600] uppercase tracking-widest">Upcoming</span>
                        <span class="text-xs text-gray-300 bg-white/10 px-2 py-1 rounded border border-white/10">${dateStr}</span>
                    </div>
                    <h3 class="text-xl font-black italic mb-1 group-hover:text-[#e10600] transition text-white uppercase tracking-tight">${session.location} GP</h3>
                    <p class="text-sm text-gray-400 mb-2 flex items-center gap-2">
                        <i class="fa-solid fa-location-dot text-[#e10600]"></i> ${session.circuit_short_name}
                    </p>
                    <div class="flex justify-between items-center text-sm mb-1">
                        <span class="font-mono text-gray-300 font-bold"><i class="fa-regular fa-clock text-[#e10600] mr-1"></i> ${timeStr} น.</span>
                        <span class="text-[10px] text-gray-500 uppercase tracking-wider">Race Session</span>
                    </div>
                    ${weatherHtml}
                </div>
            `;
        }));
        container.innerHTML = cardsHtml.join('');
    } catch (error) {
        console.error('Error fetching schedule:', error);
        document.getElementById('race-container').innerHTML = '<p class="text-red-400 col-span-full text-center">ไม่สามารถโหลดข้อมูลได้</p>';
    }
}

// 3. ดึงข้อมูลคะแนนสะสม (Standings)
let fullStandingsData = []; // To store calculated standings

async function fetchStandings() {
    const container = document.getElementById('standings-container');
    container.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-500"><div class="loader"></div><br>Calculating Standings...</td></tr>';

    try {
        let year = new Date().getFullYear();
        const racePoints = { 1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1 };
        const sprintPoints = { 1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 };

        // 1. Get all drivers for the season from the latest session
        let allSessions = [];
        
        // ลองดึงปีปัจจุบัน
        try {
            const res = await fetchOpenF1(`/sessions?year=${year}`);
            if (res.ok) allSessions = await res.json();
        } catch (e) {}

        // เช็คว่ามีการแข่งที่จบไปแล้วหรือยัง ถ้าไม่มีเลย ให้ไปดึงปีที่แล้ว
        const now = new Date();
        let hasCompletedRaces = Array.isArray(allSessions) && allSessions.some(s => new Date(s.date_end) < now);

        if (!hasCompletedRaces) {
            year = year - 1;
            try {
                const res = await fetchOpenF1(`/sessions?year=${year}`);
                if (res.ok) allSessions = await res.json();
            } catch (e) {}
        }

        if (!Array.isArray(allSessions) || allSessions.length === 0) throw new Error("No session data");

        allSessions.sort((a, b) => new Date(b.date_start) - new Date(a.date_start));
        const latestSessionKey = allSessions[0].session_key;

        const driversRes = await fetchOpenF1(`/drivers?session_key=${latestSessionKey}`);
        const drivers = await driversRes.json();
        if (!Array.isArray(drivers)) throw new Error("Could not fetch drivers.");

        const standingsMap = {};
        drivers.forEach(d => {
            standingsMap[d.driver_number] = {
                ...d,
                points: 0,
                wins: 0,
                position: 0
            };
        });

        // 2. Get all completed Race and Sprint sessions
        const completedRaces = allSessions.filter(s => s.session_type === 'Race' && new Date(s.date_end) < now);
        const completedSprints = allSessions.filter(s => s.session_type === 'Sprint' && new Date(s.date_end) < now);

        // 3. Calculate points for each session
        const allCompletedSessions = [...completedRaces, ...completedSprints];

        // Use Promise.all for parallel fetching to speed up
        await Promise.all(allCompletedSessions.map(async (session) => {
            try {
                const resRes = await fetchOpenF1(`/session_result?session_key=${session.session_key}`);
                if (!resRes.ok) return;
                const results = await resRes.json();
                if (!Array.isArray(results)) return;

                results.forEach(r => {
                    const driverNum = r.driver_number;
                    if (standingsMap[driverNum] && r.position) {
                        let pointsToAdd = 0;
                        if (session.session_type === 'Race') {
                            pointsToAdd = racePoints[r.position] || 0;
                            if (r.position === 1) {
                                standingsMap[driverNum].wins += 1;
                            }
                        } else if (session.session_type === 'Sprint') {
                            pointsToAdd = sprintPoints[r.position] || 0;
                        }
                        standingsMap[driverNum].points += pointsToAdd;
                    }
                });
            } catch (e) {
                console.error(`Error processing session ${session.session_key}`, e);
            }
        }));

        // 4. Finalize and sort
        const standingsArray = Object.values(standingsMap);
        standingsArray.sort((a, b) => b.points - a.points);
        
        standingsArray.forEach((d, index) => {
            d.position = index + 1;
        });

        fullStandingsData = standingsArray; // Store for modal
        
        renderStandings();

    } catch (error) {
        console.error('Error fetching standings from OpenF1:', error);
        container.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-red-400">โหลดข้อมูลคะแนนไม่สำเร็จ</td></tr>';
    }
}

function renderStandings() {
    const container = document.getElementById('standings-container');
    const dataToRender = fullStandingsData.slice(0, 10); // Show top 10
    const hasPoints = dataToRender.some(d => d.points > 0);
    let html = '';

    if (dataToRender.length === 0) {
        container.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-500">ยังไม่มีข้อมูลคะแนน</td></tr>';
        return;
    }

    dataToRender.forEach((driver, index) => {
        const isFirst = hasPoints && driver.position === 1;
        const posClass = isFirst ? 'text-[#e10600] text-lg' : 'text-gray-400';
        const rowClass = isFirst ? 'bg-[#e10600]/10' : '';
        const posDisplay = hasPoints ? driver.position : (index + 1);
        const pointsDisplay = hasPoints ? driver.points : '-';
        
        html += `
            <tr class="hover:bg-white/5 transition cursor-pointer group ${rowClass}" onclick="showDriverProfile(${driver.driver_number})">
                <td class="px-2 py-3 font-black italic ${posClass} text-center">${posDisplay}</td>
                <td class="px-2 py-3">
                    <div class="font-bold text-sm text-gray-200 group-hover:text-[#e10600] transition uppercase">${driver.first_name} <span class="text-white">${driver.last_name}</span></div>
                    <div class="text-[10px] text-gray-500 uppercase tracking-wider">${driver.team_name}</div>
                </td>
                <td class="px-2 py-3 text-right font-mono font-bold text-[#e10600]">${pointsDisplay}</td>
            </tr>
        `;
    });
    container.innerHTML = html;
}

// 4. ฟังก์ชันจัดการ Modal และดึงข้อมูลนักแข่ง
async function showDriverProfile(driverNumber) {
    const modal = document.getElementById('driver-modal');
    const content = document.getElementById('modal-content');
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    content.innerHTML = '<div class="loader mt-4"></div><p class="mt-4 text-gray-400 text-sm">กำลังโหลดข้อมูลนักแข่ง...</p>';

    try {
        // Find the driver data from our pre-calculated standings
        const driver = fullStandingsData.find(d => d.driver_number === driverNumber);

        if (!driver) {
            throw new Error("Driver data not found in standings.");
        }

        // Use headshot_url from OpenF1 data
        const imageUrl = driver.headshot_url || 'https://placehold.co/600x800/1e1e24/FFF?text=No+Image';

        content.innerHTML = `
            <div class="flex flex-col md:flex-row gap-0 md:gap-6 text-left h-full">
                <!-- รูปภาพ (ซ้าย) -->
                <div class="w-full md:w-5/12 relative bg-gradient-to-b from-gray-800 to-black min-h-[300px] md:min-h-full">
                    <img src="${imageUrl}" alt="${driver.full_name}" class="w-full h-full object-cover absolute inset-0 mix-blend-overlay opacity-80 md:opacity-100 md:mix-blend-normal">
                    <div class="absolute bottom-0 left-0 w-full bg-gradient-to-t from-[#1e1e24] via-[#1e1e24]/80 to-transparent p-6 pt-20 md:hidden"></div>
                    <div class="absolute bottom-4 left-4 md:top-4 md:left-4 text-6xl font-black italic text-white/10 select-none z-0">
                        ${driver.driver_number || 'F1'}
                    </div>
                </div>
                
                <!-- ข้อมูล (ขวา) -->
                <div class="w-full md:w-7/12 flex flex-col justify-center p-6 md:pl-0 relative z-10 -mt-10 md:mt-0">
                    <div class="mb-6">
                        <div class="text-[#e10600] font-bold text-xs uppercase tracking-[0.3em] mb-1">${driver.country_code || 'N/A'}</div>
                        <h2 class="text-4xl md:text-5xl font-black italic text-white uppercase leading-[0.9] mb-2 drop-shadow-lg">${driver.first_name}<br><span class="text-transparent bg-clip-text bg-gradient-to-r from-[#e10600] to-orange-500">${driver.last_name}</span></h2>
                        <div class="text-xl text-gray-300 font-bold border-l-4 border-[#e10600] pl-3">${driver.team_name}</div>
                    </div>
                    
                    <div class="grid grid-cols-2 gap-3 mb-6">
                        <div class="bg-black/40 p-3 rounded-lg border border-gray-700/50 backdrop-blur-sm">
                            <div class="text-[10px] text-gray-500 uppercase tracking-wider">Points</div>
                            <div class="text-2xl font-bold text-white">${driver.points}</div>
                        </div>
                        <div class="bg-black/40 p-3 rounded-lg border border-gray-700/50 backdrop-blur-sm">
                            <div class="text-[10px] text-gray-500 uppercase tracking-wider">Rank</div>
                            <div class="text-2xl font-bold text-[#e10600]">#${driver.position}</div>
                        </div>
                        <div class="bg-black/40 p-3 rounded-lg border border-gray-700/50 backdrop-blur-sm">
                            <div class="text-[10px] text-gray-500 uppercase tracking-wider">Wins</div>
                            <div class="text-2xl font-bold text-white">${driver.wins}</div>
                        </div>
                        <div class="bg-black/40 p-3 rounded-lg border border-gray-700/50 backdrop-blur-sm">
                            <div class="text-[10px] text-gray-500 uppercase tracking-wider">Number</div>
                            <div class="text-2xl font-bold text-white">${driver.driver_number}</div>
                        </div>
                    </div>

                    <p class="text-center text-xs text-gray-600">Driver data from OpenF1 API.</p>
                </div>
            </div>
        `;
    } catch (error) {
        console.error(error);
        content.innerHTML = '<div class="text-red-400 py-4"><i class="fa-solid fa-circle-exclamation text-3xl mb-2"></i><br>ไม่สามารถโหลดข้อมูลได้</div>';
    }
}

function closeModal() {
    const modal = document.getElementById('driver-modal');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
}

// ปิด Modal เมื่อคลิกพื้นที่ว่างรอบนอก
document.getElementById('driver-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
});

// เริ่มทำงานเมื่อโหลดหน้าเว็บ
document.addEventListener('DOMContentLoaded', () => {
    fetchNextSession(); // เรียกฟังก์ชันนับถอยหลัง
    fetchNews();
    fetchLastRace(); // เรียกฟังก์ชันใหม่
    fetchSchedule();
    fetchStandings();
});

// --- LIVE DASHBOARD LOGIC ---
let mqttClient = null;
let dashboardInterval = null;
let dashboardData = {
    session: null,
    drivers: [],
    laps: {},
    positions: {},
    intervals: {}
};

let selectedDriver = null; // เก็บ Driver Number ที่เลือก
let selectedDriver2 = null; // เก็บ Driver Number คนที่ 2

// --- Replay Logic ---
let replayState = {
    active: false,
    playing: false,
    speed: 10,
    startTime: 0,
    endTime: 0,
    currentTime: 0,
    timer: null
};
let replayBuffer = {
    intervals: [],
    laps: [],
    race_control: [],
    positions: [],
    car_data: {}, // { driver_number: [data] }
    location: {}  // { driver_number: [data] }
};

// --- Track Map Logic ---
let trackPath = [];
let mapBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };

async function toggleDashboard(show) {
    const dashboard = document.getElementById('live-dashboard');
    if (show) {
        dashboard.classList.add('active');
        document.body.style.overflow = 'hidden'; // ป้องกันหน้าหลักเลื่อน
        await initDashboard();
    } else {
        dashboard.classList.remove('active');
        document.body.style.overflow = '';
        
        // Disconnect MQTT
        if (mqttClient) {
            mqttClient.end();
            mqttClient = null;
            console.log("MQTT Disconnected");
        }
        if (dashboardInterval) {
            clearInterval(dashboardInterval);
            dashboardInterval = null;
        }
        stopReplay();
    }
}

async function initDashboard() {
    // Reset Data
    dashboardData = { session: null, drivers: [], laps: {}, positions: {}, intervals: {}, locations: {}, grid: {}, car_data: {} };
    const tbody = document.getElementById('timing-body');
    const headerName = document.getElementById('dash-session-name');
    const headerTrack = document.getElementById('dash-track');
    const statusEl = document.getElementById('dash-status');
    const flagBar = document.getElementById('flag-status-bar');
    const replayControls = document.getElementById('replay-controls');
    
    // Reset UI
    if(flagBar) flagBar.classList.add('hidden');
    replayControls.classList.add('hidden');
    statusEl.innerHTML = 'LOADING...';

    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500"><div class="loader mx-auto mb-2"></div>Loading Session Data...</td></tr>';

    try {
        // 1. ใช้ session_key=latest เพื่อดึง Session ล่าสุดจาก API โดยตรง
        let sessionRes = await fetchOpenF1(`/sessions?session_key=latest`);
        let sessions = sessionRes.ok ? await sessionRes.json() : [];
        
        if (!Array.isArray(sessions) || sessions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-gray-500">No session data found.</td></tr>';
            return;
        }

        let latestSession = sessions[0];
        const now = new Date();
        
        if (!latestSession) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-gray-500">No session data found.</td></tr>';
            return;
        }

        dashboardData.session = latestSession;
        
        // Update Header
        headerName.innerText = `${latestSession.location} GP - ${latestSession.session_name}`;
        headerTrack.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${latestSession.circuit_short_name}`;

        // Check Status
        const startTime = new Date(latestSession.date_start);
        const endTime = new Date(latestSession.date_end);

        if (now < startTime) {
            statusEl.innerHTML = '<span class="text-yellow-500 font-bold uppercase tracking-wider">UPCOMING</span>';
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-gray-400"><i class="fa-regular fa-clock text-4xl mb-2"></i><br>Session starts at ${startTime.toLocaleTimeString()}</td></tr>`;
            return;
        }

        const isLive = now < new Date(endTime.getTime() + 2 * 60 * 60 * 1000);

        // 2. Fetch Drivers (Static per session)
        const driversRes = await fetchOpenF1(`/drivers?session_key=${latestSession.session_key}`);
        const driversData = await driversRes.json();
        
        if (Array.isArray(driversData)) {
            dashboardData.drivers = driversData;
        } else {
            console.warn("Invalid drivers data:", driversData);
            dashboardData.drivers = [];
        }

        // Try to fetch Grid Positions (from session_result)
        try {
            const resRes = await fetchOpenF1(`/session_result?session_key=${latestSession.session_key}`);
            if (resRes.ok) {
                const results = await resRes.json();
                results.forEach(r => {
                    if (r.grid_position) dashboardData.grid[r.driver_number] = r.grid_position;
                });
            }
        } catch (e) { console.log("Grid data not available yet"); }

        if (isLive) {
            statusEl.innerHTML = '<span class="text-green-500 font-bold uppercase tracking-wider animate-pulse">LIVE (STREAMING)</span>';
            
            // Fetch Initial Snapshot
            await fetchSnapshot(latestSession.session_key);
            renderDashboardTable();

            // Connect MQTT for Real-time updates
            connectMqtt(latestSession.session_key);
            
            // Default select leader (if available later) or first driver
            if (dashboardData.drivers.length > 0) {
                selectDriver(dashboardData.drivers[0].driver_number);
            }
            
            // Fetch Track Path (using first driver)
            if (dashboardData.drivers.length > 0) {
                fetchTrackPath(latestSession.session_key, dashboardData.drivers[0].driver_number);
            }

            // FIX: Polling backup (every 10s) to ensure data updates if MQTT fails
            if (dashboardInterval) clearInterval(dashboardInterval);
            dashboardInterval = setInterval(() => {
                const nowIso = new Date(Date.now() - 60000).toISOString(); // Fetch last 1 min
                fetchSnapshot(latestSession.session_key, `&date>=${nowIso}`);
            }, 10000);
        } else {
            statusEl.innerHTML = '<span class="text-red-500 font-bold uppercase tracking-wider">REPLAY (OFFLINE)</span>';
            replayControls.classList.remove('hidden');
            
            // Initialize Replay System
            tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500"><div class="loader mx-auto mb-2"></div>Loading Replay Data...<br><span class="text-xs">This may take a moment</span></td></tr>';
            await initReplay(latestSession);
            
            // Fetch Track Path
            if (dashboardData.drivers.length > 0) {
                fetchTrackPath(latestSession.session_key, dashboardData.drivers[0].driver_number);
            }
        }

    } catch (error) {
        console.error("Dashboard Error:", error);
        let msg = error.message;
        if (msg.includes("API Restricted")) {
            msg = `<span class="font-bold text-lg">Live Timing Unavailable</span><br>OpenF1 API restricts free access during live sessions.<br><span class="text-sm text-gray-400">Please use the official F1 App or wait until the session ends.</span>`;
        }
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-red-400">${msg}</td></tr>`;
    }
}

async function fetchSnapshot(sessionKey, filter = '') {
    // Fetch latest state for Laps, Intervals, Position
    const [lapsRes, posRes, intRes] = await Promise.all([
        fetchOpenF1(`/laps?session_key=${sessionKey}${filter}`),
        fetchOpenF1(`/position?session_key=${sessionKey}${filter}`),
        fetchOpenF1(`/intervals?session_key=${sessionKey}${filter}`)
    ]);

    const laps = await lapsRes.json().catch(e => []);
    const positions = await posRes.json().catch(e => []);
    const intervals = await intRes.json().catch(e => []);

    // Process Laps
    if (Array.isArray(laps)) {
        laps.forEach(lap => {
            if (!dashboardData.laps[lap.driver_number] || lap.lap_number > dashboardData.laps[lap.driver_number].lap_number) {
                dashboardData.laps[lap.driver_number] = lap;
            }
        });
    }
    
    // Process Positions
    if (Array.isArray(positions)) {
        positions.forEach(p => {
            if (!dashboardData.positions[p.driver_number] || new Date(p.date) > new Date(dashboardData.positions[p.driver_number].date)) {
                dashboardData.positions[p.driver_number] = p;
            }
        });
    }

    // Process Intervals
    if (Array.isArray(intervals)) {
        intervals.forEach(i => {
            if (!dashboardData.intervals[i.driver_number] || new Date(i.date) > new Date(dashboardData.intervals[i.driver_number].date)) {
                dashboardData.intervals[i.driver_number] = i;
            }
        });
    }
}

async function fetchReplayDriverData(driverNumber) {
    const sessionKey = dashboardData.session.session_key;
    if (!sessionKey || !driverNumber) return;

    // Indicate loading on graph header
    const nameEl = document.getElementById('telemetry-driver-name');
    const originalHtml = nameEl.innerHTML;
    nameEl.innerHTML = `<span class="animate-pulse">Loading Telemetry for ${driverNumber}...</span>`;

    try {
        // Fetch both car_data and location data for the specific driver
        const [carDataRes, locationRes] = await Promise.all([
            fetchOpenF1(`/car_data?session_key=${sessionKey}&driver_number=${driverNumber}`),
            fetchOpenF1(`/location?session_key=${sessionKey}&driver_number=${driverNumber}`)
        ]);

        if (carDataRes.ok) {
            const data = await carDataRes.json();
            if (Array.isArray(data)) {
                data.sort((a, b) => new Date(a.date) - new Date(b.date));
                replayBuffer.car_data[driverNumber] = data;
            }
        }
        if (locationRes.ok) {
            const data = await locationRes.json();
            if (Array.isArray(data)) {
                data.sort((a, b) => new Date(a.date) - new Date(b.date));
                replayBuffer.location[driverNumber] = data;
            }
        }

    } catch (e) {
        console.error(`Failed to fetch replay data for driver ${driverNumber}`, e);
        // Optionally show an error to the user
    } finally {
        // Restore header text
        // A small delay might be needed if the update is too fast
        setTimeout(() => {
            if (nameEl.innerHTML.includes('Loading')) updateTelemetryHeader();
        }, 500);
    }
}

// --- REPLAY SYSTEM FUNCTIONS ---

async function initReplay(session) {
    replayState.active = true;
    replayState.startTime = new Date(session.date_start).getTime();
    replayState.endTime = new Date(session.date_end).getTime();
    replayState.currentTime = replayState.startTime;
    
    // Fetch Full History
    try {
        const [intRes, lapsRes, posRes, rcRes] = await Promise.all([
            fetchOpenF1(`/intervals?session_key=${session.session_key}`),
            fetchOpenF1(`/laps?session_key=${session.session_key}`),
            fetchOpenF1(`/position?session_key=${session.session_key}`),
            fetchOpenF1(`/race_control?session_key=${session.session_key}`)
        ]);

        replayBuffer.intervals = intRes.ok ? await intRes.json() : [];
        replayBuffer.laps = lapsRes.ok ? await lapsRes.json() : [];
        replayBuffer.positions = posRes.ok ? await posRes.json() : [];
        replayBuffer.race_control = rcRes.ok ? await rcRes.json() : [];

        // Sort data by date
        const sortByDate = (a, b) => new Date(a.date) - new Date(b.date);
        replayBuffer.intervals.sort(sortByDate);
        replayBuffer.laps.sort(sortByDate);
        replayBuffer.positions.sort(sortByDate);
        replayBuffer.race_control.sort(sortByDate);

        // Fetch Location for ALL drivers (for Live Tracker)
        // This might take a moment, so we do it in background or await
        const driverNumbers = dashboardData.drivers.map(d => d.driver_number);
        await Promise.all(driverNumbers.map(async (num) => {
            const res = await fetchOpenF1(`/location?session_key=${session.session_key}&driver_number=${num}`);
            if (res.ok) {
                const data = await res.json();
                data.sort((a, b) => new Date(a.date) - new Date(b.date));
                replayBuffer.location[num] = data;
            }
        }));
        // Fetch Car Data for ALL drivers (for Table)
        await Promise.all(driverNumbers.map(async (num) => {
            const res = await fetchOpenF1(`/car_data?session_key=${session.session_key}&driver_number=${num}`);
            if (res.ok) {
                const data = await res.json();
                data.sort((a, b) => new Date(a.date) - new Date(b.date));
                replayBuffer.car_data[num] = data;
            }
        }));

        // Setup UI
        document.getElementById('replay-total-time').innerText = formatReplayTime(replayState.endTime - replayState.startTime);
        document.getElementById('replay-slider').value = 0;
        
        // Initial Render
        updateReplayFrame();
        
        // Auto play
        playReplay();

    } catch (e) {
        console.error("Replay Init Error", e);
        document.getElementById('timing-body').innerHTML = '<tr><td colspan="9" class="text-center py-4 text-red-500">Failed to load replay data.</td></tr>';
    }
}

function toggleReplay() {
    if (replayState.playing) pauseReplay();
    else playReplay();
}

function playReplay() {
    if (!replayState.active) return;
    replayState.playing = true;
    
    const btn = document.getElementById('replay-play-btn');
    if(btn) btn.innerHTML = '<i class="fa-solid fa-pause pl-0"></i>';

    if (replayState.timer) clearInterval(replayState.timer);
    
    const updateInterval = 100; // Update UI every 100ms
    replayState.timer = setInterval(() => {
        // Advance time: speed * real_time_passed
        replayState.currentTime += replayState.speed * updateInterval;
        
        if (replayState.currentTime >= replayState.endTime) {
            replayState.currentTime = replayState.endTime;
            pauseReplay();
        }
        
        updateReplayFrame();
        
        // Update Slider
        const progress = (replayState.currentTime - replayState.startTime) / (replayState.endTime - replayState.startTime) * 100;
        document.getElementById('replay-slider').value = progress;
        
    }, updateInterval);
}

function pauseReplay() {
    replayState.playing = false;
    if (replayState.timer) clearInterval(replayState.timer);
    const btn = document.getElementById('replay-play-btn');
    if(btn) btn.innerHTML = '<i class="fa-solid fa-play pl-1"></i>';
}

function stopReplay() {
    pauseReplay();
    replayState.active = false;
    replayBuffer = { intervals: [], laps: [], positions: [], race_control: [], car_data: {}, location: {} };
}

function setReplaySpeed(speed) {
    replayState.speed = parseInt(speed);
}

function seekReplay(percent) {
    if (!replayState.active) return;
    const duration = replayState.endTime - replayState.startTime;
    replayState.currentTime = replayState.startTime + (duration * (percent / 100));
    updateReplayFrame();
}

function updateReplayFrame() {
    // Update Time Display
    const elapsed = replayState.currentTime - replayState.startTime;
    document.getElementById('replay-current-time').innerText = formatReplayTime(elapsed);

    // --- Update Data State for current time ---

    // 1. Intervals
    dashboardData.intervals = {};
    for (const item of replayBuffer.intervals) {
        if (new Date(item.date).getTime() > replayState.currentTime) break;
        dashboardData.intervals[item.driver_number] = item;
    }

    // 2. Positions (Source of Truth for Ordering)
    dashboardData.positions = {};
    for (const item of replayBuffer.positions) {
        if (new Date(item.date).getTime() > replayState.currentTime) break;
        dashboardData.positions[item.driver_number] = item;
    }

    // 3. Update Laps
    for (const item of replayBuffer.laps) {
        if (new Date(item.date_start).getTime() > replayState.currentTime) break;
        dashboardData.laps[item.driver_number] = item;
    }

    // 4. Update Car Data (for Table)
    dashboardData.car_data = {};
    if (replayBuffer.car_data) {
        Object.keys(replayBuffer.car_data).forEach(driverNum => {
            const carData = replayBuffer.car_data[driverNum];
            if (carData && carData.length > 0) {
                for (let i = carData.length - 1; i >= 0; i--) {
                    if (new Date(carData[i].date).getTime() <= replayState.currentTime) {
                        dashboardData.car_data[driverNum] = carData[i];
                        break;
                    }
                }
            }
        });
    }

    // 5. Update Race Control (for Flags)
    for (const item of replayBuffer.race_control) {
        if (new Date(item.date).getTime() > replayState.currentTime) break;
        updateFlagStatus(item);
    }

    // 6. Update Locations (for Track Map)
    dashboardData.locations = {};
    if (replayBuffer.location) {
        Object.keys(replayBuffer.location).forEach(driverNum => {
            const locData = replayBuffer.location[driverNum];
            if (locData && locData.length > 0 && dashboardData.drivers.find(d => d.driver_number == driverNum)) {
                // Find last known location. This is slow but will work for now.
                for (let i = locData.length - 1; i >= 0; i--) {
                    if (new Date(locData[i].date).getTime() <= replayState.currentTime) {
                        dashboardData.locations[driverNum] = { x: locData[i].x, y: locData[i].y };
                        break;
                    }
                }
            }
        });
    }

    // --- Trigger UI Renders ---
    renderDashboardTable();
    drawTrackMap();
}

function formatReplayTime(ms) {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
}

let lastFlagClearTimer = null;
function updateFlagStatus(message) {
    const bar = document.getElementById('flag-status-bar');
    if (!bar || !message) return;

    // Clear previous timer if a new flag comes in
    if (lastFlagClearTimer) clearTimeout(lastFlagClearTimer);

    const flag = message.flag ? message.flag.toUpperCase() : "CLEAR";
    let bgColor = '';
    let text = flag;

    switch (flag) {
        case 'YELLOW':
            bgColor = 'bg-yellow-400 animate-pulse';
            text = `YELLOW FLAG ${message.scope === 'Sector' ? `SECTOR ${message.sector}` : ''}`;
            break;
        case 'RED':
            bgColor = 'bg-red-600 animate-pulse';
            text = 'RED FLAG - SESSION STOPPED';
            break;
        case 'GREEN':
            bgColor = 'bg-green-500';
            text = 'GREEN FLAG - TRACK CLEAR';
            break;
        case 'SC':
            bgColor = 'bg-yellow-400';
            text = 'SAFETY CAR DEPLOYED';
            break;
        case 'VSC':
            bgColor = 'bg-yellow-400';
            text = 'VIRTUAL SAFETY CAR';
            break;
        case 'CLEAR':
            // This is a special case to hide the bar
            bar.classList.add('hidden');
            return;
        default:
            // For unknown flags, just hide it
            bar.classList.add('hidden');
            return;
    }
    
    bar.className = `text-center p-2 text-xl md:text-2xl font-black uppercase tracking-widest text-black transition-all duration-300 z-20 relative ${bgColor}`;
    bar.innerText = text;
    bar.classList.remove('hidden');

    // If the flag is green or clear, hide it after a few seconds
    if (flag === 'GREEN' || flag === 'CLEAR') {
        lastFlagClearTimer = setTimeout(() => bar.classList.add('hidden'), 5000);
    }
}

async function connectMqtt(sessionKey) {
    const token = await getOpenF1Token();
    if (!token) return;

    const options = {
        username: CONFIG.OPENF1_USER,
        password: token
    };

    // Connect to OpenF1 MQTT over Websockets
    mqttClient = mqtt.connect('wss://mqtt.openf1.org:8084/mqtt', options);

    mqttClient.on('connect', () => {
        console.log('MQTT Connected');
        // Subscribe to topics
        mqttClient.subscribe('v1/laps');
        mqttClient.subscribe('v1/position');
        mqttClient.subscribe('v1/intervals');
        mqttClient.subscribe('v1/race_control');
        mqttClient.subscribe('v1/location'); // Subscribe Location
        mqttClient.subscribe('v1/car_data'); // Subscribe Telemetry
    });

    mqttClient.on('message', (topic, message) => {
        const msg = JSON.parse(message.toString());
        
        // Filter by session
        if (msg.session_key != sessionKey) return;

        const driverNum = msg.driver_number;
        
        if (topic === 'v1/laps') {
            // Only update if lap number is >= current
            if (!dashboardData.laps[driverNum] || msg.lap_number >= dashboardData.laps[driverNum].lap_number) {
                dashboardData.laps[driverNum] = msg;
            }
        } else if (topic === 'v1/position') {
            dashboardData.positions[driverNum] = msg;
        } else if (topic === 'v1/intervals') {
            dashboardData.intervals[driverNum] = msg;
        } else if (topic === 'v1/race_control') {
            updateFlagStatus(msg);
        } else if (topic === 'v1/location') {
            if (!dashboardData.locations) dashboardData.locations = {};
            // Store latest location
            dashboardData.locations[driverNum] = { x: msg.x, y: msg.y };
        } else if (topic === 'v1/car_data') {
            dashboardData.car_data[driverNum] = msg;
        }

        // Trigger Render (Throttled via requestAnimationFrame)
        requestRender();
    });
}

let renderPending = false;
function requestRender() {
    if (!renderPending) {
        renderPending = true;
        requestAnimationFrame(() => {
            renderDashboardTable();
            renderPending = false;
            
            // Update Chart here as well
            drawTrackMap();
        });
    }
}

function renderDashboardTable() {
    const tbody = document.getElementById('timing-body');
    let tableHtml = '';

    // Sort drivers by position
    const sortedDrivers = (dashboardData.drivers || []).sort((a, b) => {
            // Use current position if available, otherwise fallback to grid position, otherwise 99
            const posA = dashboardData.positions[a.driver_number]?.position || dashboardData.grid[a.driver_number] || 99;
            const posB = dashboardData.positions[b.driver_number]?.position || dashboardData.grid[b.driver_number] || 99;
            return posA - posB;
    });

    sortedDrivers.forEach((driver, index) => {
        const lap = dashboardData.laps[driver.driver_number] || {};
        const carData = dashboardData.car_data ? (dashboardData.car_data[driver.driver_number] || {}) : {};
        const pos = dashboardData.positions[driver.driver_number] ? dashboardData.positions[driver.driver_number].position : '-';
        const teamColor = '#' + (driver.team_colour || 'ffffff');
        
        const intervalData = dashboardData.intervals[driver.driver_number];
        let gap = '-';
        let interval = '-';

        if (intervalData) {
            gap = intervalData.gap_to_leader !== null ? `+${parseFloat(intervalData.gap_to_leader).toFixed(3)}` : 'Leader';
            interval = intervalData.interval !== null ? `+${parseFloat(intervalData.interval).toFixed(3)}` : '-';
            if (index === 0) { gap = 'Leader'; interval = '-'; }
        } else {
            gap = index === 0 ? 'Leader' : '';
        }

        let driverName = driver.broadcast_name || driver.full_name || driver.name_acronym || 'Unknown';
        if (!driver.broadcast_name && driver.first_name && driver.last_name) driverName = `${driver.first_name} ${driver.last_name}`;

        // Highlight Selected Row
        let rowClass = 'hover:bg-[#222] border-l-4 border-transparent';
        if (selectedDriver == driver.driver_number) {
            rowClass = 'bg-white/10 border-l-4 border-[#e10600]';
        } else if (selectedDriver2 == driver.driver_number) {
            rowClass = 'bg-white/10 border-l-4 border-[#3b82f6]';
        }

        tableHtml += `
            <tr class="timing-row cursor-pointer transition ${rowClass}" onclick="selectDriver(${driver.driver_number})">
                <td class="text-center font-bold">${pos}</td>
                <td class="font-mono font-bold" style="color:${teamColor}">${driver.driver_number}</td>
                <td>
                    <div class="font-bold text-white leading-tight">${driverName}</div>
                    <div class="text-[10px] text-gray-500 uppercase">${driver.team_name || ''}</div>
                </td>
                <td class="text-right font-mono text-xs">${gap}</td>
                <td class="text-right font-mono text-xs">${interval}</td>
                <td class="text-center font-mono text-xs"><span class="sector-dot bg-sector-green"></span>${lap.duration_sector_1 || '-'}</td>
                <td class="text-center font-mono text-xs"><span class="sector-dot bg-sector-yellow"></span>${lap.duration_sector_2 || '-'}</td>
                <td class="text-center font-mono text-xs"><span class="sector-dot bg-sector-purple"></span>${lap.duration_sector_3 || '-'}</td>
                <td class="text-right font-mono font-bold text-white">${(lap.lap_duration && typeof lap.lap_duration === 'number') ? lap.lap_duration.toFixed(3) : '-'}</td>
                <td class="text-center font-mono font-bold text-white">${carData.n_gear || '-'}</td>
                <td class="text-right font-mono font-bold text-white pr-4">${carData.speed || '-'}</td>
            </tr>
        `;
    });

    tbody.innerHTML = tableHtml;
}

async function fetchTrackPath(sessionKey, driverNum) {
    try {
        // Fetch locations for track shape
        const res = await fetchOpenF1(`/location?session_key=${sessionKey}&driver_number=${driverNum}`);
        const data = res.ok ? await res.json() : [];
        
        if (data.length > 0) {
            // Downsample
            trackPath = data.filter((_, i) => i % 5 === 0).map(d => ({x: d.x, y: d.y}));
            
            // Calculate Bounds
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            trackPath.forEach(p => {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            });
            
            const padding = 1000;
            mapBounds = { 
                minX: minX - padding, maxX: maxX + padding, 
                minY: minY - padding, maxY: maxY + padding, 
                width: (maxX - minX) + 2*padding, height: (maxY - minY) + 2*padding 
            };
        }
    } catch (e) { console.error("Track Path Error", e); }
}

function drawTrackMap() {
    const canvas = document.getElementById('trackMap');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width;
    canvas.height = rect.height;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    if (trackPath.length === 0) {
        ctx.fillStyle = '#666';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Loading Track...', canvas.width/2, canvas.height/2);
        return;
    }

    const scale = Math.min(canvas.width / mapBounds.width, canvas.height / mapBounds.height);
    const offsetX = (canvas.width - mapBounds.width * scale) / 2;
    const offsetY = (canvas.height - mapBounds.height * scale) / 2;

    const transform = (x, y) => ({
        x: offsetX + (x - mapBounds.minX) * scale,
        y: canvas.height - (offsetY + (y - mapBounds.minY) * scale) // Flip Y
    });

    // Draw Track
    ctx.beginPath();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 4;
    trackPath.forEach((p, i) => {
        const pos = transform(p.x, p.y);
        if (i === 0) ctx.moveTo(pos.x, pos.y); else ctx.lineTo(pos.x, pos.y);
    });
    ctx.stroke();

    // Draw Drivers
    if (dashboardData.locations) {
        Object.keys(dashboardData.locations).forEach(driverNum => {
            const loc = dashboardData.locations[driverNum];
            const pos = transform(loc.x, loc.y);
            const driver = dashboardData.drivers.find(d => d.driver_number == driverNum);
            const color = driver ? `#${driver.team_colour}` : '#fff';
            
            // Dot
            ctx.beginPath();
            ctx.fillStyle = color;
            ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            // Label
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(driverNum, pos.x, pos.y - 7);
        });
    }
}

// --- LANGUAGE TRANSLATION ---
const translations = {
    en: {
        latest: "Latest",
        schedule: "Schedule",
        highlights: "Highlights",
        liveTiming: "Live Timing",
        latestGP: "Latest Grand Prix",
        latestHighlights: "Latest Highlights",
        upcomingSchedule: "Upcoming Schedule",
        driverStandings: "Driver Standings",
        latestUpdates: "Latest Updates",
        all: "All",
        raceQuali: "Race/Quali",
        practice: "Practice",
        interview: "Interview",
        dataProvided: "Data provided by",
        fanSite: "Unofficial Fan Site.",
        pos: "Pos",
        driver: "Driver",
        gap: "Gap",
        interval: "Interval",
        lapTime: "Lap Time",
        airTemp: "Air Temp"
    },
    th: {
        latest: "ล่าสุด",
        schedule: "ตารางแข่ง",
        highlights: "ไฮไลท์",
        liveTiming: "จับเวลาสด",
        latestGP: "ผลการแข่งขันล่าสุด",
        latestHighlights: "คลิปไฮไลท์",
        upcomingSchedule: "ตารางแข่งถัดไป",
        driverStandings: "คะแนนสะสมนักขับ",
        latestUpdates: "อัปเดตล่าสุด",
        all: "ทั้งหมด",
        raceQuali: "แข่ง/ควอลิฟาย",
        practice: "ซ้อม",
        interview: "สัมภาษณ์",
        dataProvided: "ข้อมูลจาก",
        fanSite: "แฟนไซต์ (ไม่เป็นทางการ)",
        pos: "อันดับ",
        driver: "นักขับ",
        gap: "ห่างผู้นำ",
        interval: "ห่างคันหน้า",
        lapTime: "เวลาต่อรอบ",
        airTemp: "อุณหภูมิ"
    }
};

let currentLang = 'en';

function toggleLanguage() {
    currentLang = currentLang === 'en' ? 'th' : 'en';
    updateLanguage();
}

function updateLanguage() {
    const t = translations[currentLang];
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (t[key]) {
            el.innerText = t[key];
        }
    });
}