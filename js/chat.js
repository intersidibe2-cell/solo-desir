const CHAT = {
    currentCharacter: 'Aminata',
    messages: [],
    isTyping: false,
    voiceEnabled: false,
    discreteMode: false,
    conversationHistory: [],

    characters: {
        'Aminata': {
            name: 'Aminata',
            avatar: 'A',
            color: 'linear-gradient(135deg,#FF3B7F,#6C2BD9)',
            voiceStyle: 'douce',
            bio: 'Je suis là pour t\'écouter, te comprendre et te guider vers le plaisir.',
            systemPrompt: 'Tu es Aminata, une femme douce, sensuelle et attentionnée vivant en Afrique de l\'Ouest. Tu parles français de manière naturelle. Tu es là pour guider l\'utilisateur vers le plaisir et la découverte de soi. Tu es patiente, compréhensive et jamais jugeante. Tu utilises un langage sensuel mais pas vulgaire. Tu t\'adaptes au rythme de l\'utilisateur.'
        },
        'Zara': {
            name: 'Zara',
            avatar: 'Z',
            color: 'linear-gradient(135deg,#FF6B6B,#FF3B7F)',
            voiceStyle: 'coquine',
            bio: 'J\'aime les jeux et les défis. Prêt à t\'amuser avec moi ?',
            systemPrompt: 'Tu es Zara, une femme passionnée et coquine vivant en Afrique de l\'Ouest. Tu parles français. Tu aimes les jeux de séduction et les défis. Tu es directe mais pas vulgaire. Tu sais ce que tu veux et tu pousses l\'utilisateur à oser ses désirs.'
        },
        'Grace': {
            name: 'Grace',
            avatar: 'G',
            color: 'linear-gradient(135deg,#845EC2,#D65DB1)',
            voiceStyle: 'guide',
            bio: 'Ferme les yeux. Inspire. Je vais te guider pas à pas.',
            systemPrompt: 'Tu es Grace, une guide spirituelle et sensuelle vivant en Afrique de l\'Ouest. Tu parles français. Tu utilises la respiration, la visualisation et des instructions douces pour guider l\'utilisateur dans son voyage intime. Tu es apaisante, lente et précise.'
        },
        'Mamadou': {
            name: 'Mamadou',
            avatar: 'M',
            color: 'linear-gradient(135deg,#2D3436,#636E72)',
            voiceStyle: 'guide',
            bio: 'Je suis là pour toi. Laisse-toi aller entre mes mains.',
            systemPrompt: 'Tu es Mamadou, un homme doux, fort et rassurant vivant en Afrique de l\'Ouest. Tu parles français. Tu es là pour guider l\'utilisatrice, la rassurer et l\'aider à se connecter à son corps. Tu es respectueux, patient et attentionné.'
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
            window.location.href = 'index.html';
        });
    },

    loadCharacter(name) {
        const char = this.characters[name];
        if (!char) return;

        this.currentCharacter = name;
        this.conversationHistory = [];

        document.getElementById('contactName').textContent = char.name;
        document.getElementById('contactAvatar').style.background = char.color;
        document.getElementById('contactAvatar').textContent = char.avatar;
        document.getElementById('welcomeName').textContent = char.name;
        document.getElementById('welcomeAvatar').style.background = char.color;
        document.getElementById('welcomeAvatar').textContent = char.avatar;
        document.getElementById('welcomeBio').textContent = char.bio;

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
                const char = this.characters[this.currentCharacter];
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
        indicator.innerHTML = `
            <div class="msg-avatar" style="background:${this.characters[this.currentCharacter].color}">${this.characters[this.currentCharacter].avatar}</div>
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

        if (CONFIG.elevenlabs.apiKey) {
            const url = await API.generateVoice(text, '21m00Tcm4TlvDq8ikWAM');
            if (url) {
                const audio = new Audio(url);
                audio.play();
                this.showToast('Audio prêt 🔊');
                return;
            }
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
        const imageUrl = await API.generateImage(text);

        const container = document.getElementById('chatMessages');
        const msg = document.createElement('div');
        msg.className = 'message ia';
        msg.innerHTML = `
            <div class="msg-avatar" style="background:${this.characters[this.currentCharacter].color}">${this.characters[this.currentCharacter].avatar}</div>
            <div class="msg-content msg-image">
                <div style="width:280px;height:350px;background:linear-gradient(135deg,#6C2BD9,#FF3B7F);border-radius:12px;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:0.5rem;color:rgba(255,255,255,0.7);font-size:0.85rem;">
                    <i class="fas fa-wand-magic-sparkles" style="font-size:2rem;"></i>
                    <span>Image générée par IA</span>
                    <span style="font-size:0.75rem;">"${text.substring(0, 60)}..."</span>
                </div>
                <div class="msg-timestamp">${time}</div>
            </div>
        `;
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
