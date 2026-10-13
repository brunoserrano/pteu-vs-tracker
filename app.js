let scheduleData = [];
let displayMode = 'local'; // Options: 'local', 'irish', 'cest', 'utc'
let soundEnabled = false;
let alertPlayedForNext = false;
let audioContext = null;

const ACTIVE_DURATION_MS = 5 * 60 * 1000; // Active for 5 mins

// Fetch Schedule JSON asynchronously
async function loadSchedule() {
    try {
        const response = await fetch('./schedule.json');
        if (!response.ok) {
            throw new Error(`Failed to load schedule.json: ${response.statusText}`);
        }
        scheduleData = await response.json();
        
        // Initial render after loading dataset
        updateUI();
        renderScheduleTable();

        // Interval timers
        setInterval(updateUI, 1000);
        setInterval(renderScheduleTable, 30000);
    } catch (error) {
        console.error("Error loading schedule data:", error);
        document.getElementById('next-map-name').textContent = "Error loading schedule data";
    }
}

function playAlertTone() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === 'suspended') {
            audioContext.resume();
        }

        const now = audioContext.currentTime;
        [0, 0.25].forEach((delay, idx) => {
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();

            osc.type = 'sine';
            osc.frequency.setValueAtTime(idx === 0 ? 587.33 : 880, now + delay);

            gain.gain.setValueAtTime(0.3, now + delay);
            gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.3);

            osc.connect(gain);
            gain.connect(audioContext.destination);

            osc.start(now + delay);
            osc.stop(now + delay + 0.35);
        });
    } catch (e) {
        console.error("Audio playback error:", e);
    }
}

function getUpcomingSpawnsList() {
    if (!scheduleData.length) return [];
    
    const now = new Date();
    const spawns = [];
    const utcTodayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);

    for (let dayOffset = -1; dayOffset <= 2; dayOffset++) {
        scheduleData.forEach((hourObj) => {
            const cestHour = hourObj.hour;
            ['03', '08', '23', '43'].forEach(mStr => {
                const mapName = hourObj[mStr];
                if (!mapName || mapName === '-') return;

                const minIdx = parseInt(mStr);
                // CEST is UTC+2 -> Timestamp = UTC(dayOffset, cestHour - 2, minIdx)
                const spawnTimeUtc = utcTodayStart + (dayOffset * 86400000) + ((cestHour - 2) * 3600000) + (minIdx * 60000);

                spawns.push({
                    timestamp: spawnTimeUtc,
                    cestHour: cestHour,
                    cestMin: minIdx,
                    mapName: mapName
                });
            });
        });
    }

    spawns.sort((a, b) => a.timestamp - b.timestamp);
    return spawns;
}

function formatTimeForMode(dateObj, mode) {
    if (mode === 'local') {
        return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    } else if (mode === 'irish') {
        return dateObj.toLocaleTimeString('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', hour12: false });
    } else if (mode === 'cest') {
        return dateObj.toLocaleTimeString('de-DE', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', hour12: false });
    } else if (mode === 'utc') {
        return dateObj.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false }) + ' UTC';
    }
    return dateObj.toLocaleTimeString();
}

function updateUI() {
    const nowUtcMs = Date.now();
    const nowObj = new Date();

    // Clock updates
    document.getElementById('local-clock').textContent = nowObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    document.getElementById('irish-clock').textContent = nowObj.toLocaleTimeString('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    document.getElementById('cest-clock').textContent = nowObj.toLocaleTimeString('de-DE', { timeZone: 'Europe/Amsterdam', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    document.getElementById('utc-clock').textContent = nowObj.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    try {
        const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone;
        document.getElementById('local-tz-abbr').textContent = tzName;
    } catch(e) {
        document.getElementById('local-tz-abbr').textContent = "Local Time";
    }

    const allSpawns = getUpcomingSpawnsList();

    let activeSpawn = null;
    let nextSpawn = null;

    for (let i = 0; i < allSpawns.length; i++) {
        const s = allSpawns[i];
        const diff = s.timestamp - nowUtcMs;

        if (diff <= 0 && diff >= -ACTIVE_DURATION_MS) {
            activeSpawn = s;
        } else if (diff > 0) {
            if (!nextSpawn) {
                nextSpawn = s;
            }
        }
    }

    const heroCard = document.getElementById('hero-status-card');
    const badge = document.getElementById('spawn-status-badge');
    const targetMapEl = document.getElementById('next-map-name');
    const countdownEl = document.getElementById('countdown-timer');
    const spawnTimeLocalEl = document.getElementById('next-spawn-time-local');
    const spawnTimeLabel = document.getElementById('next-spawn-time-label');

    const currentTarget = activeSpawn || nextSpawn;

    if (currentTarget) {
        const timeObj = new Date(currentTarget.timestamp);
        const formattedTime = formatTimeForMode(timeObj, displayMode);

        targetMapEl.textContent = currentTarget.mapName;
        spawnTimeLabel.textContent = `Scheduled: ${formattedTime}`;

        if (activeSpawn) {
            heroCard.classList.add('glass-card-active', 'active-spawn-pulse');
            badge.className = "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/40 flex items-center gap-1.5 animate-pulse";
            badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-red-500"></span> ACTIVE NOW!`;

            const elapsedMs = nowUtcMs - activeSpawn.timestamp;
            const remActiveMs = ACTIVE_DURATION_MS - elapsedMs;
            const activeMins = Math.floor(remActiveMs / 60000);
            const activeSecs = Math.floor((remActiveMs % 60000) / 1000);

            countdownEl.textContent = `Active (${activeMins}m ${activeSecs}s left)`;
            countdownEl.className = "font-mono text-xl sm:text-2xl font-extrabold text-red-400 glow-red";
            spawnTimeLocalEl.textContent = `Spawned at ${formattedTime}! Target active in game.`;
        } else {
            heroCard.classList.remove('glass-card-active', 'active-spawn-pulse');
            badge.className = "px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1.5";
            badge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400"></span> NEXT SPAWN`;

            const diffMs = currentTarget.timestamp - nowUtcMs;
            const mins = Math.floor(diffMs / 60000);
            const secs = Math.floor((diffMs % 60000) / 1000);

            countdownEl.textContent = `${String(mins).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
            countdownEl.className = "font-mono text-3xl sm:text-4xl font-extrabold text-cyan-400 glow-cyan";

            spawnTimeLocalEl.textContent = `Target Spawn Time (${displayMode.toUpperCase()}): ${formattedTime}`;

            if (soundEnabled && mins === 2 && secs === 0 && !alertPlayedForNext) {
                playAlertTone();
                alertPlayedForNext = true;
            }
            if (mins > 2) {
                alertPlayedForNext = false;
            }
        }
    }

    // Populate Upcoming Spawns List
    const upcomingListEl = document.getElementById('upcoming-list');
    const futureSpawns = allSpawns.filter(s => s.timestamp > nowUtcMs).slice(0, 3);
    
    upcomingListEl.innerHTML = '';
    futureSpawns.forEach((s, idx) => {
        const sDate = new Date(s.timestamp);
        const timeDisplay = formatTimeForMode(sDate, displayMode);
        const diffMs = s.timestamp - nowUtcMs;
        const inMins = Math.floor(diffMs / 60000);

        const item = document.createElement('div');
        item.className = "flex items-center justify-between p-2.5 rounded-xl bg-ptDark-900/60 border border-gray-800 text-xs";
        item.innerHTML = `
            <div class="flex items-center gap-2.5 overflow-hidden">
                <span class="w-5 h-5 rounded-lg bg-amber-500/10 text-amber-400 font-bold flex items-center justify-center text-[10px] shrink-0 border border-amber-500/20">
                    ${idx + 1}
                </span>
                <span class="font-medium text-gray-200 truncate">${s.mapName}</span>
            </div>
            <div class="text-right shrink-0">
                <div class="font-mono text-amber-300 font-semibold">${timeDisplay}</div>
                <div class="text-[10px] text-gray-500">in ${inMins} mins</div>
            </div>
        `;
        upcomingListEl.appendChild(item);
    });
}

function renderScheduleTable() {
    if (!scheduleData.length) return;

    const tbody = document.getElementById('schedule-tbody');
    tbody.innerHTML = '';

    const searchQuery = document.getElementById('map-search-input').value.toLowerCase().trim();
    const now = new Date();
    const nowUtcMs = Date.now();

    let currentHourInSelectedTz = 0;
    if (displayMode === 'cest') {
        const cestStr = now.toLocaleTimeString('de-DE', { timeZone: 'Europe/Amsterdam', hour: '2-digit', hour12: false });
        currentHourInSelectedTz = parseInt(cestStr);
    } else if (displayMode === 'irish') {
        const ieStr = now.toLocaleTimeString('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', hour12: false });
        currentHourInSelectedTz = parseInt(ieStr);
    } else if (displayMode === 'utc') {
        currentHourInSelectedTz = now.getUTCHours();
    } else {
        currentHourInSelectedTz = now.getHours();
    }

    scheduleData.forEach((rowObj) => {
        const cestHour = rowObj.hour;
        const cestDateString = new Date().toLocaleDateString('en-US', { timeZone: 'Europe/Amsterdam' });
        const baseDate = new Date(`${cestDateString} ${String(cestHour).padStart(2,'0')}:00:00 GMT+0200`);

        let displayHourStart = 0;
        let hourLabel = "";

        if (displayMode === 'cest') {
            displayHourStart = cestHour;
            const startH = String(cestHour).padStart(2, '0');
            const endH = String((cestHour + 1) % 24).padStart(2, '0');
            hourLabel = `${startH}:00 - ${endH}:00`;
        } else if (displayMode === 'irish') {
            const startStr = baseDate.toLocaleTimeString('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', hour12: false });
            displayHourStart = parseInt(startStr);
            const endDate = new Date(baseDate.getTime() + 3600000);
            const endStr = endDate.toLocaleTimeString('en-IE', { timeZone: 'Europe/Dublin', hour: '2-digit', hour12: false });
            hourLabel = `${startStr}:00 - ${endStr}:00`;
        } else if (displayMode === 'utc') {
            const startStr = baseDate.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: '2-digit', hour12: false });
            displayHourStart = parseInt(startStr);
            const endDate = new Date(baseDate.getTime() + 3600000);
            const endStr = endDate.toLocaleTimeString('en-US', { timeZone: 'UTC', hour: '2-digit', hour12: false });
            hourLabel = `${startStr}:00 - ${endStr}:00 UTC`;
        } else {
            const localStartH = baseDate.getHours();
            displayHourStart = localStartH;
            const localEndH = (localStartH + 1) % 24;
            hourLabel = `${String(localStartH).padStart(2,'0')}:00 - ${String(localEndH).padStart(2,'0')}:00`;
        }

        const isCurrentHourRow = (displayHourStart === currentHourInSelectedTz);

        const slot1Map = rowObj['03'] || rowObj['08'] || '-';
        const slot2Map = rowObj['23'] || '-';
        const slot3Map = rowObj['43'] || '-';

        const matchesSearch = searchQuery === '' || 
            slot1Map.toLowerCase().includes(searchQuery) || 
            slot2Map.toLowerCase().includes(searchQuery) || 
            slot3Map.toLowerCase().includes(searchQuery);

        if (!matchesSearch) return;

        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-800/40 transition border-b border-gray-800/40";

        if (isCurrentHourRow) {
            tr.classList.add('bg-amber-500/10', 'border-l-4', 'border-l-amber-400');
        }

        function formatCell(mapText, minuteSlot) {
            if (mapText === '-') return `<span class="text-gray-600">-</span>`;
            
            const isMatch = searchQuery !== '' && mapText.toLowerCase().includes(searchQuery);
            const highlightClass = isMatch ? 'bg-amber-400/20 text-amber-200 font-bold px-2 py-0.5 rounded border border-amber-400/30' : '';

            const minVal = parseInt(minuteSlot);
            const utcTodayStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0);
            
            let spawnUtc = utcTodayStart + ((cestHour - 2) * 3600000) + (minVal * 60000);
            let diffMs = nowUtcMs - spawnUtc;
            
            if (diffMs > 43200000) {
                spawnUtc += 86400000;
                diffMs = nowUtcMs - spawnUtc;
            } else if (diffMs < -43200000) {
                spawnUtc -= 86400000;
                diffMs = nowUtcMs - spawnUtc;
            }

            const isActiveNow = (diffMs >= 0 && diffMs <= ACTIVE_DURATION_MS);

            if (isActiveNow) {
                return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-red-500/20 text-red-300 font-bold border border-red-500/40 animate-pulse">
                    <i class="fa-solid fa-bullseye text-[10px]"></i> ${mapText}
                </span>`;
            }

            return `<span class="${highlightClass}">${mapText}</span>`;
        }

        tr.innerHTML = `
            <td class="py-3.5 px-6 font-mono font-bold text-gray-300 flex items-center gap-2">
                ${isCurrentHourRow ? '<i class="fa-solid fa-clock text-amber-400 text-xs"></i>' : ''}
                ${hourLabel}
            </td>
            <td class="py-3.5 px-6">${formatCell(slot1Map, rowObj['03'] ? '03' : '08')}</td>
            <td class="py-3.5 px-6">${formatCell(slot2Map, '23')}</td>
            <td class="py-3.5 px-6">${formatCell(slot3Map, '43')}</td>
        `;

        tbody.appendChild(tr);
    });
}

window.setTimezoneMode = function(mode) {
    displayMode = mode;
    
    const btnIds = {
        'local': 'tz-mode-local',
        'irish': 'tz-mode-irish',
        'cest': 'tz-mode-cest',
        'utc': 'tz-mode-utc'
    };

    Object.keys(btnIds).forEach(m => {
        const btn = document.getElementById(btnIds[m]);
        if (m === mode) {
            btn.className = "flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs font-semibold transition bg-amber-500 text-ptDark-950 shadow-md";
        } else {
            btn.className = "flex-1 sm:flex-none px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-400 hover:text-white transition";
        }
    });

    updateUI();
    renderScheduleTable();
};

document.addEventListener('DOMContentLoaded', () => {
    // Sound Toggles
    const soundBtn = document.getElementById('sound-toggle-btn');
    if (soundBtn) {
        soundBtn.addEventListener('click', () => {
            soundEnabled = !soundEnabled;
            const icon = document.getElementById('sound-icon');
            const text = document.getElementById('sound-status-text');
            if (soundEnabled) {
                icon.className = "fa-solid fa-bell text-amber-400";
                text.textContent = "Audio Alert: On";
                playAlertTone();
            } else {
                icon.className = "fa-solid fa-bell-slash text-gray-500";
                text.textContent = "Audio Alert: Off";
            }
        });
    }

    const testSoundBtn = document.getElementById('test-sound-btn');
    if (testSoundBtn) {
        testSoundBtn.addEventListener('click', playAlertTone);
    }

    // Search Input Setup
    const searchInput = document.getElementById('map-search-input');
    const clearBtn = document.getElementById('clear-search-btn');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            if (e.target.value.trim().length > 0) {
                clearBtn.classList.remove('hidden');
            } else {
                clearBtn.classList.add('hidden');
            }
            renderScheduleTable();
        });
    }

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            searchInput.value = '';
            clearBtn.classList.add('hidden');
            renderScheduleTable();
        });
    }

    // Boot App
    loadSchedule();
});