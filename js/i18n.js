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
            'DZ': 'Algérie', 'AO': 'Angola', 'BJ': 'Bénin', 'BW': 'Botswana',
            'BF': 'Burkina Faso', 'BI': 'Burundi', 'CV': 'Cabo Verde', 'CM': 'Cameroun',
            'CF': 'Centrafrique', 'TD': 'Tchad', 'KM': 'Comores', 'CG': 'Congo',
            'CD': 'RDC', 'CI': "Côte d'Ivoire", 'DJ': 'Djibouti', 'EG': 'Égypte',
            'GQ': 'Guinée Éq.', 'ER': 'Érythrée', 'SZ': 'Eswatini', 'ET': 'Éthiopie',
            'GA': 'Gabon', 'GM': 'Gambie', 'GH': 'Ghana', 'GN': 'Guinée',
            'GW': 'Guinée-Bissau', 'KE': 'Kenya', 'LS': 'Lesotho', 'LR': 'Liberia',
            'LY': 'Libye', 'MG': 'Madagascar', 'MW': 'Malawi', 'ML': 'Mali',
            'MR': 'Mauritanie', 'MU': 'Maurice', 'MA': 'Maroc', 'MZ': 'Mozambique',
            'NA': 'Namibie', 'NE': 'Niger', 'NG': 'Nigéria', 'RW': 'Rwanda',
            'ST': 'São Tomé', 'SN': 'Sénégal', 'SC': 'Seychelles', 'SL': 'Sierra Leone',
            'SO': 'Somalie', 'ZA': 'Afrique du Sud', 'SS': 'Soudan du Sud', 'SD': 'Soudan',
            'TZ': 'Tanzanie', 'TG': 'Togo', 'TN': 'Tunisie', 'UG': 'Ouganda',
            'ZM': 'Zambie', 'ZW': 'Zimbabwe'
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
