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
      let muted = false;

      function getContext() {
        if (!audioCtx) {
          const AudioContext = window.AudioContext || window.webkitAudioContext;
          if (AudioContext) audioCtx = new AudioContext();
        }
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
        return audioCtx;
      }

      return {
        playJump: function() {
          if (muted) return;
          const ctx = getContext();
          if (!ctx) return;
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(150, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.15);
          gain.gain.setValueAtTime(0.2, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start();
          osc.stop(ctx.currentTime + 0.15);
        },

        playCollect: function() {
          if (muted) return;
          const ctx = getContext();
          if (!ctx) return;
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
            gain.connect(ctx.destination);
            osc.start(now + idx * 0.04);
            osc.stop(now + idx * 0.04 + 0.25);
          });
        },

        toggleMute: function() {
          muted = !muted;
          return muted;
        }
      };
    })();
  `;
}
