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

    async safeFetch(url, opts = {}) {
        var timeout = opts.timeout || 15000;
        var ctrl = new AbortController();
        var timer = setTimeout(function() { ctrl.abort(); }, timeout);
        try { var r = await fetch(url, Object.assign({}, opts, { signal: ctrl.signal })); clearTimeout(timer); return { ok: true, resp: r }; }
        catch (e) { clearTimeout(timer); return { ok: false, error: e.name === 'AbortError' ? 'Timeout' : e.message }; }
    },

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
        var r = await this.safeFetch('/api/solo/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: document.getElementById('loginField').value.trim(), password: document.getElementById('loginPassword').value }), timeout: 10000 });
        if (!r.ok) { this.showErr('Erreur réseau'); return; }
        var d = await r.resp.json();
        if (!d.success) return this.showErr(d.message);
        this.setToken(d.token);
        this.loadMain();
    },

    async register() {
        this.showErr('');
        var prefixEl = document.getElementById('phonePrefix');
        var prefix = prefixEl.textContent.replace(/[^0-9+]/g, '') || '+223';
        var phoneRaw = document.getElementById('regPhone').value.trim();
        var country = document.getElementById('regPhone').dataset.country || 'ML';
        var body = JSON.stringify({
            pseudo: document.getElementById('regPseudo').value.trim(),
            password: document.getElementById('regPassword').value,
            phone: prefix + phoneRaw, country: country,
            email: (document.getElementById('regEmail').value || '').trim(),
            gender: document.getElementById('regGender').value,
            age: parseInt(document.getElementById('regAge').value) || 25
        });
        var r = await this.safeFetch('/api/solo/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, timeout: 10000 });
        if (!r.ok) { this.showErr('Erreur réseau'); return; }
        var d = await r.resp.json();
        if (!d.success) return this.showErr(d.message);
        this.setToken(d.token);
        this.loadMain();
    },

    setToken(t) { this.token = t; localStorage.setItem('solo_token', t); },
    showErr(msg) { const el = document.getElementById('authError'); el.textContent = msg || ''; },

    async loadMain() {
        document.getElementById('soloLogin').style.display = 'none';
        document.getElementById('soloMain').style.display = 'block';
        await this.loadUser();
        this.bindEvents();
        this.loadProfiles();
        this.saveGeoLocation();
        this.loadUnreadCount();
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
        if (!r.ok) return this.logout();
        var d = await r.resp.json();
        if (!d.success) return this.logout();
        this.user = d.user;
        document.getElementById('userPlan').textContent = d.user.plan === 'free' ? 'Gratuit' : d.user.plan;
        document.getElementById('profilePseudo').textContent = d.user.pseudo || '-';
        var avatarEl = document.getElementById('profileAvatar');
        if (d.user.photos && d.user.photos.length > 0) { avatarEl.innerHTML = '<img src="' + this.esc(d.user.photos[0]) + '" alt="avatar">'; }
        else { avatarEl.innerHTML = '👤'; }
        var badgesEl = document.querySelector('.profile-badges');
        if (badgesEl) {
            var badges = '<span class="badge badge-new">Nouveau</span>';
            if (d.user.verified) badges += '<span class="badge badge-verified">✓ Vérifié</span>';
            if (d.user.plan !== 'free') badges += '<span class="badge badge-vip">VIP</span>';
            badgesEl.innerHTML = badges;
        }
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
        var verifyBtn = document.getElementById('verifyBtn');
        var verifyStatus = document.getElementById('verifyStatus');
        if (d.user.verified) {
            verifyBtn.textContent = '✅ Vérifié';
            verifyBtn.style.borderColor = '#4caf50';
            verifyBtn.style.color = '#4caf50';
            verifyBtn.disabled = true;
            verifyStatus.textContent = '';
        } else {
            verifyBtn.textContent = '✅ Vérifier mon compte';
            verifyBtn.style.borderColor = '#ff3b3b';
            verifyBtn.style.color = '#ff3b3b';
            verifyBtn.disabled = false;
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

    async uploadPhotos() {
        const files = document.getElementById('photoInput').files;
        const remaining = 5 - this.photoUrls.length;
        if (remaining <= 0) { this.toast('⚠️ Maximum 5 photos atteint'); document.getElementById('photoInput').value = ''; return; }
        const toUpload = Array.from(files).slice(0, remaining);
        for (const file of toUpload) {
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
        this.updatePhotoCounter();
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
        document.getElementById('refCopyBtn')?.addEventListener('click', () => this.copyRefLink());
        document.getElementById('refShareBtn')?.addEventListener('click', () => this.shareRefWhatsApp());
        document.getElementById('refClaimBtn')?.addEventListener('click', () => this.claimVIP());
        document.getElementById('addPhotoBtn')?.addEventListener('click', function() { document.getElementById('photoInput').click(); });
        document.getElementById('deleteAccountBtn')?.addEventListener('click', function() { B.deleteAccount(); });
        document.getElementById('deleteChatBtn')?.addEventListener('click', function() { B.deleteConversation(); });
        document.getElementById('verifyBtn')?.addEventListener('click', function() { B.sendVerifyCode(); });
        document.getElementById('verifyConfirmBtn')?.addEventListener('click', function() { B.confirmVerifyCode(); });
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
                document.getElementById('page' + btn.dataset.page.charAt(0).toUpperCase() + btn.dataset.page.slice(1)).classList.add('active');
                if (btn.dataset.page === 'browse') this.loadProfiles();
                if (btn.dataset.page === 'swipe') this.initSwipe();
                if (btn.dataset.page === 'matches') this.loadMatches();
                if (btn.dataset.page === 'likes') this.loadLikes();
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
        localStorage.removeItem('solo_token'); location.reload(); },

    async loadProfiles() {
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
        var r = await this.safeFetch('/api/solo/profiles?' + params, { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return;
        var d = await r.resp.json();
        var blocked = JSON.parse(localStorage.getItem('solo_blocked') || '[]');
        this.profiles = (d.profiles || []).filter(p => !blocked.includes(p.email));
        this.renderProfiles();
    },

    renderProfiles() {
        const grid = document.getElementById('profilesGrid');
        if (!this.profiles.length) { grid.innerHTML = '<p style="text-align:center;color:#666;padding:2rem">Aucun profil trouvé</p>'; return; }
        grid.innerHTML = this.profiles.map(p => {
            const photos = Array.isArray(p.photos) ? p.photos : typeof p.photos === 'string' ? p.photos.split(',').map(s => s.trim()).filter(s => s) : [];
            const img = photos[0] || '';
            const onlineClass = p.isOnline ? 'online' : '';
            const onlineDot = p.isOnline ? '<span class="online-dot"></span>' : '';
            return `<div class="profile-card ${onlineClass}" data-email="${this.esc(p.email)}">
                ${img ? `<img class="profile-photo" src="${this.esc(img)}" onerror="this.innerHTML='📷'">` : '<div class="profile-photo">📷</div>'}
                <div class="profile-info">
                    <div class="name">${this.esc(p.pseudo)}, ${p.age || '?'}${p.verified ? '<span class="verified-badge">✓</span>' : ''} ${onlineDot}</div>
                    <div class="meta">${p.profession ? this.esc(p.profession) + ' · ' : ''}${this.esc(p.city || '')} ${this.esc(p.country || '')}${p.distanceKm != null ? ' · <span style="color:#ff3b3b">📍 ' + p.distanceKm + ' km</span>' : ''}</div>
                    ${p.isOnline ? '<div style="font-size:.7rem;color:#4caf50;margin-top:.2rem">🟢 En ligne</div>' : ''}
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
        const onlineStatus = p.isOnline ? '<span style="color:#4caf50;font-size:.8rem">🟢 En ligne</span>' : '';
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.innerHTML = `<div class="modal-detail">
            ${photos.length > 0 ? photos.map(u => `<img src="${this.esc(u)}" onerror="this.style.display='none'">`).join('') : ''}
            <div class="detail-info">
                <div class="detail-name">${this.esc(p.pseudo)}, ${p.age || '?'} ${p.verified ? '<span class="verified-badge">✓</span>' : ''} ${onlineStatus}</div>
                <div class="detail-meta">${this.esc(p.gender)} · ${p.profession ? this.esc(p.profession) + ' · ' : ''}${this.esc(p.city || '')} ${this.esc(p.country || '')}</div>
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
            <div class="match-avatar">💘</div><span class="match-name">${this.esc(m.pseudo || m.with)}</span>
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
        this.sseSource = new EventSource('/api/solo/chat/stream/' + matchId + '?token=' + this.token);
        this.sseSource.onmessage = function(e) {
            if (!self.currentMatch || self.currentMatch.id !== matchId) return;
            try { self.loadMessages(); } catch(err) {}
        };
        this.sseSource.onerror = function() {
            setTimeout(function() { if (self.currentMatch && self.currentMatch.id === matchId) self.startSSE(matchId); }, 5000);
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

    async loadReferral() {
        var r = await this.safeFetch('/api/solo/referral', { headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return;
        var d = await r.resp.json();
        if (!d.success) return;
        var link = window.location.origin + '/solo.html?ref=' + d.referralCode;
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
        var r = await this.safeFetch('/api/solo/referral/claim', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token } });
        var d = r.ok ? await r.resp.json() : {};
        if (d.success) { this.toast('VIP active pour 24h'); this.loadUser(); this.loadReferral(); }
        else { this.toast((d && d.message) || 'Erreur'); }
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

    async sendVerifyCode() {
        var r = await this.safeFetch('/api/solo/verify/send', { method: 'POST', headers: { 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) return this.toast('Erreur envoi code');
        document.getElementById('verifyBtn').style.display = 'none';
        document.getElementById('verifyCode').style.display = 'block';
        document.getElementById('verifyConfirmBtn').style.display = 'block';
        document.getElementById('verifyCode').focus();
        this.toast('Code envoyé (vérifie la console serveur)');
    },

    async confirmVerifyCode() {
        var code = document.getElementById('verifyCode').value.trim();
        if (code.length < 6) return this.toast('Code incomplet');
        var r = await this.safeFetch('/api/solo/verify/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token }, body: JSON.stringify({ code: code }) });
        var d = r.ok ? await r.resp.json() : {};
        if (d.success) {
            this.toast('Compte verifie');
            this.loadUser();
            document.getElementById('verifyCode').style.display = 'none';
            document.getElementById('verifyConfirmBtn').style.display = 'none';
        } else { this.toast(d.message || 'Code invalide'); }
    },

    async verifyBySelfie() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'user';
        input.onchange = async function() {
            var file = input.files[0];
            if (!file) return;
            if (file.size > 5 * 1024 * 1024) { B.toast('Image trop lourde (max 5MB)'); return; }
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
        if (c) params.set('country', c);
        if (g) params.set('gender', g);
        var r = await this.safeFetch('/api/solo/annonces?' + params);
        if (!r.ok) return;
        var d = await r.resp.json();
        this.renderAnnonces(d.annonces || []);
    },

    renderAnnonces(annonces) {
        var list = document.getElementById('annoncesList');
        if (!annonces.length) { list.innerHTML = '<p style="text-align:center;color:#666;padding:2rem">Aucune annonce pour le moment</p>'; return; }
        var now = Date.now();
        list.innerHTML = annonces.map(function(a) {
            var photos = Array.isArray(a.photos) ? a.photos : [];
            var img = photos[0] || '';
            var expires = new Date(a.expires_at).getTime();
            var daysLeft = Math.max(0, Math.ceil((expires - now) / (1000 * 60 * 60 * 24)));
            var isMine = a.user_id === B.user?.email;
            return '<div class="annonce-card" data-id="' + a.id + '">' +
                '<div class="annonce-header"><div><div class="annonce-title">' + B.esc(a.title) + '</div><div class="annonce-meta">' + B.esc(a.pseudo) + ', ' + (a.age || '?') + ' · ' + B.esc(a.city || '') + ' ' + B.esc(a.country || '') + '</div></div>' +
                (img ? '<div class="annonce-photo" style="background-image:url(\'' + B.esc(img) + '\')"></div>' : '') +
                '</div>' +
                '<div class="annonce-desc">' + B.esc(a.description) + '</div>' +
                (a.looking_for ? '<div class="annonce-looking">❤️ ' + B.esc(a.looking_for) + '</div>' : '') +
                '<div class="annonce-footer">' +
                    '<span class="annonce-expire">⏱️ ' + daysLeft + 'j restant' + (daysLeft > 1 ? 's' : '') + '</span>' +
                    (isMine ? '<button class="annonce-delete" onclick="B.deleteAnnonce(' + a.id + ')">🗑️ Supprimer</button>' : '<button class="annonce-respond" onclick="B.respondToAnnonce(' + a.id + ')">💬 Répondre</button>') +
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
                '<div style="display:flex;gap:.5rem;margin-bottom:.7rem">' +
                    '<select id="annonceCountry" style="flex:1;padding:.7rem;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.04);color:#eee;font-size:.85rem;outline:none">' +
                        '<option value="ML">Mali</option><option value="CI">Côte d\'Ivoire</option><option value="SN">Sénégal</option><option value="BF">Burkina Faso</option><option value="GN">Guinée</option><option value="CM">Cameroun</option>' +
                    '</select>' +
                    '<input type="text" id="annonceCity" placeholder="Ville" style="flex:1;padding:.7rem;border-radius:12px;border:1px solid rgba(255,255,255,.06);background:rgba(255,255,255,.04);color:#eee;font-size:.85rem;outline:none">' +
                '</div>' +
                '<p style="color:#555;font-size:.7rem;margin-bottom:.7rem">📸 Photos (optionnel, max 3)</p>' +
                '<input type="file" id="annoncePhotos" accept="image/*" multiple style="margin-bottom:1rem">' +
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
            if (file.size > 3 * 1024 * 1024) continue;
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
            body: JSON.stringify({ title: title, description: desc, looking_for: document.getElementById('annonceLooking').value, photos: photos })
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
        var r = await this.safeFetch('/api/solo/annonces/' + id + '/respond', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + this.token } });
        if (!r.ok) { this.toast('Erreur réseau'); return; }
        var d = await r.resp.json();
        if (d.matched) { this.toast('💘 Match ! Allez dans Chat pour discuter'); this.openChat(d.matchId, ''); }
        else this.toast('Réponse envoyée');
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
    }
};

document.addEventListener('DOMContentLoaded', () => B.init());
