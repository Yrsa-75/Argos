import { useState, useCallback, useRef, useEffect } from 'react';

// ──────────────────────────────────────────────────────────────
// Configuration — variables d'environnement (Cloudflare Pages)
// ──────────────────────────────────────────────────────────────
const WORKER_URL = import.meta.env.VITE_WORKER_URL || '';
const WORKER_TOKEN = import.meta.env.VITE_WORKER_SECRET_TOKEN || '';

const SESSION_STORAGE_KEY = 'argos-session';
const PROJECT_STORAGE_KEY = 'argos-project';

// ──────────────────────────────────────────────────────────────
// Helpers — métadonnées vidéo/audio via le navigateur
// ──────────────────────────────────────────────────────────────
async function getVideoMetadata(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const url = URL.createObjectURL(file);
    video.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve({ duration: video.duration || 0, width: video.videoWidth || 1920, height: video.videoHeight || 1080 }); };
    video.onerror = () => { URL.revokeObjectURL(url); resolve({ duration: 0, width: 1920, height: 1080 }); };
    video.src = url;
  });
}

async function getAudioDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    const url = URL.createObjectURL(file);
    audio.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(audio.duration || 0); };
    audio.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    audio.src = url;
  });
}

async function generateVideoThumbnail(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata'; video.muted = true;
    const url = URL.createObjectURL(file);
    video.onloadeddata = () => { video.currentTime = Math.min(1, video.duration * 0.1); };
    video.onseeked = () => {
      try {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
        const ctx = canvas.getContext('2d');
        if (ctx) { ctx.drawImage(video, 0, 0, 320, 180); URL.revokeObjectURL(url); resolve(canvas.toDataURL('image/jpeg', 0.7)); }
        else { URL.revokeObjectURL(url); resolve(null); }
      } catch { URL.revokeObjectURL(url); resolve(null); }
    };
    video.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    video.src = url;
  });
}
