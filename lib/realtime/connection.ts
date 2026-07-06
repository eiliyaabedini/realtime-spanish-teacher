"use client";

import type { ServerEvent } from "./events";

export type RealtimeConnection = {
  send: (event: object) => void;
  close: () => void;
  /** false when mic permission was denied — text-input mode */
  micAvailable: boolean;
  /** mute/unmute the local microphone track */
  setMicEnabled: (enabled: boolean) => void;
  peer: RTCPeerConnection;
};

const CALLS_URL = "https://api.openai.com/v1/realtime/calls";

/**
 * Browser → OpenAI Realtime over WebRTC using an ephemeral client secret.
 * Audio output plays through the provided <audio> element; mic is optional
 * (denied mic degrades to text-input mode, the session still works).
 */
export async function connectRealtime(opts: {
  clientSecret: string;
  audioElement: HTMLAudioElement;
  onEvent: (event: ServerEvent) => void;
  onConnectionChange?: (state: RTCPeerConnectionState) => void;
  /** autoplay was blocked (e.g. Safari after a navigation) — show a tap-to-listen button */
  onAudioBlocked?: () => void;
}): Promise<RealtimeConnection> {
  const pc = new RTCPeerConnection();

  pc.ontrack = (e) => {
    opts.audioElement.srcObject = e.streams[0];
    void opts.audioElement.play().catch(() => {
      opts.onAudioBlocked?.();
    });
  };
  pc.onconnectionstatechange = () => opts.onConnectionChange?.(pc.connectionState);

  let micAvailable = true;
  let micStream: MediaStream | null = null;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    for (const track of micStream.getTracks()) pc.addTrack(track, micStream);
  } catch {
    micAvailable = false;
    pc.addTransceiver("audio", { direction: "recvonly" });
  }

  const dc = pc.createDataChannel("oai-events");
  dc.onmessage = (e) => {
    try {
      opts.onEvent(JSON.parse(e.data) as ServerEvent);
    } catch {
      // ignore malformed frames
    }
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const res = await fetch(CALLS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.clientSecret}`,
      "Content-Type": "application/sdp",
    },
    body: offer.sdp,
  });
  if (!res.ok) {
    pc.close();
    micStream?.getTracks().forEach((t) => t.stop());
    throw new Error(`Realtime SDP exchange failed (${res.status}): ${await res.text()}`);
  }

  await pc.setRemoteDescription({ type: "answer", sdp: await res.text() });

  await new Promise<void>((resolve, reject) => {
    if (dc.readyState === "open") return resolve();
    const timer = setTimeout(() => reject(new Error("Data channel open timeout")), 15_000);
    dc.onopen = () => {
      clearTimeout(timer);
      resolve();
    };
  });

  return {
    micAvailable,
    peer: pc,
    setMicEnabled: (enabled) => {
      micStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
    },
    send: (event) => {
      if (dc.readyState === "open") dc.send(JSON.stringify(event));
    },
    close: () => {
      try {
        dc.close();
      } catch {}
      try {
        pc.close();
      } catch {}
      micStream?.getTracks().forEach((t) => t.stop());
      opts.audioElement.srcObject = null;
    },
  };
}
