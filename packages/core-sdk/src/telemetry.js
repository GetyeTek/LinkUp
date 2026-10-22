import { supabase } from './supabaseClient.js';

class TelemetryEngine {
    constructor() {
        this.currentFeature = 'home';
        this.previousFeature = 'home';
        this.startTime = Date.now();
        this.lastActiveTime = Date.now();
        this.pendingInteractions = 0;
        this.flushInterval = null;
        this.initialized = false;
        this.bookContext = null;
        this.idleThresholdMs = 3 * 60 * 1000; // 3-minute AFK cutoff
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;

        const recordActivity = () => {
            this.lastActiveTime = Date.now();
        };

        // Track real student presence across keyboard, mouse, touch, and scroll
        ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach(evt => {
            window.addEventListener(evt, recordActivity, { passive: true });
        });

        // Auto-flush every 30 seconds
        this.flushInterval = setInterval(() => this.flush(), 30000);

        // Immediate flush on tab blur; reset on wake to eliminate sleep-warp
        window.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.flush();
            } else {
                this.startTime = Date.now();
                this.lastActiveTime = Date.now();
            }
        });

        window.addEventListener('focus', () => {
            this.startTime = Date.now();
            this.lastActiveTime = Date.now();
        });

        window.addEventListener('beforeunload', () => {
            this.flush();
        });
    }

    setBookContext(context) {
        this.bookContext = context;
        this.lastActiveTime = Date.now();
    }

    clearBookContext() {
        this.bookContext = null;
    }

    switchFeature(newFeature) {
        if (this.currentFeature === newFeature) return;
        this.flush(); // Commit pending seconds for current feature
        this.previousFeature = this.currentFeature;
        this.currentFeature = newFeature;
        this.startTime = Date.now();
        this.lastActiveTime = Date.now();
        this.pendingInteractions = 0;
    }

    restorePreviousFeature() {
        this.switchFeature(this.previousFeature || 'home');
    }

    logInteraction() {
        this.pendingInteractions += 1;
        this.lastActiveTime = Date.now();
    }

    flush() {
        const now = Date.now();
        const rawDuration = Math.floor((now - this.startTime) / 1000);
        const isIdle = (now - this.lastActiveTime) > this.idleThresholdMs;

        // Reset timer anchor immediately to prevent wake-up accumulation
        this.startTime = now;

        // AFK Freeze: If user hasn't touched the app for > 3 minutes, halt telemetry
        if (isIdle && this.pendingInteractions === 0) {
            return;
        }

        // Anti-Warp Ceiling: Clamp any single flush to a sane maximum of 60 seconds
        const durationSec = Math.max(0, Math.min(rawDuration, 60));
        const interactions = this.pendingInteractions;

        if (durationSec <= 0 && interactions === 0 && !this.bookContext) return;

        this.pendingInteractions = 0;

        const feature = this.currentFeature;
        const bookCtx = this.bookContext ? { ...this.bookContext } : null;

        supabase.rpc('record_telemetry_flush', {
            p_feature: feature,
            p_duration_seconds: durationSec,
            p_interactions: interactions,
            p_book_context: bookCtx
        }).then(({ error }) => {
            if (error) console.error("[Telemetry] Flush Error:", error.message);
        });
    }
}

export const telemetry = new TelemetryEngine();