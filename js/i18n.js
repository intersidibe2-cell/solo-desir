const i18n = {
    lang: 'fr',
    translations: {},

    async load(lang) {
        this.lang = lang || localStorage.getItem('solo_lang') || 'fr';
        try {
            const r = await fetch('/lang/' + this.lang + '.json');
            if (r.ok) {
                this.translations = await r.json();
            } else {
                console.warn('Translation file not found:', this.lang);
                if (this.lang !== 'fr') return this.load('fr');
            }
        } catch (e) {
            console.warn('Failed to load translations:', e);
            if (this.lang !== 'fr') return this.load('fr');
        }
        this.apply();
        localStorage.setItem('solo_lang', this.lang);
        document.documentElement.lang = this.lang;
        document.documentElement.dir = this.lang === 'ar' ? 'rtl' : 'ltr';
    },

    t(key) {
        return this.translations[key] || key;
    },

    apply() {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.dataset.i18n;
            const text = this.t(key);
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                // Don't change input values
            } else {
                el.textContent = text;
            }
        });
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            el.placeholder = this.t(el.dataset.i18nPlaceholder);
        });
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            el.title = this.t(el.dataset.i18nTitle);
        });
        // Update specific elements that are dynamically set
        const langSwitcher = document.getElementById('langSwitcher');
        if (langSwitcher) langSwitcher.value = this.lang;
    },

    getCountryName(code) {
        const countries = {
            'ML': 'Mali', 'CI': "Côte d'Ivoire", 'SN': 'Sénégal', 'BF': 'Burkina Faso',
            'GN': 'Guinée', 'CM': 'Cameroun', 'BJ': 'Bénin', 'TG': 'Togo',
            'NE': 'Niger', 'TD': 'Tchad'
        };
        return countries[code] || code;
    },

    initSwitcher() {
        const switcher = document.getElementById('langSwitcher');
        if (switcher) {
            switcher.value = this.lang;
            switcher.addEventListener('change', () => {
                this.load(switcher.value);
            });
        }
    }
};
