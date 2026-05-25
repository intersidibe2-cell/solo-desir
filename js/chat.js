const CHAT = {
    currentCharacter: 'Aminata',
    messages: [],
    isTyping: false,
    voiceEnabled: false,
    discreteMode: false,
    conversationHistory: [],
    customCharacters: [],
    creatorStep: 0,

    characters: {
        'Aminata': {
            name: 'Aminata',
            avatar: 'A',
            color: 'linear-gradient(135deg,#FF3B7F,#6C2BD9)',
            voiceStyle: 'douce',
            bio: 'Je suis là pour t\'écouter, te comprendre et te guider vers le plaisir.',
            official: true
        },
        'Zara': {
            name: 'Zara',
            avatar: 'Z',
            color: 'linear-gradient(135deg,#FF6B6B,#FF3B7F)',
            voiceStyle: 'coquine',
            bio: 'J\'aime les jeux et les défis. Prêt à t\'amuser avec moi ?',
            official: true
        },
        'Grace': {
            name: 'Grace',
            avatar: 'G',
            color: 'linear-gradient(135deg,#845EC2,#D65DB1)',
            voiceStyle: 'guide',
            bio: 'Ferme les yeux. Inspire. Je vais te guider pas à pas.',
            official: true
        },
        'Amadou': {
            name: 'Amadou',
            avatar: 'A',
            color: 'linear-gradient(135deg,#2D3436,#636E72)',
            voiceStyle: 'guide',
            bio: 'Je suis là pour toi ma chérie. Laisse-toi aller entre mes mains.',
            official: true
        },
        'Nala': {
            name: 'Nala',
            avatar: 'N',
            color: 'linear-gradient(135deg,#FF9671,#FFC75F)',
            voiceStyle: 'coquine',
            bio: 'Je sais ce que tu veux. N\'aie pas peur, laisse-toi aller.',
            official: true
        },
        'Khalid': {
            name: 'Khalid',
            avatar: 'K',
            color: 'linear-gradient(135deg,#0D0D1A,#2D3436)',
            voiceStyle: 'coquine',
            bio: 'J\'aime les femmes qui savent ce qu\'elles veulent. Montre-moi.',
            official: true
        },
        'Samuel': {
            name: 'Samuel',
            avatar: 'S',
            color: 'linear-gradient(135deg,#1A5276,#2E86C1)',
            voiceStyle: 'guide',
            bio: 'Découvre ton corps avec moi. Chaque étape est un voyage.',
            official: true
        }
    },

    async init() {
        this.bindEvents();
        this.loadCharacter('Aminata');

        const params = new URLSearchParams(window.location.search);
        const charName = params.get('char');
        if (charName && this.characters[charName]) {
            this.loadCharacter(charName);
        }

        await this.loadUserData();
        await this.loadCustomCharacters();
        ANALYTICS.capture('app_opened', { character: charName || 'Aminata' });
    },

    async loadUserData() {
        const user = await API.getUser();
        if (user) {
            document.getElementById('userDisplayName').textContent = user.pseudo || 'Invité';
            document.getElementById('userPlan').textContent = user.planLabel || 'Gratuit';
            if (user.messagesLeft !== undefined) {
                this.updateMsgCounter(user.messagesLeft);
            }
            if (user.plan !== 'free') {
                document.getElementById('premiumPrompt').textContent = 'Plan actif, profite !';
                document.getElementById('upgradeBtn').textContent = 'Gérer mon abonnement';
            }
        }
    },

    updateMsgCounter(count) {
        const el = document.getElementById('msgCountValue');
        if (el) {
            el.textContent = count;
            el.style.color = count <= 2 ? '#FF6B6B' : count <= 5 ? '#FFD93D' : '#6BCB77';
        }
    },

    async loadCustomCharacters() {
        const user = await API.getUser();
        if (!user) return;
        const chars = await API.getCustomCharacters();
        this.customCharacters = chars || [];
        const container = document.getElementById('customCharacterList');
        const section = document.getElementById('customCharsList');
        if (!container) return;
        container.innerHTML = '';
        if (chars.length === 0) { section.style.display = 'none'; return; }
        section.style.display = 'block';
        chars.forEach(c => {
            const el = document.createElement('div');
            el.className = 'character-item';
            el.dataset.character = c.id;
            const initial = c.name.charAt(0).toUpperCase();
            const colors = ['#FF3B7F','#6C2BD9','#FF6B6B','#845EC2','#FF9671','#2D3436','#1A5276'];
            const color = colors[c.id.charCodeAt(0) % colors.length];
            el.innerHTML = `
                <div class="char-avatar" style="background:${color};">${initial}</div>
                <div class="char-info">
                    <span class="char-name">${c.name}</span>
                    <span class="char-status">${c.gender === 'masculin' ? 'Homme' : 'Femme'} · ${c.nationality}</span>
                </div>
                <button class="char-delete-btn" onclick="CHAT.deleteCustomCharacter('${c.id}')" title="Supprimer"><i class="fas fa-trash-can"></i></button>
            `;
            el.addEventListener('click', (e) => {
                if (e.target.closest('.char-delete-btn')) return;
                document.querySelectorAll('.character-item').forEach(i => i.classList.remove('active'));
                el.classList.add('active');
                this.loadCharacter(c.id);
            });
            container.appendChild(el);
        });
    },

    async deleteCustomCharacter(id) {
        if (!confirm('Supprimer ce personnage ?')) return;
        await API.deleteCustomCharacter(id);
        await this.loadCustomCharacters();
        if (this.currentCharacter === id) {
            this.loadCharacter('Aminata');
        }
        this.showToast('Personnage supprimé');
    },

    openCreator() {
        this.creatorStep = 0;
        this.renderCreator();
        document.getElementById('charCreatorModal').classList.add('active');
    },

    closeCreator() {
        document.getElementById('charCreatorModal').classList.remove('active');
    },

    creatorData: {},

    renderCreator() {
        const body = document.getElementById('charCreatorBody');
        const s = this.creatorStep;
        const d = this.creatorData;
        const total = 5;
        const steps = [
            { title: 'Prénom', icon: 'fa-pen' },
            { title: 'Genre', icon: 'fa-venus-mars' },
            { title: 'Origine', icon: 'fa-globe' },
            { title: 'Personnalité', icon: 'fa-heart' },
            { title: 'Voix & Bio', icon: 'fa-microphone' }
        ];

        const nav = steps.map((st, i) =>
            `<div class="creator-step-dot ${i === s ? 'active' : i < s ? 'done' : ''}">
                <i class="fas ${st.icon}"></i>
                <span>${st.title}</span>
            </div>`
        ).join('');

        let content = '';
        if (s === 0) {
            content = `
                <h2>Donne-lui un prénom</h2>
                <p style="color:var(--text-secondary);margin-bottom:1.5rem;">Choisis le prénom de ton compagnon ou ta compagne</p>
                <input type="text" id="creatorName" class="creator-input" placeholder="Prénom..." value="${d.name || ''}" maxlength="20" autofocus>
                <div style="margin-top:1rem;display:flex;flex-wrap:wrap;gap:0.5rem;">
                    ${['Aminata','Zara','Grace','Nala','Mamadou','Khalid','Samuel','Fatou','Kadija','Awa','Issa','Samba'].map(n =>
                        `<button class="btn btn-sm ${d.name === n ? 'btn-primary' : 'btn-outline'}" onclick="CHAT.creatorPickName('${n}')">${n}</button>`
                    ).join('')}
                </div>
            `;
        } else if (s === 1) {
            content = `
                <h2>Genre</h2>
                <p style="color:var(--text-secondary);margin-bottom:1.5rem;">Tu veux un compagnon ou une compagne ?</p>
                <div class="creator-gender-grid">
                    <div class="creator-gender-card ${d.gender !== 'masculin' ? 'selected' : ''}" onclick="CHAT.creatorPickGender('feminin')">
                        <i class="fas fa-venus" style="font-size:2rem;color:#FF3B7F;"></i>
                        <h3>Femme</h3>
                        <p>Une compagne douce, sensuelle</p>
                    </div>
                    <div class="creator-gender-card ${d.gender === 'masculin' ? 'selected' : ''}" onclick="CHAT.creatorPickGender('masculin')">
                        <i class="fas fa-mars" style="font-size:2rem;color:#2E86C1;"></i>
                        <h3>Homme</h3>
                        <p>Un compagnon fort, rassurant</p>
                    </div>
                </div>
            `;
        } else if (s === 2) {
            content = `
                <h2>Son origine</h2>
                <p style="color:var(--text-secondary);margin-bottom:1.5rem;">D'où vient-${d.gender === 'masculin' ? 'il' : 'elle'} ?</p>
                <div style="display:flex;flex-wrap:wrap;gap:0.5rem;justify-content:center;">
                    ${[
                        {v:'Sénégalaise',f:'🇸🇳'},{v:'Ivoirienne',f:'🇨🇮'},{v:'Malienne',f:'🇲🇱'},
                        {v:'Guinéenne',f:'🇬🇳'},{v:'Burkinabè',f:'🇧🇫'},{v:'Béninoise',f:'🇧🇯'},
                        {v:'Nigériane',f:'🇳🇬'},{v:'Togolaise',f:'🇹🇬'},{v:'Ghanéenne',f:'🇬🇭'},
                        {v:'Française',f:'🇫🇷'},{v:'Africaine',f:'🌍'}
                    ].map(n =>
                        `<div class="creator-pill ${d.nationality === n.v ? 'selected' : ''}" onclick="CHAT.creatorPickNationality('${n.v}')">${n.f} ${n.v}</div>`
                    ).join('')}
                </div>
            `;
        } else if (s === 3) {
            const p = d.personality || { passion: 3, romance: 3, talk: 3, timide: 3 };
            content = `
                <h2>Sa personnalité</h2>
                <p style="color:var(--text-secondary);margin-bottom:1.5rem;">Règle son caractère avec les curseurs</p>
                <div class="creator-sliders">
                    <div class="slider-group">
                        <label>Doux(ce) <span>━━━━━━━○━━━━━━</span> Passionné(e)</label>
                        <input type="range" min="1" max="5" value="${p.passion}" oninput="CHAT.creatorSetPersonality('passion',this.value)">
                        <div class="slider-labels"><span>Doux(ce)</span><span>Passionné(e)</span></div>
                    </div>
                    <div class="slider-group">
                        <label>Romantique <span>━━━━━━━○━━━━━━</span> Direct(e)</label>
                        <input type="range" min="1" max="5" value="${p.romance}" oninput="CHAT.creatorSetPersonality('romance',this.value)">
                        <div class="slider-labels"><span>Romantique</span><span>Direct(e)</span></div>
                    </div>
                    <div class="slider-group">
                        <label>Parleur(se) <span>━━━━━━━○━━━━━━</span> Écouteur(se)</label>
                        <input type="range" min="1" max="5" value="${p.talk}" oninput="CHAT.creatorSetPersonality('talk',this.value)">
                        <div class="slider-labels"><span>Parleur(se)</span><span>Écouteur(se)</span></div>
                    </div>
                    <div class="slider-group">
                        <label>Timide <span>━━━━━━━○━━━━━━</span> Audacieux(se)</label>
                        <input type="range" min="1" max="5" value="${p.timide}" oninput="CHAT.creatorSetPersonality('timide',this.value)">
                        <div class="slider-labels"><span>Timide</span><span>Audacieux(se)</span></div>
                    </div>
                </div>
            `;
        } else if (s === 4) {
            const voices = [
                { id: '21m00Tcm4TlvDq8ikWAM', label: 'Douce et sensuelle', icon: '🎤' },
                { id: 'EXAVITQu4vrRV1NfG6UX', label: 'Coquine et taquine', icon: '🎭' },
                { id: 'IKNe3O0S0J5wq6SOh5qV', label: 'Guide apaisante', icon: '🧘' },
                { id: 'ODIh6NmKjOBx8pVQZnAl', label: 'Enjôleuse', icon: '✨' },
                { id: 'AZnzlk1XvdvUeBnXmlld', label: 'Grave et rassurante', icon: '🎙️' },
                { id: 'pMsXgVXo2KuY3XObN2Vn', label: 'Chaude et passionnée', icon: '🔥' },
                { id: 'ThT5KcBeYPX3keUxqAb3', label: 'Encourageante', icon: '💪' }
            ];
            content = `
                <h2>Sa voix et sa devise</h2>
                <p style="color:var(--text-secondary);margin-bottom:1.5rem;">Choisis sa voix et donne-lui une phrase d'accroche</p>
                <div style="margin-bottom:1rem;">
                    <label style="margin-bottom:0.5rem;display:block;">Voix</label>
                    <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
                        ${voices.map(v =>
                            `<div class="creator-pill ${d.voiceId === v.id ? 'selected' : ''}" onclick="CHAT.creatorPickVoice('${v.id}')">${v.icon} ${v.label}</div>`
                        ).join('')}
                    </div>
                </div>
                <div class="form-group">
                    <label>Sa phrase d'accroche</label>
                    <input type="text" id="creatorBio" class="creator-input" placeholder="Ex: Je suis là pour toi, rien que pour toi..." value="${d.bio || ''}">
                </div>
                <div class="creator-preview">
                    <p style="font-style:italic;color:var(--text-secondary);">
                        "${d.name || 'Prénom'} · ${d.gender === 'masculin' ? 'Homme' : 'Femme'} · ${d.nationality || 'Africaine'}"
                    </p>
                </div>
            `;
        }

        body.innerHTML = `
            <div class="creator-header">
                <div class="creator-steps">${nav}</div>
                <div class="creator-progress">
                    <div class="creator-progress-bar" style="width:${((s+1)/total)*100}%"></div>
                </div>
            </div>
            <div class="creator-content">${content}</div>
            <div class="creator-footer">
                ${s > 0 ? `<button class="btn btn-outline" onclick="CHAT.creatorPrev()"><i class="fas fa-arrow-left"></i> Retour</button>` : '<div></div>'}
                ${s < total - 1
                    ? `<button class="btn btn-primary" onclick="CHAT.creatorNext()">Suivant <i class="fas fa-arrow-right"></i></button>`
                    : `<button class="btn btn-primary" onclick="CHAT.saveCustomCharacter()"><i class="fas fa-heart"></i> Créer ${(d.name || 'mon crush')}</button>`
                }
            </div>
        `;
    },

    creatorPickName(name) {
        this.creatorData.name = name;
        document.getElementById('creatorName').value = name;
        this.renderCreator();
    },

    creatorPickGender(g) {
        this.creatorData.gender = g;
        if (!this.creatorData.nationality && g === 'masculin') this.creatorData.nationality = 'Sénégalais';
        this.renderCreator();
    },

    creatorPickNationality(n) {
        this.creatorData.nationality = n;
        this.renderCreator();
    },

    creatorSetPersonality(key, val) {
        if (!this.creatorData.personality) this.creatorData.personality = { passion: 3, romance: 3, talk: 3, timide: 3 };
        this.creatorData.personality[key] = parseInt(val);
    },

    creatorPickVoice(id) {
        this.creatorData.voiceId = id;
        this.renderCreator();
    },

    creatorNext() {
        const d = this.creatorData;
        if (this.creatorStep === 0) {
            const name = document.getElementById('creatorName')?.value.trim();
            if (!name) { this.showToast('Choisis un prénom'); return; }
            d.name = name;
        }
        if (this.creatorStep === 3 && !d.personality) {
            d.personality = { passion: 3, romance: 3, talk: 3, timide: 3 };
        }
        this.creatorStep++;
        this.renderCreator();
    },

    creatorPrev() {
        if (this.creatorStep > 0) this.creatorStep--;
        this.renderCreator();
    },

    async saveCustomCharacter() {
        const d = this.creatorData;
        const bio = document.getElementById('creatorBio')?.value.trim() || '';
        if (!d.name) { this.showToast('Donne un prénom'); return; }

        const char = {
            name: d.name,
            gender: d.gender || 'feminin',
            nationality: d.nationality || 'Africaine',
            personality: d.personality || { passion: 3, romance: 3, talk: 3, timide: 3 },
            voiceId: d.voiceId || '21m00Tcm4TlvDq8ikWAM',
            bio
        };

        const result = await API.createCustomCharacter(char);
        if (result.success) {
            this.closeCreator();
            this.showToast(`🎉 ${d.name} a été créé(e) !`);
            await this.loadCustomCharacters();
            this.creatorData = {};
        } else {
            this.showToast(result.message || 'Erreur de création');
        }
    },

    bindEvents() {
        document.getElementById('sendBtn')?.addEventListener('click', () => this.sendMessage());
        document.getElementById('chatInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        document.querySelectorAll('.character-item').forEach(item => {
            item.addEventListener('click', () => {
                const name = item.dataset.character;
                if (name && this.characters[name]) {
                    document.querySelectorAll('.character-item').forEach(i => i.classList.remove('active'));
                    item.classList.add('active');
                    this.loadCharacter(name);
                }
            });
        });

        document.getElementById('mobileBack')?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
        });

        document.getElementById('sidebarToggle')?.addEventListener('click', () => {
            document.getElementById('sidebar').classList.toggle('open');
        });

        document.getElementById('audioBtn')?.addEventListener('click', () => {
            this.generateAudioForLastMessage();
        });

        document.getElementById('imageBtn')?.addEventListener('click', () => {
            this.generateImage();
        });

        document.getElementById('upgradeBtn')?.addEventListener('click', () => {
            window.location.href = 'index.html#pricing';
        });

        document.getElementById('logoutBtn')?.addEventListener('click', () => {
            API.logout();
            window.location.href = 'index.html';
        });

        document.getElementById('addCharBtn')?.addEventListener('click', () => this.openCreator());
        document.getElementById('charCreatorClose')?.addEventListener('click', () => this.closeCreator());
        document.getElementById('charCreatorOverlay')?.addEventListener('click', (e) => {
            if (e.target === e.currentTarget) this.closeCreator();
        });
    },

    loadCharacter(name) {
        const char = this.characters[name];
        const custom = this.customCharacters.find(c => c.id === name);

        if (!char && !custom) return;

        this.currentCharacter = name;
        this.conversationHistory = [];

        const colors = ['#FF3B7F','#6C2BD9','#FF6B6B','#845EC2','#FF9671','#2D3436','#1A5276'];
        const colorIdx = name.charCodeAt(0) % colors.length;

        if (char) {
            document.getElementById('contactName').textContent = char.name;
            document.getElementById('contactAvatar').style.background = char.color;
            document.getElementById('contactAvatar').textContent = char.avatar;
            document.getElementById('welcomeName').textContent = char.name;
            document.getElementById('welcomeAvatar').style.background = char.color;
            document.getElementById('welcomeAvatar').textContent = char.avatar;
            document.getElementById('welcomeBio').textContent = char.bio;
        } else if (custom) {
            const initial = custom.name.charAt(0).toUpperCase();
            document.getElementById('contactName').textContent = custom.name;
            document.getElementById('contactAvatar').style.background = colors[colorIdx];
            document.getElementById('contactAvatar').textContent = initial;
            document.getElementById('welcomeName').textContent = custom.name;
            document.getElementById('welcomeAvatar').style.background = colors[colorIdx];
            document.getElementById('welcomeAvatar').textContent = initial;
            document.getElementById('welcomeBio').textContent = custom.bio || `Ton ${custom.gender === 'masculin' ? 'compagnon' : 'compagne'} ${custom.nationality} est là pour toi.`;
        }

        const chatMessages = document.getElementById('chatMessages');
        chatMessages.querySelectorAll('.message').forEach(m => m.remove());
        document.querySelector('.welcome-message').style.display = 'block';
    },

    async sendMessage(text) {
        const input = document.getElementById('chatInput');
        const messageText = text || input.value.trim();
        
        if (!messageText) return;

        input.value = '';
        document.querySelector('.welcome-message').style.display = 'none';

        this.addMessage(messageText, 'user');

        this.showTyping();

        try {
            const response = await API.chat(this.currentCharacter, messageText, this.conversationHistory);
            this.hideTyping();
            
            if (response && response.content) {
                if (response.messagesLeft !== undefined) {
                    this.updateMsgCounter(response.messagesLeft);
                }
                ANALYTICS.capture('message_sent', { character: this.currentCharacter, limit: !!response.limit });
                this.conversationHistory.push({ role: 'user', content: messageText });
                this.conversationHistory.push({ role: 'assistant', content: response.content });
                this.addMessage(response.content, 'ia');

                if (response.limit) {
                    this.showToast('🔥 ' + response.content);
                } else {
                    if (this.voiceEnabled && response.content.length < 500) {
                        this.generateVoiceForText(response.content);
                    }
                }
            } else {
        const char = this.characters[this.currentCharacter] || this.customCharacters.find(c => c.id === this.currentCharacter) || { avatar: '?', color: 'var(--gradient-primary)' };
                const fallbacks = [
                    "Je suis là pour toi. Continue, je t'écoute...",
                    "Parle-moi encore, j'aime t'entendre.",
                    "Dis-moi ce que tu ressens en ce moment.",
                    "Je suis tout à toi. Raconte-moi."
                ];
                const fb = fallbacks[Math.floor(Math.random() * fallbacks.length)];
                this.conversationHistory.push({ role: 'user', content: messageText });
                this.conversationHistory.push({ role: 'assistant', content: fb });
                this.addMessage(fb, 'ia');
            }
        } catch (e) {
            this.hideTyping();
            this.addMessage('Je suis là, parle-moi...', 'ia');
        }
    },

    addMessage(text, type) {
        const container = document.getElementById('chatMessages');
        const msg = document.createElement('div');
        msg.className = `message ${type}`;

        const char = this.characters[this.currentCharacter];
        const avatar = type === 'ia' ? char.avatar : 'T';
        const avatarColor = type === 'ia' ? char.color : 'var(--gradient-primary)';
        const now = new Date();
        const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');

        if (text.startsWith('[AUDIO]')) {
            msg.innerHTML = `
                <div class="msg-avatar" style="background:${avatarColor}">${avatar}</div>
                <div class="msg-content" style="padding:0;">
                    <div class="msg-audio-player" onclick="CHAT.playAudio('${text.replace('[AUDIO]','').trim()}')">
                        <i class="fas fa-play"></i>
                        <div class="audio-wave">
                            ${Array(10).fill('<span></span>').join('')}
                        </div>
                    </div>
                </div>
            `;
        } else if (text.startsWith('[IMAGE]')) {
            msg.innerHTML = `
                <div class="msg-avatar" style="background:${avatarColor}">${avatar}</div>
                <div class="msg-content msg-image">
                    <img src="${text.replace('[IMAGE]','').trim()}" alt="Image générée" loading="lazy">
                </div>
            `;
        } else {
            msg.innerHTML = `
                <div class="msg-avatar" style="background:${avatarColor}">${avatar}</div>
                <div class="msg-content">${this.formatText(text)}
                    <div class="msg-timestamp">${time}</div>
                </div>
            `;
        }

        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
    },

    formatText(text) {
        return text
            .replace(/\n/g, '<br>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>');
    },

    showTyping() {
        if (this.isTyping) return;
        this.isTyping = true;

        const container = document.getElementById('chatMessages');
        const indicator = document.createElement('div');
        indicator.className = 'typing-indicator';
        indicator.id = 'typingIndicator';
        const charTyping = this.characters[this.currentCharacter] || this.customCharacters.find(c => c.id === this.currentCharacter) || { avatar: '?', color: 'var(--gradient-primary)' };
        indicator.innerHTML = `
            <div class="msg-avatar" style="background:${charTyping.color}">${charTyping.avatar}</div>
            <div class="typing-dots">
                <span></span><span></span><span></span>
            </div>
        `;
        container.appendChild(indicator);
        container.scrollTop = container.scrollHeight;
    },

    hideTyping() {
        this.isTyping = false;
        const indicator = document.getElementById('typingIndicator');
        if (indicator) indicator.remove();
    },

    sendSuggestion(text) {
        this.sendMessage(text);
    },

    toggleVoice() {
        this.voiceEnabled = !this.voiceEnabled;
        const btn = document.querySelector('.chat-action-btn[onclick*="toggleVoice"] i');
        if (btn) {
            btn.className = this.voiceEnabled ? 'fas fa-volume-up' : 'fas fa-volume-off';
        }
        this.showToast(this.voiceEnabled ? 'Voix activée 🔊' : 'Voix désactivée 🔇');
    },

    async generateVoiceForText(text) {
        try {
            const blob = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    text: text.substring(0, 200),
                    model_id: 'eleven_monolingual_v1',
                    voice_settings: { stability: 0.5, similarity_boost: 0.75 }
                })
            }).then(r => r.blob());

            const url = URL.createObjectURL(blob);
            const audio = new Audio(url);
            audio.play().catch(() => {});
        } catch (e) {
            // Voix non disponible
        }
    },

    async generateAudioForLastMessage() {
        const lastIa = [...document.querySelectorAll('.message.ia')].pop();
        if (!lastIa) {
            this.showToast('Demande d\'abord une réponse à ton personnage');
            return;
        }

        const text = lastIa.querySelector('.msg-content')?.textContent?.trim();
        if (!text) return;

        this.showToast('Génération de l\'audio...');

        const custom = this.customCharacters.find(c => c.id === this.currentCharacter);
        const voiceId = custom?.voiceId || custom?.voiceid || '21m00Tcm4TlvDq8ikWAM';
        const url = await API.voice(text, voiceId);
        if (url) {
            const audio = new Audio(url);
            audio.play();
            this.showToast('Audio prêt 🔊');
            return;
        }

        if ('speechSynthesis' in window) {
            const utterance = new SpeechSynthesisUtterance(text);
            utterance.lang = 'fr-FR';
            utterance.rate = 0.9;
            utterance.pitch = 1.1;
            speechSynthesis.speak(utterance);
            this.showToast('Lecture vocale...');
        } else {
            this.showToast('La synthèse vocale n\'est pas disponible');
        }
    },

    async generateImage() {
        const lastIa = [...document.querySelectorAll('.message.ia')].pop();
        if (!lastIa) {
            this.showToast('Demande d\'abord une description à ton personnage');
            return;
        }

        const text = lastIa.querySelector('.msg-content')?.textContent?.trim() || 'une ambiance sensuelle tamisée';
        this.showToast('Génération de l\'image...');

        const time = new Date().toLocaleTimeString();
        const result = await API.generateImage(text);

        const container = document.getElementById('chatMessages');
        const msg = document.createElement('div');
        msg.className = 'message ia';

        const char = this.characters[this.currentCharacter] || this.customCharacters.find(c => c.id === this.currentCharacter);
        const colors = ['#FF3B7F','#6C2BD9','#FF6B6B','#845EC2','#FF9671','#2D3436','#1A5276'];
        const color = char?.color || colors[this.currentCharacter.charCodeAt(0) % colors.length];
        const avatar = char?.avatar || (char?.name?.charAt(0).toUpperCase()) || '?';

        if (result?.imageUrl && !result.placeholder) {
            msg.innerHTML = `
                <div class="msg-avatar" style="background:${color}">${avatar}</div>
                <div class="msg-content msg-image">
                    <img src="${result.imageUrl}" alt="Image générée" loading="lazy">
                    <div class="msg-timestamp">${time}</div>
                </div>
            `;
        } else {
            msg.innerHTML = `
                <div class="msg-avatar" style="background:${color}">${avatar}</div>
                <div class="msg-content msg-image">
                    <div style="width:280px;height:350px;background:linear-gradient(135deg,${color},#0D0D1A);border-radius:12px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:0.5rem;color:rgba(255,255,255,0.7);font-size:0.85rem;">
                        <i class="fas fa-wand-magic-sparkles" style="font-size:2rem;"></i>
                        <span>Image générée par IA</span>
                        <span style="font-size:0.75rem;">"${text.substring(0, 60)}..."</span>
                    </div>
                    <div class="msg-timestamp">${time}</div>
                </div>
            `;
        }
        container.appendChild(msg);
        container.scrollTop = container.scrollHeight;
    },

    toggleDiscrete() {
        this.discreteMode = !this.discreteMode;
        const overlay = document.getElementById('discreteOverlay');
        if (overlay) {
            overlay.classList.toggle('active');
            this.showToast(this.discreteMode ? 'Mode discret activé 👁️‍🗨️' : 'Mode normal');
        }
    },

    clearChat() {
        if (confirm('Effacer la conversation ?')) {
            document.getElementById('chatMessages').querySelectorAll('.message').forEach(m => m.remove());
            document.querySelector('.welcome-message').style.display = 'block';
            this.conversationHistory = [];
            this.showToast('Conversation effacée');
        }
    },

    showToast(message) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add('active');
        clearTimeout(this.toastTimeout);
        this.toastTimeout = setTimeout(() => toast.classList.remove('active'), 3000);
    }
};

document.addEventListener('DOMContentLoaded', () => CHAT.init());
