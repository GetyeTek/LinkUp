import { supabase } from './supabaseClient.js';

class TelemetryEngine {
    constructor() {
        this.currentFeature = 'home';
        this.previousFeature = 'home';
        this.startTime = Date.now();
        this.pendingInteractions = 0;
        this.flushInterval = null;
        this.initialized = false;
    }

    init() {
        if (this.initialized) return;
        this.initialized = true;

        // Auto-flush every 30 seconds while user is actively reading or studying
        this.flushInterval = setInterval(() => this.flush(), 30000);

        // Immediate flush on tab blur or browser close
        window.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'hidden') {
                this.flush();
            } else {
                this.startTime = Date.now();
            }
        });

        window.addEventListener('beforeunload', () => {
            this.flush();
        });
    }

    switchFeature(newFeature) {
        if (this.currentFeature === newFeature) return;
        this.flush(); // Commit pending seconds for current feature
        this.previousFeature = this.currentFeature;
        this.currentFeature = newFeature;
        this.startTime = Date.now();
        this.pendingInteractions = 0;
    }

    restorePreviousFeature() {
        this.switchFeature(this.previousFeature || 'home');
    }

    logInteraction() {
        this.pendingInteractions += 1;
    }

    flush() {
        const now = Date.now();
        const durationSec = Math.floor((now - this.startTime) / 1000);
        const interactions = this.pendingInteractions;

        if (durationSec <= 0 && interactions === 0) return;

        // Reset timer and counter for next window
        this.startTime = now;
        this.pendingInteractions = 0;

        const feature = this.currentFeature;

        supabase.rpc('record_telemetry_flush', {
            p_feature: feature,
            p_duration_seconds: durationSec,
            p_interactions: interactions
        }).then(({ error }) => {
            if (error) console.error("[Telemetry] Flush Error:", error.message);
        });
    }
}

export const telemetry = new TelemetryEngine();