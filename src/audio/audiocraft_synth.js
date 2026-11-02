/**
 * Meta AudioCraft / WebAudio Procedural Synthesizer
 *
 * Generates dynamic audio stems (jump pulse, crystalline chime, ambient drone)
 * using WebAudio oscillator nodes for zero-download instant playback.
 */

export function generateWebAudioSynthesizerJs() {
  return `
    // Meta AudioCraft WebAudio Procedural Synthesizer
    const AudioEngine = (function() {
      let audioCtx = null;
      let masterGain = null;
      let muted = false;
      let suspended = false;

      function getContext() {
        if (!audioCtx) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext) {
            audioCtx = new AudioContext();
            masterGain = audioCtx.createGain();
            masterGain.gain.value = muted ? 0 : 1;
            masterGain.connect(audioCtx.destination);
          }
        }
        if (audioCtx && !suspended && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        return audioCtx;
      }

      return {
        get ctx() { return audioCtx; },
        get master() { return masterGain; },

        playJump: function() {
          if (muted || suspended) return;
          const ctx = getContext();
          if (!ctx || !masterGain) return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(150, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
          osc.connect(gain);
          gain.connect(masterGain);
          osc.start();
          osc.stop(ctx.currentTime + 0.15);
        },

        playCollect: function() {
          if (muted || suspended) return;
          const ctx = getContext();
          if (!ctx || !masterGain) return;
          const now = ctx.currentTime;
          const notes = [523.25, 659.25, 783.99, 1046.50]; // C Major arpeggio
          notes.forEach((freq, idx) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + idx * 0.04);
            gain.gain.setValueAtTime(0.15, now + idx * 0.04);
            gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.04 + 0.25);
            osc.connect(gain);
            gain.connect(masterGain);
            osc.start(now + idx * 0.04);
            osc.stop(now + idx * 0.04 + 0.25);
          });
        },

        suspendAll: function() {
          suspended = true;
          if (audioCtx && masterGain) {
            try {
              const t = audioCtx.currentTime || 0;
              if (masterGain.gain.cancelScheduledValues) masterGain.gain.cancelScheduledValues(t);
              masterGain.gain.setTargetAtTime(0.0001, t, 0.015);
              masterGain.gain.value = 0.0001;
            } catch (e) {}
          }
          if (audioCtx && audioCtx.state === 'running' && typeof audioCtx.suspend === 'function') {
            try { audioCtx.suspend(); } catch (e) {}
          }
          try {
            const audios = document.querySelectorAll('audio');
            for (let i = 0; i < audios.length; i++) {
              if (audios[i] && typeof audios[i].pause === 'function') audios[i].pause();
            }
          } catch (e) {}
          try {
            if (window.speechSynthesis && typeof window.speechSynthesis.cancel === 'function') {
              window.speechSynthesis.cancel();
            }
          } catch (e) {}
        },

        resumeAll: function() {
          suspended = false;
          if (muted) return;
          if (audioCtx && audioCtx.state === 'suspended' && typeof audioCtx.resume === 'function') {
            try { audioCtx.resume(); } catch (e) {}
          }
          if (audioCtx && masterGain) {
            try {
              const t = audioCtx.currentTime || 0;
              masterGain.gain.setTargetAtTime(1, t, 0.03);
              masterGain.gain.value = 1;
            } catch (e) {}
          }
        },

        toggleMute: function() {
          muted = !muted;
          if (masterGain) masterGain.gain.value = muted ? 0 : 1;
          return muted;
        }
      };
    })();
  `;
}
