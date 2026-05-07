// AudioWorklet processor for Copilot mic capture.
// Runs in the audio rendering thread → much lower & more stable latency than
// ScriptProcessorNode. Receives 128-sample float frames at 16 kHz, applies
// gain, computes RMS, converts to Int16 PCM, and batches into ~20 ms chunks
// (320 samples) before posting to the main thread.
class CopilotMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.gain = 1.0;
    this.chunkSize = 320; // 20 ms @ 16 kHz
    this.buf = new Int16Array(this.chunkSize);
    this.fill = 0;
    this.sumSq = 0;
    this.sampleCount = 0;
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.gain === "number") this.gain = e.data.gain;
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const ch = input[0];
    if (!ch) return true;
    const g = this.gain;
    for (let i = 0; i < ch.length; i++) {
      let s = ch[i] * g;
      if (s > 1) s = 1; else if (s < -1) s = -1;
      this.buf[this.fill++] = s < 0 ? s * 0x8000 : s * 0x7fff;
      this.sumSq += s * s;
      this.sampleCount++;
      if (this.fill === this.chunkSize) {
        const out = this.buf;
        this.buf = new Int16Array(this.chunkSize);
        this.fill = 0;
        const rms = Math.sqrt(this.sumSq / this.sampleCount);
        this.sumSq = 0;
        this.sampleCount = 0;
        this.port.postMessage({ pcm: out.buffer, rms }, [out.buffer]);
      }
    }
    return true;
  }
}

registerProcessor("copilot-mic", CopilotMicProcessor);
