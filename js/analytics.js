const ANALYTICS = {
    enabled: false,
    apiKey: null,
    host: 'https://eu.posthog.com',
    distinctId: null,

    init(apiKey, options = {}) {
        if (!apiKey) return;
        this.enabled = true;
        this.apiKey = apiKey;
        this.host = options.host || 'https://eu.posthog.com';
        this.distinctId = options.distinctId || localStorage.getItem('solo_analytics_id');
        if (!this.distinctId) {
            this.distinctId = 'anon_' + Math.random().toString(36).slice(2, 10);
            localStorage.setItem('solo_analytics_id', this.distinctId);
        }
    },

    async capture(event, properties = {}) {
        if (!this.enabled) return;
        try {
            const payload = {
                api_key: this.apiKey,
                event,
                distinct_id: this.distinctId,
                properties: {
                    ...properties,
                    $current_url: window.location.href,
                    $screen_width: screen.width,
                    country: CONFIG.user?.countryCode || null,
                    plan: CONFIG.user?.plan || null
                },
                timestamp: new Date().toISOString()
            };
            if (navigator.sendBeacon) {
                navigator.sendBeacon(`${this.host}/capture/`, JSON.stringify(payload));
            } else {
                fetch(`${this.host}/capture/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                    keepalive: true
                }).catch(() => {});
            }
        } catch (e) {}
    },

    identify(userId, traits = {}) {
        if (!this.enabled) return;
        this.distinctId = userId;
        this.capture('$identify', traits);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    const key = localStorage.getItem('posthog_api_key');
    if (key) ANALYTICS.init(key);
});
