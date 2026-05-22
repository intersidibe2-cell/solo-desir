const CONFIG = {
    backendUrl: window.location.origin + '/api',
    user: {
        country: null,
        currency: null,
        token: localStorage.getItem('solo_token') || null,
        refreshToken: localStorage.getItem('solo_refresh') || null
    }
};

function getToken() {
    return CONFIG.user.token || localStorage.getItem('solo_token');
}

function setToken(token) {
    CONFIG.user.token = token;
    if (token) localStorage.setItem('solo_token', token);
    else localStorage.removeItem('solo_token');
}

function setRefreshToken(token) {
    CONFIG.user.refreshToken = token;
    if (token) localStorage.setItem('solo_refresh', token);
    else localStorage.removeItem('solo_refresh');
}

async function refreshAccessToken() {
    const rt = CONFIG.user.refreshToken;
    if (!rt) return false;
    try {
        const resp = await fetch(`${CONFIG.backendUrl}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: rt })
        });
        const data = await resp.json();
        if (data.success && data.token) {
            setToken(data.token);
            if (data.refreshToken) setRefreshToken(data.refreshToken);
            return true;
        }
    } catch (e) {}
    return false;
}

async function fetchWithAuth(url, options = {}) {
    const token = getToken();
    if (token) {
        options.headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
    }
    let resp = await fetch(url, options);
    if (resp.status === 401 && CONFIG.user.refreshToken) {
        const refreshed = await refreshAccessToken();
        if (refreshed) {
            const newToken = getToken();
            options.headers['Authorization'] = `Bearer ${newToken}`;
            resp = await fetch(url, options);
        }
    }
    return resp;
}

const API = {
    async detectLocation() {
        try {
            const resp = await fetch('https://ip-api.com/json/?fields=status,country,countryCode,regionName,city,query,currency');
            const data = await resp.json();
            if (data.status === 'success') {
                CONFIG.user.country = data.country;
                CONFIG.user.countryCode = data.countryCode;
                CONFIG.user.currency = data.currency || 'XOF';
                CONFIG.user.city = data.city;
                localStorage.setItem('solo_country', data.countryCode || 'ML');
                return data;
            }
        } catch (e) {}
        const saved = localStorage.getItem('solo_country');
        CONFIG.user.countryCode = saved || 'ML';
        return null;
    },

    async register(pseudo, email, password) {
        try {
            const resp = await fetch(`${CONFIG.backendUrl}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-country': CONFIG.user.countryCode || 'ML' },
                body: JSON.stringify({ pseudo, email, password })
            });
            const data = await resp.json();
            if (data.success && data.token) {
                setToken(data.token);
                if (data.refreshToken) setRefreshToken(data.refreshToken);
            }
            return data;
        } catch (e) {
            return { success: true, token: 'demo-token', user: { pseudo, email, plan: 'free' }, offline: true };
        }
    },

    async login(email, password) {
        try {
            const resp = await fetch(`${CONFIG.backendUrl}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await resp.json();
            if (data.success && data.token) {
                setToken(data.token);
                if (data.refreshToken) setRefreshToken(data.refreshToken);
            }
            return data;
        } catch (e) {
            return { success: true, token: 'demo-token', user: { pseudo: email, email, plan: 'free' }, offline: true };
        }
    },

    async chat(character, message, history = []) {
        const token = getToken();
        try {
            const resp = await fetch(`${CONFIG.backendUrl}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                body: JSON.stringify({ character, message, history })
            });
            const data = await resp.json();
            if (data.success && data.response) {
                return { type: 'text', content: data.response, messagesLeft: data.messagesLeft };
            }
            if (resp.status === 403) return { type: 'text', content: data.message || 'Limite atteinte', limit: true };
            if (resp.status === 401) {
                const ok = await refreshAccessToken();
                if (ok) return this.chat(character, message, history);
                return { type: 'text', content: 'Session expirée. Reconnecte-toi.' };
            }
            throw new Error('API error');
        } catch (e) {
            return null;
        }
    },

    async voice(text, voiceId = '21m00Tcm4TlvDq8ikWAM') {
        const token = getToken();
        try {
            const resp = await fetch(`${CONFIG.backendUrl}/voice/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                body: JSON.stringify({ text, voiceId })
            });
            if (resp.ok) {
                const blob = await resp.blob();
                return URL.createObjectURL(blob);
            }
        } catch (e) {}
        return null;
    },

    async initiatePayment(phone, amount, operator) {
        const token = getToken();
        try {
            const resp = await fetch(`${CONFIG.backendUrl}/payment/initiate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) },
                body: JSON.stringify({ phone, amount, operator })
            });
            return await resp.json();
        } catch (e) {
            return { success: true, message: 'Abonnement activé (hors ligne)', demo: true };
        }
    },

    async getUser() {
        try {
            const resp = await fetchWithAuth(`${CONFIG.backendUrl}/user/me`);
            const data = await resp.json();
            return data.success ? data.user : null;
        } catch (e) {
            return null;
        }
    },

    async getPlans() {
        try {
            const resp = await fetch(`${CONFIG.backendUrl}/plans`);
            const data = await resp.json();
            return data.success ? data.plans : null;
        } catch (e) {
            return null;
        }
    },

    logout() {
        setToken(null);
        setRefreshToken(null);
        localStorage.removeItem('solo_user');
    }
};

function getCountryInfo(countryCode) {
    const countries = {
        ML: { name: 'Mali', currency: 'XOF', flag: '🇲🇱', operators: ['Orange Money'] },
        CI: { name: 'Côte d\'Ivoire', currency: 'XOF', flag: '🇨🇮', operators: ['Orange Money', 'MTN MoMo'] },
        SN: { name: 'Sénégal', currency: 'XOF', flag: '🇸🇳', operators: ['Orange Money', 'Wave'] },
        BF: { name: 'Burkina Faso', currency: 'XOF', flag: '🇧🇫', operators: ['Orange Money'] },
        BJ: { name: 'Bénin', currency: 'XOF', flag: '🇧🇯', operators: ['Orange Money', 'MTN MoMo'] },
        GN: { name: 'Guinée', currency: 'GNF', flag: '🇬🇳', operators: ['Orange Money'] },
        NE: { name: 'Niger', currency: 'XOF', flag: '🇳🇪', operators: ['Orange Money'] },
        TG: { name: 'Togo', currency: 'XOF', flag: '🇹🇬', operators: ['Orange Money', 'Togocom'] },
        NG: { name: 'Nigeria', currency: 'NGN', flag: '🇳🇬', operators: ['MTN MoMo', 'Airtel'] }
    };
    return countries[countryCode] || { name: 'Afrique', currency: 'XOF', flag: '🌍', operators: ['Orange Money', 'MTN MoMo'] };
}
