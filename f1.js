// 0. ระบบนับถอยหลัง (Countdown)
let countdownInterval;

async function fetchNextSession() {
    try {
        const year = new Date().getFullYear();
        // ดึงข้อมูล Session ทั้งหมด (FP1, FP2, Quali, Race ฯลฯ)
        const response = await fetch(`https://api.openf1.org/v1/sessions?year=${year}`);
        const data = await response.json();
        
        const now = new Date();
        // กรองเอาเฉพาะอนาคต และเรียงตามเวลา
        const upcoming = data
            .filter(s => new Date(s.date_start) > now)
            .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

        if (upcoming.length === 0) return;

        const next = upcoming[0];
        setupCountdown(next);
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

// ตัวแปรเก็บข้อมูลคลิปทั้งหมดเพื่อใช้ในการ Filter
let allHighlights = [];

// 1.2 ดึงคลิปไฮไลท์จาก YouTube (Official F1 Channel)
async function fetchHighlights() {
    const container = document.getElementById('highlights-container');
    
    try {
        // เปลี่ยนมาใช้ Channel ของ beIN SPORTS Thailand
        const channelId = 'UCjKaVLLwalH_DSCHaricw3w';
        const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        
        // ใช้ corsproxy.io แทน (เสถียรกว่าสำหรับ YouTube RSS)
        const response = await fetch(`https://corsproxy.io/?url=${encodeURIComponent(rssUrl)}`);
        if (!response.ok) throw new Error('Network response was not ok');
        const text = await response.text();

        // แปลง XML String เป็น DOM Object
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");
        const entries = Array.from(xmlDoc.querySelectorAll("entry"));

        // เก็บข้อมูลลงตัวแปร global พร้อมจัดหมวดหมู่
        allHighlights = entries.map(entry => {
            let category = 'General';
            const title = entry.querySelector("title").textContent;
            const link = entry.querySelector("link").getAttribute("href");
            const pubDate = entry.querySelector("published").textContent;
            
            const lowerTitle = title.toLowerCase();

            // กรองเฉพาะคลิปที่มีคำว่า F1 หรือ Formula 1 และไม่ใช่ Shorts
            if ((!lowerTitle.includes('f1') && !lowerTitle.includes('formula 1') && !lowerTitle.includes('formula1')) || lowerTitle.includes('#shorts') || lowerTitle.includes('shorts')) {
                return null;
            }
            
            if (lowerTitle.includes('ไฮไลท์') || lowerTitle.includes('highlights') || lowerTitle.includes('qualifying') || lowerTitle.includes('race') || lowerTitle.includes('sprint')) {
                category = 'Highlights';
            } else if (lowerTitle.includes('ซ้อม') || lowerTitle.includes('practice') || lowerTitle.includes('fp1') || lowerTitle.includes('fp2') || lowerTitle.includes('fp3')) {
                category = 'Practice';
            } else if (lowerTitle.includes('สัมภาษณ์') || lowerTitle.includes('interview') || lowerTitle.includes('reaction')) {
                category = 'Interview';
            }

            return { 
                title: title, 
                link: link, 
                pubDate: pubDate, 
                category: category 
            };
        }).filter(item => item !== null); // กรองค่า null ออก

        // แสดงผลทั้งหมดก่อน
        renderHighlights(allHighlights);
        
    } catch (error) {
        console.error('Highlights Error:', error);
        container.innerHTML = '<div class="col-span-full text-red-400 text-center py-4">ไม่สามารถโหลดคลิปได้</div>';
    }
}

// ฟังก์ชันสำหรับ Filter คลิป
function filterHighlights(category) {
    // อัปเดตปุ่ม Active
    document.querySelectorAll('.filter-btn').forEach(btn => {
        if (btn.dataset.category === category) {
            btn.classList.add('bg-[#e10600]', 'text-white');
            btn.classList.remove('bg-gray-800', 'text-gray-300');
        } else {
            btn.classList.remove('bg-[#e10600]', 'text-white');
            btn.classList.add('bg-gray-800', 'text-gray-300');
        }
    });

    const filtered = category === 'all' ? allHighlights : allHighlights.filter(h => h.category === category);
    renderHighlights(filtered);
}

function renderHighlights(items) {
    const container = document.getElementById('highlights-container');
    
    if (items.length === 0) {
        container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8">ไม่พบคลิปในหมวดหมู่นี้</div>';
        return;
    }

    let html = '';
    // แสดงสูงสุด 4 คลิป (ลดจำนวนลงเพื่อให้ดูไม่รก)
    items.slice(0, 4).forEach(item => {
        const date = new Date(item.pubDate);
        const timeStr = date.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' });
        
        const videoId = item.link.split('v=')[1];
        const thumbUrl = `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

        let catColor = 'bg-gray-600';
        if (item.category === 'Highlights') catColor = 'bg-[#e10600]';
        if (item.category === 'Practice') catColor = 'bg-blue-600';
        if (item.category === 'Interview') catColor = 'bg-green-600';

        html += `
            <div onclick="playVideo('${videoId}')" class="glass-card block rounded-xl overflow-hidden hover:border-[#e10600] transition duration-300 group flex flex-col h-full cursor-pointer">
                <div class="relative aspect-video">
                    <img src="${thumbUrl}" alt="${item.title}" class="w-full h-full object-cover group-hover:scale-105 transition duration-500">
                    <div class="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition flex items-center justify-center">
                        <div class="w-10 h-10 bg-[#e10600]/90 rounded-full flex items-center justify-center text-white shadow-lg group-hover:scale-110 transition">
                            <i class="fa-solid fa-play text-xs"></i>
                        </div>
                    </div>
                    <div class="absolute top-2 left-2 ${catColor} text-white text-[9px] px-2 py-0.5 rounded font-bold uppercase tracking-wider shadow-sm">
                        ${item.category}
                    </div>
                </div>
                <div class="p-3 flex flex-col flex-grow">
                    <div class="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1">${timeStr}</div>
                    <h3 class="text-sm font-bold text-white leading-snug line-clamp-2 group-hover:text-[#e10600] transition mb-1">${item.title}</h3>
                </div>
            </div>
        `;
    });
    container.innerHTML = html;
}

// ฟังก์ชันเล่นวิดีโอใน Modal
function playVideo(videoId) {
    const modal = document.getElementById('video-modal');
    const container = document.getElementById('video-player-container');
    
    // Embed YouTube Video (autoplay=1 เพื่อให้เล่นเลย)
    container.innerHTML = `<iframe src="https://www.youtube.com/embed/${videoId}?autoplay=1&rel=0" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen class="w-full h-full"></iframe>`;
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeVideoModal() {
    const modal = document.getElementById('video-modal');
    const container = document.getElementById('video-player-container');
    
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    container.innerHTML = ''; // ล้าง iframe เพื่อหยุดวิดีโอ
}

// 1.5 ดึงผลการแข่งขันล่าสุด (Latest Result) - เพื่อให้เห็นข้อมูลปัจจุบัน
async function fetchLastRace() {
    try {
        // ใส่ ?t=... เพื่อป้องกัน Cache
        const response = await fetch(`https://ergast.com/api/f1/current/last/results.json?t=${Date.now()}`);
        const data = await response.json();
        const race = data.MRData.RaceTable.Races[0];
        
        if (!race) return;

        const winner = race.Results[0];
        const second = race.Results[1];
        const third = race.Results[2];

        const container = document.getElementById('last-race-container');
        container.innerHTML = `
            <div class="bg-gradient-to-r from-[#15151e] to-[#2a2a35] p-0 rounded-2xl border border-gray-700 shadow-2xl relative overflow-hidden group">
                <!-- Background Effect -->
                <div class="absolute top-0 right-0 w-64 h-full bg-gradient-to-l from-[#e10600]/20 to-transparent transform skew-x-12 translate-x-10"></div>
                
                <div class="relative z-10 p-6 md:p-8">
                    <div class="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
                        <div>
                            <span class="text-[#e10600] font-bold text-xs uppercase tracking-[0.2em] mb-1 block">Last Race Result</span>
                            <h3 class="text-3xl md:text-4xl font-black italic text-white uppercase">${race.raceName}</h3>
                            <p class="text-gray-400 text-sm mt-1 flex items-center gap-2"><i class="fa-solid fa-location-dot"></i> ${race.Circuit.circuitName}</p>
                </div>
                        <div class="mt-4 md:mt-0">
                            <span class="bg-white text-black text-xs px-3 py-1 rounded font-bold uppercase tracking-wider">Round ${race.round}</span>
                        </div>
                    </div>

                    <div class="flex items-end gap-4 md:gap-8 justify-center pb-4">
                        <!-- 2nd -->
                        <div class="flex-1 text-center order-1">
                            <div class="text-gray-500 text-xs font-bold mb-2 uppercase tracking-wider">2nd Place</div>
                            <div class="w-16 h-16 md:w-20 md:h-20 mx-auto bg-gray-800 rounded-full border-2 border-gray-500 flex items-center justify-center text-xl font-black italic mb-3 shadow-lg">${second.Driver.code}</div>
                            <div class="font-bold text-sm md:text-base truncate text-gray-300">${second.Driver.familyName}</div>
                            <div class="text-[10px] text-gray-500 uppercase">${second.Constructors[0].name}</div>
                        </div>
                        <!-- Winner -->
                        <div class="flex-1 text-center order-2 transform -translate-y-2">
                            <div class="text-[#e10600] text-2xl mb-2"><i class="fa-solid fa-crown"></i></div>
                            <div class="w-24 h-24 md:w-28 md:h-28 mx-auto bg-gray-800 rounded-full border-4 border-[#e10600] flex items-center justify-center text-3xl font-black italic mb-3 shadow-[0_0_20px_rgba(225,6,0,0.4)] text-white relative">
                                ${winner.Driver.code}
                                <div class="absolute -bottom-3 bg-[#e10600] text-white text-[10px] px-2 py-0.5 rounded font-bold">WINNER</div>
                            </div>
                            <div class="font-black text-lg md:text-xl truncate text-white uppercase">${winner.Driver.familyName}</div>
                            <div class="text-xs text-[#e10600] font-bold uppercase mt-1">${winner.Constructors[0].name}</div>
                            <div class="text-xs text-gray-400 font-mono mt-1 bg-black/30 inline-block px-2 py-1 rounded">${winner.Time ? winner.Time.time : 'Winner'}</div>
                        </div>
                        <!-- 3rd -->
                        <div class="flex-1 text-center order-3">
                            <div class="text-gray-500 text-xs font-bold mb-2 uppercase tracking-wider">3rd Place</div>
                            <div class="w-16 h-16 md:w-20 md:h-20 mx-auto bg-gray-800 rounded-full border-2 border-orange-700 flex items-center justify-center text-xl font-black italic mb-3 shadow-lg">${third.Driver.code}</div>
                            <div class="font-bold text-sm md:text-base truncate text-gray-300">${third.Driver.familyName}</div>
                            <div class="text-[10px] text-gray-500 uppercase">${third.Constructors[0].name}</div>
                        </div>
                    </div>
                </div>
            </div>
        `;
    } catch (e) {
        console.error(e);
        document.getElementById('last-race-container').innerHTML = '<div class="text-red-400 text-center">ไม่สามารถโหลดผลล่าสุดได้</div>';
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
        // ใช้ OpenF1 API ดึงข้อมูล Session ของปีปัจจุบัน
        const year = new Date().getFullYear();
        const response = await fetch(`https://api.openf1.org/v1/sessions?year=${year}&session_type=Race`);
        const data = await response.json();
        
        // OpenF1 ส่งข้อมูลมาทุกสนาม เราต้องกรองเอาเฉพาะอนาคต
        const now = new Date();
        
        // เรียงตามวันที่
        data.sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

        const upcoming = data.filter(session => {
            const raceDate = new Date(session.date_start);
            return raceDate >= now;
        }).slice(0, 4); // เอาแค่ 4 สนามถัดไป

        const container = document.getElementById('race-container');
        
        if (upcoming.length === 0) {
            container.innerHTML = '<p class="col-span-full text-center text-gray-400">จบฤดูกาลแล้ว รอติดตามปีหน้า!</p>';
            return;
        }

        // ใช้ Promise.all เพื่อดึงสภาพอากาศพร้อมกัน
        const cardsHtml = await Promise.all(upcoming.map(async (session) => {
            const dateObj = new Date(session.date_start);
            const dateStr = dateObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
            const timeStr = dateObj.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
            
            // Logic ดึงสภาพอากาศ
            let weatherHtml = '';
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
                        ${session.country_code || 'F1'}
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
async function fetchStandings() {
    try {
        const response = await fetch(`https://ergast.com/api/f1/current/driverStandings.json?t=${Date.now()}`);
        const data = await response.json();
        let standings = [];

        // ลองดึงข้อมูลตารางคะแนนก่อน
        if (data.MRData.StandingsTable.StandingsLists && data.MRData.StandingsTable.StandingsLists.length > 0) {
            standings = data.MRData.StandingsTable.StandingsLists[0].DriverStandings;
        }
        
        // ตรวจสอบว่าเริ่มแข่งขันหรือยัง (มีคะแนนเกิดขึ้นหรือยัง)
        const hasPoints = standings.some(d => parseFloat(d.points) > 0);

        // ถ้ายังไม่มีคะแนน หรือตารางคะแนนว่างเปล่า ให้ไปดึงรายชื่อนักแข่งทั้งหมดมาแสดงแทน
        if (!hasPoints || standings.length === 0) {
            const driversRes = await fetch(`https://ergast.com/api/f1/current/drivers.json?t=${Date.now()}`);
            const driversData = await driversRes.json();
            if (driversData.MRData.DriverTable.Drivers) {
                standings = driversData.MRData.DriverTable.Drivers.map(d => ({
                    position: '-',
                    points: '0',
                    Driver: d,
                    Constructors: [] // Endpoint นี้ไม่มีข้อมูลทีม, ใส่เป็น array ว่าง
                }));
            }
            // ถ้ายังไม่มีคะแนน ให้เรียงตามชื่อ (Alphabetical) และแสดงทั้งหมด
            standings.sort((a, b) => a.Driver.givenName.localeCompare(b.Driver.givenName));
        } else {
            // ถ้ามีคะแนนแล้ว ให้ตัดมาแค่ Top 10 ตามเดิม
            standings = standings.slice(0, 10);
        }

        const container = document.getElementById('standings-container');
        let html = '';
        
        standings.forEach((driver, index) => {
            const isFirst = hasPoints && driver.position === '1';
            const posClass = isFirst ? 'text-[#e10600] text-lg' : 'text-gray-400';
            const rowClass = isFirst ? 'bg-[#e10600]/10' : '';
            const posDisplay = hasPoints ? driver.position : (index + 1);
            const pointsDisplay = hasPoints ? driver.points : '-';
            // ป้องกัน Error กรณีไม่มีข้อมูลทีม
            const teamName = (driver.Constructors && driver.Constructors.length > 0) ? driver.Constructors[0].name : 'N/A';
            
            html += `
                <tr class="hover:bg-white/5 transition cursor-pointer group ${rowClass}" onclick="showDriverProfile('${driver.Driver.driverId}')">
                    <td class="px-2 py-3 font-black italic ${posClass} text-center">${posDisplay}</td>
                    <td class="px-2 py-3">
                        <div class="font-bold text-sm text-gray-200 group-hover:text-[#e10600] transition uppercase">${driver.Driver.givenName} <span class="text-white">${driver.Driver.familyName}</span></div>
                        <div class="text-[10px] text-gray-500 uppercase tracking-wider">${teamName}</div>
                    </td>
                    <td class="px-2 py-3 text-right font-mono font-bold text-[#e10600]">${pointsDisplay}</td>
                </tr>
            `;
        });
        container.innerHTML = html;
    } catch (error) {
        console.error('Error fetching standings:', error);
        document.getElementById('standings-container').innerHTML = '<tr><td colspan="3" class="p-4 text-center text-red-400">โหลดข้อมูลไม่สำเร็จ</td></tr>';
    }
}

// 4. ฟังก์ชันจัดการ Modal และดึงข้อมูลนักแข่ง
async function showDriverProfile(driverId) {
    const modal = document.getElementById('driver-modal');
    const content = document.getElementById('modal-content');
    
    // เปิด Modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    content.innerHTML = '<div class="loader mt-4"></div><p class="mt-4 text-gray-400 text-sm">กำลังโหลดข้อมูลนักแข่ง...</p>';

    try {
        // 1. ดึงข้อมูลส่วนตัวนักแข่ง
        const driverRes = await fetch(`https://ergast.com/api/f1/drivers/${driverId}.json`);
        const driverData = await driverRes.json();
        const driver = driverData.MRData.DriverTable.Drivers[0];

        // 2. ดึงข้อมูลทีมและคะแนนล่าสุด (เจาะจงเฉพาะนักแข่งคนนี้)
        const standingRes = await fetch(`https://ergast.com/api/f1/current/drivers/${driverId}/driverStandings.json`);
        const standingData = await standingRes.json();
        
        let team = 'Unknown Team';
        let points = '0';
        let position = '-';
        let wins = '0';

        // ตรวจสอบว่ามีข้อมูลคะแนนหรือไม่
        if (standingData.MRData.StandingsTable.StandingsLists.length > 0) {
            const standing = standingData.MRData.StandingsTable.StandingsLists[0].DriverStandings[0];
            team = standing.Constructors[0].name;
            points = standing.points;
            position = standing.position;
            wins = standing.wins;
        } else {
            // ถ้าไม่มีคะแนน (เริ่มฤดูกาลใหม่) ให้ลองดึงชื่อทีมอย่างเดียว
            const constructorRes = await fetch(`https://ergast.com/api/f1/current/drivers/${driverId}/constructors.json`);
            const constructorData = await constructorRes.json();
            if (constructorData.MRData.ConstructorTable.Constructors.length > 0) {
                team = constructorData.MRData.ConstructorTable.Constructors[0].name;
            }
        }

        // 3. ดึงรูปภาพจาก Wikipedia API
        let imageUrl = 'https://placehold.co/600x800/1e1e24/FFF?text=No+Image'; // รูปสำรอง
        if (driver.url) {
            try {
                // แกะชื่อจาก URL Wikipedia (เช่น Max_Verstappen)
                const wikiTitle = driver.url.split('/').pop();
                // เรียก API Wikipedia เพื่อเอารูป Thumbnail ขนาดใหญ่ (600px)
                const wikiRes = await fetch(`https://en.wikipedia.org/w/api.php?action=query&titles=${wikiTitle}&prop=pageimages&format=json&pithumbsize=600&origin=*`);
                const wikiData = await wikiRes.json();
                const pages = wikiData.query.pages;
                const pageId = Object.keys(pages)[0];
                if (pages[pageId].thumbnail) {
                    imageUrl = pages[pageId].thumbnail.source;
                }
            } catch (e) { console.error('Wiki Image Error', e); }
        }

        // คำนวณอายุ
        const dob = new Date(driver.dateOfBirth);
        const age = new Date().getFullYear() - dob.getFullYear();

        content.innerHTML = `
            <div class="flex flex-col md:flex-row gap-0 md:gap-6 text-left h-full">
                <!-- รูปภาพ (ซ้าย) -->
                <div class="w-full md:w-5/12 relative bg-gradient-to-b from-gray-800 to-black min-h-[300px] md:min-h-full">
                    <img src="${imageUrl}" alt="${driver.givenName}" class="w-full h-full object-cover absolute inset-0 mix-blend-overlay opacity-80 md:opacity-100 md:mix-blend-normal">
                    <div class="absolute bottom-0 left-0 w-full bg-gradient-to-t from-[#1e1e24] via-[#1e1e24]/80 to-transparent p-6 pt-20 md:hidden"></div>
                    <div class="absolute bottom-4 left-4 md:top-4 md:left-4 text-6xl font-black italic text-white/10 select-none z-0">
                        ${driver.permanentNumber || ''}
                    </div>
                </div>
                
                <!-- ข้อมูล (ขวา) -->
                <div class="w-full md:w-7/12 flex flex-col justify-center p-6 md:pl-0 relative z-10 -mt-10 md:mt-0">
                    <div class="mb-6">
                        <div class="text-[#e10600] font-bold text-xs uppercase tracking-[0.3em] mb-1">${driver.nationality}</div>
                        <h2 class="text-4xl md:text-5xl font-black italic text-white uppercase leading-[0.9] mb-2 drop-shadow-lg">${driver.givenName}<br><span class="text-transparent bg-clip-text bg-gradient-to-r from-[#e10600] to-orange-500">${driver.familyName}</span></h2>
                        <div class="text-xl text-gray-300 font-bold border-l-4 border-[#e10600] pl-3">${team}</div>
                    </div>
                    
                    <div class="grid grid-cols-2 gap-3 mb-6">
                        <div class="bg-black/40 p-3 rounded-lg border border-gray-700/50 backdrop-blur-sm">
                            <div class="text-[10px] text-gray-500 uppercase tracking-wider">Points</div>
                            <div class="text-2xl font-bold text-white">${points}</div>
                        </div>
                        <div class="bg-black/40 p-3 rounded-lg border border-gray-700/50 backdrop-blur-sm">
                            <div class="text-[10px] text-gray-500 uppercase tracking-wider">Rank</div>
                            <div class="text-2xl font-bold text-[#e10600]">#${position}</div>
                        </div>
                        <div class="bg-black/40 p-3 rounded-lg border border-gray-700/50 backdrop-blur-sm">
                            <div class="text-[10px] text-gray-500 uppercase tracking-wider">Wins</div>
                            <div class="text-2xl font-bold text-white">${wins}</div>
                        </div>
                        <div class="bg-black/40 p-3 rounded-lg border border-gray-700/50 backdrop-blur-sm">
                            <div class="text-[10px] text-gray-500 uppercase tracking-wider">Age</div>
                            <div class="text-2xl font-bold text-white">${age}</div>
                        </div>
                    </div>

                    <a href="${driver.url}" target="_blank" class="inline-flex items-center justify-center gap-2 w-full bg-[#e10600] hover:bg-red-700 text-white font-bold py-3 px-4 rounded-xl transition shadow-lg hover:shadow-[#e10600]/30 uppercase tracking-wider text-sm group">
                        Full Wiki Profile <i class="fa-solid fa-arrow-right group-hover:translate-x-1 transition-transform"></i>
                    </a>
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

// ปิด Video Modal เมื่อคลิกพื้นที่ว่างรอบนอก
document.getElementById('video-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeVideoModal();
});

// เริ่มทำงานเมื่อโหลดหน้าเว็บ
document.addEventListener('DOMContentLoaded', () => {
    fetchNextSession(); // เรียกฟังก์ชันนับถอยหลัง
    fetchNews();
    fetchHighlights(); // เรียกฟังก์ชันไฮไลท์
    fetchLastRace(); // เรียกฟังก์ชันใหม่
    fetchSchedule();
    fetchStandings();
});

// --- LIVE DASHBOARD LOGIC ---
let dashboardInterval;

function toggleDashboard(show) {
    const dashboard = document.getElementById('live-dashboard');
    if (show) {
        dashboard.classList.add('active');
        document.body.style.overflow = 'hidden'; // ป้องกันหน้าหลักเลื่อน
        fetchLiveTiming(); // โหลดข้อมูลทันที
        // ตั้งเวลาโหลดอัตโนมัติทุก 10 วินาที
        dashboardInterval = setInterval(fetchLiveTiming, 10000);
    } else {
        dashboard.classList.remove('active');
        document.body.style.overflow = '';
        clearInterval(dashboardInterval);
    }
}

async function fetchLiveTiming() {
    const tbody = document.getElementById('timing-body');
    const headerName = document.getElementById('dash-session-name');
    const headerTrack = document.getElementById('dash-track');
    const statusEl = document.getElementById('dash-status');

    try {
        // 1. ดึง Session ล่าสุด (หรือที่กำลังแข่งอยู่)
        let year = new Date().getFullYear();
        let sessionRes = await fetch(`https://api.openf1.org/v1/sessions?year=${year}`);
        let sessions = await sessionRes.json();

        // ถ้าปีนี้ยังไม่มีข้อมูล (ช่วงต้นปี/ปิดฤดูกาล) ให้ดึงข้อมูลปีที่แล้วมาแสดงเป็น Demo
        if (sessions.length === 0) {
            year = year - 1;
            sessionRes = await fetch(`https://api.openf1.org/v1/sessions?year=${year}`);
            sessions = await sessionRes.json();
        }
        
        // เรียงตามเวลา เอาอันล่าสุด
        const latestSession = sessions.sort((a, b) => new Date(a.date_start) - new Date(b.date_start)).pop();
        
        // ตรวจสอบว่ากำลังแข่งอยู่จริงหรือไม่
        const now = new Date();
        const endTime = new Date(latestSession.date_end);
        // เพิ่ม Buffer 2 ชั่วโมงเผื่อดีเลย์
        const isLive = now < new Date(endTime.getTime() + 2 * 60 * 60 * 1000);

        headerName.innerText = `${latestSession.location} GP - ${latestSession.session_name}`;
        headerTrack.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${latestSession.circuit_short_name}`;
        
        if (isLive) {
            statusEl.innerHTML = '<span class="text-green-500 font-bold uppercase tracking-wider animate-pulse">LIVE</span>';
        } else {
            statusEl.innerHTML = '<span class="text-red-500 font-bold uppercase tracking-wider">REPLAY (OFFLINE)</span>';
        }

        // 2. ดึงข้อมูลนักแข่งใน Session นั้น
        const driversRes = await fetch(`https://api.openf1.org/v1/drivers?session_key=${latestSession.session_key}`);
        const drivers = await driversRes.json();

        // 3. ดึงข้อมูล Lap ล่าสุด (เพื่อเอาเวลา) - ดึงมาจำนวนหนึ่งแล้วกรองเอา
        // หมายเหตุ: OpenF1 ไม่มี endpoint "current status" โดยตรง ต้องประยุกต์ใช้
        // ในที่นี้จะดึง Laps ทั้งหมดแล้วหา Lap สุดท้ายของแต่ละคน (อาจจะช้าหน่อยสำหรับ Demo)
        const lapsRes = await fetch(`https://api.openf1.org/v1/laps?session_key=${latestSession.session_key}`);
        const laps = await lapsRes.json();

        // Map ข้อมูล Lap ล่าสุดของแต่ละคน
        const driverLaps = {};
        laps.forEach(lap => {
            if (!driverLaps[lap.driver_number] || lap.lap_number > driverLaps[lap.driver_number].lap_number) {
                driverLaps[lap.driver_number] = lap;
            }
        });

        // 4. ดึง Position (อันดับ)
        const posRes = await fetch(`https://api.openf1.org/v1/position?session_key=${latestSession.session_key}`);
        const positions = await posRes.json();
        
        // หา Position ล่าสุดของแต่ละคน
        const currentPos = {};
        positions.forEach(p => {
             // เก็บ timestamp ล่าสุด
             if (!currentPos[p.driver_number] || new Date(p.date) > new Date(currentPos[p.driver_number].date)) {
                 currentPos[p.driver_number] = p;
             }
        });

        // รวมข้อมูลและสร้างตาราง
        let tableHtml = '';
        
        // แปลง drivers เป็น array และเรียงตาม position
        const sortedDrivers = drivers.sort((a, b) => {
            const posA = currentPos[a.driver_number] ? currentPos[a.driver_number].position : 99;
            const posB = currentPos[b.driver_number] ? currentPos[b.driver_number].position : 99;
            return posA - posB;
        });

        sortedDrivers.forEach((driver, index) => {
            const lap = driverLaps[driver.driver_number] || {};
            const pos = currentPos[driver.driver_number] ? currentPos[driver.driver_number].position : '-';
            
            // สีทีม (ถ้ามีข้อมูล) หรือ default
            const teamColor = '#' + (driver.team_colour || 'ffffff');
            
            // คำนวณ Gap (สมมติ)
            const gap = index === 0 ? 'Leader' : `+${(Math.random() * 2).toFixed(3)}`; // Demo Gap
            
            tableHtml += `
                <tr class="timing-row">
                    <td class="text-center font-bold text-gray-400">${pos}</td>
                    <td class="font-mono font-bold" style="color:${teamColor}">${driver.driver_number}</td>
                    <td>
                        <div class="font-bold text-white leading-tight">${driver.name_acronym}</div>
                        <div class="text-[10px] text-gray-500 uppercase">${driver.team_name || ''}</div>
                    </td>
                    <td class="text-right font-mono text-gray-300 text-xs">${gap}</td>
                    <td class="text-right font-mono text-gray-300 text-xs">${index === 0 ? '-' : '+0.5s'}</td>
                    <td class="text-center font-mono text-xs"><span class="sector-dot bg-sector-green"></span>${lap.duration_sector_1 || '-'}</td>
                    <td class="text-center font-mono text-xs"><span class="sector-dot bg-sector-yellow"></span>${lap.duration_sector_2 || '-'}</td>
                    <td class="text-center font-mono text-xs"><span class="sector-dot bg-sector-purple"></span>${lap.duration_sector_3 || '-'}</td>
                    <td class="text-right font-mono font-bold text-white pr-4">${lap.lap_duration ? (lap.lap_duration).toFixed(3) : '-'}</td>
                </tr>
            `;
        });

        tbody.innerHTML = tableHtml;

    } catch (error) {
        console.error("Dashboard Error:", error);
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