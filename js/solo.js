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
        const prefixMap = { ML:'+223',CI:'+225',SN:'+221',BF:'+226',GN:'+224',CM:'+237',BJ:'+229',TG:'+228',NG:'+234',GH:'+233',NE:'+227',TD:'+235',CD:'+243',CG:'+242',GA:'+241' };
        document.getElementById('regCountry').addEventListener('change', function() {
            const p = prefixMap[this.value] || '+223';
            document.getElementById('phonePrefix').textContent = p;
            document.getElementById('regPhone').dataset.country = this.value;
            document.getElementById('regPhone').focus();
        });
        document.getElementById('regCountry').dispatchEvent(new Event('change'));
    },

    async login() {
        this.showErr('');
        const r = await fetch('/api/solo/login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: document.getElementById('loginField').value.trim(), password: document.getElementById('loginPassword').value })
        });
        const d = await r.json();
        if (!d.success) return this.showErr(d.message);
        this.setToken(d.token);
        this.loadMain();
    },

    async register() {
        this.showErr('');
        const prefixEl = document.getElementById('phonePrefix');
        const prefix = prefixEl.textContent.replace(/[^0-9+]/g, '') || '+223';
        const phoneRaw = document.getElementById('regPhone').value.trim();
        const country = document.getElementById('regPhone').dataset.country || 'ML';
        const r = await fetch('/api/solo/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pseudo: document.getElementById('regPseudo').value.trim(),
                password: document.getElementById('regPassword').value,
                phone: prefix + phoneRaw,
                email: document.getElementById('regEmail').value.trim() || '',
                country: country,
                gender: document.getElementById('regGender').value,
                age: parseInt(document.getElementById('regAge').value) || 25
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
        const visited = localStorage.getItem('solo_visited');
        if (!visited) {
            localStorage.setItem('solo_visited', '1');
            setTimeout(() => this.toast('👋 Bienvenue ! Complète ton profil pour attirer plus de matchs'), 500);
        }
    },

    async loadUser() {
        const r = await fetch('/api/solo/me', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const d = await r.json();
        if (!d.success) return this.logout();
        this.user = d.user;
        document.getElementById('userPlan').textContent = d.user.plan === 'free' ? 'Gratuit' : d.user.plan;
        document.getElementById('editPseudo').value = d.user.pseudo || '';
        document.getElementById('editProfession').value = d.user.profession || '';
        document.getElementById('editLooking').value = d.user.looking_for || '';
        document.getElementById('editInterests').value = (d.user.interests || []).join(', ');
        document.getElementById('editAge').value = d.user.age || '';
        document.getElementById('editCountry').value = d.user.country || 'ML';
        document.getElementById('editCity').value = d.user.city || '';
        document.getElementById('editBio').value = d.user.bio || '';
        document.getElementById('editStatus').value = d.user.status || '';
        document.getElementById('editReligion').value = d.user.religion || '';
        document.getElementById('editChildren').value = d.user.children || '';
        this.photoUrls = (d.user.photos || []).slice();
        document.getElementById('editPhotosPrivate').checked = localStorage.getItem('solo_photos_private') === '1';
        this.renderPhotoPreviews();
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
    },

    async uploadPhotos() {
        const files = document.getElementById('photoInput').files;
        for (const file of files) {
            if (file.size > 3 * 1024 * 1024) { this.toast('Photo trop lourde (max 3MB)'); continue; }
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
                reader.readAsDataURL(file);
            });
        }
        document.getElementById('photoInput').value = '';
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
        document.getElementById('ecoBtn')?.addEventListener('click', () => this.toggleEco());
        document.getElementById('shareBtn')?.addEventListener('click', () => this.shareWhatsApp());
        document.getElementById('refCopyBtn')?.addEventListener('click', () => this.copyRefLink());
        document.getElementById('refShareBtn')?.addEventListener('click', () => this.shareRefWhatsApp());
        document.getElementById('refClaimBtn')?.addEventListener('click', () => this.claimVIP());
        document.getElementById('addPhotoBtn')?.addEventListener('click', () => document.getElementById('photoInput').click());
        document.getElementById('deleteAccountBtn')?.addEventListener('click', () => this.deleteAccount());
        document.getElementById('deleteChatBtn')?.addEventListener('click', () => this.deleteConversation());
        document.getElementById('swipeLike')?.addEventListener('click', () => this.swipeAction(true));
        document.getElementById('swipePass')?.addEventListener('click', () => this.swipeAction(false));
        document.getElementById('swipeSuper')?.addEventListener('click', () => this.swipeAction(true, true));
        document.getElementById('matchChatBtn')?.addEventListener('click', () => { document.getElementById('matchOverlay').style.display = 'none'; document.querySelector('.tab-btn[data-page="chat"]').click(); });
        document.getElementById('matchCloseBtn')?.addEventListener('click', () => document.getElementById('matchOverlay').style.display = 'none');
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
                document.getElementById('page' + btn.dataset.page.charAt(0).toUpperCase() + btn.dataset.page.slice(1)).classList.add('active');
                if (btn.dataset.page === 'browse') this.loadProfiles();
                if (btn.dataset.page === 'swipe') this.initSwipe();
                if (btn.dataset.page === 'matches') this.loadMatches();
                if (btn.dataset.page === 'likes') this.loadLikes();
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
        const blocked = JSON.parse(localStorage.getItem('solo_blocked') || '[]');
        this.profiles = (d.profiles || []).filter(p => !blocked.includes(p.email));
        this.renderProfiles();
    },

    renderProfiles() {
        const grid = document.getElementById('profilesGrid');
        if (!this.profiles.length) { grid.innerHTML = '<p style="text-align:center;color:#666;padding:2rem">Aucun profil trouvé</p>'; return; }
        grid.innerHTML = this.profiles.map(p => {
            const photos = Array.isArray(p.photos) ? p.photos : typeof p.photos === 'string' ? p.photos.split(',').map(s => s.trim()).filter(s => s) : [];
            const img = photos[0] || '';
            return `<div class="profile-card" data-email="${this.esc(p.email)}">
                ${img ? `<img class="profile-photo" src="${this.esc(img)}" onerror="this.innerHTML='📷'">` : '<div class="profile-photo">📷</div>'}
                <div class="profile-info">
                    <div class="name">${this.esc(p.pseudo)}, ${p.age || '?'}</div>
                    <div class="meta">${p.profession ? this.esc(p.profession) + ' · ' : ''}${this.esc(p.city || '')} ${this.esc(p.country || '')}</div>
                    ${p.looking_for ? `<div style="font-size:.7rem;color:#ff3b3b;margin-top:.2rem">❤️ ${this.esc(p.looking_for)}</div>` : ''}
                    <div class="actions"><button class="btn-like" onclick="B.like('${this.esc(p.email)}')">❤️ J'aime</button></div>
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
            ${photos.length > 0 ? photos.map(u => `<img src="${this.esc(u)}" onerror="this.style.display='none'">`).join('') : ''}
            <div class="detail-info">
                <div class="detail-name">${this.esc(p.pseudo)}, ${p.age || '?'}</div>
                <div class="detail-meta">${this.esc(p.gender)} · ${p.profession ? this.esc(p.profession) + ' · ' : ''}${this.esc(p.city || '')} ${this.esc(p.country || '')}</div>
                ${p.looking_for ? `<div style="color:#ff3b3b;font-size:.85rem;margin:.3rem 0">❤️ ${this.esc(p.looking_for)}</div>` : ''}
                ${p.interests && p.interests.length > 0 ? `<div style="color:#999;font-size:.75rem;margin:.3rem 0">🏷️ ${p.interests.map(i => this.esc(i)).join(', ')}</div>` : ''}
                ${p.bio ? `<div class="detail-bio">${this.esc(p.bio)}</div>` : ''}
                <div class="detail-actions">
                    <button class="btn-like" onclick="B.like('${this.esc(p.email)}');document.querySelector('.modal-overlay').remove()">❤️ J'aime</button>
                    <button class="btn-close-detail" onclick="this.closest('.modal-overlay').remove()">Fermer</button>
                    <button class="btn-block" onclick="B.blockUser('${this.esc(p.email)}');document.querySelector('.modal-overlay').remove()" title="Bloquer">🚫</button>
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
        const btns = document.querySelectorAll(`.profile-card[data-email="${targetEmail}"] .btn-like, .detail-actions .btn-like`);
        btns.forEach(b => { b.classList.add('liked'); b.textContent = '❤️ Liké'; });
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
            <div class="match-avatar">💘</div><span class="match-name">${this.esc(m.pseudo || m.with)}</span>
        </div>`).join('');
        document.querySelectorAll('.match-item').forEach(item => {
            item.addEventListener('click', () => this.openChat(item.dataset.match, item.dataset.with));
        });
    },

    async loadLikes() {
        const r = await fetch('/api/solo/likes-received', { headers: { 'Authorization': `Bearer ${this.token}` } });
        const d = await r.json();
        const list = document.getElementById('likesList');
        if (!d.likes || !d.likes.length) { list.innerHTML = '<p style="text-align:center;color:#666;padding:2rem">Personne ne t\'a encore liké</p>'; return; }
        list.innerHTML = d.likes.map(l => {
            const blur = this.user.plan === 'free' ? 'filter:blur(8px)' : '';
            const name = this.user.plan === 'free' ? '?????' : l.pseudo;
            const meta = this.user.plan === 'free' ? 'Passe VIP pour voir' : `${l.age || '?'} · ${l.country || ''}`;
            return `<div class="match-item"><div class="match-avatar" style="background:#1a1a2e;${blur}">👤</div><span class="match-name">${name}</span><br><span style="color:#888;font-size:.7rem">${meta}</span></div>`;
        }).join('');
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
            const time = (m.created_at || m.time || '').substring(11, 16) || '';
            return `<div class="chat-msg ${isMine ? 'mine' : 'theirs'}">${this.esc(m.content)}<div class="chat-time ${isMine ? 'msg-time-right' : ''}">${time}</div></div>`;
        }).join('');
        container.scrollTop = container.scrollHeight;
    },

    async sendMessage() {
        const input = document.getElementById('chatInput');
        const content = input.value.trim();
        if (!content || !this.currentMatch) return;
        input.value = '';
        const r = await fetch('/api/solo/message', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({ matchId: this.currentMatch.id, content })
        });
        const d = await r.json();
        if (d.warning) this.toast(d.warning);
        if (r.status === 429) this.toast('⚠️ ' + (d.message || 'Limite atteinte'));
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
        const photos = this.photoUrls;
        const photosPrivate = document.getElementById('editPhotosPrivate').checked;
        localStorage.setItem('solo_photos_private', photosPrivate ? '1' : '0');
        const interests = document.getElementById('editInterests').value.split(',').map(s => s.trim()).filter(s => s);
        const r = await fetch('/api/solo/me', {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this.token}` },
            body: JSON.stringify({
                pseudo: document.getElementById('editPseudo').value.trim(),
                profession: document.getElementById('editProfession').value.trim(),
                looking_for: document.getElementById('editLooking').value,
                interests,
                age: parseInt(document.getElementById('editAge').value),
                country: document.getElementById('editCountry').value,
                city: document.getElementById('editCity').value.trim(),
                bio: document.getElementById('editBio').value.trim(),
                status: document.getElementById('editStatus').value,
                religion: document.getElementById('editReligion').value,
                children: document.getElementById('editChildren').value,
                photos
            })
        });
        const d = await r.json();
        if (d.success) { this.toast('✅ Profil sauvegardé'); this.updateScore(); }
        else this.toast('❌ Erreur');
        this.loadUser();
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
        card.innerHTML = `
            <div class="swipe-photo">${photos[0] ? `<img src="${this.esc(photos[0])}" onerror="this.parentElement.innerHTML='📷'">` : '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:3rem;color:#555">📷</div>'}</div>
            <div class="swipe-info">
                <div class="swipe-name">${this.esc(p.pseudo)}, ${p.age || '?'}</div>
                <div class="swipe-meta">${p.profession ? this.esc(p.profession) + ' · ' : ''}${this.esc(p.city || '')} ${this.esc(p.country || '')}</div>
                ${p.looking_for ? `<div class="swipe-looking">❤️ ${this.esc(p.looking_for)}</div>` : ''}
                ${p.interests && p.interests.length > 0 ? `<div class="swipe-interests">${p.interests.map(x => '#' + this.esc(x)).join(' ')}</div>` : ''}
                ${p.bio ? `<div class="swipe-bio">${this.esc(p.bio)}</div>` : ''}
            </div>
        `;
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

    ecoMode: false,
    toggleEco() {
        this.ecoMode = !this.ecoMode;
        document.body.classList.toggle('eco-mode', this.ecoMode);
        document.getElementById('ecoBtn').textContent = this.ecoMode ? '📵✅' : '📵';
        this.toast(this.ecoMode ? 'Mode Éco ON — sans images' : 'Mode Éco OFF — avec images');
    },

    shareWhatsApp() {
        const url = encodeURIComponent('https://solodesir.com');
        const text = encodeURIComponent('Salut ! Découvre Solo — le site de rencontres africaines. Inscris-toi :');
        window.open(`https://wa.me/?text=${text}%20${url}`, '_blank');
    },

    async loadReferral() {
        try {
            const r = await fetch('/api/solo/referral', { headers: { 'Authorization': `Bearer ${this.token}` } });
            const d = await r.json();
            if (!d.success) return;
            const link = window.location.origin + '/solo.html?ref=' + d.referralCode;
            document.getElementById('refLink').value = link;
            document.getElementById('refCount').textContent = d.referralsCount + '/3';
            document.getElementById('refFill').style.width = Math.min(d.referralsCount / 3 * 100, 100) + '%';
            if (d.referralsCount >= 3 && d.plan === 'free') {
                document.getElementById('refClaimBtn').style.display = 'block';
            }
            if (d.plan !== 'free') {
                document.getElementById('refClaimBtn').style.display = 'none';
                document.getElementById('refCount').textContent = 'VIP actif';
            }
        } catch (e) {}
    },

    copyRefLink() {
        var input = document.getElementById('refLink');
        input.select(); navigator.clipboard.writeText(input.value).catch(() => document.execCommand('copy'));
        this.toast('Lien copié ✅');
    },

    shareRefWhatsApp() {
        var link = encodeURIComponent(document.getElementById('refLink').value);
        var text = encodeURIComponent('Rejoins-moi sur Solo — rencontres africaines :');
        window.open('https://wa.me/?text=' + text + '%20' + link, '_blank');
    },

    async claimVIP() {
        var r = await fetch('/api/solo/referral/claim', {
            method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token }
        });
        var d = await r.json();
        if (d.success) { this.toast('VIP active pour 24h'); this.loadUser(); this.loadReferral(); }
        else { this.toast(d.message || 'Erreur'); }
    },

    async deleteAccount() {
        if (!confirm('Supprimer définitivement ton compte ? Tous les messages, matchs et donnees seront effaces.')) return;
        await fetch('/api/solo/me', { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + this.token } });
        this.logout();
    },

    async deleteConversation() {
        if (!this.currentMatch || !confirm('Effacer cette conversation ?')) return;
        await fetch('/api/solo/conversation/' + this.currentMatch.id, { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + this.token } });
        document.getElementById('chatMessages').innerHTML = '';
        this.toast('Conversation effacee');
        document.querySelector('.tab-btn[data-page="matches"]').click();
        this.loadMatches();
    }
};

document.addEventListener('DOMContentLoaded', () => B.init());
