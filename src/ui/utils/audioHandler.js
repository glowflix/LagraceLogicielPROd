/**
 * Audio Handler - Gère la réception et la lecture d'audio de l'IA
 * 
 * Fonctionnalités:
 * - Écoute les événements Socket.IO `ai:speak`
 * - Décode l'audio base64 WAV
 * - Joue l'audio via Web Audio API
 * - Gère les logs et erreurs
 */

class AudioHandler {
  constructor(socket) {
    this.socket = socket;
    this.audioContext = null;
    this.isPlaying = false;
    this.audioQueue = [];
    this.currentAudio = null;
    
    this.init();
  }

  /**
   * Initialiser le contexte audio
   */
  init() {
    try {
      // Créer AudioContext (compatible tous navigateurs)
      window.AudioContext = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioContext();
      console.log('[AudioHandler] ✅ Contexte audio initialisé');
    } catch (e) {
      console.error('[AudioHandler] ❌ Web Audio API non disponible:', e);
    }

    // Écouter les événements Socket.IO
    if (this.socket) {
      this.setupSocketListeners();
    }
  }

  /**
   * Configurer les écouteurs Socket.IO
   */
  setupSocketListeners() {
    console.log('[AudioHandler] 📡 Configuration des écouteurs Socket.IO...');

    // Événement: L'IA parle
    this.socket.on('ai:speak', (data) => {
      console.log('[AudioHandler] 🔊 Événement ai:speak reçu', {
        hasAudio: !!data.audio,
        textLength: data.text?.length || 0,
        duration: data.duration
      });
      this.handleAiSpeak(data);
    });

    // Événement: Connexion établie
    this.socket.on('connect', () => {
      console.log('[AudioHandler] ✅ Socket.IO connecté - Audio handler prêt');
    });

    // Événement: Déconnexion
    this.socket.on('disconnect', () => {
      console.log('[AudioHandler] ❌ Socket.IO déconnecté');
    });
  }

  /**
   * Traiter l'audio de l'IA
   */
  async handleAiSpeak(data) {
    try {
      if (!data.audio) {
        console.warn('[AudioHandler] ⚠️ Pas de données audio reçues');
        return;
      }

      const ts = new Date().toLocaleTimeString('fr-FR');
      console.log(`[${ts}] [AudioHandler] 🎤 ========== RÉCEPTION AUDIO ==========`);
      console.log(`[${ts}] [AudioHandler]    📝 Texte: "${data.text}"`);
      console.log(`[${ts}] [AudioHandler]    📊 Durée annoncée: ${data.duration?.toFixed(2)}s`);
      console.log(`[${ts}] [AudioHandler]    📦 Taille payload: ${data.audio.length} chars`);
      if (data.timestamp) {
        console.log(`[${ts}] [AudioHandler]    ⏱️ Timestamp serveur: ${data.timestamp}`);
      }

      console.log(`[${ts}] [AudioHandler] 🔍 Décodage audio...`);
      // Décoder l'audio base64
      const audioBuffer = await this.decodeAudio(data.audio);
      if (!audioBuffer) {
        console.error(`[${ts}] [AudioHandler] ❌ Impossible de décoder l\'audio`);
        return;
      }

      // Ajouter à la queue
      this.audioQueue.push(audioBuffer);
      console.log(`[${ts}] [AudioHandler] ✅ Audio ajouté à la queue (${this.audioQueue.length} items)`);
      console.log(`[${ts}] [AudioHandler] ${'='*40}\n`);

      // Jouer immédiatement si rien ne joue
      if (!this.isPlaying) {
        this.playNext();
      }
    } catch (error) {
      console.error('[AudioHandler] ❌ Erreur traitement audio:', error);
    }
  }

  /**
   * Décoder l'audio base64 WAV
   */
  async decodeAudio(dataUrl) {
    try {
      const ts = new Date().toLocaleTimeString('fr-FR');
      console.log(`[${ts}] [AudioHandler]    🔹 Extraction base64...`);

      // Extraire les données base64
      const base64Data = dataUrl.replace(/^data:audio\/wav;base64,/, '');
      
      // Convertir base64 en binaire
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      console.log(`[${ts}] [AudioHandler]    📦 Données binaires: ${bytes.length} bytes`);

      // Décoder WAV avec Web Audio API
      if (this.audioContext.state === 'suspended') {
        console.log(`[${ts}] [AudioHandler]    ⏸️ AudioContext suspendu - Reprise...`);
        await this.audioContext.resume();
        console.log(`[${ts}] [AudioHandler]    ▶️ AudioContext repris`);
      }

      console.log(`[${ts}] [AudioHandler]    🔊 Décodage WAV via AudioContext...`);
      const audioBuffer = await this.audioContext.decodeAudioData(bytes.buffer);
      const duration = audioBuffer.duration.toFixed(2);
      const sampleRate = audioBuffer.sampleRate;
      const channels = audioBuffer.numberOfChannels;
      
      console.log(`[${ts}] [AudioHandler]    ✅ Audio décodé!`);
      console.log(`[${ts}] [AudioHandler]       • Durée: ${duration}s`);
      console.log(`[${ts}] [AudioHandler]       • Sample rate: ${sampleRate} Hz`);
      console.log(`[${ts}] [AudioHandler]       • Canaux: ${channels}`);
      
      return audioBuffer;
    } catch (error) {
      console.error('[AudioHandler] ❌ Erreur décodage:', error);
      return null;
    }
  }

  /**
   * Jouer le prochain audio de la queue
   */
  async playNext() {
    if (this.audioQueue.length === 0) {
      const ts = new Date().toLocaleTimeString('fr-FR');
      console.log(`[${ts}] [AudioHandler] ✅ Queue vide - Tous les audios joués`);
      this.isPlaying = false;
      return;
    }

    this.isPlaying = true;
    const audioBuffer = this.audioQueue.shift();
    const ts = new Date().toLocaleTimeString('fr-FR');

    try {
      console.log(`\n[${ts}] [AudioHandler] 🎵 ========== LECTURE AUDIO ==========`);
      console.log(`[${ts}] [AudioHandler]    ⏳ Items restants en queue: ${this.audioQueue.length}`);

      // Créer une source audio
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);

      const duration = audioBuffer.duration.toFixed(2);
      console.log(`[${ts}] [AudioHandler]    ▶️ Démarrage lecture... Durée: ${duration}s`);
      console.log(`[${ts}] [AudioHandler]    🔊 AudioContext state: ${this.audioContext.state}`);

      // Événement: fin de la lecture
      source.onended = () => {
        const endTs = new Date().toLocaleTimeString('fr-FR');
        console.log(`[${endTs}] [AudioHandler]    ✅ Fin de la lecture`);
        console.log(`[${endTs}] [AudioHandler] ${'='*40}\n`);
        this.playNext(); // Jouer le suivant
      };

      // Démarrer la lecture
      source.start(0);
      this.currentAudio = source;
    } catch (error) {
      console.error(`[${ts}] [AudioHandler] ❌ Erreur lecture:`, error);
      this.playNext();
    }
  }

  /**
   * Arrêter la lecture
   */
  stop() {
    console.log('[AudioHandler] ⏹️ Arrêt de la lecture');
    if (this.currentAudio) {
      try {
        this.currentAudio.stop();
      } catch (e) {
        // Ignorer si déjà arrêté
      }
    }
    this.audioQueue = [];
    this.isPlaying = false;
  }

  /**
   * Obtenir le statut
   */
  getStatus() {
    return {
      isPlaying: this.isPlaying,
      queueLength: this.audioQueue.length,
      audioContextState: this.audioContext?.state || 'unavailable'
    };
  }
}

export default AudioHandler;
