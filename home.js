// f:\Project\F1\F1-Track\js\home.js

let countdownInterval;

async function fetchNextSession() {
    try {
        let year = new Date().getFullYear();
        let response = await fetchOpenF1(`/sessions?year=${year}`);
        let data = response.ok ? await response.json() : [];
        
        if (!Array.isArray(data)) data = [];

        const now = new Date();
        let upcoming = data
            .filter(s => new Date(s.date_start) > now)
            .sort((a, b) => new Date(a.date_start) - new Date(b.date_start));

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
    
    document.getElementById('cd-location').innerText = `${session.location} GP`;
    document.getElementById('cd-session').innerText = sessionName;
    
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

async function fetchNews() {
    const container = document.getElementById('news-container');
    container.innerHTML = '<div class="text-center text-gray-500 text-xs py-4"><div class="loader mb-2" style="width:16px; height:16px; border-width:2px;"></div>Loading News...</div>';

    try {
        const rssUrl = 'https://www.motorsport.com/rss/f1/news/';
        const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`);
        if (!response.ok) throw new Error(`RSS API Error: ${response.status}`);
        const data = await response.json();

        if (data.status !== 'ok') throw new Error('Failed to fetch RSS');

        let html = '';
        data.items.slice(0, 5).forEach(item => {
            const date = new Date(item.pubDate);
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

async function fetchLastRace() {
    const container = document.getElementById('last-race-container');
    try {
        let year = new Date().getFullYear();
        let sessionRes = await fetchOpenF1(`/sessions?year=${year}&session_type=Race`);
        let sessions = sessionRes.ok ? await sessionRes.json() : [];

        if (!Array.isArray(sessions) || sessions.length === 0) {
            year--;
            sessionRes = await fetchOpenF1(`/sessions?year=${year}&session_type=Race`);
            sessions = sessionRes.ok ? await sessionRes.json() : [];
        }

        if (!Array.isArray(sessions) || sessions.length === 0) {
            container.innerHTML = '<div class="text-center text-gray-500 py-8">No session data found.</div>';
            return;
        }

        const now = new Date();
        const completedRaces = sessions
            .filter(s => new Date(s.date_end) < now)
            .sort((a, b) => new Date(b.date_start) - new Date(a.date_start));

        if (completedRaces.length === 0) {
            container.innerHTML = '<div class="text-center text-gray-500 py-8">No completed races found.</div>';
            return;
        }

        const lastRace = completedRaces[0];

        const [driversRes, resultRes] = await Promise.all([
            fetchOpenF1(`/drivers?session_key=${lastRace.session_key}`),
            fetchOpenF1(`/session_result?session_key=${lastRace.session_key}`)
        ]);

        let drivers = driversRes.ok ? await driversRes.json() : [];
        const resultsData = resultRes.ok ? await resultRes.json() : [];

        if (!Array.isArray(drivers) || drivers.length === 0) {
            const yearDriversRes = await fetchOpenF1(`/drivers?year=${lastRace.year}`);
            if (yearDriversRes.ok) {
                drivers = await yearDriversRes.json();
            }
        }

        const driverMap = {};
        if (Array.isArray(drivers)) {
            drivers.forEach(d => driverMap[String(d.driver_number)] = d);
        }

        const results = resultsData
            .map(r => ({ ...r, driverInfo: driverMap[String(r.driver_number)] }))
            .filter(p => p.driverInfo && p.position)
            .sort((a, b) => a.position - b.position);

        if (results.length < 3) {
            container.innerHTML = '<div class="text-center text-gray-500 py-8">ข้อมูลผลการแข่งขันไม่สมบูรณ์</div>';
            return;
        }

        const winner = results[0];
        const second = results[1];
        const third = results[2];

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
                        <div class="flex-1 text-center order-1">
                            <div class="text-gray-500 text-xs font-bold mb-2 uppercase tracking-wider">2nd Place</div>
                            <div class="w-16 h-16 md:w-20 md:h-20 mx-auto bg-gray-800 rounded-full border-2 border-gray-500 flex items-center justify-center text-xl font-black italic mb-3 shadow-lg overflow-hidden">${d2.img}</div>
                            <div class="font-bold text-sm md:text-base truncate text-gray-300">${d2.name}</div>
                            <div class="text-[10px] text-gray-500 uppercase">${d2.team}</div>
                        </div>
                        <div class="flex-1 text-center order-2 transform -translate-y-2">
                            <div class="text-[#e10600] text-2xl mb-2"><i class="fa-solid fa-crown"></i></div>
                            <div class="w-24 h-24 md:w-28 md:h-28 mx-auto bg-gray-800 rounded-full border-4 border-[#e10600] flex items-center justify-center text-3xl font-black italic mb-3 shadow-[0_0_20px_rgba(225,6,0,0.4)] text-white relative overflow-hidden">
                                ${d1.img}
                                <div class="absolute -bottom-3 bg-[#e10600] text-white text-[10px] px-2 py-0.5 rounded font-bold">WINNER</div>
                            </div>
                            <div class="font-black text-lg md:text-xl truncate text-white uppercase">${d1.name}</div>
                            <div class="text-xs text-[#e10600] font-bold uppercase mt-1">${d1.team}</div>
                        </div>
                        <div class="flex-1 text-center order-3">
                            <div class="text-gray-500 text-xs font-bold mb-2 uppercase tracking-wider">3rd Place</div>
                            <div class="w-16 h-16 md:w-20 md:h-20 mx-auto bg-gray-800 rounded-full border-2 border-orange-700 flex items-center justify-center text-xl font-black italic mb-3 shadow-lg overflow-hidden">${d3.img}</div>
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

async function fetchSchedule() {
    try {
        const year = new Date().getFullYear();
        const response = await fetchOpenF1(`/sessions?year=${year}&session_type=Race`);
        const data = response.ok ? await response.json() : [];
        
        if (!Array.isArray(data)) throw new Error("No schedule data");

        const now = new Date();
        
        const upcoming = data.filter(session => new Date(session.date_start) >= now)
          .sort((a, b) => new Date(a.date_start) - new Date(b.date_start))
          .slice(0, 4);

        const container = document.getElementById('race-container');
        
        if (upcoming.length === 0) {
            container.innerHTML = '<div class="col-span-full text-center text-gray-500 py-8 glass-card rounded-xl">End of Season. See you next year!</div>';
            return;
        }

        const cardsHtml = await Promise.all(upcoming.map(async (session) => {
            const dateObj = new Date(session.date_start);
            const dateStr = dateObj.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
            const timeStr = dateObj.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
            
            let weatherHtml = '';
            const loc = circuitLocations[session.location] || circuitLocations[session.circuit_short_name];
            
            if (loc) {
                const daysDiff = (dateObj - now) / (1000 * 60 * 60 * 24);
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
                    <div class="absolute top-0 right-0 p-2 opacity-5 text-6xl font-black italic text-white select-none -mr-4 -mt-2">F1</div>
                    <div class="flex justify-between items-start mb-2">
                        <span class="text-[10px] font-bold text-[#e10600] uppercase tracking-widest">Upcoming</span>
                        <span class="text-xs text-gray-300 bg-white/10 px-2 py-1 rounded border border-white/10">${dateStr}</span>
                    </div>
                    <h3 class="text-xl font-black italic mb-1 group-hover:text-[#e10600] transition text-white uppercase tracking-tight">${session.location} GP</h3>
                    <p class="text-sm text-gray-400 mb-2 flex items-center gap-2"><i class="fa-solid fa-location-dot text-[#e10600]"></i> ${session.circuit_short_name}</p>
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

let fullStandingsData = [];

async function fetchStandings() {
    const container = document.getElementById('standings-container');
    container.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-gray-500"><div class="loader"></div><br>Calculating Standings...</td></tr>';

    try {
        let year = new Date().getFullYear();
        const racePoints = { 1: 25, 2: 18, 3: 15, 4: 12, 5: 10, 6: 8, 7: 6, 8: 4, 9: 2, 10: 1 };
        const sprintPoints = { 1: 8, 2: 7, 3: 6, 4: 5, 5: 4, 6: 3, 7: 2, 8: 1 };

        let allSessions = [];
        try {
            const res = await fetchOpenF1(`/sessions?year=${year}`);
            if (res.ok) allSessions = await res.json();
        } catch (e) {}

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
            standingsMap[d.driver_number] = { ...d, points: 0, wins: 0, position: 0 };
        });

        const completedRaces = allSessions.filter(s => s.session_type === 'Race' && new Date(s.date_end) < now);
        const completedSprints = allSessions.filter(s => s.session_type === 'Sprint' && new Date(s.date_end) < now);
        const allCompletedSessions = [...completedRaces, ...completedSprints];

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
                            if (r.position === 1) standingsMap[driverNum].wins += 1;
                        } else if (session.session_type === 'Sprint') {
                            pointsToAdd = sprintPoints[r.position] || 0;
                        }
                        standingsMap[driverNum].points += pointsToAdd;
                    }
                });
            } catch (e) { console.error(`Error processing session ${session.session_key}`, e); }
        }));

        const standingsArray = Object.values(standingsMap);
        standingsArray.sort((a, b) => b.points - a.points);
        
        standingsArray.forEach((d, index) => { d.position = index + 1; });

        fullStandingsData = standingsArray;
        renderStandings();

    } catch (error) {
        console.error('Error fetching standings from OpenF1:', error);
        container.innerHTML = '<tr><td colspan="3" class="p-4 text-center text-red-400">โหลดข้อมูลคะแนนไม่สำเร็จ</td></tr>';
    }
}

function renderStandings() {
    const container = document.getElementById('standings-container');
    const dataToRender = fullStandingsData.slice(0, 10);
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

async function showDriverProfile(driverNumber) {
    const modal = document.getElementById('driver-modal');
    const content = document.getElementById('modal-content');
    
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    content.innerHTML = '<div class="loader mt-4"></div><p class="mt-4 text-gray-400 text-sm">กำลังโหลดข้อมูลนักแข่ง...</p>';

    try {
        const driver = fullStandingsData.find(d => d.driver_number === driverNumber);
        if (!driver) throw new Error("Driver data not found in standings.");

        const imageUrl = driver.headshot_url || 'https://placehold.co/600x800/1e1e24/FFF?text=No+Image';

        content.innerHTML = `
            <div class="flex flex-col md:flex-row gap-0 md:gap-6 text-left h-full">
                <div class="w-full md:w-5/12 relative bg-gradient-to-b from-gray-800 to-black min-h-[300px] md:min-h-full">
                    <img src="${imageUrl}" alt="${driver.full_name}" class="w-full h-full object-cover absolute inset-0 mix-blend-overlay opacity-80 md:opacity-100 md:mix-blend-normal">
                    <div class="absolute bottom-0 left-0 w-full bg-gradient-to-t from-[#1e1e24] via-[#1e1e24]/80 to-transparent p-6 pt-20 md:hidden"></div>
                    <div class="absolute bottom-4 left-4 md:top-4 md:left-4 text-6xl font-black italic text-white/10 select-none z-0">${driver.driver_number || 'F1'}</div>
                </div>
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

document.getElementById('driver-modal').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
});