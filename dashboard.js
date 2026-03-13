// f:\Project\F1\F1-Track\js\dashboard.js

let mqttClient = null;
let dashboardInterval = null;
let dashboardData = {
    session: null,
    drivers: [],
    laps: {},
    positions: {},
    intervals: {}
};

let selectedDriver = null;
let selectedDriver2 = null;

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
    car_data: {},
    location: {}
};

let trackPath = [];
let mapBounds = { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
let renderPending = false;
let lastFlagClearTimer = null;

async function toggleDashboard(show) {
    const dashboard = document.getElementById('live-dashboard');
    if (show) {
        dashboard.classList.add('active');
        document.body.style.overflow = 'hidden';
        await initDashboard();
    } else {
        dashboard.classList.remove('active');
        document.body.style.overflow = '';
        
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
    dashboardData = { session: null, drivers: [], laps: {}, positions: {}, intervals: {}, locations: {}, grid: {}, car_data: {} };
    const tbody = document.getElementById('timing-body');
    const headerName = document.getElementById('dash-session-name');
    const headerTrack = document.getElementById('dash-track');
    const statusEl = document.getElementById('dash-status');
    const flagBar = document.getElementById('flag-status-bar');
    const replayControls = document.getElementById('replay-controls');
    
    if(flagBar) flagBar.classList.add('hidden');
    replayControls.classList.add('hidden');
    statusEl.innerHTML = 'LOADING...';

    tbody.innerHTML = '<tr><td colspan="11" class="text-center py-8 text-gray-500"><div class="loader mx-auto mb-2"></div>Loading Session Data...</td></tr>';

    try {
        let sessionRes = await fetchOpenF1(`/sessions?session_key=latest`);
        let sessions = sessionRes.ok ? await sessionRes.json() : [];
        
        if (!Array.isArray(sessions) || sessions.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="text-center py-4 text-gray-500">No session data found.</td></tr>';
            return;
        }

        let latestSession = sessions[0];
        const now = new Date();
        
        dashboardData.session = latestSession;
        
        headerName.innerText = `${latestSession.location} GP - ${latestSession.session_name}`;
        headerTrack.innerHTML = `<i class="fa-solid fa-location-dot"></i> ${latestSession.circuit_short_name}`;

        const startTime = new Date(latestSession.date_start);
        const endTime = new Date(latestSession.date_end);

        if (now < startTime) {
            statusEl.innerHTML = '<span class="text-yellow-500 font-bold uppercase tracking-wider">UPCOMING</span>';
            tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-gray-400"><i class="fa-regular fa-clock text-4xl mb-2"></i><br>Session starts at ${startTime.toLocaleTimeString()}</td></tr>`;
            return;
        }

        const isLive = now < new Date(endTime.getTime() + 2 * 60 * 60 * 1000);

        const driversRes = await fetchOpenF1(`/drivers?session_key=${latestSession.session_key}`);
        const driversData = await driversRes.json();
        
        if (Array.isArray(driversData)) {
            dashboardData.drivers = driversData;
        } else {
            dashboardData.drivers = [];
        }

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
            
            await fetchSnapshot(latestSession.session_key);
            renderDashboardTable();

            connectMqtt(latestSession.session_key);
            
            if (dashboardData.drivers.length > 0) {
                selectDriver(dashboardData.drivers[0].driver_number);
            }
            
            if (dashboardData.drivers.length > 0) {
                fetchTrackPath(latestSession.session_key, dashboardData.drivers[0].driver_number);
            }

            if (dashboardInterval) clearInterval(dashboardInterval);
            dashboardInterval = setInterval(() => {
                const nowIso = new Date(Date.now() - 60000).toISOString();
                fetchSnapshot(latestSession.session_key, `&date>=${nowIso}`);
            }, 10000);
        } else {
            statusEl.innerHTML = '<span class="text-red-500 font-bold uppercase tracking-wider">REPLAY (OFFLINE)</span>';
            replayControls.classList.remove('hidden');
            
            tbody.innerHTML = '<tr><td colspan="11" class="text-center py-8 text-gray-500"><div class="loader mx-auto mb-2"></div>Loading Replay Data...<br><span class="text-xs">This may take a moment</span></td></tr>';
            await initReplay(latestSession);
            
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
        tbody.innerHTML = `<tr><td colspan="11" class="text-center py-8 text-red-400">${msg}</td></tr>`;
    }
}

async function fetchSnapshot(sessionKey, filter = '') {
    const [lapsRes, posRes, intRes] = await Promise.all([
        fetchOpenF1(`/laps?session_key=${sessionKey}${filter}`),
        fetchOpenF1(`/position?session_key=${sessionKey}${filter}`),
        fetchOpenF1(`/intervals?session_key=${sessionKey}${filter}`)
    ]);

    const laps = await lapsRes.json().catch(e => []);
    const positions = await posRes.json().catch(e => []);
    const intervals = await intRes.json().catch(e => []);

    if (Array.isArray(laps)) {
        laps.forEach(lap => {
            if (!dashboardData.laps[lap.driver_number] || lap.lap_number > dashboardData.laps[lap.driver_number].lap_number) {
                dashboardData.laps[lap.driver_number] = lap;
            }
        });
    }
    
    if (Array.isArray(positions)) {
        positions.forEach(p => {
            if (!dashboardData.positions[p.driver_number] || new Date(p.date) > new Date(dashboardData.positions[p.driver_number].date)) {
                dashboardData.positions[p.driver_number] = p;
            }
        });
    }

    if (Array.isArray(intervals)) {
        intervals.forEach(i => {
            if (!dashboardData.intervals[i.driver_number] || new Date(i.date) > new Date(dashboardData.intervals[i.driver_number].date)) {
                dashboardData.intervals[i.driver_number] = i;
            }
        });
    }
}

async function initReplay(session) {
    replayState.active = true;
    replayState.startTime = new Date(session.date_start).getTime();
    replayState.endTime = new Date(session.date_end).getTime();
    replayState.currentTime = replayState.startTime;
    
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

        const sortByDate = (a, b) => new Date(a.date) - new Date(b.date);
        replayBuffer.intervals.sort(sortByDate);
        replayBuffer.laps.sort(sortByDate);
        replayBuffer.positions.sort(sortByDate);
        replayBuffer.race_control.sort(sortByDate);

        const driverNumbers = dashboardData.drivers.map(d => d.driver_number);
        await Promise.all(driverNumbers.map(async (num) => {
            const res = await fetchOpenF1(`/location?session_key=${session.session_key}&driver_number=${num}`);
            if (res.ok) {
                const data = await res.json();
                data.sort((a, b) => new Date(a.date) - new Date(b.date));
                replayBuffer.location[num] = data;
            }
        }));
        await Promise.all(driverNumbers.map(async (num) => {
            const res = await fetchOpenF1(`/car_data?session_key=${session.session_key}&driver_number=${num}`);
            if (res.ok) {
                const data = await res.json();
                data.sort((a, b) => new Date(a.date) - new Date(b.date));
                replayBuffer.car_data[num] = data;
            }
        }));

        document.getElementById('replay-total-time').innerText = formatReplayTime(replayState.endTime - replayState.startTime);
        document.getElementById('replay-slider').value = 0;
        
        updateReplayFrame();
        playReplay();

    } catch (e) {
        console.error("Replay Init Error", e);
        document.getElementById('timing-body').innerHTML = '<tr><td colspan="11" class="text-center py-4 text-red-500">Failed to load replay data.</td></tr>';
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
    
    const updateInterval = 100;
    replayState.timer = setInterval(() => {
        replayState.currentTime += replayState.speed * updateInterval;
        
        if (replayState.currentTime >= replayState.endTime) {
            replayState.currentTime = replayState.endTime;
            pauseReplay();
        }
        
        updateReplayFrame();
        
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
    const elapsed = replayState.currentTime - replayState.startTime;
    document.getElementById('replay-current-time').innerText = formatReplayTime(elapsed);

    dashboardData.intervals = {};
    for (const item of replayBuffer.intervals) {
        if (new Date(item.date).getTime() > replayState.currentTime) break;
        dashboardData.intervals[item.driver_number] = item;
    }

    dashboardData.positions = {};
    for (const item of replayBuffer.positions) {
        if (new Date(item.date).getTime() > replayState.currentTime) break;
        dashboardData.positions[item.driver_number] = item;
    }

    for (const item of replayBuffer.laps) {
        if (new Date(item.date_start).getTime() > replayState.currentTime) break;
        dashboardData.laps[item.driver_number] = item;
    }

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

    for (const item of replayBuffer.race_control) {
        if (new Date(item.date).getTime() > replayState.currentTime) break;
        updateFlagStatus(item);
    }

    dashboardData.locations = {};
    if (replayBuffer.location) {
        Object.keys(replayBuffer.location).forEach(driverNum => {
            const locData = replayBuffer.location[driverNum];
            if (locData && locData.length > 0 && dashboardData.drivers.find(d => d.driver_number == driverNum)) {
                for (let i = locData.length - 1; i >= 0; i--) {
                    if (new Date(locData[i].date).getTime() <= replayState.currentTime) {
                        dashboardData.locations[driverNum] = { x: locData[i].x, y: locData[i].y };
                        break;
                    }
                }
            }
        });
    }

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

function updateFlagStatus(message) {
    const bar = document.getElementById('flag-status-bar');
    if (!bar || !message) return;

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
            bar.classList.add('hidden');
            return;
        default:
            bar.classList.add('hidden');
            return;
    }
    
    bar.className = `text-center p-2 text-xl md:text-2xl font-black uppercase tracking-widest text-black transition-all duration-300 z-20 relative ${bgColor}`;
    bar.innerText = text;
    bar.classList.remove('hidden');

    if (flag === 'GREEN' || flag === 'CLEAR') {
        lastFlagClearTimer = setTimeout(() => bar.classList.add('hidden'), 5000);
    }
}

async function connectMqtt(sessionKey) {
    const token = await getOpenF1Token();
    if (!token) return;

    const options = {
        username: typeof CONFIG !== 'undefined' ? CONFIG.OPENF1_USER : openF1User,
        password: token
    };

    mqttClient = mqtt.connect('wss://mqtt.openf1.org:8084/mqtt', options);

    mqttClient.on('connect', () => {
        console.log('MQTT Connected');
        mqttClient.subscribe('v1/laps');
        mqttClient.subscribe('v1/position');
        mqttClient.subscribe('v1/intervals');
        mqttClient.subscribe('v1/race_control');
        mqttClient.subscribe('v1/location');
        mqttClient.subscribe('v1/car_data');
    });

    mqttClient.on('message', (topic, message) => {
        const msg = JSON.parse(message.toString());
        if (msg.session_key != sessionKey) return;

        const driverNum = msg.driver_number;
        
        if (topic === 'v1/laps') {
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
            dashboardData.locations[driverNum] = { x: msg.x, y: msg.y };
        } else if (topic === 'v1/car_data') {
            dashboardData.car_data[driverNum] = msg;
        }

        requestRender();
    });
}

function requestRender() {
    if (!renderPending) {
        renderPending = true;
        requestAnimationFrame(() => {
            renderDashboardTable();
            renderPending = false;
            drawTrackMap();
        });
    }
}

function renderDashboardTable() {
    const tbody = document.getElementById('timing-body');
    let tableHtml = '';

    const sortedDrivers = (dashboardData.drivers || []).sort((a, b) => {
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
        const res = await fetchOpenF1(`/location?session_key=${sessionKey}&driver_number=${driverNum}`);
        const data = res.ok ? await res.json() : [];
        
        if (data.length > 0) {
            trackPath = data.filter((_, i) => i % 5 === 0).map(d => ({x: d.x, y: d.y}));
            
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
        y: canvas.height - (offsetY + (y - mapBounds.minY) * scale)
    });

    ctx.beginPath();
    ctx.strokeStyle = '#444';
    ctx.lineWidth = 4;
    trackPath.forEach((p, i) => {
        const pos = transform(p.x, p.y);
        if (i === 0) ctx.moveTo(pos.x, pos.y); else ctx.lineTo(pos.x, pos.y);
    });
    ctx.stroke();

    if (dashboardData.locations) {
        Object.keys(dashboardData.locations).forEach(driverNum => {
            const loc = dashboardData.locations[driverNum];
            const pos = transform(loc.x, loc.y);
            const driver = dashboardData.drivers.find(d => d.driver_number == driverNum);
            const color = driver ? `#${driver.team_colour}` : '#fff';
            
            ctx.beginPath();
            ctx.fillStyle = color;
            ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#000';
            ctx.lineWidth = 1;
            ctx.stroke();
            
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(driverNum, pos.x, pos.y - 7);
        });
    }
}

async function selectDriver(driverNumber) {
    if (selectedDriver == driverNumber) {
        selectedDriver = selectedDriver2;
        selectedDriver2 = null;
    } else if (selectedDriver2 == driverNumber) {
        selectedDriver2 = null;
    } else {
        if (!selectedDriver) {
            selectedDriver = driverNumber;
        } else if (!selectedDriver2) {
            selectedDriver2 = driverNumber;
        } else {
            selectedDriver2 = driverNumber;
        }
    }

    if (replayState.active) {
        if (selectedDriver && !replayBuffer.car_data[selectedDriver]) {
            await fetchReplayDriverData(selectedDriver);
        }
        if (selectedDriver2 && !replayBuffer.car_data[selectedDriver2]) {
            await fetchReplayDriverData(selectedDriver2);
        }
    }
    
    renderDashboardTable();
}