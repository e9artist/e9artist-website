// ============================================================
        //  WEBTRONOME9
        // ============================================================

        const audioCtx = new(window.AudioContext || window.webkitAudioContext)();

        // ============================================================
        //  CONSTANTS
        // ============================================================

        const MAX_PRESETS = 32;

        // ============================================================
        //  ACCENT LEVEL CONSTANTS
        // ============================================================

        const ACCENT_LEVELS = {
            0: { label: 'Mute',   color: '#e94560' },
            1: { label: 'Soft',   color: '#4a9eff' },
            2: { label: 'Normal', color: '#6ab0ff' },
            3: { label: 'Accent', color: '#f5c842' }
        };

        // ============================================================
        //  STATE VARIABLES
        // ============================================================

        let isPlaying = false;
        let isInitialized = false;
        let nextNoteTime = 0.0;
        let timerID = null;
        const lookahead = 25.0;
        const scheduleAhead = 0.1;

        let masterOscillator = null;
        let oscillatorGainNode = null;
        let sampleGainNode = null;
        let masterGainNode = null;
        let currentVolume = 0.7;

        let displayedBPM = 120.00;
        let actualBPM = 120.00;
        let speedMultiplier = 1;

        let topNumber = 4;
        let bottomNumber = 4;

        let beatCount = 0;
        let measureCount = 0;
        let barsSinceAction = 0;
        let pendingAction = false;
        let hasTriggeredOnce = false;

        let isPercentageMode = true;
        let bpmMin = 1.00;
        let bpmMax = 5.00;
        let percentMin = 1.00;
        let percentMax = 5.00;

        let ninValue = 1;
        let autoMode = 'off';
        let resetBarCounterAfterAction = true;

        let numpadTarget = 'bpm';
        let numpadInputString = '';
        let numpadIsNewInput = true;

        let tempoRangeMin = 20;
        let tempoRangeMax = 500;
        let accentEnabled = false;
        // Tempo decimal places (0, 1, or 2)
        let tempoDecimals = 2;
        const DEFAULT_TEMPO_DECIMALS = 2;

        let currentPresetSlot = 0;
        let presets = {};
        let gridMode = 'beatgrid';

        let loadPresetReturnsToBeatGrid = true;
        let autoSaveOnPresetSwitch = true;
        
        // Accent levels (user-configurable)
        // Level 0 (Mute) is permanently 0 — not user-editable
        const DEFAULT_ACCENT_MULTIPLIERS = {
            1: 0.3,
            2: 0.7,
            3: 1.0
        };

        let accentMultipliers = { ...DEFAULT_ACCENT_MULTIPLIERS };

        const ACCENT_LEVEL_LABELS = {
            1: 'Soft',
            2: 'Normal',
            3: 'Accent'
        };

        let isPresetModalOpen = false;
        // Undo/Redo System
        let undoStack = [];
        let redoStack = [];
        const MAX_UNDO = 50;
        let isApplyingUndo = false;  // guard against recursive pushes
        // Clipboard
        let clipboardBeat = null;   // snapshot of copied beat settings, or null
        let clipboardSourceIndex = 0;
        let clipboardFields = {     // which fields the clipboard carries
            sound: true,
            volume: true,
            accent: true,
            probability: true
        };

        // Context menu
        let contextMenuBeatIndex = 0;
        
        // Copy To modal
        let copyToSourceIndex = 0;
        let copyToSelected = new Set();
        // Populate modal state
        let populateSource = 'oscillator';

        // Sample Library
        let sampleLibrary = [];
        let sampleIdCounter = 0;
        let db = null;
        let samplesLoaded = false;
        
        // Songs
        let songs = {};                   // id -> { name, steps: [{ presetSlot, barCount }] }
        let songIdCounter = 0;
        let selectedSongId = null;        // which song is open in the editor

        let songModeEnabled = false;
        let activeSongId = null;
        let currentStepIndex = 0;
        let barsInStep = 0;               // bars completed in the current step
        let songTempoMultiplier = 1.0;    // global scaling factor
        let preSongSnapshot = null;       // restores on exit
        let pendingSongBarsStep = null;   // step object being edited via numpad
        let stepBeatCount = 0;
        let pendingSongTransition = false;
        let songDenominatorMultiplier = 1.0;
        let songStartAccent = 2.0;              // multiplier applied to beat 1 of bar 1 of step 1
        const DEFAULT_SONG_START_ACCENT = 2.0;
        
        function getAccentMultiplier(level) {
            if (level === 0) return 0;
            return accentMultipliers[level] ?? DEFAULT_ACCENT_MULTIPLIERS[level] ?? 0.7;
        }

        function getAccentPercent(level) {
            return Math.round(getAccentMultiplier(level) * 100);
        }

        function setAccentMultiplier(level, percent) {
            if (level === 0) return;   // mute is not editable
            const clamped = Math.max(0, Math.min(200, Math.round(percent)));
            accentMultipliers[level] = clamped / 100;
            saveAccentMultipliers();
        }

        function resetAccentMultiplier(level) {
            if (level === 0) return;
            accentMultipliers[level] = DEFAULT_ACCENT_MULTIPLIERS[level];
            saveAccentMultipliers();
        }

        function resetAllAccentMultipliers() {
            accentMultipliers = { ...DEFAULT_ACCENT_MULTIPLIERS };
            saveAccentMultipliers();
        }

        function saveAccentMultipliers() {
            try {
                localStorage.setItem('webtronomAccentLevels', JSON.stringify(accentMultipliers));
            } catch (e) {
                console.warn('Could not save accent levels:', e);
            }
        }
        function loadTempoDecimals() {
            try {
                const raw = localStorage.getItem('webtronomTempoDecimals');
                const parsed = parseInt(raw, 10);
                if (parsed === 0 || parsed === 1 || parsed === 2) {
                    tempoDecimals = parsed;
                }
            } catch (e) {
                console.warn('Could not load tempo decimals:', e);
            }
        }

        function saveTempoDecimals() {
            try {
                localStorage.setItem('webtronomTempoDecimals', tempoDecimals.toString());
            } catch (e) {
                console.warn('Could not save tempo decimals:', e);
            }
        }

        function roundToTempoDecimals(value) {
            const factor = Math.pow(10, tempoDecimals);
            return Math.round(value * factor) / factor;
        }
        
                function loadSongStartAccent() {
            try {
                const raw = localStorage.getItem('webtronomSongStartAccent');
                if (raw !== null) {
                    const parsed = parseFloat(raw);
                    if (!isNaN(parsed) && parsed >= 0 && parsed <= 3) {
                        songStartAccent = parsed;
                    }
                }
            } catch (e) {
                console.warn('Could not load song start accent:', e);
            }
        }

        function saveSongStartAccent() {
            try {
                localStorage.setItem('webtronomSongStartAccent', songStartAccent.toString());
            } catch (e) {
                console.warn('Could not save song start accent:', e);
            }
        }

        function loadAccentMultipliers() {
            try {
                const raw = localStorage.getItem('webtronomAccentLevels');
                if (!raw) return;
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    for (const level of [1, 2, 3]) {
                        if (typeof parsed[level] === 'number') {
                            accentMultipliers[level] = Math.max(0, Math.min(2, parsed[level]));
                        }
                    }
                }
            } catch (e) {
                console.warn('Could not load accent levels:', e);
            }
        }
        
        function updateTempoDecimalUI() {
            const buttons = document.querySelectorAll('#tempoDecimalSegmented .seg-btn');
            buttons.forEach(btn => {
                const d = parseInt(btn.dataset.decimals, 10);
                btn.classList.toggle('active', d === tempoDecimals);
            });
        }

        function setTempoDecimals(newDecimals) {
            const d = parseInt(newDecimals, 10);
            if (d !== 0 && d !== 1 && d !== 2) return;
            if (d === tempoDecimals) return;

            tempoDecimals = d;
            saveTempoDecimals();

            // Round the current tempo to the new precision, immediately
            const rounded = roundToTempoDecimals(displayedBPM);
            if (rounded !== displayedBPM) {
                displayedBPM = clampTempo(rounded);
            }

            // Refresh UI everywhere tempo is shown
            updateTempoDisplay();
            updateActualTempo();
            updateTempoDecimalUI();

            // Also refresh the preset modal if it's open
            if (isPresetModalOpen) renderPresetModal();

            saveState();
        }
        
        // ============================================================
        //  SONGS PERSISTENCE
        // ============================================================

        function loadSongs() {
            try {
                const raw = localStorage.getItem('webtronomSongs');
                if (raw) {
                    const parsed = JSON.parse(raw);
                    if (parsed && typeof parsed === 'object') {
                        songs = parsed;
                        let maxN = 0;
                        for (const id of Object.keys(songs)) {
                            const m = id.match(/^song_(\d+)$/);
                            if (m) maxN = Math.max(maxN, parseInt(m[1], 10));
                        }
                        songIdCounter = maxN;
                    }
                }
            } catch (e) {
                console.warn('Could not load songs:', e);
                songs = {};
            }
        }

        function saveSongs() {
            try {
                localStorage.setItem('webtronomSongs', JSON.stringify(songs));
            } catch (e) {
                console.warn('Could not save songs:', e);
            }
        }

        function generateSongId() {
            songIdCounter += 1;
            return 'song_' + songIdCounter;
        }
        
                let copyPartialBeatIndex = 0;

        function openCopyPartialModal(beatIndex) {
            copyPartialBeatIndex = beatIndex;

            // Default: all unchecked
            document.getElementById('copyFieldSound').checked = false;
            document.getElementById('copyFieldVolume').checked = false;
            document.getElementById('copyFieldAccent').checked = false;
            document.getElementById('copyFieldProbability').checked = false;

            updateCopyPartialConfirmState();

            const modal = document.getElementById('copyPartialModal');
            if (modal) modal.classList.add('show');
        }

        function closeCopyPartialModal() {
            const modal = document.getElementById('copyPartialModal');
            if (modal) modal.classList.remove('show');
        }

        function updateCopyPartialConfirmState() {
            const anyChecked =
                document.getElementById('copyFieldSound').checked ||
                document.getElementById('copyFieldVolume').checked ||
                document.getElementById('copyFieldAccent').checked ||
                document.getElementById('copyFieldProbability').checked;

            const confirmBtn = document.getElementById('copyPartialConfirm');
            if (confirmBtn) confirmBtn.disabled = !anyChecked;
        }

        function confirmCopyPartial() {
            const fields = {
                sound: document.getElementById('copyFieldSound').checked,
                volume: document.getElementById('copyFieldVolume').checked,
                accent: document.getElementById('copyFieldAccent').checked,
                probability: document.getElementById('copyFieldProbability').checked
            };

            const anyChecked = fields.sound || fields.volume || fields.accent || fields.probability;
            if (!anyChecked) return;

            copyBeatToClipboard(copyPartialBeatIndex, fields);
            closeCopyPartialModal();
        }
        
        // ============================================================
        //  SETTINGS MODAL
        // ============================================================

        function openSettingsModal() {
            const modal = document.getElementById('settingsModal');
            if (modal) modal.classList.add('show');
        }

        function closeSettingsModal() {
            const modal = document.getElementById('settingsModal');
            if (modal) modal.classList.remove('show');
        }
        
        // ============================================================
        //  SONGS MODAL
        // ============================================================

        function openSongsModal() {
            renderSongsModal();
            const modal = document.getElementById('songsModal');
            if (modal) modal.classList.add('show');
        }

        function closeSongsModal() {
            const modal = document.getElementById('songsModal');
            if (modal) modal.classList.remove('show');
        }

        function createNewSong() {
            const id = generateSongId();
            // Default to preset 1 if it exists, else the first slot
            let defaultSlot = 1;
            if (!presets[defaultSlot]) {
                for (let i = 1; i <= MAX_PRESETS; i++) {
                    if (presets[i]) { defaultSlot = i; break; }
                }
            }
            songs[id] = {
                name: 'Song ' + (Object.keys(songs).length + 1),
                steps: [{ presetSlot: defaultSlot, barCount: 4 }]
            };
            selectedSongId = id;
            saveSongs();
            renderSongsModal();
        }

        function deleteSong(id) {
            if (!songs[id]) return;
            if (!confirm('Delete song "' + songs[id].name + '"?')) return;

            // If this song is currently playing, exit song mode first
            if (songModeEnabled && activeSongId === id) {
                exitSongMode();
            }

            delete songs[id];
            if (selectedSongId === id) selectedSongId = null;
            saveSongs();
            renderSongsModal();
        }

        function renderSongsModal() {
            const list = document.getElementById('songsList');
            const editor = document.getElementById('songsEditor');
            if (!list || !editor) return;

            const songIds = Object.keys(songs);

            if (songIds.length === 0) {
                list.innerHTML = '<div class="songs-list-empty">No songs yet. Click "+ New" to create one.</div>';
                editor.style.display = 'none';
                return;
            }

            // Render list
            list.innerHTML = '';
            for (const id of songIds) {
                const s = songs[id];
                const item = document.createElement('button');
                item.className = 'songs-list-item';
                if (id === selectedSongId) item.classList.add('selected');

                const name = document.createElement('span');
                name.className = 'songs-list-item-name';
                name.textContent = s.name;

                const meta = document.createElement('span');
                meta.className = 'songs-list-item-meta';
                meta.textContent = s.steps.length + ' step' + (s.steps.length === 1 ? '' : 's');

                item.appendChild(name);
                item.appendChild(meta);
                item.addEventListener('click', () => {
                    selectedSongId = id;
                    renderSongsModal();
                });
                list.appendChild(item);
            }

            // Render editor
            if (!selectedSongId || !songs[selectedSongId]) {
                editor.style.display = 'none';
                return;
            }

            editor.style.display = 'block';
            const song = songs[selectedSongId];

            const nameInput = document.getElementById('songNameInput');
            nameInput.value = song.name;

            renderSongSteps(song);
        }
        
        function moveSongStep(song, fromIndex, toIndex) {
            if (!song || !song.steps) return;
            if (fromIndex === toIndex) return;
            if (fromIndex < 0 || fromIndex >= song.steps.length) return;
            if (toIndex < 0 || toIndex >= song.steps.length) return;

            const [moved] = song.steps.splice(fromIndex, 1);
            song.steps.splice(toIndex, 0, moved);

            saveSongs();
            renderSongsModal();
        }

        function renderSongSteps(song) {
            const container = document.getElementById('songsSteps');
            if (!container) return;
            container.innerHTML = '';

            // Are we editing the song that is currently playing?
            const isActiveSong = songModeEnabled &&
                                 activeSongId &&
                                 songs[activeSongId] === song;
            const reorderDisabled = !!isActiveSong;

            song.steps.forEach((step, idx) => {
                const row = document.createElement('div');
                row.className = 'song-step-row';

                const num = document.createElement('span');
                num.className = 'song-step-num';
                num.textContent = (idx + 1) + '.';

                const presetSel = document.createElement('select');
                presetSel.className = 'song-step-preset-select';
                for (let i = 1; i <= MAX_PRESETS; i++) {
                    const opt = document.createElement('option');
                    opt.value = i;
                    opt.textContent = presets[i]
                        ? i + ': ' + (presets[i].name || 'Preset ' + i)
                        : i + ': (empty)';
                    if (i === step.presetSlot) opt.selected = true;
                    presetSel.appendChild(opt);
                }
                presetSel.addEventListener('change', () => {
                    step.presetSlot = parseInt(presetSel.value, 10);
                    saveSongs();
                });

                const bars = document.createElement('input');
                bars.type = 'text';
                bars.className = 'song-step-bars';
                bars.value = step.barCount;
                bars.readOnly = true;
                bars.addEventListener('click', () => {
                    pendingSongBarsStep = step;
                    openNumpad('songBars', step.barCount);
                });

                const unit = document.createElement('span');
                unit.className = 'song-step-bars-unit';
                unit.textContent = 'bars';

                // Up arrow
                const upBtn = document.createElement('button');
                upBtn.className = 'song-step-move';
                upBtn.textContent = '↑';
                upBtn.title = reorderDisabled
                    ? 'Cannot reorder while this song is playing'
                    : 'Move step up';
                upBtn.disabled = (idx === 0) || reorderDisabled;
                upBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (idx === 0 || reorderDisabled) return;
                    moveSongStep(song, idx, idx - 1);
                });

                // Down arrow
                const downBtn = document.createElement('button');
                downBtn.className = 'song-step-move';
                downBtn.textContent = '↓';
                downBtn.title = reorderDisabled
                    ? 'Cannot reorder while this song is playing'
                    : 'Move step down';
                downBtn.disabled = (idx === song.steps.length - 1) || reorderDisabled;
                downBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (idx === song.steps.length - 1 || reorderDisabled) return;
                    moveSongStep(song, idx, idx + 1);
                });

                const remove = document.createElement('button');
                remove.className = 'song-step-remove';
                remove.textContent = '×';
                remove.title = 'Remove step';
                remove.addEventListener('click', () => {
                    if (song.steps.length <= 1) {
                        alert('A song needs at least one step.');
                        return;
                    }
                    song.steps.splice(idx, 1);
                    saveSongs();
                    renderSongsModal();
                });

                row.appendChild(num);
                row.appendChild(presetSel);
                row.appendChild(bars);
                row.appendChild(unit);
                row.appendChild(upBtn);
                row.appendChild(downBtn);
                row.appendChild(remove);
                container.appendChild(row);
            });
        }

        function addSongStep() {
            if (!selectedSongId || !songs[selectedSongId]) return;
            const song = songs[selectedSongId];
            const last = song.steps[song.steps.length - 1];
            const nextSlot = last ? last.presetSlot : 1;
            song.steps.push({ presetSlot: nextSlot, barCount: 4 });
            saveSongs();
            renderSongsModal();
        }
        
        // ============================================================
        //  SONG MODE
        // ============================================================

        function enterSongMode(songId) {
            if (!songs[songId]) return;

            // Only snapshot the pre-song state when entering song mode from a
            // non-song state. If we're already in song mode and switching songs,
            // keep the original snapshot so exiting restores to the right place.
            if (!songModeEnabled) {
                preSongSnapshot = {
                    presetSlot: currentPresetSlot,
                    bpm: displayedBPM,
                    topNumber: topNumber,
                    bottomNumber: bottomNumber,
                    beatSettings: JSON.parse(JSON.stringify(beatSettings)),
                    isPercentageMode: isPercentageMode,
                    volume: currentVolume
                };
            }

            // Preserve practice multipliers when re-entering the same song,
            // so tweaking a song doesn't reset the user's tempo/denominator
            // adjustments. Switching to a different song starts fresh.
            const isReEntry = songModeEnabled && activeSongId === songId;
            if (!isReEntry) {
                songTempoMultiplier = 1.0;
                songDenominatorMultiplier = 1.0;
            }

            activeSongId = songId;
            songModeEnabled = true;
            currentStepIndex = 0;
            barsInStep = 0;
            stepBeatCount = 0;
            pendingSongTransition = false;

            // Always start at step 1. The multipliers, if preserved, are
            // applied to step 1's preset tempo and denominator.
            applySongStep(0);

            updateSongStrip();
            updateSongModeUI();
            closeSongsModal();

            if (isPlaying) {
                stopMetronome();
                startMetronome();
            }
        }

        function exitSongMode() {
            if (!songModeEnabled) return;

            songModeEnabled = false;
            activeSongId = null;
            currentStepIndex = 0;
            barsInStep = 0;
            stepBeatCount = 0;
            songTempoMultiplier = 1.0;
            songDenominatorMultiplier = 1.0;
            pendingSongTransition = false;

            if (preSongSnapshot) {
                displayedBPM = preSongSnapshot.bpm;
                topNumber = preSongSnapshot.topNumber;
                bottomNumber = preSongSnapshot.bottomNumber;
                beatSettings = JSON.parse(JSON.stringify(preSongSnapshot.beatSettings));
                isPercentageMode = preSongSnapshot.isPercentageMode;
                currentPresetSlot = preSongSnapshot.presetSlot;

                topSelect.value = topNumber;
                setBottomSelectValue(bottomNumber);
                updateTempoDisplay();
                updateActualTempo();
                updateRandomDisplay();
                ribToggle.style.color = isPercentageMode ? '#f5c842' : '#4a9eff';

                renderGrid();
                saveStateOnly();
            }

            preSongSnapshot = null;
            stepBeatCount = 0;

            updateSongStrip();
            updateSongModeUI();

            if (isPlaying) {
                stopMetronome();
                startMetronome();
            }
        }
        function setBottomSelectValue(value) {
            if (!bottomSelect) return;
            const numValue = parseInt(value, 10);
            if (isNaN(numValue)) return;

            let found = false;
            for (const opt of bottomSelect.options) {
                if (parseInt(opt.value, 10) === numValue) {
                    found = true;
                    break;
                }
            }
            if (!found) {
                const opt = document.createElement('option');
                opt.value = numValue;
                opt.textContent = numValue;
                // Insert in sorted order for tidiness
                let inserted = false;
                for (let i = 0; i < bottomSelect.options.length; i++) {
                    if (parseInt(bottomSelect.options[i].value, 10) > numValue) {
                        bottomSelect.insertBefore(opt, bottomSelect.options[i]);
                        inserted = true;
                        break;
                    }
                }
                if (!inserted) {
                    bottomSelect.appendChild(opt);
                }
            }
            bottomSelect.value = numValue;
        }

        function applySongStep(stepIndex) {
            if (!activeSongId || !songs[activeSongId]) return;
            const song = songs[activeSongId];
            const step = song.steps[stepIndex];
            if (!step) return;

            const preset = presets[step.presetSlot];
            if (!preset) {
                console.warn('Song step references missing preset ' + step.presetSlot);
                return;
            }
            
            console.log(
                `[song] applySongStep(${stepIndex}): ` +
                `preset ${step.presetSlot}, ` +
                `base=${preset.bpm}, ` +
                `mult=${songTempoMultiplier.toFixed(4)}, ` +
                `→ displayed=${(preset.bpm * songTempoMultiplier).toFixed(2)}`
            );
            
            // Apply preset's time signature, beat grid, volume.
            // In song mode, the denominator is scaled by the global
            // denominator multiplier so a change on any step scales every step.
            topNumber = preset.topNumber;
            bottomNumber = preset.bottomNumber * songDenominatorMultiplier;
            beatSettings = JSON.parse(JSON.stringify(preset.beatSettings));
            currentPresetSlot = step.presetSlot;

            // Effective tempo = preset base tempo × global multiplier.
            // clampTempo() here respects the user's Range modal settings
            // (default 20–500), so the max range is never exceeded.
            const baseBPM = preset.bpm;
            displayedBPM = clampTempo(baseBPM * songTempoMultiplier);

            // Reset per-step bar and beat counters
            beatCount = 0;
            measureCount = 0;
            stepBeatCount = 0;
            barsInStep = 0;

            // Mirror UI
            topSelect.value = topNumber;
            if (songModeEnabled) {
                // In song mode, the select may not have an option matching the
                // effective denominator, so we use the button display instead.
                updateTimeSignatureDisplay();
            } else {
                bottomSelect.value = bottomNumber;
            }

            updateTempoDisplay();
            updateActualTempo();
            updateBeatGrid(0);
            beatDisplay.textContent = '1';
            barsDisplay.textContent = '0';
            updateSongStrip();

            saveStateOnly();
        }

        function updateSongStrip() {
            const strip = document.getElementById('songStrip');
            const nameEl = document.getElementById('songStripName');
            const stepEl = document.getElementById('songStripStep');
            if (!strip || !nameEl || !stepEl) return;

            if (!songModeEnabled || !activeSongId || !songs[activeSongId]) {
                strip.classList.remove('visible');
                return;
            }

            const song = songs[activeSongId];
            const step = song.steps[currentStepIndex];
            if (!step) {
                strip.classList.remove('visible');
                return;
            }

            strip.classList.add('visible');
            nameEl.textContent = song.name;

            const barDisplay = Math.min(barsInStep + 1, step.barCount);
            const multPct = Math.round(songTempoMultiplier * 100);

            stepEl.textContent =
                'Step ' + (currentStepIndex + 1) + ' of ' + song.steps.length +
                ' • Bar ' + barDisplay + ' of ' + step.barCount +
                ' • ' + multPct + '%';
        }

        function updateSongModeUI() {
            const btn = document.getElementById('songModeBtn');
            if (btn) {
                btn.classList.toggle('active', songModeEnabled);
            }
            if (topSelect) {
                topSelect.disabled = songModeEnabled;
                topSelect.style.opacity = songModeEnabled ? '0.4' : '1';
                topSelect.style.cursor = songModeEnabled ? 'default' : 'pointer';
            }
            updateTimeSignatureDisplay();
            if (isPresetModalOpen) renderPresetModal();
        }

        // This is the heart of the new model: whenever displayedBPM changes
        // during song mode, derive the multiplier as effective / base.
        function deriveSongMultiplierFromEffectiveBPM() {
            if (!songModeEnabled || !activeSongId) return;
            const song = songs[activeSongId];
            if (!song) return;
            const step = song.steps[currentStepIndex];
            if (!step) return;
            const preset = presets[step.presetSlot];
            if (!preset || !preset.bpm || preset.bpm <= 0) return;

            songTempoMultiplier = displayedBPM / preset.bpm;
        }

        // ============================================================
        //  BEAT GRID OPERATIONS
        // ============================================================

        function getFactoryBeatDefaults(beatIndex) {
            return {
                source: 'oscillator',
                frequency: 880,
                volume: 0.8,
                waveform: 'square',
                sampleId: null,
                accentLevel: beatIndex === 1 ? 3 : 2,
                probability: 1.0
            };
        }

        function resetAllBeatsToDefault() {
            pushUndoSnapshot();

            for (let i = 1; i <= 32; i++) {
                beatSettings[i] = getFactoryBeatDefaults(i);
            }

            saveBeatSettings();
            saveStateOnly();
            renderGrid();
            closeSettingsModal();
        }

        function applyAccentPattern(settings, beatIndex, pattern) {
            // Base level for all beats in this pattern
            let baseLevel = 2;

            if (pattern === 'none') {
                settings.accentLevel = 2;
                return;
            }

            if (pattern === 'beat1') {
                settings.accentLevel = beatIndex === 1 ? 3 : 2;
                return;
            }

            if (pattern.startsWith('every')) {
                const n = parseInt(pattern.replace('every', ''), 10);
                if (isNaN(n) || n < 1) {
                    settings.accentLevel = 2;
                    return;
                }
                // Beat 1 is index 1; every Nth starting from 1 means (beatIndex - 1) % N === 0
                const isAccent = ((beatIndex - 1) % n) === 0;
                settings.accentLevel = isAccent ? 3 : 2;
                return;
            }

            settings.accentLevel = baseLevel;
        }

        function populateAllBeatsFromTemplate(template) {
            pushUndoSnapshot();

            for (let i = 1; i <= 32; i++) {
                const settings = {
                    source: template.source,
                    frequency: template.frequency,
                    volume: template.volume,
                    waveform: template.waveform,
                    sampleId: template.sampleId,
                    accentLevel: 2,
                    probability: template.probability
                };

                applyAccentPattern(settings, i, template.accentPattern);
                beatSettings[i] = settings;
            }

            saveBeatSettings();
            saveStateOnly();
            renderGrid();
        }

        // ============================================================
        //  POPULATE MODAL
        // ============================================================

        function resetPopulateForm() {
            populateSource = 'oscillator';

            const oscBtn = document.getElementById('populateSourceOscillator');
            const sampBtn = document.getElementById('populateSourceSample');
            if (oscBtn) oscBtn.classList.add('active');
            if (sampBtn) sampBtn.classList.remove('active');

            const oscSection = document.getElementById('populateOscillatorSection');
            const sampSection = document.getElementById('populateSampleSection');
            if (oscSection) oscSection.style.display = 'block';
            if (sampSection) sampSection.style.display = 'none';

            const freqSlider = document.getElementById('populateFreqSlider');
            const freqDisplay = document.getElementById('populateFreqDisplay');
            const defaultFreq = 880;
            if (freqSlider) freqSlider.value = frequencyToSemitones(defaultFreq);
            if (freqDisplay) freqDisplay.textContent = formatFrequencyAsNote(defaultFreq);

            const waveform = document.getElementById('populateWaveform');
            if (waveform) waveform.value = 'square';

            const volSlider = document.getElementById('populateVolSlider');
            const volDisplay = document.getElementById('populateVolDisplay');
            if (volSlider) volSlider.value = 80;
            if (volDisplay) volDisplay.textContent = '80%';

            const probSlider = document.getElementById('populateProbSlider');
            const probDisplay = document.getElementById('populateProbDisplay');
            if (probSlider) probSlider.value = 100;
            if (probDisplay) probDisplay.textContent = '100%';

            const pattern = document.getElementById('populateAccentPattern');
            if (pattern) pattern.value = 'beat1';

            // Refresh sample dropdown
            const sampleSelect = document.getElementById('populateSampleSelect');
            if (sampleSelect) {
                sampleSelect.innerHTML = '';
                if (sampleLibrary.length === 0) {
                    sampleSelect.innerHTML = '<option value="">-- No samples --</option>';
                } else {
                    for (const s of sampleLibrary) {
                        const opt = document.createElement('option');
                        opt.value = s.id;
                        opt.textContent = s.name + ' (' + s.duration.toFixed(2) + 's)';
                        sampleSelect.appendChild(opt);
                    }
                }
            }
        }

        function openPopulateModal() {
            resetPopulateForm();
            closeSettingsModal();
            const modal = document.getElementById('populateModal');
            if (modal) modal.classList.add('show');
        }

        function closePopulateModal() {
            const modal = document.getElementById('populateModal');
            if (modal) modal.classList.remove('show');
        }

        function applyPopulateForm() {
            const freqSlider = document.getElementById('populateFreqSlider');
            const waveformSelect = document.getElementById('populateWaveform');
            const sampleSelect = document.getElementById('populateSampleSelect');
            const volSlider = document.getElementById('populateVolSlider');
            const probSlider = document.getElementById('populateProbSlider');
            const patternSelect = document.getElementById('populateAccentPattern');

            const template = {
                source: populateSource,
                frequency: freqSlider ? semitonesToFrequency(parseInt(freqSlider.value)) : 800,
                waveform: waveformSelect ? waveformSelect.value : 'square',
                sampleId: sampleSelect ? (sampleSelect.value || null) : null,
                volume: volSlider ? parseInt(volSlider.value) / 100 : 0.8,
                probability: probSlider ? parseInt(probSlider.value) / 100 : 1.0,
                accentPattern: patternSelect ? patternSelect.value : 'beat1'
            };

            if (template.source === 'sample' && !template.sampleId) {
                alert('Please select a sample, or switch to Oscillator.');
                return;
            }

            // Validate sample exists (in case it was deleted after opening the modal)
            if (template.source === 'sample' && template.sampleId) {
                const exists = sampleLibrary.some(s => s.id === template.sampleId);
                if (!exists) {
                    template.source = 'oscillator';
                    template.sampleId = null;
                }
            }

            populateAllBeatsFromTemplate(template);
            closePopulateModal();
        }
        
        function updateTimeSignatureDisplay() {
            const select = bottomSelect;
            const display = document.getElementById('bottomDisplaySong');
            const timeSig = document.querySelector('.time-signature');
            if (!select || !display || !timeSig) return;

            if (songModeEnabled) {
                select.style.display = 'none';
                display.style.display = '';
                display.textContent = bottomNumber;
                timeSig.classList.add('song-mode');
            } else {
                select.style.display = '';
                display.style.display = 'none';
                timeSig.classList.remove('song-mode');
            }
        }

        // ============================================================
        //  PER-BEAT SETTINGS (UPDATED)
        // ============================================================

		function getDefaultBeatSettings() {
			const settings = {};
			for (let i = 1; i <= 32; i++) {
				settings[i] = {
					source: 'oscillator',
					frequency: 880,
					volume: 0.8,
					waveform: 'square',
					sampleId: null,
					accentLevel: i === 1 ? 3 : 2,  // ← Beat 1 gets accent!
					probability: 1.0
				};
			}
			return settings;
		}

        let beatSettings = getDefaultBeatSettings();

		function loadBeatSettings() {
			const saved = localStorage.getItem('webtronomBeatSettings');
			if (saved) {
				try {
					const parsed = JSON.parse(saved);
					for (let i = 1; i <= 32; i++) {
						if (!parsed[i]) {
							parsed[i] = { source: 'oscillator', frequency: 880, volume: 0.8, waveform: 'square', sampleId: null, accentLevel: i === 1 ? 3 : 2, probability: 1.0 };
						}
						if (parsed[i].accentLevel === undefined) {
							parsed[i].accentLevel = i === 1 ? 3 : 2;
						}
						if (parsed[i].probability === undefined) parsed[i].probability = 1.0;
						if (!parsed[i].source) parsed[i].source = 'oscillator';
						if (!parsed[i].sampleId) parsed[i].sampleId = null;
					}
					beatSettings = parsed;
					return true;
				} catch (e) {
					beatSettings = getDefaultBeatSettings();
					return false;
				}
			}
			beatSettings = getDefaultBeatSettings();
			return false;
		}

        function saveBeatSettings() {
            localStorage.setItem('webtronomBeatSettings', JSON.stringify(beatSettings));
        }

        function getBeatSettings(beatIndex) {
            if (beatIndex < 1 || beatIndex > 32) return { source: 'oscillator', frequency: 880, volume: 0.8, waveform: 'square', sampleId: null, accentLevel: 2, probability: 1.0 };
            if (!beatSettings[beatIndex]) {
                beatSettings[beatIndex] = { source: 'oscillator', frequency: 880, volume: 0.8, waveform: 'square', sampleId: null, accentLevel: 2, probability: 1.0 };
            }
            return beatSettings[beatIndex];
        }

        function setBeatSetting(beatIndex, key, value) {
            if (beatIndex < 1 || beatIndex > 32) return;
            if (!beatSettings[beatIndex]) {
                beatSettings[beatIndex] = { source: 'oscillator', frequency: 800, volume: 0.8, waveform: 'square', sampleId: null, accentLevel: 2, probability: 1.0 };
            }
            beatSettings[beatIndex][key] = value;
            saveBeatSettings();
            saveStateOnly();
        }
        
        // ============================================================
        //  ACCENT LEVEL UI
        // ============================================================

        function updateAccentLevelUI() {
            for (const level of [1, 2, 3]) {
                const slider = document.getElementById('accentSlider' + level);
                const value = document.getElementById('accentValue' + level);
                const pct = getAccentPercent(level);
                if (slider) slider.value = pct;
                if (value) value.textContent = pct + '%';

                const resetBtn = document.querySelector(`.accent-level-reset[data-level="${level}"]`);
                if (resetBtn) {
                    const isDefault = Math.abs(getAccentMultiplier(level) - DEFAULT_ACCENT_MULTIPLIERS[level]) < 0.001;
                    resetBtn.style.opacity = isDefault ? '0.3' : '0.7';
                }
            }
        }

        function flashBeatsWithAccentLevel(level) {
            // Flash all beats 1..topNumber that use this accent level
            for (let i = 1; i <= topNumber; i++) {
                const settings = getBeatSettings(i);
                if ((settings.accentLevel ?? 2) === level) {
                    const cell = document.querySelector(`.beat-cell[data-index="${i}"]`);
                    if (cell) {
                        cell.classList.add('accent-flash');
                        setTimeout(() => cell.classList.remove('accent-flash'), 400);
                    }
                }
            }
        }
        
                function updateSongStartUI() {
            const slider = document.getElementById('songStartSlider');
            const value = document.getElementById('songStartValue');
            if (!slider || !value) return;
            const pct = Math.round(songStartAccent * 100);
            slider.value = pct;
            value.textContent = pct + '%';
        }

        function setupSongStartControls() {
            const slider = document.getElementById('songStartSlider');
            const value = document.getElementById('songStartValue');
            if (!slider) return;

            slider.addEventListener('input', () => {
                const pct = parseInt(slider.value, 10);
                if (value) value.textContent = pct + '%';
                songStartAccent = pct / 100;
                saveSongStartAccent();
            });

            const resetBtn = document.getElementById('songStartReset');
            if (resetBtn) {
                resetBtn.addEventListener('click', () => {
                    songStartAccent = DEFAULT_SONG_START_ACCENT;
                    saveSongStartAccent();
                    updateSongStartUI();
                });
            }
        }

        function setupAccentLevelControls() {
            for (const level of [1, 2, 3]) {
                const slider = document.getElementById('accentSlider' + level);
                const value = document.getElementById('accentValue' + level);
                if (!slider) continue;

                slider.addEventListener('input', () => {
                    const pct = parseInt(slider.value);
                    if (value) value.textContent = pct + '%';
                    setAccentMultiplier(level, pct);
                    // Flash beats using this level
                    flashBeatsWithAccentLevel(level);
                    // Refresh the reset button state
                    const resetBtn = document.querySelector(`.accent-level-reset[data-level="${level}"]`);
                    if (resetBtn) {
                        const isDefault = Math.abs(getAccentMultiplier(level) - DEFAULT_ACCENT_MULTIPLIERS[level]) < 0.001;
                        resetBtn.style.opacity = isDefault ? '0.3' : '0.7';
                    }
                });
            }

            // Per-slider reset
            document.querySelectorAll('.accent-level-reset').forEach(btn => {
                btn.addEventListener('click', () => {
                    const level = parseInt(btn.dataset.level);
                    resetAccentMultiplier(level);
                    updateAccentLevelUI();
                    flashBeatsWithAccentLevel(level);
                });
            });

            // Reset all
            const resetAll = document.getElementById('accentResetAll');
            if (resetAll) {
                resetAll.addEventListener('click', () => {
                    resetAllAccentMultipliers();
                    updateAccentLevelUI();
                    // Flash all beats 1..topNumber that aren't muted
                    for (let i = 1; i <= topNumber; i++) {
                        const cell = document.querySelector(`.beat-cell[data-index="${i}"]`);
                        if (cell) {
                            cell.classList.add('accent-flash');
                            setTimeout(() => cell.classList.remove('accent-flash'), 400);
                        }
                    }
                });
            }
        }
        
        // ============================================================
        //  EXPORT / IMPORT
        // ============================================================

        const EXPORT_FORMAT = 'webtronom-export';
        const EXPORT_VERSION = 1;

        // ---------- Base64 helpers (chunked to avoid stack limits) ----------

        function arrayBufferToBase64(buffer) {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 0x8000; // 32 KB
            for (let i = 0; i < bytes.length; i += chunkSize) {
                const chunk = bytes.subarray(i, i + chunkSize);
                binary += String.fromCharCode.apply(null, chunk);
            }
            return btoa(binary);
        }

        function base64ToArrayBuffer(base64) {
            const binary = atob(base64);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }
            return bytes.buffer;
        }

        // ---------- Filename helpers ----------

        function buildExportFilename(kind) {
            const now = new Date();
            const pad = (n) => String(n).padStart(2, '0');
            const stamp =
                now.getFullYear() + '-' +
                pad(now.getMonth() + 1) + '-' +
                pad(now.getDate()) + '_' +
                pad(now.getHours()) + '-' +
                pad(now.getMinutes()) + '-' +
                pad(now.getSeconds());
            return 'webtronom-' + kind + '-' + stamp + '.json';
        }

        // ---------- Gather config ----------

        function gatherConfigForExport() {
            const state = localStorage.getItem('webtronomState');
            const beatSettings = localStorage.getItem('webtronomBeatSettings');
            const songs = localStorage.getItem('webtronomSongs');
            const accentLevels = localStorage.getItem('webtronomAccentLevels');
            const tempoDecimals = localStorage.getItem('webtronomTempoDecimals');
            const globalSettings = localStorage.getItem('webtronomGlobalSettings');
            const songStartAccent = localStorage.getItem('webtronomSongStartAccent');
            const currentPresetSlot = localStorage.getItem('currentPresetSlot');
            const gridMode = localStorage.getItem('gridMode');

            const presets = {};
            for (let i = 1; i <= MAX_PRESETS; i++) {
                const raw = localStorage.getItem('preset_' + i);
                if (raw) {
                    try {
                        presets[i] = JSON.parse(raw);
                    } catch (e) {
                        console.warn('Skipping malformed preset ' + i);
                    }
                }
            }

            return {
                state: state ? JSON.parse(state) : null,
                beatSettings: beatSettings ? JSON.parse(beatSettings) : null,
                songs: songs ? JSON.parse(songs) : {},
                presets: presets,
                accentLevels: accentLevels ? JSON.parse(accentLevels) : null,
                tempoDecimals: tempoDecimals !== null ? parseInt(tempoDecimals, 10) : null,
                globalSettings: globalSettings ? JSON.parse(globalSettings) : null,
                songStartAccent: songStartAccent !== null ? parseFloat(songStartAccent) : null,
                currentPresetSlot: currentPresetSlot !== null ? parseInt(currentPresetSlot, 10) : 0,
                gridMode: gridMode || 'beatgrid'
            };
        }

        // ---------- Gather samples ----------

        async function gatherSamplesForExport(includeData) {
            // Only export non-builtin samples. Built-ins are reloaded from
            // the samples/ folder on every page load and shouldn't be
            // duplicated in exports.
            const result = [];
            for (const sample of sampleLibrary) {
                if (sample.builtin) continue;

                const entry = {
                    id: sample.id,
                    name: sample.name,
                    duration: sample.duration,
                    builtin: false
                };

                if (includeData) {
                    // Prefer the ArrayBuffer stored in sample.data (kept in
                    // sync by the sample loading code). Fall back to
                    // re-encoding from the AudioBuffer if for some reason
                    // we don't have raw data.
                    let arrayBuffer = null;
                    if (sample.data instanceof ArrayBuffer) {
                        arrayBuffer = sample.data;
                    } else if (sample.data && sample.data.buffer) {
                        arrayBuffer = sample.data.buffer;
                    }

                    if (arrayBuffer) {
                        entry.data = arrayBufferToBase64(arrayBuffer);
                    } else {
                        console.warn('Sample has no raw data, skipping in export:', sample.name);
                        continue;
                    }
                }

                result.push(entry);
            }
            return result;
        }

        // ---------- Build and download ----------

        async function buildExportObject(includeSamples) {
            const config = gatherConfigForExport();
            const samples = await gatherSamplesForExport(includeSamples);
            return {
                format: EXPORT_FORMAT,
                version: EXPORT_VERSION,
                exportedAt: new Date().toISOString(),
                app: 'WebtronomE9',
                config: config,
                samples: samples
            };
        }

        function downloadJSON(obj, filename) {
            const text = JSON.stringify(obj, null, 2);
            const blob = new Blob([text], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            // Give the browser a moment to start the download before revoking
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }

        async function exportConfig() {
            try {
                const obj = await buildExportObject(false);
                downloadJSON(obj, buildExportFilename('config'));
                console.log('✓ Exported config');
            } catch (e) {
                console.error('Export failed:', e);
                alert('Export failed: ' + e.message);
            }
        }

        async function exportFull() {
            try {
                const obj = await buildExportObject(true);
                const sizeHint = obj.samples.length
                    ? ` (${obj.samples.length} sample${obj.samples.length === 1 ? '' : 's'})`
                    : '';
                downloadJSON(obj, buildExportFilename('full'));
                console.log('✓ Exported full backup' + sizeHint);
            } catch (e) {
                console.error('Export failed:', e);
                alert('Export failed: ' + e.message);
            }
        }

        // ---------- Import: parse and validate ----------

        function parseAndValidateImport(text) {
            let data;
            try {
                data = JSON.parse(text);
            } catch (e) {
                return { valid: false, error: 'Not a valid JSON file.' };
            }

            if (!data || typeof data !== 'object') {
                return { valid: false, error: 'File does not contain a valid export object.' };
            }

            if (data.format !== EXPORT_FORMAT) {
                return { valid: false, error: 'Not a WebtronomE9 export file.' };
            }

            if (typeof data.version !== 'number') {
                return { valid: false, error: 'Export file is missing a version number.' };
            }

            if (data.version > EXPORT_VERSION) {
                return {
                    valid: false,
                    error: `This export was made with a newer version of the app (v${data.version}). ` +
                           `This app supports up to v${EXPORT_VERSION}.`
                };
            }

            if (!data.config || typeof data.config !== 'object') {
                return { valid: false, error: 'Export file has no configuration section.' };
            }

            if (!Array.isArray(data.samples)) {
                return { valid: false, error: 'Export file has no samples section.' };
            }

            // Compute a summary for the confirmation modal
            const presetCount = data.config.presets
                ? Object.keys(data.config.presets).length
                : 0;
            const songCount = data.config.songs
                ? Object.keys(data.config.songs).length
                : 0;
            const sampleCount = data.samples.length;
            const samplesWithData = data.samples.filter(s => s.data).length;
            const totalSampleBytes = data.samples.reduce((sum, s) => {
                if (!s.data) return sum;
                // base64 length * 3/4 approximates the original byte count
                return sum + Math.floor(s.data.length * 0.75);
            }, 0);

            return {
                valid: true,
                data: data,
                summary: {
                    presetCount,
                    songCount,
                    sampleCount,
                    samplesWithData,
                    totalSampleBytes,
                    version: data.version,
                    exportedAt: data.exportedAt
                }
            };
        }

        // ---------- Import: apply ----------

        async function applyImport(data) {
            // 1. Config to localStorage
            const c = data.config;

            if (c.state) {
                localStorage.setItem('webtronomState', JSON.stringify(c.state));
            } else {
                localStorage.removeItem('webtronomState');
            }

            if (c.beatSettings) {
                localStorage.setItem('webtronomBeatSettings', JSON.stringify(c.beatSettings));
            } else {
                localStorage.removeItem('webtronomBeatSettings');
            }

            if (c.songs) {
                localStorage.setItem('webtronomSongs', JSON.stringify(c.songs));
            } else {
                localStorage.removeItem('webtronomSongs');
            }

            if (c.accentLevels) {
                localStorage.setItem('webtronomAccentLevels', JSON.stringify(c.accentLevels));
            } else {
                localStorage.removeItem('webtronomAccentLevels');
            }

            if (typeof c.tempoDecimals === 'number') {
                localStorage.setItem('webtronomTempoDecimals', c.tempoDecimals.toString());
            } else {
                localStorage.removeItem('webtronomTempoDecimals');
            }

            if (c.globalSettings) {
                localStorage.setItem('webtronomGlobalSettings', JSON.stringify(c.globalSettings));
            } else {
                localStorage.removeItem('webtronomGlobalSettings');
            }

            if (typeof c.currentPresetSlot === 'number') {
                localStorage.setItem('currentPresetSlot', c.currentPresetSlot.toString());
            } else {
                localStorage.removeItem('currentPresetSlot');
            }

            if (c.gridMode) {
                localStorage.setItem('gridMode', c.gridMode);
            }
            
            if (typeof c.songStartAccent === 'number') {
                localStorage.setItem('webtronomSongStartAccent', c.songStartAccent.toString());
            } else {
                localStorage.removeItem('webtronomSongStartAccent');
            }

            // Presets: clear all first, then write the imported ones
            for (let i = 1; i <= MAX_PRESETS; i++) {
                localStorage.removeItem('preset_' + i);
            }
            if (c.presets) {
                for (const slot of Object.keys(c.presets)) {
                    const n = parseInt(slot, 10);
                    if (n >= 1 && n <= MAX_PRESETS) {
                        localStorage.setItem('preset_' + n, JSON.stringify(c.presets[slot]));
                    }
                }
            }

            // 2. Samples: only replace if the export contained sample data
            const samplesWithData = data.samples.filter(s => s.data);
            if (samplesWithData.length > 0) {
                try {
                    await openDatabase();

                    // Wipe all existing samples (non-builtins; builtins live
                    // in the same store and will be re-added on next load).
                    const existing = await loadAllSamplesFromDB();
                    for (const s of existing) {
                        await deleteSampleFromDB(s.id);
                    }

                    // Insert the imported ones
                    for (const s of samplesWithData) {
                        try {
                            const arrayBuffer = base64ToArrayBuffer(s.data);
                            const dbSample = {
                                id: s.id,
                                name: s.name,
                                duration: s.duration,
                                builtin: false,
                                data: arrayBuffer
                            };
                            await saveSampleToDB(dbSample);
                        } catch (e) {
                            console.warn('Skipping malformed sample:', s.name, e);
                        }
                    }

                    console.log(`✓ Imported ${samplesWithData.length} samples`);
                } catch (e) {
                    console.warn('Sample import failed:', e);
                    alert('Configuration was imported, but samples failed to load. ' +
                          'You may need to re-upload them.');
                }
            }

            // 3. Also clear undo history, since it references the old state
            try {
                localStorage.removeItem('webtronomUndoStack');
            } catch (e) {}
        }

        // ---------- Import: UI flow ----------

        let pendingImportData = null;

        function openImportModal(summary, data) {
            pendingImportData = data;

            const summaryEl = document.getElementById('importSummary');
            const sizeKB = (summary.totalSampleBytes / 1024).toFixed(1);
            const exportedDate = summary.exportedAt
                ? new Date(summary.exportedAt).toLocaleString()
                : '(unknown)';

            summaryEl.innerHTML = `
                <div class="import-line"><span>Presets</span><span><strong>${summary.presetCount}</strong></span></div>
                <div class="import-line"><span>Songs</span><span><strong>${summary.songCount}</strong></span></div>
                <div class="import-line"><span>Samples in file</span><span><strong>${summary.sampleCount}</strong></span></div>
                ${summary.samplesWithData > 0
                    ? `<div class="import-line"><span>Sample data</span><span><strong>${sizeKB} KB</strong></span></div>`
                    : ''}
                <div class="import-line"><span>Exported</span><span>${exportedDate}</span></div>
            `;

            const modal = document.getElementById('importModal');
            if (modal) modal.classList.add('show');
        }

        function closeImportModal() {
            pendingImportData = null;
            const modal = document.getElementById('importModal');
            if (modal) modal.classList.remove('show');
        }

        async function confirmImport() {
            if (!pendingImportData) {
                closeImportModal();
                return;
            }
            const data = pendingImportData;
            closeImportModal();

            try {
                await applyImport(data);
                console.log('✓ Import complete; reloading…');
                // Reload so the app reinitializes from the imported state
                location.reload();
            } catch (e) {
                console.error('Import failed:', e);
                alert('Import failed: ' + e.message);
            }
        }

        // ---------- Import: file picker ----------

        function handleImportFile(file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const text = e.target.result;
                const result = parseAndValidateImport(text);
                if (!result.valid) {
                    alert('Import failed: ' + result.error);
                    return;
                }
                openImportModal(result.summary, result.data);
            };
            reader.onerror = () => {
                alert('Could not read the file.');
            };
            reader.readAsText(file);
        }

        // ============================================================
        //  SAMPLE SYSTEM
        // ============================================================

        const DB_NAME = 'WebtronomSamples';
        const STORE_NAME = 'samples';

        function openDatabase() {
            return new Promise((resolve, reject) => {
                const request = indexedDB.open(DB_NAME, 1);
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains(STORE_NAME)) {
                        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    }
                };
                request.onsuccess = (e) => {
                    db = e.target.result;
                    resolve(db);
                };
                request.onerror = (e) => {
                    reject(e.target.error);
                };
            });
        }

        function saveSampleToDB(sample) {
            return new Promise((resolve, reject) => {
                if (!db) {
                    reject('Database not open');
                    return;
                }
                
                // Ensure we're storing a clean ArrayBuffer copy
                let dataToStore;
                if (sample.data instanceof ArrayBuffer) {
                    dataToStore = sample.data.slice(0);
                } else if (sample.data && sample.data.buffer) {
                    dataToStore = sample.data.buffer.slice(0);
                } else {
                    reject('Sample has no valid data');
                    return;
                }
        
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const dbSample = {
                    id: sample.id,
                    name: sample.name,
                    duration: sample.duration,
                    builtin: sample.builtin,
                    data: dataToStore
                };
                const request = store.put(dbSample);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        function deleteSampleFromDB(id) {
            return new Promise((resolve, reject) => {
                if (!db) {
                    reject('Database not open');
                    return;
                }
                const transaction = db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.delete(id);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });
        }

        function loadAllSamplesFromDB() {
            return new Promise((resolve, reject) => {
                if (!db) {
                    reject('Database not open');
                    return;
                }
                const transaction = db.transaction([STORE_NAME], 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        }

        function generateSampleId() {
            return 'samp_' + Date.now() + '_' + (sampleIdCounter++);
        }

        async function loadSampleFromFile(file) {
            try {
                const arrayBuffer = await file.arrayBuffer();
                
                // Make a copy BEFORE decoding — decodeAudioData consumes the buffer
                const dataCopy = arrayBuffer.slice(0);
                
                const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

                const sample = {
                    id: generateSampleId(),
                    name: file.name,
                    buffer: audioBuffer,
                    duration: audioBuffer.duration,
                    builtin: false,
                    data: dataCopy
                };

                const existing = sampleLibrary.find(s => s.name === file.name && !s.builtin);
                if (existing) {
                    const index = sampleLibrary.indexOf(existing);
                    sampleLibrary[index] = sample;
                } else {
                    sampleLibrary.push(sample);
                }

                try {
                    await saveSampleToDB(sample);
                    console.log('Sample saved to IndexedDB:', sample.name);
                } catch (dbError) {
                    console.warn('Failed to save sample to IndexedDB:', dbError);
                }

                renderSampleManager();
                updateSampleDropdowns();
                saveState();
                return sample;
            } catch (e) {
                console.error('Failed to load sample:', e);
                alert('Could not load this audio file. Please try a different file.');
                return null;
            }
        }

        async function loadBuiltinSamples() {
            const MANIFEST_URL = 'samples/samples.json';
            const SAMPLES_DIR = 'samples/';

            let manifest;
            try {
                const res = await fetch(MANIFEST_URL, { cache: 'no-cache' });
                if (!res.ok) {
                    console.log('No samples.json found — skipping auto-load.');
                    return;
                }
                manifest = await res.json();
            } catch (e) {
                console.log('Could not fetch samples.json:', e.message);
                return;
            }

            if (!manifest || !Array.isArray(manifest.samples)) {
                console.warn('samples.json has no "samples" array.');
                return;
            }

            let loadedCount = 0;

            for (const entry of manifest.samples) {
                if (!entry || !entry.file) continue;

                const url = SAMPLES_DIR + entry.file;
                const sampleName = entry.name || entry.file;

                // Skip if already loaded (e.g., restored from IndexedDB)
                const existing = sampleLibrary.find(s => s.name === sampleName);
                if (existing) {
                    existing.builtin = true;
                    continue;
                }

                try {
                    const res = await fetch(url);
                    if (!res.ok) {
                        console.warn(`Sample missing: ${url} (${res.status})`);
                        continue;
                    }

                    const arrayBuffer = await res.arrayBuffer();
                    const dataCopy = arrayBuffer.slice(0);
                    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

                    const sample = {
                        id: 'builtin_' + sampleName.replace(/\s+/g, '_').toLowerCase(),
                        name: sampleName,
                        buffer: audioBuffer,
                        duration: audioBuffer.duration,
                        builtin: true,
                        data: dataCopy
                    };

                    sampleLibrary.push(sample);
                    loadedCount++;

                    try {
                        await saveSampleToDB(sample);
                    } catch (dbErr) {
                        console.warn('Could not persist builtin sample:', dbErr);
                    }

                } catch (e) {
                    console.warn(`Failed to load sample "${sampleName}" from ${url}:`, e);
                }
            }

            console.log(`🎼 Built-in samples loaded: ${loadedCount}`);
        }

        function playSamplePreview(sampleId) {
            const sample = sampleLibrary.find(s => s.id === sampleId);
            if (!sample) return;

            try {
                const source = audioCtx.createBufferSource();
                source.buffer = sample.buffer;
                const gain = audioCtx.createGain();
                gain.gain.value = 0.5;
                source.connect(gain);
                gain.connect(audioCtx.destination);
                source.start();
            } catch (e) {
                console.warn('Failed to preview sample:', e);
            }
        }

        async function deleteSample(sampleId) {
            const sample = sampleLibrary.find(s => s.id === sampleId);
            if (!sample) return;

            if (sample.builtin) {
                alert('Built-in samples cannot be deleted.');
                return;
            }

            let usedInBeats = [];
            for (let i = 1; i <= 32; i++) {
                const settings = beatSettings[i];
                if (settings && settings.source === 'sample' && settings.sampleId === sampleId) {
                    usedInBeats.push(i);
                }
            }

            if (usedInBeats.length > 0) {
                const beatList = usedInBeats.join(', ');
                if (!confirm(`This sample is used on beat(s) ${beatList}. Deleting it will reset those beats to oscillator. Continue?`)) {
                    return;
                }
                for (const beat of usedInBeats) {
                    if (beatSettings[beat]) {
                        beatSettings[beat].source = 'oscillator';
                        beatSettings[beat].sampleId = null;
                    }
                }
                saveBeatSettings();
                saveState();
                clearUndoHistory();
            }

            sampleLibrary = sampleLibrary.filter(s => s.id !== sampleId);
            await deleteSampleFromDB(sampleId);
            renderSampleManager();
            updateSampleDropdowns();
            saveState();
        }

        // ============================================================
        //  SAMPLE UI
        // ============================================================

        function renderSampleManager() {
            const list = document.getElementById('sampleManagerList');
            if (!list) return;

            if (sampleLibrary.length === 0) {
                list.innerHTML = '<div class="sample-manager-empty">No samples loaded yet. Upload a WAV, MP3, or other audio file.</div>';
                return;
            }

            let html = '';
            for (const sample of sampleLibrary) {
                const durationStr = sample.duration.toFixed(2) + 's';
                const builtinBadge = sample.builtin ? '<span class="builtin-badge">built-in</span>' : '';
                const deleteBtn = sample.builtin ? '' : `<button class="sample-btn delete-btn" data-id="${sample.id}">×</button>`;

                html += `
                    <div class="sample-item" data-id="${sample.id}">
                        <span class="name">${sample.name} ${builtinBadge}</span>
                        <span class="duration">${durationStr}</span>
                        <button class="sample-btn play-btn" data-id="${sample.id}">▶</button>
                        ${deleteBtn}
                    </div>
                `;
            }
            list.innerHTML = html;

            list.querySelectorAll('.play-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    playSamplePreview(id);
                });
            });

            list.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const id = btn.dataset.id;
                    deleteSample(id);
                });
            });
        }

        function updateSampleDropdowns() {
            const select = document.getElementById('beatEditorSampleSelect');
            if (!select) return;

            const currentValue = select.value;

            select.innerHTML = '';
            if (sampleLibrary.length === 0) {
                select.innerHTML = '<option value="">-- No samples --</option>';
                return;
            }

            for (const sample of sampleLibrary) {
                const option = document.createElement('option');
                option.value = sample.id;
                option.textContent = sample.name + ' (' + sample.duration.toFixed(2) + 's)';
                select.appendChild(option);
            }

            if (currentValue && sampleLibrary.some(s => s.id === currentValue)) {
                select.value = currentValue;
            }
        }

        // ============================================================
        //  BEAT EDITOR (UPDATED)
        // ============================================================

        let beatEditorIndex = 0;
        let beatEditorOriginalSettings = null;
        let beatEditorTempSettings = {
            source: 'oscillator',
            frequency: 800,
            waveform: 'square',
            sampleId: null,
            volume: 0.8,
            accentLevel: 2,
            probability: 1.0
        };

        function openBeatEditor(beatIndex) {
            beatEditorIndex = beatIndex;
            const settings = getBeatSettings(beatIndex);
            beatEditorOriginalSettings = JSON.parse(JSON.stringify(settings));

            beatEditorTempSettings = {
                source: settings.source || 'oscillator',
                frequency: settings.frequency || 800,
                waveform: settings.waveform || 'square',
                sampleId: settings.sampleId || null,
                volume: settings.volume || 0.8,
                accentLevel: settings.accentLevel ?? 2,
                probability: settings.probability ?? 1.0
            };

            const title = document.getElementById('beatEditorTitle');
            if (title) title.textContent = 'Edit Beat: ' + beatIndex + ' of ' + topNumber;

            const oscBtn = document.getElementById('beatEditorSourceOscillator');
            const sampBtn = document.getElementById('beatEditorSourceSample');
            if (oscBtn) oscBtn.classList.toggle('active', beatEditorTempSettings.source === 'oscillator');
            if (sampBtn) sampBtn.classList.toggle('active', beatEditorTempSettings.source === 'sample');

            const oscSection = document.getElementById('beatEditorOscillatorSection');
            const sampSection = document.getElementById('beatEditorSampleSection');
            if (oscSection) oscSection.style.display = beatEditorTempSettings.source === 'oscillator' ? 'block' : 'none';
            if (sampSection) sampSection.style.display = beatEditorTempSettings.source === 'sample' ? 'block' : 'none';

            const freqSlider = document.getElementById('beatEditorFreqSlider');
            const freqDisplay = document.getElementById('beatEditorFreqDisplay');
            if (freqSlider) {
                // Slider works in semitone offsets from A4 (min=-33, max=27)
                freqSlider.value = frequencyToSemitones(beatEditorTempSettings.frequency);
            }
            if (freqDisplay) {
                freqDisplay.textContent = formatFrequencyAsNote(beatEditorTempSettings.frequency);
            }

            const waveformSelect = document.getElementById('beatEditorWaveform');
            if (waveformSelect) waveformSelect.value = beatEditorTempSettings.waveform;

            updateSampleDropdowns();
            const sampleSelect = document.getElementById('beatEditorSampleSelect');
            if (sampleSelect && beatEditorTempSettings.sampleId) {
                sampleSelect.value = beatEditorTempSettings.sampleId;
            }

            const volSlider = document.getElementById('beatEditorVolSlider');
            const volDisplay = document.getElementById('beatEditorVolDisplay');
            if (volSlider) volSlider.value = Math.round(beatEditorTempSettings.volume * 100);
            if (volDisplay) volDisplay.textContent = Math.round(beatEditorTempSettings.volume * 100) + '%';

            // Accent Level buttons — also update their descriptions to reflect current multipliers
            const accentLevelBtns = document.querySelectorAll('.beat-editor-accent-btn');
            accentLevelBtns.forEach(btn => {
                const level = parseInt(btn.dataset.level);
                btn.classList.remove('active-level-0', 'active-level-1', 'active-level-2', 'active-level-3');
                if (level === beatEditorTempSettings.accentLevel) {
                    btn.classList.add('active-level-' + level);
                }

                // Update the description text
                const descEl = btn.querySelector('.level-desc');
                if (descEl) {
                    if (level === 0) {
                        descEl.textContent = 'silent';
                    } else {
                        descEl.textContent = getAccentPercent(level) + '%';
                    }
                }
            });

            // Probability
            const probSlider = document.getElementById('beatEditorProbSlider');
            const probDisplay = document.getElementById('beatEditorProbDisplay');
            if (probSlider) probSlider.value = Math.round(beatEditorTempSettings.probability * 100);
            if (probDisplay) probDisplay.textContent = Math.round(beatEditorTempSettings.probability * 100) + '%';

            const modal = document.getElementById('beatEditorModal');
            if (modal) modal.classList.add('show');
        }

        function closeBeatEditor() {
            const modal = document.getElementById('beatEditorModal');
            if (modal) modal.classList.remove('show');
            beatEditorOriginalSettings = null;
        }

        function cancelBeatEditor() {
            if (beatEditorOriginalSettings && beatEditorIndex) {
                beatSettings[beatEditorIndex] = JSON.parse(JSON.stringify(beatEditorOriginalSettings));
                saveBeatSettings();
                saveStateOnly();
                updateBeatGridCell(beatEditorIndex);
            }
            closeBeatEditor();
        }

        function applyBeatEditorChanges() {
            const original = beatEditorOriginalSettings;
            const current = getBeatSettings(beatEditorIndex);

            const changed = JSON.stringify(original) !== JSON.stringify(current);

            if (changed) {
                // Build a "pre-edit" snapshot: current beatSettings with the edited beat reverted
                const preEditSnapshot = JSON.parse(JSON.stringify(beatSettings));
                preEditSnapshot[beatEditorIndex] = JSON.parse(JSON.stringify(original));
                pushUndoSnapshotFromState(preEditSnapshot);
            }

            closeBeatEditor();
        }

        function resetBeatEditor() {
            const original = beatEditorOriginalSettings;

            // Build pre-edit snapshot for undo
            const preEditSnapshot = JSON.parse(JSON.stringify(beatSettings));
            preEditSnapshot[beatEditorIndex] = JSON.parse(JSON.stringify(original));
            pushUndoSnapshotFromState(preEditSnapshot);

            beatSettings[beatEditorIndex] = {
                source: 'oscillator',
                frequency: 880,
                volume: 0.8,
                waveform: 'square',
                sampleId: null,
                accentLevel: beatEditorIndex === 1 ? 3 : 2,
                probability: 1.0
            };

            saveBeatSettings();
            saveStateOnly();
            closeBeatEditor();
            renderGrid();
        }
		
		        function commitBeatEditorTempToLive() {
            if (!beatEditorIndex) return;
            if (!beatSettings[beatEditorIndex]) {
                beatSettings[beatEditorIndex] = {};
            }

            const s = beatEditorTempSettings;

            beatSettings[beatEditorIndex].source = s.source;
            beatSettings[beatEditorIndex].frequency = s.frequency;
            beatSettings[beatEditorIndex].waveform = s.waveform;
            beatSettings[beatEditorIndex].sampleId = s.sampleId;
            beatSettings[beatEditorIndex].volume = s.volume;
            beatSettings[beatEditorIndex].accentLevel = s.accentLevel;
            beatSettings[beatEditorIndex].probability = s.probability;

            saveBeatSettings();
            saveStateOnly();

            // Update the grid cell styling live
            updateBeatGridCell(beatEditorIndex);
        }

        function updateBeatGridCell(beatIndex) {
            const cell = document.querySelector(`.beat-cell[data-index="${beatIndex}"]`);
            if (!cell) return;

            const settings = getBeatSettings(beatIndex);
            const accentLevel = settings.accentLevel ?? 2;

            // Strip old accent classes
            for (let i = 0; i <= 3; i++) cell.classList.remove('accent-level-' + i);
            cell.classList.add('accent-level-' + accentLevel);

            // Update the probability indicator
            const prob = settings.probability ?? 1.0;
            let probInd = cell.querySelector('.prob-indicator');
            if (prob < 1.0) {
                if (!probInd) {
                    probInd = document.createElement('span');
                    probInd.className = 'prob-indicator';
                    cell.appendChild(probInd);
                }
                probInd.textContent = Math.round(prob * 100) + '%';
                probInd.classList.toggle('high', prob > 0.7);
            } else if (probInd) {
                probInd.remove();
            }
        }

        // ============================================================
        //  GRID MODE PERSISTENCE
        // ============================================================

        function saveGridMode() {
            localStorage.setItem('gridMode', gridMode);
        }

        function loadGridMode() {
            const saved = localStorage.getItem('gridMode');
            if (saved === 'beatgrid' || saved === 'presets') {
                return saved;
            }
            return 'beatgrid';
        }

        // ============================================================
        //  CURRENT PRESET SLOT PERSISTENCE
        // ============================================================

        function saveCurrentPresetSlot() {
            localStorage.setItem('currentPresetSlot', currentPresetSlot);
        }

        function loadCurrentPresetSlot() {
            const saved = localStorage.getItem('currentPresetSlot');
            if (saved !== null) {
                const slot = parseInt(saved);
                if (slot >= 0 && slot <= MAX_PRESETS) {
                    return slot;
                }
            }
            return 0;
        }
        
        // ============================================================
        //  COPY TO MODAL
        // ============================================================

        function openCopyToModal(sourceIndex) {
            copyToSourceIndex = clipboardSourceIndex || sourceIndex;
            copyToSelected = new Set();

            const title = document.getElementById('copyToTitle');
            if (title) {
                const srcLabel = clipboardSourceIndex || sourceIndex;
                title.textContent = `Paste Beat ${srcLabel} to…`;
            }
            const remainingBtn = document.getElementById('copyToSelectRemaining');
            if (remainingBtn) {
                remainingBtn.disabled = (sourceIndex >= 32);
            }

            // Reset advanced fields to sensible defaults
            const fromInput = document.getElementById('copyToFrom');
            const toInput = document.getElementById('copyToTo');
            const everyInput = document.getElementById('copyToEvery');
            if (fromInput) fromInput.value = '1';
            if (toInput) toInput.value = topNumber.toString();
            if (everyInput) everyInput.value = '1';

            renderCopyToGrid();
            updateCopyToSummary();

            const modal = document.getElementById('copyToModal');
            if (modal) modal.classList.add('show');
        }

        function closeCopyToModal() {
            const modal = document.getElementById('copyToModal');
            if (modal) modal.classList.remove('show');
        }

        function renderCopyToGrid() {
            const grid = document.getElementById('copyToGrid');
            if (!grid) return;

            const fragment = document.createDocumentFragment();

            for (let i = 1; i <= 32; i++) {
                const cell = document.createElement('div');
                cell.className = 'copy-to-cell';
                cell.dataset.index = i;
                cell.textContent = i;

                // Mark beats beyond topNumber as visually inactive but selectable
                if (i > topNumber) {
                    cell.classList.add('inactive-range');
                }

                // Mark source
                if (i === copyToSourceIndex) {
                    cell.classList.add('source');
                }

                // Mark selected
                if (copyToSelected.has(i)) {
                    cell.classList.add('selected');
                }

                cell.addEventListener('click', () => {
                    if (i === copyToSourceIndex) return;  // can't paste to self
                    if (copyToSelected.has(i)) {
                        copyToSelected.delete(i);
                    } else {
                        copyToSelected.add(i);
                    }
                    renderCopyToGrid();
                    updateCopyToSummary();
                });

                fragment.appendChild(cell);
            }

            grid.innerHTML = '';
            grid.appendChild(fragment);
        }

        function updateCopyToSummary() {
            const summary = document.getElementById('copyToSummary');
            if (!summary) return;
            if (copyToSelected.size === 0) {
                summary.textContent = 'Selected: —';
            } else {
                const sorted = Array.from(copyToSelected).sort((a, b) => a - b);
                summary.textContent = `Selected: ${sorted.join(', ')}`;
            }
        }

        function applyCopyToSelection() {
            if (copyToSelected.size === 0) {
                closeCopyToModal();
                return;
            }

            const results = {};
            let willChange = false;
            for (const idx of copyToSelected) {
                const next = computeClipboardResult(idx);
                if (next !== null) {
                    results[idx] = next;
                    willChange = true;
                }
            }

            if (willChange) {
                pushUndoSnapshot();
                for (const idx of copyToSelected) {
                    if (results[idx]) {
                        beatSettings[idx] = results[idx];
                    }
                }
                saveBeatSettings();
                saveStateOnly();
            }

            renderGrid();
            closeCopyToModal();

            for (const idx of copyToSelected) {
                flashBeatCell(idx);
            }
        }
        
        function selectRemainingInCopyToModal() {
            if (copyToSourceIndex >= 32) return;

            copyToSelected = new Set();
            for (let i = copyToSourceIndex + 1; i <= 32; i++) {
                copyToSelected.add(i);
            }

            renderCopyToGrid();
            updateCopyToSummary();
        }

        function applyCopyToRange() {
            const from = parseInt(document.getElementById('copyToFrom').value);
            const to = parseInt(document.getElementById('copyToTo').value);
            const every = parseInt(document.getElementById('copyToEvery').value);

            if (isNaN(from) || isNaN(to) || isNaN(every)) return;
            if (from < 1 || to > 32 || from > to || every < 1) return;

            copyToSelected = new Set();
            for (let i = from; i <= to; i += every) {
                if (i === copyToSourceIndex) continue;
                copyToSelected.add(i);
            }

            renderCopyToGrid();
            updateCopyToSummary();
        }
        
        // ============================================================
        //  CLIPBOARD SYSTEM
        // ============================================================

        function copyBeatToClipboard(beatIndex, fields) {
            const settings = getBeatSettings(beatIndex);
            clipboardBeat = JSON.parse(JSON.stringify(settings));
            clipboardSourceIndex = beatIndex;

            // fields is optional. When omitted, default to all fields (full copy).
            if (fields) {
                clipboardFields = {
                    sound: !!fields.sound,
                    volume: !!fields.volume,
                    accent: !!fields.accent,
                    probability: !!fields.probability
                };
            } else {
                clipboardFields = {
                    sound: true,
                    volume: true,
                    accent: true,
                    probability: true
                };
            }

            updateClipboardStrip();
            const summary = describeClipboardFields();
            console.log(`⧉ Copied beat ${beatIndex} (${summary})`);
        }

        function describeClipboardFields() {
            const names = [];
            if (clipboardFields.sound) names.push('Sound');
            if (clipboardFields.volume) names.push('Volume');
            if (clipboardFields.accent) names.push('Accent');
            if (clipboardFields.probability) names.push('Probability');
            if (names.length === 4) return 'all fields';
            if (names.length === 0) return 'nothing';
            return names.join(' + ');
        }

        function clearClipboard() {
            clipboardBeat = null;
            clipboardSourceIndex = 0;
            clipboardFields = {
                sound: true,
                volume: true,
                accent: true,
                probability: true
            };
            updateClipboardStrip();
        }

        function updateClipboardStrip() {
            const strip = document.getElementById('clipboardStrip');
            const text = document.getElementById('clipboardText');
            if (!strip) return;

            if (clipboardBeat) {
                strip.style.display = 'flex';
                const names = [];
                if (clipboardFields.sound) names.push('Sound');
                if (clipboardFields.volume) names.push('Volume');
                if (clipboardFields.accent) names.push('Accent');
                if (clipboardFields.probability) names.push('Probability');

                if (names.length === 4) {
                    text.textContent = `Beat ${clipboardSourceIndex} copied`;
                } else if (names.length === 0) {
                    text.textContent = `Beat ${clipboardSourceIndex} copied (nothing)`;
                } else {
                    text.textContent = `Beat ${clipboardSourceIndex} copied (${names.join(' + ')})`;
                }
            } else {
                strip.style.display = 'none';
            }
        }
        
        function copyBeatToRemaining(beatIndex) {
            if (beatIndex >= 32) return;
            if (!clipboardBeat) return;

            // Compute the result for every beat to the right
            const results = {};
            let willChange = false;
            for (let i = beatIndex + 1; i <= 32; i++) {
                const next = computeClipboardResult(i);
                if (next !== null) {
                    results[i] = next;
                    willChange = true;
                }
            }

            if (willChange) {
                pushUndoSnapshot();
                for (const idxStr of Object.keys(results)) {
                    const idx = parseInt(idxStr, 10);
                    beatSettings[idx] = results[idx];
                }
                saveBeatSettings();
                saveStateOnly();
            }

            renderGrid();

            for (let i = beatIndex + 1; i <= 32; i++) {
                flashBeatCell(i);
            }
        }
        
                // Applies the clipboard to a single beat, respecting clipboardFields.
        // Returns true if anything changed, false otherwise.
        function applyClipboardTo(beatIndex) {
            if (!clipboardBeat) return false;

            const source = clipboardBeat;
            const current = getBeatSettings(beatIndex);
            const next = JSON.parse(JSON.stringify(current));

            // Sound
            if (clipboardFields.sound) {
                next.source = source.source;
                next.frequency = source.frequency;
                next.waveform = source.waveform;
                next.sampleId = source.sampleId;

                // Validate sample existence when sound is being pasted
                if (next.source === 'sample' && next.sampleId) {
                    const exists = sampleLibrary.some(s => s.id === next.sampleId);
                    if (!exists) {
                        next.source = 'oscillator';
                        next.sampleId = null;
                    }
                }
            }

            // Volume
            if (clipboardFields.volume) {
                next.volume = source.volume;
            }

            // Accent
            if (clipboardFields.accent) {
                next.accentLevel = source.accentLevel;
            }

            // Probability
            if (clipboardFields.probability) {
                next.probability = source.probability;
            }

            // No-op if nothing changed
            if (JSON.stringify(current) === JSON.stringify(next)) {
                return false;
            }

            beatSettings[beatIndex] = next;
            return true;
        }
        
        // Returns the "next" beat settings object (masked against current),
        // or null if nothing would change.
        function computeClipboardResult(beatIndex) {
            if (!clipboardBeat) return null;

            const source = clipboardBeat;
            const current = getBeatSettings(beatIndex);
            const next = JSON.parse(JSON.stringify(current));

            if (clipboardFields.sound) {
                next.source = source.source;
                next.frequency = source.frequency;
                next.waveform = source.waveform;
                next.sampleId = source.sampleId;

                if (next.source === 'sample' && next.sampleId) {
                    const exists = sampleLibrary.some(s => s.id === next.sampleId);
                    if (!exists) {
                        next.source = 'oscillator';
                        next.sampleId = null;
                    }
                }
            }
            if (clipboardFields.volume) {
                next.volume = source.volume;
            }
            if (clipboardFields.accent) {
                next.accentLevel = source.accentLevel;
            }
            if (clipboardFields.probability) {
                next.probability = source.probability;
            }

            if (JSON.stringify(current) === JSON.stringify(next)) return null;
            return next;
        }

        function pasteBeatTo(beatIndex) {
            if (!clipboardBeat) return;

            const next = computeClipboardResult(beatIndex);
            if (next === null) {
                flashBeatCell(beatIndex);
                return;
            }

            pushUndoSnapshot();
            beatSettings[beatIndex] = next;
            saveBeatSettings();
            saveStateOnly();
            renderGrid();
            flashBeatCell(beatIndex);
        }

        function flashBeatCell(beatIndex) {
            const cell = document.querySelector(`.beat-cell[data-index="${beatIndex}"]`);
            if (!cell) return;
            cell.classList.add('paste-flash');
            setTimeout(() => cell.classList.remove('paste-flash'), 300);
        }

        // ============================================================
        //  BEAT CONTEXT MENU
        // ============================================================

        function openBeatContextMenu(beatIndex, x, y) {
            contextMenuBeatIndex = beatIndex;
            const menu = document.getElementById('beatContextMenu');
            if (!menu) return;

            // Paste items require a non-empty clipboard
            const pasteBtn = menu.querySelector('[data-action="paste"]');
            if (pasteBtn) pasteBtn.disabled = !clipboardBeat;

            const pasteToBtn = menu.querySelector('[data-action="copyTo"]');
            if (pasteToBtn) pasteToBtn.disabled = !clipboardBeat;

            const pasteToRemainingBtn = menu.querySelector('[data-action="copyToRemaining"]');
            if (pasteToRemainingBtn) {
                pasteToRemainingBtn.disabled = !clipboardBeat || (beatIndex >= 32);
            }

            // Position, then clamp to viewport
            menu.style.left = '0px';
            menu.style.top = '0px';
            menu.classList.add('show');

            const rect = menu.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;

            let left = x;
            let top = y;
            if (left + rect.width > vw - 8) left = vw - rect.width - 8;
            if (top + rect.height > vh - 8) top = vh - rect.height - 8;
            if (left < 8) left = 8;
            if (top < 8) top = 8;

            menu.style.left = left + 'px';
            menu.style.top = top + 'px';
        }

        function closeBeatContextMenu() {
            const menu = document.getElementById('beatContextMenu');
            if (menu) menu.classList.remove('show');
        }

        function handleContextMenuAction(action) {
            const beatIndex = contextMenuBeatIndex;
            closeBeatContextMenu();

            switch (action) {
                case 'edit':
                    openBeatEditor(beatIndex);
                    break;
                case 'copy':
                    copyBeatToClipboard(beatIndex);
                    break;
                case 'copyPartial':
                    openCopyPartialModal(beatIndex);
                    break;
                case 'paste':
                    pasteBeatTo(beatIndex);
                    break;
                case 'copyTo':
                    openCopyToModal(beatIndex);
                    break;
                case 'copyToRemaining':
                    copyBeatToRemaining(beatIndex);
                    break;
                case 'reset':
                    resetBeatFromMenu(beatIndex);
                    break;
            }
        }

        function resetBeatFromMenu(beatIndex) {
            pushUndoSnapshot();
            if (!beatSettings[beatIndex]) {
                beatSettings[beatIndex] = {};
            }
            beatSettings[beatIndex] = {
                source: 'oscillator',
                frequency: 880,
                volume: 0.8,
                waveform: 'square',
                sampleId: null,
                accentLevel: beatIndex === 1 ? 3 : 2,
                probability: 1.0
            };
            saveBeatSettings();
            saveStateOnly();
            renderGrid();
        }

        // ============================================================
        //  PRESET SYSTEM
        // ============================================================

        function getPresetKey(slot) {
            return 'preset_' + slot;
        }

        function loadPresetsFromStorage() {
            for (let i = 1; i <= MAX_PRESETS; i++) {
                const key = getPresetKey(i);
                const data = localStorage.getItem(key);
                if (data) {
                    try {
                        presets[i] = JSON.parse(data);
                    } catch (e) {}
                }
            }
        }

        function savePresetToStorage(slot) {
            if (!presets[slot]) return;
            const key = getPresetKey(slot);
            localStorage.setItem(key, JSON.stringify(presets[slot]));
        }

        function deletePresetFromStorage(slot) {
            // Check for song references
            const referencingSongs = [];
            for (const id of Object.keys(songs)) {
                if (songs[id].steps.some(s => s.presetSlot === slot)) {
                    referencingSongs.push(id);
                }
            }

            if (referencingSongs.length > 0) {
                const names = referencingSongs.map(id => '"' + songs[id].name + '"').join(', ');
                if (!confirm('This preset is used in song ' + names +
                             '. Delete anyway? The step will be skipped during playback.')) {
                    return;
                }
            }

            const key = getPresetKey(slot);
            localStorage.removeItem(key);
            delete presets[slot];
            if (currentPresetSlot === slot) {
                currentPresetSlot = 0;
                saveCurrentPresetSlot();
            }
            updateUI();
        }

        function saveCurrentStateToPreset(slot) {
            const presetData = {
                bpm: displayedBPM,
                topNumber: topNumber,
                bottomNumber: bottomNumber,
                isPercentageMode: isPercentageMode,
                bpmMin: bpmMin,
                bpmMax: bpmMax,
                percentMin: percentMin,
                percentMax: percentMax,
                ninValue: ninValue,
                autoMode: autoMode,
                tempoRangeMin: tempoRangeMin,
                tempoRangeMax: tempoRangeMax,
                accentEnabled: accentEnabled,
                beatSettings: beatSettings,
                name: presets[slot]?.name || 'Preset ' + slot,
                savedAt: Date.now()
            };
            presets[slot] = presetData;
            savePresetToStorage(slot);
            currentPresetSlot = slot;
            saveCurrentPresetSlot();
            updateUI();
        }

        function loadPreset(slot) {
            if (!presets[slot]) return;

            if (autoSaveOnPresetSwitch && currentPresetSlot > 0 && presets[currentPresetSlot]) {
                const currentData = {
                    bpm: displayedBPM,
                    topNumber: topNumber,
                    bottomNumber: bottomNumber,
                    isPercentageMode: isPercentageMode,
                    bpmMin: bpmMin,
                    bpmMax: bpmMax,
                    percentMin: percentMin,
                    percentMax: percentMax,
                    ninValue: ninValue,
                    autoMode: autoMode,
                    tempoRangeMin: tempoRangeMin,
                    tempoRangeMax: tempoRangeMax,
                    accentEnabled: accentEnabled,
                    volume: currentVolume,
                    beatSettings: beatSettings,
                    name: presets[currentPresetSlot]?.name || 'Preset ' + currentPresetSlot,
                    savedAt: Date.now()
                };
                presets[currentPresetSlot] = currentData;
                savePresetToStorage(currentPresetSlot);
            }

            const data = presets[slot];
            displayedBPM = clampTempo(roundToTempoDecimals(data.bpm));
            topNumber = data.topNumber;
            bottomNumber = data.bottomNumber;
            isPercentageMode = data.isPercentageMode;
            bpmMin = data.bpmMin;
            bpmMax = data.bpmMax;
            percentMin = data.percentMin;
            percentMax = data.percentMax;
            ninValue = data.ninValue;
            autoMode = data.autoMode;
            tempoRangeMin = data.tempoRangeMin;
            tempoRangeMax = data.tempoRangeMax;
            accentEnabled = data.accentEnabled || false;

            if (data.beatSettings) {
                beatSettings = JSON.parse(JSON.stringify(data.beatSettings));
                saveBeatSettings();
            }
            
            clearUndoHistory();

            currentPresetSlot = slot;
            saveCurrentPresetSlot();

            topSelect.value = topNumber;
            setBottomSelectValue(bottomNumber);
            updateTempoDisplay();
            updateActualTempo();
            updateRandomDisplay();
            updateRangeDisplay();
            ribToggle.style.color = isPercentageMode ? '#f5c842' : '#4a9eff';
            ninInput.value = ninValue.toString();
            volumeSlider.value = Math.round(currentVolume * 100);

            if (accentEnabled) {
                btnAcc.classList.add('active');
            } else {
                btnAcc.classList.remove('active');
            }

            stopRadio.classList.remove('active');
            plusBPMRadio.classList.remove('active');
            minusBPMRadio.classList.remove('active');
            if (autoMode === 'stop') stopRadio.classList.add('active');
            else if (autoMode === 'plus') plusBPMRadio.classList.add('active');
            else if (autoMode === 'minus') minusBPMRadio.classList.add('active');

            const clamped = clampTempo(displayedBPM);
            if (clamped !== displayedBPM) {
                setDisplayedTempo(clamped, true);
            }

            updateBeatGrid(0);

            if (loadPresetReturnsToBeatGrid) {
                setGridMode('beatgrid');
            }

            saveStateOnly();
            updateUI();
        }

        function duplicatePreset(fromSlot, toSlot) {
            if (!presets[fromSlot]) return;
            if (toSlot < 1 || toSlot > MAX_PRESETS) return;
            if (toSlot === fromSlot) return;

            const data = JSON.parse(JSON.stringify(presets[fromSlot]));
            data.name = data.name + ' (copy)';
            presets[toSlot] = data;
            savePresetToStorage(toSlot);
            updateUI();
        }

        function renamePreset(slot, newName) {
            if (!presets[slot]) return;
            presets[slot].name = newName.trim() || 'Preset ' + slot;
            savePresetToStorage(slot);
            updateUI();
        }

        function getPresetDisplayName(slot) {
            if (!presets[slot]) return '';
            return presets[slot].name || 'Preset ' + slot;
        }

        function getPresetInfo(slot) {
            if (!presets[slot]) return '';
            const p = presets[slot];
            return p.bpm.toFixed(tempoDecimals) + ' BPM • ' + p.topNumber + '/' + p.bottomNumber;
        }

        // ============================================================
        //  GRID MODE
        // ============================================================

        function setGridMode(mode) {
            gridMode = mode;
            const btn = document.getElementById('presetManagerBtn');
            const grid = document.getElementById('beatGrid');
            if (btn) {
                if (mode === 'beatgrid') {
                    btn.textContent = 'Beat Grid';
                    btn.classList.remove('active-mode');
                } else {
                    btn.textContent = 'Presets';
                    btn.classList.add('active-mode');
                }
            }
            if (grid) {
                grid.classList.toggle('presets-mode', mode === 'presets');
            }
            saveGridMode();
            renderGrid();
        }

        function toggleGridMode() {
            if (gridMode === 'beatgrid') {
                setGridMode('presets');
            } else {
                setGridMode('beatgrid');
            }
        }

        // ============================================================
        //  RENDER GRID (UPDATED)
        // ============================================================

        function renderGrid() {
            const grid = document.getElementById('beatGrid');
            if (!grid) return;

            const fragment = document.createDocumentFragment();

            for (let i = 1; i <= MAX_PRESETS; i++) {
                const cell = document.createElement('div');
                cell.className = 'beat-cell';
                cell.dataset.index = i;

                const hasPreset = !!presets[i];

                if (gridMode === 'beatgrid') {
                    const isInactive = i > topNumber;

                    // Accent level styling
                    const settings = getBeatSettings(i);
                    const accentLevel = settings.accentLevel ?? 2;
                    cell.classList.add('accent-level-' + accentLevel);

                    if (isInactive) {
                        // Inactive cells: no number, no probability indicator.
                        // The ✕ for muted beats is added via CSS pseudo-element
                        // on .accent-level-0, so it still shows.
                        cell.classList.add('dimmed');
                        cell.textContent = '';
                    } else {
                        cell.textContent = i;

                        // Probability indicator (active beats only)
                        const prob = settings.probability ?? 1.0;
                        if (prob < 1.0) {
                            const probInd = document.createElement('span');
                            probInd.className = 'prob-indicator';
                            probInd.textContent = Math.round(prob * 100) + '%';
                            if (prob > 0.7) probInd.classList.add('high');
                            cell.appendChild(probInd);
                        }
                    }

                    cell.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (cell.dataset.suppressClick) {
                            delete cell.dataset.suppressClick;
                            return;
                        }
                        if (i > topNumber) return;
                        if (songModeEnabled) return;   // locked during song mode

                        if (clipboardBeat) {
                            pasteBeatTo(i);
                        } else {
                            openBeatEditor(i);
                        }
                    });

                    cell.addEventListener('contextmenu', (e) => {
                        if (songModeEnabled) return;
                        e.preventDefault();
                        e.stopPropagation();
                        openBeatContextMenu(i, e.clientX, e.clientY);
                    });

                    // Long-press for touch
                    let beatLongPressTimer = null;
                    let beatLongPressStart = null;
                    cell.addEventListener('touchstart', (e) => {
                        const touch = e.touches[0];
                        beatLongPressStart = { x: touch.clientX, y: touch.clientY };
                        beatLongPressTimer = setTimeout(() => {
                            openBeatContextMenu(i, touch.clientX, touch.clientY);
                            // Prevent the subsequent click from firing
                            cell.dataset.suppressClick = '1';
                        }, 500);
                    });
                    cell.addEventListener('touchend', () => {
                        clearTimeout(beatLongPressTimer);
                        // Clear suppress flag on next tick
                        setTimeout(() => delete cell.dataset.suppressClick, 50);
                    });
                    cell.addEventListener('touchmove', (e) => {
                        if (!beatLongPressStart) return;
                        const touch = e.touches[0];
                        const dx = Math.abs(touch.clientX - beatLongPressStart.x);
                        const dy = Math.abs(touch.clientY - beatLongPressStart.y);
                        if (dx > 10 || dy > 10) {
                            clearTimeout(beatLongPressTimer);
                        }
                    });
                } else {
                    if (hasPreset) {
                        cell.classList.add('preset-saved');
                        cell.textContent = i;
                        const dot = document.createElement('span');
                        dot.className = 'preset-dot';
                        dot.textContent = '●';
                        cell.appendChild(dot);

                        if (currentPresetSlot === i) {
                            cell.classList.add('preset-active');
                        }
                    } else {
                        cell.classList.add('preset-empty');
                        cell.textContent = i;
                    }

                    cell.addEventListener('click', () => {
                        if (presets[i]) {
                            loadPreset(i);
                        } else {
                            saveCurrentStateToPreset(i);
                        }
                    });
                }

                cell.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    if (gridMode === 'presets' && presets[i]) {
                        openPresetModal();
                    }
                });

                let longPressTimer = null;
                cell.addEventListener('touchstart', (e) => {
                    longPressTimer = setTimeout(() => {
                        if (gridMode === 'presets' && presets[i]) {
                            openPresetModal();
                        }
                    }, 600);
                });
                cell.addEventListener('touchend', () => {
                    clearTimeout(longPressTimer);
                });
                cell.addEventListener('touchmove', () => {
                    clearTimeout(longPressTimer);
                });

                fragment.appendChild(cell);
            }

            grid.innerHTML = '';
            grid.appendChild(fragment);
        }

        // ============================================================
        //  UPDATE BEAT GRID
        // ============================================================

        function updateBeatGrid(beatIndex) {
            const cells = document.querySelectorAll('.beat-cell');
            const totalBeats = topNumber || 4;

            if (gridMode === 'beatgrid') {
                cells.forEach((cell, i) => {
                    const cellNum = i + 1;
                    const isInactive = cellNum > totalBeats;

                    // Strip transient classes first
                    cell.classList.remove('highlight', 'active', 'preset-active', 'preset-saved', 'preset-empty');
                    for (let k = 0; k <= 3; k++) cell.classList.remove('accent-level-' + k);

                    // Reapply accent level styling
                    const settings = getBeatSettings(cellNum);
                    const accentLevel = settings.accentLevel ?? 2;
                    cell.classList.add('accent-level-' + accentLevel);

                    // Wipe any old content
                    cell.innerHTML = '';

                    if (isInactive) {
                        // No number, no probability, no highlight
                        cell.classList.add('dimmed');
                    } else {
                        cell.textContent = cellNum;

                        // Probability indicator
                        const prob = settings.probability ?? 1.0;
                        if (prob < 1.0) {
                            const probInd = document.createElement('span');
                            probInd.className = 'prob-indicator';
                            probInd.textContent = Math.round(prob * 100) + '%';
                            if (prob > 0.7) probInd.classList.add('high');
                            cell.appendChild(probInd);
                        }

                        cell.classList.remove('dimmed');
                        if (cellNum === (beatIndex % totalBeats) + 1) {
                            cell.classList.add('highlight');
                        }
                    }
                });
            } else {
                renderGrid();
            }
        }

        // ============================================================
        //  PRESET MODAL
        // ============================================================

        function openPresetModal() {
            isPresetModalOpen = true;
            renderPresetModal();
            const modal = document.getElementById('presetModal');
            if (modal) modal.classList.add('show');
        }

        function closePresetModal() {
            isPresetModalOpen = false;
            const modal = document.getElementById('presetModal');
            if (modal) modal.classList.remove('show');
        }

        function renderPresetModal() {
            const grid = document.getElementById('presetModalGrid');
            if (!grid) return;

            const fragment = document.createDocumentFragment();

            for (let i = 1; i <= MAX_PRESETS; i++) {
                const item = document.createElement('div');
                item.className = 'preset-modal-item';

                const hasPreset = !!presets[i];

                if (hasPreset) {
                    item.classList.add('saved');
                    if (currentPresetSlot === i) {
                        item.classList.add('active-preset');
                    }

                    const num = document.createElement('div');
                    num.className = 'slot-number';
                    num.textContent = i;

                    const name = document.createElement('div');
                    name.className = 'slot-name';
                    name.textContent = getPresetDisplayName(i);

                    const info = document.createElement('div');
                    info.className = 'slot-info';
                    info.textContent = getPresetInfo(i);

                    item.appendChild(num);
                    item.appendChild(name);
                    item.appendChild(info);

                    const actions = document.createElement('div');
                    actions.style.cssText = 'display:flex; gap:0.2rem; margin-top:0.2rem; flex-wrap:wrap; justify-content:center;';

                    const loadBtn = document.createElement('button');
                    loadBtn.className = 'preset-modal-btn';
                    loadBtn.textContent = 'Load';
                    loadBtn.style.fontSize = '0.5rem';
                    if (songModeEnabled) {
                        loadBtn.disabled = true;
                        loadBtn.style.opacity = '0.3';
                        loadBtn.style.cursor = 'default';
                        loadBtn.title = 'Preset loading is disabled during Song mode';
                    } else {
                        loadBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            loadPreset(i);
                            closePresetModal();
                        });
                    }

                    const renameBtn = document.createElement('button');
                    renameBtn.className = 'preset-modal-btn';
                    renameBtn.textContent = 'Rename';
                    renameBtn.style.fontSize = '0.5rem';
                    renameBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const newName = prompt('Enter new name for preset ' + i + ':', getPresetDisplayName(i));
                        if (newName !== null && newName.trim() !== '') {
                            renamePreset(i, newName);
                        }
                    });

                    const duplicateBtn = document.createElement('button');
                    duplicateBtn.className = 'preset-modal-btn';
                    duplicateBtn.textContent = 'Duplicate';
                    duplicateBtn.style.fontSize = '0.5rem';
                    duplicateBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const targetSlot = prompt('Duplicate to preset slot (1-' + MAX_PRESETS + '):', i + 1);
                        if (targetSlot) {
                            const slot = parseInt(targetSlot);
                            if (slot >= 1 && slot <= MAX_PRESETS && slot !== i) {
                                duplicatePreset(i, slot);
                            } else {
                                alert('Invalid slot number.');
                            }
                        }
                    });

                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'preset-modal-btn danger';
                    deleteBtn.textContent = 'Delete';
                    deleteBtn.style.fontSize = '0.5rem';
                    deleteBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        if (confirm('Delete preset ' + i + '?')) {
                            deletePresetFromStorage(i);
                        }
                    });

                    actions.appendChild(loadBtn);
                    actions.appendChild(renameBtn);
                    actions.appendChild(duplicateBtn);
                    actions.appendChild(deleteBtn);
                    item.appendChild(actions);

                    item.addEventListener('click', () => {
                        if (songModeEnabled) return;
                        loadPreset(i);
                        closePresetModal();
                    });

                } else {
                    item.classList.add('preset-empty');

                    const num = document.createElement('div');
                    num.className = 'slot-number';
                    num.textContent = i;

                    const empty = document.createElement('div');
                    empty.className = 'slot-empty';
                    empty.textContent = 'Empty';

                    const saveBtn = document.createElement('button');
                    saveBtn.className = 'preset-modal-btn accent';
                    saveBtn.textContent = 'Save to Slot';
                    saveBtn.style.fontSize = '0.5rem';
                    saveBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        saveCurrentStateToPreset(i);
                    });

                    item.appendChild(num);
                    item.appendChild(empty);
                    item.appendChild(saveBtn);
                }

                fragment.appendChild(item);
            }

            grid.innerHTML = '';
            grid.appendChild(fragment);

            const checkbox1 = document.getElementById('loadPresetReturnsToBeatGrid');
            if (checkbox1) checkbox1.checked = loadPresetReturnsToBeatGrid;

            const checkbox2 = document.getElementById('autoSaveOnPresetSwitch');
            if (checkbox2) checkbox2.checked = autoSaveOnPresetSwitch;
        }

        // ============================================================
        //  UPDATE UI
        // ============================================================

        function updateUI() {
            renderGrid();
            if (isPresetModalOpen) {
                renderPresetModal();
            }
        }

        // ============================================================
        //  SAVE SYSTEMS
        // ============================================================

        function saveStateOnly() {
            if (songModeEnabled && preSongSnapshot) {
                const state = {
                    bpm: preSongSnapshot.bpm,
                    topNumber: preSongSnapshot.topNumber,
                    bottomNumber: preSongSnapshot.bottomNumber,
                    isPercentageMode: preSongSnapshot.isPercentageMode,
                    volume: preSongSnapshot.volume,
                    bpmMin: bpmMin,
                    bpmMax: bpmMax,
                    percentMin: percentMin,
                    percentMax: percentMax,
                    ninValue: ninValue,
                    autoMode: autoMode,
                    tempoRangeMin: tempoRangeMin,
                    tempoRangeMax: tempoRangeMax,
                    accentEnabled: accentEnabled
                };
                localStorage.setItem('webtronomState', JSON.stringify(state));
                // Don't touch currentPresetSlot — leave it at the pre-song value so
                // a reload mid-song doesn't restore into the wrong preset slot.
                // Don't write beatSettings — leave the pre-song grid intact.
                return;
            }
        
            const state = {
                bpm: displayedBPM,
                topNumber: topNumber,
                bottomNumber: bottomNumber,
                isPercentageMode: isPercentageMode,
                bpmMin: bpmMin,
                bpmMax: bpmMax,
                percentMin: percentMin,
                percentMax: percentMax,
                ninValue: ninValue,
                autoMode: autoMode,
                tempoRangeMin: tempoRangeMin,
                tempoRangeMax: tempoRangeMax,
                accentEnabled: accentEnabled,
                volume: currentVolume
            };
            localStorage.setItem('webtronomState', JSON.stringify(state));
            saveCurrentPresetSlot();
            saveBeatSettings();
        }
        
        // ============================================================
        //  UNDO / REDO SYSTEM
        // ============================================================

        function snapshotBeatSettings() {
            // Deep clone so subsequent mutations don't affect the snapshot
            return JSON.parse(JSON.stringify(beatSettings));
        }

        function pushUndoSnapshot() {
            if (isApplyingUndo) return;
            undoStack.push(snapshotBeatSettings());
            if (undoStack.length > MAX_UNDO) undoStack.shift();
            redoStack = [];
            saveUndoState();
            updateUndoButtons();
        }
        
        function pushUndoSnapshotFromState(priorState) {
            if (isApplyingUndo) return;
            undoStack.push(JSON.parse(JSON.stringify(priorState)));
            if (undoStack.length > MAX_UNDO) undoStack.shift();
            redoStack = [];
            saveUndoState();
            updateUndoButtons();
        }

        function undo() {
            if (undoStack.length === 0) return;
            isApplyingUndo = true;

            // Current state goes to redo
            redoStack.push(snapshotBeatSettings());

            // Restore the previous state
            beatSettings = undoStack.pop();
            normalizeBeatSettings();
            saveBeatSettings();
            saveStateOnly();

            isApplyingUndo = false;

            saveUndoState();
            updateUndoButtons();
            renderGrid();
            if (isPresetModalOpen) renderPresetModal();
        }

        function redo() {
            if (redoStack.length === 0) return;
            isApplyingUndo = true;

            undoStack.push(snapshotBeatSettings());
            if (undoStack.length > MAX_UNDO) undoStack.shift();

            beatSettings = redoStack.pop();
            normalizeBeatSettings();
            saveBeatSettings();
            saveStateOnly();

            isApplyingUndo = false;

            saveUndoState();
            updateUndoButtons();
            renderGrid();
            if (isPresetModalOpen) renderPresetModal();
        }

        function clearUndoHistory() {
            undoStack = [];
            redoStack = [];
            saveUndoState();
            updateUndoButtons();
        }

        function saveUndoState() {
            try {
                localStorage.setItem('webtronomUndoStack', JSON.stringify({
                    undo: undoStack,
                    // redo intentionally not persisted — cleared on reload
                }));
            } catch (e) {
                console.warn('Could not persist undo stack:', e);
            }
        }

        function loadUndoState() {
            try {
                const raw = localStorage.getItem('webtronomUndoStack');
                if (!raw) return;
                const parsed = JSON.parse(raw);
                if (parsed && Array.isArray(parsed.undo)) {
                    undoStack = parsed.undo;
                    if (undoStack.length > MAX_UNDO) {
                        undoStack = undoStack.slice(-MAX_UNDO);
                    }
                }
            } catch (e) {
                console.warn('Could not load undo stack:', e);
                undoStack = [];
            }
            redoStack = [];  // redo never survives reload
        }

        function normalizeBeatSettings() {
            // Ensure every beat 1..32 exists and has all required fields
            for (let i = 1; i <= 32; i++) {
                if (!beatSettings[i]) {
                    beatSettings[i] = {
                        source: 'oscillator',
                        frequency: 800,
                        volume: 0.8,
                        waveform: 'square',
                        sampleId: null,
                        accentLevel: i === 1 ? 3 : 2,
                        probability: 1.0
                    };
                } else {
                    if (beatSettings[i].accentLevel === undefined) {
                        beatSettings[i].accentLevel = i === 1 ? 3 : 2;
                    }
                    if (beatSettings[i].probability === undefined) {
                        beatSettings[i].probability = 1.0;
                    }
                    if (!beatSettings[i].source) beatSettings[i].source = 'oscillator';
                    if (beatSettings[i].sampleId === undefined) beatSettings[i].sampleId = null;
                }
            }
        }

        function updateUndoButtons() {
            const undoBtn = document.getElementById('undoBtn');
            const redoBtn = document.getElementById('redoBtn');
            if (undoBtn) {
                undoBtn.disabled = undoStack.length === 0;
                undoBtn.style.opacity = undoStack.length === 0 ? '0.3' : '1';
                undoBtn.style.cursor = undoStack.length === 0 ? 'default' : 'pointer';
            }
            if (redoBtn) {
                redoBtn.disabled = redoStack.length === 0;
                redoBtn.style.opacity = redoStack.length === 0 ? '0.3' : '1';
                redoBtn.style.cursor = redoStack.length === 0 ? 'default' : 'pointer';
            }
        }

        function saveStateWithPreset() {
            saveStateOnly();
        
            // During song mode, do NOT write back to the preset. The displayedBPM is
            // the effective tempo (base × multiplier), not the preset's base. Writing
            // it back would corrupt the preset and cause the multiplier to be applied
            // twice on subsequent passes.
            if (songModeEnabled) return;
        
            if (currentPresetSlot > 0 && presets[currentPresetSlot]) {
                const presetData = {
                    bpm: displayedBPM,
                    topNumber: topNumber,
                    bottomNumber: bottomNumber,
                    isPercentageMode: isPercentageMode,
                    bpmMin: bpmMin,
                    bpmMax: bpmMax,
                    percentMin: percentMin,
                    percentMax: percentMax,
                    ninValue: ninValue,
                    autoMode: autoMode,
                    tempoRangeMin: tempoRangeMin,
                    tempoRangeMax: tempoRangeMax,
                    accentEnabled: accentEnabled,
                    beatSettings: beatSettings,
                    name: presets[currentPresetSlot]?.name || 'Preset ' + currentPresetSlot,
                    savedAt: Date.now()
                };
                presets[currentPresetSlot] = presetData;
                savePresetToStorage(currentPresetSlot);
            }
        }

        function saveState() {
            saveStateWithPreset();
        }

        // ============================================================
        //  GLOBAL SETTINGS
        // ============================================================

        function loadGlobalSettings() {
            const saved = localStorage.getItem('webtronomGlobalSettings');
            if (saved) {
                try {
                    const settings = JSON.parse(saved);
                    if (settings.loadPresetReturnsToBeatGrid !== undefined) {
                        loadPresetReturnsToBeatGrid = settings.loadPresetReturnsToBeatGrid;
                    }
                    if (settings.autoSaveOnPresetSwitch !== undefined) {
                        autoSaveOnPresetSwitch = settings.autoSaveOnPresetSwitch;
                    }
                } catch (e) {}
            }
        }

        function saveGlobalSettings() {
            const settings = {
                loadPresetReturnsToBeatGrid: loadPresetReturnsToBeatGrid,
                autoSaveOnPresetSwitch: autoSaveOnPresetSwitch
            };
            localStorage.setItem('webtronomGlobalSettings', JSON.stringify(settings));
        }

        // ============================================================
        //  LOAD STATE
        // ============================================================

        function loadState() {
            const saved = localStorage.getItem('webtronomState');
            if (!saved) return false;

            try {
                const state = JSON.parse(saved);
                if (state.bpm !== undefined) displayedBPM = state.bpm;
                if (state.topNumber !== undefined) topNumber = state.topNumber;
                if (state.bottomNumber !== undefined) {
                    const bn = parseInt(state.bottomNumber, 10);
                    if (Number.isFinite(bn) && bn >= 1) bottomNumber = bn;
                }
                if (state.isPercentageMode !== undefined) isPercentageMode = state.isPercentageMode;
                if (state.bpmMin !== undefined) bpmMin = state.bpmMin;
                if (state.bpmMax !== undefined) bpmMax = state.bpmMax;
                if (state.percentMin !== undefined) percentMin = state.percentMin;
                if (state.percentMax !== undefined) percentMax = state.percentMax;
                if (state.ninValue !== undefined) ninValue = state.ninValue;
                if (state.autoMode !== undefined) autoMode = state.autoMode;
                if (state.tempoRangeMin !== undefined) tempoRangeMin = state.tempoRangeMin;
                if (state.tempoRangeMax !== undefined) tempoRangeMax = state.tempoRangeMax;
                if (state.accentEnabled !== undefined) accentEnabled = state.accentEnabled;
                if (state.volume !== undefined) currentVolume = state.volume;
                return true;
            } catch (e) {
                console.warn('Failed to load saved state:', e);
                return false;
            }
        }

        // ============================================================
        //  DOM REFS
        // ============================================================

        const tempoWhole = document.getElementById('tempoWhole');
        const tempoDecimal = document.getElementById('tempoDecimal');
        const tempoWrapper = document.getElementById('tempoWrapper');
        const modalTempoDisplay = document.getElementById('modalTempoDisplay');
        const tempoModal = document.getElementById('tempoModal');
        const startBtn = document.getElementById('startBtn');
        const barsDisplay = document.getElementById('barsDisplay');
        const beatDisplay = document.getElementById('beatDisplay');
        const volumeSlider = document.getElementById('volumeSlider');
        const topSelect = document.getElementById('topNumber');
        const bottomSelect = document.getElementById('bottomNumber');

        const btnMinus1 = document.getElementById('btnMinus1');
        const btnPlus1 = document.getElementById('btnPlus1');
        const btnMinus01 = document.getElementById('btnMinus01');
        const btnPlus01 = document.getElementById('btnPlus01');
        const btnAcc = document.getElementById('btnAcc');

        const randomPlusBtn = document.getElementById('randomPlusBtn');
        const randomMinusBtn = document.getElementById('randomMinusBtn');
        const randomMinInput = document.getElementById('randomMinInput');
        const randomMaxInput = document.getElementById('randomMaxInput');
        const ribToggle = document.getElementById('ribToggle');

        const rangeBtn = document.getElementById('rangeBtn');
        const mixerBtn = document.getElementById('mixerBtn');
        const stopRadio = document.getElementById('stopRadio');
        const plusBPMRadio = document.getElementById('plusBPMRadio');
        const minusBPMRadio = document.getElementById('minusBPMRadio');
        const ninInput = document.getElementById('ninInput');
        const rangeDisplay = document.getElementById('rangeDisplay');

        const rangeModal = document.getElementById('rangeModal');
        const rangeMinSlider = document.getElementById('rangeMinSlider');
        const rangeMaxSlider = document.getElementById('rangeMaxSlider');
        const rangeMinDisplay = document.getElementById('rangeMinDisplay');
        const rangeMaxDisplay = document.getElementById('rangeMaxDisplay');
        const rangeMinInput = document.getElementById('rangeMinInput');
        const rangeMaxInput = document.getElementById('rangeMaxInput');
        const rangeCurrentTempo = document.getElementById('rangeCurrentTempo');
        const rangeDefaultBtn = document.getElementById('rangeDefaultBtn');
        const rangeCancelBtn = document.getElementById('rangeCancelBtn');
        const rangeOkBtn = document.getElementById('rangeOkBtn');

        const presetManagerBtn = document.getElementById('presetManagerBtn');
        const settingsBtn = document.getElementById('settingsBtn');
        const presetModal = document.getElementById('presetModal');
        const presetModalClose = document.getElementById('presetModalClose');
        const loadPresetReturnsToggle = document.getElementById('loadPresetReturnsToBeatGrid');
        const autoSaveOnPresetSwitchToggle = document.getElementById('autoSaveOnPresetSwitch');

        // Beat Editor DOM refs
        const beatEditorModal = document.getElementById('beatEditorModal');
        const beatEditorFreqSlider = document.getElementById('beatEditorFreqSlider');
        const beatEditorFreqDisplay = document.getElementById('beatEditorFreqDisplay');
        const beatEditorVolSlider = document.getElementById('beatEditorVolSlider');
        const beatEditorVolDisplay = document.getElementById('beatEditorVolDisplay');
        const beatEditorWaveform = document.getElementById('beatEditorWaveform');
        const beatEditorSourceOscillator = document.getElementById('beatEditorSourceOscillator');
        const beatEditorSourceSample = document.getElementById('beatEditorSourceSample');
        const beatEditorSampleSelect = document.getElementById('beatEditorSampleSelect');
        const beatEditorProbSlider = document.getElementById('beatEditorProbSlider');
        const beatEditorProbDisplay = document.getElementById('beatEditorProbDisplay');
        const beatEditorResetBtn = document.getElementById('beatEditorResetBtn');
        const beatEditorCancelBtn = document.getElementById('beatEditorCancelBtn');
        const beatEditorOkBtn = document.getElementById('beatEditorOkBtn');

        // Sample Manager DOM refs
        const sampleManagerModal = document.getElementById('sampleManagerModal');
        const sampleManagerClose = document.getElementById('sampleManagerClose');
        const sampleFileInput = document.getElementById('sampleFileInput');

        // ============================================================
        //  RANGE FUNCTIONS
        // ============================================================

        function getTempoMin() { return tempoRangeMin; }

        function getTempoMax() { return tempoRangeMax; }

        function saveTempoRange(min, max) {
            tempoRangeMin = min;
            tempoRangeMax = max;
            updateRangeDisplay();
            saveState();
        }

        function resetTempoRange() {
            saveTempoRange(20, 500);
            updateRangeDisplay();
        }

        function updateRangeDisplay() {
            const min = getTempoMin();
            const max = getTempoMax();
            if (min === 20 && max === 500) {
                rangeDisplay.classList.remove('visible');
                rangeDisplay.textContent = '';
            } else {
                rangeDisplay.textContent = min + ' - ' + max;
                rangeDisplay.classList.add('visible');
            }
        }

        function clampTempo(value) {
            const min = getTempoMin();
            const max = getTempoMax();
            return Math.min(max, Math.max(min, parseFloat(value.toFixed(2))));
        }
        
        // ============================================================
        //  12-TET NOTE MAPPING (A4 = 440 Hz)
        // ============================================================

        const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

        function semitonesToFrequency(n) {
            return 440 * Math.pow(2, n / 12);
        }

        function frequencyToSemitones(f) {
            return Math.round(12 * Math.log2(f / 440));
        }

        function semitonesToNoteName(n) {
            const midi = n + 69;
            const noteIndex = ((midi % 12) + 12) % 12;
            const octave = Math.floor(midi / 12) - 1;
            return NOTE_NAMES[noteIndex] + octave;
        }

        // Format a frequency for display: "A5 · 880 Hz"
        function formatFrequencyAsNote(f) {
            const n = frequencyToSemitones(f);
            const noteName = semitonesToNoteName(n);
            // Round the frequency for display
            const freqStr = f >= 1000 ? Math.round(f) : (Math.round(f * 10) / 10);
            return noteName + ' · ' + freqStr + ' Hz';
        }

        // ============================================================
        //  RANGE POPUP SYNC FUNCTIONS
        // ============================================================

        function syncRangeFromSliders() {
            let minVal = parseInt(rangeMinSlider.value);
            let maxVal = parseInt(rangeMaxSlider.value);

            if (minVal > maxVal) {
                minVal = maxVal;
                rangeMinSlider.value = minVal;
            }

            rangeMinDisplay.textContent = minVal;
            rangeMaxDisplay.textContent = maxVal;
            rangeMinInput.value = minVal;
            rangeMaxInput.value = maxVal;
        }

        function syncRangeFromInputs() {
            let minVal = parseInt(rangeMinInput.value);
            let maxVal = parseInt(rangeMaxInput.value);

            if (isNaN(minVal)) minVal = 20;
            if (isNaN(maxVal)) maxVal = 500;
            minVal = Math.min(500, Math.max(20, minVal));
            maxVal = Math.min(500, Math.max(20, maxVal));

            if (minVal > maxVal) {
                if (rangeMinInput === document.activeElement) {
                    maxVal = minVal;
                } else {
                    minVal = maxVal;
                }
            }

            rangeMinInput.value = minVal;
            rangeMaxInput.value = maxVal;
            rangeMinSlider.value = minVal;
            rangeMaxSlider.value = maxVal;

            rangeMinDisplay.textContent = minVal;
            rangeMaxDisplay.textContent = maxVal;
        }

        function openRangePopup() {
            const currentMin = getTempoMin();
            const currentMax = getTempoMax();

            rangeMinSlider.value = currentMin;
            rangeMaxSlider.value = currentMax;
            rangeMinInput.value = currentMin;
            rangeMaxInput.value = currentMax;
            rangeMinDisplay.textContent = currentMin;
            rangeMaxDisplay.textContent = currentMax;
            rangeCurrentTempo.textContent = displayedBPM.toFixed(tempoDecimals);

            rangeModal.classList.add('show');
        }

        function closeRangePopup() {
            rangeModal.classList.remove('show');
        }

        // ============================================================
        //  NUMPAD SYSTEM
        // ============================================================

        function openNumpad(target, initialValue) {
            numpadTarget = target;
            numpadIsNewInput = true;

            if (target === 'nin' || target === 'rangeMin' || target === 'rangeMax'
                || target === 'copyFrom' || target === 'copyTo' || target === 'copyEvery' || target === 'songBars' || target === 'songDenom') {
                numpadInputString = Math.round(initialValue).toString();
            } else {
                numpadInputString = initialValue.toFixed(tempoDecimals);
            }

            modalTempoDisplay.textContent = numpadInputString;
            // Disable the dot button when editing BPM in integer mode
            const dotBtn = document.querySelector('.numpad-btn[data-value="."]');
            if (dotBtn) {
                const disableDot = (numpadTarget === 'bpm' && tempoDecimals === 0);
                dotBtn.disabled = disableDot;
                dotBtn.style.opacity = disableDot ? '0.3' : '1';
                dotBtn.style.pointerEvents = disableDot ? 'none' : 'auto';
            }
            tempoModal.classList.add('show');
        }

        function closeNumpad() {
            tempoModal.classList.remove('show');
        }

        function confirmNumpad() {
            const value = parseFloat(numpadInputString);
            if (isNaN(value)) {
                closeNumpad();
                return;
            }

            switch (numpadTarget) {
                case 'bpm':
                    if (value >= 20 && value <= 500) {
                        setDisplayedTempo(value, true);
                    }
                    break;
                case 'rmx':
                    setCurrentMax(value);
                    break;
                case 'rmn':
                    setCurrentMin(value);
                    break;
                case 'nin':
                    const clampedNin = clampNinValue(value);
                    ninValue = clampedNin;
                    ninInput.value = clampedNin.toString();
                    barsSinceAction = 0;
                    pendingAction = false;
                    hasTriggeredOnce = false;
                    saveState();
                    break;
                case 'rangeMin':
                    const minVal = Math.min(500, Math.max(20, Math.round(value)));
                    const currentMax = parseInt(rangeMaxInput.value) || 500;
                    if (minVal <= currentMax) {
                        rangeMinInput.value = minVal;
                        rangeMinSlider.value = minVal;
                        rangeMinDisplay.textContent = minVal;
                        tempoRangeMin = minVal;
                        saveState();
                    } else {
                        rangeMinInput.value = currentMax;
                        rangeMinSlider.value = currentMax;
                        rangeMinDisplay.textContent = currentMax;
                        tempoRangeMin = currentMax;
                        saveState();
                    }
                    break;
                case 'rangeMax':
                    const maxVal = Math.min(500, Math.max(20, Math.round(value)));
                    const currentMin = parseInt(rangeMinInput.value) || 20;
                    if (maxVal >= currentMin) {
                        rangeMaxInput.value = maxVal;
                        rangeMaxSlider.value = maxVal;
                        rangeMaxDisplay.textContent = maxVal;
                        tempoRangeMax = maxVal;
                        saveState();
                    } else {
                        rangeMaxInput.value = currentMin;
                        rangeMaxSlider.value = currentMin;
                        rangeMaxDisplay.textContent = currentMin;
                        tempoRangeMax = currentMin;
                        saveState();
                    }
                    break;
                case 'songBars': {
                    const val = Math.max(1, Math.min(999, Math.round(value)));
                    if (pendingSongBarsStep) {
                        pendingSongBarsStep.barCount = val;
                        saveSongs();
                        if (selectedSongId && songs[selectedSongId]) {
                            renderSongSteps(songs[selectedSongId]);
                        }
                        pendingSongBarsStep = null;
                    }
                    break;
                }
                case 'songDenom': {
                    const val = Math.max(1, Math.min(128, Math.round(value)));
                    // Derive the global multiplier from the desired effective
                    // denominator for the current step
                    if (activeSongId && songs[activeSongId]) {
                        const song = songs[activeSongId];
                        const step = song.steps[currentStepIndex];
                        if (step && presets[step.presetSlot]) {
                            const presetBottom = presets[step.presetSlot].bottomNumber || 4;
                            if (presetBottom > 0) {
                                songDenominatorMultiplier = val / presetBottom;
                            }
                        }
                    }
                    bottomNumber = val;
                    updateActualTempo();
                    updateBeatGrid(0);
                    updateTimeSignatureDisplay();
                    saveState();
                    break;
                }
                case 'copyFrom':
                case 'copyTo':
                case 'copyEvery': {
                    const val = Math.max(1, Math.min(32, Math.round(value)));
                    const inputId = numpadTarget === 'copyFrom' ? 'copyToFrom'
                                  : numpadTarget === 'copyTo'   ? 'copyToTo'
                                  : 'copyToEvery';
                    const input = document.getElementById(inputId);
                    if (input) input.value = val.toString();
                    // Apply constraints
                    if (numpadTarget === 'copyTo') {
                        // Clamp From if needed
                        const fromEl = document.getElementById('copyToFrom');
                        if (parseInt(fromEl.value) > val) fromEl.value = val.toString();
                    }
                    if (numpadTarget === 'copyFrom') {
                        const toEl = document.getElementById('copyToTo');
                        if (parseInt(toEl.value) < val) toEl.value = val.toString();
                    }
                    break;
                }
            }
            closeNumpad();
        }

        document.querySelectorAll('.numpad-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const value = btn.dataset.value;

                if (value === 'clear') {
                    numpadInputString = numpadInputString.slice(0, -1);
                    if (numpadInputString === '' || numpadInputString === '-') {
                        numpadInputString = '0';
                        numpadIsNewInput = true;
                    }
                } else if (value === 'clearall') {
                    numpadInputString = '0';
                    numpadIsNewInput = true;
                } else if (value === 'enter') {
                    confirmNumpad();
                    return;
                } else {
                    if (numpadIsNewInput) {
                        numpadInputString = '';
                        numpadIsNewInput = false;
                    }

                    const isRangeTarget = (numpadTarget === 'rangeMin' || numpadTarget === 'rangeMax');
                    const isNinTarget = (numpadTarget === 'nin'
                        || numpadTarget === 'copyFrom'
                        || numpadTarget === 'copyTo'
                        || numpadTarget === 'copyEvery'
                        || numpadTarget === 'songBars'
                        || numpadTarget === 'songDenom');

                    if (isRangeTarget || isNinTarget) {
                        if (value === '.') return;
                        if (numpadInputString.length >= 5) return;
                    } else {
                        if (value === '.') {
                            if (tempoDecimals === 0) return;  // no decimals in integer mode
                            if (numpadInputString.includes('.')) return;
                        }
                        const parts = numpadInputString.split('.');
                        if (parts.length === 2 && parts[1].length >= tempoDecimals) return;
                        if (numpadInputString.replace('.', '').length >= 7) return;
                    }

                    numpadInputString += value;
                }

                if (numpadTarget === 'bpm') {
                    const tempNum = parseFloat(numpadInputString);
                    if (!isNaN(tempNum) && tempNum > 500) {
                        numpadInputString = '500';
                    }
                } else if (numpadTarget === 'nin' || numpadTarget === 'rangeMin' || numpadTarget === 'rangeMax') {
                    const tempNum = parseInt(numpadInputString);
                    if (!isNaN(tempNum) && tempNum > 500) {
                        numpadInputString = '500';
                    }
                }

                modalTempoDisplay.textContent = numpadInputString || '0';
            });
        });

        rangeMinInput.addEventListener('click', () => {
            const currentVal = parseInt(rangeMinInput.value) || 20;
            openNumpad('rangeMin', currentVal);
        });

        rangeMaxInput.addEventListener('click', () => {
            const currentVal = parseInt(rangeMaxInput.value) || 500;
            openNumpad('rangeMax', currentVal);
        });

        // ============================================================
        //  CLAMPING FUNCTIONS
        // ============================================================

        function clampRandomValue(value) {
            return Math.min(50, Math.max(0.01, parseFloat(value.toFixed(2))));
        }

        function clampNinValue(value) {
            return Math.max(1, Math.round(value));
        }

        function getRandomArbitrary(min, max) {
            return Math.random() * (max - min) + min;
        }

        function getCurrentMin() {
            return isPercentageMode ? percentMin : bpmMin;
        }

        function getCurrentMax() {
            return isPercentageMode ? percentMax : bpmMax;
        }

        function setCurrentMin(value) {
            const clamped = clampRandomValue(value);
            if (isPercentageMode) {
                if (clamped <= percentMax) {
                    percentMin = clamped;
                    updateRandomDisplay();
                    saveState();
                    return true;
                }
            } else {
                if (clamped <= bpmMax) {
                    bpmMin = clamped;
                    updateRandomDisplay();
                    saveState();
                    return true;
                }
            }
            return false;
        }

        function setCurrentMax(value) {
            const clamped = clampRandomValue(value);
            if (isPercentageMode) {
                if (clamped >= percentMin) {
                    percentMax = clamped;
                    updateRandomDisplay();
                    saveState();
                    return true;
                }
            } else {
                if (clamped >= bpmMin) {
                    bpmMax = clamped;
                    updateRandomDisplay();
                    saveState();
                    return true;
                }
            }
            return false;
        }

        function updateRandomDisplay() {
            const min = getCurrentMin();
            const max = getCurrentMax();
            const formattedMin = min.toFixed(2);
            const formattedMax = max.toFixed(2);
            if (isPercentageMode) {
                randomMinInput.value = formattedMin + '%';
                randomMaxInput.value = formattedMax + '%';
            } else {
                randomMinInput.value = formattedMin;
                randomMaxInput.value = formattedMax;
            }
        }

        function toggleMode() {
            isPercentageMode = !isPercentageMode;
            updateRandomDisplay();
            ribToggle.style.color = isPercentageMode ? '#f5c842' : '#4a9eff';
            saveState();
        }

        function applyRandomTempo(direction) {
            const min = getCurrentMin();
            const max = getCurrentMax();
            if (min === max) {
                if (isPercentageMode) {
                    const percent = min / 100;
                    const change = displayedBPM * percent;
                    const newTempo = direction === 1 ? displayedBPM + change : displayedBPM - change;
                    setDisplayedTempo(clampTempo(newTempo), false);
                } else {
                    const change = min;
                    const newTempo = direction === 1 ? displayedBPM + change : displayedBPM - change;
                    setDisplayedTempo(clampTempo(newTempo), false);
                }
            } else {
                const randomValue = getRandomArbitrary(min, max);
                if (isPercentageMode) {
                    const percent = randomValue / 100;
                    const change = displayedBPM * percent;
                    const newTempo = direction === 1 ? displayedBPM + change : displayedBPM - change;
                    setDisplayedTempo(clampTempo(newTempo), false);
                } else {
                    const change = randomValue;
                    const newTempo = direction === 1 ? displayedBPM + change : displayedBPM - change;
                    setDisplayedTempo(clampTempo(newTempo), false);
                }
            }
        }

        // ============================================================
        //  AUTOMATIC CONTROL SYSTEM
        // ============================================================

        function checkAutoAction() {
            if (autoMode === 'off') return;
            if (pendingAction) return;
            if (ninValue < 1) return;

            let triggerCount;
            if (autoMode === 'stop') {
                triggerCount = ninValue + 1;
            } else {
                if (!hasTriggeredOnce) {
                    triggerCount = ninValue + 1;
                } else {
                    triggerCount = ninValue;
                }
            }

            if (barsSinceAction >= triggerCount) {
                pendingAction = true;
                hasTriggeredOnce = true;

                if (resetBarCounterAfterAction) {
                    barsSinceAction = 0;
                }

                switch (autoMode) {
                    case 'stop':
                        stopMetronome();
                        hasTriggeredOnce = false;
                        break;
                    case 'plus':
                        applyRandomTempo(1);
                        break;
                    case 'minus':
                        applyRandomTempo(-1);
                        break;
                }

                setTimeout(() => {
                    pendingAction = false;
                }, 50);
            }
        }

        function setAutoMode(mode) {
            stopRadio.classList.remove('active');
            plusBPMRadio.classList.remove('active');
            minusBPMRadio.classList.remove('active');

            if (mode === 'off') {
                autoMode = 'off';
                barsSinceAction = 0;
                pendingAction = false;
                hasTriggeredOnce = false;
                saveState();
                return;
            }

            switch (mode) {
                case 'stop':
                    stopRadio.classList.add('active');
                    break;
                case 'plus':
                    plusBPMRadio.classList.add('active');
                    break;
                case 'minus':
                    minusBPMRadio.classList.add('active');
                    break;
            }

            autoMode = mode;
            barsSinceAction = 0;
            pendingAction = false;
            hasTriggeredOnce = false;
            saveState();
        }

        function toggleAutoMode(mode) {
            if (autoMode === mode) {
                setAutoMode('off');
            } else {
                setAutoMode(mode);
            }
        }

        // ============================================================
        //  AUDIO ENGINE (UPDATED FOR ACCENT LEVELS + PROBABILITY)
        // ============================================================

        function initializeAudioEngine() {
            if (isInitialized) return;

            masterGainNode = audioCtx.createGain();
            masterGainNode.gain.value = 1;
            masterGainNode.connect(audioCtx.destination);

            masterOscillator = audioCtx.createOscillator();
            masterOscillator.type = 'square';
            masterOscillator.frequency.value = 800;

            oscillatorGainNode = audioCtx.createGain();
            oscillatorGainNode.gain.value = 0;

            masterOscillator.connect(oscillatorGainNode);
            oscillatorGainNode.connect(masterGainNode);

            sampleGainNode = audioCtx.createGain();
            sampleGainNode.gain.value = 1;
            sampleGainNode.connect(masterGainNode);

            masterOscillator.start();

            isInitialized = true;
            console.log('🎵 Audio engine initialized (separate gain paths)');
        }

        function getClickDuration(bpm) {
            const beatInterval = 60.0 / bpm;
            const duration = beatInterval * 0.3;
            return Math.min(0.08, Math.max(0.01, duration));
        }

        function playSampleAtTime(time, sampleId, volume) {
            const sample = sampleLibrary.find(s => s.id === sampleId);
            if (!sample) {
                console.warn('Sample not found:', sampleId);
                return false;
            }

            try {
                const source = audioCtx.createBufferSource();
                source.buffer = sample.buffer;
                const gain = audioCtx.createGain();
                const actualVolume = volume * currentVolume * 0.5;
                gain.gain.value = Math.min(1, Math.max(0, actualVolume));

                source.connect(gain);
                gain.connect(sampleGainNode);
                source.start(time);
                return true;
            } catch (e) {
                console.warn('Failed to play sample:', e);
                return false;
            }
        }
        
        function playBeatOnce(beatIndex) {
            if (!isInitialized) initializeAudioEngine();

            const settings = getBeatSettings(beatIndex);
            const accentLevel = settings.accentLevel ?? 2;

            if (accentLevel === 0) return;  // muted

            // Ignore probability for audition — always play
            const accentMultiplier = getAccentMultiplier(accentLevel);
            const time = audioCtx.currentTime + 0.02;
            const duration = getClickDuration(actualBPM);

            if (settings.source === 'sample' && settings.sampleId) {
                // Un-mute the sample gain path for this one-shot audition.
                // If the metronome is running, sampleGainNode is already at 1,
                // so this is a no-op. If it's stopped, we need to bump it.
                if (sampleGainNode && !isPlaying) {
                    sampleGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
                    sampleGainNode.gain.setValueAtTime(1, audioCtx.currentTime);
                }
                const volume = (settings.volume || 0.8) * accentMultiplier;
                playSampleAtTime(time, settings.sampleId, volume);
            } else {
                const freq = settings.frequency || 800;
                const waveform = settings.waveform || 'square';
                masterOscillator.frequency.setValueAtTime(freq, time);
                masterOscillator.type = waveform;

                const volume = (settings.volume || 0.8) * accentMultiplier;
                const actualVolume = volume * currentVolume * 0.5;

                oscillatorGainNode.gain.cancelScheduledValues(time);
                oscillatorGainNode.gain.setValueAtTime(actualVolume, time);
                oscillatorGainNode.gain.exponentialRampToValueAtTime(0.000001, time + duration);
            }
        }

        function scheduleClick(time, isDownbeat, extraGain = 1.0) {
            if (!isInitialized) return;

            const currentBeat = (stepBeatCount % topNumber) + 1;
            const settings = getBeatSettings(currentBeat);
            const duration = getClickDuration(actualBPM);

            // STEP 1: Check if muted (accentLevel === 0)
            const accentLevel = settings.accentLevel ?? 2;
            if (accentLevel === 0) {
                return;
            }

            // STEP 2: Check probability
            const probability = settings.probability ?? 1.0;
            if (probability < 1.0) {
                const random = Math.random();
                if (random > probability) {
                    return;
                }
            }

            // STEP 3: Play the beat
            const accentMultiplier = getAccentMultiplier(accentLevel);
            const totalMultiplier = accentMultiplier * extraGain;

            if (settings.source === 'sample' && settings.sampleId) {
                const volume = (settings.volume || 0.8) * totalMultiplier;
                playSampleAtTime(time, settings.sampleId, volume);
            } else {
                const freq = settings.frequency || 800;
                const waveform = settings.waveform || 'square';
                masterOscillator.frequency.setValueAtTime(freq, time);
                masterOscillator.type = waveform;

                const volume = (settings.volume || 0.8) * totalMultiplier;
                const actualVolume = volume * currentVolume * 0.5;

                oscillatorGainNode.gain.cancelScheduledValues(time);
                oscillatorGainNode.gain.setValueAtTime(actualVolume, time);
                oscillatorGainNode.gain.exponentialRampToValueAtTime(0.000001, time + duration);
            }
        }

        function scheduler() {
            if (!isPlaying) return;

            while (nextNoteTime < audioCtx.currentTime + scheduleAhead) {
                // ---- Apply a pending transition, if any ----
                // The swap happens here, before scheduling the new step's first
                // beat. nextNoteTime was already set correctly when we detected
                // the transition on the previous beat.
                if (pendingSongTransition) {
                    pendingSongTransition = false;

                    currentStepIndex = (currentStepIndex + 1) % songs[activeSongId].steps.length;
                    barsInStep = 0;
                    stepBeatCount = 0;
                    applySongStep(currentStepIndex);
                    // applySongStep updates displayedBPM, actualBPM, topNumber,
                    // bottomNumber, beatSettings, and the display. From here on,
                    // the bottom-of-loop advance uses the new tempo.
                }

                const currentBeat = (stepBeatCount % topNumber) + 1;
                const isDownbeat = (currentBeat === 1);
                const isLastBeatOfBar = (currentBeat === topNumber);

                // Song start accent: applied to beat 1 of bar 1 of step 1,
                // every time the song begins (initial start or loop-back).
                let extraGain = 1.0;
                if (songModeEnabled && activeSongId && songs[activeSongId] &&
                    currentStepIndex === 0 && stepBeatCount === 0) {
                    extraGain = songStartAccent;
                }

                // Schedule the current beat at nextNoteTime
                scheduleClick(nextNoteTime, isDownbeat, extraGain);

                if (isDownbeat) {
                    barsSinceAction++;
                    measureCount++;
                    barsDisplay.textContent = measureCount;
                    checkAutoAction();
                    if (songModeEnabled) updateSongStrip();
                }

                beatDisplay.textContent = currentBeat;
                updateBeatGrid(currentBeat - 1);

                if (isLastBeatOfBar) {
                    barsInStep++;
                }

                stepBeatCount++;
                beatCount++;

                // ---- Advance by the CURRENT interval ----
                // This is the beat duration for the section we just played.
                // Whether the *next* section has a different tempo does not
                // affect how long this beat lasts.
                const currentInterval = 60.0 / actualBPM;
                nextNoteTime += currentInterval;

                // ---- Detect whether the NEXT beat starts a new step ----
                // If this was the last beat of the step's last bar, the beat
                // we just scheduled is the final beat of the current section.
                // We mark a pending transition so the NEXT iteration swaps
                // state before scheduling the next beat. Note: no change to
                // nextNoteTime here — the interval we just added is correct.
                if (isLastBeatOfBar && songModeEnabled && activeSongId && songs[activeSongId]) {
                    const song = songs[activeSongId];
                    const step = song.steps[currentStepIndex];
                    if (step && barsInStep >= step.barCount) {
                        pendingSongTransition = true;
                    }
                }
            }

            timerID = setTimeout(scheduler, lookahead);
        }

        function startMetronome() {
            if (isPlaying) return;
            if (audioCtx.state === 'suspended') {
                audioCtx.resume();
            }
            if (!isInitialized) {
                initializeAudioEngine();
            }
            if (oscillatorGainNode) {
                oscillatorGainNode.gain.cancelScheduledValues(audioCtx.currentTime);
                oscillatorGainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            }
            if (sampleGainNode) {
                sampleGainNode.gain.setValueAtTime(1, audioCtx.currentTime);
            }

            // Song-mode position resets are handled by stopMetronome and
            // enterSongMode, not here. That way a re-entry of the current song
            // can preserve the practice multipliers while still starting from
            // step 1.

            isPlaying = true;
            beatCount = 0;
            stepBeatCount = 0;
            measureCount = 0;
            barsSinceAction = 0;
            pendingAction = false;
            hasTriggeredOnce = false;
            barsDisplay.textContent = '0';
            beatDisplay.textContent = '1';
            nextNoteTime = audioCtx.currentTime + 0.05;
            updateBeatGrid(0);
            scheduler();
            startBtn.textContent = 'Stop';
            startBtn.classList.add('active');
        }

        function stopMetronome() {
            isPlaying = false;
            clearTimeout(timerID);
            if (oscillatorGainNode) {
                const now = audioCtx.currentTime;
                oscillatorGainNode.gain.cancelScheduledValues(now);
                oscillatorGainNode.gain.setValueAtTime(0, now);
            }
            if (sampleGainNode) {
                sampleGainNode.gain.setValueAtTime(0, audioCtx.currentTime);
            }
            startBtn.textContent = 'Start';
            startBtn.classList.remove('active');
            const cells = document.querySelectorAll('.beat-cell');
            cells.forEach(c => c.classList.remove('highlight', 'active'));
        
            // If song mode is on, reset the song position to the beginning.
            // Next Start will play from step 1.
            if (songModeEnabled && activeSongId && songs[activeSongId]) {
                currentStepIndex = 0;
                barsInStep = 0;
                stepBeatCount = 0;
                pendingSongTransition = false;
                applySongStep(0);
                updateSongStrip();
            }
        }

        function setDisplayedTempo(newBPM, restart = true) {
            displayedBPM = clampTempo(roundToTempoDecimals(newBPM));

            // During song mode, derive the global multiplier from this change.
            // Every tempo-changing path (numpad, +/- buttons, random, auto modes)
            // funnels through setDisplayedTempo, so this single hook covers all
            // of them.
            if (songModeEnabled) {
                deriveSongMultiplierFromEffectiveBPM();
                updateSongStrip();
                // Never reset the bar/beat counters during song mode — the song's
                // own step structure controls the layout, not a tempo change.
                restart = false;
            }

            updateTempoDisplay();
            updateActualTempo();
            saveState();

            if (isPlaying && restart) {
                clearTimeout(timerID);
                nextNoteTime = audioCtx.currentTime + 60.0 / actualBPM;
                beatCount = 0;
                measureCount = 0;
                barsSinceAction = 0;
                pendingAction = false;
                hasTriggeredOnce = false;
                barsDisplay.textContent = '0';
                beatDisplay.textContent = '1';
                updateBeatGrid(0);
                scheduler();
            }
        }

        function updateActualTempo() {
            const bottom = (Number.isFinite(bottomNumber) && bottomNumber > 0) ? bottomNumber : 4;
            speedMultiplier = bottom / 4;
            actualBPM = displayedBPM * speedMultiplier;
            actualBPM = Math.min(2000, Math.max(20, actualBPM));
        }

        function updateTempoDisplay() {
            const formatted = displayedBPM.toFixed(tempoDecimals);
            if (tempoDecimals === 0) {
                tempoWhole.textContent = formatted;
                tempoDecimal.textContent = '';
            } else {
                const parts = formatted.split('.');
                tempoWhole.textContent = parts[0];
                tempoDecimal.textContent = '.' + parts[1];
            }
        }

        function updateTimeSignature() {
            topNumber = parseInt(topSelect.value);
            const newBottom = parseInt(bottomSelect.value);

            if (songModeEnabled && activeSongId && songs[activeSongId]) {
                // In song mode, the bottom value the user just picked is the
                // effective denominator for the current step. Derive the
                // global denominator multiplier from it.
                const song = songs[activeSongId];
                const step = song.steps[currentStepIndex];
                if (step && presets[step.presetSlot]) {
                    const presetBottom = presets[step.presetSlot].bottomNumber || 4;
                    if (presetBottom > 0) {
                        songDenominatorMultiplier = newBottom / presetBottom;
                    }
                }
            }

            bottomNumber = newBottom;
            updateActualTempo();
            updateBeatGrid(0);
            beatDisplay.textContent = '1';
            saveState();

            if (isPlaying && !songModeEnabled) {
                stopMetronome();
                startMetronome();
            }
        }

        // ============================================================
        //  POPULATE UI
        // ============================================================

        for (let i = 1; i <= 32; i++) {
            const option = document.createElement('option');
            option.value = i;
            option.textContent = i;
            if (i === 4) option.selected = true;
            topSelect.appendChild(option);
        }

        // ============================================================
        //  EVENT LISTENERS
        // ============================================================

        function setupRadioButtons() {
            stopRadio.addEventListener('click', () => { toggleAutoMode('stop'); });
            plusBPMRadio.addEventListener('click', () => { toggleAutoMode('plus'); });
            minusBPMRadio.addEventListener('click', () => { toggleAutoMode('minus'); });
        }

        // Beat Editor Source Toggle
        beatEditorSourceOscillator.addEventListener('click', () => {
            beatEditorSourceOscillator.classList.add('active');
            beatEditorSourceSample.classList.remove('active');
            const oscSection = document.getElementById('beatEditorOscillatorSection');
            const sampSection = document.getElementById('beatEditorSampleSection');
            if (oscSection) oscSection.style.display = 'block';
            if (sampSection) sampSection.style.display = 'none';
            beatEditorTempSettings.source = 'oscillator'; commitBeatEditorTempToLive();
        });

        beatEditorSourceSample.addEventListener('click', () => {
            beatEditorSourceSample.classList.add('active');
            beatEditorSourceOscillator.classList.remove('active');
            const oscSection = document.getElementById('beatEditorOscillatorSection');
            const sampSection = document.getElementById('beatEditorSampleSection');
            if (oscSection) oscSection.style.display = 'none';
            if (sampSection) sampSection.style.display = 'block';
            updateSampleDropdowns();
            beatEditorTempSettings.source = 'sample'; commitBeatEditorTempToLive();
        });

        beatEditorFreqSlider.addEventListener('input', () => {
            const semitones = parseInt(beatEditorFreqSlider.value);
            const freq = semitonesToFrequency(semitones);
            beatEditorFreqDisplay.textContent = formatFrequencyAsNote(freq);
            beatEditorTempSettings.frequency = freq;
            commitBeatEditorTempToLive();
        });

        beatEditorVolSlider.addEventListener('input', () => {
            const val = parseInt(beatEditorVolSlider.value);
            beatEditorVolDisplay.textContent = val + '%';
            beatEditorTempSettings.volume = val / 100;
            commitBeatEditorTempToLive();
        });

        beatEditorProbSlider.addEventListener('input', () => {
            const val = parseInt(beatEditorProbSlider.value);
            beatEditorProbDisplay.textContent = val + '%';
            beatEditorTempSettings.probability = val / 100;
            commitBeatEditorTempToLive();
        });
        
        beatEditorWaveform.addEventListener('change', () => {
            beatEditorTempSettings.waveform = beatEditorWaveform.value;
            commitBeatEditorTempToLive();
        });
        
        beatEditorSampleSelect.addEventListener('change', () => {
            beatEditorTempSettings.sampleId = beatEditorSampleSelect.value || null;
            commitBeatEditorTempToLive();
        });

        // Accent level buttons
        document.querySelectorAll('.beat-editor-accent-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const level = parseInt(btn.dataset.level);
                document.querySelectorAll('.beat-editor-accent-btn').forEach(b => {
                    b.classList.remove('active-level-0', 'active-level-1', 'active-level-2', 'active-level-3');
                });
                btn.classList.add('active-level-' + level);
                beatEditorTempSettings.accentLevel = level;
                commitBeatEditorTempToLive();
            });
        });

        beatEditorCancelBtn.addEventListener('click', cancelBeatEditor);
        beatEditorOkBtn.addEventListener('click', applyBeatEditorChanges);
        beatEditorResetBtn.addEventListener('click', resetBeatEditor);
        const beatEditorTestBtn = document.getElementById('beatEditorTestBtn');
        if (beatEditorTestBtn) {
            beatEditorTestBtn.addEventListener('click', () => {
                // Commit temp settings to live so the audition uses them
                commitBeatEditorTempToLive();
                playBeatOnce(beatEditorIndex);

                // Brief visual confirmation
                beatEditorTestBtn.classList.add('playing');
                setTimeout(() => beatEditorTestBtn.classList.remove('playing'), 250);
            });
        }

        // Sample Manager
        mixerBtn.addEventListener('click', () => {
            renderSampleManager();
            sampleManagerModal.classList.add('show');
        });

        sampleManagerClose.addEventListener('click', () => {
            sampleManagerModal.classList.remove('show');
        });

        sampleManagerModal.addEventListener('click', (e) => {
            if (e.target === sampleManagerModal) {
                sampleManagerModal.classList.remove('show');
            }
        });

        sampleFileInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const sample = await loadSampleFromFile(file);
            if (sample) {
                renderSampleManager();
                updateSampleDropdowns();
            }
            sampleFileInput.value = '';
        });

        beatEditorModal.addEventListener('click', (e) => {
            if (e.target === beatEditorModal) {
                cancelBeatEditor();
            }
        });

        tempoWrapper.addEventListener('click', () => {
            openNumpad('bpm', displayedBPM);
        });

        randomMaxInput.addEventListener('click', () => {
            const currentMax = getCurrentMax();
            openNumpad('rmx', currentMax);
        });

        randomMinInput.addEventListener('click', () => {
            const currentMin = getCurrentMin();
            openNumpad('rmn', currentMin);
        });

        ninInput.addEventListener('click', () => {
            openNumpad('nin', ninValue);
        });

        tempoModal.addEventListener('click', (e) => {
            if (e.target === tempoModal) {
                closeNumpad();
            }
        });
        
        const tempoDecimalSegmented = document.getElementById('tempoDecimalSegmented');
        if (tempoDecimalSegmented) {
            tempoDecimalSegmented.querySelectorAll('.seg-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const d = parseInt(btn.dataset.decimals, 10);
                    setTempoDecimals(d);
                });
            });
        }
        
        const bottomDisplaySong = document.getElementById('bottomDisplaySong');
        if (bottomDisplaySong) {
            // Prevent the button from stealing focus, so that pressing Enter
            // in the numpad doesn't re-fire a click on this button and reopen
            // the numpad.
            bottomDisplaySong.addEventListener('mousedown', (e) => {
                e.preventDefault();
            });
            bottomDisplaySong.addEventListener('click', () => {
                if (!songModeEnabled) return;
                openNumpad('songDenom', bottomNumber);
            });
        }
        
        // Export / Import
        const settingsExportConfig = document.getElementById('settingsExportConfig');
        const settingsExportFull = document.getElementById('settingsExportFull');
        const settingsImport = document.getElementById('settingsImport');
        const importFileInput = document.getElementById('importFileInput');
        const importModal = document.getElementById('importModal');
        const importSummary = document.getElementById('importSummary');
        const importCancel = document.getElementById('importCancel');
        const importConfirm = document.getElementById('importConfirm');
        const importExportFirst = document.getElementById('importExportFirst');

        if (settingsExportConfig) {
            settingsExportConfig.addEventListener('click', exportConfig);
        }
        if (settingsExportFull) {
            settingsExportFull.addEventListener('click', exportFull);
        }
        if (settingsImport) {
            settingsImport.addEventListener('click', () => {
                if (importFileInput) importFileInput.click();
            });
        }
        if (importFileInput) {
            importFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (!file) return;
                handleImportFile(file);
                // Reset so picking the same file twice works
                importFileInput.value = '';
            });
        }
        if (importCancel) {
            importCancel.addEventListener('click', closeImportModal);
        }
        if (importConfirm) {
            importConfirm.addEventListener('click', confirmImport);
        }
        if (importExportFirst) {
            importExportFirst.addEventListener('click', async () => {
                // Download the current full state as a safety net.
                // Doesn't close the modal — the user can still confirm
                // or cancel afterward.
                await exportFull();
            });
        }
        if (importModal) {
            importModal.addEventListener('click', (e) => {
                if (e.target === importModal) closeImportModal();
            });
        }
        
        const copyPartialModal = document.getElementById('copyPartialModal');
        const copyPartialConfirm = document.getElementById('copyPartialConfirm');
        const copyPartialCancel = document.getElementById('copyPartialCancel');
        const copyPartialSelectAll = document.getElementById('copyPartialSelectAll');
        const copyPartialSelectNone = document.getElementById('copyPartialSelectNone');

        if (copyPartialConfirm) {
            copyPartialConfirm.addEventListener('click', confirmCopyPartial);
        }
        if (copyPartialCancel) {
            copyPartialCancel.addEventListener('click', closeCopyPartialModal);
        }
        if (copyPartialSelectAll) {
            copyPartialSelectAll.addEventListener('click', () => {
                document.getElementById('copyFieldSound').checked = true;
                document.getElementById('copyFieldVolume').checked = true;
                document.getElementById('copyFieldAccent').checked = true;
                document.getElementById('copyFieldProbability').checked = true;
                updateCopyPartialConfirmState();
            });
        }
        if (copyPartialSelectNone) {
            copyPartialSelectNone.addEventListener('click', () => {
                document.getElementById('copyFieldSound').checked = false;
                document.getElementById('copyFieldVolume').checked = false;
                document.getElementById('copyFieldAccent').checked = false;
                document.getElementById('copyFieldProbability').checked = false;
                updateCopyPartialConfirmState();
            });
        }
        ['copyFieldSound', 'copyFieldVolume', 'copyFieldAccent', 'copyFieldProbability'].forEach(id => {
            const cb = document.getElementById(id);
            if (cb) cb.addEventListener('change', updateCopyPartialConfirmState);
        });
        if (copyPartialModal) {
            copyPartialModal.addEventListener('click', (e) => {
                if (e.target === copyPartialModal) closeCopyPartialModal();
            });
        }

        document.addEventListener('keydown', (e) => {
            if (!tempoModal.classList.contains('show')) return;
            const key = e.key;
            if (key >= '0' && key <= '9') {
                document.querySelector(`.numpad-btn[data-value="${key}"]`)?.click();
            } else if (key === '.') {
                document.querySelector('.numpad-btn[data-value="."]')?.click();
            } else if (key === 'Backspace') {
                document.querySelector('.numpad-btn[data-value="clear"]')?.click();
            } else if (key === 'Escape') {
                closeNumpad();
            } else if (key === 'Enter') {
                confirmNumpad();
            }
        });
        
        // Songs modal
        const songsModal = document.getElementById('songsModal');
        const songsCloseBtn = document.getElementById('songsCloseBtn');
        const songsNewBtn = document.getElementById('songsNewBtn');
        const songNameInput = document.getElementById('songNameInput');
        const songsAddStepBtn = document.getElementById('songsAddStepBtn');
        const songDeleteBtn = document.getElementById('songDeleteBtn');
        const songPlayBtn = document.getElementById('songPlayBtn');
        const songModeBtn = document.getElementById('songModeBtn');
        const songStripExit = document.getElementById('songStripExit');

        if (songsCloseBtn) songsCloseBtn.addEventListener('click', closeSongsModal);
        if (songsNewBtn) songsNewBtn.addEventListener('click', createNewSong);
        if (songsAddStepBtn) songsAddStepBtn.addEventListener('click', addSongStep);

        if (songsModal) {
            songsModal.addEventListener('click', (e) => {
                if (e.target === songsModal) closeSongsModal();
            });
        }

        if (songNameInput) {
            songNameInput.addEventListener('input', () => {
                if (selectedSongId && songs[selectedSongId]) {
                    songs[selectedSongId].name = songNameInput.value || 'Untitled';
                    saveSongs();
                    // Also update the list without a full re-render, to keep focus
                    const items = document.querySelectorAll('.songs-list-item');
                    items.forEach(item => {
                        const nameEl = item.querySelector('.songs-list-item-name');
                        if (nameEl && item.classList.contains('selected') && nameEl) {
                            nameEl.textContent = songs[selectedSongId].name;
                        }
                    });
                }
            });
        }

        if (songDeleteBtn) {
            songDeleteBtn.addEventListener('click', () => {
                if (selectedSongId) deleteSong(selectedSongId);
            });
        }

        if (songPlayBtn) {
            songPlayBtn.addEventListener('click', () => {
                if (selectedSongId && songs[selectedSongId]) {
                    enterSongMode(selectedSongId);
                } else {
                    alert('Select a song first.');
                }
            });
        }

        if (songModeBtn) {
            songModeBtn.addEventListener('click', () => {
                openSongsModal();
            });
        }

        if (songStripExit) {
            songStripExit.addEventListener('click', exitSongMode);
        }
        
        // Settings modal
        const settingsModal = document.getElementById('settingsModal');
        const settingsClose = document.getElementById('settingsClose');
        const settingsResetGrid = document.getElementById('settingsResetGrid');
        const settingsPopulateGrid = document.getElementById('settingsPopulateGrid');

        if (settingsClose) settingsClose.addEventListener('click', closeSettingsModal);
        if (settingsResetGrid) settingsResetGrid.addEventListener('click', resetAllBeatsToDefault);
        if (settingsPopulateGrid) settingsPopulateGrid.addEventListener('click', openPopulateModal);

        if (settingsModal) {
            settingsModal.addEventListener('click', (e) => {
                if (e.target === settingsModal) closeSettingsModal();
            });
        }

        // Populate modal
        const populateModal = document.getElementById('populateModal');
        const populateSourceOscillator = document.getElementById('populateSourceOscillator');
        const populateSourceSample = document.getElementById('populateSourceSample');
        const populateFreqSlider = document.getElementById('populateFreqSlider');
        const populateFreqDisplay = document.getElementById('populateFreqDisplay');
        const populateVolSlider = document.getElementById('populateVolSlider');
        const populateVolDisplay = document.getElementById('populateVolDisplay');
        const populateProbSlider = document.getElementById('populateProbSlider');
        const populateProbDisplay = document.getElementById('populateProbDisplay');
        const populateResetBtn = document.getElementById('populateResetBtn');
        const populateCancelBtn = document.getElementById('populateCancelBtn');
        const populateApplyBtn = document.getElementById('populateApplyBtn');

        if (populateSourceOscillator) {
            populateSourceOscillator.addEventListener('click', () => {
                populateSource = 'oscillator';
                populateSourceOscillator.classList.add('active');
                populateSourceSample.classList.remove('active');
                document.getElementById('populateOscillatorSection').style.display = 'block';
                document.getElementById('populateSampleSection').style.display = 'none';
            });
        }

        if (populateSourceSample) {
            populateSourceSample.addEventListener('click', () => {
                populateSource = 'sample';
                populateSourceSample.classList.add('active');
                populateSourceOscillator.classList.remove('active');
                document.getElementById('populateOscillatorSection').style.display = 'none';
                document.getElementById('populateSampleSection').style.display = 'block';
            });
        }

        if (populateFreqSlider) {
            populateFreqSlider.addEventListener('input', () => {
                const semitones = parseInt(populateFreqSlider.value);
                const freq = semitonesToFrequency(semitones);
                populateFreqDisplay.textContent = formatFrequencyAsNote(freq);
            });
        }

        if (populateVolSlider) {
            populateVolSlider.addEventListener('input', () => {
                populateVolDisplay.textContent = parseInt(populateVolSlider.value) + '%';
            });
        }

        if (populateProbSlider) {
            populateProbSlider.addEventListener('input', () => {
                populateProbDisplay.textContent = parseInt(populateProbSlider.value) + '%';
            });
        }

        if (populateResetBtn) populateResetBtn.addEventListener('click', resetPopulateForm);
        if (populateCancelBtn) populateCancelBtn.addEventListener('click', closePopulateModal);
        if (populateApplyBtn) populateApplyBtn.addEventListener('click', applyPopulateForm);

        if (populateModal) {
            populateModal.addEventListener('click', (e) => {
                if (e.target === populateModal) closePopulateModal();
            });
        }

        rangeBtn.addEventListener('click', openRangePopup);
        rangeDisplay.addEventListener('click', openRangePopup);

        rangeMinSlider.addEventListener('input', syncRangeFromSliders);
        rangeMaxSlider.addEventListener('input', syncRangeFromSliders);

        rangeMinInput.addEventListener('change', () => {
            const val = parseInt(rangeMinInput.value);
            if (!isNaN(val) && val >= 20 && val <= 500) {
                syncRangeFromInputs();
            } else {
                rangeMinInput.value = parseInt(rangeMinSlider.value);
            }
        });

        rangeMaxInput.addEventListener('change', () => {
            const val = parseInt(rangeMaxInput.value);
            if (!isNaN(val) && val >= 20 && val <= 500) {
                syncRangeFromInputs();
            } else {
                rangeMaxInput.value = parseInt(rangeMaxSlider.value);
            }
        });

        rangeDefaultBtn.addEventListener('click', () => {
            resetTempoRange();
            closeRangePopup();
        });

        rangeCancelBtn.addEventListener('click', closeRangePopup);

        rangeOkBtn.addEventListener('click', () => {
            const minVal = parseInt(rangeMinInput.value);
            const maxVal = parseInt(rangeMaxInput.value);

            if (minVal <= maxVal && minVal >= 20 && maxVal <= 500) {
                saveTempoRange(minVal, maxVal);
                const clamped = clampTempo(displayedBPM);
                if (clamped !== displayedBPM) {
                    setDisplayedTempo(clamped, true);
                }
                closeRangePopup();
            } else {
                alert('Please ensure Min ≤ Max and both are between 20-500.');
                syncRangeFromSliders();
            }
        });

        presetManagerBtn.addEventListener('click', toggleGridMode);

        let presetLongPressTimer = null;
        presetManagerBtn.addEventListener('mousedown', () => {
            presetLongPressTimer = setTimeout(() => {
                openPresetModal();
            }, 500);
        });
        presetManagerBtn.addEventListener('mouseup', () => {
            clearTimeout(presetLongPressTimer);
        });
        presetManagerBtn.addEventListener('mouseleave', () => {
            clearTimeout(presetLongPressTimer);
        });
        presetManagerBtn.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            clearTimeout(presetLongPressTimer);
            openPresetModal();
        });

        presetModalClose.addEventListener('click', closePresetModal);
        presetModal.addEventListener('click', (e) => {
            if (e.target === presetModal) {
                closePresetModal();
            }
        });

        loadPresetReturnsToggle.addEventListener('change', () => {
            loadPresetReturnsToBeatGrid = loadPresetReturnsToggle.checked;
            saveGlobalSettings();
        });

        autoSaveOnPresetSwitchToggle.addEventListener('change', () => {
            autoSaveOnPresetSwitch = autoSaveOnPresetSwitchToggle.checked;
            saveGlobalSettings();
        });

        settingsBtn.addEventListener('click', () => {
            openSettingsModal();
        });
        const undoBtn = document.getElementById('undoBtn');
        const redoBtn = document.getElementById('redoBtn');
        undoBtn.addEventListener('click', undo);
        redoBtn.addEventListener('click', redo);
                // Clipboard clear
        const clipboardClear = document.getElementById('clipboardClear');
        if (clipboardClear) {
            clipboardClear.addEventListener('click', clearClipboard);
        }

        // Context menu actions
        const beatContextMenu = document.getElementById('beatContextMenu');
        if (beatContextMenu) {
            beatContextMenu.querySelectorAll('.context-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    handleContextMenuAction(item.dataset.action);
                });
            });
        }

        // Close context menu on any outside click/tap/scroll
        document.addEventListener('click', (e) => {
            const menu = document.getElementById('beatContextMenu');
            if (menu && menu.classList.contains('show') && !menu.contains(e.target)) {
                closeBeatContextMenu();
            }
        });
        document.addEventListener('contextmenu', (e) => {
            const menu = document.getElementById('beatContextMenu');
            if (menu && menu.classList.contains('show') && !menu.contains(e.target)) {
                // Allow the new contextmenu to open (beat cells handle their own)
                // If the target is NOT a beat cell, close the menu
                const isBeatCell = e.target.closest('.beat-cell');
                if (!isBeatCell) {
                    closeBeatContextMenu();
                }
            }
        });
        window.addEventListener('scroll', closeBeatContextMenu, true);
        window.addEventListener('resize', closeBeatContextMenu);
        
        // Copy To modal
        const copyToModal = document.getElementById('copyToModal');
        const copyToFrom = document.getElementById('copyToFrom');
        const copyToTo = document.getElementById('copyToTo');
        const copyToEvery = document.getElementById('copyToEvery');
        const copyToSelectRange = document.getElementById('copyToSelectRange');
        const copyToClear = document.getElementById('copyToClear');
        const copyToCancel = document.getElementById('copyToCancel');
        const copyToApply = document.getElementById('copyToApply');

        // Numpad-backed inputs for the range fields
        copyToFrom.addEventListener('click', () => {
            openNumpad('copyFrom', parseInt(copyToFrom.value) || 1);
        });
        copyToTo.addEventListener('click', () => {
            openNumpad('copyTo', parseInt(copyToTo.value) || topNumber);
        });
        copyToEvery.addEventListener('click', () => {
            openNumpad('copyEvery', parseInt(copyToEvery.value) || 1);
        });

        copyToSelectRange.addEventListener('click', applyCopyToRange);
        const copyToSelectRemaining = document.getElementById('copyToSelectRemaining');
        if (copyToSelectRemaining) {
            copyToSelectRemaining.addEventListener('click', selectRemainingInCopyToModal);
        }

        copyToClear.addEventListener('click', () => {
            copyToSelected.clear();
            renderCopyToGrid();
            updateCopyToSummary();
        });

        copyToCancel.addEventListener('click', closeCopyToModal);
        copyToApply.addEventListener('click', applyCopyToSelection);

        copyToModal.addEventListener('click', (e) => {
            if (e.target === copyToModal) closeCopyToModal();
        });

        startBtn.addEventListener('click', () => {
            if (isPlaying) {
                stopMetronome();
            } else {
                startMetronome();
            }
        });

        document.addEventListener('keydown', (e) => {
            // Undo / Redo
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
                // Don't hijack undo inside text inputs
                const tag = (e.target.tagName || '').toLowerCase();
                if (tag !== 'input' && tag !== 'textarea') {
                    e.preventDefault();
                    undo();
                    return;
                }
            }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
                const tag = (e.target.tagName || '').toLowerCase();
                if (tag !== 'input' && tag !== 'textarea') {
                    e.preventDefault();
                    redo();
                    return;
                }
            }
          
            if (e.code === 'Space' && !e.repeat) {
                // Don't hijack the spacebar when the user is typing in a text field
                const tag = (e.target.tagName || '').toLowerCase();
                const isEditable = (tag === 'input' || tag === 'textarea' || e.target.isContentEditable);
                if (isEditable) {
                    // Let the space through to the input
                } else if (!tempoModal.classList.contains('show') &&
                           !rangeModal.classList.contains('show') &&
                           !presetModal.classList.contains('show') &&
                           !beatEditorModal.classList.contains('show') &&
                           !sampleManagerModal.classList.contains('show') &&
                           !copyToModal.classList.contains('show') &&
                           !settingsModal.classList.contains('show') &&
                           !populateModal.classList.contains('show') &&
                           !songsModal.classList.contains('show') &&
                           !importModal.classList.contains('show') &&
                           !copyPartialModal.classList.contains('show')) {
                    e.preventDefault();
                    if (isPlaying) stopMetronome();
                    else startMetronome();
                }
            }
            if (e.key === 'Escape') {
                if (rangeModal.classList.contains('show')) {
                    closeRangePopup();
                }
                if (presetModal.classList.contains('show')) {
                    closePresetModal();
                }
                if (beatEditorModal.classList.contains('show')) {
                    cancelBeatEditor();
                }
                if (sampleManagerModal.classList.contains('show')) {
                    sampleManagerModal.classList.remove('show');
                }
                if (copyToModal.classList.contains('show')) {
                    closeCopyToModal();
                }
                if (beatContextMenu.classList.contains('show')) {
                    closeBeatContextMenu();
                }
                if (settingsModal.classList.contains('show')) {
                    closeSettingsModal();
                }
                if (populateModal.classList.contains('show')) {
                    closePopulateModal();
                }
                if (importModal.classList.contains('show')) {
                    closeImportModal();
                }
                if (copyPartialModal.classList.contains('show')) {
                    closeCopyPartialModal();
                }
            }
        });

        btnMinus1.addEventListener('click', () => {
            setDisplayedTempo(clampTempo(displayedBPM - 1), true);
        });

        btnPlus1.addEventListener('click', () => {
            setDisplayedTempo(clampTempo(displayedBPM + 1), true);
        });

        btnMinus01.addEventListener('click', () => {
            if (tempoDecimals === 0) return;
            setDisplayedTempo(clampTempo(displayedBPM - 0.1), true);
        });

        btnPlus01.addEventListener('click', () => {
            if (tempoDecimals === 0) return;
            setDisplayedTempo(clampTempo(displayedBPM + 0.1), true);
        });

        btnAcc.addEventListener('click', () => {
            btnAcc.classList.toggle('active');
            accentEnabled = btnAcc.classList.contains('active');
            saveState();
        });

        volumeSlider.addEventListener('input', () => {
            currentVolume = parseInt(volumeSlider.value) / 100;
            saveState();
        });

        topSelect.addEventListener('change', updateTimeSignature);
        bottomSelect.addEventListener('change', updateTimeSignature);

        randomPlusBtn.addEventListener('click', () => {
            applyRandomTempo(1);
        });

        randomMinusBtn.addEventListener('click', () => {
            applyRandomTempo(-1);
        });

        ribToggle.addEventListener('click', toggleMode);

        setupRadioButtons();

        // ============================================================
        //  INIT
        // ============================================================

        async function init() {
            loadGlobalSettings();
            if (loadPresetReturnsToggle) loadPresetReturnsToggle.checked = loadPresetReturnsToBeatGrid;
            if (autoSaveOnPresetSwitchToggle) autoSaveOnPresetSwitchToggle.checked = autoSaveOnPresetSwitch;

            loadPresetsFromStorage();
            loadSongs();
            loadBeatSettings();
            loadAccentMultipliers();
            loadTempoDecimals();
            loadSongStartAccent();
            const stateLoaded = loadState();
            loadUndoState();

            tempoRangeMin = getTempoMin();
            tempoRangeMax = getTempoMax();

            const savedSlot = loadCurrentPresetSlot();
            if (savedSlot > 0 && presets[savedSlot]) {
                currentPresetSlot = savedSlot;
            }

            if (topSelect) topSelect.value = topNumber;
            if (bottomSelect) setBottomSelectValue(bottomNumber);

            updateTempoDisplay();
            updateActualTempo();
            updateRandomDisplay();
            updateRangeDisplay();
            if (ribToggle) ribToggle.style.color = isPercentageMode ? '#f5c842' : '#4a9eff';
            if (ninInput) ninInput.value = ninValue.toString();

            if (accentEnabled && btnAcc) {
                btnAcc.classList.add('active');
            } else if (btnAcc) {
                btnAcc.classList.remove('active');
            }

            if (autoMode !== 'off') {
                if (stopRadio) stopRadio.classList.remove('active');
                if (plusBPMRadio) plusBPMRadio.classList.remove('active');
                if (minusBPMRadio) minusBPMRadio.classList.remove('active');
                if (autoMode === 'stop' && stopRadio) stopRadio.classList.add('active');
                else if (autoMode === 'plus' && plusBPMRadio) plusBPMRadio.classList.add('active');
                else if (autoMode === 'minus' && minusBPMRadio) minusBPMRadio.classList.add('active');
            }

            if (volumeSlider) volumeSlider.value = Math.round(currentVolume * 100);

            updateTimeSignature();
            updateTimeSignatureDisplay()

            const initialClamped = clampTempo(displayedBPM);
            if (initialClamped !== displayedBPM) {
                setDisplayedTempo(initialClamped, true);
            }

            const savedGridMode = loadGridMode();
            setGridMode(savedGridMode);
            updateUndoButtons();
            updateClipboardStrip();

            if (!samplesLoaded) {
                samplesLoaded = true;
                try {
                    await openDatabase();
                    console.log('📦 IndexedDB opened');
                    const samples = await loadAllSamplesFromDB();
                    for (const sample of samples) {
                        try {
                          let arrayBuffer;
                          if (sample.data instanceof ArrayBuffer) {
                              arrayBuffer = sample.data.slice(0);
                          } else if (sample.data && sample.data.buffer) {
                              arrayBuffer = sample.data.buffer.slice(
                                  sample.data.byteOffset,
                                  sample.data.byteOffset + sample.data.byteLength
                              );
                          } else {
                              console.warn('Sample has no valid data:', sample.name);
                              continue;
                          }
                          
                          // Keep a safe copy for storage before decoding
                          const dataCopy = arrayBuffer.slice(0);
                          
                          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
                          sample.buffer = audioBuffer;
                          sample.data = dataCopy;   // ← store the copy, not the consumed buffer
                          
                          const existing = sampleLibrary.find(s => s.id === sample.id);
                          if (!existing) {
                              sampleLibrary.push(sample);
                          } else {
                              const idx = sampleLibrary.indexOf(existing);
                              sampleLibrary[idx] = sample;
                          }
                        } catch (e) {
                            console.warn('Failed to decode sample:', sample.name, e);
                        }
                    }
                    console.log(`📦 Loaded ${sampleLibrary.length} samples from IndexedDB`);
                } catch (e) {
                    console.warn('IndexedDB not available:', e);
                }

                await loadBuiltinSamples();
            }

            renderSampleManager();
            setupAccentLevelControls();
            updateAccentLevelUI();
            setupSongStartControls();
            updateSongStartUI();
            updateTempoDecimalUI();
            updateSongStrip();
            updateSongModeUI();
            updateSampleDropdowns();

            document.addEventListener('click', () => {
                if (!isInitialized && !isPlaying) {
                    initializeAudioEngine();
                }
            }, { once: true });

            console.log('🎵 WebtronomE9 Phase 6c (Probability + Accent Levels) loaded!');
            console.log(`💡 State loaded: ${stateLoaded ? 'YES' : 'NO (using defaults)'}`);
            console.log(`💡 Presets loaded: ${Object.keys(presets).length}/${MAX_PRESETS}`);
            console.log(`💡 Grid mode: ${gridMode}`);
            console.log(`💡 Current preset slot: ${currentPresetSlot || 'None'}`);
            console.log(`💡 Samples loaded: ${sampleLibrary.length}`);
            console.log('💡 Accent levels: 0=Mute, 1=Soft, 2=Normal, 3=Accent');
            console.log('💡 Probability: Random chance per beat (0-100%)');
            console.log('💡 Click a beat in Beat Grid mode to edit!');
        }

        init();
