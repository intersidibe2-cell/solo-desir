const B = {
    token: null,
    user: null,
    profiles: [],
    matches: [],
    currentMatch: null,

    init() {
        const saved = localStorage.getItem('solo_token');
        if (saved) { this.token = saved; this.loadMain(); return; }
        document.getElementById('loginForm').addEventListener('submit', e => { e.preventDefault(); this.login(); });
        document.getElementById('registerForm').addEventListener('submit', e => { e.preventDefault(); this.register(); });
        document.querySelectorAll('.tab').forEach(t => {
            t.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
                t.classList.add('active');
                document.getElementById(t.dataset.tab + 'Form').style.display = 'block';
                document.getElementById(t.dataset.tab === 'login' ? 'registerForm' : 'loginForm').style.display = 'none';
            });
        });
    },

    async login() {
        this.showErr('');
        const r = await fetch('/api/solo/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: document.getElementById('loginEmail').value.trim(), password: document.getElementById('loginPassword').value })
        });
        const d = await r.json();
        if (!d.success) return this.showErr(d.message);
        this.setToken(d.token);
        this.loadMain();
    },

    async register() {
        this.showErr('');
        const r = await fetch('/api/solo/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pseudo: document.getElementById('regPseudo').value.trim(),
                email: document.getElementById('regEmail').value.trim(),
                password: document.getElementById('regPassword').value,
                gender: document.getElementById('regGender').value,
                age: parseInt(document.getElementById('regAge').value),
                country: document.getElementById('regCountry').value
            })
        });
        const d = await r.json();
        if (!d.success) return this.showErr(d.message);
        this.setToken(d.token);
        this.loadMain();
    },

    setToken(t) { this.token = t; localStorage.setItem('solo_token', t); },
    showErr(msg) { const el = document.getElementById('authError'); el.textContent = msg; el.style.display = msg ? 'block' : 'none'; },

    async loadMain() {
        document.getElementById('soloLogin').style.display = 'none';
        document.getElementById('soloMain').style.display = 'block';
        await this.loadUser();
        this.bindEvents();
        this.loadProfiles();
    },

    async loadUser() {
        const r = await fetch('/api/solo/me', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const d = await r.json();
        if (!d.success) return this.logout();
        this.user = d.user;
        document.getElementById('userPlan').textContent = d.user.plan === 'free' ? 'Gratuit' : d.user.plan;
        document.getElementById('editPseudo').value = d.user.pseudo || '';
        document.getElementById('editAge').value = d.user.age || '';
        document.getElementById('editCountry').value = d.user.country || 'ML';
        document.getElementById('editCity').value = d.user.city || '';
        document.getElementById('editBio').value = d.user.bio || '';
        document.getElementById('editPhotos').value = (d.user.photos || []).join(', ');
    },

    bindEvents() {
        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                document.getElementById('page' + btn.dataset.page.charAt(0).toUpperCase() + btn.dataset.page.slice(1)).classList.add('active');
                if (btn.dataset.page === 'browse') this.loadProfiles();
                if (btn.dataset.page === 'matches') this.loadMatches();
            });
        });
        document.getElementById('filterGender').addEventListener('change', () => this.loadProfiles());
        document.getElementById('filterCountry').addEventListener('change', () => this.loadProfiles());
        document.getElementById('filterAgeMin').addEventListener('change', () => this.loadProfiles());
        document.getElementById('filterAgeMax').addEventListener('change', () => this.loadProfiles());
        document.getElementById('saveProfileBtn').addEventListener('click', () => this.saveProfile());
        document.getElementById('sendChatBtn').addEventListener('click', () => this.sendMessage());
        document.getElementById('chatInput').addEventListener('keydown', e => { if (e.key === 'Enter') this.sendMessage(); });
        this.startChatPoll();
    },

    logout() { localStorage.removeItem('solo_token'); location.reload(); },

    async loadProfiles() {
        const params = new URLSearchParams();
        const g = document.getElementById('filterGender').value;
        const c = document.getElementById('filterCountry').value;
        const min = document.getElementById('filterAgeMin').value;
        const max = document.getElementById('filterAgeMax').value;
        if (g) params.set('gender', g);
        if (c) params.set('country', c);
        if (min) params.set('ageMin', min);
        if (max) params.set('ageMax', max);
        const r = await fetch('/api/solo/profiles?' + params, { headers: { 'Authorization': `Bearer ${this.token}` } });
        const d = await r.json();
        this.profiles = d.profiles || [];
        this.renderProfiles();
    },

    renderProfiles() {
        const grid = document.getElementById('profilesGrid');
        if (!this.profiles.length) { grid.innerHTML = '<p style="text-align:center;color:#666;padding:2rem">Aucun profil trouvé</p>'; return; }
        grid.innerHTML = this.profiles.map(p => {
            const photos = Array.isArray(p.photos) ? p.photos : typeof p.photos === 'string' ? p.photos.split(',').map(s => s.trim()).filter(s => s) : [];
            const img = photos[0] || '';
            return `<div class="profile-card" data-email="${p.email}">
                ${img ? `<img class="profile-photo" src="${img}" onerror="this.innerHTML='📷'">` : '<div class="profile-photo">📷</div>'}
                <div class="profile-info">
                    <div class="name">${p.pseudo}, ${p.age || '?'}</div>
                    <div class="meta">${p.city || ''} ${p.country || ''}</div>
                    <div class="actions"><button class="btn-like" onclick="B.like('${p.email}')">❤️ J'aime</button></div>
                </div>
            </div>`;
        }).join('');
        document.querySelectorAll('.profile-card').forEach(card => {
            card.addEventListener('click', e => {
                if (e.target.closest('.btn-like')) return;
                this.showProfile(card.dataset.email);
            });
        });
    },

    showProfile(email) {
        const p = this.profiles.find(x => x.email === email);
        if (!p) return;
        const photos = Array.isArray(p.photos) ? p.photos : [];
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-detail">
            ${photos.length > 0 ? photos.map(u => `<img src="${u}" onerror="this.style.display='none'">`).join('') : ''}
            <div class="detail-info">
                <div class="detail-name">${p.pseudo}, ${p.age || '?'}</div>
                <div class="detail-meta">${p.gender} · ${p.city || ''} ${p.country || ''}</div>
                ${p.bio ? `<div class="detail-bio">${p.bio}</div>` : ''}
                <div class="detail-actions">
                    <button class="btn-like" onclick="B.like('${p.email}');document.querySelector('.modal-overlay').remove()">❤️ J'aime</button>
                    <button class="btn-close-detail" onclick="this.closest('.modal-overlay').remove()">Fermer</button>
                </div>
            </div>
        </div>`;
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        document.body.appendChild(overlay);
    },

    async like(targetEmail) {
        const r = await fetch('/api/solo/like', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ targetEmail })
        });
        const d = await r.json();
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
            <div class="match-avatar">💘</div><span class="match-name">${m.with}</span>
        </div>`).join('');
        document.querySelectorAll('.match-item').forEach(item => {
            item.addEventListener('click', () => this.openChat(item.dataset.match, item.dataset.with));
        });
    },

    openChat(matchId, withUser) {
        this.currentMatch = { id: matchId, with: withUser };
        document.getElementById('chatHeader').textContent = '💬 ' + withUser;
        document.getElementById('chatInput').disabled = false;
        document.getElementById('sendChatBtn').disabled = false;
        document.querySelector('.tab-btn[data-page="chat"]').click();
        this.loadMessages();
    },

    async loadMessages() {
        if (!this.currentMatch) return;
        const r = await fetch('/api/solo/messages/' + this.currentMatch.id, { headers: { 'Authorization': `Bearer ${this.token}` } });
        const d = await r.json();
        const container = document.getElementById('chatMessages');
        container.innerHTML = (d.messages || []).map(m => {
            const isMine = m.sender === this.user.email;
            return `<div class="chat-msg ${isMine ? 'mine' : 'theirs'}">${this.esc(m.content)}</div>`;
        }).join('');
        container.scrollTop = container.scrollHeight;
    },

    async sendMessage() {
        const input = document.getElementById('chatInput');
        const content = input.value.trim();
        if (!content || !this.currentMatch) return;
        input.value = '';
        await fetch('/api/solo/message', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ matchId: this.currentMatch.id, content })
        });
        this.loadMessages();
    },

    startChatPoll() {
        setInterval(() => {
            if (this.currentMatch && document.getElementById('pageChat').classList.contains('active')) {
                this.loadMessages();
            }
        }, 3000);
    },

    async saveProfile() {
        const photos = document.getElementById('editPhotos').value.split(',').map(s => s.trim()).filter(s => s);
        const r = await fetch('/api/solo/me', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({
                pseudo: document.getElementById('editPseudo').value.trim(),
                age: parseInt(document.getElementById('editAge').value),
                country: document.getElementById('editCountry').value,
                city: document.getElementById('editCity').value.trim(),
                bio: document.getElementById('editBio').value.trim(),
                photos
            })
        });
        const d = await r.json();
        this.toast(d.success ? '✅ Profil sauvegardé' : '❌ Erreur');
        this.loadUser();
    },

    toast(msg) {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 2500);
    },

    esc(s) { return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
};

document.addEventListener('DOMContentLoaded', () => B.init());
