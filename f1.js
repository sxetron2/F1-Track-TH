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

// เริ่มทำงานเมื่อโหลดหน้าเว็บ
document.addEventListener('DOMContentLoaded', () => {
    fetchNextSession();
    fetchNews();
    fetchLastRace();
    fetchSchedule();
    fetchStandings();
});