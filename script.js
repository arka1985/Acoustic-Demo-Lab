class AudioEngine {
    constructor() {
        this.ctx = null;
        this.masterGain = null;
        this.analyser = null;
        this.isInitialized = false;

        // Sources
        this.noiseSource = null;
        this.noiseBuffer = null;
        this.oscillator = null;

        // State
        this.currentSourceType = 'noise'; // 'noise' or 'tone'
        this.currentFrequency = 1000;
        this.latencyEnabled = false;
        this.currentPhase = 180;

        // Nodes for Weighting Demo
        this.weightingInput = null;
        this.weightingOutput = null;
        this.currentFilters = [];

        // Nodes for ANC Demo
        this.ancSourceNode = null;
        this.ancOriginalGain = null;
        this.ancInvertedGain = null;
        this.ancDelay = null; // For phase shift simulation

        // Analysers for Visualization
        this.analyserSource = null;
        this.analyserAntiNoise = null;
        this.analyserResult = null;
    }

    async init() {
        if (this.isInitialized) return;

        const AudioContext = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AudioContext();

        this.masterGain = this.ctx.createGain();
        this.masterGain.connect(this.ctx.destination);
        this.masterGain.gain.value = 0.5;

        // Main Analyser for Weighting Demo
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 2048;
        this.analyser.smoothingTimeConstant = 0.85;

        // ANC Analysers
        this.analyserSource = this.ctx.createAnalyser();
        this.analyserSource.fftSize = 2048;
        this.analyserSource.smoothingTimeConstant = 0.85;

        this.analyserAntiNoise = this.ctx.createAnalyser();
        this.analyserAntiNoise.fftSize = 2048;
        this.analyserAntiNoise.smoothingTimeConstant = 0.85;

        this.analyserResult = this.ctx.createAnalyser();
        this.analyserResult.fftSize = 2048;
        this.analyserResult.smoothingTimeConstant = 0.85;

        // Create Pink Noise Buffer
        this.noiseBuffer = this.createPinkNoiseBuffer();

        // Setup Weighting Chain
        this.weightingInput = this.ctx.createGain();
        this.weightingOutput = this.ctx.createGain();

        this.weightingInput.connect(this.weightingOutput); // Default Flat
        this.weightingOutput.connect(this.analyser);
        this.analyser.connect(this.masterGain);

        this.isInitialized = true;
    }

    createPinkNoiseBuffer() {
        const bufferSize = 2 * this.ctx.sampleRate;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = buffer.getChannelData(0);

        let b0, b1, b2, b3, b4, b5, b6;
        b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0;

        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            output[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
            output[i] *= 0.11;
            b6 = white * 0.115926;
        }
        return buffer;
    }

    stopAll() {
        this.stopWeightingDemo();
        if (this.ancSourceNode) {
            try { this.ancSourceNode.stop(); } catch (e) { }
            this.ancSourceNode = null;
        }
    }

    stopWeightingDemo() {
        if (this.noiseSource) {
            try { this.noiseSource.stop(); } catch (e) { }
            this.noiseSource = null;
        }
        if (this.oscillator) {
            try { this.oscillator.stop(); } catch (e) { }
            this.oscillator = null;
        }
    }

    startWeightingDemo() {
        this.stopAll();

        if (this.currentSourceType === 'noise') {
            this.noiseSource = this.ctx.createBufferSource();
            this.noiseSource.buffer = this.noiseBuffer;
            this.noiseSource.loop = true;
            this.noiseSource.connect(this.weightingInput);
            this.noiseSource.start();
        } else {
            this.oscillator = this.ctx.createOscillator();
            this.oscillator.type = 'sine';
            this.oscillator.frequency.value = this.currentFrequency;
            this.oscillator.connect(this.weightingInput);
            this.oscillator.start();
        }
    }

    setSourceType(type) {
        this.currentSourceType = type;
    }

    setFrequency(freq) {
        this.currentFrequency = freq;
        if (this.oscillator) {
            this.oscillator.frequency.setValueAtTime(freq, this.ctx.currentTime);
        }
    }

    setWeighting(type) {
        if (!this.isInitialized) return;

        // Disconnect previous
        this.weightingInput.disconnect();
        this.currentFilters.forEach(f => f.disconnect());
        this.currentFilters = [];

        if (type === 'flat') {
            this.weightingInput.connect(this.weightingOutput);
        } else if (type === 'a') {
            // A-Weighting Approximation
            const hp = this.ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 300;
            hp.Q.value = 0.5;

            const hs = this.ctx.createBiquadFilter();
            hs.type = 'highshelf';
            hs.frequency.value = 100;
            hs.gain.value = -20;

            const peak = this.ctx.createBiquadFilter();
            peak.type = 'peaking';
            peak.frequency.value = 2500;
            peak.Q.value = 0.5;
            peak.gain.value = 3;

            const lp = this.ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 10000;
            lp.Q.value = 0.5;

            this.weightingInput.connect(hp);
            hp.connect(hs);
            hs.connect(peak);
            peak.connect(lp);
            lp.connect(this.weightingOutput);

            this.currentFilters = [hp, hs, peak, lp];
        } else if (type === 'b') {
            // B-Weighting Approximation
            const hp = this.ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 60;
            hp.Q.value = 0.5;

            const hs = this.ctx.createBiquadFilter();
            hs.type = 'highshelf';
            hs.frequency.value = 100;
            hs.gain.value = -10;

            const lp = this.ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 12000;
            lp.Q.value = 0.5;

            this.weightingInput.connect(hp);
            hp.connect(hs);
            hs.connect(lp);
            lp.connect(this.weightingOutput);

            this.currentFilters = [hp, hs, lp];
        } else if (type === 'c') {
            // C-Weighting Approximation
            const hp = this.ctx.createBiquadFilter();
            hp.type = 'highpass';
            hp.frequency.value = 31.5;
            hp.Q.value = 0.5;

            const lp = this.ctx.createBiquadFilter();
            lp.type = 'lowpass';
            lp.frequency.value = 8000;
            lp.Q.value = 0.5;

            this.weightingInput.connect(hp);
            hp.connect(lp);
            lp.connect(this.weightingOutput);

            this.currentFilters = [hp, lp];
        }
    }

    startANCDemo() {
        this.stopAll();

        this.ancSourceNode = this.ctx.createBufferSource();
        this.ancSourceNode.buffer = this.noiseBuffer;
        this.ancSourceNode.loop = true;

        this.ancOriginalGain = this.ctx.createGain();
        this.ancInvertedGain = this.ctx.createGain();
        this.ancDelay = this.ctx.createDelay();

        // Initialize delay based on current settings
        this.updateANCDelay();

        // Invert phase: Multiply by -1
        this.ancInvertedGain.gain.value = 0; // Start with ANC OFF

        // Graph:
        // Path 1: Original Noise
        this.ancSourceNode.connect(this.ancOriginalGain);
        this.ancOriginalGain.connect(this.analyserSource); // Visualize Source
        this.analyserSource.connect(this.analyserResult); // Sum into Result

        // Path 2: Anti-Noise (Inverted + Delayed)
        this.ancSourceNode.connect(this.ancDelay);
        this.ancDelay.connect(this.ancInvertedGain);
        this.ancInvertedGain.connect(this.analyserAntiNoise); // Visualize Anti-Noise
        this.analyserAntiNoise.connect(this.analyserResult); // Sum into Result

        // Output Result
        this.analyserResult.connect(this.masterGain);

        this.ancSourceNode.start();
    }

    toggleANC(enabled) {
        if (!this.ancInvertedGain) return;

        const now = this.ctx.currentTime;
        if (enabled) {
            this.ancInvertedGain.gain.linearRampToValueAtTime(-1, now + 0.1);
        } else {
            this.ancInvertedGain.gain.linearRampToValueAtTime(0, now + 0.1);
        }
    }

    setANCPhase(degrees) {
        this.currentPhase = degrees;
        this.updateANCDelay();
    }

    toggleLatency(enabled) {
        this.latencyEnabled = enabled;
        this.updateANCDelay();
    }

    updateANCDelay() {
        if (!this.ancDelay) return;

        // 180 is perfect cancellation (0 delay added to the inverted signal)
        // Deviation from 180 adds delay, causing phase mismatch
        const phaseError = Math.abs(180 - this.currentPhase);

        // Map error to delay. 
        // 180 deg error (0 or 360) should be significant.
        // 1ms delay is roughly 180 deg shift at 500Hz.
        // We'll use a mapping where 180 deg error = 2ms delay
        let delayTime = (phaseError / 180) * 0.002;

        if (this.latencyEnabled) {
            delayTime += 0.05; // Add 50ms latency (very noticeable)
        }

        this.ancDelay.delayTime.linearRampToValueAtTime(delayTime, this.ctx.currentTime + 0.1);
    }
}

// UI Controller
document.addEventListener('DOMContentLoaded', () => {
    const engine = new AudioEngine();
    const startBtn = document.getElementById('start-btn');
    const overlay = document.getElementById('start-overlay');

    // Canvases
    const weightingCanvas = document.getElementById('weighting-analyzer');
    const weightingCtx = weightingCanvas.getContext('2d');
    const ancCanvas = document.getElementById('anc-scope');
    const ancCtx = ancCanvas.getContext('2d');

    // UI Elements
    const noiseSourceIcon = document.querySelector('.noise-source .wave-icon');
    const antiNoiseIcon = document.querySelector('.anti-noise .wave-icon');

    // New Controls
    const playBtn = document.getElementById('weighting-play-btn');
    const sourceToggles = document.querySelectorAll('.source-select .toggle-btn');
    const freqControlGroup = document.getElementById('freq-control-group');
    const freqSlider = document.getElementById('tone-freq');
    const freqDisplay = document.getElementById('freq-display');
    const antiNoiseDesc = document.getElementById('anti-noise-desc');

    // Pro Controls
    const phaseSlider = document.getElementById('phase-slider');
    const phaseDisplay = document.getElementById('phase-display');
    const latencyToggle = document.getElementById('latency-toggle');

    let isWeightingActive = true;
    let isPlaying = false;

    // Start Button (Enter Lab)
    startBtn.addEventListener('click', async () => {
        try {
            await engine.init();
            drawLoop();
        } catch (e) {
            console.error("Audio Init Failed:", e);
            alert(`Audio initialization failed: ${e.message}\nThe app may not work correctly.`);
        } finally {
            overlay.classList.add('hidden');
        }
    });

    // Play/Stop Button for Weighting Demo
    if (playBtn) {
        playBtn.addEventListener('click', () => {
            if (isPlaying) {
                engine.stopWeightingDemo();
                playBtn.innerHTML = `<span class="icon">▶</span> Play`;
                playBtn.classList.remove('active');
                isPlaying = false;
            } else {
                // Ensure we are in weighting mode
                if (!isWeightingActive) {
                    resetANCUI();
                    isWeightingActive = true;
                }

                engine.startWeightingDemo();
                playBtn.innerHTML = `<span class="icon">⏹</span> Stop`;
                playBtn.classList.add('active');
                isPlaying = true;
            }
        });
    }

    // Source Toggles
    sourceToggles.forEach(btn => {
        btn.addEventListener('click', (e) => {
            sourceToggles.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            const source = e.target.dataset.source;
            engine.setSourceType(source);

            if (source === 'tone') {
                freqControlGroup.classList.remove('hidden');
            } else {
                freqControlGroup.classList.add('hidden');
            }

            // If currently playing, restart to switch source
            if (isPlaying && isWeightingActive) {
                engine.startWeightingDemo();
            }
        });
    });

    // Frequency Slider
    if (freqSlider) {
        freqSlider.addEventListener('input', (e) => {
            const freq = e.target.value;
            if (freqDisplay) freqDisplay.textContent = `${freq} Hz`;
            engine.setFrequency(freq);
        });
    }

    // Weighting Toggles
    const weightingToggles = document.querySelectorAll('.weighting-select .toggle-btn');
    weightingToggles.forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (!isWeightingActive) {
                engine.stopAll();
                resetANCUI();
                isWeightingActive = true;
                isPlaying = false;
                if (playBtn) {
                    playBtn.innerHTML = `<span class="icon">▶</span> Play`;
                    playBtn.classList.remove('active');
                }
            }

            weightingToggles.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');
            engine.setWeighting(e.target.dataset.weighting);

            updateWeightingInfo(e.target.dataset.weighting);
        });
    });

    // Volume
    const volSlider = document.getElementById('weighting-volume');
    if (volSlider) {
        volSlider.addEventListener('input', (e) => {
            if (engine.masterGain) {
                engine.masterGain.gain.value = e.target.value;
            }
        });
    }

    // ANC Controls
    const startEngineBtn = document.getElementById('start-engine-btn');
    const ancBtn = document.getElementById('anc-toggle');
    let engineRunning = false;
    let ancActive = false;

    if (startEngineBtn) {
        startEngineBtn.addEventListener('click', () => {
            if (isWeightingActive) {
                // Switch mode
                engine.startANCDemo();
                isWeightingActive = false;

                // Reset Weighting UI
                isPlaying = false;
                if (playBtn) {
                    playBtn.innerHTML = `<span class="icon">▶</span> Play`;
                    playBtn.classList.remove('active');
                }

                // Reset ANC UI
                engineRunning = true;
                ancActive = false;

                startEngineBtn.innerHTML = `<span class="icon">⏹</span> Stop Engine`;
                startEngineBtn.classList.add('active');

                ancBtn.disabled = false;
                ancBtn.classList.remove('active');
                ancBtn.innerHTML = `<span class="icon">⏻</span> Activate ANC`;

                noiseSourceIcon.classList.add('animating');
                antiNoiseIcon.classList.remove('animating');

                document.getElementById('anc-status').textContent = "NOISE";
                document.getElementById('anc-status').classList.remove('silence');

                engine.toggleANC(false);
            } else {
                // Toggle Engine
                engineRunning = !engineRunning;

                if (engineRunning) {
                    engine.startANCDemo();
                    startEngineBtn.innerHTML = `<span class="icon">⏹</span> Stop Engine`;
                    startEngineBtn.classList.add('active');
                    ancBtn.disabled = false;
                    noiseSourceIcon.classList.add('animating');

                    ancActive = false;
                    ancBtn.classList.remove('active');
                    ancBtn.innerHTML = `<span class="icon">⏻</span> Activate ANC`;
                    engine.toggleANC(false);
                    antiNoiseIcon.classList.remove('animating');
                    document.getElementById('anc-status').textContent = "NOISE";
                    document.getElementById('anc-status').classList.remove('silence');
                } else {
                    engine.stopAll();
                    startEngineBtn.innerHTML = `<span class="icon">🔊</span> Start Engine`;
                    startEngineBtn.classList.remove('active');
                    ancBtn.disabled = true;
                    noiseSourceIcon.classList.remove('animating');
                    antiNoiseIcon.classList.remove('animating');
                    document.getElementById('anc-status').textContent = "OFF";
                    document.getElementById('anc-status').classList.remove('silence');
                }
            }
        });
    }

    if (ancBtn) {
        ancBtn.addEventListener('click', () => {
            if (!engineRunning) return;

            ancActive = !ancActive;
            engine.toggleANC(ancActive);

            if (ancActive) {
                ancBtn.classList.add('active');
                ancBtn.innerHTML = `<span class="icon">⏻</span> Deactivate ANC`;

                // Trigger phase input event logic to set initial status correctly
                const phase = phaseSlider ? phaseSlider.value : 180;
                const diff = Math.abs(180 - phase);
                const statusEl = document.getElementById('anc-status');

                if (diff < 10) {
                    statusEl.textContent = "SILENCE";
                    statusEl.className = "status-indicator silence";
                } else if (diff < 45) {
                    statusEl.textContent = "REDUCED";
                    statusEl.className = "status-indicator reduced";
                    statusEl.style.color = "var(--accent-primary)";
                } else {
                    statusEl.textContent = "INTERFERENCE";
                    statusEl.className = "status-indicator interference";
                    statusEl.style.color = "var(--accent-danger)";
                }

                antiNoiseIcon.classList.add('animating');
            } else {
                ancBtn.classList.remove('active');
                ancBtn.innerHTML = `<span class="icon">⏻</span> Activate ANC`;
                document.getElementById('anc-status').textContent = "NOISE";
                document.getElementById('anc-status').className = "status-indicator";
                document.getElementById('anc-status').style.color = ""; // Reset color
                antiNoiseIcon.classList.remove('animating');
            }
        });
    }

    // Phase Slider
    if (phaseSlider) {
        phaseSlider.addEventListener('input', (e) => {
            const phase = e.target.value;
            engine.setANCPhase(phase);

            // Update Display
            if (phaseDisplay) {
                phaseDisplay.textContent = `${phase}°`;
            }
            if (antiNoiseDesc) {
                antiNoiseDesc.textContent = `Inverted Phase (${phase}°)`;
            }

            // Rotate Knob Visual
            const knobInner = document.querySelector('.knob-inner');
            const knobValue = document.querySelector('.knob-value');

            if (knobInner) {
                knobInner.style.transform = `rotate(${phase}deg)`;
            }

            // Counter-rotate text to keep it upright
            if (knobValue) {
                knobValue.style.transform = `rotate(-${phase}deg)`;
            }

            // Update Status Text based on phase
            const statusEl = document.getElementById('anc-status');
            if (statusEl && ancActive) {
                const diff = Math.abs(180 - phase);
                if (diff < 10) {
                    statusEl.textContent = "SILENCE";
                    statusEl.className = "status-indicator silence";
                } else if (diff < 45) {
                    statusEl.textContent = "REDUCED";
                    statusEl.className = "status-indicator reduced"; // Need to add CSS for this
                    statusEl.style.color = "var(--accent-primary)"; // Temporary inline or add to CSS
                } else {
                    statusEl.textContent = "INTERFERENCE";
                    statusEl.className = "status-indicator interference"; // Need to add CSS for this
                    statusEl.style.color = "var(--accent-danger)";
                }
            }
        });
    }

    // Latency Toggle
    // Dynamic Slider Fill
    function updateSliderFill(slider) {
        if (!slider) return;
        const val = (slider.value - slider.min) / (slider.max - slider.min) * 100;
        slider.style.background = `linear-gradient(to right, var(--accent-primary) 0%, var(--accent-primary) ${val}%, rgba(255, 255, 255, 0.1) ${val}%, rgba(255, 255, 255, 0.1) 100%)`;
    }

    // Initialize and attach listeners
    [freqSlider, volSlider, phaseSlider].forEach(slider => {
        if (slider) {
            updateSliderFill(slider);
            slider.addEventListener('input', (e) => updateSliderFill(e.target));
        }
    });

    if (latencyToggle) {
        latencyToggle.addEventListener('change', (e) => {
            engine.toggleLatency(e.target.checked);
        });
    }

    function resetANCUI() {
        if (ancBtn) {
            ancBtn.classList.remove('active');
            ancBtn.innerHTML = `<span class="icon">⏻</span> Activate ANC`;
            ancBtn.disabled = true;
        }
        if (startEngineBtn) {
            startEngineBtn.innerHTML = `<span class="icon">🔊</span> Start Engine`;
            startEngineBtn.classList.remove('active');
        }
        engineRunning = false;
        ancActive = false;
        document.getElementById('anc-status').textContent = "OFF";
        document.getElementById('anc-status').classList.remove('silence');
        noiseSourceIcon.classList.remove('animating');
        antiNoiseIcon.classList.remove('animating');
    }

    function updateWeightingInfo(type) {
        const infoBox = document.getElementById('weighting-info');
        if (!infoBox) return;

        if (type === 'a') {
            infoBox.innerHTML = `<h3>A-Weighting</h3><p>Mimics the human ear's sensitivity at low volumes (approx 40 phon). It significantly cuts bass frequencies, which is why it sounds "thin". This is the standard for measuring environmental noise (dBA).</p>`;
        } else if (type === 'b') {
            infoBox.innerHTML = `<h3>B-Weighting</h3><p>Mimics the ear's sensitivity at medium volumes (approx 70 phon). It has a flatter response than A-weighting but still attenuates some low frequencies. Rarely used today compared to A and C weighting.</p>`;
        } else if (type === 'c') {
            infoBox.innerHTML = `<h3>C-Weighting</h3><p>Mimics the ear's sensitivity at high volumes (approx 100 phon). It is much flatter than A and B, only rolling off at the very low and high ends. Often used for peak noise measurements.</p>`;
        } else {
            infoBox.innerHTML = `<h3>Flat Response (Z-Weighting)</h3><p>All frequencies are played at equal amplitude. This is the raw, unweighted sound.</p>`;
        }
    }

    let ancViewMode = 'waveform'; // 'waveform' or 'spectrum'

    // --- Event Listeners ---
    // --- Event Listeners ---
    // startBtn listener is already defined above

    // ... (Existing listeners) ...

    const viewModeToggle = document.getElementById('view-mode-toggle');
    if (viewModeToggle) {
        viewModeToggle.addEventListener('change', (e) => {
            ancViewMode = e.target.checked ? 'spectrum' : 'waveform';
        });
    }

    // ... (Existing code) ...

    function drawLoop() {
        requestAnimationFrame(drawLoop);

        if (isWeightingActive) {
            drawSpectrum(engine.analyser, weightingCtx, weightingCanvas.width, weightingCanvas.height);
            ancCtx.clearRect(0, 0, ancCanvas.width, ancCanvas.height);
        } else {
            if (ancViewMode === 'spectrum') {
                drawMultiSpectrum(
                    engine.analyserSource,
                    engine.analyserAntiNoise,
                    engine.analyserResult,
                    ancCtx,
                    ancCanvas.width,
                    ancCanvas.height
                );
            } else {
                drawMultiOscilloscope(
                    engine.analyserSource,
                    engine.analyserAntiNoise,
                    engine.analyserResult,
                    ancCtx,
                    ancCanvas.width,
                    ancCanvas.height
                );
            }
            weightingCtx.clearRect(0, 0, weightingCanvas.width, weightingCanvas.height);
        }
    }

    function drawMultiSpectrum(analyserSrc, analyserAnti, analyserRes, ctx, width, height) {
        if (!analyserSrc || !analyserAnti || !analyserRes) return;

        ctx.fillStyle = 'rgb(0, 0, 0)';
        ctx.fillRect(0, 0, width, height);

        const bufferLength = analyserSrc.frequencyBinCount;
        const dataSrc = new Uint8Array(bufferLength);
        const dataAnti = new Uint8Array(bufferLength);
        const dataRes = new Uint8Array(bufferLength);

        analyserSrc.getByteFrequencyData(dataSrc);
        analyserAnti.getByteFrequencyData(dataAnti);
        analyserRes.getByteFrequencyData(dataRes);

        // Logarithmic Scale Parameters
        const minFreq = 20;
        const maxFreq = 20000;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const scale = width / (logMax - logMin);
        const barWidth = 3;

        ctx.globalCompositeOperation = 'screen'; // Blend colors

        for (let x = 0; x < width; x += 2) {
            const freq = Math.pow(10, (x / scale) + logMin);
            const binIndex = Math.floor(freq * (2 * bufferLength) / 44100);

            if (binIndex >= 0 && binIndex < bufferLength) {
                // Draw Source (Green)
                const valSrc = dataSrc[binIndex];
                const hSrc = (valSrc / 255) * height;
                ctx.fillStyle = `rgba(0, 255, 0, 0.5)`;
                ctx.fillRect(x, height - hSrc, barWidth, hSrc);

                // Draw Anti-Noise (Red)
                const valAnti = dataAnti[binIndex];
                const hAnti = (valAnti / 255) * height;
                ctx.fillStyle = `rgba(255, 0, 0, 0.5)`;
                ctx.fillRect(x, height - hAnti, barWidth, hAnti);

                // Draw Result (Blue)
                const valRes = dataRes[binIndex];
                const hRes = (valRes / 255) * height;
                ctx.fillStyle = `rgba(0, 100, 255, 0.8)`; // Higher opacity for result
                ctx.fillRect(x, height - hRes, barWidth, hRes);
            }
        }
        ctx.globalCompositeOperation = 'source-over'; // Reset
    }

    function drawSpectrum(analyser, ctx, width, height) {
        if (!analyser) return;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteFrequencyData(dataArray);

        ctx.fillStyle = 'rgb(0, 0, 0)';
        ctx.fillRect(0, 0, width, height);

        // Logarithmic Scale Parameters
        const minFreq = 20;
        const maxFreq = 20000;
        const sampleRate = 44100;
        const logMin = Math.log10(minFreq);
        const logMax = Math.log10(maxFreq);
        const scale = width / (logMax - logMin);

        const barWidth = 3;

        for (let x = 0; x < width; x += 2) {
            const freq = Math.pow(10, (x / scale) + logMin);
            const binIndex = Math.floor(freq * (2 * bufferLength) / sampleRate);

            if (binIndex >= 0 && binIndex < bufferLength) {
                const value = dataArray[binIndex];
                const barHeight = (value / 255) * height;

                const r = barHeight + (25 * (x / width));
                const g = 250 * (x / width);
                const b = 50;

                ctx.fillStyle = `rgb(${r},${g},${b})`;
                ctx.fillRect(x, height - barHeight, barWidth, barHeight);
            }
        }
    }

    function drawMultiOscilloscope(analyserSrc, analyserAnti, analyserRes, ctx, width, height) {
        if (!analyserSrc || !analyserAnti || !analyserRes) return;

        ctx.fillStyle = 'rgb(0, 0, 0)';
        ctx.fillRect(0, 0, width, height);

        // Helper to draw one line
        function drawLine(analyser, color) {
            const bufferLength = analyser.fftSize;
            const dataArray = new Uint8Array(bufferLength);
            analyser.getByteTimeDomainData(dataArray);

            ctx.lineWidth = 2;
            ctx.strokeStyle = color;
            ctx.beginPath();

            const sliceWidth = width * 1.0 / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = v * height / 2;

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }
            ctx.lineTo(width, height / 2);
            ctx.stroke();
        }

        // Draw in order: Source (Green), Anti (Red), Result (Blue)
        // Use globalAlpha to blend them if they overlap
        ctx.globalCompositeOperation = 'screen';

        // Source - Green Glow
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgb(0, 255, 0)';
        drawLine(analyserSrc, 'rgb(0, 255, 0)');

        // Anti-Noise - Red Glow
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgb(255, 50, 50)';
        drawLine(analyserAnti, 'rgb(255, 50, 50)');

        // Result - Blue Glow (Thicker)
        ctx.lineWidth = 3;
        ctx.shadowBlur = 15;
        ctx.shadowColor = 'rgb(50, 150, 255)';
        drawLine(analyserRes, 'rgb(50, 150, 255)');

        // Reset shadow
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = 'source-over';
    }
});
