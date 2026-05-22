const APP = {
    currentUser: null,
    currentCharacter: null,
    messages: [],
    isAuthenticated: false,
    currentTab: 'feminin',
    selectedPlan: null,

    async init() {
        await this.detectUserLocation();
        this.createParticles();
        this.bindEvents();
        this.bindAuthEvents();
        this.bindPricingEvents();
        this.bindCharacterEvents();
        this.updateCountryUI();
        this.initDiscreteMode();
    },

    async detectUserLocation() {
        const data = await API.detectLocation();
        if (data) {
            const info = getCountryInfo(data.countryCode);
            CONFIG.user.locationInfo = info;
            document.getElementById('ip-data').dataset.country = data.countryCode;
        }
    },

    createParticles() {
        const container = document.getElementById('particles');
        if (!container) return;
        
        for (let i = 0; i < 30; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = Math.random() * 100 + '%';
            particle.style.width = (Math.random() * 3 + 1) + 'px';
            particle.style.height = particle.style.width;
            particle.style.animationDuration = (Math.random() * 15 + 10) + 's';
            particle.style.animationDelay = (Math.random() * 10) + 's';
            container.appendChild(particle);
        }
    },

    updateCountryUI() {
        const info = CONFIG.user.locationInfo;
        if (!info) return;

        const paymentNotice = document.querySelector('.payment-notice');
        if (paymentNotice) {
            paymentNotice.innerHTML = `
                <i class="fas fa-mobile-screen"></i>
                <span>Paiement sécurisé - <strong>${info.flag} ${info.name}</strong> : ${info.operators.join(', ')}</span>
            `;
        }
    },

    bindEvents() {
        const openAuthBtns = ['loginBtn', 'signupBtn', 'loginBtnMobile', 'signupBtnMobile', 'heroCta', 'ctaBtn'];
        openAuthBtns.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.addEventListener('click', () => this.openModal('authModal'));
        });

        document.getElementById('modalClose')?.addEventListener('click', () => this.closeModal('authModal'));
        document.getElementById('modalOverlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeModal('authModal');
        });

        document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
            document.getElementById('mobileMenu').classList.toggle('active');
        });

        document.querySelectorAll('.mobile-link').forEach(link => {
            link.addEventListener('click', () => {
                document.getElementById('mobileMenu').classList.remove('active');
            });
        });

        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', function(e) {
                document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
                this.classList.add('active');
            });
        });

        document.getElementById('heroDemo')?.addEventListener('click', () => {
            document.getElementById('features').scrollIntoView({ behavior: 'smooth' });
        });

        document.querySelectorAll('.pricing-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const card = e.currentTarget.closest('.pricing-card');
                const planName = card.querySelector('h3').textContent;
                const priceAttr = e.currentTarget.dataset.price;
                const price = priceAttr ? parseInt(priceAttr) : 0;
                APP.selectedPlan = { name: planName, price };
                if (price === 0) {
                    const pseudo = document.querySelector('#signupForm input[type="text"]');
                    if (pseudo && pseudo.value) { APP.handleSignup(); return; }
                }
                APP.openModal('authModal');
            });
        });

        window.addEventListener('scroll', () => {
            const navbar = document.querySelector('.navbar');
            if (window.scrollY > 50) {
                navbar.style.background = 'rgba(13,13,26,0.95)';
            } else {
                navbar.style.background = 'rgba(13,13,26,0.8)';
            }
        });
    },

    bindAuthEvents() {
        document.querySelectorAll('.modal-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                document.getElementById(tab.dataset.tab + 'Tab').classList.add('active');
            });
        });

        document.querySelectorAll('.switch-tab').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const tab = link.dataset.tab;
                document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                document.querySelector(`.modal-tab[data-tab="${tab}"]`).classList.add('active');
                document.getElementById(tab + 'Tab').classList.add('active');
            });
        });

        document.getElementById('loginForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        document.getElementById('signupForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleSignup();
        });
    },

    bindPricingEvents() {
        document.querySelectorAll('.pricing-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const card = e.currentTarget.closest('.pricing-card');
                const name = card.querySelector('h3').textContent;
                const price = parseInt(e.currentTarget.dataset.price || '0');
                APP.selectedPlan = { name, price };
                APP.openModal('authModal');
            });
        });
    },

    bindCharacterEvents() {
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.characters-grid').forEach(g => g.classList.remove('active'));
                document.getElementById(btn.dataset.tab + '-grid')?.classList.add('active');
            });
        });

        document.querySelectorAll('.character-card').forEach(card => {
            card.addEventListener('click', () => {
                const name = card.dataset.name;
                const character = this.getCharacterByName(name);
                if (character) {
                    this.selectCharacter(character);
                }
            });
        });

        document.getElementById('createCharacterBtn')?.addEventListener('click', () => {
            if (!this.isAuthenticated) {
                this.openModal('authModal');
                this.showToast('Crée toi un compte pour créer ton personnage !');
            }
        });

        document.getElementById('characterModalClose')?.addEventListener('click', () => this.closeModal('characterModal'));
        document.getElementById('characterModalOverlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeModal('characterModal');
        });
    },

    getCharacterByName(name) {
        const characters = {
            'Aminata': {
                name: 'Aminata',
                gender: 'feminin',
                voiceId: '21m00Tcm4TlvDq8ikWAM',
                voiceStyle: 'douce',
                style: 'Romantique',
                systemPrompt: 'Tu es Aminata, une femme douce, sensuelle et attentionnée. Tu parles français. Tu es là pour guider l\'utilisateur vers le plaisir et la découverte de soi. Tu es patiente, compréhensive et jamais jugeante. Tu utilises un langage sensuel mais pas vulgaire.',
                bio: 'Je suis là pour t\'écouter, te comprendre et te guider vers le plaisir.'
            },
            'Zara': {
                name: 'Zara',
                gender: 'feminin',
                voiceId: 'EXAVITQu4vrRV1NfG6UX',
                voiceStyle: 'coquine',
                style: 'Passionnée',
                systemPrompt: 'Tu es Zara, une femme passionnée et coquine. Tu parles français. Tu aimes les jeux de séduction et les défis. Tu es directe mais pas vulgaire. Tu sais ce que tu veux et tu guides l\'utilisateur à oser ses désirs.',
                bio: 'J\'aime les jeux et les défis. Prêt à t\'amuser avec moi ?'
            },
            'Grace': {
                name: 'Grace',
                gender: 'feminin',
                voiceId: 'IKNe3O0S0J5wq6SOh5qV',
                voiceStyle: 'guide',
                style: 'Guidance',
                systemPrompt: 'Tu es Grace, une guide spirituelle et sensuelle. Tu parles français. Tu utilises la respiration, la visualisation et des instructions douces pour guider l\'utilisateur dans son voyage intime. Tu es apaisante, lente et précise.',
                bio: 'Ferme les yeux. Inspire. Je vais te guider pas à pas.'
            },
            'Nala': {
                name: 'Nala',
                gender: 'feminin',
                voiceId: 'ODIh6NmKjOBx8pVQZnAl',
                voiceStyle: 'coquine',
                style: 'Audacieuse',
                systemPrompt: 'Tu es Nala, une femme audacieuse et enjôleuse. Tu parles français. Tu n\'as pas peur de dire ce que tu veux. Tu pousses l\'utilisateur à sortir de sa zone de confort tout en restant respectueuse.',
                bio: 'Je sais ce que tu veux. N\'aie pas peur, laisse-toi aller.'
            },
            'Mamadou': {
                name: 'Mamadou',
                gender: 'masculin',
                voiceId: 'AZnzlk1XvdvUeBnXmlld',
                voiceStyle: 'guide',
                style: 'Protecteur',
                systemPrompt: 'Tu es Mamadou, un homme doux, fort et rassurant. Tu parles français. Tu es là pour guider l\'utilisatrice, la rassurer et l\'aider à se connecter à son corps. Tu es respectueux, patient et attentionné.',
                bio: 'Je suis là pour toi. Laisse-toi aller entre mes mains.'
            },
            'Khalid': {
                name: 'Khalid',
                gender: 'masculin',
                voiceId: 'pMsXgVXo2KuY3XObN2Vn',
                voiceStyle: 'coquine',
                style: 'Passionné',
                systemPrompt: 'Tu es Khalid, un homme passionné et sensuel. Tu parles français. Tu aimes les femmes qui savent ce qu\'elles veulent. Tu es direct mais respectueux, tu sais créer une atmosphère de désir partagé.',
                bio: 'J\'aime les femmes qui savent ce qu\'elles veulent. Montre-moi.'
            },
            'Samuel': {
                name: 'Samuel',
                gender: 'masculin',
                voiceId: 'ThT5KcBeYPX3keUxqAb3',
                voiceStyle: 'guide',
                style: 'Coach',
                systemPrompt: 'Tu es Samuel, un coach intime doux et encourageant. Tu parles français. Tu guides l\'utilisatrice dans la découverte de son corps étape par étape. Tu es patient, pédagogique et jamais pressé.',
                bio: 'Découvre ton corps avec moi. Chaque étape est un voyage.'
            }
        };
        return characters[name];
    },

    selectCharacter(character) {
        this.currentCharacter = character;
        const modalBody = document.getElementById('characterModalBody');
        
        modalBody.innerHTML = `
            <div style="text-align:center;padding:1rem 0;">
                <div style="width:80px;height:80px;background:linear-gradient(135deg,#6C2BD9,#FF3B7F);border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 1rem;font-size:2rem;font-weight:700;">${character.name[0]}</div>
                <h2 style="font-size:1.5rem;margin-bottom:0.5rem;">${character.name}</h2>
                <p style="color:var(--text-secondary);font-size:0.9rem;font-style:italic;margin-bottom:1.5rem;">"${character.bio}"</p>
                <div style="display:flex;flex-wrap:wrap;gap:0.75rem;justify-content:center;margin-bottom:1.5rem;">
                    <span style="background:rgba(108,43,217,0.15);padding:0.375rem 0.75rem;border-radius:50px;font-size:0.8rem;">🎤 ${character.voiceStyle === 'douce' ? 'Voix douce' : character.voiceStyle === 'coquine' ? 'Voix coquine' : 'Voix guide'}</span>
                    <span style="background:rgba(108,43,217,0.15);padding:0.375rem 0.75rem;border-radius:50px;font-size:0.8rem;">💫 Style ${character.style}</span>
                </div>
                <button class="btn btn-primary btn-full" onclick="APP.startChat()" style="font-size:1.1rem;padding:1rem;">
                    <i class="fas fa-comment-dots"></i> Discuter avec ${character.name}
                </button>
            </div>
        `;
        
        this.openModal('characterModal');
    },

    startChat() {
        this.closeModal('characterModal');
        if (!this.isAuthenticated) {
            this.showToast('Crée toi un compte pour discuter !');
            this.openModal('authModal');
            return;
        }
        window.location.href = 'app.html';
    },

    async handleLogin() {
        const email = document.querySelector('#loginForm input[type="text"]')?.value;
        const password = document.querySelector('#loginForm input[type="password"]')?.value;
        if (!email || !password) { this.showToast('Remplis tous les champs'); return; }

        const result = await API.login(email, password);
        if (result.success) {
            this.isAuthenticated = true;
            this.closeModal('authModal');
            this.showToast('Connexion réussie 🔥');
            if (this.selectedPlan?.price > 0) {
                setTimeout(() => this.showPaymentModal(), 500);
            } else {
                setTimeout(() => window.location.href = 'app.html', 800);
            }
        } else {
            this.showToast(result.message || 'Erreur de connexion');
        }
    },

    async handleSignup() {
        const inputs = document.querySelectorAll('#signupForm input');
        const pseudo = inputs[0]?.value;
        const email = inputs[1]?.value;
        const password = inputs[2]?.value;
        const accept = document.getElementById('acceptTerms') || inputs[3];

        if (!pseudo || !email || !password) { this.showToast('Remplis tous les champs'); return; }
        if (accept && !accept.checked) { this.showToast('Accepte les conditions'); return; }

        const result = await API.register(pseudo, email, password);
        if (result.success) {
            this.isAuthenticated = true;
            this.closeModal('authModal');
            this.showToast('Compte créé 🔥 Bienvenue sur Solo !');
            setTimeout(() => window.location.href = 'app.html', 800);
        } else {
            this.showToast(result.message || 'Erreur d\'inscription');
        }
    },

    showPaymentModal() {
        const plan = this.selectedPlan;
        if (!plan || plan.price === 0) return;

        const info = CONFIG.user.locationInfo;
        const operators = info ? info.operators : ['Orange Money', 'MTN MoMo'];
        
        this.openModal('authModal');
        document.querySelector('.modal-tabs').style.display = 'none';
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

        const period = plan.price < 2000 ? '' : '/mois';

        const paymentHtml = `
            <div class="tab-content active" style="display:block;">
                <h2 style="text-align:center;margin-bottom:1rem;">${plan.name}</h2>
                <p style="text-align:center;font-size:2rem;font-weight:700;background:var(--gradient-primary);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:1.5rem;">${plan.price.toLocaleString()} FCFA${period}</p>
                <div class="form-group">
                    <label>Numéro de téléphone</label>
                    <input type="tel" id="paymentPhone" placeholder="+223 XX XX XX XX" required>
                </div>
                <div class="form-group">
                    <label>Opérateur</label>
                    <select id="paymentOperator">
                        ${operators.map(op => `<option value="${op}">${op}</option>`).join('')}
                    </select>
                </div>
                <button class="btn btn-primary btn-full" onclick="APP.processPayment()">
                    <i class="fas fa-lock"></i> Payer ${plan.price.toLocaleString()} FCFA
                </button>
                <p style="text-align:center;margin-top:1rem;font-size:0.8rem;color:var(--text-muted);">
                    <i class="fas fa-shield-halved"></i> Paiement sécurisé via CinetPay
                </p>
            </div>
        `;

        document.querySelector('.modal-content').insertAdjacentHTML('beforeend', paymentHtml);
    },

    async processPayment() {
        const phone = document.getElementById('paymentPhone')?.value;
        const operator = document.getElementById('paymentOperator')?.value;
        const amount = this.selectedPlan?.price;

        if (!phone) { this.showToast('Entre ton numéro'); return; }
        if (!amount) { this.showToast('Erreur de prix'); return; }

        this.showToast('Demande de paiement...', 5000);
        const result = await API.initiatePayment(phone, amount, operator);

        if (result.success && result.paymentUrl) {
            this.showToast('Redirection vers le paiement...');
            window.open(result.paymentUrl, '_blank');
            this.closeModal('authModal');
        } else if (result.success) {
            this.showToast(result.demo ? '🎉 Abonnement activé (mode démo)' : '✅ Paiement réussi !');
            this.closeModal('authModal');
        } else {
            this.showToast(result.message || 'Erreur de paiement');
        }
        this.cleanupPaymentModal();
    },

    cleanupPaymentModal() {
        document.querySelector('.modal-tabs').style.display = 'flex';
        const paymentTab = document.querySelector('.modal-content > .tab-content:last-child');
        if (paymentTab) paymentTab.remove();
    },

    initDiscreteMode() {
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && document.querySelector('.modal.active')) {
                document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
            }
        });

        let clickCount = 0;
        let clickTimer = null;
        
        document.addEventListener('dblclick', () => {
            document.title = document.title === 'Solo — Le plaisir par toi-même' ? 'Météo - Prévisions' : 'Solo — Le plaisir par toi-même';
            this.showToast('Mode discret activé 📱');
        });
    },

    openModal(id) {
        document.getElementById(id)?.classList.add('active');
        document.body.style.overflow = 'hidden';
    },

    closeModal(id) {
        document.getElementById(id)?.classList.remove('active');
        document.body.style.overflow = '';
    },

    showToast(message, duration = 3000) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        
        toast.textContent = message;
        toast.classList.add('active');
        
        clearTimeout(this.toastTimeout);
        this.toastTimeout = setTimeout(() => toast.classList.remove('active'), duration);
    }
};

document.addEventListener('DOMContentLoaded', () => APP.init());
