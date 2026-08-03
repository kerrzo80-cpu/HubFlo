/**
 * PCM capture → WAV for Whisper.
 * MediaRecorder on iPhone Safari often yields empty/unusable clips; this path is reliable
 * once getUserMedia + AudioContext are unlocked by a tap.
 */

export type PcmVoiceSession = {
  mimeType: "audio/wav";
  /** 0–1 level callback while recording. */
  onLevel?: (level: number) => void;
  stop: () => Promise<Blob>;
};

function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const samples = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }

  // Downsample toward 16kHz for smaller Whisper uploads when the context is high-rate.
  const targetRate = sampleRate > 16000 ? 16000 : sampleRate;
  const ratio = sampleRate / targetRate;
  const downLength = Math.max(1, Math.floor(samples.length / ratio));
  const down = new Float32Array(downLength);
  for (let i = 0; i < downLength; i += 1) {
    down[i] = samples[Math.min(samples.length - 1, Math.floor(i * ratio))] ?? 0;
  }

  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const buffer = new ArrayBuffer(44 + down.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeString = (at: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(at + i, text.charCodeAt(i));
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + down.length * bytesPerSample, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, down.length * bytesPerSample, true);

  let dataOffset = 44;
  for (let i = 0; i < down.length; i += 1) {
    const s = Math.max(-1, Math.min(1, down[i] ?? 0));
    view.setInt16(dataOffset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    dataOffset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

type StartPcmOptions = {
  context: AudioContext;
  stream: MediaStream;
  onLevel?: (level: number) => void;
};

export function startPcmVoiceSession(options: StartPcmOptions): PcmVoiceSession {
  const { context, stream, onLevel } = options;
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const mute = context.createGain();
  mute.gain.value = 0;
  const chunks: Float32Array[] = [];
  let stopped = false;

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    const input = event.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(input));
    if (onLevel) {
      let sum = 0;
      let peak = 0;
      for (let i = 0; i < input.length; i += 1) {
        const sample = input[i] ?? 0;
        const abs = Math.abs(sample);
        if (abs > peak) peak = abs;
        sum += sample * sample;
      }
      const rms = Math.sqrt(sum / input.length);
      onLevel(Math.min(1, Math.max(rms * 4.5, peak * 1.8)));
    }
  };

  source.connect(processor);
  processor.connect(mute);
  mute.connect(context.destination);

  return {
    mimeType: "audio/wav",
    stop: async () => {
      stopped = true;
      try {
        processor.disconnect();
        source.disconnect();
        mute.disconnect();
      } catch {
        // ignore
      }
      if (!chunks.length) {
        return new Blob([], { type: "audio/wav" });
      }
      return encodeWav(chunks, context.sampleRate || 44100);
    },
  };
}
