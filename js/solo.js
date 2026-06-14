const B = {
    token: null,
    user: null,
    profiles: [],
    matches: [],
    currentMatch: null,
    swipeProfiles: [],
    swipeIndex: 0,
    dailyLikes: 0,
    photoUrls: [],
    pollInterval: null,
    sseSource: null,
    browseMode: 'profiles',
    typingInterval: null,
    lastSwipedEmail: null,
    profilesOffset: 0,
    profilesHasMore: true,
    autoRefreshInterval: null,

    async safeFetch(url, opts) {
        opts = opts || {};
        var maxRetries = opts.retries || 3;
        var timeout = opts.timeout || 15000;
        for (var i = 0; i < maxRetries; i++) {
            var ctrl = new AbortController();
            var timer = setTimeout(function() { ctrl.abort(); }, timeout);
            try {
                var r = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal }));
                clearTimeout(timer);
                return { ok: true, resp: r };
            } catch (e) {
                clearTimeout(timer);
                if (i === maxRetries - 1) return { ok: false, error: e.name === 'AbortError' ? 'Timeout' : e.message };
                await new Promise(function(resolve) { setTimeout(resolve, 1000 * (i + 1)); });
            }
        }
    },

    init() {
        var self = this;
        // PWA Install prompt
        window.addEventListener('beforeinstallprompt', function(e) {
            e.preventDefault();
            self.deferredPrompt = e;
            var banner = document.getElementById('pwaInstallBanner');
            if (banner && !localStorage.getItem('pwa_dismissed')) banner.style.display = 'flex';
        });
        window.addEventListener('appinstalled', function() {
            var banner = document.getElementById('pwaInstallBanner');
            if (banner) banner.style.display = 'none';
            localStorage.setItem('pwa_installed', '1');
        });
        window.addEventListener('online', function() {
            var banner = document.getElementById('offlineBanner');
            if (banner) banner.style.display = 'none';
            self.toast('✅ Connexion rétablie');
            if (self.token) self.loadProfiles();
        });
        window.addEventListener('offline', function() {
            var banner = document.getElementById('offlineBanner');
            if (banner) banner.style.display = 'block';
        });
        const saved = localStorage.getItem('solo_token') || sessionStorage.getItem('solo_token');
        if (saved) { this.token = saved; this.loadMain(); return; }
        i18n.load(localStorage.getItem('solo_lang') || 'fr').then(function() { i18n.initSwitcher(); });
        document.getElementById('loginForm').addEventListener('submit', function(e) { e.preventDefault(); B.login(); });
        document.querySelectorAll('.tab').forEach(function(t) {
            t.addEventListener('click', function() {
                document.querySelectorAll('.tab').forEach(function(x) { x.classList.remove('active'); });
                t.classList.add('active');
                var isLogin = t.dataset.tab === 'login';
                document.getElementById('loginForm').style.display = isLogin ? 'block' : 'none';
                document.getElementById('registerContainer').style.display = isLogin ? 'none' : 'block';
                if (!isLogin) { document.querySelectorAll('.step').forEach(function(s,i){s.style.display=i===0?'block':'none'}); document.getElementById('progressFill').style.width='25%'; self.smsVerified=false; document.getElementById('smsCodeSection').style.display='none'; document.getElementById('regSubmit').style.display='block'; }
            });
        });
        const prefixMap = { ML:'+223',CI:'+225',SN:'+221',BF:'+226',GN:'+224',CM:'+237',BJ:'+229',TG:'+228',NE:'+227',TD:'+235' };
        document.getElementById('regCountry').addEventListener('change', function() {
            const p = prefixMap[this.value] || '+223';
            document.getElementById('phonePrefix').textContent = p;
            var phoneInput = document.getElementById('regPhone');
            phoneInput.dataset.country = this.value;
            if (phoneInput) phoneInput.focus();
        });
        document.getElementById('regCountry').dispatchEvent(new Event('change'));
        if (navigator.language) {
            var lang = navigator.language || navigator.userLanguage || '';
            if (lang.includes('fr')) { /* keep ML default */ }
            else if (lang.includes('en')) { /* could default to Nigeria/Ghana */ }
        }
        try {
            var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
            var tzMap = {'Africa/Bamako':'ML','Africa/Abidjan':'CI','Africa/Dakar':'SN','Africa/Ouagadougou':'BF','Africa/Conakry':'GN','Africa/Douala':'CM','Africa/Porto-Novo':'BJ','Africa/Lome':'TG','Africa/Niamey':'NE','Africa/Ndjamena':'TD','Africa/Cairo':'EG','Africa/Casablanca':'MA','Africa/Tunis':'TN','Africa/Algiers':'DZ','Africa/Maputo':'MZ','Africa/Lagos':'NG','Africa/Accra':'GH','Africa/Nairobi':'KE'};
            if (tzMap[tz]) { document.getElementById('regCountry').value = tzMap[tz]; document.getElementById('regCountry').dispatchEvent(new Event('change')); }
        } catch(e) {}
    },

    nextStep(current) {
        if (current === 1) { if (!this.smsVerified) { this.showErr('📱 Confirme d\'abord ton numéro'); return; } }
        if (current === 2) { if (!this.validateStep2()) return; }
        if (current === 3) { if (!this.validateStep3()) return; }
        document.querySelectorAll('.step').forEach(function(s) { s.style.display = 'none'; });
        var next = document.getElementById('step' + (current + 1));
        if (next) { next.style.display = 'block'; next.classList.add('slide-in-right'); }
        document.getElementById('progressFill').style.width = (current + 1) * 25 + '%';
    },

    prevStep(current) {
        document.querySelectorAll('.step').forEach(function(s) { s.style.display = 'none'; });
        var prev = document.getElementById('step' + (current));
        if (prev) { prev.style.display = 'block'; prev.classList.add('slide-in-left'); }
        document.getElementById('progressFill').style.width = current * 25 + '%';
    },

    validateStep2() {
        var pseudo = document.getElementById('regPseudo').value.trim();
        if (!pseudo) { this.showErr('Choisis un pseudo'); return false; }
        this.showErr(''); return true;
    },

    validateStep3() {
        var age = document.getElementById('regAge').value;
        var gender = document.getElementById('regGender').value;
        var pwd = document.getElementById('regPassword').value;
        if (!age || age < 18) { this.showErr('Âge requis (18+)'); return false; }
        if (!gender) { this.showErr('Choisis ton genre'); return false; }
        if (!pwd || pwd.length < 6) { this.showErr('Mot de passe (6+ caractères)'); return false; }
        this.showErr(''); return true;
    },

    async login() {
        this.showErr('');
        var btn = document.getElementById('loginSubmit');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner"></span> Connexion...';
        var r = await this.safeFetch('/api/solo/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: document.getElementById('loginField').value.trim(), password: document.getElementById('loginPassword').value }), timeout: 20000 });
        btn.disabled = false;
        btn.textContent = 'Se connecter';
        if (!r.ok) {
            if (r.error === 'Timeout') this.showErr('Le serveur est lent, réessaie...');
            else if (r.error === 'Failed to fetch') this.showErr('Pas de connexion internet');
            else this.showErr('Erreur: ' + r.error);
            return;
        }
        var d = await r.resp.json();
        if (!d.success) return this.showErr(d.message);
        this.setToken(d.token);
        this.loadMain();
    },

    async registerStep1() {
        this.showErr('');
        var btn = document.getElementById('regSubmit');
        if (!btn) return;
        var prefixEl = document.getElementById('phonePrefix');
        var phoneRaw = document.getElementById('regPhone').value.trim().replace(/[^0-9]/g, '');
        var prefix = prefixEl.textContent.trim() || '+223';
        var fullPhone = prefix + phoneRaw;
        if (!phoneRaw || phoneRaw.length < 7) { this.showErr('📱 Numéro invalide'); return; }
        this.toast('📡 Envoi du code...');
        btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Envoi...';
        var r = await this.safeFetch('/api/solo/verify/sms-send', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: fullPhone }), timeout: 15000 });
        btn.disabled = false; btn.innerHTML = 'Recevoir le code →';
        if (!r.ok) { this.showErr('Erreur réseau'); return; }
        var d = await r.resp.json();
        if (!d.success) { this.showErr(d.message); return; }
        this.fullPhone = fullPhone; this.smsCountry = document.getElementById('regPhone').dataset.country || 'ML';
        document.getElementById('smsCodeSection').style.display = 'block';
        document.getElementById('regSubmit').style.display = 'none';
        setTimeout(function() { var el = document.getElementById('regSmsCode'); if (el) el.focus(); }, 300);
    },

    resendSmsCode() { this.registerStep1(); },

    async confirmSmsAndGoStep2() {
        this.showErr('');
        var code = document.getElementById('regSmsCode').value.trim();
        if (code.length < 4) { this.toast('Code incomplet'); return; }
        var r = await this.safeFetch('/api/solo/verify/sms-confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: this.fullPhone, code: code }), timeout: 10000 });
        if (!r.ok) { this.showErr('Erreur réseau'); return; }
        var d = await r.resp.json();
        if (!d.success) { this.showErr(d.message); return; }
        this.smsVerified = true;
        this.nextStep(1);
    },

    previewStep4Photo(e) {
        var file = e.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) { document.getElementById('step4Placeholder').style.display = 'none'; var img = document.getElementById('step4Preview'); img.src = ev.target.result; img.style.display = 'block'; document.getElementById('step4Photo').setAttribute('data-photo', ev.target.result); };
        reader.readAsDataURL(file);
    },

    skipStep4() { this.finalizeRegistration(); },
    submitStep4() { this.finalizeRegistration(); },

    async finalizeRegistration() {
        this.showErr('');
        if (!this.fullPhone) { this.toast('⚠️ Entre d\'abord ton numéro'); return; }
        if (!this.smsVerified) { this.toast('⚠️ Vérifie d\'abord ton numéro par SMS'); return; }
        var photoData = document.getElementById('step4Photo').getAttribute('data-photo') || '';
        var photoUrl = '';
        if (photoData) {
            if (!this.token) this.token = 'temp';
            var r = await this.safeFetch('/api/solo/upload-photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: photoData }), timeout: 15000 });
            if (r.ok) { var d = await r.resp.json(); if (d.success) photoUrl = d.url; }
        }
        var body = JSON.stringify({
            pseudo: document.getElementById('regPseudo').value.trim(),
            prenom: (document.getElementById('regPrenom')?.value || '').trim(), password: document.getElementById('regPassword').value,
            phone: this.fullPhone, country: document.getElementById('regPhone').dataset.country || 'ML',
            email: (document.getElementById('regEmail').value || '').trim(), gender: document.getElementById('regGender').value,
            age: parseInt(document.getElementById('regAge').value) || 25, photos: photoUrl ? [photoUrl] : [], verified: true
        });
        var r2 = await this.safeFetch('/api/solo/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, timeout: 30000 });
        if (!r2.ok) { this.showErr('Erreur réseau'); return; }
        var d2 = await r2.resp.json();
        if (!d2.success) { this.showErr(d2.message); return; }
        this.setToken(d2.token); this.loadMain();
    },

    setToken(t) { this.token = t; localStorage.setItem('solo_token', t); sessionStorage.setItem('solo_token', t); },
    showErr(msg) { const el = document.getElementById('authError'); if (el) el.textContent = msg || ''; },

    async loadMain() {
        document.getElementById('soloLogin').style.display = 'none';
        document.getElementById('soloMain').style.display = 'block';
        await this.loadUser();
        this.bindEvents();
        this.loadUnreadCount();
        this.subscribePush();
        this.startAutoRefresh();
        this.initSwipe();
        const visited = localStorage.getItem('solo_visited');
        if (!visited) {
            localStorage.setItem('solo_visited', '1');
            setTimeout(() => this.toast('👋 Bienvenue ! Complète ton profil pour attirer plus de matchs'), 500);
        }
    },

    saveGeoLocation() {
        if (!navigator.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            async (pos) => {
                var lat = pos.coords.latitude;
                var lng = pos.coords.longitude;
                await this.safeFetch('/api/solo/location', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token },
                    body: JSON.stringify({ lat: lat, lng: lng })
                });
            },
            function(err) { console.warn('Geolocation denied:', err.message); },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        );
    },

    async loadUser() {
        var r = await this.safeFetch('/api/solo/me', { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) {
            var cached = localStorage.getItem('solo_user_cache');
            if (cached) {
                try { this.user = JSON.parse(cached); this.populateUserUI(); } catch(e) {}
                if (!navigator.onLine) this.toast('📡 Mode hors ligne — données en cache');
            }
            return;
        }
        var d = await r.resp.json();
        if (!d.success) {
            // Token expired or invalid
            if (d.message && d.message.toLowerCase().includes('expir')) {
                localStorage.removeItem('solo_token');
                sessionStorage.removeItem('solo_token');
                location.reload();
            }
            return;
        }
        this.user = d.user;
        localStorage.setItem('solo_user_cache', JSON.stringify(d.user));
        this.populateUserUI();
    },

    populateUserUI() {
        var u = this.user;
        if (!u) return;
        document.getElementById('userPlan').textContent = u.plan === 'free' ? 'Gratuit' : u.plan;
        document.getElementById('profilePseudo').textContent = u.prenom || u.pseudo || '-';
        var avatarEl = document.getElementById('profileAvatar');
        var name = u.pseudo || '?';
        if (u.photos && u.photos.length > 0) { avatarEl.innerHTML = '<img src="' + this.esc(u.photos[0]) + '" alt="avatar">'; }
        else { avatarEl.innerHTML = '<img src="' + this.avatarUrl(name, []) + '" alt="avatar" style="width:100%;height:100%;object-fit:cover">'; }
        var badgesEl = document.querySelector('.profile-badges');
        if (badgesEl) {
            var badges = '<span class="badge badge-new">Nouveau</span>';
            if (u.verified) badges += '<span class="badge badge-verified">✓ Vérifié</span>';
            if (u.plan !== 'free') badges += '<span class="badge badge-vip">VIP</span>';
            badgesEl.innerHTML = badges;
        }
        document.getElementById('editPseudo').value = u.pseudo || '';
        var editPrenom = document.getElementById('editPrenom');
        if (editPrenom) editPrenom.value = u.prenom || '';
        document.getElementById('editProfession').value = u.profession || '';
        document.getElementById('editLooking').value = u.looking_for || '';
        document.getElementById('editInterests').value = (u.interests || []).join(', ');
        document.getElementById('editAge').value = u.age || '';
        document.getElementById('editCountry').value = u.country || 'ML';
        document.getElementById('editCity').value = u.city || '';
        document.getElementById('editBio').value = u.bio || '';
        document.getElementById('editStatus').value = u.status || '';
        document.getElementById('editReligion').value = u.religion || '';
        document.getElementById('editChildren').value = u.children || '';
        this.photoUrls = (u.photos || []).slice();
        this.loadProfileStats();
        document.getElementById('editPhotosPrivate').checked = localStorage.getItem('solo_photos_private') === '1';
        var verifyStatus = document.getElementById('verifyStatus');
        if (verifyStatus) {
            verifyStatus.textContent = u.verified ? '✅ Profil vérifié' : '';
        }
        this.renderPhotoPreviews();
        this.updatePhotoCounter();
        this.updateScore();
    },

    renderPhotoPreviews() {
        const container = document.getElementById('photosPreview');
        container.innerHTML = this.photoUrls.map((url, i) => `
            <div class="photo-thumb" style="background-image:url('${url}')">
                <button class="remove-photo" onclick="B.removePhoto(${i})">✕</button>
            </div>
        `).join('');
    },

    removePhoto(index) {
        this.photoUrls.splice(index, 1);
        this.renderPhotoPreviews();
        this.updatePhotoCounter();
    },

    updatePhotoCounter() {
        const el = document.getElementById('photoCounter');
        if (el) { el.textContent = this.photoUrls.length + '/5'; el.classList.toggle('full', this.photoUrls.length >= 5); }
    },

    async loadProfileStats() {
        var email = this.user?.email;
        if (!email) return;
        var r = await this.safeFetch('/api/solo/likes-received', { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (r.ok) {
            var d = await r.resp.json();
            var el = document.getElementById('statLikes');
            if (el) el.textContent = (d.likes || []).length;
        }
        r = await this.safeFetch('/api/solo/matches', { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (r.ok) {
            var d2 = await r.resp.json();
            var el2 = document.getElementById('statMatches');
            if (el2) el2.textContent = (d2.matches || []).length;
        }
    },

    async uploadPhotos() {
        const files = document.getElementById('photoInput').files;
        const remaining = 5 - this.photoUrls.length;
        if (remaining <= 0) { this.toast('⚠️ Maximum 5 photos atteint'); document.getElementById('photoInput').value = ''; return; }
        const toUpload = Array.from(files).slice(0, remaining);
        for (const file of toUpload) {
            const compressed = await this.compressImage(file);
            const reader = new FileReader();
            await new Promise(resolve => {
                reader.onload = async () => {
                    const r = await fetch('/api/solo/upload-photo', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                        body: JSON.stringify({ image: reader.result })
                    });
                    const d = await r.json();
                    if (d.success) { this.photoUrls.push(d.url); this.renderPhotoPreviews(); }
                    resolve();
                };
                reader.readAsDataURL(compressed);
            });
        }
        document.getElementById('photoInput').value = '';
        this.updatePhotoCounter();
    },

    compressImage(file, maxWidth, quality) {
        maxWidth = maxWidth || 800;
        quality = quality || 0.8;
        return new Promise(function(resolve) {
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            var img = new Image();
            img.onload = function() {
                var w = img.width, h = img.height;
                if (w > maxWidth) { h = Math.round(h * maxWidth / w); w = maxWidth; }
                canvas.width = w;
                canvas.height = h;
                ctx.drawImage(img, 0, 0, w, h);
                canvas.toBlob(function(blob) {
                    resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
                }, 'image/jpeg', quality);
            };
            img.src = URL.createObjectURL(file);
        });
    },

    updateScore() {
        let pts = 10;
        if (this.user.pseudo) pts += 10;
        if (this.user.profession) pts += 15;
        if (this.user.looking_for) pts += 15;
        if (this.user.interests && this.user.interests.length > 0) pts += 10;
        if (this.user.bio) pts += 15;
        if (this.user.city) pts += 10;
        if (this.user.photos && this.user.photos.length > 0) pts += 15;
        document.getElementById('scoreValue').textContent = pts;
    },

    bindEvents() {
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('addPhotoBtn')?.addEventListener('click', function() { document.getElementById('photoInput').click(); });
        document.getElementById('deleteAccountBtn')?.addEventListener('click', function() { B.deleteAccount(); });
        document.getElementById('deleteChatBtn')?.addEventListener('click', function() { B.deleteConversation(); });
        document.getElementById('swipeLike')?.addEventListener('click', () => this.swipeAction(true));
        document.getElementById('swipePass')?.addEventListener('click', () => this.swipeAction(false));
        document.getElementById('swipeSuper')?.addEventListener('click', () => this.swipeAction(true, true));
        document.getElementById('swipeUndo')?.addEventListener('click', () => this.undoSwipe());
        document.getElementById('matchChatBtn')?.addEventListener('click', () => { document.getElementById('matchOverlay').style.display = 'none'; document.querySelector('.tab-btn[data-page="chat"]').click(); });
        document.getElementById('matchCloseBtn')?.addEventListener('click', () => document.getElementById('matchOverlay').style.display = 'none');
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                var pageId = 'page' + btn.dataset.page.charAt(0).toUpperCase() + btn.dataset.page.slice(1);
                var page = document.getElementById(pageId);
                if (page) page.classList.add('active');
                if (btn.dataset.page === 'browse') { this.initSwipe(); this.hideSwipeFilters(); }
                if (btn.dataset.page === 'matches') this.loadMatches();
                if (btn.dataset.page === 'annonces') this.loadAnnonces();
            });
        });
        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.browseMode = btn.dataset.mode;
                document.getElementById('browseProfiles').style.display = this.browseMode === 'profiles' ? 'block' : 'none';
                document.getElementById('browseAnnonces').style.display = this.browseMode === 'annonces' ? 'block' : 'none';
                if (this.browseMode === 'annonces') this.loadAnnonces();
            });
        });
        document.getElementById('createAnnonceBtn')?.addEventListener('click', () => this.openCreateAnnonceModal());
        document.getElementById('annonceFilterCountry')?.addEventListener('change', () => this.loadAnnonces());
        document.getElementById('annonceFilterGender')?.addEventListener('change', () => this.loadAnnonces());
        document.getElementById('annonceFilterCategory')?.addEventListener('change', () => this.loadAnnonces());
        document.getElementById('filterGender').addEventListener('change', () => this.loadProfiles());
        document.getElementById('filterCountry').addEventListener('change', () => this.loadProfiles());
        document.getElementById('filterAgeMin').addEventListener('change', () => this.loadProfiles());
        document.getElementById('filterAgeMax').addEventListener('change', () => this.loadProfiles());
        document.getElementById('filterDistance')?.addEventListener('input', function() { document.getElementById('distanceValue').textContent = this.value; });
        document.getElementById('filterDistance')?.addEventListener('change', () => this.loadProfiles());
        document.getElementById('saveProfileBtn').addEventListener('click', () => this.saveProfile());
        document.getElementById('sendChatBtn').addEventListener('click', () => this.sendMessage());
        document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') this.sendMessage(); });
        this.startChatPoll();
    },

    logout() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        if (this.typingInterval) clearInterval(this.typingInterval);
        if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
        if (this.sseSource) { try { this.sseSource.close(); } catch(e) {} }
        this.pollInterval = null; this.typingInterval = null; this.autoRefreshInterval = null; this.sseSource = null;
        this.sseRetries = 0;
        localStorage.removeItem('solo_token'); sessionStorage.removeItem('solo_token');
        localStorage.removeItem('solo_user_cache');
        location.reload(); },

    async loadProfiles() {
        this.profilesOffset = 0;
        this.profilesHasMore = true;
        const params = new URLSearchParams();
        const g = document.getElementById('filterGender').value;
        const c = document.getElementById('filterCountry').value;
        const min = document.getElementById('filterAgeMin').value;
        const max = document.getElementById('filterAgeMax').value;
        const dist = document.getElementById('filterDistance')?.value;
        if (g) params.set('gender', g);
        if (c) params.set('country', c);
        if (min) params.set('ageMin', min);
        if (max) params.set('ageMax', max);
        if (dist && dist < 500) params.set('maxDistance', dist);
        params.set('limit', 20);
        var r = await this.safeFetch('/api/solo/profiles?' + params, { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return;
        var d = await r.resp.json();
        this.profilesHasMore = d.hasMore;
        var blocked = JSON.parse(localStorage.getItem('solo_blocked') || '[]');
        this.profiles = (d.profiles || []).filter(p => !blocked.includes(p.email));
        this.renderProfiles();
        this.setupInfiniteScroll();
    },

    setupInfiniteScroll() {
        var self = this;
        var grid = document.getElementById('profilesGrid');
        if (!grid) return;
        var observer = new IntersectionObserver(function(entries) {
            if (entries[0].isIntersecting && self.profilesHasMore) {
                self.loadMoreProfiles();
            }
        }, { threshold: 0.1 });
        var sentinel = document.getElementById('scrollSentinel');
        if (!sentinel) {
            sentinel = document.createElement('div');
            sentinel.id = 'scrollSentinel';
            sentinel.style.height = '1px';
            grid.parentNode.appendChild(sentinel);
        }
        observer.observe(sentinel);
    },

    renderProfiles() {
        const grid = document.getElementById('profilesGrid');
        if (!this.profiles.length) { grid.innerHTML = '<p style="text-align:center;color:#666;padding:2rem">Aucun profil trouvé</p>'; return; }
        grid.innerHTML = this.profiles.map(p => {
            const photos = Array.isArray(p.photos) ? p.photos : typeof p.photos === 'string' ? p.photos.split(',').map(s => s.trim()).filter(s => s) : [];
            const carousel = photos.length > 0
                ? `<div class="photo-carousel" data-photos='${this.esc(JSON.stringify(photos))}'>
                     <div class="carousel-track">${photos.map(u => `<img src="${this.esc(u)}" onerror="this.style.display='none'" loading="lazy">`).join('')}</div>
                     <div class="carousel-dots">${photos.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>
                   </div>`
                : `<div class="no-photo"><img src="${this.avatarUrl(p.prenom || p.pseudo, [])}" alt="${this.esc(p.pseudo)}" style="width:100%;height:380px;object-fit:cover"></div>`;
            return `<div class="profile-card" data-email="${this.esc(p.email)}" onclick="B.showProfile('${this.esc(p.email)}')">
                ${p.isOnline ? '<div class="card-online"></div>' : ''}
                ${carousel}
                <div class="card-overlay">
                    <div class="card-info">
                        <div class="card-name">${this.esc(p.prenom || p.pseudo)}, ${p.age || '?'}${p.verified ? '<span class="card-verified">✓</span>' : ''}</div>
                        <div class="card-sub">${p.distanceKm != null ? '📍 '+p.distanceKm+' km' : ''}${p.country ? ' · '+p.country : ''}</div>
                    </div>
                    <button class="card-like" onclick="event.stopPropagation();B.like('${this.esc(p.email)}')">❤️</button>
                </div>
            </div>`;
        }).join('');
        this.initCarousels();
    },

    initCarousels() {
        document.querySelectorAll('.photo-carousel').forEach(carousel => {
            const photos = JSON.parse(carousel.dataset.photos);
            if (photos.length <= 1) return;
            let current = 0;
            const track = carousel.querySelector('.carousel-track');
            const dots = carousel.querySelectorAll('.dot');
            let startX = 0, dragging = false;
            carousel.addEventListener('touchstart', e => { startX = e.touches[0].clientX; dragging = true; }, { passive: true });
            carousel.addEventListener('touchmove', e => {
                if (!dragging) return;
                const diff = e.touches[0].clientX - startX;
                const offset = -current * 100 + (diff / carousel.offsetWidth * 100);
                track.style.transition = 'none';
                track.style.transform = `translateX(${offset}%)`;
            }, { passive: true });
            carousel.addEventListener('touchend', e => {
                dragging = false;
                const diff = startX - e.changedTouches[0].clientX;
                track.style.transition = 'transform .3s ease';
                if (Math.abs(diff) > 50) {
                    if (diff > 0 && current < photos.length - 1) current++;
                    else if (diff < 0 && current > 0) current--;
                }
                track.style.transform = `translateX(-${current * 100}%)`;
                dots.forEach((d, i) => d.classList.toggle('active', i === current));
            });
        });
    },

    showProfile(email) {
        const p = this.profiles.find(x => x.email === email);
        if (!p) return;
        const photos = Array.isArray(p.photos) ? p.photos : [];
        const onlineStatus = p.isOnline ? '<span style="color:#4caf50;font-size:.8rem">🟢 En ligne</span>' : '';
        const carousel = photos.length > 0
            ? `<div class="photo-carousel" data-photos='${this.esc(JSON.stringify(photos))}'>
                 <div class="carousel-track">${photos.map(u => `<img src="${this.esc(u)}" onerror="this.style.display='none'" loading="lazy">`).join('')}</div>
                 <div class="carousel-dots">${photos.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>
               </div>`
            : '';
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-detail">
            ${carousel}
            <div class="detail-info">
                <div class="detail-name">${this.esc(p.prenom || p.pseudo)}, ${p.age || '?'} ${p.verified ? '<span class="verified-badge">✓</span>' : ''} ${onlineStatus}</div>
                <div class="detail-meta">${this.esc(p.gender)} · ${p.profession ? this.esc(p.profession) + ' · ' : ''}${this.esc(p.city || '')} ${this.esc(p.country || '')}</div>
                ${p.looking_for === 'Mariage' ? '<div style="color:#ffd700;font-size:.85rem;margin:.3rem 0">💍 Cherche le mariage</div>' : ''}
                ${p.looking_for ? `<div style="color:#ff3b3b;font-size:.85rem;margin:.3rem 0">❤️ ${this.esc(p.looking_for)}</div>` : ''}
                ${p.interests && p.interests.length > 0 ? `<div style="color:#999;font-size:.75rem;margin:.3rem 0">🏷️ ${p.interests.map(i => this.esc(i)).join(', ')}</div>` : ''}
                ${p.bio ? `<div class="detail-bio">${this.esc(p.bio)}</div>` : ''}
                <div class="detail-actions">
                    <button class="btn-like" onclick="B.like('${this.esc(p.email)}');document.querySelector('.modal-overlay').remove()">❤️ J'aime</button>
                    <button class="btn-close-detail" onclick="this.closest('.modal-overlay').remove()">Fermer</button>
                    <button class="btn-block" onclick="B.blockUser('${this.esc(p.email)}');document.querySelector('.modal-overlay').remove()" title="Bloquer">🚫</button>
                    <button class="btn-report" onclick="B.openReportModal('${this.esc(p.email)}');document.querySelector('.modal-overlay').remove()" title="Signaler">🚩</button>
                </div>
            </div>
        </div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
        this.initCarousels();
    },

    async like(targetEmail) {
        var r = await this.safeFetch('/api/solo/like', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token }, body: JSON.stringify({ targetEmail }), timeout: 8000 });
        if (!r.ok) return this.toast('Erreur réseau');
        var d = await r.resp.json();
        var btns = document.querySelectorAll('[data-email="' + targetEmail + '"] .btn-like, .detail-actions .btn-like');
        btns.forEach(function(b) { b.classList.add('liked'); b.textContent = '❤️ Liké'; });
        if (d.matched) {
            this.toast('💘 Match ! Allez dans Chat pour discuter');
            this.loadMatches();
        } else {
            this.toast('❤️ Like envoyé');
        }
    },

    async loadMatches() {
        const r = await fetch('/api/solo/matches', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const d = await r.json();
        this.matches = d.matches || [];
        const list = document.getElementById('matchesList');
        if (!this.matches.length) { list.innerHTML = '<p style="text-align:center;color:#666;padding:2rem">Aucun match. Like des profils !</p>'; return; }
        list.innerHTML = this.matches.map(m => `<div class="match-item" data-match="${m.id}" data-with="${m.with}">
            <div class="match-avatar"><img src="${this.avatarUrl(m.pseudo || m.with, [])}" style="width:50px;height:50px;border-radius:50%;object-fit:cover"></div><span class="match-name">${this.esc(m.pseudo || m.with)}</span>
        </div>`).join('');
        document.querySelectorAll('.match-item').forEach(item => {
            item.addEventListener('click', () => this.openChat(item.dataset.match, item.dataset.with));
        });
    },

    async loadLikes() {
        var r = await this.safeFetch('/api/solo/likes-received', { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return;
        var d = await r.resp.json();
        var list = document.getElementById('likesList');
        if (!d.likes || !d.likes.length) { list.innerHTML = '<p style="text-align:center;color:#666;padding:2rem">Personne ne t\'a encore liké</p>'; return; }
        list.innerHTML = d.likes.map(function(l) {
            var blur = B.user.plan === 'free' ? 'filter:blur(8px)' : '';
            var name = B.user.plan === 'free' ? '?????' : (l.pseudo || '?');
            var meta = B.user.plan === 'free' ? 'Passe VIP pour voir' : (l.age + ' · ' + (l.country || ''));
            return '<div class="match-item"><div class="match-avatar" style="background:#1a1a2e;' + blur + '">👤</div><span class="match-name">' + B.esc(name) + '</span><br><span style="color:#888;font-size:.7rem">' + B.esc(meta) + '</span></div>';
        }).join('');
        document.getElementById('pageLikes').classList.add('active');
        document.querySelectorAll('.page').forEach(function(p) { if (p.id !== 'pageLikes') p.classList.remove('active'); });
    },

    openChat(matchId, withUser) {
        this.currentMatch = { id: matchId, with: withUser };
        document.getElementById('chatHeader').innerHTML = '💬 ' + this.esc(withUser) + ' <button id="deleteChatBtn" class="btn-ghost" style="float:right;font-size:.7rem" title="Supprimer" onclick="B.deleteConversation()">🗑️</button>';
        document.getElementById('chatInput').disabled = false;
        document.getElementById('sendChatBtn').disabled = false;
        document.querySelector('.tab-btn[data-page="chat"]').click();
        this.loadMessages();
        this.startSSE(matchId);
        this.startTyping(matchId);
        this.markMessagesAsRead(matchId);
        var input = document.getElementById('chatInput');
        input.oninput = function() { B.sendTypingStatus(matchId, input.value.length > 0); };
    },

    startSSE(matchId) {
        if (this.sseSource) { try { this.sseSource.close(); } catch(e) {} }
        var self = this;
        this.sseRetries = 0;
        this.sseSource = new EventSource('/api/solo/chat/stream/' + matchId + '?token=' + this.token);
        this.sseSource.onmessage = function(e) {
            if (!self.currentMatch || self.currentMatch.id !== matchId) return;
            try { self.loadMessages(); } catch(err) {}
        };
        this.sseSource.onerror = function() {
            self.sseRetries = (self.sseRetries || 0) + 1;
            if (self.sseRetries <= 5 && self.currentMatch && self.currentMatch.id === matchId) {
                setTimeout(function() { self.startSSE(matchId); }, 5000);
            }
        };
    },

    async loadMessages() {
        if (!this.currentMatch) return;
        var r = await this.safeFetch('/api/solo/messages/' + this.currentMatch.id, { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return;
        var d = await r.resp.json();
        var container = document.getElementById('chatMessages');
        container.innerHTML = (d.messages || []).map(m => {
            const isMine = m.sender === this.user.email;
            const time = (m.created_at || m.time || '').substring(11, 16) || '';
            const readStatus = isMine ? (m.read_at ? '<span class="read-receipt read">✓✓</span>' : '<span class="read-receipt">✓</span>') : '';
            const isGif = m.content.startsWith('[GIF]');
            const content = isGif ? '<img src="' + this.esc(m.content.replace('[GIF]', '')) + '" class="chat-gif" loading="lazy">' : this.esc(m.content);
            return `<div class="chat-msg ${isMine ? 'mine' : 'theirs'}">${content}<div class="chat-time ${isMine ? 'msg-time-right' : ''}">${time} ${readStatus}</div></div>`;
        }).join('');
        container.scrollTop = container.scrollHeight;
        this.markMessagesAsRead(this.currentMatch.id);
    },

    async sendMessage() {
        var input = document.getElementById('chatInput');
        var content = input.value.trim();
        if (!content || !this.currentMatch) return;
        input.value = '';
        var r = await this.safeFetch('/api/solo/message', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token }, body: JSON.stringify({ matchId: this.currentMatch.id, content }), timeout: 8000 });
        if (!r.ok) return this.toast('Erreur envoi');
        var d = await r.resp.json();
        if (d.warning) this.toast(d.warning);
        this.loadMessages();
    },

    startChatPoll() {
        if (this.pollInterval) clearInterval(this.pollInterval);
        this.pollInterval = setInterval(function() {
            if (B.currentMatch && !document.hidden) {
                if (document.getElementById('pageChat').classList.contains('active')) B.loadMessages();
            }
        }, 3000);
    },

    async saveProfile() {
        var photos = this.photoUrls;
        var photosPrivate = document.getElementById('editPhotosPrivate').checked;
        localStorage.setItem('solo_photos_private', photosPrivate ? '1' : '0');
        var interests = document.getElementById('editInterests').value.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });
        var r = await this.safeFetch('/api/solo/me', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token }, body: JSON.stringify({
                pseudo: document.getElementById('editPseudo').value.trim(),
                prenom: (document.getElementById('editPrenom')?.value || '').trim(),
                profession: document.getElementById('editProfession').value.trim(),
                looking_for: document.getElementById('editLooking').value,
                interests: interests,
                age: parseInt(document.getElementById('editAge').value),
                country: document.getElementById('editCountry').value,
                city: document.getElementById('editCity').value.trim(),
                bio: document.getElementById('editBio').value.trim(),
                status: document.getElementById('editStatus').value,
                religion: document.getElementById('editReligion').value,
                children: document.getElementById('editChildren').value,
                photos: photos
            }), timeout: 10000 });
        if (!r.ok) return this.toast('❌ Erreur réseau');
        var d = await r.resp.json();
        if (d.success) {
            this.toast('✅ Profil sauvegardé');
            this.updateScore();
            this.loadUser();
        }
        else this.toast('❌ ' + (d.message || 'Erreur'));
    },

    blockUser(email) {
        if (!confirm('Bloquer cet utilisateur ?')) return;
        const blocked = JSON.parse(localStorage.getItem('solo_blocked') || '[]');
        if (!blocked.includes(email)) { blocked.push(email); localStorage.setItem('solo_blocked', JSON.stringify(blocked)); }
        this.toast('🚫 Utilisateur bloqué');
        this.loadProfiles();
    },

    toast(msg) {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
    },

    esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); },

    avatarUrl(name, photos) {
        if (photos && photos.length > 0) return this.esc(photos[0]);
        return 'https://api.dicebear.com/7.x/initials/svg?seed=' + encodeURIComponent(name || '?') + '&backgroundColor=6b2bd7,ff3b3b,2196f3,4caf50,ff9800&textColor=ffffff';
    },

    async initSwipe() {
        this.dailyLikes = parseInt(localStorage.getItem('solo_likes_today_' + new Date().toDateString()) || '0');
        this.swipeIndex = 0;
        document.getElementById('swipeCounter').textContent = '❤️ ' + (10 - this.dailyLikes) + ' aujourd\'hui';
        const r = await fetch('/api/solo/profiles?' + new URLSearchParams({ limit: '20' }), { headers: { 'Authorization': `Bearer ${this.token}` } });
        const d = await r.json();
        this.swipeProfiles = d.profiles || [];
        this.renderSwipeCard();
        this.bindSwipeTouch();
    },

    bindSwipeTouch() {
        const card = document.getElementById('swipeCard');
        if (!card) return;
        let startX = 0, currentX = 0, dragging = false;
        card.addEventListener('touchstart', e => { startX = e.touches[0].clientX; dragging = true; }, { passive: true });
        card.addEventListener('touchmove', e => {
            if (!dragging) return;
            currentX = e.touches[0].clientX - startX;
            card.style.transform = `translateX(${currentX}px) rotate(${currentX * 0.05}deg)`;
            card.style.opacity = 1 - Math.abs(currentX) / 300;
            if (currentX > 50) card.style.boxShadow = '0 0 20px rgba(76,175,80,.5)';
            else if (currentX < -50) card.style.boxShadow = '0 0 20px rgba(255,59,59,.5)';
        }, { passive: true });
        card.addEventListener('touchend', () => {
            dragging = false;
            card.style.transform = ''; card.style.opacity = ''; card.style.boxShadow = '';
            if (currentX > 80) this.swipeAction(true);
            else if (currentX < -80) this.swipeAction(false);
            currentX = 0;
        });
    },

    renderSwipeCard() {
        const card = document.getElementById('swipeCard');
        if (this.swipeIndex >= this.swipeProfiles.length) {
            card.innerHTML = '<div class="swipe-empty"><p>🎉 Plus de profils !</p><p style="color:#888;font-size:.8rem">Reviens plus tard ou élargis tes filtres</p></div>';
            return;
        }
        const p = this.swipeProfiles[this.swipeIndex];
        const photos = Array.isArray(p.photos) ? p.photos : [];
        const carousel = photos.length > 0
            ? `<div class="photo-carousel" data-photos='${this.esc(JSON.stringify(photos))}'>
                 <div class="carousel-track">${photos.map(u => `<img src="${this.esc(u)}" onerror="this.style.display='none'" loading="lazy">`).join('')}</div>
                 <div class="carousel-dots">${photos.map((_, i) => `<span class="dot${i === 0 ? ' active' : ''}"></span>`).join('')}</div>
               </div>`
            : `<div class="swipe-photo"><img src="${this.avatarUrl(p.pseudo, [])}" alt="${this.esc(p.pseudo)}" style="width:100%;height:340px;object-fit:cover"></div>`;
        card.innerHTML = `
            <div class="swipe-photo">${carousel}</div>
            <div class="swipe-info">
                <div class="swipe-name">${this.esc(p.prenom || p.pseudo)}, ${p.age || '?'}</div>
                <div class="swipe-meta">${p.profession ? this.esc(p.profession) + ' · ' : ''}${this.esc(p.city || '')} ${this.esc(p.country || '')}</div>
                ${p.looking_for === 'Mariage' ? '<div class="swipe-looking" style="color:#ffd700">💍 Cherche le mariage</div>' : ''}
                ${p.looking_for ? `<div class="swipe-looking">❤️ ${this.esc(p.looking_for)}</div>` : ''}
                ${p.interests && p.interests.length > 0 ? `<div class="swipe-interests">${p.interests.map(x => '#' + this.esc(x)).join(' ')}</div>` : ''}
                ${p.bio ? `<div class="swipe-bio">${this.esc(p.bio)}</div>` : ''}
            </div>
        `;
        this.initCarousels();
    },

    async swipeAction(like, superLike = false) {
        const p = this.swipeProfiles[this.swipeIndex];
        if (!p) return;
        if (like && this.dailyLikes >= 10 && this.user.plan === 'free') {
            this.toast('⚠️ Limite de 10 likes/jour. Passe VIP pour plus !');
            return;
        }
        if (like) {
            this.dailyLikes++;
            localStorage.setItem('solo_likes_today_' + new Date().toDateString(), this.dailyLikes);
            document.getElementById('swipeCounter').textContent = '❤️ ' + (10 - this.dailyLikes) + ' aujourd\'hui';
            const r = await fetch('/api/solo/like', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
                body: JSON.stringify({ targetEmail: p.email })
            });
            const d = await r.json();
            if (d.matched) {
                document.getElementById('matchOverlay').style.display = 'flex';
            }
        }
        this.swipeIndex++;
        this.renderSwipeCard();
    },

    async forgotPassword() {
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'forgotModal';
        overlay.innerHTML = '<div class="modal-detail" style="max-width:360px">' +
            '<div class="detail-info" style="text-align:center">' +
                '<div style="font-size:2.5rem;margin-bottom:.5rem">🔑</div>' +
                '<h3 style="margin-bottom:.3rem">Mot de passe oublié</h3>' +
                '<p style="color:#888;font-size:.8rem;margin-bottom:1rem">Entre ton numéro de téléphone</p>' +
                '<div class="phone-input-group" style="margin-bottom:.8rem"><span class="phone-prefix">+223</span><input type="tel" id="forgotPhone" placeholder="70 00 00 00" style="border:none;background:transparent;padding:.8rem 1rem;color:#eee;font-size:.9rem;outline:none;flex:1;min-width:0"></div>' +
                '<button class="btn-primary" onclick="B.sendForgotCode()" style="width:100%;padding:.8rem;border-radius:12px;background:linear-gradient(135deg,#ff3b3b,#ff6b6b);color:#fff;border:none;font-weight:600;cursor:pointer;font-size:1rem;margin-bottom:.5rem">Recevoir le code</button>' +
                '<div id="forgotCodeSection" style="display:none;margin-top:.8rem">' +
                    '<p style="color:#888;font-size:.75rem;margin-bottom:.5rem">Entre le code reçu</p>' +
                    '<input type="text" id="forgotCode" placeholder="0000" maxlength="4" style="width:100%;padding:.8rem;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.06);color:#eee;font-size:1.5rem;text-align:center;letter-spacing:8px;outline:none;margin-bottom:.5rem">' +
                    '<input type="password" id="forgotNewPassword" placeholder="Nouveau mot de passe" style="width:100%;padding:.8rem;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.06);color:#eee;font-size:.9rem;outline:none;margin-bottom:.5rem">' +
                    '<button class="btn-primary" onclick="B.resetPassword()" style="width:100%;padding:.8rem;border-radius:12px;background:linear-gradient(135deg,#4caf50,#66bb6a);color:#fff;border:none;font-weight:600;cursor:pointer;font-size:1rem">Changer le mot de passe</button>' +
                '</div>' +
                '<button class="btn-ghost" onclick="document.getElementById(\'forgotModal\').remove()" style="color:#888;margin-top:.5rem">Annuler</button>' +
            '</div>' +
        '</div>';
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    },

    async sendForgotCode() {
        var phone = (document.getElementById('forgotPhone')?.value || '').trim().replace(/[^0-9+]/g, '');
        if (!phone || phone.length < 8) { this.toast('Numéro invalide'); return; }
        var prefix = '+223';
        var fullPhone = prefix + phone;
        var r = await this.safeFetch('/api/solo/forgot-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: fullPhone }), timeout: 15000 });
        if (!r.ok) { this.toast('Erreur réseau'); return; }
        var d = await r.resp.json();
        if (!d.success) { this.toast(d.message); return; }
        document.getElementById('forgotCodeSection').style.display = 'block';
        this.toast('Code envoyé par SMS');
    },

    async resetPassword() {
        var phone = (document.getElementById('forgotPhone')?.value || '').trim().replace(/[^0-9+]/g, '');
        var code = document.getElementById('forgotCode').value.trim();
        var pwd = document.getElementById('forgotNewPassword').value;
        if (code.length < 4) { this.toast('Code incomplet'); return; }
        if (pwd.length < 6) { this.toast('Mot de passe (6+ caractères)'); return; }
        var fullPhone = '+223' + phone;
        var r = await this.safeFetch('/api/solo/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: fullPhone, code: code, password: pwd }), timeout: 15000 });
        if (!r.ok) { this.toast('Erreur réseau'); return; }
        var d = await r.resp.json();
        if (!d.success) { this.toast(d.message); return; }
        document.getElementById('forgotModal')?.remove();
        this.toast('✅ Mot de passe changé. Connecte-toi.');
    },

    async deleteAccount() {
        if (!confirm('Supprimer définitivement ton compte ? Tous les messages, matchs et donnees seront effaces.')) return;
        await this.safeFetch('/api/solo/me', { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + this.token } });
        this.logout();
    },

    async deleteConversation() {
        if (!this.currentMatch || !confirm('Effacer cette conversation ?')) return;
        await this.safeFetch('/api/solo/conversation/' + this.currentMatch.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + this.token } });
        document.getElementById('chatMessages').innerHTML = '';
        this.toast('Conversation effacee');
        document.querySelector('.tab-btn[data-page="matches"]').click();
        this.loadMatches();
    },

    async verifyBySelfie() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'user';
        input.onchange = async function() {
            var file = input.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = async function() {
                var r = await B.safeFetch('/api/solo/verify/selfie', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + B.token },
                    body: JSON.stringify({ image: reader.result })
                });
                if (r.ok) {
                    var d = await r.resp.json();
                    if (d.success) { B.toast(d.message); B.loadUser(); }
                    else B.toast(d.message || 'Erreur');
                }
            };
            reader.readAsDataURL(file);
        };
        input.click();
    },

    // ─── Annonces ────────────────────────────────────────
    async loadAnnonces() {
        var params = new URLSearchParams();
        var c = document.getElementById('annonceFilterCountry')?.value;
        var g = document.getElementById('annonceFilterGender')?.value;
        var cat = document.getElementById('annonceFilterCategory')?.value;
        if (c) params.set('country', c);
        if (g) params.set('gender', g);
        if (cat) params.set('category', cat);
        var r = await this.safeFetch('/api/solo/annonces?' + params);
        if (!r.ok) return;
        var d = await r.resp.json();
        this.renderAnnonces(d.annonces || []);
        this.loadNotifications();
        this.loadMyResponses();
    },

    async loadMyResponses() {
        if (!this.token) return;
        var r = await this.safeFetch('/api/solo/annonces/mine/responses', { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return;
        var d = await r.resp.json();
        this.pendingResponses = d.responses || [];
        // Update badge on annonces cards
        document.querySelectorAll('.annonce-card').forEach(function(card) {
            var annonceId = parseInt(card.dataset.id);
            var count = (B.pendingResponses || []).filter(function(r) { return r.annonce_id === annonceId; }).length;
            var badge = card.querySelector('.response-badge');
            if (badge) {
                if (count > 0) { badge.textContent = count + ' réponse' + (count > 1 ? 's' : ''); badge.style.display = 'inline'; }
                else { badge.style.display = 'none'; }
            }
        });
    },

    async viewResponses(annonceId) {
        var responses = (this.pendingResponses || []).filter(function(r) { return r.annonce_id === annonceId; });
        if (!responses.length) { this.toast('Aucune réponse'); return; }
        var self = this;
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'responsesModal';
        var html = '<div class="modal-detail" style="max-width:420px"><div class="detail-info">' +
            '<h3 style="margin-bottom:.8rem">💌 ' + responses.length + ' réponse' + (responses.length > 1 ? 's' : '') + '</h3>';
        responses.forEach(function(r) {
            var photos = Array.isArray(r.photos) ? r.photos : [];
            var img = photos[0] || '';
            html += '<div class="response-item" style="background:rgba(255,255,255,.03);border-radius:12px;padding:.8rem;margin-bottom:.5rem;border:1px solid rgba(255,255,255,.04)">' +
                '<div style="display:flex;align-items:flex-start;gap:.8rem;margin-bottom:.5rem">' +
                    '<div style="width:48px;height:48px;border-radius:50%;background-size:cover;background-position:center;flex-shrink:0;' + (img ? 'background-image:url(' + B.esc(img) + ')' : '') + '">' + (!img ? '<img src="' + B.avatarUrl(r.prenom || r.pseudo, []) + '" style="width:48px;height:48px;border-radius:50%">' : '') + '</div>' +
                    '<div style="flex:1;min-width:0">' +
                        '<div style="font-weight:600;font-size:.9rem">' + B.esc(r.prenom || r.pseudo) + ', ' + (r.age || '?') + '</div>' +
                        '<div style="font-size:.7rem;color:#888">' + B.esc(r.city || '') + ' ' + B.esc(r.country || '') + (r.profession ? ' · ' + B.esc(r.profession) : '') + '</div>' +
                        (r.bio ? '<div style="font-size:.7rem;color:#aaa;margin-top:.2rem;line-height:1.3">' + B.esc(r.bio.substring(0, 80)) + '</div>' : '') +
                    '</div>' +
                '</div>' +
                '<div style="color:#bbb;font-size:.8rem;margin-bottom:.8rem;line-height:1.4;padding-left:56px">' + B.esc(r.message) + '</div>' +
                '<div style="display:flex;gap:.4rem;padding-left:56px">' +
                    '<button class="btn-sm btn-success" onclick="B.acceptResponse(' + r.id + ')" style="flex:1;padding:.5rem;border-radius:8px;border:none;background:rgba(76,175,80,.15);color:#4caf50;cursor:pointer;font-size:.8rem;font-weight:600">✅ Accepter</button>' +
                    '<button class="btn-sm btn-danger" onclick="B.ignoreResponse(' + r.id + ')" style="flex:1;padding:.5rem;border-radius:8px;border:none;background:rgba(255,59,59,.1);color:#ff3b3b;cursor:pointer;font-size:.8rem;font-weight:600">❌ Ignorer</button>' +
                '</div>' +
            '</div>';
        });
        html += '<button class="btn-close-detail" onclick="document.getElementById(\'responsesModal\').remove()" style="width:100%;padding:.7rem;border-radius:10px;border:none;background:rgba(255,255,255,.06);color:#888;cursor:pointer;font-size:.85rem">Fermer</button>';
        html += '</div></div>';
        overlay.innerHTML = html;
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    },

    async acceptResponse(id) {
        var r = await this.safeFetch('/api/solo/annonces/responses/' + id + '/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token } });
        if (r.ok) { document.getElementById('responsesModal')?.remove(); this.toast('✅ Match créé — allez dans Chat !'); this.loadMyResponses(); }
    },

    async ignoreResponse(id) {
        var r = await this.safeFetch('/api/solo/annonces/responses/' + id + '/ignore', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token } });
        if (r.ok) { this.toast('Réponse ignorée'); this.loadMyResponses(); }
    },

    async loadNotifications() {
        if (!this.token) return;
        var r = await this.safeFetch('/api/solo/notifications', { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return;
        var d = await r.resp.json();
        if (d.notifications && d.notifications.length > 0) {
            d.notifications.forEach(function(n) {
                B.toast(n.title + ': ' + n.body.substring(0, 60));
            });
            this.safeFetch('/api/solo/notifications/read', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token } });
        }
    },

    async loadMyAnnonces() {
        var r = await this.safeFetch('/api/solo/annonces/mine', { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return;
        var d = await r.resp.json();
        this.myAnnonces = d.annonces || [];
    },

    renderAnnonces(annonces) {
        var list = document.getElementById('annoncesList');
        if (!annonces.length) { list.innerHTML = '<p style="text-align:center;color:#666;padding:2rem">Aucune annonce pour le moment</p>'; return; }
        list.innerHTML = annonces.map(function(a) {
            var photos = Array.isArray(a.photos) ? a.photos : [];
            var img = photos[0] || '';
            var isMine = a.user_id === B.user?.email;
            // Check status from myAnnonces
            var statusBadge = '';
            var statusClass = '';
            var rejectReason = '';
            if (a.status) {
                if (a.status === 'pending') { statusBadge = '⏳ En attente'; statusClass = 'badge-pending'; }
                else if (a.status === 'approved') { statusBadge = '✅ Approuvée'; statusClass = 'badge-resolved'; }
                else if (a.status === 'rejected') { statusBadge = '❌ Rejetée'; statusClass = 'badge-banned'; rejectReason = a.reject_reason ? ': ' + a.reject_reason : ''; }
            }
            var categoryBadge = a.category ? '<span style="font-size:.65rem;color:#888;margin-left:.3rem">' + a.category + '</span>' : '';
            var daysLeft = a.daysLeft !== undefined ? a.daysLeft : Math.max(0, Math.ceil((new Date(a.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
            var deleteBtn = isMine ? '<button class="annonce-delete" onclick="B.deleteAnnonce(' + a.id + ')">🗑️ Supprimer</button>' : '';
            var respondBtn = (isMine || a.status === 'pending' || a.status === 'rejected') ? '' : '<button class="annonce-respond" onclick="B.respondToAnnonce(' + a.id + ')">💌 Répondre</button>';
            var responseBadge = isMine ? '<span class="badge response-badge" style="display:none;cursor:pointer;background:rgba(255,215,0,.15);color:#ffd700;margin-left:.3rem" onclick="event.stopPropagation();B.viewResponses(' + a.id + ')"></span>' : '';
            return '<div class="annonce-card" data-id="' + a.id + '">' +
                '<div class="annonce-header"><div><div class="annonce-title">' + B.esc(a.title) + ' ' + categoryBadge + '</div><div class="annonce-meta">' + B.esc(a.pseudo) + ', ' + (a.age || '?') + ' · ' + B.esc(a.city || '') + ' ' + B.esc(a.country || '') + '</div></div>' +
                (img ? '<div class="annonce-photo" style="background-image:url(\'' + B.esc(img) + '\')"></div>' : '') +
                '</div>' +
                '<div class="annonce-desc">' + B.esc(a.description) + '</div>' +
                (a.looking_for ? '<div class="annonce-looking">❤️ ' + B.esc(a.looking_for) + '</div>' : '') +
                (statusBadge ? '<div style="margin:.3rem 0"><span class="badge ' + statusClass + '">' + statusBadge + '</span>' + B.esc(rejectReason) + '</div>' : '') +
                '<div class="annonce-footer">' +
                    '<span class="annonce-expire">⏱️ ' + daysLeft + 'j restant' + (daysLeft > 1 ? 's' : '') + '</span>' +
                    deleteBtn + respondBtn + responseBadge +
                '</div>' +
            '</div>';
        }).join('');
    },

    openCreateAnnonceModal() {
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'annonceModal';
        overlay.innerHTML = '<div class="modal-detail" style="max-width:400px">' +
            '<div class="detail-info">' +
                '<h3 style="margin-bottom:1rem">✍️ Nouvelle annonce</h3>' +
                '<input type="text" id="annonceTitle" placeholder="Titre (ex: Je cherche un homme sérieux)" style="width:100%;padding:.7rem;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.04);color:#eee;font-size:.85rem;margin-bottom:.7rem;outline:none">' +
                '<textarea id="annonceDesc" placeholder="Décris ce que tu cherches..." rows="4" style="width:100%;padding:.7rem;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.04);color:#eee;font-size:.85rem;margin-bottom:.7rem;outline:none;resize:vertical;font-family:inherit"></textarea>' +
                '<select id="annonceLooking" style="width:100%;padding:.7rem;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.04);color:#eee;font-size:.85rem;margin-bottom:.7rem;outline:none">' +
                    '<option value="">Je cherche...</option><option value="Mariage">Mariage</option><option value="Relation sérieuse">Relation sérieuse</option><option value="À voir">À voir</option><option value="Amitié">Amitié</option>' +
                '</select>' +
                '<select id="annonceCategory" style="width:100%;padding:.7rem;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.04);color:#eee;font-size:.85rem;margin-bottom:.7rem;outline:none">' +
                    '<option value="">Catégorie (optionnelle)</option><option value="Mariage">💍 Mariage</option><option value="Relation sérieuse">💖 Relation sérieuse</option><option value="Amitié">🤝 Amitié</option><option value="Voyage">✈️ Voyage</option><option value="Discussion">💬 Discussion</option>' +
                '</select>' +
                '<div style="display:flex;gap:.5rem;margin-bottom:.7rem">' +
                    '<select id="annonceCountry" style="flex:1;padding:.7rem;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.04);color:#eee;font-size:.85rem;outline:none">' +
                        '<option value="ML">Mali</option><option value="CI">Côte d\'Ivoire</option><option value="SN">Sénégal</option><option value="BF">Burkina Faso</option><option value="GN">Guinée</option><option value="CM">Cameroun</option><option value="BJ">Bénin</option><option value="TG">Togo</option><option value="NE">Niger</option><option value="TD">Tchad</option>' +
                    '</select>' +
                    '<input type="text" id="annonceCity" placeholder="Ville" style="flex:1;padding:.7rem;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.04);color:#eee;font-size:.85rem;outline:none">' +
                '</div>' +
                '<p style="color:#555;font-size:.7rem;margin-bottom:.7rem">📸 Photos (optionnel, max 3)</p>' +
                '<input type="file" id="annoncePhotos" accept="image/*" multiple style="margin-bottom:.5rem">' +
                '<label style="display:flex;align-items:center;gap:.5rem;color:#888;font-size:.8rem;margin-bottom:.7rem;cursor:pointer"><input type="checkbox" id="annonceDiscreet"> 🔒 Annonce discrète (pseudo masqué)</label>' +
                '<div class="detail-actions">' +
                    '<button class="btn-primary" onclick="B.createAnnonce()" style="flex:1;background:linear-gradient(135deg,#ff3b3b,#ff6b6b);color:#fff;padding:.7rem;border-radius:12px;border:none;font-weight:600;cursor:pointer">Publier</button>' +
                    '<button class="btn-close-detail" onclick="document.getElementById(\'annonceModal\').remove()" style="flex:1;background:rgba(255,255,255,.06);color:#888;padding:.7rem;border-radius:12px;border:none;cursor:pointer">Annuler</button>' +
                '</div>' +
            '</div>' +
        '</div>';
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    },

    async createAnnonce() {
        var title = document.getElementById('annonceTitle').value.trim();
        var desc = document.getElementById('annonceDesc').value.trim();
        if (!title || !desc) { this.toast('Titre et description requis'); return; }
        var photos = [];
        var files = document.getElementById('annoncePhotos').files;
        for (var i = 0; i < Math.min(files.length, 3); i++) {
            var file = files[i];
            var reader = new FileReader();
            await new Promise(function(resolve) {
                reader.onload = async function() {
                    var r = await fetch('/api/solo/upload-photo', {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + B.token },
                        body: JSON.stringify({ image: reader.result })
                    });
                    var d = await r.json();
                    if (d.success) photos.push(d.url);
                    resolve();
                };
                reader.readAsDataURL(file);
            });
        }
        var r = await this.safeFetch('/api/solo/annonces', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token },
            body: JSON.stringify({ title: title, description: desc, looking_for: document.getElementById('annonceLooking').value, photos: photos, discreet: document.getElementById('annonceDiscreet')?.checked || false, category: document.getElementById('annonceCategory')?.value || '' })
        });
        if (!r.ok) { this.toast('Erreur réseau'); return; }
        var d = await r.resp.json();
        if (d.success) { this.toast('✅ Annonce publiée'); document.getElementById('annonceModal')?.remove(); this.loadAnnonces(); }
        else this.toast(d.message || 'Erreur');
    },

    async deleteAnnonce(id) {
        if (!confirm('Supprimer cette annonce ?')) return;
        var r = await this.safeFetch('/api/solo/annonces/' + id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + this.token } });
        if (r.ok) { this.toast('Annonce supprimée'); this.loadAnnonces(); }
    },

    async respondToAnnonce(id) {
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'respondModal';
        overlay.innerHTML = '<div class="modal-detail" style="max-width:360px">' +
            '<div class="detail-info">' +
                '<h3 style="margin-bottom:.3rem">💌 Envoyer un message</h3>' +
                '<p style="color:#888;font-size:.8rem;margin-bottom:1rem">Écris à l\'auteur. Il pourra choisir de te répondre.</p>' +
                '<textarea id="respondMessage" placeholder="Salut, je suis intéressé par ton annonce..." rows="4" style="width:100%;padding:.7rem;border-radius:12px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.06);color:#eee;font-size:.9rem;outline:none;resize:vertical;font-family:inherit;margin-bottom:.8rem"></textarea>' +
                '<div class="detail-actions">' +
                    '<button class="btn-primary" onclick="B.sendResponse(' + id + ')" style="flex:1;background:linear-gradient(135deg,#ff3b3b,#ff6b6b);color:#fff;padding:.7rem;border-radius:12px;border:none;font-weight:600;cursor:pointer">Envoyer</button>' +
                    '<button class="btn-close-detail" onclick="document.getElementById(\'respondModal\').remove()" style="flex:1;background:rgba(255,255,255,.06);color:#888;padding:.7rem;border-radius:12px;border:none;cursor:pointer">Annuler</button>' +
                '</div>' +
            '</div>' +
        '</div>';
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
        setTimeout(function() { var el = document.getElementById('respondMessage'); if (el) el.focus(); }, 300);
    },

    async sendResponse(id) {
        var msg = document.getElementById('respondMessage').value.trim();
        if (msg.length < 2) { this.toast('Écris un message personnalisé'); return; }
        var r = await this.safeFetch('/api/solo/annonces/' + id + '/respond', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token }, body: JSON.stringify({ message: msg }), timeout: 10000 });
        document.getElementById('respondModal')?.remove();
        if (!r.ok) { this.toast('Erreur réseau'); return; }
        var d = await r.resp.json();
        if (d.success) { this.toast(d.message || '💌 Message envoyé'); }
        else { this.toast(d.message); }
    },

    // ─── Auto-refresh profils ───────────────────────────
    startAutoRefresh() {
        if (this.autoRefreshInterval) clearInterval(this.autoRefreshInterval);
        var self = this;
        this.autoRefreshInterval = setInterval(function() {
            if (!document.hidden && document.querySelector('.tab-btn.active')?.dataset.page === 'browse') {
                self.initSwipe();
            }
        }, 30000);
    },

    showSwipeFilters() {
        document.getElementById('browseFilters').style.display = 'flex';
    },
    hideSwipeFilters() {
        document.getElementById('browseFilters').style.display = 'none';
    },

    // ─── Pagination profils ─────────────────────────────
    async loadMoreProfiles() {
        if (!this.profilesHasMore) return;
        this.profilesOffset += 20;
        var params = new URLSearchParams();
        var g = document.getElementById('filterGender').value;
        var c = document.getElementById('filterCountry').value;
        var min = document.getElementById('filterAgeMin').value;
        var max = document.getElementById('filterAgeMax').value;
        var dist = document.getElementById('filterDistance')?.value;
        if (g) params.set('gender', g);
        if (c) params.set('country', c);
        if (min) params.set('ageMin', min);
        if (max) params.set('ageMax', max);
        if (dist && dist < 500) params.set('maxDistance', dist);
        params.set('offset', this.profilesOffset);
        params.set('limit', 20);
        var r = await this.safeFetch('/api/solo/profiles?' + params, { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return;
        var d = await r.resp.json();
        this.profilesHasMore = d.hasMore;
        var blocked = JSON.parse(localStorage.getItem('solo_blocked') || '[]');
        var newProfiles = (d.profiles || []).filter(function(p) { return !blocked.includes(p.email); });
        this.profiles = this.profiles.concat(newProfiles);
        this.renderProfiles();
    },

    // ─── Push Notifications ─────────────────────────────
    async subscribePush() {
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
        try {
            var reg = await navigator.serviceWorker.ready;
            var sub = await reg.pushManager.getSubscription();
            if (!sub) {
                var r = await this.safeFetch('/api/solo/vapid-key');
                if (r.ok) {
                    var d = await r.resp.json();
                    if (d.key) {
                        sub = await reg.pushManager.subscribe({
                            userVisibleOnly: true,
                            applicationServerKey: d.key
                        });
                    }
                }
            }
            if (sub) {
                await this.safeFetch('/api/solo/subscribe-push', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token },
                    body: JSON.stringify({ subscription: sub })
                });
            }
        } catch (e) { console.log('Push subscribe failed:', e); }
    },

    // ─── Incognito Mode ─────────────────────────────────
    async toggleIncognito() {
        var current = this.user?.incognito || false;
        var r = await this.safeFetch('/api/solo/me', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token },
            body: JSON.stringify({ incognito: !current })
        });
        if (r.ok) {
            this.user.incognito = !current;
            this.toast(this.user.incognito ? '🕶️ Mode incognito activé' : '👁️ Mode incognito désactivé');
            var btn = document.getElementById('incognitoBtn');
            if (btn) btn.textContent = this.user.incognito ? '👁️' : '🕶️';
        }
    },

    // ─── Online Status ──────────────────────────────────
    async loadOnlineStatus(email) {
        var r = await this.safeFetch('/api/solo/online/' + email, { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return { isOnline: false, lastSeen: '' };
        var d = await r.resp.json();
        return d;
    },

    // ─── Typing Indicator ───────────────────────────────
    startTyping(matchId) {
        if (this.typingInterval) clearInterval(this.typingInterval);
        var self = this;
        this.typingInterval = setInterval(async function() {
            if (!self.currentMatch || self.currentMatch.id !== matchId) return;
            var r = await self.safeFetch('/api/solo/typing/' + matchId, { headers: { 'Authorization': 'Bearer ' + self.token } });
            if (r.ok) {
                var d = await r.resp.json();
                var header = document.getElementById('chatHeader');
                if (d.isTyping) {
                    header.innerHTML = header.innerHTML.replace(/ <span class="typing-indicator">.*<\/span>/, '');
                    header.innerHTML += ' <span class="typing-indicator">✏️ écrit...</span>';
                } else {
                    header.innerHTML = header.innerHTML.replace(/ <span class="typing-indicator">.*<\/span>/, '');
                }
            }
        }, 2000);
    },

    sendTypingStatus(matchId, isTyping) {
        this.safeFetch('/api/solo/typing', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token },
            body: JSON.stringify({ matchId: matchId, isTyping: isTyping })
        });
    },

    // ─── Read Receipts ──────────────────────────────────
    async markMessagesAsRead(matchId) {
        await this.safeFetch('/api/solo/messages/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token },
            body: JSON.stringify({ matchId: matchId })
        });
    },

    async loadUnreadCount() {
        var r = await this.safeFetch('/api/solo/messages/unread', { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (r.ok) {
            var d = await r.resp.json();
            var chatTab = document.querySelector('.tab-btn[data-page="chat"]');
            if (d.count > 0) {
                chatTab.innerHTML = '<i class="fas fa-comments"></i> Chat <span class="unread-badge">' + d.count + '</span>';
            } else {
                chatTab.innerHTML = '<i class="fas fa-comments"></i> Chat';
            }
        }
    },

    // ─── GIF Picker ─────────────────────────────────────
    toggleGifPicker() {
        var picker = document.getElementById('gifPicker');
        picker.style.display = picker.style.display === 'none' ? 'block' : 'none';
        if (picker.style.display === 'block') {
            document.getElementById('gifSearch').focus();
            this.searchGifs('');
        }
    },

    async searchGifs(query) {
        var results = document.getElementById('gifResults');
        var url = query.trim()
            ? 'https://api.giphy.com/v1/gifs/search?api_key=dc6zaTOxFJmzC&q=' + encodeURIComponent(query) + '&limit=12&rating=pg-13'
            : 'https://api.giphy.com/v1/gifs/trending?api_key=dc6zaTOxFJmzC&limit=12&rating=pg-13';
        try {
            var r = await fetch(url);
            var d = await r.json();
            results.innerHTML = (d.data || []).map(function(g) {
                var img = g.images && g.images.fixed_height_small ? g.images.fixed_height_small.url : '';
                return '<div class="gif-item" onclick="B.sendGif(\'' + img + '\')"><img src="' + img + '" loading="lazy"></div>';
            }).join('');
        } catch (e) {
            results.innerHTML = '<p style="color:#666;font-size:.75rem;text-align:center">Erreur chargement GIFs</p>';
        }
    },

    async sendGif(gifUrl) {
        if (!this.currentMatch) return;
        document.getElementById('gifPicker').style.display = 'none';
        var r = await this.safeFetch('/api/solo/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token },
            body: JSON.stringify({ matchId: this.currentMatch.id, content: '[GIF]' + gifUrl })
        });
        if (r.ok) this.loadMessages();
    },

    // ─── Report User ────────────────────────────────────
    openReportModal(email) {
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.id = 'reportModal';
        overlay.innerHTML = '<div class="modal-detail" style="max-width:360px">' +
            '<div class="detail-info">' +
                '<h3 style="margin-bottom:1rem">🚩 Signaler cet utilisateur</h3>' +
                '<select id="reportReason" style="width:100%;padding:.7rem;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.04);color:#eee;font-size:.85rem;margin-bottom:.7rem;outline:none">' +
                    '<option value="">Choisir une raison</option>' +
                    '<option value="spam">Spam</option>' +
                    '<option value="faux_profil">Faux profil</option>' +
                    '<option value="harcelement">Harcèlement</option>' +
                    '<option value="contenu_inapproprie">Contenu inapproprié</option>' +
                    '<option value="arnaque">Tentative d\'arnaque</option>' +
                    '<option value="autre">Autre</option>' +
                '</select>' +
                '<textarea id="reportDetails" placeholder="Détails (optionnel)" rows="3" style="width:100%;padding:.7rem;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.04);color:#eee;font-size:.85rem;margin-bottom:1rem;outline:none;resize:vertical;font-family:inherit"></textarea>' +
                '<div class="detail-actions">' +
                    '<button class="btn-primary" onclick="B.submitReport(\'' + this.esc(email) + '\')" style="flex:1;background:linear-gradient(135deg,#ff3b3b,#ff6b6b);color:#fff;padding:.7rem;border-radius:12px;border:none;font-weight:600;cursor:pointer">Envoyer</button>' +
                    '<button class="btn-close-detail" onclick="document.getElementById(\'reportModal\').remove()" style="flex:1;background:rgba(255,255,255,.06);color:#888;padding:.7rem;border-radius:12px;border:none;cursor:pointer">Annuler</button>' +
                '</div>' +
            '</div>' +
        '</div>';
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    },

    async submitReport(email) {
        var reason = document.getElementById('reportReason').value;
        var details = document.getElementById('reportDetails').value;
        if (!reason) { this.toast('Choisis une raison'); return; }
        var r = await this.safeFetch('/api/solo/report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token },
            body: JSON.stringify({ email: email, reason: reason, details: details })
        });
        if (r.ok) {
            var d = await r.resp.json();
            this.toast(d.message || 'Signalement envoyé');
            document.getElementById('reportModal')?.remove();
        }
    },

    // ─── Undo Swipe ─────────────────────────────────────
    async undoSwipe() {
        var r = await this.safeFetch('/api/solo/swipe/undo', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) { this.toast('Rien à annuler'); return; }
        var d = await r.resp.json();
        if (d.success) {
            this.toast('↩️ Swipe annulé');
            if (this.swipeIndex > 0) {
                this.swipeIndex--;
                this.renderSwipeCard();
            }
        }
    },

    // ─── Distance Filter ────────────────────────────────
    async loadProfilesWithDistance() {
        var params = new URLSearchParams();
        var g = document.getElementById('filterGender').value;
        var c = document.getElementById('filterCountry').value;
        var min = document.getElementById('filterAgeMin').value;
        var max = document.getElementById('filterAgeMax').value;
        var dist = document.getElementById('filterDistance')?.value;
        if (g) params.set('gender', g);
        if (c) params.set('country', c);
        if (min) params.set('ageMin', min);
        if (max) params.set('ageMax', max);
        if (dist && dist < 500) params.set('maxDistance', dist);
        var r = await this.safeFetch('/api/solo/profiles?' + params, { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return;
        var d = await r.resp.json();
        var blocked = JSON.parse(localStorage.getItem('solo_blocked') || '[]');
        this.profiles = (d.profiles || []).filter(function(p) { return !blocked.includes(p.email); });
        this.renderProfiles();
    },

    // ─── Boost Profile ──────────────────────────────────
    async activateBoost() {
        var r = await this.safeFetch('/api/solo/boost', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) { this.toast('Erreur'); return; }
        var d = await r.resp.json();
        if (d.success) this.toast(d.message);
        else this.toast(d.message || 'Erreur');
    },

    // ─── See Who Liked You ──────────────────────────────
    async loadLikes() {
        var r = await this.safeFetch('/api/solo/likes-received', { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return;
        var d = await r.resp.json();
        var list = document.getElementById('likesList');
        if (!d.likes || !d.likes.length) { list.innerHTML = '<p style="text-align:center;color:#666;padding:2rem">Personne ne t\'a encore liké</p>'; return; }
        list.innerHTML = d.likes.map(function(l) {
            var visible = l.visible;
            var name = visible ? (l.pseudo || '?') : '?????';
            var meta = visible ? (l.age + ' · ' + (l.country || '')) : 'Passe VIP pour voir';
            var photo = visible && l.photos ? '<img src="' + B.esc(l.photos) + '" style="width:50px;height:50px;border-radius:50%;object-fit:cover">' : '<div class="match-avatar" style="' + (visible ? '' : 'filter:blur(8px)') + '">👤</div>';
            return '<div class="match-item">' + photo + '<div><span class="match-name">' + B.esc(name) + '</span><br><span style="color:#888;font-size:.7rem">' + B.esc(meta) + '</span></div></div>';
        }).join('');
        document.getElementById('pageLikes').classList.add('active');
        document.querySelectorAll('.page').forEach(function(p) { if (p.id !== 'pageLikes') p.classList.remove('active'); });
    },

    installApp() {
        if (this.deferredPrompt) {
            this.deferredPrompt.prompt();
            this.deferredPrompt.userChoice.then(function() {
                document.getElementById('pwaInstallBanner').style.display = 'none';
                localStorage.setItem('pwa_installed', '1');
            });
        }
    },

    dismissPwa() {
        document.getElementById('pwaInstallBanner').style.display = 'none';
        localStorage.setItem('pwa_dismissed', '1');
    }
};

document.addEventListener('DOMContentLoaded', () => B.init());
